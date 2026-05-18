/**
 * 文本文件提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractTextFile } from './text-extractor';

// 纯文本文件配置
const TEXT_PLAIN_CONFIG = {
  extensions: ['txt', 'log', 'md', 'ini', 'conf', 'cfg', 'env'],
  fileType: 'text' as const,
  processor: FileProcessorType.STREAMING_TEXT,
  supportsStreaming: true,
  extractor: extractTextFile,
  description: '纯文本文件',
};

registerExtractor(TEXT_PLAIN_CONFIG);

// 源代码文件配置
const TEXT_SOURCE_CONFIG = {
  extensions: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'php', 'rb', 'swift'],
  fileType: 'text' as const,
  processor: FileProcessorType.STREAMING_TEXT,
  supportsStreaming: true,
  extractor: extractTextFile,
  description: '源代码文件',
};

registerExtractor(TEXT_SOURCE_CONFIG);

// 标记语言和配置文件
const TEXT_MARKUP_CONFIG = {
  extensions: [
    'html',
    'htm',
    'sh',
    'cmd',
    'bat',
    'csv',
    'json',
    'yaml',
    'yml',
    'properties',
    'toml',
  ],
  fileType: 'markup' as const,
  processor: FileProcessorType.STREAMING_TEXT,
  supportsStreaming: true,
  extractor: extractTextFile,
  description: '标记语言和配置文件',
};

registerExtractor(TEXT_MARKUP_CONFIG);

// 导出提取器函数
export { extractTextFile };

// 导出路径常量
export const TEXT_EXTRACTOR_PATH = __filename;
