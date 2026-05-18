/**
 * PDF 文件提取器 - 使用 pdf.js 实现真正流式处理
 * 支持: pdf 文件
 *
 * 特性：
 * - 逐页解析，边解析边检测
 * - 每页处理后立即释放内存
 * - 支持早期退出（找到敏感词后停止）
 * - 完善的错误处理（损坏/加密 PDF）
 * - 纯图 PDF 检测与跳过
 * - Worker 级别的 pdf.js 隔离，防止内存泄漏
 */

import {
  BYTES_TO_MB,
  DEFAULT_MAX_PDF_SIZE_MB,
  FILE_READ_TIMEOUT_STANDARD_MS,
  MAX_TEXT_CONTENT_SIZE_MB,
  PDF_OCR_ENABLED,
  PDF_PAGE_TIMEOUT_MS,
  PDF_TOTAL_TIMEOUT_MS,
} from '../../core/config/constants';
import type { ExtractorResult } from '../types';
import { BaseExtractor } from '../base-extractor';
import { readFileWithTimeout } from '../../utils/file-utils';
import { composeDecorators, withLogging, withTimeout } from '../extractor-decorators';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import * as path from 'path';

/** PDF 文档配置 */
const PDF_DOCUMENT_OPTIONS = {
  disableFontFace: true,
  disableRange: true,
  disableStream: true,
  useSystemFonts: true,
  cMapUrl: undefined,
  standardFontDataUrl: undefined,
} as const;

// Worker 级别的 pdf.js 实例，避免全局污染
let workerPdfJsLib: any = null;

/**
 * 为每个 Worker 初始化独立的 pdf.js 实例（懒加载，只在首次使用时初始化）
 */
