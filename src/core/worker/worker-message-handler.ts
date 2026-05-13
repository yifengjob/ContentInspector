/**
 * Worker 消息处理模块
 * 
 * 职责：
 * - 处理 Worker 发送的消息
 * - 任务超时管理
 * - 任务结果处理
 */

import type {Consumer, PendingTask, WorkerPoolCallbacks} from './worker-pool-types';
import type {BrowserWindow} from 'electron';
import type {EventBus} from '../infra/event-bus';
import type {ScanState} from '../state/scan-state';
import {Logger} from '../../logger/logger';
import {markConsumerIdle} from './worker-utils';
import {WORKER_RESTART_DELAY} from '../config/constants';

/**
 * Worker 消息处理器
 */
export class WorkerMessageHandler {
    private readonly log: Logger;

    constructor(
        private pendingTasks: Map<number, PendingTask>,
        private scanState: ScanState,
        private eventBus: EventBus,
        private mainWindow: BrowserWindow,
        private callbacks: WorkerPoolCallbacks,
        log: Logger
    ) {
        this.log = log;
    }

    /**
     * 设置 Worker 消息监听器
     */
    setupMessageListener(consumer: Consumer): void {
        consumer.worker.on('message', (result: any) => {
            // 【新增】处理日志消息
            if (result.type === 'log') {
                // 委托给 LogManager 处理（通过全局 EventBus）
                const eventBus = this.eventBus;
                if (eventBus) {
                    eventBus.emit('log:message', {
                        level: result.level,
                        message: `[Worker #${consumer.id}] ${result.message}`,
                        context: result.context || 'Worker',
                        timestamp: result.timestamp
                    });
                }
                return; // 不再继续处理其他逻辑
            }

            if (result.type === 'ready') {
                return;
            }

            const taskId = result.taskId;
            const pending = this.pendingTasks.get(taskId);

            if (!pending) {
                // Worker 返回空结果
                markConsumerIdle(consumer);
                // 【重构】使用 scanState 管理 activeWorkerCount
                this.scanState.decrementActiveWorkers();
                this.callbacks.onUpdateConsumerCount(taskId);
                this.callbacks.onCleanupConsumerState(consumer);

                // 【事件总线】发布 Worker 空闲事件
                this.eventBus.emit('worker.idle', consumer);
                return;
            }

            // 清除超时定时器
            clearTimeout(pending.timeoutId);
            this.pendingTasks.delete(taskId);
            
            // 【状态同步】通知待处理任务数变化
            this.eventBus.emit('pending-tasks-size-changed', this.pendingTasks.size);

            // 标记 Worker 为空闲
            markConsumerIdle(consumer);
            // 【重构】使用 scanState 管理 activeWorkerCount
            this.scanState.decrementActiveWorkers();
            this.callbacks.onUpdateConsumerCount(taskId);
            this.callbacks.onCleanupConsumerState(consumer);

            // 更新最后活动时间（通过事件触发）

            // 更新进度
            this.callbacks.onSendProgressUpdate(result.filePath || '');

            // 处理结果
            if (result.error) {
                this.callbacks.onErrorLog(result.error);
                pending.reject(new Error(result.error));
            } else {
                if (result.total && result.total > 0) {
                    this.callbacks.onResultLog(result.total, result);

                    const resultItem = {
                        filePath: result.filePath,
                        fileSize: result.fileSize || 0,
                        modifiedTime: result.modifiedTime || new Date().toISOString(),
                        counts: result.counts || {},
                        total: result.total,
                        unsupportedPreview: false
                    };

                    // 【P3优化】使用批量发送
                    this.callbacks.onResultBatchSend(this.mainWindow, resultItem);
                }
                pending.resolve(result);
            }

            // 【真正的事件驱动】Worker 完成任务后变为空闲
            this.eventBus.emit('worker.idle', consumer);

            // 检查是否应该结束
            try {
                this.callbacks.onCheckAndComplete();
            } catch (error: any) {
                this.log.error(`[Consumer ${consumer.id}] 检查完成状态失败: ${error.message}`);
                // 【修复】不静默吞掉错误，通知调用者
                this.callbacks.onErrorLog(`检查完成状态失败: ${error.message}`);
            }
        });
    }

