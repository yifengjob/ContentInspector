/**
 * 二进制文件提取器 - 从二进制数据中提取可打印文本
 * 支持: ppt, dps, zip, rar, 7z, tar, gz 等
 */

import {FILE_READ_TIMEOUT_STANDARD_MS} from '../core/scan-config';
import type {ExtractorResult} from './types';
import {BaseExtractor} from './base-extractor';
import {withTimeout, withLogging, composeDecorators} from './extractor-decorators';
import {readFileWithTimeout} from '../utils/file-utils';

/**
 * 从二进制数据中提取可打印文本
 */
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

/**
 * 二进制文件提取器类
 */
class BinaryExtractor extends BaseExtractor {
    constructor() {
        super({ 
            name: 'BinaryExtractor',
            verboseLogging: false
        });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        try {
            // 使用带超时的文件读取，防止 Windows 锁屏时阻塞
            const data = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
            const text = extractTextFromBinary(data);

            return this.buildResult(text, 'BinaryExtractor');
        } catch (error: any) {
            this.logger.error(`[${this.config.name}] 读取失败: ${error.message}`);
            return this.handleError(error, filePath);
        }
    }
}

// 创建基础实例
const baseExtractor = new BinaryExtractor();

// 应用装饰器：超时 + 日志
const enhancedExtract = composeDecorators(
    baseExtractor.extract.bind(baseExtractor),
    [
        (fn) => withTimeout(fn, { timeoutMs: 30000 }),
        (fn) => withLogging(fn, { 
            logStart: false,
            logEnd: false,
            logError: true,
            prefix: 'BinaryExtractor'
        })
    ]
);

/**
 * 提取二进制文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractWithBinary(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
