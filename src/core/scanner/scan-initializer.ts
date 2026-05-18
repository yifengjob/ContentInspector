/**
 * 扫描初始化模块
 *
 * 职责：
 * - 计算并发数和内存配置
 * - 初始化日志、事件总线、任务队列
 * - 创建 WorkerPool 和 SmartScheduler
 */

import * as os from 'os';
import { BrowserWindow } from 'electron';
import { ScanConfig } from '../../types';
import { ScanState } from '../state';
import {
  BYTES_TO_MB,
  ERROR_LOG_INTERVAL,
  PROGRESS_THROTTLE_INTERVAL,
  RESULT_LOG_COUNT_INTERVAL,
  RESULT_LOG_TIME_INTERVAL,
  WORKER_MAX_OLD_GENERATION_MB,
  WORKER_MAX_YOUNG_GENERATION_MB,
} from '../config';
import {
  configureBatchSender,
  createProgressUpdater,
  resultBatchSender,
  calculateTimeout,
} from './helpers/scanner-helpers';
import { EventBus } from '../infra';
import { TaskQueueManager } from '../queue';
import { Consumer, WorkerPool } from '../worker';
import { SmartScheduler } from '../scheduler';
import { getScannerLogger } from '../../logger/logger';
import { LogThrottler } from './helpers/scanner-helpers';
import { calculateActualConcurrency, calculateMaxLargeFilesConcurrent } from '../config/manager';

export interface ScannerContext {
  state: ScanState;
  mainWindow: BrowserWindow;
  config: ScanConfig;
  log: any;
  eventBus: EventBus;
  queueManager: TaskQueueManager;
  workerPool: WorkerPool;
  scheduler: SmartScheduler;
  sendProgressUpdate: (currentFile?: string) => void;
  resultLogThrottler: LogThrottler;
  calculateTimeout: (fileSize: number) => number;
  dynamicOldGenMB: number;
  dynamicYoungGenMB: number;
  poolSize: number;
}

/**
 * 智能内存计算函数 - 根据平均文件大小动态调整
 */
export function calculateSmartMemoryLimits(
  avgFileSizeMB: number,
  workerCount: number,
  freeMemoryMB: number
): { oldGen: number; youngGen: number } {
  // 根据平均文件大小调整内存分配策略
  let memoryMultiplier = 1.0;

  if (avgFileSizeMB > 50) {
    // 超大文件：增加内存限制，减少并发压力
    memoryMultiplier = 1.5;
  } else if (avgFileSizeMB > 10) {
    // 大文件：适度增加内存
    memoryMultiplier = 1.2;
  } else if (avgFileSizeMB < 1) {
    // 小文件：降低内存限制，提高并发效率
    memoryMultiplier = 0.6;
  }

  // 基础内存计算：取系统可用内存的 60% / Worker 数量
  const systemBasedLimit = Math.floor((freeMemoryMB * 0.6) / workerCount);

  // 配置限制的内存
  const configBasedLimit = Math.floor(
    (WORKER_MAX_OLD_GENERATION_MB + WORKER_MAX_YOUNG_GENERATION_MB) * memoryMultiplier
  );

  // 取两者中的较小值，确保不超过系统承受能力
  const baseMemoryPerWorker = Math.min(systemBasedLimit, configBasedLimit);

  // 设置最低和最高限制
  const minMemoryPerWorker = 256; // 最少 256MB，防止 PDF/DOCX 解析超时
  const maxMemoryPerWorker = Math.floor((freeMemoryMB * 0.8) / workerCount); // 最多使用 80% 可用内存

  const finalMemoryPerWorker = Math.max(
    minMemoryPerWorker,
    Math.min(baseMemoryPerWorker, maxMemoryPerWorker)
  );

  return {
    oldGen: Math.floor(finalMemoryPerWorker * 0.8),
    youngGen: Math.floor(finalMemoryPerWorker * 0.2),
  };
}

/**
 * 获取系统可用内存（macOS 特殊处理）
 */
