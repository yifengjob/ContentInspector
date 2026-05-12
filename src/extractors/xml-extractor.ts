/**
 * XML 文件提取器 - 使用 sax 流式解析
 * 支持: xml 文件
 */

import {createReadStream} from 'fs';
import * as sax from 'sax';
import {MAX_TEXT_CONTENT_SIZE_MB, BYTES_TO_MB, calculateParserTimeout} from '../core/scan-config';
import type {ExtractorResult} from './types';
import {extractTextFile} from './text-extractor';
import {buildExtractorResult} from './extractor-utils';
import {extractorLogger} from "../logger/logger";
import * as fs from 'fs';

export async function extractXmlFile(filePath: string): Promise<ExtractorResult> {
    let isResolved = false;

    // 获取文件大小并计算智能超时
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error(`extractXmlFile: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }

    const timeoutMs = calculateParserTimeout(stat.size);

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                stream.destroy();
                parser.destroy();
                extractorLogger.warn(`extractXmlFile: 解析超时 (${timeoutMs / 1000}秒)`);
                resolve({text: '', unsupportedPreview: true});
            }
        }, timeoutMs);

        const stream = createReadStream(filePath, {
            highWaterMark: 64 * 1024
        });

        // 创建严格模式的 sax 解析器
        const parser = sax.createStream(true, {trim: true});

        const textChunks: string[] = [];
        let totalTextLength = 0;
        const maxTextLength = MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB;

        // 监听文本节点事件
        parser.on('text', (text: string) => {
            if (isResolved) return;

            const trimmed = text.trim();
            if (trimmed) {
                totalTextLength += trimmed.length + 1;

                if (totalTextLength > maxTextLength) {
                    stream.destroy();
                    parser.destroy();
                    clearTimeout(timeoutId);
                    extractorLogger.warn(`extractXmlFile: XML 文本内容过大 (${(totalTextLength / BYTES_TO_MB).toFixed(1)}MB)`);
                    if (!isResolved) {
                        isResolved = true;
                        resolve({text: '', unsupportedPreview: true});
                    }
                    return;
                }

                textChunks.push(trimmed);
            }
        });

        parser.on('end', () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                const textContent = textChunks.join(' ');
                resolve(buildExtractorResult(textContent, 'XmlExtractor'));
            }
        });

        parser.on('error', (error: any) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                extractorLogger.warn(`extractXmlFile: ${error.message}`);
                // XML 解析失败时，降级到普通文本读取
                extractTextFile(filePath).then(resolve).catch(reject);
            }
        });

        stream.pipe(parser);

        stream.on('error', (error: any) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                extractorLogger.error(`extractXmlFile-stream: ${error}`);
                reject(error);
            }
        });
    });
}
