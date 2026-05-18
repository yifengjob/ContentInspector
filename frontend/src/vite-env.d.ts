/// <reference types="vite/client" />

// SVG 模块类型声明
declare module '*.svg' {
  const content: string;
  export default content;
}

// Electron API 类型声明
interface ElectronAPI {
  // 目录树
  getDirectoryTree: (path: string, showHidden: boolean) => Promise<any>;

  // 扫描
  scanStart: (config: any) => Promise<any>;
  scanCancel: () => Promise<any>;

  // 预览（统一使用流式模式）
  previewFileStream: (filePath: string) => Promise<any>;
  cancelPreview: (taskId: number) => Promise<any>;

  // 文件预览相关（vue-office）
  readFileAsBlob: (
    filePath: string
  ) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;
  getFileStats: (
    filePath: string
  ) => Promise<{ success: boolean; stats?: { size: number; mtime: number }; error?: string }>;
  readFileChunk: (
    filePath: string,
    offset: number,
    length: number
  ) => Promise<{ success: boolean; chunk?: ArrayBuffer; error?: string }>;

  // 文件操作
  openFile: (filePath: string) => Promise<any>;
  openFileLocation: (filePath: string) => Promise<any>;
  deleteFile: (filePath: string, toTrash: boolean) => Promise<any>;

  // 报告导出
  exportReport: (results: any[], format: string, filePath?: string) => Promise<any>;

  // 日志
  getLogs: () => Promise<any>;

  // 敏感规则
  getSensitiveRules: () => Promise<any>;

  // 配置
  saveConfig: (config: any) => Promise<any>;
  loadConfig: () => Promise<any>;
  getRecommendedConcurrency: () => Promise<number>;

  // 环境检查
  checkSystemEnvironment: () => Promise<any>;

  // 事件监听
  onScanProgress: (callback: (data: any) => void) => () => void;
  onScanResult: (callback: (data: any) => void, batchMode?: boolean) => () => void;
  onScanFinished: (callback: () => void) => () => void;
  onScanError: (callback: (error: string) => void) => () => void;
  onScanLog: (callback: (msg: string) => void) => () => void;
  onScanLogBatch: (callback: (messages: string[]) => void) => () => void;
  onPreviewChunk: (callback: (chunk: any) => void) => () => void;

  // 保存文件对话框
  showSaveDialog: (options?: any) => Promise<any>;

  // 消息对话框
  showMessageBox: (options: {
    message: string;
    title?: string;
    type?: 'info' | 'warning' | 'error' | 'question';
    buttons?: string[];
    cancelId?: number;
  }) => Promise<{ response: number }>;

  // 清理缓存
  clearCache: () => Promise<{ success: boolean; cleanedSize?: number }>;

  // 打开开发者工具
  openDevTools: () => Promise<void>;

  // 搜索表达式相关
  setSearchExpression: (expression: string) => Promise<{ success: boolean; error?: string }>;
  getSearchExpression: () => Promise<{ success: boolean; expression?: string; error?: string }>;
  validateExpression: (expression: string) => Promise<{ valid: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
