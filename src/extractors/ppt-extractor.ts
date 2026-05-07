/**
 * PowerPoint 提取器 - 使用 fflate 解压 + XML 解析
 * 支持: pptx, dps
 */

import * as fs from 'fs';
import {unzipFile, findZipEntries, extractEntriesText} from '../zip-utils';
import {calculateParserTimeout} from '../scan-config';
import {extractorLogger} from '../logger' ;
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

                let allText = '';

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
                                allText += '\n' + texts.join(' ');
                            }
                        }
                    } catch (e) {
                        // 忽略单个幻灯片的解析错误
                    }
                }

                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;

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
                    extractorLogger.error(`extractPptx: ${error.message}`);
                    resolve({text: '', unsupportedPreview: true});
                }
            }
        })();
    });
}
