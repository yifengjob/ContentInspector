/**
 * Word 文档提取器 - 使用 word-extractor 解析 .doc 和 .docx
 * 支持: doc, docx, wps
 */

import * as path from 'path';
import {FILE_READ_TIMEOUT_FAST_MS} from '../../core/config/constants';
import type {ExtractorResult} from '../types';
import {BaseExtractor} from '../base-extractor';
import {extractTextFromBinary} from '../binary/binary-extractor';
import {readFileWithTimeout} from '../../utils/file-utils';
import {withTimeout, withLogging, composeDecorators} from '../extractor-decorators';
import WordExtractor from "word-extractor";

/**
 * Word 文件提取器类
 */
class WordExtractorClass extends BaseExtractor {
    constructor() {
        super({ 
            name: 'WordExtractor',
            verboseLogging: false
        });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        try {
            // 创建 extractor 实例
            const extractor = new WordExtractor();

            // 提取文本
            const extracted = await extractor.extract(filePath);
            const text = extracted.getBody();

            const hasContent = text && text.trim().length > 0;

            if (!hasContent) {
                this.logger.warn(`[${this.config.name}] 未提取到内容: ${path.basename(filePath)}`);
            }

            return this.buildResult(text, 'WordExtractor');
        } catch (error: any) {
            this.logger.error(`[${this.config.name}] 解析失败: ${error.message}`);
            
            // 降级到二进制提取
            try {
                const data = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_FAST_MS);
                const text = extractTextFromBinary(data);
                if (text.trim()) {
                    return this.buildResult(text, 'WordExtractor-Fallback');
                }
            } catch (e: any) {
                this.logger.error(`[${this.config.name}] 降级提取失败: ${e.message}`);
            }

            return this.handleError(error, filePath);
        }
    }
}

// 创建基础实例
const baseExtractor = new WordExtractorClass();

// 应用装饰器：超时 + 日志
const enhancedExtract = composeDecorators(
    baseExtractor.extract.bind(baseExtractor),
    [
        (fn) => withTimeout(fn, { timeoutMs: 30000 }),
        (fn) => withLogging(fn, { 
            logStart: false,
            logEnd: false,
            logError: true,
            prefix: 'WordExtractor'
        })
    ]
);

/**
 * 提取 Word 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractWithWordExtractor(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
