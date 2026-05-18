import type { DirectoryNode, ScanConfig, ScanResultItem, AppConfig } from '@/types';

// 声明全局Window接口
declare global {
  interface Window {
    electronAPI: {
      getDirectoryTree: (path: string, showHidden: boolean) => Promise<any>;
      scanStart: (config: any) => Promise<any>;
      scanCancel: () => Promise<any>;
      previewFileStream: (filePath: string) => Promise<any>; // 流式预览
      cancelPreview: (taskId: number) => Promise<any>;
      onPreviewChunk: (callback: (chunk: any) => void) => () => void; // 【方案 D3】
      openFile: (filePath: string) => Promise<any>;
      openFileLocation: (filePath: string) => Promise<any>;
      deleteFile: (filePath: string, toTrash: boolean) => Promise<any>;
      exportReport: (results: any[], format: string, filePath?: string) => Promise<any>;
      getLogs: () => Promise<any>;
      getSensitiveRules: () => Promise<any>;
      saveConfig: (config: any) => Promise<any>;
      loadConfig: () => Promise<any>;
      getRecommendedConcurrency: () => Promise<number>;
      checkSystemEnvironment: () => Promise<any>;
      showSaveDialog: (options?: any) => Promise<any>;
      showMessageBox: (options: {
        message: string;
        title?: string;
        type?: 'info' | 'warning' | 'error' | 'question';
        buttons?: string[];
        cancelId?: number;
      }) => Promise<{ response: number }>;
      clearCache: () => Promise<{ success: boolean; cleanedSize?: number; error?: string }>;
      onScanProgress: (callback: (data: any) => void) => () => void;
      onScanResult: (callback: (data: any) => void, batchMode?: boolean) => () => void; // 【P3优化】支持批量模式
      onScanFinished: (callback: () => void) => () => void;
      onScanError: (callback: (error: string) => void) => () => void;
      onScanLog: (callback: (msg: string) => void) => () => void;
      onScanLogBatch: (callback: (logs: string[]) => void) => () => void; // 【新增】批量日志监听

      // 【新增】搜索表达式相关
      setSearchExpression: (expression: string) => Promise<{ success: boolean; error?: string }>;
      getSearchExpression: () => Promise<{ success: boolean; expression?: string; error?: string }>;
      validateExpression: (
        expression: string
      ) => Promise<{ valid: boolean; error?: string; position?: number }>;
    };
  }
}

// 获取目录树
export async function getDirectoryTree(path: string, showHidden = true): Promise<DirectoryNode[]> {
  const result = await window.electronAPI.getDirectoryTree(path, showHidden);
  if (result.error) throw new Error(result.error);
  return result;
}

// 开始扫描
export async function startScan(config: ScanConfig): Promise<void> {
  const result = await window.electronAPI.scanStart(config);
  if (result.error) throw new Error(result.error);
}

// 取消扫描
export async function cancelScan(): Promise<boolean> {
  const result = await window.electronAPI.scanCancel();
  return result.success;
}

// 预览文件（统一使用流式模式）
export async function previewFileStream(
  filePath: string
): Promise<{ success: boolean; totalChunks?: number }> {
  const result = await window.electronAPI.previewFileStream(filePath);
  if (result.error) throw new Error(result.error);
  return result;
}

// 【方案 D3】监听预览数据块
export async function onPreviewChunk(callback: (chunk: any) => void): Promise<() => void> {
  return window.electronAPI.onPreviewChunk(callback);
}

// 【方案 B】取消预览（传入 taskId）
export async function cancelPreview(taskId?: number): Promise<boolean> {
  if (!taskId) return false;
  const result = await window.electronAPI.cancelPreview(taskId);
  return result.success;
}

// 打开文件
export async function openFile(filePath: string): Promise<void> {
  const result = await window.electronAPI.openFile(filePath);
  if (result.error) throw new Error(result.error);
}

// 打开文件所在目录
export async function openFileLocation(filePath: string): Promise<void> {
  const result = await window.electronAPI.openFileLocation(filePath);
  if (result.error) throw new Error(result.error);
}

// 删除文件
export async function deleteFile(filePath: string, toTrash: boolean = false): Promise<void> {
  const result = await window.electronAPI.deleteFile(filePath, toTrash);
  if (result.error) throw new Error(result.error);
}

// 导出报告
export async function exportReport(
  results: ScanResultItem[],
  format: 'csv' | 'json' | 'excel',
  filePath?: string // 可选的文件路径
): Promise<void> {
  const result = await window.electronAPI.exportReport(results, format, filePath);
  if (result.error) throw new Error(result.error);
}

