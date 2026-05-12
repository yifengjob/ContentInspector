/**
 * Worker 池管理模块
 *
 * 职责：
 * - Consumer Worker 的创建、销毁、重启
 * - Worker 状态管理
 * - Worker 消息处理协调
 * - 串行化 Worker 创建队列
 */

import {Worker} from 'worker_threads';
import * as path from 'path';
import {EventBus} from './event-bus';
import type {ScanState} from './scan-state';
import type {BrowserWindow} from 'electron';
import {markConsumerIdle, safelyTerminateWorker} from '../utils/scanner-helpers';
import {WORKER_RESTART_DELAY} from './scan-config';
import type {Task} from './task-queue';
import {createLogger, Logger} from '../logger/logger';

/**
 * Consumer Worker 接口
 */
export interface Consumer {
    id: number;
    worker: Worker;
    busy: boolean;
    taskId?: number;
    counted?: boolean;
    isTerminating?: boolean;
    // 【智能调度】扩展字段
    currentFileType?: string;
    currentFileSize?: number;
    taskStartTime?: number;
}

/**
 * Pending Task 接口
 */
interface PendingTask {
    filePath: string;
    resolve: (result: any) => void;
    reject: (error: any) => void;
    timeoutId: NodeJS.Timeout;
}

/**
 * Worker 池管理器
 *
 * 使用示例：
 * ```typescript
 * const workerPool = new WorkerPool(
 *     poolSize,
 *     eventBus,
 *     scanState,
 *     mainWindow,
 *     queueManager,
 *     config,
 *     dynamicOldGenMB,
 *     dynamicYoungGenMB
 * );
 *
 * await workerPool.initialize();
 *
 * // 获取空闲 Worker
 * const idleConsumer = workerPool.getIdleConsumer();
 *
 * // 清理资源
 * workerPool.cleanup();
 * ```
 */
export class WorkerPool {
    private readonly consumers: Map<number, Consumer>;
    private readonly eventBus: EventBus;
    private scanState: ScanState;
    private readonly mainWindow: BrowserWindow;
    private readonly log: Logger;
    private config: any;

    // Worker 创建队列
    private workerCreateQueue: Array<{ consumerId: number, oldGen?: number, youngGen?: number }> = [];
    private isCreatingWorker = false;

    // 计数器
    private activeWorkerCount = 0;
    private nextTaskId = 0;
    private pendingTasks = new Map<number, PendingTask>();

    // 内存配置
    private readonly dynamicOldGenMB: number;
    private readonly dynamicYoungGenMB: number;

    // 回调函数（由外部传入）
    private readonly onUpdateConsumerCount: (taskId?: number) => void;
    private readonly onCleanupConsumerState: (consumer: Consumer) => void;
    private readonly onSendProgressUpdate: (filePath: string) => void;
    private readonly onCheckAndComplete: () => void;
    private readonly onTryDispatch: () => void;
    private readonly onErrorLog: (error: string) => void;
    private readonly onResultLog: (resultCount: number, result: any) => void;
    private readonly onResultBatchSend: (mainWindow: BrowserWindow, resultItem: any) => void;
    private readonly calculateTimeout: (fileSize: number) => number;

