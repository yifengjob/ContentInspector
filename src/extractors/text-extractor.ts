/**
 * 文本文件提取器 - 流式读取纯文本文件
 * 支持: txt, log, md, csv, json, yaml, 源代码文件等
 */

import {createReadStream} from 'fs';
import {MAX_TEXT_CONTENT_SIZE_MB, BYTES_TO_MB, calculateParserTimeout} from '../core/scan-config';  // 【新增】导入超时配置
import {convertNodeError} from '../utils/error-utils';
import type {ExtractorResult} from './types';
import {extractorLogger} from "../logger/logger";
import * as fs from 'fs';

export async function extractTextFile(filePath: string): Promise<ExtractorResult> {
    // 【关键修复】添加智能超时保护，防止流式读取卡死
    let isResolved = false;

    // 先获取文件大小，然后计算智能超时
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error(`extractTextFile: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }

    const timeoutMs = calculateParserTimeout(stat.size);

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                stream.destroy();
                extractorLogger.warn(`extractTextFile: 读取超时 (${timeoutMs / 1000}秒)`);
                resolve({text: '', unsupportedPreview: true});
            }
        }, timeoutMs);

        const stream = createReadStream(filePath, {
            encoding: 'utf-8',
            highWaterMark: 64 * 1024 // 64KB 缓冲区
        });

        const textChunks: string[] = [];
        let totalSize = 0;
        const maxSizeBytes = MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB;

        stream.on('data', (chunk: string | Buffer) => {
            if (isResolved) return;

            const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            totalSize += Buffer.byteLength(chunkStr, 'utf-8');

            if (totalSize > maxSizeBytes) {
                stream.destroy();
                clearTimeout(timeoutId);
                extractorLogger.warn(`extractTextFile: 文件内容过大 ${(totalSize / BYTES_TO_MB).toFixed(1)}MB)`);
                if (!isResolved) {
                    isResolved = true;
                    resolve({text: '', unsupportedPreview: true});
                }
                return;
            }

            textChunks.push(chunkStr);
        });

        stream.on('end', () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                const text = textChunks.join('');
                const hasContent = text.trim().length > 0;
                resolve({
                    text: hasContent ? text : '',
                    unsupportedPreview: !hasContent
                });
            }
        });

        stream.on('error', (error: any) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                extractorLogger.error(`extractTextFile: ${error.message}`);
                reject(convertNodeError(error, filePath, '读取文本文件失败'));
            }
        });
    });
}
