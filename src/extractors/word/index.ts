/**
 * Word 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractWithWordExtractor } from './word-extractor';

// 定义配置并自动注册
const WORD_CONFIG = {
  extensions: ['doc', 'docx', 'wps'],
  fileType: 'word' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractWithWordExtractor,
  description: 'Word 文档（使用 word-extractor 解析）',
};

registerExtractor(WORD_CONFIG);

// 导出提取器函数
export { extractWithWordExtractor };

// 导出路径常量
export const WORD_EXTRACTOR_PATH = __filename;
