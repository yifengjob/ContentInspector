/**
 * 扫描器主入口 - 协调层
 *
 * 职责：
 * - 协调各个模块完成扫描任务
 * - 处理 Walker Worker 消息
 * - 管理扫描生命周期
 * - 停滞检测和完成判断
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {Worker} from 'worker_threads';
import {BrowserWindow} from 'electron';
import {ScanConfig} from '../types';
import {ScanState} from './scan-state';
import {calculateActualConcurrency} from './config-manager';
import {
    WORKER_MAX_OLD_GENERATION_MB,
    WORKER_MAX_YOUNG_GENERATION_MB,
    STAGNATION_CHECK_INTERVAL,
    STAGNATION_THRESHOLD,
    MAX_IDLE_TIME,
    PROGRESS_THROTTLE_INTERVAL,
    BYTES_TO_MB,
    LARGE_FILE_THRESHOLD_MB,
    ERROR_LOG_INTERVAL,
    RESULT_LOG_COUNT_INTERVAL,
    RESULT_LOG_TIME_INTERVAL
} from './scan-config';
import {
    createProgressUpdater,
    sendToMainWindow,
    calculateTimeout as calcTimeout,
    resultBatchSender,
    configureBatchSender,
    LogThrottler
} from '../utils/scanner-helpers';
import {getFileType} from '../utils/file-types';
import {EventBus} from './event-bus';
import {TaskQueueManager, Task} from './task-queue';
import {WorkerPool, Consumer} from './worker-pool';
import {SmartScheduler} from './smart-scheduler';
import {getScannerLogger} from "../logger/logger";

export async function startScan(
    config: ScanConfig,
    mainWindow: BrowserWindow,
    scanState?: ScanState  // 【优化】可选参数，默认使用单例
): Promise<void> {
    // 【优化】如果没有传入 scanState，则使用单例
    const state = scanState || ScanState.getInstance();
    
    if (state.isScanning) {
        throw new Error('扫描正在进行中');
    }

    state.isScanning = true;
    state.cancelFlag = false;
    state.logs = [];
    
    // 【重构】重置扫描状态管理器
    state.reset();

    // 1. 创建日志记录器
    const log = getScannerLogger();

    log.info('开始扫描...');
    log.info(`扫描路径数: ${config.selectedPaths.length}`);
    log.info(`文件类型数: ${config.selectedExtensions.length}`);
    log.info(`选中的扩展名: ${config.selectedExtensions.join(', ')}`);
    log.info(`敏感检测类型: ${config.enabledSensitiveTypes.join(', ')}`);
    log.info('---');

    // 计算并发数
    const concurrencyInfo = calculateActualConcurrency(config.scanConcurrency);
    const poolSize = concurrencyInfo.actualConcurrency;

    if (config.scanConcurrency && config.scanConcurrency > concurrencyInfo.maxAllowedConcurrency) {
        log.warn(`配置的并发数 ${config.scanConcurrency} 超过最大值 ${concurrencyInfo.maxAllowedConcurrency}，已自动调整`);
        log.info(`系统可用内存 ${concurrencyInfo.freeMemoryGB.toFixed(1)} GB, CPU ${concurrencyInfo.cpuCount} 核, 建议不超过 ${concurrencyInfo.maxAllowedConcurrency}`);
    }

    log.info(`使用 ${poolSize} 个 Consumer Workers (CPU: ${concurrencyInfo.cpuCount}核, 可用内存: ${concurrencyInfo.freeMemoryGB.toFixed(1)}GB)`);

    // 【优化】根据扫描路径数智能配置 BatchSender
    // 粗略估计：每个路径平均 1000 个文件
    const estimatedTotalFiles = config.selectedPaths.length * 1000;
    configureBatchSender(estimatedTotalFiles);
    log.info(`【BatchSender】已根据扫描规模配置（预估文件数: ${estimatedTotalFiles}）`);

    // ==================== 【初始化模块】====================

    // 2. 获取 EventBus 单例实例
    const eventBus = EventBus.getInstance();

    // 3. 创建任务队列管理器
    const queueManager = new TaskQueueManager(eventBus);
    
    // 【状态同步】监听队列长度变化并更新 ScanState
    eventBus.on('task-queue-length-changed', (length: number) => {
        state.setTaskQueueLength(length);
    });

    // 4. 统计信息 - 【重构】使用 ScanState 统一管理
    // 注意：walkerTotalCount, walkerFilteredCount, walkerSkippedCount, consumerProcessedCount,
    //       resultCount, totalSensitiveItems, activeWorkerCount, countedTaskIds 等都已移到 scanState 中管理

    // 5. 日志抑制
    let errorLogCount = 0;
    const resultLogThrottler = new LogThrottler({
        countInterval: RESULT_LOG_COUNT_INTERVAL,
        timeIntervalMs: RESULT_LOG_TIME_INTERVAL
    });

    // 6. 智能调度状态（由 SmartScheduler 统一管理）
    // 【重构】移除冗余的 largeFilesProcessing 本地变量，直接使用 scheduler.getLargeFilesProcessing()

    // 7. 内存配置 - 【关键】macOS 需要使用 vm_stat 获取准确可用内存
    const freeMemoryMB = (process.platform === 'darwin'
        ? (() => {
            try {
                const {execSync} = require('child_process');
                const output = execSync('vm_stat', {encoding: 'utf-8'});
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
                log.warn('[内存计算] vm_stat 失败，使用 os.freemem()');
            }
            return os.freemem() / BYTES_TO_MB;
        })()
        : os.freemem() / BYTES_TO_MB);

    // 初始内存配置（使用默认值的 90%）
    let dynamicOldGenMB = Math.floor(WORKER_MAX_OLD_GENERATION_MB * 0.9);
    let dynamicYoungGenMB = Math.floor(WORKER_MAX_YOUNG_GENERATION_MB * 0.9);

    // 【新增】智能内存计算函数 - 根据平均文件大小动态调整
    function calculateSmartMemoryLimits(avgFileSizeMB: number, workerCount: number): {
        oldGen: number;
        youngGen: number
    } {
        // 根据平均文件大小调整内存分配策略
        let memoryMultiplier = 1.0;

        if (avgFileSizeMB > 50) {
            // 超大文件：增加内存限制，减少并发压力
            memoryMultiplier = 1.5;
            log.info(`【智能内存】检测到大文件（平均 ${avgFileSizeMB.toFixed(1)}MB），增加 Worker 内存至 ${memoryMultiplier}x`);
        } else if (avgFileSizeMB > 10) {
            // 大文件：适度增加内存
            memoryMultiplier = 1.2;
            log.info(`【智能内存】检测到中大文件（平均 ${avgFileSizeMB.toFixed(1)}MB），适度增加 Worker 内存`);
        } else if (avgFileSizeMB < 1) {
            // 小文件：降低内存限制，提高并发效率
            memoryMultiplier = 0.6;
            log.info(`【智能内存】检测到小文件（平均 ${avgFileSizeMB.toFixed(2)}MB），降低 Worker 内存以节省资源`);
        }

        // 基础内存计算：取系统可用内存的 60% / Worker 数量
        const systemBasedLimit = Math.floor(freeMemoryMB * 0.6 / workerCount);

        // 配置限制的内存
        const configBasedLimit = Math.floor(
            (WORKER_MAX_OLD_GENERATION_MB + WORKER_MAX_YOUNG_GENERATION_MB) * memoryMultiplier
        );

        // 取两者中的较小值，确保不超过系统承受能力
        const baseMemoryPerWorker = Math.min(systemBasedLimit, configBasedLimit);

        // 设置最低和最高限制
        const minMemoryPerWorker = 256; // 【修复】最少 256MB，防止 PDF/DOCX 解析超时
        const maxMemoryPerWorker = Math.floor(freeMemoryMB * 0.8 / workerCount); // 最多使用 80% 可用内存

        const finalMemoryPerWorker = Math.max(
            minMemoryPerWorker,
            Math.min(baseMemoryPerWorker, maxMemoryPerWorker)
        );

        return {
            oldGen: Math.floor(finalMemoryPerWorker * 0.8),
            youngGen: Math.floor(finalMemoryPerWorker * 0.2)
        };
    }

    // 初始日志
    log.info(`【内存优化】可用内存: ${freeMemoryMB.toFixed(0)}MB, 初始每 Worker 限制: ${dynamicOldGenMB + dynamicYoungGenMB}MB`);

    // 8. 辅助函数 - 【重构】使用 ScanState 统一管理状态
    const sendProgressUpdate = createProgressUpdater(
        mainWindow,
        () => state.getConsumerProcessedCount(),
        () => state.getWalkerTotalCount(),
        () => state.getWalkerFilteredCount(),
        () => state.getWalkerSkippedCount(),
        PROGRESS_THROTTLE_INTERVAL
    );

    const calculateTimeout = (fileSize: number) => calcTimeout(fileSize);

    // 【优化】声明 cleanupConsumerState 引用，稍后由 scheduler 提供实现
    let cleanupConsumerStateRef: { fn: (consumer: Consumer) => void } = {
        fn: (consumer: Consumer): void => {
            // 临时空实现，在 scheduler 创建后会被替换
            if (consumer) {
                consumer.currentFileType = undefined;
                consumer.currentFileSize = undefined;
                consumer.taskStartTime = undefined;
            }
        }
    };

    // 包装函数，通过引用动态获取最新实现
    const cleanupConsumerState = (consumer: Consumer): void => {
        cleanupConsumerStateRef.fn(consumer);
    };

    // 9. 回调函数（供 WorkerPool 和 SmartScheduler 使用）
    // 【重构】不再需要本地的 activeWorkerCount，统一使用 scanState

    function onErrorLog(error: string): void {
        errorLogCount++;
        if (errorLogCount % ERROR_LOG_INTERVAL === 1) {
            log.info(`处理文件失败: ${error}`);
        } else if (errorLogCount % ERROR_LOG_INTERVAL === 0) {
            log.info(`累计处理失败 ${errorLogCount} 个文件`);
        }
    }

    function onResultLog(total: number, result: any): void {
        state.incrementResultCount();
        state.addTotalSensitiveItems(total);
        if (resultLogThrottler.shouldLog(state.getResultCount())) {
            log.info(`发现敏感文件 [${state.getResultCount()}]: ${result.filePath} (总计: ${total} 个敏感项)`);
        }
    }

    function onResultBatchSend(mainWindow: BrowserWindow, resultItem: any): void {
        resultBatchSender.send(mainWindow, 'scan-result', resultItem);
    }

    // 【重构】封装 WorkerPool 回调为接口
    const workerPoolCallbacks = {
        onUpdateConsumerCount: (taskId?: number) => {
            // 【重构】使用 state 管理 activeWorkerCount
            if (taskId !== undefined) {
                state.incrementConsumerProcessedCount(taskId);
            }
            state.decrementActiveWorkers();
        },
        onCleanupConsumerState: cleanupConsumerState,
        onSendProgressUpdate: sendProgressUpdate,
        onCheckAndComplete: checkAndComplete,
        onTryDispatch: tryDispatch,
        onErrorLog: onErrorLog,
        onResultLog: onResultLog,
        onResultBatchSend: onResultBatchSend,
        calculateTimeout: calculateTimeout
    };

    // 10. 创建 Worker 池 - 【重构】使用接口封装回调
    const workerPool = new WorkerPool(
        poolSize,
        eventBus,
        state,
        mainWindow,
        config,
        dynamicOldGenMB,
        dynamicYoungGenMB,
        workerPoolCallbacks  // 【重构】传递回调接口
    );
    
    // 【状态同步】监听待处理任务数变化并更新 ScanState
    eventBus.on('pending-tasks-size-changed', (size: number) => {
        state.setPendingTasksSize(size);
    });

    // 10. 创建智能调度器（统一管理调度状态）
    const scheduler = new SmartScheduler(
        eventBus,
        queueManager,
        workerPool,
        (consumer: Consumer, task: Task) => {
            // 【优化】使用 scheduler 内部的状态管理，避免重复
            workerPool.assignTaskToConsumer(
                consumer,
                task,
                scheduler.getProcessingTypeCount(),
                {value: scheduler.getLargeFilesProcessing()},
                scheduler.getLastTypeScheduleTime()
            );

            // 【重构】使用 state 管理 activeWorkerCount
            state.incrementActiveWorkers();
            workerPool.incrementNextTaskId();
        }
    );

    // 【优化】替换 cleanupConsumerState 的实现为 scheduler 的版本
    cleanupConsumerStateRef.fn = scheduler.cleanupConsumerState.bind(scheduler);

    // 11. 初始化调度器
    scheduler.initialize();

    // 12. 初始化 Worker 池
    await workerPool.initialize();

    // ==================== 【Walker Worker】====================

    const walkerWorker = new Worker(path.join(__dirname, '..', 'workers', 'walker-worker.js'));

    let lastActivityTime = Date.now();
    let lastProgressUpdateTime = 0;
    let lastTaskEnqueueTime = Date.now();

    // Walker 消息处理
    walkerWorker.on('message', (message: any) => {
        try {
            if (message.type === 'files-batch') {
                const files = message.files;

                if (!files || files.length === 0) {
                    return;
                }

                for (const file of files) {
                    state.incrementWalkerTotalCount();  // 【重构】使用 state

                    if (state.getWalkerTotalCount() % 100 === 0 || Date.now() - lastProgressUpdateTime > 1000) {
                        sendProgressUpdate(file.filePath);
                        lastProgressUpdateTime = Date.now();
                    }

                    const fileType = getFileType(file.filePath);
                    const isLargeFile = file.stat.size > LARGE_FILE_THRESHOLD_MB * BYTES_TO_MB;
                    queueManager.enqueueTask({
                        filePath: file.filePath,
                        fileSize: file.stat.size,
                        fileMtime: file.stat.mtime,
                        enqueueTime: Date.now(),
                        fileType,
                        isLargeFile
                    });
                }

                lastActivityTime = Date.now();
                lastTaskEnqueueTime = Date.now();

                eventBus.emit('walker.batch-ready');
            }

            if (message.type === 'walking-complete') {
                log.info(`Walker 完成: 找到 ${message.fileCount} 个文件, 过滤 ${message.filteredCount || 0} 个, 跳过 ${message.skippedCount} 个`);

                // 【Bug2修复】walkerTotalCount 应该包含所有文件（找到+过滤+跳过）
                // 遍历过程中只累加了 fileCount，需要补充 filteredCount 和 skippedCount
                state.addWalkerTotalCount((message.filteredCount || 0) + message.skippedCount);
                state.addWalkerFilteredCount(message.filteredCount || 0);
                state.addWalkerSkippedCount(message.skippedCount);

                // 【关键修复】Walker 完成后立即发送进度更新，确保前端 totalCount 包含所有文件
                sendProgressUpdate();

                walkerCompletedCount++;

                if (walkerCompletedCount > totalWalkerTasks) {
                    log.warn(`[Walker] 警告: 完成计数 (${walkerCompletedCount}) 超过总任务数 (${totalWalkerTasks})`);
                    walkerCompletedCount = totalWalkerTasks;
                }

                log.info(`[Walker] 已完成 ${walkerCompletedCount}/${totalWalkerTasks} 个任务`);

                // 【A1 优化】Walker 完成后，根据实际文件大小重新计算内存限制
                if (state.getTaskQueueLength() > 0) {
                    // 【关键修复】从 queueManager 获取所有任务来计算平均大小
                    const stats = queueManager.getAllTasksStats();
                    const avgFileSizeMB = stats.totalCount > 0
                        ? (stats.totalSize / stats.totalCount) / BYTES_TO_MB
                        : 0;

                    if (stats.totalCount > 0) {
                        // 计算新的内存限制
                        const newLimits = calculateSmartMemoryLimits(avgFileSizeMB, poolSize);
                        dynamicOldGenMB = newLimits.oldGen;
                        dynamicYoungGenMB = newLimits.youngGen;

                        log.info(`【智能内存调整】平均文件大小: ${avgFileSizeMB.toFixed(2)}MB, 新内存限制: 老生代=${dynamicOldGenMB}MB, 新生代=${dynamicYoungGenMB}MB`);

                        // 【关键】重启所有空闲的 Consumer Workers 以应用新配置
                        // 【修复】延迟 100ms 确保所有 Worker 的状态已同步
                        setTimeout(() => {
                            const restartedCount = workerPool.restartIdleWorkers(dynamicOldGenMB, dynamicYoungGenMB);

                            if (restartedCount > 0) {
                                log.info(`【智能内存】已重启 ${restartedCount} 个空闲 Worker 以应用新内存配置`);

                                // 【新增】批量重启后强制 GC，释放内存
                                if ((global as any).gc) {
                                    log.info(`【智能内存】执行强制垃圾回收...`);
                                    (global as any).gc();
                                }
                            }
                        }, 100);
                    } else {
                        log.info(`【智能内存调整】平均文件大小: ${avgFileSizeMB.toFixed(2)}MB`);
                    }
                }

                checkAndComplete();
            }

            if (message.type === 'walking-error') {
                log.error(`Walker 错误: ${message.error}`);
                checkAndComplete();
            }
        } catch (error: any) {
            log.error(`[Walker] 处理消息失败: ${error.message}`);
        }
    });

    walkerWorker.on('error', (error: any) => {
        log.error(`Walker Worker 错误: ${error.message}`);
        checkAndComplete();
    });

    walkerWorker.on('exit', (code) => {
        if (code !== 0) {
            log.info(`Walker Worker 异常退出，代码: ${code}`);
        }
    });

    // ==================== 【停滞检测和完成判断】====================

    let completionCheckTimer: NodeJS.Timeout | null = null;
    let isCleaningUp = false;
    let walkerCompletedCount = 0;
    const totalWalkerTasks = config.selectedPaths.length;

    let lastStagnationCheckState = {
        processed: state.getConsumerProcessedCount(),
        total: state.getWalkerTotalCount(),
        filtered: state.getWalkerFilteredCount(),
        skipped: state.getWalkerSkippedCount(),
        results: state.getResultCount(),
        sensitiveItems: state.getTotalSensitiveItems(),
        taskQueueLength: state.getTaskQueueLength(),
        pendingTasksSize: state.getPendingTasksSize(),
        activeWorkers: state.getActiveWorkerCount(),
        lastEnqueueTime: Date.now()
    };
    let lastStagnationCheckTime = Date.now();

    function checkAndComplete() {
        if (state.cancelFlag) {
            cleanup();
            return;
        }

        const allWalkersCompleted = walkerCompletedCount >= totalWalkerTasks;

        // 【重构】使用 state.isScanComplete 统一完成条件判断
        if (state.isScanComplete(allWalkersCompleted)) {
            log.info(`扫描完成: 遍历 ${state.getWalkerTotalCount()} 个文件, 处理 ${state.getConsumerProcessedCount()} 个, 跳过 ${state.getWalkerSkippedCount()} 个, 发现 ${state.getResultCount()} 个敏感文件`);
            cleanup();
            return;
        }

        lastActivityTime = Date.now();
    }

    function tryDispatch() {
        // 智能调度模式下，由事件驱动，无需主动分发
    }

    // 停滞检测定时器
    completionCheckTimer = setInterval(() => {
        const now = Date.now();

        const hasRealProgress =
            state.getConsumerProcessedCount() !== lastStagnationCheckState.processed ||
            state.getWalkerTotalCount() !== lastStagnationCheckState.total ||
            state.getWalkerFilteredCount() !== lastStagnationCheckState.filtered ||
            state.getWalkerSkippedCount() !== lastStagnationCheckState.skipped ||
            state.getResultCount() !== lastStagnationCheckState.results ||
            state.getTotalSensitiveItems() !== lastStagnationCheckState.sensitiveItems ||
            state.getTaskQueueLength() !== lastStagnationCheckState.taskQueueLength ||
            state.getPendingTasksSize() !== lastStagnationCheckState.pendingTasksSize ||
            state.getActiveWorkerCount() !== lastStagnationCheckState.activeWorkers ||
            lastTaskEnqueueTime !== lastStagnationCheckState.lastEnqueueTime;

        if (hasRealProgress) {
            lastStagnationCheckState = {
                processed: state.getConsumerProcessedCount(),
                total: state.getWalkerTotalCount(),
                filtered: state.getWalkerFilteredCount(),
                skipped: state.getWalkerSkippedCount(),
                results: state.getResultCount(),
                sensitiveItems: state.getTotalSensitiveItems(),
                taskQueueLength: state.getTaskQueueLength(),
                pendingTasksSize: state.getPendingTasksSize(),
                activeWorkers: state.getActiveWorkerCount(),
                lastEnqueueTime: lastTaskEnqueueTime
            };
            lastStagnationCheckTime = now;
        } else {
            const idleTime = now - lastStagnationCheckTime;

            if (idleTime > STAGNATION_THRESHOLD && idleTime <= MAX_IDLE_TIME) {
                log.warn(`提示: ${idleTime / 1000}秒内无任何进展（活跃Worker:${state.getActiveWorkerCount()}, 队列:${state.getTaskQueueLength()}, 待处理:${state.getPendingTasksSize()}），但仍在等待可能的恢复...`);
            }

            if (idleTime > MAX_IDLE_TIME
                || (idleTime > STAGNATION_THRESHOLD
                    && state.getTaskQueueLength() <= 0
                    && state.getPendingTasksSize() <= 0
                    && state.getActiveWorkerCount() <= 0
                    && (state.getConsumerProcessedCount() + state.getWalkerFilteredCount() + state.getWalkerSkippedCount()) >= state.getWalkerTotalCount())
            ) {
                log.error(`警告: ${idleTime / 1000}秒内无任何进展，强制结束`);

                for (const pending of workerPool.getPendingTasks().values()) {
                    clearTimeout(pending.timeoutId);
                    pending.reject(new Error('扫描超时强制结束'));
                }
                workerPool.getPendingTasks().clear();
                cleanup();
            }
        }
    }, STAGNATION_CHECK_INTERVAL);

    // ==================== 【清理函数】====================

    function cleanup() {
        if (isCleaningUp) {
            log.info('[cleanup] 警告: cleanup 已被调用，忽略重复调用');
            return;
        }
        isCleaningUp = true;

        log.info('[cleanup] 开始清理资源...');

        try {
            if (completionCheckTimer) {
                clearInterval(completionCheckTimer);
                completionCheckTimer = null;
            }

            // 终止 Walker Worker
            try {
                walkerWorker.postMessage({type: 'cancel-all'});
                walkerWorker.removeAllListeners();
                walkerWorker.terminate();
                (walkerWorker as any) = null;
            } catch (error) {
                log.info(`终止 Walker Worker 失败: ${error}`);
            }

            // 清理 Worker 池
            workerPool.cleanup();

            // 清空任务队列
            queueManager.clearAll();

            // 清空计数
            errorLogCount = 0;
            resultLogThrottler.reset();

            // 销毁批量发送器 - 【关键修复】先 flush 剩余数据
            resultBatchSender.flushAndDestroy(mainWindow, 'scan-result');

            // 【关键修复】发送最终进度更新，确保前端显示正确的已处理/总数
            if (mainWindow && !mainWindow.isDestroyed()) {
                const finalScanned = state.getConsumerProcessedCount();
                const finalTotal = state.getWalkerTotalCount();
                const safeTotal = Math.max(finalTotal, finalScanned);
                
                mainWindow.webContents.send('scan-progress', {
                    currentFile: '',
                    scannedCount: finalScanned,
                    totalCount: safeTotal,
                    filteredCount: state.getWalkerFilteredCount(),
                    skippedCount: state.getWalkerSkippedCount()
                });
            }

            state.isScanning = false;
            log.info('扫描完成');

            sendToMainWindow(mainWindow, 'scan-finished', null);

            log.info('[cleanup] 资源清理完成');

            if ((global as any).gc) {
                log.info('[cleanup] 触发垃圾回收...');
                (global as any).gc();
            }

            // 【移除】destroy 方法已不再需要
            eventBus.clearAll();
        } catch (error) {
            log('[cleanup] 清理过程中出错: ' + error);
            state.isScanning = false;
        }
    }

    // ==================== 【启动扫描】====================

    // 【修复】定义取消函数，可以访问局部变量
    const doCancelScan = () => {
        if (state.cancelFlag) {
            log.info('[取消扫描] 已经在取消过程中，忽略重复请求');
            return;
        }
        
        log.info('[取消扫描] 收到取消请求，正在停止扫描...');
        state.cancelFlag = true;
        
        // 清除停滞检测定时器，防止干扰
        if (completionCheckTimer) {
            clearInterval(completionCheckTimer);
            completionCheckTimer = null;
            log.info('[取消扫描] 已清除停滞检测定时器');
        }
        
        // 立即清理资源，停止所有 Worker
        log.info('[取消扫描] 开始调用 cleanup...');
        cleanup();
        log.info('[取消扫描] cleanup 调用完成');
    };

    // 将取消函数挂载到 ScanState，供外部调用
    (state as any).doCancelScan = doCancelScan;

    const totalPaths = config.selectedPaths.length;
    let currentPathIndex = 0;

    for (const rootPath of config.selectedPaths) {
        currentPathIndex++;

        if (state.cancelFlag) {
            log.info('扫描已取消');
            break;
        }

        // 【关键修复】使用异步文件操作，防止阻塞主线程
        try {
            const stat = await fs.promises.stat(rootPath);
            if (stat.isFile()) {
                const basename = path.basename(rootPath);
                if (config.ignoreDirNames.includes(basename)) {
                    log.info(`跳过忽略的文件: ${rootPath}`);
                    continue;
                }
            }
        } catch (error: any) {
            log.info(`无法访问路径: ${rootPath} - ${error.message}`);
            continue;
        }

        log.info(`正在扫描: ${rootPath} (${currentPathIndex}/${totalPaths})`);

        // 【关键修复】使用异步检查，防止阻塞主线程
        try {
            await fs.promises.access(rootPath, fs.constants.F_OK);
        } catch (error: any) {
            log.info(`路径不存在或无权限: ${rootPath}`);
            continue;
        }

        walkerWorker.postMessage({
            type: 'start-walking',
            config: {
                rootPath,
                selectedExtensions: config.selectedExtensions,
                ignoreDirNames: config.ignoreDirNames,
                systemDirs: config.systemDirs,
                maxFileSizeMb: config.maxFileSizeMb,
                maxPdfSizeMb: config.maxPdfSizeMb
            }
        });
    }
}

export function cancelScan(scanState?: ScanState): void {
    const state = scanState || ScanState.getInstance();
    
    // 【修复】如果存在内部的取消函数，调用它以真正停止扫描
    if ((state as any).doCancelScan) {
        (state as any).doCancelScan();
    } else {
        // 后备方案：仅设置标志（适用于未通过 startScan 启动的情况）
        // 注意：正常情况下不应该走到这里，因为 doCancelScan 应该在 startScan 中挂载
        state.cancelFlag = true;
    }
}
