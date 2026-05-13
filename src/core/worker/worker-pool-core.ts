/**
 * Worker Pool 核心管理模块
 * 
 * 职责：
 * - Worker 池的初始化和清理
 * - 获取空闲 Consumer
 * - 任务分发和状态管理
 * - 协调生命周期管理和消息处理
 */

import {EventBus} from '../infra/event-bus';
import type {ScanState} from '../state/scan-state';
import type {BrowserWindow} from 'electron';
import {createLogger, Logger} from '../../logger/logger';
import {WorkerLifecycleManager} from './worker-lifecycle';
import {WorkerMessageHandler} from './worker-message-handler';
import type {Consumer, PendingTask, WorkerPoolCallbacks} from './worker-pool-types';
import type {Task} from '../queue/task-queue';
import {WORKER_RESTART_SCHEDULE_DELAY} from '../config/constants';

export type {Consumer, PendingTask, WorkerPoolCallbacks};

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
 *     config,
 *     dynamicOldGenMB,
 *     dynamicYoungGenMB,
 *     callbacks
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

    // 计数器
    private nextTaskId = 0;
    private pendingTasks = new Map<number, PendingTask>();

    // 内存配置
    private readonly dynamicOldGenMB: number;
    private readonly dynamicYoungGenMB: number;

    // 回调函数
    private readonly callbacks: WorkerPoolCallbacks;

    // 子模块
    private lifecycleManager!: WorkerLifecycleManager;
    private messageHandler!: WorkerMessageHandler;

    constructor(
        private poolSize: number,
        eventBus: EventBus,
        scanState: ScanState,
        mainWindow: BrowserWindow,
        config: any,
        dynamicOldGenMB: number,
        dynamicYoungGenMB: number,
        callbacks: WorkerPoolCallbacks
    ) {
        this.consumers = new Map();
        this.eventBus = eventBus;
        this.scanState = scanState;
        this.mainWindow = mainWindow;
        this.log = createLogger("WorkerPool");
        this.config = config;
        this.dynamicOldGenMB = dynamicOldGenMB;
        this.dynamicYoungGenMB = dynamicYoungGenMB;
        this.callbacks = callbacks;
    }

    /**
     * 更新回调函数
     */
    public updateCallback<K extends keyof WorkerPoolCallbacks>(
        key: K,
        callback: WorkerPoolCallbacks[K]
    ): void {
        (this.callbacks as any)[key] = callback;
    }

    /**
     * 初始化 Worker 池
     */
    async initialize(): Promise<void> {
        this.log.info(`正在初始化 ${this.poolSize} 个 Consumer Workers...`);

        // 创建子模块
        this.messageHandler = new WorkerMessageHandler(
            this.pendingTasks,
            this.scanState,
            this.eventBus,
            this.mainWindow,
            this.callbacks,
            this.log
        );

        this.lifecycleManager = new WorkerLifecycleManager(
            this.consumers,
            this.poolSize,
            this.dynamicOldGenMB,
            this.dynamicYoungGenMB,
            (consumer) => this.messageHandler.setupMessageListener(consumer),
            (consumer) => this.messageHandler.setupErrorListener(consumer),
            (consumer) => this.messageHandler.setupExitListener(consumer),
            this.eventBus,
            this.log
        );

        // 添加初始 Worker 创建任务
        for (let i = 0; i < this.poolSize; i++) {
            this.lifecycleManager.enqueueCreateTask({consumerId: i});
        }

        // 异步处理初始 Worker 创建
        return new Promise((resolve, reject) => {
            setImmediate(async () => {
                try {
                    await this.lifecycleManager.processWorkerCreateQueue();
                    resolve();
                } catch (error: any) {
                    this.log.error(`[Worker初始化] 创建 Worker 失败: ${error.message}`);
                    reject(error);
                }
            });
        });
    }

    /**
     * 获取空闲的 Consumer
     */
    getIdleConsumer(): Consumer | undefined {
        for (const [, consumer] of this.consumers) {
            if (!consumer.busy && !consumer.isTerminating) {
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
        return this.scanState.getActiveWorkerCount();
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

        // 清理生命周期管理器
        this.lifecycleManager.cleanup();

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
     * 重启所有空闲的 Worker 以应用新内存配置
     */
    restartIdleWorkers(newOldGenMB: number, newYoungGenMB: number): number {
        return this.lifecycleManager.restartIdleWorkers(newOldGenMB, newYoungGenMB);
    }

    /**
     * 重启单个 Worker
     */
    restartWorker(consumer: Consumer): void {
        // 【修复】完全对齐拆分前的逻辑
        // 1. 标记为主动终止
        consumer.isTerminating = true;

        // 2. 安全终止 Worker
        const consumerId = consumer.id;
        this.lifecycleManager.terminateConsumer(consumer);

        // 3. 将 Worker 创建请求加入队列
        this.lifecycleManager.enqueueCreateTask({consumerId});

        // 4. 异步处理队列
        setImmediate(() => {
            this.lifecycleManager.processWorkerCreateQueue().catch(error => {
                this.log.error(`[Worker重启] 处理创建队列失败: ${error.message}`);
            });
        });

        // 5. 强制 GC
        if ((global as any).gc) {
            this.log.info(`[Worker重启] 执行强制垃圾回收...`);
            (global as any).gc();
        }

        // 6. 延迟调度新任务
        setTimeout(() => {
            this.callbacks.onTryDispatch();
        }, WORKER_RESTART_SCHEDULE_DELAY);
    }

    /**
     * 处理任务超时
     */
    handleTaskTimeout(taskId: number, filePath: string, consumer: Consumer): void {
        const task = { filePath, fileSize: 0 }; // 简化版本，实际应该从 pendingTasks 获取
        this.messageHandler.handleTaskTimeout(
            consumer,
            task
        );
        
        // 【修复】调用 worker-pool-core 自己的 restartWorker，而不是 lifecycleManager 的
        this.restartWorker(consumer);
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
        const timeoutMs = this.callbacks.calculateTimeout(task.fileSize);
        const timeoutId = setTimeout(() => {
            this.handleTaskTimeout(this.nextTaskId, task.filePath, consumer);
        }, timeoutMs);

        // 添加到待处理任务
        this.pendingTasks.set(this.nextTaskId, {
            filePath: task.filePath,
            resolve: () => {},
            reject: () => {},
            timeoutId
        });
        
        // 【状态同步】通知待处理任务数变化
        this.eventBus.emit('pending-tasks-size-changed', this.pendingTasks.size);

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

        // 【重构】使用 scanState 管理 activeWorkerCount
        this.scanState.incrementActiveWorkers();
        this.nextTaskId++;
    }
}