    /**
     * 设置 Worker 错误监听器
     */
    setupErrorListener(consumer: Consumer): void {
        consumer.worker.on('error', (error: any) => {
            this.log.error(`[Consumer ${consumer.id}] Worker 错误: ${error.message}`);
            // 【重构】使用 scanState 管理 activeWorkerCount
            this.scanState.decrementActiveWorkers();
            this.callbacks.onUpdateConsumerCount(consumer.taskId);
        });
    }

    /**
     * 设置 Worker 退出监听器
     */
    setupExitListener(consumer: Consumer): void {
        consumer.worker.on('exit', (code: number, signal: string | null) => {
            // 区分主动终止和异常退出
            if (signal) {
                this.log.warn(`[Consumer ${consumer.id}] Worker 被信号终止: ${signal}, 代码: ${code}`);
            }

            if (consumer.isTerminating) {
                // 主动终止（超时等情况），不视为异常
                this.log.info(`[Consumer ${consumer.id}] Worker 已终止（代码: ${code}）`);
                consumer.isTerminating = false;
                consumer.busy = false;
                this.callbacks.onCleanupConsumerState(consumer);
                return;
            }

            if (code !== 0 && !this.scanState.cancelFlag) {
                this.log.error(`[Consumer ${consumer.id}] Worker 异常退出，代码: ${code}, 信号: ${signal || 'none'}`);

                // 检测是否是 OOM 导致的退出
                const isOOM = signal === 'SIGABRT' || code === 134;
                if (isOOM) {
                    this.log.error(`[Consumer ${consumer.id}] ⚠️ 检测到 Worker OOM！将重启 Worker 并跳过当前文件`);
                }

                // 【重构】使用 scanState 管理 activeWorkerCount
                this.scanState.decrementActiveWorkers();
                this.callbacks.onUpdateConsumerCount(consumer.taskId);
                this.callbacks.onCleanupConsumerState(consumer);
                markConsumerIdle(consumer);

                // 延迟重启 Worker
                setTimeout(() => {
                    if (!this.scanState.cancelFlag) {
                        // 注意：这里需要调用 lifecycleManager.restartWorker
                        // 但由于循环依赖问题，我们通过事件或直接调用来实现
                    }
                }, WORKER_RESTART_DELAY);
            } else {
                consumer.busy = false;
            }
        });
    }

    /**
     * 处理任务超时
     */
    handleTaskTimeout(
        consumer: Consumer,
        task: any,  // Task type from task-queue
        calculateTimeout: (fileSize: number) => number
    ): void {
        this.log.warn(`[TaskQueue] 任务 ${consumer.taskId} 超时: ${task.filePath}`);

        const pending = this.pendingTasks.get(consumer.taskId!);
        if (pending) {
            this.pendingTasks.delete(consumer.taskId!);
            
            // 【状态同步】通知待处理任务数变化
            this.eventBus.emit('pending-tasks-size-changed', this.pendingTasks.size);
            
            // 【重构】使用 scanState 管理 activeWorkerCount
            this.scanState.decrementActiveWorkers();
            this.callbacks.onUpdateConsumerCount(consumer.taskId);
            this.callbacks.onSendProgressUpdate(task.filePath);
            pending.reject(new Error(`文件处理超时`));
        }

        // 【优化】清理智能调度状态（由 scheduler 统一管理）
        this.callbacks.onCleanupConsumerState(consumer);

        // 标记为空闲
        markConsumerIdle(consumer);

        // 重启 Worker - 注意：这里需要通过 worker-pool-core 调用 lifecycleManager
        // 由于循环依赖问题，暂时留空，需要在 worker-pool-core 中实现
    }
}
