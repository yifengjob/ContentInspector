/**
 * PowerPoint 提取器 - 使用 fflate 解压 + XML 解析
 * 支持: pptx, dps
 */

import * as fs from 'fs';
import {unzipFile, findZipEntries, extractEntriesText} from '../utils/zip-utils';
import {calculateParserTimeout} from '../core/scan-config';
import {extractorLogger} from '../logger/logger' ;
import type {ExtractorResult} from './types';

export async function extractPptx(filePath: string): Promise<ExtractorResult> {
    // 【关键修复】添加智能超时保护，防止 ZIP 解压卡死
    let isResolved = false;

    // 先获取文件大小，然后计算智能超时
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (error: any) {
        extractorLogger.error(`extractPptx: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }

    const timeoutMs = calculateParserTimeout(stat.size);

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                extractorLogger.warn(`extractPptx: 解析超时 (${timeoutMs / 1000}秒)}`);
                resolve({text: '', unsupportedPreview: true});
            }
        }, timeoutMs);

        (async () => {
            try {
                // 使用 fflate 解压
                const entries = await unzipFile(filePath);

                // 查找所有幻灯片 XML 文件
                const slideEntries = findZipEntries(entries, 'ppt/slides/slide');

                // 【优化】使用数组收集文本块，避免字符串拼接产生大量临时对象
                const textChunks: string[] = [];

                for (const entry of slideEntries) {
                    try {
                        const xmlContent = extractEntriesText([entry])[0];
                        if (!xmlContent) continue;

                        // 简单提取 <a:t> 标签中的文本（PowerPoint 的文本格式）
                        const textMatches = xmlContent.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
                        if (textMatches) {
                            const texts = textMatches.map((match: string) => {
                                const content = match.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
                                return content ? content[1] : '';
                            }).filter((t: string) => t.trim());

                            if (texts.length > 0) {
                                textChunks.push(texts.join(' '));
                            }
                        }
                    } catch (e) {
                        // 忽略单个幻灯片的解析错误
                    }
                }

                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;

                    // 【优化】使用 join 合并所有文本块
                    const allText = textChunks.join('\n');
                    const hasContent = allText && allText.trim().length > 0;

                    resolve({
                        text: hasContent ? allText : '',
                        unsupportedPreview: !hasContent
                    });
                }

            } catch (error: any) {
                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;

                    // 【新增】识别加密或损坏的 PPTX 文件
                    if (error.message.includes('unknown compression type')) {
                        extractorLogger.warn('PPTX 文件可能已加密或损坏，跳过: {}', filePath);
                    } else {
                        extractorLogger.error(`extractPptx: ${error.message}`);
                    }

                    resolve({text: '', unsupportedPreview: true});
                }
            }
        })();
    });
}
