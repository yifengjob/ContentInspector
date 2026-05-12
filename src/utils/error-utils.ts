/**
 * 统一的错误处理工具
 * 用于标准化后端错误类型和日志记录
 */

import * as path from 'path';
// 【修复】导入 UI 显示配置常量
import { FILE_SIZE_DECIMAL_PLACES } from '../core/scan-config';

/**
 * 应用错误类
 * 提供结构化的错误信息，便于前端处理和展示
 */
export class AppError extends Error {
  constructor(
    public code: string,      // 错误代码（用于前端识别）
    message: string,          // 用户友好的错误消息
    public originalError?: any // 原始错误对象（用于日志和调试）
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * 错误代码枚举
 */
export const ErrorCodes = {
  // 文件相关错误
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  READ_FAILED: 'READ_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  
  // 解析相关错误
  PARSE_ERROR: 'PARSE_ERROR',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  
  // 扫描相关错误
  SCAN_TIMEOUT: 'SCAN_TIMEOUT',
  SCAN_CANCELLED: 'SCAN_CANCELLED',
  
  // 配置相关错误
  CONFIG_LOAD_FAILED: 'CONFIG_LOAD_FAILED',
  CONFIG_SAVE_FAILED: 'CONFIG_SAVE_FAILED',
  
  // 通用错误
  UNKNOWN: 'UNKNOWN'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * 错误工厂函数 - 文件操作相关
 */

export function createFileNotFoundError(filePath: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.FILE_NOT_FOUND,
    `文件不存在: ${path.basename(filePath)}`,
    originalError
  );
}

export function createPermissionError(filePath: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.PERMISSION_DENIED,
    `权限不足，无法访问: ${path.basename(filePath)}`,
    originalError
  );
}

/**
 * 文件大小显示精度（MB）
 * 【已迁移】此常量已移至 scan-config.ts，此处仅保留注释说明
 */
// const FILE_SIZE_DECIMAL_PLACES = 1; // 已删除，使用导入的常量

export function createFileTooLargeError(filePath: string, sizeMB: number, limitMB: number): AppError {
  return new AppError(
    ErrorCodes.FILE_TOO_LARGE,
    `文件过大 (${sizeMB.toFixed(FILE_SIZE_DECIMAL_PLACES)}MB)，超过限制 (${limitMB}MB): ${path.basename(filePath)}`
  );
}

export function createReadError(filePath: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.READ_FAILED,
    `读取文件失败: ${path.basename(filePath)}`,
    originalError
  );
}

export function createWriteError(filePath: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.WRITE_FAILED,
    `写入文件失败: ${path.basename(filePath)}`,
    originalError
  );
}

export function createDeleteError(filePath: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.DELETE_FAILED,
    `删除文件失败: ${path.basename(filePath)}`,
    originalError
  );
}

/**
 * 错误工厂函数 - 解析相关
 */

export function createParseError(filePath: string, format: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.PARSE_ERROR,
    `解析 ${format.toUpperCase()} 文件失败: ${path.basename(filePath)}`,
    originalError
  );
}

export function createUnsupportedFormatError(_filePath: string, format: string): AppError {
  return new AppError(
    ErrorCodes.UNSUPPORTED_FORMAT,
    `不支持的文件格式: .${format}`
  );
}

/**
 * 错误工厂函数 - 扫描相关
 */

export function createScanTimeoutError(filePath: string, timeoutSeconds: number): AppError {
  return new AppError(
    ErrorCodes.SCAN_TIMEOUT,
    `扫描超时 (${timeoutSeconds}秒): ${path.basename(filePath)}`
  );
}

export function createScanCancelledError(): AppError {
  return new AppError(
    ErrorCodes.SCAN_CANCELLED,
    '扫描已取消'
  );
}

/**
 * 错误工厂函数 - 配置相关
 */

export function createConfigLoadError(originalError?: any): AppError {
  return new AppError(
    ErrorCodes.CONFIG_LOAD_FAILED,
    '加载配置失败，将使用默认配置',
    originalError
  );
}

export function createConfigSaveError(originalError?: any): AppError {
  return new AppError(
    ErrorCodes.CONFIG_SAVE_FAILED,
    '保存配置失败',
    originalError
  );
}

/**
 * 错误工厂函数 - 通用错误
 */

export function createUnknownError(message: string, originalError?: any): AppError {
  return new AppError(
    ErrorCodes.UNKNOWN,
    message,
    originalError
  );
}

/**
 * 智能错误转换 - 根据 Node.js 错误代码转换为 AppError
 */
export function convertNodeError(error: any, filePath?: string, context?: string): AppError {
  const errorCode = error?.code || '';
  const errorMessage = error?.message || String(error);
  
  // 文件不存在
  if (errorCode === 'ENOENT') {
    return filePath 
      ? createFileNotFoundError(filePath, error)
      : createUnknownError('文件或目录不存在', error);
  }
  
  // 权限不足
  if (errorCode === 'EACCES' || errorCode === 'EPERM') {
    return filePath
      ? createPermissionError(filePath, error)
      : createUnknownError('权限不足', error);
  }
  
  // 文件被锁定（Windows）
  if (errorCode === 'EBUSY' || errorCode === 'ETXTBSY') {
    return filePath
      ? createPermissionError(filePath, error)
      : createUnknownError('文件正在使用中', error);
  }
  
  // 其他错误
  return createUnknownError(
    context ? `${context}: ${errorMessage}` : errorMessage,
    error
  );
}

/**
 * 检查是否为 AppError 实例
 */
export function isAppError(error: any): error is AppError {
  return error instanceof AppError;
}

/**
 * 将 AppError 转换为可序列化的对象（用于 IPC 通信）
 */
export function serializeError(error: any): { code: string; message: string } {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message
    };
  }
  
  // 普通 Error
  if (error instanceof Error) {
    return {
      code: ErrorCodes.UNKNOWN,
      message: error.message
    };
  }
  
  // 其他类型
  return {
    code: ErrorCodes.UNKNOWN,
    message: String(error)
  };
}
