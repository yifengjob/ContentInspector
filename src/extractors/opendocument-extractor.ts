/**
 * OpenDocument 提取器 - 使用 fflate 解压 + XML 解析
 * 支持: odt, ods, odp
 */

import {unzipFile, extractEntriesText} from '../utils/zip-utils';
import {extractorLogger} from '../logger/logger';
import type {ExtractorResult} from './types';

/**
 * 【重构】提取公共的 OpenDocument 解析逻辑
 * @param filePath 文件路径
 * @param fileTypeName 文件类型名称（用于日志）
 * @param extractTextFn 自定义文本提取函数
 * @returns 提取结果
 */
async function extractOpenDocument(
    filePath: string,
    fileTypeName: string,
    extractTextFn: (xmlContent: string) => string[]
): Promise<ExtractorResult> {
    try {
        const entries = await unzipFile(filePath);

        // OpenDocument 的内容在 content.xml 中
        const contentEntry = entries.find(e => e.name === 'content.xml');
        if (!contentEntry) {
            return {text: '', unsupportedPreview: true};
        }

        const xmlContent = extractEntriesText([contentEntry])[0];
        if (!xmlContent) {
            return {text: '', unsupportedPreview: true};
        }

        // 使用自定义函数提取文本
        const textChunks = extractTextFn(xmlContent);

        // 【优化】使用 join 合并所有文本块
        const allText = textChunks.join('\n');
        const hasContent = allText && allText.trim().length > 0;

        return {
            text: hasContent ? allText : '',
            unsupportedPreview: !hasContent
        };

    } catch (error: any) {
        // 【新增】识别加密或损坏的 OpenDocument 文件
        if (error.message.includes('unknown compression type')) {
            extractorLogger.warn('{} 文件可能已加密或损坏，跳过: {}', fileTypeName, filePath);
        } else {
            extractorLogger.error(`extract${fileTypeName}: ${error.message}`);
        }
        return {text: '', unsupportedPreview: true};
    }
}

export async function extractOdt(filePath: string): Promise<ExtractorResult> {
    return extractOpenDocument(filePath, 'ODT', (xmlContent) => {
        // 【优化】使用数组收集文本块，避免字符串拼接产生大量临时对象
        const textChunks: string[] = [];

        // 提取 <text:p> (段落) 和 <text:h> (标题) 标签中的文本
        const textMatches = xmlContent.match(/<text:[ph][^>]*>(.*?)<\/text:[ph]>/gs);

        if (textMatches) {
            for (const match of textMatches) {
                // 移除内部的 XML 标签，只保留纯文本
                const text = match.replace(/<[^>]+>/g, '').trim();
                if (text) {
                    textChunks.push(text);
                }
            }
        }

        return textChunks;
    });
}

export async function extractOds(filePath: string): Promise<ExtractorResult> {
    return extractOpenDocument(filePath, 'ODS', (xmlContent) => {
        // 【优化】使用数组收集文本块，避免字符串拼接产生大量临时对象
        const textChunks: string[] = [];

        // 提取表格行和单元格
        const rowMatches = xmlContent.match(/<table:table-row[^>]*>(.*?)<\/table:table-row>/gs);

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
                        textChunks.push(cells.join('\t'));
                    }
                }
            }
        }

        return textChunks;
    });
}

export async function extractOdp(filePath: string): Promise<ExtractorResult> {
    return extractOpenDocument(filePath, 'ODP', (xmlContent) => {
        // 【优化】使用数组收集文本块，避免字符串拼接产生大量临时对象
        const textChunks: string[] = [];

        // 提取 <draw:frame> 中的 <text:p> 标签
        const frameMatches = xmlContent.match(/<draw:frame[^>]*>(.*?)<\/draw:frame>/gs);

        if (frameMatches) {
            for (const frameMatch of frameMatches) {
                const textMatches = frameMatch.match(/<text:p[^>]*>(.*?)<\/text:p>/gs);
                if (textMatches) {
                    for (const textMatch of textMatches) {
                        const text = textMatch.replace(/<[^>]+>/g, '').trim();
                        if (text) {
                            textChunks.push(text);
                        }
                    }
                }
            }
        }

        return textChunks;
    });
}
