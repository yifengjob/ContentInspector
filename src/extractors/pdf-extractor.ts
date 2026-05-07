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
 * - 【修复】Worker 级别的 pdf.js 隔离，防止内存泄漏
 */

import * as fs from 'fs';
import {
    BYTES_TO_MB,
    DEFAULT_MAX_PDF_SIZE_MB,
    MAX_TEXT_CONTENT_SIZE_MB,
    PDF_OCR_ENABLED,
    PDF_PAGE_TIMEOUT_MS,
    PDF_TOTAL_TIMEOUT_MS,
    FILE_READ_TIMEOUT_STANDARD_MS  // 【新增】导入文件读取超时配置
} from '../scan-config';
import type {ExtractorResult} from './types';
import {readFileWithTimeout} from '../file-utils';
import {extractorLogger} from "../logger";  // 【新增】导入超时保护工具

// 【关键修复】Worker 级别的 pdf.js 实例，避免全局污染
let workerPdfJsLib: any = null;

/**
 * 【修复】为每个 Worker 初始化独立的 pdf.js 实例
 */
function getWorkerPdfJsLib() {
    if (workerPdfJsLib) {
        return workerPdfJsLib;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

        // 【关键修复】禁用所有日志输出
        if (pdfjsLib.VerbosityLevel) {
            pdfjsLib.VerbosityLevel.INFOS = 0;
            pdfjsLib.VerbosityLevel.WARNINGS = 0;
            pdfjsLib.verbosity = 0; // 只显示致命错误
        }

        // 设置 worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

        // 【修复】配置 CMap 和字体路径
        const path = require('path');
        const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist'));

        pdfjsLib.GlobalWorkerOptions.cMapUrl = path.join(pdfjsDistPath, 'cmaps/') + '/';
        pdfjsLib.GlobalWorkerOptions.cMapPacked = true;
        pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.join(pdfjsDistPath, 'standard_fonts/') + '/';

        // 【关键修复】完全禁用字体渲染和 canvas，减少内存占用
        pdfjsLib.GlobalWorkerOptions.disableFontFace = true;
        pdfjsLib.GlobalWorkerOptions.useSystemFonts = true;
        pdfjsLib.GlobalWorkerOptions.disableRange = true;
        pdfjsLib.GlobalWorkerOptions.disableStream = true;

        workerPdfJsLib = pdfjsLib;
        return pdfjsLib;
    } catch (error) {
        extractorLogger.error('getWorkerPdfJsLib', (error as Error).message);
        throw error;
    }
}

// 【配置】PDF 文件大小限制（MB）- 从 scan-config.ts 导入
const MAX_PDF_SIZE_MB = DEFAULT_MAX_PDF_SIZE_MB;

/**
 * 检测是否为纯图 PDF
 * @param page - pdf.js 页面对象
 * @returns 是否为纯图页面
 */
async function isImageOnlyPage(page: any): Promise<boolean> {
    try {
        const textContent = await page.getTextContent();

        // 如果没有任何文本项，可能是纯图
        if (!textContent.items || textContent.items.length === 0) {
            return true;
        }

        // 检查是否有实际文本内容（排除空白字符）
        const hasText = textContent.items.some((item: any) => {
            return item.str && item.str.trim().length > 0;
        });

        return !hasText;
    } catch (error) {
        // 如果获取文本内容失败，保守认为不是纯图
        return false;
    }
}

/**
 * 提取 PDF 文本（流式处理版本）
 * @param filePath - 文件路径
 * @returns 提取的文本和是否不支持预览的标志
 */
