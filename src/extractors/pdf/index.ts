/**
 * PDF 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractPdf } from './pdf-extractor';
import { FILE_SIZE_LIMITS } from '../../core/config/constants';

// 定义配置并自动注册
const PDF_CONFIG = {
  extensions: ['pdf'],
  fileType: 'pdf' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  maxSizeMB: FILE_SIZE_LIMITS.pdfMaxSizeMB,
  supportsStreaming: false,
  extractor: extractPdf,
  description: 'PDF 文件（使用 pdf.js 逐页解析，支持纯图检测）',
};

registerExtractor(PDF_CONFIG);

// 导出提取器函数
export { extractPdf };

// 导出路径常量（用于动态加载）
export const PDF_EXTRACTOR_PATH = __filename;