    constructor(
        private poolSize: number,
        eventBus: EventBus,
        scanState: ScanState,
        mainWindow: BrowserWindow,
        config: any,
        dynamicOldGenMB: number,
        dynamicYoungGenMB: number,
        onUpdateConsumerCount: (taskId?: number) => void,
        onCleanupConsumerState: (consumer: Consumer) => void,
        onSendProgressUpdate: (filePath: string) => void,
        onCheckAndComplete: () => void,
        onTryDispatch: () => void,
        onErrorLog: (error: string) => void,
        onResultLog: (resultCount: number, result: any) => void,
        onResultBatchSend: (mainWindow: BrowserWindow, resultItem: any) => void,
        calculateTimeout: (fileSize: number) => number
    ) {
        this.consumers = new Map();
        this.eventBus = eventBus;
        this.scanState = scanState;
        this.mainWindow = mainWindow;
        this.log = createLogger("WorkerPool");
        this.config = config;
        this.dynamicOldGenMB = dynamicOldGenMB;
        this.dynamicYoungGenMB = dynamicYoungGenMB;

        this.onUpdateConsumerCount = onUpdateConsumerCount;
        this.onCleanupConsumerState = onCleanupConsumerState;
        this.onSendProgressUpdate = onSendProgressUpdate;
        this.onCheckAndComplete = onCheckAndComplete;
        this.onTryDispatch = onTryDispatch;
        this.onErrorLog = onErrorLog;
        this.onResultLog = onResultLog;
        this.onResultBatchSend = onResultBatchSend;
        this.calculateTimeout = calculateTimeout;
    }

    /**
     * 初始化 Worker 池
     */
    async initialize(): Promise<void> {
        this.log.info(`正在初始化 ${this.poolSize} 个 Consumer Workers...`);

        for (let i = 0; i < this.poolSize; i++) {
            this.workerCreateQueue.push({consumerId: i});
        }

        // 异步处理初始 Worker 创建
        return new Promise((resolve, reject) => {
            setImmediate(async () => {
                try {
                    await this.processWorkerCreateQueue();
                    resolve();
                } catch (error: any) {
                    this.log.error(`[Worker初始化] 创建 Worker 失败: ${error.message}`);
                    reject(error);
                }
            });
        });
    }