// 获取日志
export async function getLogs(): Promise<string[]> {
  const result = await window.electronAPI.getLogs();
  return result.logs || [];
}

// 获取敏感规则
export async function getSensitiveRules(): Promise<any[]> {
  const result = await window.electronAPI.getSensitiveRules();
  return result || [];
}

// 保存配置
export async function saveConfig(config: AppConfig): Promise<void> {
  const result = await window.electronAPI.saveConfig(config);
  if (result.error) throw new Error(result.error);
}

// 加载配置
export async function loadConfig(): Promise<AppConfig> {
  const result = await window.electronAPI.loadConfig();
  if (result.error) throw new Error(result.error);
  return result;
}

// 获取推荐的并发数（根据系统硬件智能计算）
export async function getRecommendedConcurrency(): Promise<number> {
  return await window.electronAPI.getRecommendedConcurrency();
}

// 检查系统环境
export async function checkSystemEnvironment(): Promise<any> {
  return await window.electronAPI.checkSystemEnvironment();
}

// 清理缓存
export async function clearCache(): Promise<{
  success: boolean;
  cleanedSize?: number;
  error?: string;
}> {
  const result = await window.electronAPI.clearCache();
  if (result.error) throw new Error(result.error);
  return result;
}

// 监听扫描进度事件
export async function onScanProgress(callback: (data: any) => void): Promise<() => void> {
  return window.electronAPI.onScanProgress(callback);
}

// 监听扫描结果事件（支持批量模式）
export async function onScanResult(
  callback: (data: ScanResultItem | ScanResultItem[]) => void,
  batchMode: boolean = false // 【P3优化】是否启用批量模式
): Promise<() => void> {
  return window.electronAPI.onScanResult(callback, batchMode);
}

// 监听扫描完成事件
export async function onScanFinished(callback: () => void): Promise<() => void> {
  return window.electronAPI.onScanFinished(callback);
}

// 监听扫描错误事件
export async function onScanError(callback: (error: string) => void): Promise<() => void> {
  return window.electronAPI.onScanError(callback);
}

// 监听扫描日志事件
export async function onScanLog(callback: (log: string) => void): Promise<() => void> {
  return window.electronAPI.onScanLog(callback);
}

// 【新增】监听批量日志事件（带节流）
export async function onScanLogBatch(callback: (logs: string[]) => void): Promise<() => void> {
  return window.electronAPI.onScanLogBatch(callback);
}

// 显示消息对话框
export async function showMessage(
  message: string,
  options?: {
    title?: string;
    type?: 'info' | 'warning' | 'error';
  }
): Promise<void> {
  await window.electronAPI.showMessageBox({
    message,
    title: options?.title || '提示',
    type: options?.type || 'info',
    buttons: ['确定'],
  });
}

// 【新增】确认对话框（类似 confirm）
export async function askDialog(
  message: string,
  options?: {
    title?: string;
    type?: 'info' | 'warning' | 'error' | 'question';
    okLabel?: string;
    cancelLabel?: string;
  }
): Promise<boolean> {
  const result = await window.electronAPI.showMessageBox({
    message,
    title: options?.title || '确认',
    type: options?.type || 'question',
    buttons: [options?.okLabel || '确定', options?.cancelLabel || '取消'],
    cancelId: 1, // 第二个按钮是取消
  });
  return result.response === 0; // 0 表示点击了第一个按钮（确定）
}

// 保存文件对话框
export async function showSaveDialog(options?: {
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  // 这里需要通过IPC调用主进程的dialog
  const result = await window.electronAPI.showSaveDialog(options);
  return result.filePath || null;
}

// ==================== 搜索表达式相关 ====================

// 【新增】设置搜索表达式
export async function setSearchExpression(expression: string): Promise<void> {
  const result = await window.electronAPI.setSearchExpression(expression);
  if (!result.success) throw new Error(result.error || '保存失败');
}

// 【新增】获取当前搜索表达式
export async function getSearchExpression(): Promise<string> {
  const result = await window.electronAPI.getSearchExpression();
  if (!result.success) throw new Error(result.error || '获取失败');
  return result.expression || '';
}

// 【新增】验证表达式语法（用于前端实时校验）
export async function validateExpression(
  expression: string
): Promise<{ valid: boolean; error?: string; position?: number }> {
  return await window.electronAPI.validateExpression(expression);
}
