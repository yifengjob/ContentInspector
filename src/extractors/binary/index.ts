/**
 * 二进制文件提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractWithBinary, extractTextFromBinary } from './binary-extractor';

// 定义配置并自动注册
const BINARY_CONFIG = {
  extensions: ['bin', 'exe', 'dll', 'so', 'dylib'],
  fileType: 'other' as const,
  processor: FileProcessorType.BINARY_SCAN,
  supportsStreaming: false,
  extractor: extractWithBinary,
  description: '二进制文件（仅二进制扫描）',
};

registerExtractor(BINARY_CONFIG);

// 导出提取器函数
export { extractWithBinary, extractTextFromBinary };

// 导出路径常量
export const BINARY_EXTRACTOR_PATH = __filename;
