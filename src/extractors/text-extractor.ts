/**
 * 文本文件提取器 - 流式读取纯文本文件
 * 支持: txt, log, md, csv, json, yaml, 源代码文件等
 */

import {createReadStream} from 'fs';
import {MAX_TEXT_CONTENT_SIZE_MB, BYTES_TO_MB} from '../scan-config';
import {convertNodeError} from '../error-utils';
import type {ExtractorResult} from './types';
import {extractorLogger} from "../logger";

export async function extractTextFile(filePath: string): Promise<ExtractorResult> {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath, {
            encoding: 'utf-8',
            highWaterMark: 64 * 1024 // 64KB 缓冲区
        });

        const textChunks: string[] = [];
        let totalSize = 0;
        const maxSizeBytes = MAX_TEXT_CONTENT_SIZE_MB * BYTES_TO_MB;
        let isResolved = false;

        stream.on('data', (chunk: string | Buffer) => {
            const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            totalSize += Buffer.byteLength(chunkStr, 'utf-8');

            if (totalSize > maxSizeBytes) {
                stream.destroy();
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
                extractorLogger.error(`extractTextFile: ${error.message}`);
                reject(convertNodeError(error, filePath, '读取文本文件失败'));
            }
        });
    });
}
