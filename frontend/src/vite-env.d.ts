// SVG 模块类型声明
declare module '*.svg' {
  const content: string
  export default content
}

// Electron API 类型声明
interface ElectronAPI {
  // 扫描相关
  getDirectoryTree: (path: string, showHidden?: boolean) => Promise<any>
  scanStart: (config: any) => Promise<any>
  scanCancel: () => Promise<any>
  onScanProgress: (callback: (data: any) => void) => Promise<() => void>
  onScanResult: (callback: (data: any) => void) => Promise<() => void>
  onScanLog: (callback: (data: any) => void) => Promise<() => void>
  onScanLogBatch: (callback: (logs: string[]) => void) => Promise<() => void>  // 【新增】批量日志监听
  onScanFinished: (callback: () => void) => Promise<() => void>
  onScanError: (callback: (error: string) => void) => Promise<() => void>
  
  // 文件操作（统一使用流式预览）
  previewFileStream: (filePath: string) => Promise<any>
  cancelPreview: (taskId: number) => Promise<any>
  onPreviewChunk: (callback: (chunk: any) => void) => Promise<() => void>  // 【方案 D3】
  openFile: (filePath: string) => Promise<any>
  openFileLocation: (filePath: string) => Promise<any>
  deleteFile: (filePath: string, toTrash: boolean) => Promise<any>
  
  // 报告导出
  exportReport: (results: any[], format: string, filePath?: string) => Promise<any>
  
  // 配置管理
  getLogs: () => Promise<{ logs: string[] }>
  getSensitiveRules: () => Promise<any[]>
  saveConfig: (config: any) => Promise<any>
  loadConfig: () => Promise<any>
  getRecommendedConcurrency: () => Promise<number>
  checkSystemEnvironment: () => Promise<any>
  showSaveDialog: (options?: any) => Promise<any>
  
  // 缓存清理
  clearCache: () => Promise<{ success: boolean; cleanedSize?: number }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
