/**
 * 智能调度器模块
 *
 * 职责：
 * - 实现4层智能调度策略
 * - 类型互斥和超时检测
 * - 最优任务选择
 * - 事件驱动的 Worker 任务分配
 */

import {EventBus} from '../infra';
import type {TaskQueueManager, Task} from '../queue';
import type {WorkerPool, Consumer} from '../worker';
import type {ScanState} from '../state';
import {
    ENABLE_SMART_SCHEDULING,
    LARGE_FILE_THRESHOLD_MB,
    MAX_LARGE_FILES_CONCURRENT,
    TYPE_MUTEX_TIMEOUT_MS,
    BYTES_TO_MB
} from '../config';
import {createLogger, Logger} from '../../logger/logger';

/**
 * 智能调度器
 *
 * 【重要】创建后必须立即调用 initialize() 方法
 *
 * 调度策略优先级：
 * 1. 优先处理大文件（如果未达上限且类型不冲突）
 * 2. 选择不同类型的小文件（确保 Worker 不闲置）
 * 3. 类型超时后允许同类型（防止死锁）
 * 4. 兜底：违反类型互斥，但遵守大文件限制（确保 Worker 不闲置）
 *
 * 使用示例：
 * ```typescript
 * const scheduler = new SmartScheduler(
 *     eventBus,
 *     queueManager,
 *     workerPool,
 *     assignTaskToConsumerCallback
 * );
 *
 * scheduler.initialize(); // ← 必须调用
 * ```
 */
export class SmartScheduler {
    private readonly log: Logger;
    private eventBus: EventBus;
    private queueManager: TaskQueueManager;
    private workerPool: WorkerPool;
    private scanState?: ScanState;  // 【新增】ScanState 引用，用于状态同步
    private readonly assignTaskToConsumer: (consumer: Consumer, task: Task) => void;

    // 【智能调度】状态跟踪
    private processingTypeCount = new Map<string, number>();
    private largeFilesProcessing = 0;
    private lastTypeScheduleTime = new Map<string, number>();

    // 【新架构】轮询索引
    private nextTypeIndex = 0;
    private typeOrder: string[] = [];

    // 【新增】保存事件处理器引用，用于清理
    // 【防御性编程】初始化为带警告的空函数，如果忘记调用 initialize() 会输出警告日志
    private initializationWarningShown = false;
    
    private onWorkerCreated: (consumer: Consumer) => void = (consumer) => {
        this.showInitializationWarning('onWorkerCreated', `Consumer ID: ${consumer.id}`);
    };
    
    private onWorkerIdle: (consumer: Consumer) => void = (consumer) => {
        this.showInitializationWarning('onWorkerIdle', `Consumer ID: ${consumer.id}`);
    };
    
    private onTaskEnqueued: () => void = () => {
        this.showInitializationWarning('onTaskEnqueued');
    };
    
    private onWalkerBatchReady: () => void = () => {
        this.showInitializationWarning('onWalkerBatchReady');
    };
    
    // 【新增】状态同步监听器（用于清理）
    private onQueueLengthChanged?: (length: number) => void;
    private onPendingTasksSizeChanged?: (size: number) => void;

    constructor(
        eventBus: EventBus,
        queueManager: TaskQueueManager,
        workerPool: WorkerPool,
        assignTaskToConsumer: (consumer: Consumer, task: Task) => void,
        scanState?: ScanState  // 【新增】ScanState 引用，用于状态同步
    ) {
        this.log = createLogger('SmartScheduler');
        this.eventBus = eventBus;
        this.queueManager = queueManager;
        this.workerPool = workerPool;
        this.assignTaskToConsumer = assignTaskToConsumer;
        this.scanState = scanState;
    }

    /**
     * 初始化智能调度器
     * 订阅所有相关事件
     */
    initialize(): void {
        if (!ENABLE_SMART_SCHEDULING) {
            return;
        }

        // 【防御性编程】重置警告标志
        // 注意：虽然下面的赋值会覆盖默认的事件处理器，
        // 但重置标志是为了支持“销毁后重新初始化”的场景
        this.initializationWarningShown = false;

        // 【关键】这里的事件处理器赋值会覆盖构造函数中的默认实现
        // 因此 initialize() 之后，不会再触发初始化警告
        // 【新增】创建并保存事件处理器引用
        this.onWorkerCreated = (consumer: Consumer) => {
            this.assignTaskToIdleConsumer(consumer);
        };

        this.onWorkerIdle = (consumer: Consumer) => {
            this.assignTaskToIdleConsumer(consumer);
        };

        this.onTaskEnqueued = () => {
            // 为第一个空闲 Worker 分配任务
            const idleConsumer = this.workerPool.getIdleConsumer();
            if (idleConsumer) {
                this.assignTaskToIdleConsumer(idleConsumer);
            }
        };

        this.onWalkerBatchReady = () => {
            // 为所有空闲 Worker 分配任务
            for (const consumer of this.workerPool.getConsumers().values()) {
                if (!consumer.busy) {
                    this.assignTaskToIdleConsumer(consumer);
                }
            }
        };

        // 订阅 Worker 创建事件
        this.eventBus.on('worker.created', this.onWorkerCreated);

        // 订阅 Worker 空闲事件
        this.eventBus.on('worker.idle', this.onWorkerIdle);

        // 订阅任务入队事件
        this.eventBus.on('task.enqueued', this.onTaskEnqueued);

        // 订阅 Walker 批量文件就绪事件
        this.eventBus.on('walker.batch-ready', this.onWalkerBatchReady);
        
        // 【新增】注册状态同步监听器（如果提供了 scanState）
        if (this.scanState) {
            this.onQueueLengthChanged = (length: number) => {
                this.scanState!.setTaskQueueLength(length);
            };
            this.onPendingTasksSizeChanged = (size: number) => {
                this.scanState!.setPendingTasksSize(size);
            };
            
            this.eventBus.on('task-queue-length-changed', this.onQueueLengthChanged);
            this.eventBus.on('pending-tasks-size-changed', this.onPendingTasksSizeChanged);
        }
    }

