/**
 * 文件类型配置工具
 * 
 * 【重构】使用提取器注册中心，不再静态导入所有提取器
 */

import * as path from 'path';
import { FILE_SIZE_LIMITS } from '../core/config/constants';
import { 
    getExtractorByExtension,
    getAllSupportedExtensions
} from '../extractors/registry';
import type { FileTypeConfig } from '../extractors/types';
import { FileProcessorType } from '../extractors/types';

/**
 * 处理器类型枚举（重新导出，保持向后兼容）
 */
export { FileProcessorType } from '../extractors/types';

/**
 * 文件类型配置接口（重新导出，保持向后兼容）
 */
export type { FileTypeConfig } from '../extractors/types';

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
    return {
        defaultMaxSizeMB: FILE_SIZE_LIMITS.defaultMaxSizeMB,
        pdfMaxSizeMB: FILE_SIZE_LIMITS.pdfMaxSizeMB,
        maxTextContentSizeMB: FILE_SIZE_LIMITS.maxTextContentSizeMB
    };
}

/**
 * 根据文件扩展名获取配置
 */
export function getFileTypeConfig(filePath: string): FileTypeConfig | null {
    const ext = path.extname(filePath).toLowerCase().substring(1);
    return getExtractorByExtension(ext);
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
 * 根据文件路径获取解析器函数
 */
export function getFileExtractor(filePath: string): ((filePath: string) => Promise<{
    text: string;
    unsupportedPreview: boolean
}>) | null {
    const config = getFileTypeConfig(filePath);
    return config?.extractor || null;
}

/**
 * 根据文件路径获取文件类型标识（用于智能调度）
 */
export function getFileType(filePath: string): string {
    const config = getFileTypeConfig(filePath);
    return config?.fileType || 'other';
}

/**
 * 从注册中心自动生成支持的文件扩展名列表
 */
export const SUPPORTED_EXTENSIONS = getAllSupportedExtensions();
