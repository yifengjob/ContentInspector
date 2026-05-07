/**
 * 文件类型配置接口
 * 用于智能路由策略，根据文件类型选择正确的处理方式
 */

import * as path from 'path';
// 【修复】导入文件大小限制常量
import {FILE_SIZE_LIMITS} from './scan-config';
// 【重构】导入所有提取器函数
import {
    extractTextFile,
    extractXmlFile,
    extractWithWordExtractor,
    extractWithSheetJS,
    extractWithExcelJS,  // 【新增】exceljs 流式解析器
    extractPptx,
    extractWithBinary,
    extractOdt,
    extractOds,
    extractOdp,
    extractRtf,
    extractPdf
} from './extractors';

// 【新增】导入简单 PDF 提取器

/**
 * 处理器类型枚举
 */
export enum FileProcessorType {
    /** 流式文本处理：直接通过 createReadStream 读取（适用于纯文本文件） */
    STREAMING_TEXT = 'streaming_text',

    /** 需要解析器：先用专用库提取文本，再对流式处理（适用于 PDF、Word、Excel 等） */
    PARSER_REQUIRED = 'parser_required',

    /** 二进制扫描：不支持预览，只能进行二进制敏感词扫描 */
    BINARY_SCAN = 'binary_scan'
}

/**
 * 文件类型配置接口
 */
export interface FileTypeConfig {
    /** 支持的后缀名列表（小写，不含点） */
    extensions: string[];

    /** 【新增】文件类型标识（用于智能调度分组） */
    fileType: 'text' | 'markup' | 'pdf' | 'word' | 'excel' | 'powerpoint' | "opendocument" | 'rtf' | 'compress' |'other';

    /** 处理器类型 */
    processor: FileProcessorType;

    /** 最大文件大小（MB），可选，未设置则使用全局默认值 */
    maxSizeMB?: number;

    /** 是否支持真正的流式处理（无需预先解析） */
    supportsStreaming: boolean;

    /** 描述信息（用于日志和调试） */
    description?: string;

    /** 【新增】解析器函数引用（直接从 extractors 模块导入） */
    extractor?: (filePath: string) => Promise<{ text: string; unsupportedPreview: boolean }>;
}

/**
 * 文件大小限制配置
 */
export interface FileSizeLimits {
    /** 默认最大文件大小（MB） */
    defaultMaxSizeMB: number;

    /** PDF 最大文件大小（MB） */
    pdfMaxSizeMB: number;

    /** 文本内容最大大小（MB）- 防止超大文本文件导致 OOM */
    maxTextContentSizeMB: number;
}

/**
 * 获取文件大小限制配置
 */
export function getFileSizeLimits(): FileSizeLimits {
    // 【修复】使用 scan-config.ts 中定义的常量，而不是硬编码
    return {
        defaultMaxSizeMB: FILE_SIZE_LIMITS.defaultMaxSizeMB,
        pdfMaxSizeMB: FILE_SIZE_LIMITS.pdfMaxSizeMB,
        maxTextContentSizeMB: FILE_SIZE_LIMITS.maxTextContentSizeMB
    };
}

/**
 * 文件类型配置注册表
 */
