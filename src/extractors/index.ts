/**
 * 文件提取器索引 - 统一导出所有提取器
 * 
 * 【重要】导入所有子模块以触发自动注册
 */

// 类型定义
export type {ExtractorResult, ExtractorFunction} from './types';
export type { FileTypeConfig } from './types';
export { FileProcessorType } from './types';

// 注册中心
export { 
    registerExtractor,
    getExtractorByExtension,
    getAllConfigs,
    getAllSupportedExtensions,
    getRegistryStats
} from './registry';

// 【关键】导入所有子模块以触发自动注册
import './pdf';
import './excel';
import './word';
import './text';
import './xml';
import './powerpoint';
import './opendocument';
import './rtf';
import './binary';

// 文本文件提取器
export {extractTextFile} from './text/text-extractor';

// XML 文件提取器
export {extractXmlFile} from './xml/xml-extractor';

// PDF 文件提取器
export {extractPdf} from './pdf/pdf-extractor';

// Word 文档提取器
export {extractWithWordExtractor} from './word/word-extractor';

// Excel 表格提取器
export {extractWithSheetJS} from './excel/excel-extractor';
export {extractWithExcelJS} from './excel/excel-streaming-extractor';

// PowerPoint 提取器
export {extractPptx} from './powerpoint/ppt-extractor';

// 二进制文件提取器
export {extractWithBinary, extractTextFromBinary} from './binary/binary-extractor';

// OpenDocument 提取器
export {extractOdt, extractOds, extractOdp} from './opendocument/opendocument-extractor';

// RTF 富文本提取器
export {extractRtf} from './rtf/rtf-extractor';

// 文件解析器（主入口）
export {extractTextFromFile} from './file-parser';