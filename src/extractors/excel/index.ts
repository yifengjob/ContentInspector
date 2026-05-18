/**
 * Excel 提取器模块
 */

import { registerExtractor } from '../registry';
import { FileProcessorType } from '../types';
import { extractWithSheetJS } from './excel-extractor';
import { extractWithExcelJS } from './excel-streaming-extractor';

// 现代 Excel 格式配置（xlsx, et）
const EXCEL_MODERN_CONFIG = {
  extensions: ['xlsx', 'et'],
  fileType: 'excel' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractWithExcelJS,
  description: 'Excel 表格（使用 exceljs 流式解析，内存效率高）',
};

registerExtractor(EXCEL_MODERN_CONFIG);

// 旧版 Excel 格式配置（xls）
const EXCEL_LEGACY_CONFIG = {
  extensions: ['xls'],
  fileType: 'excel' as const,
  processor: FileProcessorType.PARSER_REQUIRED,
  supportsStreaming: false,
  extractor: extractWithSheetJS,
  description: 'Excel 97-2003 表格（使用 SheetJS 解析）',
};

registerExtractor(EXCEL_LEGACY_CONFIG);

// 导出提取器函数
export { extractWithSheetJS, extractWithExcelJS };

// 导出路径常量
export const EXCEL_EXTRACTOR_PATH = __filename;
