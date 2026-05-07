/**
 * OpenDocument 提取器 - 使用 fflate 解压 + XML 解析
 * 支持: odt, ods, odp
 */

import {unzipFile, extractEntriesText} from '../zip-utils';
import {extractorLogger} from '../logger';
import type {ExtractorResult} from './types';

export async function extractOdt(filePath: string): Promise<ExtractorResult> {
    try {
        const entries = await unzipFile(filePath);

        // ODT 的内容在 content.xml 中
        const contentEntry = entries.find(e => e.name === 'content.xml');
        if (!contentEntry) {
            return {text: '', unsupportedPreview: true};
        }

        const xmlContent = extractEntriesText([contentEntry])[0];
        if (!xmlContent) {
            return {text: '', unsupportedPreview: true};
        }

        // 提取 <text:p> (段落) 和 <text:h> (标题) 标签中的文本
        const textMatches = xmlContent.match(/<text:[ph][^>]*>(.*?)<\/text:[ph]>/gs);
        let allText = '';

        if (textMatches) {
            for (const match of textMatches) {
                // 移除内部的 XML 标签，只保留纯文本
                const text = match.replace(/<[^>]+>/g, '').trim();
                if (text) {
                    allText += text + '\n';
                }
            }
        }

        const hasContent = allText && allText.trim().length > 0;

        return {
            text: hasContent ? allText : '',
            unsupportedPreview: !hasContent
        };

    } catch (error: any) {
        extractorLogger.error(`extractOdt: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }
}

export async function extractOds(filePath: string): Promise<ExtractorResult> {
    try {
        const entries = await unzipFile(filePath);

        // ODS 的内容在 content.xml 中
        const contentEntry = entries.find(e => e.name === 'content.xml');
        if (!contentEntry) {
            return {text: '', unsupportedPreview: true};
        }

        const xmlContent = extractEntriesText([contentEntry])[0];
        if (!xmlContent) {
            return {text: '', unsupportedPreview: true};
        }

        // 提取表格行和单元格
        const rowMatches = xmlContent.match(/<table:table-row[^>]*>(.*?)<\/table:table-row>/gs);
        let allText = '';

        if (rowMatches) {
            for (const rowMatch of rowMatches) {
                // 提取单元格
                const cellMatches = rowMatch.match(/<table:table-cell[^>]*>(.*?)<\/table:table-cell>/gs);
                if (cellMatches) {
                    const cells: string[] = [];
                    for (const cellMatch of cellMatches) {
                        // 提取单元格内的文本
                        const textMatches = cellMatch.match(/<text:p[^>]*>(.*?)<\/text:p>/gs);
                        if (textMatches) {
                            const cellText = textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).join(' ');
                            if (cellText) {
                                cells.push(cellText);
                            }
                        }
                    }
                    if (cells.length > 0) {
                        allText += cells.join('\t') + '\n';
                    }
                }
            }
        }

        const hasContent = allText && allText.trim().length > 0;

        return {
            text: hasContent ? allText : '',
            unsupportedPreview: !hasContent
        };

    } catch (error: any) {
        extractorLogger.error(`extractOdt: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }
}

export async function extractOdp(filePath: string): Promise<ExtractorResult> {
    try {
        const entries = await unzipFile(filePath);

        // ODP 的内容在 content.xml 中
        const contentEntry = entries.find(e => e.name === 'content.xml');
        if (!contentEntry) {
            return {text: '', unsupportedPreview: true};
        }

        const xmlContent = extractEntriesText([contentEntry])[0];
        if (!xmlContent) {
            return {text: '', unsupportedPreview: true};
        }

        // 提取 <draw:frame> 中的 <text:p> 标签
        const frameMatches = xmlContent.match(/<draw:frame[^>]*>(.*?)<\/draw:frame>/gs);
        let allText = '';

        if (frameMatches) {
            for (const frameMatch of frameMatches) {
                const textMatches = frameMatch.match(/<text:p[^>]*>(.*?)<\/text:p>/gs);
                if (textMatches) {
                    for (const textMatch of textMatches) {
                        const text = textMatch.replace(/<[^>]+>/g, '').trim();
                        if (text) {
                            allText += text + '\n';
                        }
                    }
                }
            }
        }

        const hasContent = allText && allText.trim().length > 0;

        return {
            text: hasContent ? allText : '',
            unsupportedPreview: !hasContent
        };

    } catch (error: any) {
        extractorLogger.error(`extractOdt: ${error.message}`);
        return {text: '', unsupportedPreview: true};
    }
}
