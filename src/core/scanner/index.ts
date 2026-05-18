/**
 * Scanner 模块 - 扫描核心功能
 *
 * 职责：
 * - 协调各个子模块完成扫描任务
 * - 管理扫描生命周期
 * - 启动和取消扫描
 */

export { startScan, cancelScan } from './scanner';
export { initializeScanner, type ScannerContext } from './scan-initializer';
export { WalkerHandler, type WalkerHandlerOptions } from './scan-walker-handler';
export { StagnationDetector, type StagnationDetectorOptions } from './scan-stagnation-detector';
export { ScanCleanup, type CleanupOptions } from './scan-cleanup';

// 辅助函数
export {
  createProgressUpdater,
  cleanupPendingTask,
  sendToMainWindow,
  calculateTimeout,
  BatchSender,
  resultBatchSender,
  configureBatchSender,
  LogThrottler,
} from './helpers/scanner-helpers';
