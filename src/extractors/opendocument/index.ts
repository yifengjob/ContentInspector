/**
 * OpenDocument 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractOdt, extractOds, extractOdp } from './opendocument-extractor';

// ODT（文本）配置
const ODT_CONFIG = {
  extensions: ['odt'],
  fileType: 'opendocument' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractOdt,
  description: 'OpenDocument 文本（解压 + XML 解析）',
};

registerExtractor(ODT_CONFIG);

// ODS（表格）配置
const ODS_CONFIG = {
  extensions: ['ods'],
  fileType: 'opendocument' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractOds,
  description: 'OpenDocument 表格（解压 + XML 解析）',
};

registerExtractor(ODS_CONFIG);

// ODP（演示文稿）配置
const ODP_CONFIG = {
  extensions: ['odp'],
  fileType: 'opendocument' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractOdp,
  description: 'OpenDocument 演示文稿（解压 + XML 解析）',
};

registerExtractor(ODP_CONFIG);

// 导出提取器函数
export { extractOdt, extractOds, extractOdp };

// 导出路径常量
export const OPENDOCUMENT_EXTRACTOR_PATH = __filename;
