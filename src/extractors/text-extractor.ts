/**
 * 文本文件提取器 - 流式读取纯文本文件
 * 支持: txt, log, md, csv, json, yaml, 源代码文件等
 */

import {createReadStream} from 'fs';
import {MAX_TEXT_CONTENT_SIZE_MB, BYTES_TO_MB} from '../core/config/constants';
import type {ExtractorResult} from './types';
import {BaseExtractor} from './base-extractor';
import {withTimeout, withLogging, composeDecorators} from './extractor-decorators';

/**
 * 文本文件提取器类
 */
class TextExtractor extends BaseExtractor {
    private isCancelled: boolean = false;

    constructor() {
        super({ 
            name: 'TextExtractor',
            verboseLogging: false
        });
    }

    /**
     * 取消当前解析操作
     */
    public cancel(): void {
        this.isCancelled = true;
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        return new Promise((resolve) => {
            const textChunks: string[] = [];
            let totalSize = 0;
            const maxSizeBytes = MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB;
            this.isCancelled = false;  // 重置取消标志

            const stream = createReadStream(filePath, {
                encoding: 'utf-8',
                highWaterMark: 64 * 1024
            });

            stream.on('data', (chunk: string | Buffer) => {
                // ✅ 检查取消标志
                if (this.isCancelled) {
                    stream.destroy();
                    this.logger.warn(`[${this.config.name}] 解析被取消`);
                    resolve({text: '', unsupportedPreview: true});
                    return;
                }

                const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
                totalSize += Buffer.byteLength(chunkStr, 'utf-8');

                // 检查是否超过大小限制
                if (totalSize > maxSizeBytes) {
                    stream.destroy();
                    this.logger.warn(`[${this.config.name}] 文件内容过大 (${(totalSize / BYTES_TO_MB).toFixed(1)}MB)`);
                    resolve(this.buildResult('', 'TextExtractor'));
                    return;
                }

                textChunks.push(chunkStr);
            });

            stream.on('end', () => {
                // ✅ 检查取消标志
                if (!this.isCancelled) {
                    const text = textChunks.join('');
                    resolve(this.buildResult(text, 'TextExtractor'));
                }
            });

            stream.on('error', (error: any) => {
                // ✅ 检查取消标志
                if (!this.isCancelled) {
                    this.logger.error(`[${this.config.name}] 流读取错误: ${error.message}`);
                    resolve(this.handleError(error, filePath));
                }
            });
        });
    }
}

// 导出单例实例
const extractor = new TextExtractor();

// 应用装饰器：智能超时 + 日志
const enhancedExtract = composeDecorators(
    extractor.extract.bind(extractor),
    [
        (fn) => withTimeout(fn),  // 智能超时（基于文件大小）
        (fn) => withLogging(fn, { logError: true, prefix: 'TextExtractor' })
    ]
);

/**
 * 提取文本文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractTextFile(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
