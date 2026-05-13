/**
 * RTF 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractRtf } from './rtf-extractor';

// 定义配置并自动注册
const RTF_CONFIG = {
    extensions: ['rtf'],
    fileType: 'rtf' as const,
    processor: FileProcessorType.PARSER_REQUIRED,
    supportsStreaming: false,
    extractor: extractRtf,
    description: 'RTF 富文本（编码转换 + 正则提取）'
};

registerExtractor(RTF_CONFIG);

// 导出提取器函数
export { extractRtf };

// 导出路径常量
export const RTF_EXTRACTOR_PATH = __filename;
