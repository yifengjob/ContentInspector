import * as fs from 'fs';
import { dialog } from 'electron';
import { ScanResultItem } from '../types';
import * as ExcelJS from 'exceljs';
import { getSensitiveRules } from '../detection/sensitive-detector';
// 【优化】导入配置常量
import { BYTES_TO_MB } from '../core/config/constants';
import {logger} from "../logger/logger";

export async function exportReport(
  results: ScanResultItem[],
  format: 'csv' | 'json' | 'excel',
  filePath?: string  // 可选的文件路径参数
): Promise<void> {
  let targetPath = filePath;
  
  // 如果没有提供文件路径，则弹出保存对话框
  if (!targetPath) {
    const filters = [
      { name: format === 'csv' ? 'CSV文件' : format === 'json' ? 'JSON文件' : 'Excel文件', extensions: [format] }
    ];
    
    const result = await dialog.showSaveDialog({
      title: '导出报告',
      filters,
      defaultPath: `scan-report.${format}`
    });
    
    if (result.canceled || !result.filePath) {
      return;
    }
    
    targetPath = result.filePath;
  }
  
  try {
    switch (format) {
      case 'csv':
        await exportToCsv(targetPath, results);
        break;
      case 'json':
        await exportToJson(targetPath, results);
        break;
      case 'excel':
        await exportToExcel(targetPath, results);
        break;
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  } catch (error) {
    logger.error('[Export] 导出失败:', error);
    throw error;
  }
}

async function exportToCsv(filePath: string, results: ScanResultItem[]): Promise<void> {
  // 获取敏感类型规则映射
  const rules = getSensitiveRules();
  const typeMap = new Map(rules);
  
  // 收集所有出现的敏感类型
  const allTypes = new Set<string>();
  results.forEach(r => Object.keys(r.counts).forEach(t => allTypes.add(t)));
  
  // 构建表头：使用中文名称，敏感数据总数放在最后
  const headers = ['文件路径', '文件大小(MB)', '修改时间'];
  const typeHeaders = Array.from(allTypes).map(typeId => typeMap.get(typeId) || typeId);
  headers.push(...typeHeaders, '敏感数据总数');
  
  let csvContent = headers.join(',') + '\n';
  
  for (const result of results) {
    const row = [
      `"${result.filePath}"`,
      (result.fileSize / BYTES_TO_MB).toFixed(2),
      result.modifiedTime,
      ...Array.from(allTypes).map(t => (result.counts[t] || 0).toString()),
      result.total.toString()
    ];
    csvContent += row.join(',') + '\n';
  }
  
  // 添加BOM以支持中文
  const bom = '\uFEFF';
  await fs.promises.writeFile(filePath, bom + csvContent, 'utf-8');
}

async function exportToJson(filePath: string, results: ScanResultItem[]): Promise<void> {
  const jsonData = JSON.stringify(results, null, 2);
  await fs.promises.writeFile(filePath, jsonData, 'utf-8');
}

async function exportToExcel(filePath: string, results: ScanResultItem[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('扫描结果');
  
  // 获取敏感类型规则映射
  const rules = getSensitiveRules();
  const typeMap = new Map(rules);
  
  // 收集所有出现的敏感类型
  const allTypes = new Set<string>();
  results.forEach(r => Object.keys(r.counts).forEach(t => allTypes.add(t)));
  const typeHeaders = Array.from(allTypes).map(typeId => typeMap.get(typeId) || typeId);
  
  // 【需求变更】检查是否有表达式匹配数据
  const hasExpressionMatched = results.some(r => r.expressionMatched !== undefined);
  
  // 添加表头：敏感数据总数放在最后
  const headers = ['文件路径', '文件大小(MB)', '修改时间', ...typeHeaders];
  if (hasExpressionMatched) {
    headers.push('表达式'); // 【需求变更】添加表达式列
  }
  headers.push('敏感数据总数');
  worksheet.addRow(headers);
  
  // 设置表头样式
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // 添加数据行
  for (const result of results) {
    const row = [
      result.filePath,
      parseFloat((result.fileSize / BYTES_TO_MB).toFixed(2)), // 数字类型
      result.modifiedTime,
      ...Array.from(allTypes).map(t => result.counts[t] || 0) // 数字类型
    ];
    
    // 【需求变更】如果有表达式匹配数据，添加该列
    if (hasExpressionMatched) {
      row.push(result.expressionMatched || 0);
    }
    
    row.push(result.total); // 数字类型
    const dataRow = worksheet.addRow(row);
    
    // 设置数据行样式和格式
    dataRow.eachCell((cell, colNumber) => {
      // 第1列：文件路径 - 文本格式
      if (colNumber === 1) {
        cell.alignment = { horizontal: 'left', wrapText: true };
      }
      
      // 第2列：文件大小 - 数字格式，保留2位小数
      if (colNumber === 2) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
      
      // 第3列：修改时间 - 日期时间格式
      if (colNumber === 3) {
        cell.alignment = { horizontal: 'center' };
        // 尝试解析日期字符串并格式化
        try {
          const dateStr = cell.value?.toString() || '';
          if (dateStr) {
            // 保持为文本，但居中对齐
            cell.alignment = { horizontal: 'center' };
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
      
      // 敏感类型列（第4列到倒数第2列）- 数字格式，千分位分隔
      if (colNumber >= 4 && colNumber <= headers.length - 1) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
        
        // 大于0的值标红加粗
        const value = Number(cell.value || 0);
        if (value > 0) {
          cell.font = { color: { argb: 'FFFF4D4F' }, bold: true };
        }
      }
      
      // 最后一列：敏感数据总数 - 数字格式，千分位分隔，加粗蓝色
      if (colNumber === headers.length) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
        cell.font = { bold: true, color: { argb: 'FF1890FF' } };
      }
    });
  }
  
  // 设置列宽
  worksheet.columns.forEach((column, index) => {
    if (index === 0) {
      // 文件路径列宽一些
      column.width = 50;
    } else if (index === headers.length - 1) {
      // 总计列
      column.width = 15;
    } else if (hasExpressionMatched && index === headers.length - 2) {
      // 【需求变更】表达式列
      column.width = 10;
    } else {
      column.width = 20;
    }
  });
  
  // 先写入到Buffer，然后使用fs.writeFile
  const buffer: any = await workbook.xlsx.writeBuffer();
  await fs.promises.writeFile(filePath, Buffer.from(buffer));
}
