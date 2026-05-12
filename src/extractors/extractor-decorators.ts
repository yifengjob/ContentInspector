/**
 * 解析器装饰器模块
 * 
 * 职责：
 * - 提供超时装饰器
 * - 提供日志装饰器
 * - 提供缓存装饰器
 * - 提供重试装饰器
 * - 使用装饰器模式增强解析器功能
 */

import type {ExtractorResult} from './types';
import {extractorLogger} from '../logger/logger';

/**
 * 解析器函数类型
 */
export type ExtractorFunction = (filePath: string) => Promise<ExtractorResult>;

/**
 * 超时装饰器配置
 */
export interface TimeoutDecoratorConfig {
    /** 超时时间（毫秒） */
    timeoutMs: number;
    /** 超时后的默认返回值 */
    fallbackResult?: ExtractorResult;
}

/**
 * 【装饰器】添加超时保护
 * 
 * 使用示例：
 * ```typescript
 * const extractWithTimeout = withTimeout(
 *     extractTextFile,
 *     { timeoutMs: 30000 }
 * );
 * ```
 * 
 * @param extractor 原始解析器函数
 * @param config 超时配置
 * @returns 带超时保护的解析器函数
 */
export function withTimeout(
    extractor: ExtractorFunction,
    config: TimeoutDecoratorConfig
): ExtractorFunction {
    const {timeoutMs, fallbackResult = {text: '', unsupportedPreview: true}} = config;

    return async (filePath: string): Promise<ExtractorResult> => {
        let isResolved = false;

        return Promise.race([
            (async () => {
                try {
                    const result = await extractor(filePath);
                    isResolved = true;
                    return result;
                } catch (error: any) {
                    isResolved = true;
                    throw error;
                }
            })(),
            new Promise<ExtractorResult>((resolve) => {
                setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        extractorLogger.warn(`[TimeoutDecorator] 解析超时 (${timeoutMs / 1000}秒): ${filePath}`);
                        resolve(fallbackResult);
                    }
                }, timeoutMs);
            })
        ]);
    };
}

/**
 * 日志装饰器配置
 */
export interface LoggingDecoratorConfig {
    /** 是否记录开始日志 */
    logStart?: boolean;
    /** 是否记录结束日志 */
    logEnd?: boolean;
    /** 是否记录错误日志 */
    logError?: boolean;
    /** 日志前缀 */
    prefix?: string;
}

/**
 * 【装饰器】添加日志记录
 * 
 * 使用示例：
 * ```typescript
 * const extractWithLogging = withLogging(
 *     extractTextFile,
 *     { 
 *         logStart: true,
 *         logEnd: true,
 *         prefix: 'TextExtractor'
 *     }
 * );
 * ```
 * 
 * @param extractor 原始解析器函数
 * @param config 日志配置
 * @returns 带日志的解析器函数
 */
export function withLogging(
    extractor: ExtractorFunction,
    config: LoggingDecoratorConfig = {}
): ExtractorFunction {
    const {
        logStart = false,
        logEnd = false,
        logError = true,
        prefix = 'Extractor'
    } = config;

    return async (filePath: string): Promise<ExtractorResult> => {
        const startTime = Date.now();

        if (logStart) {
            extractorLogger.debug(`[${prefix}] 开始解析: ${filePath}`);
        }

        try {
            const result = await extractor(filePath);
            
            if (logEnd) {
                const duration = Date.now() - startTime;
                extractorLogger.debug(`[${prefix}] 解析完成 (${duration}ms)`);
            }
            
            return result;
        } catch (error: any) {
            if (logError) {
                const duration = Date.now() - startTime;
                extractorLogger.error(`[${prefix}] 解析失败 (${duration}ms): ${error.message}`);
            }
            throw error;
        }
    };
}

/**
 * 缓存装饰器配置
 */
export interface CacheDecoratorConfig {
    /** 最大缓存条目数 */
    maxSize?: number;
    /** 缓存 TTL（毫秒），0 表示永久缓存 */
    ttl?: number;
}

