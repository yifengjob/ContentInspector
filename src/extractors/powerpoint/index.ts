/**
 * PowerPoint 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractPptx } from './ppt-extractor';

// 现代 PowerPoint 格式（pptx, dps）
const PPTX_CONFIG = {
  extensions: ['pptx', 'dps'],
  fileType: 'powerpoint' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractPptx,
  description: 'PowerPoint 演示文稿（解压 + XML 解析）',
};

registerExtractor(PPTX_CONFIG);

// 旧版 PowerPoint 格式（ppt）
const PPT_CONFIG = {
  extensions: ['ppt'],
  fileType: 'powerpoint' as const,
  processor: FileProcessorType.BINARY_SCAN,
  supportsStreaming: false,
  extractor: async () => ({ text: '', unsupportedPreview: true }), // 占位，实际使用 binary
  description: '旧版 PowerPoint（仅二进制扫描）',
};

registerExtractor(PPT_CONFIG);

// 导出提取器函数
export { extractPptx };

// 导出路径常量
export const POWERPOINT_EXTRACTOR_PATH = __filename;
