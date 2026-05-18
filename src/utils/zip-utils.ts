/**
 * ZIP 文件解压辅助工具
 * 使用 fflate 替代 adm-zip，提供更优的性能和更小的体积
 *
 * 优势：
 * - 零拷贝设计，内存效率更高
 * - 同步解压，速度更快
 * - 包体积更小（~5KB gzipped vs ~50KB）
 * - 支持流式处理
 */

import { unzipSync, strFromU8 } from 'fflate';
import { FILE_READ_TIMEOUT_STANDARD_MS } from '../core/config/constants'; // 【新增】导入超时配置
import { readFileWithTimeout } from './file-utils';
import { logger } from '../logger/logger';

/**
 * ZIP 文件条目
 */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * 解压 ZIP 文件并返回所有条目
 * @param filePath ZIP 文件路径
 * @returns ZIP 条目数组
 */
export async function unzipFile(filePath: string): Promise<ZipEntry[]> {
  // 【关键修复】使用带超时的文件读取，防止 Windows 锁屏时阻塞
  const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
  const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  try {
    // 同步解压 ZIP 文件（fflate 的优势：速度快，零拷贝）
    const unzipped = unzipSync(u8);

    // 转换为 ZipEntry 数组
    return Object.entries(unzipped).map(([name, data]) => ({
      name,
      data,
    }));
  } catch (error: any) {
    // 【关键修复】捕获解压错误，防止卡死
    if (error.message.includes('invalid') || error.message.includes('corrupt')) {
      throw new Error(`ZIP 文件损坏或格式错误: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 从 ZIP 文件中提取指定条目的文本内容
 * @param filePath ZIP 文件路径
 * @param entryName 条目名称
 * @param encoding 编码格式（默认 utf-8）
 * @returns 文本内容，如果条目不存在则返回 null
 */
export async function extractZipEntryText(
  filePath: string,
  entryName: string,
  encoding: 'utf-8' | 'gbk' = 'utf-8'
): Promise<string | null> {
  const entries = await unzipFile(filePath);
  const entry = entries.find((e) => e.name === entryName);

  if (!entry) {
    return null;
  }

  // 根据编码转换为字符串
  if (encoding === 'utf-8') {
    return strFromU8(entry.data);
  }

  // GBK 编码需要特殊处理（这里简化处理，实际可能需要 iconv-lite）
  return strFromU8(entry.data);
}

/**
 * 从 ZIP 文件中查找匹配特定模式的条目
 * @param entries ZIP 条目数组
 * @param pattern 匹配模式（前缀或正则）
 * @returns 匹配的条目数组
 */
export function findZipEntries(entries: ZipEntry[], pattern: string | RegExp): ZipEntry[] {
  if (typeof pattern === 'string') {
    return entries.filter((e) => e.name.startsWith(pattern));
  }
  return entries.filter((e) => pattern.test(e.name));
}

/**
 * 批量提取 ZIP 条目的文本内容
 * @param entries ZIP 条目数组
 * @param filter 过滤函数
 * @returns 文本内容数组
 */
export function extractEntriesText(
  entries: ZipEntry[],
  filter?: (entry: ZipEntry) => boolean
): string[] {
  const filtered = filter ? entries.filter(filter) : entries;

  return filtered
    .map((entry) => {
      try {
        return strFromU8(entry.data);
      } catch (error) {
        logger.warn(`无法解码条目 ${entry.name}:`, error);
        return '';
      }
    })
    .filter((text) => text.trim().length > 0);
}