    /**
     * 串行化创建 Worker，避免并发创建导致 EAGAIN
     */
    async processWorkerCreateQueue(): Promise<void> {
        if (this.isCreatingWorker || this.workerCreateQueue.length === 0) {
            return;
        }

        this.isCreatingWorker = true;
        this.log.debug(`[调试] processWorkerCreateQueue 开始，队列长度: ${this.workerCreateQueue.length}`);
        
        let iterationCount = 0;
        const MAX_ITERATIONS = 50; // 【关键】防止无限循环，降低到 50 次
        const retryCounts = new Map<number, number>(); // consumerId -> retry count
        const MAX_RETRY_PER_WORKER = 3; // 每个 Worker 最多重试 3 次

        while (this.workerCreateQueue.length > 0) {
            iterationCount++;
            if (iterationCount > MAX_ITERATIONS) {
                this.log.error(`[致命错误] processWorkerCreateQueue 迭代次数过多（${iterationCount}/${MAX_ITERATIONS}），强制退出以防止卡死`);
                break;
            }
            
            const {consumerId, oldGen, youngGen} = this.workerCreateQueue.shift()!;
            
            // 检查单个 Worker 的重试次数
            const currentRetry = retryCounts.get(consumerId) || 0;
            if (currentRetry >= MAX_RETRY_PER_WORKER) {
                this.log.error(`[Worker创建] Worker ${consumerId} 重试次数过多（${currentRetry}/${MAX_RETRY_PER_WORKER}），放弃创建`);
                continue; // 跳过这个 Worker，继续处理其他 Worker
            }
            
            this.log.debug(`[调试] 尝试创建 Worker ${consumerId} (第${iterationCount}次迭代, 重试${currentRetry + 1}/${MAX_RETRY_PER_WORKER})`);

            try {
                this.createConsumer(consumerId, oldGen, youngGen);
                // 【关键】每个 Worker 创建后延迟 100ms，避免资源竞争
                await new Promise(resolve => setTimeout(resolve, 100));
                // 成功后清除重试计数
                retryCounts.delete(consumerId);
            } catch (error: any) {
                const newRetryCount = currentRetry + 1;
                retryCounts.set(consumerId, newRetryCount);
                this.log.error(`[Worker创建] 创建 Worker ${consumerId} 失败 (${newRetryCount}/${MAX_RETRY_PER_WORKER}): ${error.message}`);
                
                // 失败后放回队列头部，稍后重试
                this.workerCreateQueue.unshift({consumerId, oldGen, youngGen});
                
                // 【关键】增加等待时间，给系统资源恢复的时间
                const waitTime = 500 * newRetryCount; // 第一次 500ms，第二次 1000ms，第三次 1500ms
                this.log.warn(`[Worker创建] 等待 ${waitTime}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }

        this.isCreatingWorker = false;
        this.log.debug(`[调试] processWorkerCreateQueue 完成，总迭代次数: ${iterationCount}`);
    }

    /**
     * 创建 Consumer Worker
     */
    private createConsumer(id: number, customOldGen?: number, customYoungGen?: number): void {
        const workerPath = path.join(__dirname, '..', 'workers', 'file-worker.js');

        // 使用自定义内存限制或默认值
        const oldGenLimit = customOldGen || this.dynamicOldGenMB;
        const youngGenLimit = customYoungGen || this.dynamicYoungGenMB;

        let worker: Worker;
        try {
            worker = new Worker(workerPath, {
                resourceLimits: {
                    maxOldGenerationSizeMb: oldGenLimit,
                    maxYoungGenerationSizeMb: youngGenLimit,
                }
            });
        } catch (error: any) {
            this.log.error(`无法创建 Worker ${id} - ${error.message}`);

            // 【修复】如果是因为资源不足（EAGAIN），将创建请求放回队列重试
            if (error.code === 'EAGAIN') {
                this.log.warn(`[Worker创建] 系统资源不足，Worker ${id} 将在稍后重试创建`);
            }

            throw error; // 抛出错误，让队列处理重试
        }

        const consumer: Consumer = {
            id,
            worker,
            busy: false,
            taskId: undefined,
            counted: false,
            isTerminating: false
        };

        this.consumers.set(id, consumer);

        this.log.info(`[Worker创建] Worker ${id} 创建成功`);

        // 【事件总线】发布 Worker 创建事件
        this.eventBus.emit('worker.created', consumer);

        // 设置消息监听器
        this.setupWorkerMessageListener(consumer);
        this.setupWorkerErrorListener(consumer);
        this.setupWorkerExitListener(consumer);
    }

    /**
     * 设置 Worker 消息监听器
     */
    private setupWorkerMessageListener(consumer: Consumer): void {
        consumer.worker.on('message', (result) => {
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
                this.onUpdateConsumerCount(taskId);
                this.onCleanupConsumerState(consumer);

                // 【事件总线】发布 Worker 空闲事件
                this.eventBus.emit('worker.idle', consumer);
                return;
            }

            // 清除超时定时器
            clearTimeout(pending.timeoutId);
            this.pendingTasks.delete(taskId);

            // 标记 Worker 为空闲
            markConsumerIdle(consumer);
            this.onUpdateConsumerCount(taskId);
            this.onCleanupConsumerState(consumer);

            // 更新最后活动时间（通过事件触发）

            // 更新进度
            this.onSendProgressUpdate(result.filePath || '');

            // 处理结果
            if (result.error) {
                this.onErrorLog(result.error);
                pending.reject(new Error(result.error));
            } else {
                if (result.total && result.total > 0) {
                    this.onResultLog(result.total, result);

                    const resultItem = {
                        filePath: result.filePath,
                        fileSize: result.fileSize || 0,
                        modifiedTime: result.modifiedTime || new Date().toISOString(),
                        counts: result.counts || {},
                        total: result.total,
                        unsupportedPreview: false
                    };

                    // 【P3优化】使用批量发送
                    this.onResultBatchSend(this.mainWindow, resultItem);
                }
                pending.resolve(result);
            }

            // 【真正的事件驱动】Worker 完成任务后变为空闲
            this.eventBus.emit('worker.idle', consumer);

            // 检查是否应该结束
            try {
                this.onCheckAndComplete();
            } catch (error: any) {
                this.log.error(`[Consumer ${consumer.id}] 检查完成状态失败: ${error.message}`);
            }
        });
    }

    /**
     * 设置 Worker 错误监听器
     */
    private setupWorkerErrorListener(consumer: Consumer): void {
        consumer.worker.on('error', (error: any) => {
            this.log.error(`[Consumer ${consumer.id}] Worker 错误: ${error.message}`);
            this.onUpdateConsumerCount(consumer.taskId);
        });
    }

    /**
     * 设置 Worker 退出监听器
     */
    private setupWorkerExitListener(consumer: Consumer): void {
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
                this.onCleanupConsumerState(consumer);
                return;
            }

            if (code !== 0 && !this.scanState.cancelFlag) {
                this.log.error(`[Consumer ${consumer.id}] Worker 异常退出，代码: ${code}, 信号: ${signal || 'none'}`);

                // 检测是否是 OOM 导致的退出
                const isOOM = signal === 'SIGABRT' || code === 134;
                if (isOOM) {
                    this.log.error(`[Consumer ${consumer.id}] ⚠️ 检测到 Worker OOM！将重启 Worker 并跳过当前文件`);
                }

                this.onUpdateConsumerCount(consumer.taskId);
                this.onCleanupConsumerState(consumer);
                markConsumerIdle(consumer);

                // 延迟重启 Worker
                setTimeout(() => {
                    if (!this.scanState.cancelFlag) {
                        this.restartWorker(consumer);
                    }
                }, WORKER_RESTART_DELAY);
            } else {
                consumer.busy = false;
            }
        });
    }

    /**
     * 重启 Worker
     */
    private restartWorker(consumer: Consumer): void {
        // 标记为主动终止
        consumer.isTerminating = true;

        // 安全终止 Worker
        safelyTerminateWorker(consumer.worker, consumer, this.log);

        const consumerId = consumer.id;

        // 将 Worker 创建请求加入队列
        this.workerCreateQueue.push({consumerId});

        // 异步处理队列
        setImmediate(() => {
            this.processWorkerCreateQueue().catch(error => {
                this.log.error(`[Worker重启] 处理创建队列失败: ${error.message}`);
            });
        });

        // 强制 GC
        if ((global as any).gc) {
            this.log.info(`[Worker重启] 执行强制垃圾回收...`);
            (global as any).gc();
        }

        // 延迟调度新任务
        setTimeout(() => {
            this.onTryDispatch();
        }, 150);
    }

    /**
     * 分配任务给 Consumer
     */
    assignTaskToConsumer(
        consumer: Consumer,
        task: Task,
        processingTypeCount: Map<string, number>,
        largeFilesProcessingRef: { value: number },
        lastTypeScheduleTime: Map<string, number>
    ): void {
        // 更新调度状态
        processingTypeCount.set(
            task.fileType,
            (processingTypeCount.get(task.fileType) || 0) + 1
        );

        if (task.isLargeFile) {
            largeFilesProcessingRef.value++;
        }

        lastTypeScheduleTime.set(task.fileType, Date.now());

        // 更新 Consumer 状态
        consumer.busy = true;
        consumer.taskId = this.nextTaskId;
        consumer.currentFileType = task.fileType;
        consumer.currentFileSize = task.fileSize;
        consumer.taskStartTime = Date.now();
        consumer.counted = false;

        // 创建超时保护
        const timeoutMs = this.calculateTimeout(task.fileSize);
        const timeoutId = setTimeout(() => {
            this.handleTaskTimeout(consumer, task);
        }, timeoutMs);

        // 添加到待处理任务
        this.pendingTasks.set(this.nextTaskId, {
            filePath: task.filePath,
            resolve: () => {
            },
            reject: () => {
            },
            timeoutId
        });

        // 发送任务给 Worker
        consumer.worker.postMessage({
            taskId: this.nextTaskId,
            filePath: task.filePath,
            enabledSensitiveTypes: this.config.enabledSensitiveTypes,
            config: {
                enabledSensitiveTypes: this.config.enabledSensitiveTypes,
                maxFileSizeMb: this.config.maxFileSizeMb,
                maxPdfSizeMb: this.config.maxPdfSizeMb
            }
        });

        this.activeWorkerCount++;
        this.nextTaskId++;
    }

    /**
     * 处理任务超时
     */
    private handleTaskTimeout(
        consumer: Consumer,
        task: Task
    ): void {
        this.log.warn(`[TaskQueue] 任务 ${consumer.taskId} 超时: ${task.filePath}`);

        const pending = this.pendingTasks.get(consumer.taskId!);
        if (pending) {
            this.pendingTasks.delete(consumer.taskId!);
            this.onUpdateConsumerCount(consumer.taskId);
            this.onSendProgressUpdate(task.filePath);
            pending.reject(new Error(`文件处理超时`));
        }

        // 【优化】清理智能调度状态（由 scheduler 统一管理）
        this.onCleanupConsumerState(consumer);

        // 标记为空闲
        markConsumerIdle(consumer);

        // 重启 Worker
        this.restartWorker(consumer);
    }

    /**
     * 获取空闲的 Consumer
     */
    getIdleConsumer(): Consumer | undefined {
        for (const consumer of this.consumers.values()) {
            if (!consumer.busy) {
                return consumer;
            }
        }
        return undefined;
    }

    /**
     * 获取所有 Consumers
     */
    getConsumers(): Map<number, Consumer> {
        return this.consumers;
    }

    /**
     * 获取活跃 Worker 数量
     */
    getActiveWorkerCount(): number {
        return this.activeWorkerCount;
    }

    /**
     * 增加下一个任务 ID
     */
    incrementNextTaskId(): void {
        this.nextTaskId++;
    }

    /**
     * 获取待处理任务
     */
    getPendingTasks(): Map<number, PendingTask> {
        return this.pendingTasks;
    }

    /**
     * 清理所有资源
     */
    cleanup(): void {
        this.log.info('[WorkerPool] 开始清理 Worker 池...');

        // 终止所有 Consumer Workers
        for (const [, consumer] of this.consumers) {
            try {
                // 【修复】正确处理 terminate 返回的 Promise
                void consumer.worker.terminate();
                consumer.worker.removeAllListeners();
                (consumer as any).worker = null;
            } catch (error) {
                this.log.info(`终止 Consumer Worker 失败: ${error}`);
            }
        }

        // 清空 Map
        this.consumers.clear();

        // 清除所有超时定时器
        if (this.pendingTasks.size > 0) {
            for (const pending of this.pendingTasks.values()) {
                clearTimeout(pending.timeoutId);
            }
            this.pendingTasks.clear();
        }

        this.log.info('[WorkerPool] Worker 池清理完成');
    }

    /**
     * 【关键功能】重启所有空闲的 Worker 以应用新内存配置
     * @param newOldGenMB 新的老生代内存限制（MB）
     * @param newYoungGenMB 新的新生代内存限制（MB）
     * @returns 重启的 Worker 数量
     */
    restartIdleWorkers(newOldGenMB: number, newYoungGenMB: number): number {
        let restartedCount = 0;

        for (const [consumerId, consumer] of this.consumers) {
            if (!consumer.busy) {
                // 终止旧的 Worker
                try {
                    // 【修复】正确处理 terminate 返回的 Promise
                    void consumer.worker.terminate();
                    consumer.worker.removeAllListeners();
                } catch (e) {
                    // 忽略终止错误
                }

                // 【关键】删除旧 Consumer，创建新的 Worker（使用新内存限制）
                this.consumers.delete(consumerId);
                this.createConsumer(consumerId, newOldGenMB, newYoungGenMB);
                restartedCount++;
            }
        }

        return restartedCount;
    }
}