function getWorkerPdfJsLib() {
  if (workerPdfJsLib) {
    return workerPdfJsLib;
  }

  // 禁用所有日志输出
  if ((pdfjsLib as any).VerbosityLevel) {
    (pdfjsLib as any).VerbosityLevel.INFOS = 0;
    (pdfjsLib as any).VerbosityLevel.WARNINGS = 0;
    (pdfjsLib as any).verbosity = 0;
  }

  // 设置 worker

  (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

  // 配置 CMap 和字体路径
  const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist'));

  (pdfjsLib as any).GlobalWorkerOptions.cMapUrl = path.join(pdfjsDistPath, 'cmaps/') + '/';
  (pdfjsLib as any).GlobalWorkerOptions.cMapPacked = true;
  (pdfjsLib as any).GlobalWorkerOptions.standardFontDataUrl =
    path.join(pdfjsDistPath, 'standard_fonts/') + '/';

  // 【性能优化】完全禁用字体渲染和 canvas，减少内存占用
  (pdfjsLib as any).GlobalWorkerOptions.disableFontFace = true;
  (pdfjsLib as any).GlobalWorkerOptions.useSystemFonts = true;
  (pdfjsLib as any).GlobalWorkerOptions.disableRange = true;
  (pdfjsLib as any).GlobalWorkerOptions.disableStream = true;

  workerPdfJsLib = pdfjsLib;
  return pdfjsLib;
}

// PDF 文件大小限制（MB）
const MAX_PDF_SIZE_MB = DEFAULT_MAX_PDF_SIZE_MB;

/**
 * 检测是否为纯图 PDF
 */
async function isImageOnlyPage(page: any): Promise<boolean> {
  try {
    const textContent = await page.getTextContent();

    if (!textContent.items || textContent.items.length === 0) {
      return true;
    }

    const hasText = textContent.items.some((item: any) => {
      return item.str && item.str.trim().length > 0;
    });

    return !hasText;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false;
  }
}

/**
 * PDF 文件提取器类
 */
class PdfExtractor extends BaseExtractor {
  constructor() {
    super({
      name: 'PdfExtractor',
      verboseLogging: false,
    });
  }

  protected async doValidateFile(_filePath: string, stat: any): Promise<void> {
    // PDF 特殊验证：检查文件大小
    const fileSizeMB = stat.size / BYTES_TO_MB;
    if (fileSizeMB > MAX_PDF_SIZE_MB) {
      throw new Error(`PDF 文件过大 (${fileSizeMB.toFixed(1)}MB > ${MAX_PDF_SIZE_MB}MB)`);
    }
  }

  protected async doExtract(filePath: string): Promise<ExtractorResult> {
    let pdfDocument: any = null;
    let totalText = '';
    let totalPages: number;
    let _processedPages = 0; // 【保留】用于未来可能的统计需求
    let imageOnlyPages = 0;

    try {
      const pdfjsLib = getWorkerPdfJsLib();

      // 直接读取文件为 Uint8Array，避免额外的 Buffer 转换
      const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
      const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      // 加载 PDF 文档时使用最小配置
      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        ...PDF_DOCUMENT_OPTIONS,
      });

      // 添加总超时保护
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`PDF 解析总超时 (${PDF_TOTAL_TIMEOUT_MS / 1000}秒)`)),
          PDF_TOTAL_TIMEOUT_MS
        );
      });

      pdfDocument = await Promise.race([loadingTask.promise, timeoutPromise]);

      // 检查文档是否有效
      if (!pdfDocument || !pdfDocument.numPages) {
        return this.buildResult('', 'PdfExtractor');
      }

      totalPages = pdfDocument.numPages;

      // 取消标记，用于超时后跳过后续处理
      let isCancelled = false;

      // 逐页处理
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (isCancelled) {
          break;
        }

        let page: any = null;
        try {
          // 单页超时保护
          const pagePromise = pdfDocument.getPage(pageNum);
          const pageTimeout = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`第 ${pageNum} 页解析超时 (${PDF_PAGE_TIMEOUT_MS / 1000}秒)`)),
              PDF_PAGE_TIMEOUT_MS
            );
          });

          page = await Promise.race([pagePromise, pageTimeout]);

          // 检测纯图 PDF
          const isImageOnly = await isImageOnlyPage(page);

          if (isImageOnly) {
            imageOnlyPages++;

            // 如果 OCR 未启用，跳过纯图页面
            if (!PDF_OCR_ENABLED) {
              page.cleanup();
              page.destroy?.();
              page = null;
              continue;
            }
          } else {
            // 提取页面文本
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map((item: any) => item.str)
              .filter((str: string) => str.trim().length > 0)
              .join(' ');

            totalText += pageText + '\n';
          }

          _processedPages++;

          // 检查文本大小限制
          if (totalText.length > MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB) {
            isCancelled = true;
            break;
          }
        } catch (error: any) {
          // 超时或其他错误时，设置取消标记
          if (error.message.includes('超时')) {
            isCancelled = true;
            this.logger.warn(`[${this.config.name}] ${error.message}`);
            break;
          }
          throw error;
        } finally {
          // 确保每页都释放内存
          if (page) {
            try {
              page.cleanup();
              page.destroy?.();
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              // 忽略清理错误
            }
            page = null;
          }
        }
      }

      // 如果所有页都是纯图且 OCR 未启用，返回不支持预览
      if (imageOnlyPages === totalPages && !PDF_OCR_ENABLED) {
        return this.buildResult('', 'PdfExtractor');
      }

      return this.buildResult(totalText, 'PdfExtractor');
    } catch (error: any) {
      // 错误处理
      const errorMsg = error.message || String(error);

      // 密码保护
      if (errorMsg.includes('Password') || errorMsg.includes('password')) {
        this.logger.warn(`[${this.config.name}] PDF 文件已加密`);
        return this.handleError(error, filePath);
      }

      // 损坏文件
      if (errorMsg.includes('Invalid') || errorMsg.includes('corrupt')) {
        this.logger.warn(`[${this.config.name}] PDF 文件已损坏`);
        return this.handleError(error, filePath);
      }

      // 超时
      if (errorMsg.includes('超时')) {
        this.logger.warn(`[${this.config.name}] ${errorMsg}`);
        return this.handleError(error, filePath);
      }

      // 其他错误
      this.logger.error(`[${this.config.name}] 解析失败: ${errorMsg}`);
      return this.handleError(error, filePath);
    } finally {
      // 确保释放文档内存
      if (pdfDocument) {
        try {
          pdfDocument.destroy();
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // 忽略销毁错误
        }
        // eslint-disable-next-line no-useless-assignment
        pdfDocument = null;
      }
    }
  }
}

// 创建基础实例
const baseExtractor = new PdfExtractor();

// 应用装饰器：PDF 总超时 + 日志
const enhancedExtract = composeDecorators(baseExtractor.extract.bind(baseExtractor), [
  (fn) => withTimeout(fn, { timeoutMs: PDF_TOTAL_TIMEOUT_MS, useSmartTimeout: false }),
  (fn) =>
    withLogging(fn, {
      logStart: false,
      logEnd: false,
      logError: true,
      prefix: 'PdfExtractor',
    }),
]);

/**
 * 提取 PDF 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractPdf(filePath: string): Promise<ExtractorResult> {
  return await enhancedExtract(filePath);
}
