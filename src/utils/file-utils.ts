/**
 * 文件操作工具函数（带超时保护）
 * 用于防止 Windows 锁屏等场景下文件 I/O 永久阻塞
 */

import * as fs from 'fs';
import { 
  FILE_READ_TIMEOUT_STANDARD_MS, 
  FILE_OPEN_TIMEOUT_MS, 
  FILE_STAT_TIMEOUT_MS, 
  FILE_CLOSE_TIMEOUT_MS 
} from '../core/config/constants';

/**
 * 带超时的文件读取（异步）
 * @param filePath 文件路径
 * @param timeoutMs 超时时间（毫秒），默认使用标准超时配置
 * @returns Buffer
 */
export async function readFileWithTimeout(
  filePath: string,
  timeoutMs: number = FILE_READ_TIMEOUT_STANDARD_MS
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`文件读取超时 (${timeoutMs}ms): ${filePath}`));
    }, timeoutMs);

    fs.readFile(filePath, (err, data) => {
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * 带超时的文件打开（异步）
 * @param filePath 文件路径
 * @param flags 打开模式，默认 'r'（只读）
 * @param timeoutMs 超时时间（毫秒），默认使用文件打开超时配置
 * @returns fd 文件描述符
 */
export async function openFileWithTimeout(
  filePath: string,
  flags: string = 'r',
  timeoutMs: number = FILE_OPEN_TIMEOUT_MS
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`文件打开超时 (${timeoutMs}ms): ${filePath}`));
    }, timeoutMs);

    fs.open(filePath, flags, (err, fd) => {
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else {
        resolve(fd!);
      }
    });
  });
}

/**
 * 带超时的文件统计（异步）
 * @param filePath 文件路径
 * @param timeoutMs 超时时间（毫秒），默认使用文件统计超时配置
 * @returns fs.Stats
 */
export async function statWithTimeout(
  filePath: string,
  timeoutMs: number = FILE_STAT_TIMEOUT_MS
): Promise<fs.Stats> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`文件统计超时 (${timeoutMs}ms): ${filePath}`));
    }, timeoutMs);

    fs.stat(filePath, (err, stats) => {
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else {
        resolve(stats!);
      }
    });
  });
}

/**
 * 带超时的文件关闭（异步）
 * @param fd 文件描述符
 * @param timeoutMs 超时时间（毫秒），默认使用文件关闭超时配置
 */
export async function closeFileWithTimeout(
  fd: number,
  timeoutMs: number = FILE_CLOSE_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`文件关闭超时 (${timeoutMs}ms): fd=${fd}`));
    }, timeoutMs);

    fs.close(fd, (err) => {
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