    /**
     * 检查类型是否被阻塞（同类型已达上限）
     * 【关键修复】区分大文件和小文件：
     * - 大文件：严格互斥，最多 1 个并发
     * - 小文件：允许同类型并行，不阻塞
     */
    isTypeBlocked(fileType: string, isLargeFile: boolean = false): boolean {
        const count = this.processingTypeCount.get(fileType) || 0;

        if (isLargeFile) {
            // 大文件：严格互斥，最多 1 个并发
            return count >= 1;
        } else {
            // 小文件：不阻塞，允许同类型并行 ✅
            return false;
        }
    }

    /**
     * 检查类型超时，如果超时则允许同类型
     */
    checkTypeTimeoutAndSelect(): Task | null {
        const now = Date.now();

        for (const [fileType, lastTime] of this.lastTypeScheduleTime.entries()) {
            if (now - lastTime > TYPE_MUTEX_TIMEOUT_MS) {
                // 超时，允许该类型的任务
                const info = this.queueManager.getTypeQueueInfo(fileType);
                if (!info) continue;

                if (info.smallCount > 0) {
                    return this.queueManager.dequeueTask(fileType, false);
                }

                if (info.largeCount > 0) {
                    return this.queueManager.dequeueTask(fileType, true);
                }
            }
        }

        return null;
    }

    /**
     * 为指定 Worker 选择最优任务
     *
     * @returns 选中的任务，如果没有可用任务则返回 null
     */
    selectOptimalTask(): Task | null {
        // 如果队列为空，直接返回
        if (this.queueManager.getQueueLength() === 0) {
            return null;
        }

        // 更新类型顺序列表
        this.typeOrder = this.queueManager.getFileTypes();

        // 【边界条件检查】如果 typeOrder 为空（竞态条件），直接返回
        if (this.typeOrder.length === 0) {
            return null;
        }

        // ==================== 策略 1: 优先处理大文件（类型不冲突）====================
        if (this.largeFilesProcessing < MAX_LARGE_FILES_CONCURRENT) {
            // 轮询所有类型，找到第一个未被阻塞的大文件
            for (let i = 0; i < this.typeOrder.length; i++) {
                const idx = (this.nextTypeIndex + i) % this.typeOrder.length;
                const fileType = this.typeOrder[idx];

                if (!this.isTypeBlocked(fileType, true)) {
                    const info = this.queueManager.getTypeQueueInfo(fileType);
                    if (info && info.largeCount > 0) {
                        // 找到！更新轮询索引
                        this.nextTypeIndex = (idx + 1) % this.typeOrder.length;
                        return this.queueManager.dequeueTask(fileType, true);
                    }
                }
            }
        }

        // ==================== 策略 2: 选择不同类型的小文件 ====================
        for (let i = 0; i < this.typeOrder.length; i++) {
            const idx = (this.nextTypeIndex + i) % this.typeOrder.length;
            const fileType = this.typeOrder[idx];

            const info = this.queueManager.getTypeQueueInfo(fileType);
            if (!info) continue;

            // 优先大文件（如果未达上限且类型未被阻塞）
            if (info.largeCount > 0 && this.largeFilesProcessing < MAX_LARGE_FILES_CONCURRENT) {
                if (!this.isTypeBlocked(fileType, true)) {
                    this.nextTypeIndex = (idx + 1) % this.typeOrder.length;
                    return this.queueManager.dequeueTask(fileType, true);
                }
            }

            // 其次选择小文件（不检查类型阻塞，允许同类型并行）✅
            if (info.smallCount > 0) {
                this.nextTypeIndex = (idx + 1) % this.typeOrder.length;
                return this.queueManager.dequeueTask(fileType, false);
            }
        }

        // ==================== 策略 3: 类型超时检查 ====================
        const timeoutTask = this.checkTypeTimeoutAndSelect();
        if (timeoutTask) {
            return timeoutTask;
        }

        // ==================== 策略 4: 兜底 - 违反类型互斥，但遵守大文件限制 ====================
        // 优先选择大文件（如果未达上限）
        if (this.largeFilesProcessing < MAX_LARGE_FILES_CONCURRENT) {
            for (const fileType of this.typeOrder) {
                const info = this.queueManager.getTypeQueueInfo(fileType);
                if (info && info.largeCount > 0) {
                    return this.queueManager.dequeueTask(fileType, true);
                }
            }
        }

        // 其次选择小文件（即使违反类型互斥）
        for (const fileType of this.typeOrder) {
            const info = this.queueManager.getTypeQueueInfo(fileType);
            if (info && info.smallCount > 0) {
                return this.queueManager.dequeueTask(fileType, false);
            }
        }

        // 唯一能让 Worker 闲置的情况：全是大文件且已达上限
        return null;
    }

