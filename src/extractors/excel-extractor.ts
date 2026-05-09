/**
 * Excel 表格提取器 - 使用 SheetJS 解析
 * 支持: xlsx, xls, et
 */

import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { calculateParserTimeout, FILE_READ_TIMEOUT_STANDARD_MS } from '../core/scan-config';  // 【新增】导入超时配置
import { extractorLogger } from '../logger/logger';
import type { ExtractorResult } from './types';
import { readFileWithTimeout } from '../utils/file-utils';

export async function extractWithSheetJS(filePath: string): Promise<ExtractorResult> {
  // 【关键修复】添加智能超时保护，防止 SheetJS 卡死
  let isResolved = false;
  
  // 先获取文件大小，然后计算智能超时
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error: any) {
    extractorLogger.error(`extractWithSheetJS: ${error.message}`);
    return { text: '', unsupportedPreview: true };
  }
  
  const timeoutMs = calculateParserTimeout(stat.size);
  
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        extractorLogger.warn(`extractWithSheetJS: 解析超时 (${timeoutMs/1000}秒)`);
        resolve({ text: '', unsupportedPreview: true });
      }
    }, timeoutMs);
    
    (async () => {
      try {
        // 读取文件
        // 【新增】使用带超时的文件读取，防止 Windows 锁屏时阻塞
        const data = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
        
        // 使用 SheetJS 解析工作簿
        const workbook = XLSX.read(data, {
          type: 'buffer',
          cellText: true,
          cellDates: true,
          codepage: 65001,  // 【修复】强制 UTF-8 编码，防止中文乱码
          raw: false,  // 【修复】启用原始数据处理
        });
        
        // 【关键修复】检查 workbook 是否有效
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          extractorLogger.warn('extractWithSheetJS: 无效的工作簿或空文件');
          resolve({ text: '', unsupportedPreview: true });
          return;
        }
        
        // 提取所有工作表的文本
        let allText = '';
        
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          
          // 将工作表转换为 CSV 格式（保留换行）
          const csv = XLSX.utils.sheet_to_csv(worksheet, {
            FS: '\t', // 字段分隔符：制表符
            RS: '\n', // 记录分隔符：换行符
            blankrows: false,  // 【修复】跳过空行
          });
          
          if (csv && csv.trim()) {
            allText += `\n=== ${sheetName} ===\n${csv}\n`;
          }
        }
        
        clearTimeout(timeoutId);
        if (!isResolved) {
          isResolved = true;
          
          // 检查是否有实质性内容
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
          
          // 【优化】区分不同类型的错误
          const errorMsg = error.message || String(error);
          
          // 加密相关的错误，返回友好提示
          if (errorMsg.includes('password') || 
              errorMsg.includes('encryption') || 
              errorMsg.includes('Encryption')) {
            extractorLogger.warn('extractWithSheetJS: 文件可能已加密或损坏');
            resolve({ text: '', unsupportedPreview: true });
            return;
          }
          
          extractorLogger.error(`extractWithSheetJS: ${error.message}`);
          resolve({ text: '', unsupportedPreview: true });
        }
      }
    })();
  });
}