export function getFreeMemoryMB(): number {
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      const output = execSync('vm_stat', { encoding: 'utf-8' });
      const pageSizeMatch = output.match(/page size of (\d+) bytes/);
      const freeMatch = output.match(/Pages free:\s+(\d+)/);
      const inactiveMatch = output.match(/Pages inactive:\s+(\d+)/);
      const speculativeMatch = output.match(/Pages speculative:\s+(\d+)/);

      if (pageSizeMatch && freeMatch && inactiveMatch) {
        const pageSize = parseInt(pageSizeMatch[1]);
        const freePages = parseInt(freeMatch[1]);
        const inactivePages = parseInt(inactiveMatch[1]);
        const speculativePages = speculativeMatch ? parseInt(speculativeMatch[1]) : 0;
        return ((freePages + inactivePages + speculativePages) * pageSize) / BYTES_TO_MB;
      }
    } catch (error) {
      // vm_stat 失败，使用 os.freemem()
    }
  }
  return os.freemem() / BYTES_TO_MB;
}

/**
 * 初始化扫描上下文
 */
export async function initializeScanner(
  config: ScanConfig,
  mainWindow: BrowserWindow,
  state: ScanState
): Promise<ScannerContext> {
  const log = getScannerLogger();

  // 计算并发数
  const concurrencyInfo = calculateActualConcurrency(config.scanConcurrency);
  const poolSize = concurrencyInfo.actualConcurrency;

  if (config.scanConcurrency && config.scanConcurrency > concurrencyInfo.maxAllowedConcurrency) {
    log.warn(
      '配置的并发数 {} 超过最大值 {}，已自动调整',
      config.scanConcurrency,
      concurrencyInfo.maxAllowedConcurrency
    );
    log.info(
      '系统可用内存 {} GB, CPU {} 核, 建议不超过 {}',
      concurrencyInfo.freeMemoryGB.toFixed(1),
      concurrencyInfo.cpuCount,
      concurrencyInfo.maxAllowedConcurrency
    );
  }

  log.info(
    '使用 {} 个 Consumer Workers (CPU: {}核, 可用内存: {}GB)',
    poolSize,
    concurrencyInfo.cpuCount,
    concurrencyInfo.freeMemoryGB.toFixed(1)
  );

  // 【新增】计算大文件并发数
  const maxLargeFilesConcurrent = calculateMaxLargeFilesConcurrent(
    poolSize,
    concurrencyInfo.freeMemoryGB,
    concurrencyInfo.cpuCount
  );

  log.info(
    '大文件并发限制: {} (Worker总数: {}, 可用内存: {}GB, CPU: {}核)',
    maxLargeFilesConcurrent,
    poolSize,
    concurrencyInfo.freeMemoryGB.toFixed(1),
    concurrencyInfo.cpuCount
  );

  // 根据扫描路径数智能配置 BatchSender
  const estimatedTotalFiles = config.selectedPaths.length * 1000;
  configureBatchSender(estimatedTotalFiles);
  log.info('[BatchSender]已根据扫描规模配置（预估文件数: {}）', estimatedTotalFiles);

  // 获取 EventBus 单例实例
  const eventBus = EventBus.getInstance();

  // 创建任务队列管理器
  const queueManager = new TaskQueueManager(eventBus);

  // 【修复】状态同步监听器已移至 SmartScheduler 中管理，此处不再需要

  // 日志抑制
  const resultLogThrottler = new LogThrottler({
    countInterval: RESULT_LOG_COUNT_INTERVAL,
    timeIntervalMs: RESULT_LOG_TIME_INTERVAL,
  });

  // 错误日志计数
  let errorLogCount = 0;

  // 内存配置
  const freeMemoryMB = getFreeMemoryMB();
  const dynamicOldGenMB = Math.floor(WORKER_MAX_OLD_GENERATION_MB * 0.9);
  const dynamicYoungGenMB = Math.floor(WORKER_MAX_YOUNG_GENERATION_MB * 0.9);

  log.info(
    '【内存优化】可用内存: {}MB, 初始每 Worker 限制: {}MB',
    freeMemoryMB.toFixed(0),
    dynamicOldGenMB + dynamicYoungGenMB
  );

  // 辅助函数
  const sendProgressUpdate = createProgressUpdater(
    mainWindow,
    () => state.getConsumerProcessedCount(),
    () => state.getWalkerTotalCount(),
    () => state.getWalkerFilteredCount(),
    () => state.getWalkerSkippedCount(),
    PROGRESS_THROTTLE_INTERVAL
  );

  // 创建 Worker 池回调接口
  const workerPoolCallbacks = {
    onUpdateConsumerCount: (taskId?: number) => {
      if (taskId !== undefined) {
        state.incrementConsumerProcessedCount(taskId);
      }
      state.decrementActiveWorkers();
    },
    onCleanupConsumerState: (consumer: Consumer) => {
      // 临时占位，将在 scheduler 创建后替换为实际实现
      if (consumer) {
        consumer.currentFileType = undefined;
        consumer.currentFileSize = undefined;
        consumer.taskStartTime = undefined;
      }
    },
    onSendProgressUpdate: sendProgressUpdate,
    onCheckAndComplete: () => {}, // 稍后由 scanner.ts 通过 updateCallback 设置
    onTryDispatch: () => {}, // 智能调度模式下无需主动分发，由事件驱动
    onErrorLog: (error: string) => {
      errorLogCount++;
      if (errorLogCount % ERROR_LOG_INTERVAL === 1) {
        log.info('处理文件失败: {}', error);
      } else if (errorLogCount % ERROR_LOG_INTERVAL === 0) {
        log.info('累计处理失败 {} 个文件', errorLogCount);
      }
    },
    onResultLog: (total: number, result: any) => {
      state.incrementResultCount();
      state.addTotalSensitiveItems(total);
      if (resultLogThrottler.shouldLog(state.getResultCount())) {
        log.info(
          '发现敏感文件 [{}]: {} (总计: {} 个敏感项)',
          state.getResultCount(),
          result.filePath,
          total
        );
      }
    },
    onResultBatchSend: (mainWindow: BrowserWindow, resultItem: any) => {
      resultBatchSender.send(mainWindow, 'scan-result', resultItem);
    },
    calculateTimeout: calculateTimeout,
    // 【新增】重启 Worker 回调 - 稍后设置
    onRestartWorker: (consumer: Consumer) => {}, // 临时占位
  };

  // 创建 Worker 池
  const workerPool = new WorkerPool(
    poolSize,
    eventBus,
    state,
    mainWindow,
    config,
    dynamicOldGenMB,
    dynamicYoungGenMB,
    workerPoolCallbacks
  );

  // 【关键】更新 onRestartWorker 回调为实际实现
  workerPoolCallbacks.onRestartWorker = (consumer: Consumer) => {
    workerPool.restartWorker(consumer);
  };

  // 【修复】状态同步监听器已移至 SmartScheduler 中管理，此处不再需要

  // 创建智能调度器
  const scheduler = new SmartScheduler(
    eventBus,
    queueManager,
    workerPool,
    (consumer: Consumer, task: any) => {
      workerPool.assignTaskToConsumer(
        consumer,
        task,
        scheduler.getProcessingTypeCount(),
        { value: scheduler.getLargeFilesProcessing() },
        scheduler.getLastTypeScheduleTime()
      );
      state.incrementActiveWorkers();
      workerPool.incrementNextTaskId();
    },
    state, // 【新增】传递 scanState，用于状态同步
    maxLargeFilesConcurrent // 【新增】传入动态计算的大文件并发限制
  );

  // 【关键】更新 cleanupConsumerState 回调为 scheduler 的实际实现
  workerPoolCallbacks.onCleanupConsumerState = scheduler.cleanupConsumerState.bind(scheduler);

  // 初始化调度器和 Worker 池
  scheduler.initialize();
  await workerPool.initialize();

  return {
    state,
    mainWindow,
    config,
    log,
    eventBus,
    queueManager,
    workerPool,
    scheduler,
    sendProgressUpdate,
    resultLogThrottler,
    calculateTimeout,
    dynamicOldGenMB,
    dynamicYoungGenMB,
    poolSize,
  };
}
