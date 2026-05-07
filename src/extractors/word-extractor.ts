/**
 * Word 文档提取器 - 使用 word-extractor 解析 .doc 和 .docx
 * 支持: doc, docx, wps
 */

import * as fs from 'fs';
import * as path from 'path';
import WordExtractor from 'word-extractor';
import {calculateParserTimeout, FILE_READ_TIMEOUT_FAST_MS} from '../scan-config';  // 【新增】导入超时配置
import {extractorLogger} from '../logger';
import type {ExtractorResult} from './types';
import {extractTextFromBinary} from './binary-extractor';
import {readFileWithTimeout} from '../file-utils';

export async function extractWithWordExtractor(filePath: string): Promise<ExtractorResult> {
    // 【关键修复】添加智能超时保护，防止 word-extractor 卡死
    let isResolved = false;

    // 先获取文件大小，然后计算智能超时
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error(`extractWithWordExtractor: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }

    const timeoutMs = calculateParserTimeout(stat.size);

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                extractorLogger.warn(`extractWithWordExtractor: 解析超时 (${timeoutMs / 1000}秒)`);
                resolve({text: '', unsupportedPreview: true});
            }
        }, timeoutMs);

        (async () => {
            try {
                // 创建 extractor 实例
                const extractor = new WordExtractor();

                // 提取文本
                const extracted = await extractor.extract(filePath);
                const text = extracted.getBody();

                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;

                    const hasContent = text && text.trim().length > 0;

                    // 【优化】只在解析失败时输出日志
                    if (!hasContent) {
                        extractorLogger.warn(`extractWithWordExtractor: [word-extractor] 未提取到内容: ${path.basename(filePath)}`);
                    }

                    resolve({
                        text: hasContent ? text : '',
                        unsupportedPreview: !hasContent
                    });
                }

            } catch (error: any) {
                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;
                    extractorLogger.error(`extractWithWordExtractor: ${error.message}`);

                    // 降级到二进制提取
                    try {
                        // 【新增】使用带超时的文件读取（快速失败）
                        const data = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_FAST_MS);
                        const text = extractTextFromBinary(data);
                        if (text.trim()) {
                            resolve({text, unsupportedPreview: false});
                            return;
                        }
                    } catch (e: any) {
                        extractorLogger.error(`extractWithWordExtractor-fallback: ${e.message}`);
                    }

                    resolve({text: '', unsupportedPreview: true});
                }
            }
        })();
    });
}
