/**
 * Excel 表格提取器 - 使用 SheetJS 解析
 * 支持: xlsx, xls, et
 */

import * as XLSX from 'xlsx';
import {FILE_READ_TIMEOUT_STANDARD_MS} from '../../core/config/constants';
import type {ExtractorResult} from '../types';
import {BaseExtractor} from '../base-extractor';
import {readFileWithTimeout} from '../../utils/file-utils';
import {withTimeout, withLogging, composeDecorators} from '../extractor-decorators';

/**
 * Excel 文件提取器类
 */
class ExcelExtractor extends BaseExtractor {
    constructor() {
        super({ 
            name: 'ExcelExtractor',
            verboseLogging: false
        });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        try {
            // 读取文件
            const data = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
            
            // 使用 SheetJS 解析工作簿
            const workbook = XLSX.read(data, {
                type: 'buffer',
                cellText: true,
                cellDates: true,
                codepage: 65001,  // 强制 UTF-8 编码，防止中文乱码
                raw: false,  // 启用原始数据处理
            });
            
            // 检查 workbook 是否有效
            if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
                this.logger.warn(`[${this.config.name}] 无效的工作簿或空文件`);
                return this.buildResult('', 'ExcelExtractor');
            }
            
            // 提取所有工作表的文本
            let allText = '';
            
            for (const sheetName of workbook.SheetNames) {
                const worksheet = workbook.Sheets[sheetName];
                
                // 将工作表转换为 CSV 格式（保留换行）
                const csv = XLSX.utils.sheet_to_csv(worksheet, {
                    FS: '\t', // 字段分隔符：制表符
                    RS: '\n', // 记录分隔符：换行符
                    blankrows: false,  // 跳过空行
                });
                
                if (csv && csv.trim()) {
                    allText += `\n=== ${sheetName} ===\n${csv}\n`;
                }
            }
            
            return this.buildResult(allText, 'ExcelExtractor');
            
        } catch (error: any) {
            // 区分不同类型的错误
            const errorMsg = error.message || String(error);
            
            // 加密相关的错误，返回友好提示
            if (errorMsg.includes('password') || 
                errorMsg.includes('encryption') || 
                errorMsg.includes('Encryption')) {
                this.logger.warn(`[${this.config.name}] 文件可能已加密或损坏`);
            } else {
                this.logger.error(`[${this.config.name}] 解析失败: ${error.message}`);
            }
            
            return this.handleError(error, filePath);
        }
    }
}

// 创建基础实例
const baseExtractor = new ExcelExtractor();

// 应用装饰器：超时 + 日志
const enhancedExtract = composeDecorators(
    baseExtractor.extract.bind(baseExtractor),
    [
        (fn) => withTimeout(fn, { timeoutMs: 30000 }),
        (fn) => withLogging(fn, { 
            logStart: false,
            logEnd: false,
            logError: true,
            prefix: 'ExcelExtractor'
        })
    ]
);

/**
 * 提取 Excel 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractWithSheetJS(filePath: string): Promise<ExtractorResult> {
    return await enhancedExtract(filePath);
}
