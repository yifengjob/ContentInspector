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
            // 处理日志消息
            if (result.type === 'log') {
                const {level, message} = result;
                // TODO: 如果需要，可以添加日志事件发射
                return;
            }

            // 处理就绪消息
            if (result.type === 'ready') {
                this.log.info(`[Worker就绪] Consumer ${consumer.id} 已就绪`);
                return;
            }

            // 查找对应的待处理任务
            const pending = this.pendingTasks.get(result.taskId);
            if (!pending) {
                this.log.warn(`[Worker消息] 找不到 taskId=${result.taskId} 的待处理任务`);
                return;
            }

            // 清除超时定时器
            clearTimeout(pending.timeoutId);

            // 处理错误
            if (result.error) {
                this.callbacks.onErrorLog(`Worker 处理失败: ${result.filePath} - ${result.error}`);
                pending.reject(new Error(result.error));
                this.pendingTasks.delete(result.taskId);
                
                // 标记 Worker 为空闲
                consumer.busy = false;
                consumer.taskId = undefined;
                this.scanState.decrementActiveWorkers();
                
                // 尝试分发下一个任务
                this.callbacks.onTryDispatch();
                return;
            }

            // 处理成功结果
            if (result.total && result.total > 0) {
                this.callbacks.onResultLog(result.total, result);
                
                // 批量发送结果到前端
                this.callbacks.onResultBatchSend(this.mainWindow, result);
            }

            // 解析完成，清理状态
            this.callbacks.onCleanupConsumerState(consumer);
            
            // 更新进度
            this.callbacks.onSendProgressUpdate(result.filePath);
            
            // 检查是否完成扫描
            this.callbacks.onCheckAndComplete();

            // 解决 Promise
            pending.resolve(result);
            this.pendingTasks.delete(result.taskId);

            // 尝试分发下一个任务
            this.callbacks.onTryDispatch();
        });
    }

    /**
     * 设置 Worker 错误监听器
     */
    setupErrorListener(consumer: Consumer): void {
        consumer.worker.on('error', (error) => {
            this.log.error(`[Worker错误] Consumer ${consumer.id}:`, error.message);
            
            // 如果任务正在处理，拒绝 Promise
            if (consumer.taskId !== undefined) {
                const pending = this.pendingTasks.get(consumer.taskId);
                if (pending) {
                    clearTimeout(pending.timeoutId);
                    pending.reject(error);
                    this.pendingTasks.delete(consumer.taskId);
                }
            }
            
            // 标记 Worker 为空闲
            consumer.busy = false;
            consumer.taskId = undefined;
            this.scanState.decrementActiveWorkers();
        });
    }

    /**
     * 设置 Worker 退出监听器
     */
    setupExitListener(consumer: Consumer): void {
        consumer.worker.on('exit', (code: number | null, signal: string | null) => {
            if (signal) {
                this.log.warn(`[Worker退出] Consumer ${consumer.id} 被信号终止: ${signal}`);
            }

            if (consumer.isTerminating) {
                this.log.info(`[Worker退出] Consumer ${consumer.id} 正常终止`);
                return;
            }

            // 非正常退出且不是取消扫描
            if (code !== 0 && !this.scanState.cancelFlag) {
                const isOOM = code === 134 || code === 137; // SIGABRT or SIGKILL (OOM)
                
                if (isOOM) {
                    this.log.error(`[Worker OOM] Consumer ${consumer.id} 内存溢出退出 (code: ${code})`);
                } else {
                    this.log.error(`[Worker异常退出] Consumer ${consumer.id} 退出码: ${code}`);
                }

                // 如果任务正在处理，拒绝 Promise
                if (consumer.taskId !== undefined) {
                    const pending = this.pendingTasks.get(consumer.taskId);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        const errorMsg = isOOM ? 'Worker 内存溢出' : `Worker 异常退出 (code: ${code})`;
                        pending.reject(new Error(errorMsg));
                        this.pendingTasks.delete(consumer.taskId);
                    }
                }

                // 标记 Worker 为空闲
                consumer.busy = false;
                consumer.taskId = undefined;
                this.scanState.decrementActiveWorkers();

                // 尝试重启 Worker
                this.log.info(`[Worker重启] 准备重启 Consumer ${consumer.id}...`);
                setTimeout(() => {
                    // 注意：这里需要调用 lifecycleManager.restartWorker
                    // 但由于循环依赖问题，我们通过事件或直接调用来实现
                }, 1000);
            }
        });
    }

    /**
     * 处理任务超时
     */
    handleTaskTimeout(
        taskId: number,
        filePath: string,
        consumer: Consumer,
        calculateTimeout: (fileSize: number) => number
    ): void {
        const pending = this.pendingTasks.get(taskId);
        if (!pending) {
            return;
        }

        this.log.warn(`[任务超时] Task ${taskId} (${filePath}) 处理超时`);

        // 清除超时定时器
        clearTimeout(pending.timeoutId);

        // 拒绝 Promise
        pending.reject(new Error(`任务处理超时: ${filePath}`));
        this.pendingTasks.delete(taskId);

        // 标记 Worker 为空闲
        consumer.busy = false;
        consumer.taskId = undefined;
        this.scanState.decrementActiveWorkers();

        // 记录错误日志
        this.callbacks.onErrorLog(`任务超时: ${filePath}`);

        // 尝试分发下一个任务
        this.callbacks.onTryDispatch();
    }
}
