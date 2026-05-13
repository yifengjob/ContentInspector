/**
 * 扫描清理模块
 * 
 * 职责：
 * - 清理所有扫描相关资源
 * - 终止 Worker
 * - 清空队列和定时器
 * - 发送最终进度和完成事件
 */

import {BrowserWindow} from 'electron';
import {Worker} from 'worker_threads';
import {ScanState} from '../state';
import {WorkerPool} from '../worker';
import {TaskQueueManager} from '../queue';
import {EventBus} from '../infra';
import {SmartScheduler} from '../scheduler';
import {LogThrottler, resultBatchSender, sendToMainWindow} from './helpers/scanner-helpers';
import {StagnationDetector} from './scan-stagnation-detector';
import {Logger} from '../../logger/logger';

export interface CleanupOptions {
    state: ScanState;
    mainWindow: BrowserWindow;
    workerPool: WorkerPool;
    queueManager: TaskQueueManager;
    eventBus: EventBus;
    scheduler: SmartScheduler;  // 【新增】智能调度器
    resultLogThrottler: LogThrottler;
    log: Logger;  // 【修复】使用明确的 Logger 类型，替代 any
    walkerWorker: Worker;  // 【修复】使用明确的 Worker 类型，替代 any
    stagnationDetector?: StagnationDetector; // 停滞检测器
}

export class ScanCleanup {
    private readonly options: CleanupOptions;
    private isCleaningUp = false;

    constructor(options: CleanupOptions) {
        this.options = options;
    }

    /**
     * 执行清理
     */
    cleanup(): void {
        if (this.isCleaningUp) {
            this.options.log.info('[cleanup] 警告: cleanup 已被调用，忽略重复调用');
            return;
        }
        this.isCleaningUp = true;

        this.options.log.info('[cleanup] 开始清理资源...');

        try {
            // 1. 停止停滞检测器
            this.stopStagnationDetector();

            // 2. 终止 Walker Worker
            this.terminateWalkerWorker();

            // 3. 清理 Worker 池
            this.options.workerPool.cleanup();

            // 4. 清空任务队列
            this.options.queueManager.clearAll();

            // 5. 重置日志节流器
            this.options.resultLogThrottler.reset();

            // 6. 销毁批量发送器（先 flush 剩余数据）
            resultBatchSender.flushAndDestroy(this.options.mainWindow, 'scan-result');

            // 7. 发送最终进度更新
            this.sendFinalProgressUpdate();

            // 8. 更新扫描状态
            this.options.state.isScanning = false;
            this.options.log.info('扫描完成');

            // 9. 发送完成事件
            sendToMainWindow(this.options.mainWindow, 'scan-finished', null);

            this.options.log.info('[cleanup] 资源清理完成');

            // 10. 【修复】销毁调度器，清除扫描相关的事件监听器（保留日志监听器）
            this.options.scheduler.destroy();

            // 11. 【监控】验证监听器状态
            this.verifyListenerCleanup();

            // 12. 触发垃圾回收（在所有资源清理完成后）
            this.triggerGC();
        } catch (error) {
            this.options.log('[cleanup] 清理过程中出错: ' + error);
            this.options.state.isScanning = false;
        }
    }

    /**
     * 停止停滞检测器
     */
    private stopStagnationDetector(): void {
        if (this.options.stagnationDetector) {
            this.options.stagnationDetector.stop();
        }
    }

    /**
     * 终止 Walker Worker
     */
    private terminateWalkerWorker(): void {
        try {
            const {walkerWorker} = this.options;
            if (walkerWorker) {
                walkerWorker.postMessage({type: 'cancel-all'});
                walkerWorker.removeAllListeners();
                // 【修复】正确处理 terminate 返回的 Promise
                void walkerWorker.terminate();
            }
        } catch (error) {
            this.options.log.info(`终止 Walker Worker 失败: ${error}`);
        }
    }

    /**
     * 发送最终进度更新
     */
    private sendFinalProgressUpdate(): void {
        const {mainWindow, state} = this.options;

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
    }

    /**
     * 触发垃圾回收
     */
    private triggerGC(): void {
        if ((global as any).gc) {
            this.options.log.info('[cleanup] 触发垃圾回收...');
            (global as any).gc();
        }
    }

    /**
     * 【监控】验证监听器清理状态
     * 
     * 职责：
     * - 输出所有事件的监听器数量
     * - 检测非预期的监听器（内存泄漏风险）
     * - 检查日志监听器是否存在
     */
    private verifyListenerCleanup(): void {
        const {eventBus, log} = this.options;
        
        // 1. 输出所有事件的监听器状态
        const allStats = eventBus.getAllListenerStats();
        const statsArray = Array.from(allStats.entries())
            .map(([event, count]) => `${event}=${count}`)
            .join(', ');
        log.info(`[cleanup] 事件监听器状态: ${statsArray || '无监听器'}`);
        
        // 2. 检查是否有非预期的监听器（期望只有 log:message）
        const unexpectedListeners = eventBus.checkUnexpectedListeners(['log:message']);
        if (unexpectedListeners.length > 0) {
            const details = unexpectedListeners.map(({ event, count }) => `${event}(${count})`).join(', ');
            log.warn(`[cleanup] ⚠️ 检测到非预期监听器: ${details}，可能存在内存泄漏风险！`);
        }
        
        // 3. 检查日志监听器是否存在
        const logMessageCount = eventBus.getListenerCount('log:message');
        if (logMessageCount === 0) {
            log.warn('[cleanup] ⚠️ 日志监听器也被清除了，第二次扫描时将无法显示日志！');
        }
    }
}
