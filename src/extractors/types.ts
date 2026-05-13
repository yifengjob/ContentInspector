/**
 * 提取器通用类型定义
 */

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

    /** 文件类型标识（用于智能调度分组） */
    fileType: 'text' | 'markup' | 'pdf' | 'word' | 'excel' | 'powerpoint' | 'opendocument' | 'rtf' | 'compress' | 'other';

    /** 处理器类型 */
    processor: FileProcessorType;

    /** 最大文件大小（MB），可选，未设置则使用全局默认值 */
    maxSizeMB?: number;

    /** 是否支持真正的流式处理（无需预先解析） */
    supportsStreaming: boolean;

    /** 描述信息（用于日志和调试） */
    description?: string;

    /** 解析器函数引用 */
    extractor?: (filePath: string) => Promise<{ text: string; unsupportedPreview: boolean }>;
}

export type ExtractorResult = {
  text: string;
  unsupportedPreview: boolean;
};

export type ExtractorFunction = (filePath: string) => Promise<ExtractorResult>;
