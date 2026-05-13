/**
 * XML 文件提取器 - 使用 sax 流式解析
 * 支持: xml 文件
 */

import {createReadStream} from 'fs';
import * as sax from 'sax';
import {MAX_TEXT_CONTENT_SIZE_MB, BYTES_TO_MB} from '../../core/config/constants';
import type {ExtractorResult} from '../types';
import {BaseExtractor} from '../base-extractor';
import {extractTextFile} from '../text/text-extractor';
import {withTimeout, withLogging, composeDecorators} from '../extractor-decorators';

/**
 * XML 文件提取器类
 */
class XmlExtractor extends BaseExtractor {
    private isCancelled: boolean = false;
    private stream: any = null;
    private parser: any = null;

    constructor() {
        super({ 
            name: 'XmlExtractor',
            verboseLogging: false
        });
    }

    /**
     * 取消当前解析操作
     */
    public cancel(): void {
        this.isCancelled = true;
        // ✅ 立即销毁流和解析器
        if (this.stream) {
            try {
                this.stream.destroy();
            } catch (e) {
                // 忽略错误
            }
        }
        if (this.parser) {
            try {
                this.parser.destroy();
            } catch (e) {
                // 忽略错误
            }
        }
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        return new Promise((resolve) => {
            this.isCancelled = false;  // 重置取消标志

            this.stream = createReadStream(filePath, {
                highWaterMark: 64 * 1024
            });

            // 创建严格模式的 sax 解析器
            this.parser = sax.createStream(true, {trim: true});

            const textChunks: string[] = [];
            let totalTextLength = 0;
            const maxTextLength = MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB;

            // 监听文本节点事件
            this.parser.on('text', (text: string) => {
                // ✅ 检查取消标志
                if (this.isCancelled) {
                    this.cancel();
                    resolve({text: '', unsupportedPreview: true});
                    return;
                }

                const trimmed = text.trim();
                if (trimmed) {
                    totalTextLength += trimmed.length + 1;

                    if (totalTextLength > maxTextLength) {
                        this.cancel();
                        this.logger.warn(`[${this.config.name}] XML 文本内容过大 (${(totalTextLength / BYTES_TO_MB).toFixed(1)}MB)`);
                        resolve({text: '', unsupportedPreview: true});
                        return;
                    }

                    textChunks.push(trimmed);
                }
            });

            this.parser.on('end', () => {
                // ✅ 检查取消标志
                if (!this.isCancelled) {
                    const textContent = textChunks.join(' ');
                    resolve(this.buildResult(textContent, 'XmlExtractor'));
                }
            });

            this.parser.on('error', (error: any) => {
                // ✅ 检查取消标志
                if (!this.isCancelled) {
                    this.logger.warn(`[${this.config.name}] ${error.message}`);
                    // XML 解析失败时，降级到普通文本读取
                    extractTextFile(filePath).then(resolve);
                }
            });

            this.stream.pipe(this.parser);

            this.stream.on('error', (error: any) => {
                // ✅ 检查取消标志
                if (!this.isCancelled) {
                    this.logger.error(`[${this.config.name}] 流读取错误: ${error}`);
                    resolve(this.handleError(error, filePath));
                }
            });
        });
    }
}

// 导出单例实例
const extractor = new XmlExtractor();

// 应用装饰器：智能超时 + 日志
const enhancedExtract = composeDecorators(
    extractor.extract.bind(extractor),
    [
        (fn) => withTimeout(fn),  // 智能超时（基于文件大小）
        (fn) => withLogging(fn, { logError: true, prefix: 'XmlExtractor' })
    ]
);

/**
 * 提取 XML 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractXmlFile(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