/**
 * 缓存条目接口
 */
interface CacheEntry {
    result: ExtractorResult;
    timestamp: number;
}

/**
 * 【装饰器】添加结果缓存
 * 
 * 使用示例：
 * ```typescript
 * const extractWithCache = withCache(
 *     extractTextFile,
 *     { maxSize: 100, ttl: 60000 }
 * );
 * ```
 * 
 * @param extractor 原始解析器函数
 * @param config 缓存配置
 * @returns 带缓存的解析器函数
 */
export function withCache(
    extractor: ExtractorFunction,
    config: CacheDecoratorConfig = {}
): ExtractorFunction {
    const {maxSize = 100, ttl = 0} = config;
    const cache = new Map<string, CacheEntry>();

    return async (filePath: string): Promise<ExtractorResult> => {
        // 检查缓存
        const cached = cache.get(filePath);
        if (cached) {
            // 检查 TTL
            if (ttl === 0 || Date.now() - cached.timestamp < ttl) {
                extractorLogger.debug(`[CacheDecorator] 缓存命中: ${filePath}`);
                return cached.result;
            } else {
                // 过期，删除
                cache.delete(filePath);
            }
        }

        // 执行解析
        const result = await extractor(filePath);

        // 存入缓存
        if (cache.size >= maxSize) {
            // 删除最旧的条目
            const oldestKey = cache.keys().next().value;
            if (oldestKey) {
                cache.delete(oldestKey);
            }
        }

        cache.set(filePath, {
            result,
            timestamp: Date.now()
        });

        return result;
    };
}

/**
 * 重试装饰器配置
 */
export interface RetryDecoratorConfig {
    /** 最大重试次数 */
    maxRetries?: number;
    /** 重试间隔（毫秒） */
    retryDelay?: number;
    /** 是否指数退避 */
    exponentialBackoff?: boolean;
}

/**
 * 【装饰器】添加重试机制
 * 
 * 使用示例：
 * ```typescript
 * const extractWithRetry = withRetry(
 *     extractTextFile,
 *     { maxRetries: 3, retryDelay: 1000 }
 * );
 * ```
 * 
 * @param extractor 原始解析器函数
 * @param config 重试配置
 * @returns 带重试的解析器函数
 */
export function withRetry(
    extractor: ExtractorFunction,
    config: RetryDecoratorConfig = {}
): ExtractorFunction {
    const {
        maxRetries = 3,
        retryDelay = 1000,
        exponentialBackoff = false
    } = config;

    return async (filePath: string): Promise<ExtractorResult> => {
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                return await extractor(filePath);
            } catch (error: any) {
                lastError = error;
                
                if (attempt <= maxRetries) {
                    // 计算延迟时间
                    const delay = exponentialBackoff 
                        ? retryDelay * Math.pow(2, attempt - 1)
                        : retryDelay;
                    
                    extractorLogger.warn(
                        `[RetryDecorator] 第 ${attempt} 次重试失败，${delay}ms 后重试: ${error.message}`
                    );
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // 所有重试都失败
        extractorLogger.error(`[RetryDecorator] 所有重试均失败 (${maxRetries} 次)`);
        throw lastError;
    };
}

/**
 * 【组合装饰器】同时应用多个装饰器
 * 
 * 使用示例：
 * ```typescript
 * const enhancedExtract = composeDecorators(
 *     extractTextFile,
 *     [
 *         withTimeout({ timeoutMs: 30000 }),
 *         withLogging({ logStart: true, logEnd: true }),
 *         withCache({ maxSize: 50 })
 *     ]
 * );
 * ```
 * 
 * @param extractor 原始解析器函数
 * @param decorators 装饰器数组（按顺序应用）
 * @returns 增强后的解析器函数
 */
export function composeDecorators(
    extractor: ExtractorFunction,
    decorators: Array<(fn: ExtractorFunction) => ExtractorFunction>
): ExtractorFunction {
    return decorators.reduce((enhanced, decorator) => decorator(enhanced), extractor);
}