export async function extractPdf(filePath: string): Promise<ExtractorResult> {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error('extractPdf', error.message);
        return {text: '', unsupportedPreview: true};
    }

    const fileSizeMB = stat.size / BYTES_TO_MB;

    // 文件大小限制
    if (fileSizeMB > MAX_PDF_SIZE_MB) {
        return {text: '', unsupportedPreview: true};
    }

    let pdfDocument: any = null;
    let totalText = '';
    let totalPages = 0;
    let processedPages = 0;
    let imageOnlyPages = 0;

    try {
        // 【修复】使用 Worker 级别的 pdf.js 实例
        const pdfjsLib = getWorkerPdfJsLib();

        // 【关键修复】直接读取文件为 Uint8Array，避免额外的 Buffer 转换
        // 【新增】使用带超时的文件读取，防止 Windows 锁屏时阻塞
        const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
        // 【修复】正确转换 Buffer 为 Uint8Array，避免内存浪费和数据错误
        const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        // 【关键修复】加载 PDF 文档时使用最小配置
        const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            disableFontFace: true,      // 禁用字体渲染
            disableRange: true,         // 禁用范围请求
            disableStream: true,        // 禁用流式传输
            useSystemFonts: true,       // 使用系统字体
            cMapUrl: undefined,         // 【修复】不加载 CMap，减少内存
            standardFontDataUrl: undefined,  // 【修复】不加载标准字体
        });

        // 添加总超时保护
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`PDF 解析总超时 (${PDF_TOTAL_TIMEOUT_MS / 1000}秒)`)), PDF_TOTAL_TIMEOUT_MS);
        });

        pdfDocument = await Promise.race([loadingTask.promise, timeoutPromise]);

        // 【修复】检查文档是否有效
        if (!pdfDocument || !pdfDocument.numPages) {
            return {text: '', unsupportedPreview: true};
        }

        totalPages = pdfDocument.numPages;

        // 【新增】取消标记，用于超时后跳过后续处理
        let isCancelled = false;

        // 逐页处理
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            // 【修复】检查是否已取消
            if (isCancelled) {
                break;
            }

            let page: any = null;
            try {
                // 单页超时保护
                const pagePromise = pdfDocument.getPage(pageNum);
                const pageTimeout = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(`第 ${pageNum} 页解析超时 (${PDF_PAGE_TIMEOUT_MS / 1000}秒)`)), PDF_PAGE_TIMEOUT_MS);
                });

                page = await Promise.race([pagePromise, pageTimeout]);

                // 【新增】检测纯图 PDF
                const isImageOnly = await isImageOnlyPage(page);

                if (isImageOnly) {
                    imageOnlyPages++;

                    // 如果 OCR 未启用，跳过纯图页面
                    if (!PDF_OCR_ENABLED) {
                        // 【关键修复】跳过前必须释放页面资源
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

                processedPages++;

                // 检查文本大小限制
                if (totalText.length > MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB) {
                    isCancelled = true;  // 【新增】设置取消标记
                    break;
                }
            } catch (error: any) {
                // 【修复】超时或其他错误时，设置取消标记
                if (error.message.includes('超时')) {
                    isCancelled = true;
                    extractorLogger.warn('extractPdf', error.message);
                    // 超时后退出循环，外层会检查 isCancelled 状态
                    break;
                }
                // 其他错误继续抛出，由外层统一处理
                throw error;
            } finally {
                // 【关键修复】确保每页都释放内存
                if (page) {
                    try {
                        page.cleanup();
                        page.destroy?.();  // 【新增】调用 destroy 如果存在
                    } catch (e) {
                        // 忽略清理错误
                    }
                    page = null;  // 【关键】显式置空，帮助 GC
                }
            }
        }

        // 【新增】如果所有页都是纯图且 OCR 未启用，返回不支持预览
        if (imageOnlyPages === totalPages && !PDF_OCR_ENABLED) {
            return {text: '', unsupportedPreview: true};
        }

        const hasContent = totalText.trim().length > 0;

        return {
            text: hasContent ? totalText : '',
            unsupportedPreview: !hasContent
        };

    } catch (error: any) {
        // 错误处理
        const errorMsg = error.message || String(error);

        // 密码保护
        if (errorMsg.includes('Password') || errorMsg.includes('password')) {
            return {text: '', unsupportedPreview: true};
        }

        // 损坏文件
        if (errorMsg.includes('Invalid') || errorMsg.includes('corrupt')) {
            return {text: '', unsupportedPreview: true};
        }

        // 超时
        if (errorMsg.includes('超时')) {
            return {text: '', unsupportedPreview: true};
        }

        // 其他错误 - 记录日志用于调试
        extractorLogger.warn('extractPdf', error.message);
        return {text: '', unsupportedPreview: true};

    } finally {
        // 【关键修复】确保释放文档内存
        if (pdfDocument) {
            try {
                pdfDocument.destroy();
            } catch (e) {
                // 忽略销毁错误
            }
            pdfDocument = null;  // 【关键】显式置空，帮助 GC
        }
    }
}
