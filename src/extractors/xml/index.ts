/**
 * XML 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractXmlFile } from './xml-extractor';

// 定义配置并自动注册
const XML_CONFIG = {
    extensions: ['xml'],
    fileType: 'markup' as const,
    processor: FileProcessorType.STREAMING_TEXT,
    supportsStreaming: true,
    extractor: extractXmlFile,
    description: 'XML 文件（使用 sax 流式解析）'
};

registerExtractor(XML_CONFIG);

// 导出提取器函数
export { extractXmlFile };

// 导出路径常量
export const XML_EXTRACTOR_PATH = __filename;