    /**
     * 为指定 Worker 分配任务
     * 【真正的事件驱动】不再遍历查找，而是直接为请求任务的 Worker 分配
     */
    assignTaskToIdleConsumer(requestingConsumer: Consumer): void {
        // 【关键】只为这个特定的 Worker 选择任务，不遍历其他 Worker
        const selectedTask = this.selectOptimalTask();

        if (selectedTask) {
            // 分配任务
            this.assignTaskToConsumer(requestingConsumer, selectedTask);

            // 更新调度状态
            this.processingTypeCount.set(
                selectedTask.fileType,
                (this.processingTypeCount.get(selectedTask.fileType) || 0) + 1
            );

            if (selectedTask.isLargeFile) {
                this.largeFilesProcessing++;
            }

            this.lastTypeScheduleTime.set(selectedTask.fileType, Date.now());
        }
        // 如果没有任务可分配，Worker 保持空闲状态，等待下一个事件
    }

    /**
     * 清理 Consumer 的调度状态
     */
    cleanupConsumerState(consumer: Consumer): void {
        // 【安全检查】如果 consumer 不存在或已被清理，直接返回
        if (!consumer || !consumer.currentFileType) {
            return;
        }

        // 【安全检查】确保 processingTypeCount 中存在该类型
        const count = this.processingTypeCount.get(consumer.currentFileType);
        if (count !== undefined && count > 0) {
            if (count > 1) {
                this.processingTypeCount.set(consumer.currentFileType, count - 1);
            } else {
                this.processingTypeCount.delete(consumer.currentFileType);
            }
        }

        // 【安全检查】确保 largeFilesProcessing 不会变成负数
        if (consumer.currentFileSize && consumer.currentFileSize > LARGE_FILE_THRESHOLD_MB * BYTES_TO_MB) {
            if (this.largeFilesProcessing > 0) {
                this.largeFilesProcessing--;
            }
        }

        // 清除 Consumer 状态
        consumer.currentFileType = undefined;
        consumer.currentFileSize = undefined;
        consumer.taskStartTime = undefined;
    }

    /**
     * 获取当前正在处理的文件类型数量
     */
    getProcessingTypeCount(): Map<string, number> {
        return this.processingTypeCount;
    }

    /**
     * 获取当前正在处理的大文件数量
     */
    getLargeFilesProcessing(): number {
        return this.largeFilesProcessing;
    }

    /**
     * 获取最后调度时间映射
     */
    getLastTypeScheduleTime(): Map<string, number> {
        return this.lastTypeScheduleTime;
    }

    /**
     * 【防御性编程】显示初始化警告（只输出一次）
     * 
     * 如果忘记调用 initialize()，事件处理器被调用时会输出此警告
     * 帮助开发者快速定位问题
     * 
     * @param methodName 被调用的方法名
     * @param context 上下文信息（可选）
     */
    private showInitializationWarning(methodName: string, context?: string): void {
        if (!this.initializationWarningShown) {
            this.log.warn(
                `⚠️ ${methodName} 被调用，但 SmartScheduler 尚未初始化！\n` +
                `  ${context ? context + '\n' : ''}` +
                `  请确保在创建 SmartScheduler 后立即调用 initialize()`
            );
            this.initializationWarningShown = true;
        }
    }

    /**
     * 【新增】销毁调度器，清理事件监听器
     * 防止内存泄漏：每次扫描结束后必须调用
     */
    destroy(): void {
        // 移除所有事件监听器
        this.eventBus.off('worker.created', this.onWorkerCreated);
        this.eventBus.off('worker.idle', this.onWorkerIdle);
        this.eventBus.off('task.enqueued', this.onTaskEnqueued);
        this.eventBus.off('walker.batch-ready', this.onWalkerBatchReady);
        
        // 【新增】移除状态同步监听器
        if (this.onQueueLengthChanged) {
            this.eventBus.off('task-queue-length-changed', this.onQueueLengthChanged);
        }
        if (this.onPendingTasksSizeChanged) {
            this.eventBus.off('pending-tasks-size-changed', this.onPendingTasksSizeChanged);
        }

        // 清空状态
        this.processingTypeCount.clear();
        this.lastTypeScheduleTime.clear();
        this.largeFilesProcessing = 0;
        this.typeOrder = [];
        this.nextTypeIndex = 0;
    }
}
