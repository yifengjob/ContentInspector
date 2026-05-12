/**
 * PowerPoint 提取器 - 使用 fflate 解压 + XML 解析
 * 支持: pptx, dps
 */

import {unzipFile, findZipEntries, extractEntriesText} from '../utils/zip-utils';
import type {ExtractorResult} from './types';
import {BaseExtractor} from './base-extractor';
import {withTimeout, withLogging, composeDecorators} from './extractor-decorators';

/**
 * PPTX 文件提取器类
 */
class PptxExtractor extends BaseExtractor {
    constructor() {
        super({ 
            name: 'PptxExtractor',
            verboseLogging: false
        });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        try {
            // 使用 fflate 解压
            const entries = await unzipFile(filePath);

            // 查找所有幻灯片 XML 文件
            const slideEntries = findZipEntries(entries, 'ppt/slides/slide');

            // 使用数组收集文本块，避免字符串拼接产生大量临时对象
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

            // 使用 join 合并所有文本块
            const allText = textChunks.join('\n');
            return this.buildResult(allText, 'PptxExtractor');

        } catch (error: any) {
            // 识别加密或损坏的 PPTX 文件
            if (error.message.includes('unknown compression type')) {
                this.logger.warn(`[${this.config.name}] PPTX 文件可能已加密或损坏`);
            } else {
                this.logger.error(`[${this.config.name}] 解析失败: ${error.message}`);
            }

            return this.handleError(error, filePath);
        }
    }
}

// 创建基础实例
const baseExtractor = new PptxExtractor();

// 应用装饰器：超时 + 日志
const enhancedExtract = composeDecorators(
    baseExtractor.extract.bind(baseExtractor),
    [
        (fn) => withTimeout(fn, { timeoutMs: 30000 }),
        (fn) => withLogging(fn, { 
            logStart: false,
            logEnd: false,
            logError: true,
            prefix: 'PptxExtractor'
        })
    ]
);

/**
 * 提取 PPTX 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractPptx(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
