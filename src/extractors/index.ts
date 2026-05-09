/**
 * 文件提取器索引 - 统一导出所有提取器
 */

export type {ExtractorResult, ExtractorFunction} from './types';

// 文本文件提取器
export {extractTextFile} from './text-extractor';

// XML 文件提取器
export {extractXmlFile} from './xml-extractor';

// PDF 文件提取器
export {extractPdf} from './pdf-extractor';

// Word 文档提取器
export {extractWithWordExtractor} from './word-extractor';

// Excel 表格提取器
export {extractWithSheetJS} from './excel-extractor';
export {extractWithExcelJS} from './excel-streaming-extractor';  // 【新增】exceljs 流式解析器

// PowerPoint 提取器
export {extractPptx} from './ppt-extractor';

// 二进制文件提取器
export {extractWithBinary, extractTextFromBinary} from './binary-extractor';

// OpenDocument 提取器
export {extractOdt, extractOds, extractOdp} from './opendocument-extractor';

// RTF 富文本提取器
export {extractRtf} from './rtf-extractor';

export {extractTextFromFile} from './file-parser';