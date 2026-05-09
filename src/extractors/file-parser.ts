// 【关键】首先导入日志抑制工具（必须在任何其他导入之前）
import '../utils/log-utils';

import * as path from 'path';
// 【重构】从 file-types.ts 导入配置和辅助函数
import { getFileExtractor } from '../utils/file-types';
import {fileLogger} from "../logger/logger";

/**
 * 从文件中提取文本的主入口函数
 * @param filePath - 文件路径
 * @returns 提取的文本和是否不支持预览的标志
 */
export async function extractTextFromFile(filePath: string): Promise<{ text: string; unsupportedPreview: boolean }> {
  const ext = path.extname(filePath).toLowerCase().substring(1); // 移除开头的点
  
  try {
    // 不支持预览的文件类型（压缩文件等）
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return { text: '', unsupportedPreview: true };
    }
    
    // 【重构】从 file-types.ts 获取解析器函数
    const extractor = getFileExtractor(filePath);
    if (extractor) {
      return await extractor(filePath);
    }
    
    // 不支持的文件类型
    return { text: '', unsupportedPreview: true };
  } catch (error: any) {
    fileLogger.error('extractTextFromFile: ', error.message);
    throw error;
  }
}
