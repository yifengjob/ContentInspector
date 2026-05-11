/**
 * RTF 富文本提取器 - 编码转换 + 正则提取
 * 支持: rtf
 */

import * as iconv from 'iconv-lite';
import {calculateParserTimeout, FILE_READ_TIMEOUT_STANDARD_MS} from '../core/scan-config';  // 【新增】导入超时配置
import {extractorLogger} from "../logger/logger";
import type {ExtractorResult} from './types';
import {readFileWithTimeout} from '../utils/file-utils';
import * as fs from 'fs';

export async function extractRtf(filePath: string): Promise<ExtractorResult> {
    // 【关键修复】添加智能超时保护，防止正则表达式处理卡死
    let isResolved = false;

    // 先获取文件大小，然后计算智能超时
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error(`extractRtf: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }

    const timeoutMs = calculateParserTimeout(stat.size);

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                extractorLogger.warn(`extractRtf: 解析超时 (${timeoutMs / 1000}秒)`);
                resolve({text: '', unsupportedPreview: true});
            }
        }, timeoutMs);

        (async () => {
            try {
                // 【新增】使用带超时的文件读取，防止 Windows 锁屏时阻塞
                const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
                const content = buffer.toString('utf-8');  // 转换为字符串

                // 第一步：检测 RTF 文件的编码（从 \ansicpgN 中提取代码页）
                const codePageMatch = content.match(/\\ansicpg(\d+)/i);
                let encoding = 'gbk'; // 默认 GBK（简体中文）

                if (codePageMatch) {
                    const codePage = parseInt(codePageMatch[1]);
                    // 根据代码页映射到 iconv-lite 支持的编码名称
                    switch (codePage) {
                        case 936:  // 简体中文 GBK
                            encoding = 'gbk';
                            break;
                        case 950:  // 繁体中文 Big5
                            encoding = 'big5';
                            break;
                        case 932:  // 日语 Shift_JIS
                            encoding = 'shift_jis';
                            break;
                        case 949:  // 韩语 EUC-KR
                            encoding = 'euc-kr';
                            break;
                        case 1252: // 西欧 Windows-1252
                            encoding = 'windows-1252';
                            break;
                        case 1251: // 西里尔文 Windows-1251
                            encoding = 'windows-1251';
                            break;
                        case 1250: // 东欧 Windows-1250
                            encoding = 'windows-1250';
                            break;
                        case 65001: // UTF-8
                            encoding = 'utf-8';
                            break;
                        default:
                            // 其他代码页尝试使用 GBK（最常见）
                            extractorLogger.warn(`extractRtf: 未知的 RTF 代码页: ${codePage}，尝试使用 GBK 解码`);
                            encoding = 'gbk';
                    }
                }

                // 第二步：将十六进制转义序列（\'xx）转换为对应编码的字符
                let text = content.replace(/(\\'[0-9a-fA-F]{2})+/g, (match) => {
                    // 提取所有十六进制字节
                    const hexPairs = match.match(/\\'([0-9a-fA-F]{2})/g);
                    if (!hexPairs) return '';

                    // 转换为字节数组
                    const bytes = hexPairs.map(pair => {
                        const hex = pair.substring(2); // 去掉 \'
                        return parseInt(hex, 16);
                    });

                    // 【优化】复用 Buffer，减少临时对象创建
                    let decoded = '';
                    try {
                        const buffer = Buffer.from(bytes);
                        decoded = iconv.decode(buffer, encoding as any);
                    } catch (e) {
                        extractorLogger.warn(`extractRtf-decode: ${encoding} 解码失败，尝试 GBK`);
                        // 降级到 GBK
                        try {
                            const gbkBuffer = Buffer.from(bytes);
                            decoded = iconv.decode(gbkBuffer, 'gbk');
                        } catch (e2) {
                            return '';
                        }
                    }
                    return decoded;
                });

                // 第三步：移除其他 RTF 控制字和标记
                text = text
                    // 移除 Unicode 转义序列（\uN?）
                    .replace(/\\u-?\d+\??/g, '')
                    // 移除 RTF 控制字（\word）
                    .replace(/\\[a-z]+[0-9]*[ ;]?/g, ' ')
                    // 移除花括号
                    .replace(/[{}]/g, ' ')
                    // 合并多余空白
                    .replace(/\s+/g, ' ')
                    .trim();

                const hasContent = text && text.length > 10;

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
                    extractorLogger.error(`extractRtf: ${error.message}`);
                    resolve({text: '', unsupportedPreview: true});
                }
            }
        })();
    });
}
