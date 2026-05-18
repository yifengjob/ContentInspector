/**
 * 文件读取工具函数
 */

import type { IpcResponse } from '@/types/preview';

/**
 * 文件读取结果类型
 */
type FileReadResult = IpcResponse<ArrayBuffer>;

/**
 * 文件统计结果类型
 */
type FileStatsResult = IpcResponse<{ size: number; mtime: number }>;

/**
 * 读取文件为 ArrayBuffer
 * @param filePath 文件路径
 * @returns Promise<FileReadResult>
 */
export async function readFileAsBlob(filePath: string): Promise<FileReadResult> {
  try {
    return await window.electronAPI.readFileAsBlob(filePath);
  } catch (_error) {
    const errorMessage = _error instanceof Error ? _error.message : '读取文件失败';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 获取文件统计信息
 * @param filePath 文件路径
 * @returns Promise<FileStatsResult>
 */
export async function getFileStats(filePath: string): Promise<FileStatsResult> {
  try {
    return await window.electronAPI.getFileStats(filePath);
  } catch (_error) {
    const errorMessage = _error instanceof Error ? _error.message : '获取文件信息失败';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 分块读取文件，带进度回调
 * @param filePath 文件路径
 * @param onProgress 进度回调函数
 * @param chunkSize 分块大小（默认 1MB）
 * @returns Promise<ArrayBuffer>
 */
export async function readFileWithProgress(
  filePath: string,
  onProgress?: (progress: number) => void,
  chunkSize: number = 1024 * 1024 // 1MB
): Promise<ArrayBuffer> {
  const statsResult = await getFileStats(filePath);

  if (!statsResult.success || !statsResult.data) {
    throw new Error(statsResult.error || '无法获取文件信息');
  }

  const totalSize = statsResult.data.size;
  const chunks: ArrayBuffer[] = [];
  let offset = 0;

  while (offset < totalSize) {
    const currentChunkSize = Math.min(chunkSize, totalSize - offset);

    // 注意：这里需要后端提供 readFileChunk 接口
    // 如果后端没有实现，可以改用 readFileAsBlob 一次性读取
    const result = await window.electronAPI.readFileChunk?.(filePath, offset, currentChunkSize);

    if (!result || !result.success) {
      throw new Error(result?.error || '读取文件块失败');
    }

    if (!result.chunk) {
      throw new Error('读取到的数据块为空');
    }

    chunks.push(result.chunk);
    offset += result.chunk.byteLength;

    // 更新进度
    if (onProgress) {
      onProgress((offset / totalSize) * 100);
    }

    // 让出主线程，避免阻塞 UI
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // 合并所有分块
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let position = 0;

  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), position);
    position += chunk.byteLength;
  }

  return merged.buffer;
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 格式化后的文件大小字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
