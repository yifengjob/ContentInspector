/**
 * 二进制文件提取器 - 从二进制数据中提取可打印文本
 * 支持: ppt, dps, zip, rar, 7z, tar, gz 等
 */

import {calculateParserTimeout, FILE_READ_TIMEOUT_STANDARD_MS} from '../core/scan-config';  // 【新增】导入超时配置
import {extractorLogger} from '../logger/logger' ;
import type {ExtractorResult} from './types';
import {readFileWithTimeout} from '../utils/file-utils';
import * as fs from 'fs';

// 从二进制数据中提取可打印文本
export function extractTextFromBinary(data: Buffer): string {
    let result = '';
    let currentText = '';
    const minTextLength = 4; // 最少连续字符数

    for (let i = 0; i < data.length; i++) {
        const byte = data[i];

        // 检查是否是可打印字符（ASCII 32-126 或常见中文字符范围）
        if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
            currentText += String.fromCharCode(byte);
        } else {
            // 非可打印字符，检查累积的文本是否足够长
            if (currentText.length >= minTextLength) {
                const cleaned = currentText.trim();
                if (cleaned) {
                    result += cleaned + '\n';
                }
            }
            currentText = '';
        }
    }

    // 处理最后的文本块
    if (currentText.length >= minTextLength) {
        const cleaned = currentText.trim();
        if (cleaned) {
            result += cleaned;
        }
    }

    // 过滤掉太短的行
    return result.split('\n')
        .filter(line => line.length > 2)
        .join('\n');
}

export async function extractWithBinary(filePath: string): Promise<ExtractorResult> {
    // 【关键修复】添加智能超时保护，防止二进制扫描卡死
    let isResolved = false;

    // 先获取文件大小，然后计算智能超时
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error(`extractWithBinary: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }

    const timeoutMs = calculateParserTimeout(stat.size);

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                extractorLogger.warn(`extractWithBinary: 扫描超时 (${timeoutMs / 1000}秒)`);
                resolve({text: '', unsupportedPreview: true});
            }
        }, timeoutMs);

        (async () => {
            try {
                // 【新增】使用带超时的文件读取，防止 Windows 锁屏时阻塞
                const data = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
                const text = extractTextFromBinary(data);

                const hasContent = text && text.trim().length > 0;

                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;
                    resolve({
                        text: hasContent ? text : '',
                        unsupportedPreview: !hasContent
                    });
                }
            } catch (error: any) {
                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;
                    extractorLogger.error('extractWithBinary: ', error.message);
                    resolve({text: '', unsupportedPreview: true});
                }
            }
        })();
    });
}
