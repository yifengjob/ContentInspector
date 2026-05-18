/**
 * 错误分类和友好提示工具
 * 用于将技术错误转换为用户友好的提示信息
 */

export type ErrorCategory =
  | 'timeout' // 超时错误
  | 'file_not_found' // 文件不存在
  | 'permission_denied' // 权限不足
  | 'unsupported' // 不支持的格式
  | 'file_too_large' // 文件过大
  | 'parse_error' // 解析错误
  | 'network_error' // 网络错误
  | 'cancelled' // 用户取消
  | 'unknown'; // 未知错误

export interface ErrorInfo {
  category: ErrorCategory;
  message: string;
  suggestion: string;
  severity: 'info' | 'warning' | 'error';
}

/**
 * 分类错误并提供友好提示
 */
export function classifyError(error: unknown): ErrorInfo {
  const errorMessage = String(error instanceof Error ? error.message : error || '').toLowerCase();

  // 超时错误
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('超时') ||
    errorMessage.includes('timed out')
  ) {
    return {
      category: 'timeout',
      message: '操作超时',
      suggestion: '文件可能过大或系统繁忙。建议下载后使用本地软件打开，或稍后重试。',
      severity: 'warning',
    };
  }

  // 文件不存在
  if (
    errorMessage.includes('not found') ||
    errorMessage.includes('不存在') ||
    errorMessage.includes('no such file') ||
    errorMessage.includes('enoent')
  ) {
    return {
      category: 'file_not_found',
      message: '文件不存在',
      suggestion: '文件可能已被删除或移动。请刷新扫描结果后重试。',
      severity: 'error',
    };
  }

  // 权限不足
  if (
    errorMessage.includes('permission') ||
    errorMessage.includes('权限') ||
    errorMessage.includes('access denied') ||
    errorMessage.includes('eacces') ||
    errorMessage.includes('eperm')
  ) {
    return {
      category: 'permission_denied',
      message: '权限不足',
      suggestion: '没有访问此文件的权限。请以管理员身份运行程序，或检查文件权限设置。',
      severity: 'error',
    };
  }

  // 不支持的格式
  if (
    errorMessage.includes('unsupported') ||
    errorMessage.includes('不支持') ||
    errorMessage.includes('invalid format') ||
    errorMessage.includes('unknown format')
  ) {
    return {
      category: 'unsupported',
      message: '文件格式不支持',
      suggestion: '此文件格式暂不支持预览，但可以正常检测和导出敏感信息。',
      severity: 'info',
    };
  }

  // 文件过大
  if (
    errorMessage.includes('too large') ||
    errorMessage.includes('过大') ||
    errorMessage.includes('exceeds limit') ||
    errorMessage.includes('size limit')
  ) {
    return {
      category: 'file_too_large',
      message: '文件过大',
      suggestion: '文件大小超过限制。建议下载后使用本地软件打开，或在设置中调整文件大小限制。',
      severity: 'warning',
    };
  }

  // 解析错误
  if (
    errorMessage.includes('parse') ||
    errorMessage.includes('解析') ||
    errorMessage.includes('corrupt') ||
    errorMessage.includes('损坏') ||
    errorMessage.includes('invalid')
  ) {
    return {
      category: 'parse_error',
      message: '文件解析失败',
      suggestion: '文件可能已损坏或格式不正确。可以尝试使用其他软件打开验证。',
      severity: 'error',
    };
  }

  // 网络错误（如果将来有网络功能）
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('网络') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('连接')
  ) {
    return {
      category: 'network_error',
      message: '网络连接失败',
      suggestion: '请检查网络连接后重试。',
      severity: 'error',
    };
  }

  // 用户取消
  if (
    errorMessage.includes('cancel') ||
    errorMessage.includes('取消') ||
    errorMessage.includes('abort')
  ) {
    return {
      category: 'cancelled',
      message: '操作已取消',
      suggestion: '',
      severity: 'info',
    };
  }

  // 未知错误
  return {
    category: 'unknown',
    message: '操作失败',
    suggestion: `错误详情: ${errorMessage}\n\n请重试或联系技术支持。`,
    severity: 'error',
  };
}

/**
 * 获取错误的友好显示文本
 */
export function getFriendlyErrorMessage(error: unknown): string {
  const info = classifyError(error);

  if (info.suggestion) {
    return `${info.message}\n\n${info.suggestion}`;
  }

  return info.message;
}

/**
 * 根据错误严重程度获取提示类型
 */
export function getErrorSeverity(error: unknown): 'info' | 'warning' | 'error' {
  return classifyError(error).severity;
}
