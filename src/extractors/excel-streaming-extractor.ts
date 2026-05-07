/**
 * Excel 表格提取器 - 使用 exceljs 流式解析
 * 支持: xlsx, et（现代 Excel 格式）
 * 
 * 注意：不支持 .xls 格式（Excel 97-2003），请使用 extractWithSheetJS
 */

import * as fs from 'fs';
import { createReadStream } from 'fs';
import * as ExcelJS from 'exceljs';
import { calculateParserTimeout } from '../scan-config';
import { extractorLogger } from '../logger';
import type { ExtractorResult } from './types';

export async function extractWithExcelJS(filePath: string): Promise<ExtractorResult> {
  // 【关键修复】添加智能超时保护，防止解析卡死
  let isResolved = false;
  
  // 先获取文件大小，然后计算智能超时
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error: any) {
    extractorLogger.error(`extractWithExcelJS: ${error.message}`);
    return { text: '', unsupportedPreview: true };
  }
  
  const timeoutMs = calculateParserTimeout(stat.size);
  
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        extractorLogger.warn(`extractWithExcelJS: 解析超时 (${timeoutMs/1000}秒)`);
        resolve({ text: '', unsupportedPreview: true });
      }
    }, timeoutMs);
    
    (async () => {
      try {
        const textChunks: string[] = [];
        
        // 【核心】使用 exceljs 流式 API
        const workbook = new ExcelJS.stream.xlsx.WorkbookReader(
          createReadStream(filePath),
          {
            worksheets: 'emit',
            sharedStrings: 'cache',
            hyperlinks: 'ignore',
            styles: 'ignore'
          }
        );
        
        // 逐个工作表读取
        let sheetIndex = 0;
        for await (const worksheet of workbook) {
          sheetIndex++;
          // 【类型断言】exceljs 的 WorksheetReader 类型定义不完整
          const sheetName = (worksheet as any).name || `Sheet${sheetIndex}`;
          textChunks.push(`\n=== ${sheetName} ===\n`);
          
          // 逐行读取
          for await (const row of worksheet) {
            // 【类型断言】exceljs 的类型定义不完整，需要 as any
            const values = (row as any).values;
            
            if (values && Array.isArray(values)) {
              const cells = values
                .map((cell: any) => {
                  // 提取单元格文本
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
        
        clearTimeout(timeoutId);
        if (!isResolved) {
          isResolved = true;
          
          const allText = textChunks.join('');
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
          extractorLogger.error(`extractWithExcelJS: ${error.message}`);
          resolve({ text: '', unsupportedPreview: true });
        }
      }
    })();
  });
}
