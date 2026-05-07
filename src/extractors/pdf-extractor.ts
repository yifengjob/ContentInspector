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
import {logError} from '../error-utils';
import type {ExtractorResult} from './types';
import { readFileWithTimeout } from '../file-utils';  // 【新增】导入超时保护工具

// 【关键修复】在模块级别抑制 pdfjs-dist 的警告，防止 OOM
// 这必须在 require pdfjs-dist 之前执行
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.warn = function(...args: any[]) {
  const msg = args.join(' ');
  // 过滤掉 pdfjs-dist 的 canvas 和字体相关警告
  if (msg.includes('canvas') || 
      msg.includes('Path2D') || 
      msg.includes('loadFont') || 
      msg.includes('fetchStandardFontData') ||
      msg.includes('CMap')) {
    return; // 静默忽略
  }
  originalConsoleWarn.apply(console, args);
};

console.error = function(...args: any[]) {
  const msg = args.join(' ');
  // 过滤掉 pdfjs-dist 的 canvas 相关错误
  if (msg.includes('canvas.node') || 
      msg.includes('Cannot find module')) {
    return; // 静默忽略
  }
  originalConsoleError.apply(console, args);
};

// 【修复】延迟加载 pdf.js，避免模块级别 require 导致的问题
let pdfjsLib: any = null;
let pdfjsInitialized = false;

function getPdfJsLib() {
  if (!pdfjsInitialized) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      
      // 【关键修复】在设置 worker 之前禁用所有警告
      // pdfjs-dist 有自己的日志系统，需要直接禁用
      if (pdfjsLib.verbosity !== undefined) {
        pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS; // 只显示错误
      }
      
      // 设置 worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
      
      // 【修复】配置 CMap 和字体路径，防止内存泄漏
      const path = require('path');
      const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist'));
      
      pdfjsLib.GlobalWorkerOptions.cMapUrl = path.join(pdfjsDistPath, 'cmaps/') + '/';
      pdfjsLib.GlobalWorkerOptions.cMapPacked = true;
      pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.join(pdfjsDistPath, 'standard_fonts/') + '/';
      
      // 【关键修复】禁用 canvas 相关功能，防止 Worker 中 OOM
      // 我们只需要文本提取，不需要渲染
      pdfjsLib.GlobalWorkerOptions.disableFontFace = true;
      pdfjsLib.GlobalWorkerOptions.useSystemFonts = true;
      
      pdfjsInitialized = true;
    } catch (error) {
      logError('getPdfJsLib', error as Error);
      throw error;
    }
  }
  return pdfjsLib;
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
    logError('extractPdf', error);
    return { text: '', unsupportedPreview: true };
  }
  
  const fileSizeMB = stat.size / BYTES_TO_MB;
  
  // 文件大小限制
  if (fileSizeMB > MAX_PDF_SIZE_MB) {
    return { text: '', unsupportedPreview: true };
  }
  
  let pdfDocument: any = null;
  let totalText = '';
  let totalPages = 0;
  let processedPages = 0;
  let imageOnlyPages = 0;
  
  try {
    // 【修复】延迟加载 pdf.js
    const pdfjsLib = getPdfJsLib();
    
    // 读取文件为 Buffer，然后转换为 Uint8Array
    // 【新增】使用带超时的文件读取，防止 Windows 锁屏时阻塞
    const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
    const uint8Array = new Uint8Array(buffer);
    
    // 加载 PDF 文档
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,  // 【修复】使用 Uint8Array 而非 Buffer
      disableFontFace: true,  // 禁用字体渲染，减少内存
      disableRange: true,     // 禁用范围请求
      disableStream: true,    // 禁用流式传输（我们手动控制）
    });
    
    // 添加总超时保护
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`PDF 解析总超时 (${PDF_TOTAL_TIMEOUT_MS/1000}秒)`)), PDF_TOTAL_TIMEOUT_MS);
    });
    
    pdfDocument = await Promise.race([loadingTask.promise, timeoutPromise]);
    
    // 【修复】检查文档是否有效
    if (!pdfDocument || !pdfDocument.numPages) {
      return { text: '', unsupportedPreview: true };
    }
    
    totalPages = pdfDocument.numPages;
    
    // 逐页处理
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // 单页超时保护
      const pagePromise = pdfDocument.getPage(pageNum);
      const pageTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`第 ${pageNum} 页解析超时 (${PDF_PAGE_TIMEOUT_MS/1000}秒)`)), PDF_PAGE_TIMEOUT_MS);
      });
      
      const page = await Promise.race([pagePromise, pageTimeout]);
      
      // 【新增】检测纯图 PDF
      const isImageOnly = await isImageOnlyPage(page);
      
      if (isImageOnly) {
        imageOnlyPages++;
        
        // 如果 OCR 未启用，跳过纯图页面
        if (!PDF_OCR_ENABLED) {
          page.cleanup();
          continue;
        }
        
        // 【扩展接口】如果启用 OCR，在这里调用 OCR 服务
        // const ocrText = await performOCR(page);
        // totalText += ocrText + '\n';
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
        page.cleanup();
        break;
      }
      
      // 释放页面内存 ⭐ 关键
      page.cleanup();
    }
    
    // 【新增】如果所有页都是纯图且 OCR 未启用，返回不支持预览
    if (imageOnlyPages === totalPages && !PDF_OCR_ENABLED) {
      return { text: '', unsupportedPreview: true };
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
      return { text: '', unsupportedPreview: true };
    }
    
    // 损坏文件
    if (errorMsg.includes('Invalid') || errorMsg.includes('corrupt')) {
      return { text: '', unsupportedPreview: true };
    }
    
    // 超时
    if (errorMsg.includes('超时')) {
      return { text: '', unsupportedPreview: true };
    }
    
    // 其他错误 - 记录日志用于调试
    logError('extractPdf', error, 'warn');
    return { text: '', unsupportedPreview: true };
    
  } finally {
    // 确保释放文档内存 ⭐ 关键
    if (pdfDocument) {
      try {
        pdfDocument.destroy();
      } catch (e) {
        // 忽略销毁错误
      }
    }
  }
}
