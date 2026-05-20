/**
 * OFD 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractOfd } from './ofd-extractor';

// OFD 配置
const OFD_CONFIG = {
  extensions: ['ofd'],
  fileType: 'ofd' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractOfd,
  description: 'OFD 版式文档（解压 + XML 解析）',
  maxSizeMB: 50, // OFD 文件通常较小，设置 50MB 限制
};

registerExtractor(OFD_CONFIG);

// 导出提取器函数
export { extractOfd };

// 导出路径常量
export const OFD_EXTRACTOR_PATH = __filename;