export const FILE_TYPE_REGISTRY: FileTypeConfig[] = [
    // ==================== 纯文本文件（支持真正的流式处理）====================
    {
        extensions: ['txt', 'log', 'md', 'ini', 'conf', 'cfg', 'env'],
        fileType: 'text',
        processor: FileProcessorType.STREAMING_TEXT,
        supportsStreaming: true,
        extractor: extractTextFile,
        description: '纯文本文件'
    },
    {
        extensions: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'php', 'rb', 'swift'],
        fileType: 'text',
        processor: FileProcessorType.STREAMING_TEXT,
        supportsStreaming: true,
        extractor: extractTextFile,
        description: '源代码文件'
    },
    {
        extensions: ['html', 'htm', 'sh', 'cmd', 'bat', 'csv', 'json', 'yaml', 'yml', 'properties', 'toml'],
        fileType: 'markup',
        processor: FileProcessorType.STREAMING_TEXT,
        supportsStreaming: true,
        extractor: extractTextFile,
        description: '标记语言和配置文件'
    },

    // ==================== XML 文件（支持 sax 流式解析）====================
    {
        extensions: ['xml'],
        fileType: 'markup',
        processor: FileProcessorType.STREAMING_TEXT,
        supportsStreaming: true,
        extractor: extractXmlFile,
        description: 'XML 文件（使用 sax 流式解析）'
    },

    // ==================== PDF 文件（需要先解析为文本）====================
    {
        extensions: ['pdf'],
        fileType: 'pdf',
        processor: FileProcessorType.PARSER_REQUIRED,
        maxSizeMB: FILE_SIZE_LIMITS.pdfMaxSizeMB,  // 【限制】pdf.js 性能更好，限制为 50MB
        supportsStreaming: false,
        extractor: extractPdf,
        description: 'PDF 文件（使用 pdf.js 逐页解析，支持纯图检测）'
    },

    // ==================== Word 文档（需要先解析为文本）====================
    {
        extensions: ['doc', 'docx', 'wps'],
        fileType: 'word',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,
        extractor: extractWithWordExtractor,
        description: 'Word 文档（使用 word-extractor 解析）'
    },

    // ==================== Excel 表格（需要先解析为文本）====================
    // 【优化】拆分为两个注册项，分别处理现代格式和旧格式
    {
        extensions: ['xlsx', 'et'],  // 现代 Excel 格式
        fileType: 'excel',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,  // ❌ 仍需先解析，不能直接流式读取原始文件
        extractor: extractWithExcelJS,  // 使用 exceljs 流式解析器
        description: 'Excel 表格（使用 exceljs 流式解析，内存效率高）'
    },
    {
        extensions: ['xls'],  // Excel 97-2003 旧格式，不支持流式
        fileType: 'excel',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,  // ❌ SheetJS 不支持流式
        extractor: extractWithSheetJS,
        description: 'Excel 97-2003 表格（使用 SheetJS 解析）'
    },

    // ==================== PowerPoint 演示文稿（需要先解析为文本）====================
    {
        extensions: ['pptx', 'dps'],
        fileType: 'powerpoint',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,
        extractor: extractPptx,
        description: 'PowerPoint 演示文稿（解压 + XML 解析）'
    },
    {
        extensions: ['ppt'],
        fileType: 'powerpoint',
        processor: FileProcessorType.BINARY_SCAN,
        supportsStreaming: false,
        extractor: extractWithBinary,
        description: '旧版 PowerPoint（仅二进制扫描）'
    },

    // ==================== OpenDocument 格式（需要先解析为文本）====================
    {
        extensions: ['odt'],
        fileType: 'opendocument',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,
        extractor: extractOdt,
        description: 'OpenDocument 文本（解压 + XML 解析）'
    },
    {
        extensions: ['ods'],
        fileType: 'opendocument',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,
        extractor: extractOds,
        description: 'OpenDocument 表格（解压 + XML 解析）'
    },
    {
        extensions: ['odp'],
        fileType: 'opendocument',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,
        extractor: extractOdp,
        description: 'OpenDocument 演示文稿（解压 + XML 解析）'
    },

    // ==================== RTF 富文本（需要先解析为文本）====================
    {
        extensions: ['rtf'],
        fileType: 'rtf',
        processor: FileProcessorType.PARSER_REQUIRED,
        supportsStreaming: false,
        extractor: extractRtf,
        description: 'RTF 富文本（编码转换 + 正则提取）'
    },

    // ==================== 压缩文件（不支持预览）====================
    // {
    //   extensions: ['zip', 'rar', '7z', 'tar', 'gz'],
    //   fileType: 'compress',
    //   processor: FileProcessorType.BINARY_SCAN,
    //   supportsStreaming: false,
    //   extractor: extractWithBinary,
    //   description: '压缩文件（不支持预览）'
    // }
];

/**
 * 根据文件扩展名获取配置
 */
export function getFileTypeConfig(filePath: string): FileTypeConfig | null {
    const ext = path.extname(filePath).toLowerCase().substring(1);

    for (const config of FILE_TYPE_REGISTRY) {
        if (config.extensions.includes(ext)) {
            return config;
        }
    }

    return null;
}

/**
 * 获取文件的最大大小限制（MB）
 *
 * @param filePath - 文件路径
 * @param userConfig - 用户自定义配置（可选）
 * @returns 最大文件大小（MB）
 */
export function getMaxFileSizeMB(
    filePath: string,
    userConfig?: { maxFileSizeMb?: number; maxPdfSizeMb?: number }
): number {
    const config = getFileTypeConfig(filePath);

    // 如果提供了用户配置，优先使用
    if (userConfig) {
        if (config?.extensions.includes('pdf') && userConfig.maxPdfSizeMb) {
            return userConfig.maxPdfSizeMb;
        }
        if (userConfig.maxFileSizeMb) {
            return userConfig.maxFileSizeMb;
        }
    }

    // 否则使用注册表中的配置
    if (config?.maxSizeMB) {
        return config.maxSizeMB;
    }

    // 返回默认限制
    const limits = getFileSizeLimits();
    return limits.defaultMaxSizeMB;
}

/**
 * 判断文件是否支持预览
 */
export function isPreviewSupported(filePath: string): boolean {
    const config = getFileTypeConfig(filePath);
    return config !== null && config.processor !== FileProcessorType.BINARY_SCAN;
}

/**
 * 判断文件是否支持真正的流式处理
 */
export function supportsTrueStreaming(filePath: string): boolean {
    const config = getFileTypeConfig(filePath);
    return config?.supportsStreaming || false;
}

/**
 * 【新增】根据文件路径获取解析器函数
 */
export function getFileExtractor(filePath: string): ((filePath: string) => Promise<{
    text: string;
    unsupportedPreview: boolean
}>) | null {
    const config = getFileTypeConfig(filePath);
    return config?.extractor || null;
}

/**
 * 【新增】根据文件路径获取文件类型标识（用于智能调度）
 */
export function getFileType(filePath: string): string {
    const config = getFileTypeConfig(filePath);
    return config?.fileType || 'other';
}

/**
 * 【新增】从 FILE_TYPE_REGISTRY 自动生成支持的文件扩展名列表
 */
export const SUPPORTED_EXTENSIONS = FILE_TYPE_REGISTRY.flatMap(
    config => config.extensions
);
