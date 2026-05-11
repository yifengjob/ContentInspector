/**
 * 智能调度器模块
 * 
 * 职责：
 * - 实现4层智能调度策略
 * - 类型互斥和超时检测
 * - 最优任务选择
 * - 事件驱动的 Worker 任务分配
 */

import {EventBus} from './event-bus';
import type {TaskQueueManager, Task} from './task-queue';
import type {WorkerPool, Consumer} from './worker-pool';
import {
    ENABLE_SMART_SCHEDULING,
    LARGE_FILE_THRESHOLD_MB,
    MAX_LARGE_FILES_CONCURRENT,
    TYPE_MUTEX_TIMEOUT_MS,
    BYTES_TO_MB
} from './scan-config';

/**
 * 智能调度器
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
 * scheduler.initialize();
 * ```
 */
export class SmartScheduler {
    private eventBus: EventBus;
    private queueManager: TaskQueueManager;
    private workerPool: WorkerPool;
    private readonly assignTaskToConsumer: (consumer: Consumer, task: Task) => void;
    
    // 【智能调度】状态跟踪
    private processingTypeCount = new Map<string, number>();
    private largeFilesProcessing = 0;
    private lastTypeScheduleTime = new Map<string, number>();
    
    // 【新架构】轮询索引
    private nextTypeIndex = 0;
    private typeOrder: string[] = [];

    constructor(
        eventBus: EventBus,
        queueManager: TaskQueueManager,
        workerPool: WorkerPool,
        assignTaskToConsumer: (consumer: Consumer, task: Task) => void
    ) {
        this.eventBus = eventBus;
        this.queueManager = queueManager;
        this.workerPool = workerPool;
        this.assignTaskToConsumer = assignTaskToConsumer;
    }

    /**
     * 初始化智能调度器
     * 订阅所有相关事件
     */
    initialize(): void {
        if (!ENABLE_SMART_SCHEDULING) {
            return;
        }

        // 订阅 Worker 创建事件
        this.eventBus.on('worker.created', (consumer: Consumer) => {
            this.assignTaskToIdleConsumer(consumer);
        });
        
        // 订阅 Worker 空闲事件
        this.eventBus.on('worker.idle', (consumer: Consumer) => {
            this.assignTaskToIdleConsumer(consumer);
        });
        
        // 订阅任务入队事件
        this.eventBus.on('task.enqueued', () => {
            // 为第一个空闲 Worker 分配任务
            const idleConsumer = this.workerPool.getIdleConsumer();
            if (idleConsumer) {
                this.assignTaskToIdleConsumer(idleConsumer);
            }
        });
        
        // 订阅 Walker 批量文件就绪事件
        this.eventBus.on('walker.batch-ready', () => {
            // 为所有空闲 Worker 分配任务
            for (const consumer of this.workerPool.getConsumers().values()) {
                if (!consumer.busy) {
                    this.assignTaskToIdleConsumer(consumer);
                }
            }
        });
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
}
