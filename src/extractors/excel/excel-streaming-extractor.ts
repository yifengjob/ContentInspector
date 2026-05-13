/**
 * Excel 表格提取器 - 使用 exceljs 流式解析
 * 支持: xlsx, et（现代 Excel 格式）
 * 
 * 注意：不支持 .xls 格式（Excel 97-2003），请使用 extractWithSheetJS
 */

import { createReadStream } from 'fs';
import * as ExcelJS from 'exceljs';
import type { ExtractorResult } from '../types';
import { BaseExtractor } from '../base-extractor';
import { withTimeout, withLogging, composeDecorators } from '../extractor-decorators';

/**
 * Excel 流式提取器类
 */
class ExcelStreamingExtractor extends BaseExtractor {
    constructor() {
        super({ 
            name: 'ExcelStreamingExtractor',
            verboseLogging: false
        });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        let workbook: any = null;
        try {
            // 使用 exceljs 流式 API
            workbook = new ExcelJS.stream.xlsx.WorkbookReader(
                createReadStream(filePath),
                {
                    worksheets: 'emit',
                    sharedStrings: 'cache',
                    hyperlinks: 'ignore',
                    styles: 'ignore'
                }
            );
            
            // 使用数组收集文本块，避免字符串拼接产生大量临时对象
            const textChunks: string[] = [];
            
            // 逐个工作表读取
            let sheetIndex = 0;
            for await (const worksheet of workbook) {
                sheetIndex++;
                const sheetName = (worksheet as any).name || `Sheet${sheetIndex}`;
                textChunks.push(`\n=== ${sheetName} ===\n`);
                
                // 逐行读取
                for await (const row of worksheet) {
                    const values = (row as any).values;
                    
                    if (values && Array.isArray(values)) {
                        const cells = values
                            .map((cell: any) => {
                                if (cell === null || cell === undefined) return '';
                                if (typeof cell === 'object') {
                                    return cell.text || cell.value || '';
                                }
                                return String(cell);
                            })
                            .filter((text: string) => text.trim().length > 0);
                        
                        if (cells.length > 0) {
                            textChunks.push(cells.join('\t') + '\n');
                        }
                    }
                }
            }
            
            const allText = textChunks.join('');
            return this.buildResult(allText, 'ExcelStreamingExtractor');
            
        } catch (error: any) {
            this.logger.error(`[${this.config.name}] 解析失败: ${error.message}`);
            return this.handleError(error, filePath);
        } finally {
            // 确保释放 WorkbookReader 资源
            if (workbook) {
                try {
                    workbook = null;
                } catch (e) {
                    // 忽略清理错误
                }
            }
        }
    }
}

// 创建基础实例
const baseExtractor = new ExcelStreamingExtractor();

// 应用装饰器：超时 + 日志
const enhancedExtract = composeDecorators(
    baseExtractor.extract.bind(baseExtractor),
    [
        (fn) => withTimeout(fn, { timeoutMs: 30000 }),
        (fn) => withLogging(fn, { 
            logStart: false,
            logEnd: false,
            logError: true,
            prefix: 'ExcelStreamingExtractor'
        })
    ]
);

/**
 * 提取 Excel 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractWithExcelJS(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
