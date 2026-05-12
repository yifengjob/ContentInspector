/**
 * 解析器通用工具模块
 * 
 * 职责：
 * - 提供统一的超时保护机制
 * - 提供统一的错误处理
 * - 提供统一的文件大小检查
 * - 减少解析器之间的代码重复
 */

import * as fs from 'fs';
import {createReadStream} from 'fs';
import {calculateParserTimeout, MAX_TEXT_CONTENT_SIZE_MB, BYTES_TO_MB} from '../core/scan-config';
import {convertNodeError} from '../utils/error-utils';
import {extractorLogger} from '../logger/logger';
import type {ExtractorResult} from './types';

/**
 * 流式读取配置接口
 */
export interface StreamReadOptions {
    /** 文件路径 */
    filePath: string;
    /** 数据块处理回调 */
    onData: (chunk: string | Buffer, totalSize: number) => void | boolean;
    /** 结束回调 */
    onEnd: () => void;
    /** 错误回调 */
    onError?: (error: Error) => void;
    /** 编码（默认 utf-8） */
    encoding?: string;
    /** 高水位标记（默认 64KB） */
    highWaterMark?: number;
    /** 日志前缀 */
    logPrefix?: string;
}

/**
 * 【通用】带超时保护的流式文件读取
 * 
 * 使用示例：
 * ```typescript
 * return streamReadWithTimeout({
 *     filePath,
 *     onData: (chunk, totalSize) => {
 *         // 处理数据块
 *         if (totalSize > maxSize) {
 *             return false; // 返回 false 停止读取
 *         }
 *     },
 *     onEnd: () => {
 *         // 处理完成
 *         resolve({text: result, unsupportedPreview: false});
 *     },
 *     onError: (error) => {
 *         reject(error);
 *     },
 *     logPrefix: 'MyExtractor'
 * });
 * ```
 * 
 * @param options 读取配置
 * @returns Promise<ExtractorResult>
 */
export function streamReadWithTimeout(options: StreamReadOptions): Promise<ExtractorResult> {
    const {
        filePath,
        onData,
        onEnd,
        onError,
        encoding = 'utf-8',
        highWaterMark = 64 * 1024,
        logPrefix = 'StreamRead'
    } = options;

    let isResolved = false;

    // 获取文件大小并计算智能超时
    return fs.promises.stat(filePath)
        .then(stat => {
            const timeoutMs = calculateParserTimeout(stat.size);

            return new Promise<ExtractorResult>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        stream.destroy();
                        extractorLogger.warn(`${logPrefix}: 读取超时 (${timeoutMs / 1000}秒)`);
                        resolve({text: '', unsupportedPreview: true});
                    }
                }, timeoutMs);

                const stream = createReadStream(filePath, {
                    encoding: encoding as BufferEncoding,
                    highWaterMark
                });

                let totalSize = 0;

                stream.on('data', (chunk: string | Buffer) => {
                    if (isResolved) return;

                    const shouldContinue = onData(chunk, totalSize);
                    
                    // 如果回调返回 false，停止读取
                    if (shouldContinue === false) {
                        stream.destroy();
                        clearTimeout(timeoutId);
                        if (!isResolved) {
                            isResolved = true;
                            resolve({text: '', unsupportedPreview: true});
                        }
                    }
                });

                stream.on('end', () => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);
                        try {
                            onEnd();
                        } catch (error: any) {
                            extractorLogger.error(`${logPrefix}: ${error.message}`);
                            resolve({text: '', unsupportedPreview: true});
                        }
                    }
                });

                stream.on('error', (error: any) => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);
                        
                        if (onError) {
                            onError(convertNodeError(error, filePath, `${logPrefix} 失败`));
                        } else {
                            extractorLogger.error(`${logPrefix}: ${error.message}`);
                            reject(convertNodeError(error, filePath, `${logPrefix} 失败`));
                        }
                    }
                });
            });
        })
        .catch((error: any) => {
            extractorLogger.error(`${logPrefix}: ${error.message}`);
            return {text: '', unsupportedPreview: true};
        });
}

/**
 * 【通用】构建提取结果
 * 
 * @param text 提取的文本内容
 * @param logPrefix 日志前缀
 * @returns ExtractorResult
 */
export function buildExtractorResult(text: string, logPrefix: string = 'Extractor'): ExtractorResult {
    const hasContent = text && text.trim().length > 0;
    
    if (!hasContent) {
        extractorLogger.debug(`${logPrefix}: 未提取到有效内容`);
    }
    
    return {
        text: hasContent ? text : '',
        unsupportedPreview: !hasContent
    };
}

/**
 * 【通用】检查文件大小是否超过限制
 * 
 * @param filePath 文件路径
 * @param maxSizeMB 最大文件大小（MB）
 * @param logPrefix 日志前缀
 * @returns 如果超过限制返回 true
 */
export async function checkFileSizeLimit(
    filePath: string,
    maxSizeMB: number,
    logPrefix: string = 'FileSizeCheck'
): Promise<boolean> {
    try {
        const stat = await fs.promises.stat(filePath);
        const sizeMB = stat.size / BYTES_TO_MB;
        
        if (sizeMB > maxSizeMB) {
            extractorLogger.warn(`${logPrefix}: 文件过大 (${sizeMB.toFixed(1)}MB > ${maxSizeMB}MB)`);
            return true;
        }
        
        return false;
    } catch (error: any) {
        extractorLogger.error(`${logPrefix}: ${error.message}`);
        return true; // 出错时视为超限
    }
}
