/**
 * 任务队列管理模块
 * 
 * 职责：
 * - 按文件类型和大小分类的多队列结构
 * - 任务入队、出队操作
 * - 队列状态查询和清理
 */

import {EventBus} from './event-bus';

/**
 * 任务接口
 */
export interface Task {
    filePath: string;
    fileSize: number;
    fileMtime: string;
    enqueueTime: number;           // 入队时间（用于等待时间计算）
    fileType: string;              // 文件类型（excel/pdf/word等）
    isLargeFile: boolean;          // 是否为大文件
}

/**
 * 按大小分类的队列
 */
interface TypeQueues {
    large: Task[];  // 大文件队列
    small: Task[];  // 小文件队列
}

/**
 * 任务队列管理器
 * 
 * 使用示例：
 * ```typescript
 * const queueManager = new TaskQueueManager(eventBus);
 * 
 * // 入队
 * queueManager.enqueueTask(task);
 * 
 * // 出队
 * const task = queueManager.dequeueTask('pdf', false);
 * 
 * // 获取队列长度
 * const length = queueManager.getQueueLength();
 * ```
 */
export class TaskQueueManager {
    private queueByTypeAndSize: Map<string, TypeQueues>;
    private eventBus: EventBus;

    constructor(eventBus: EventBus) {
        this.queueByTypeAndSize = new Map();
        this.eventBus = eventBus;
    }

    /**
     * 初始化某个类型的队列
     */
    ensureTypeQueue(fileType: string): void {
        if (!this.queueByTypeAndSize.has(fileType)) {
            this.queueByTypeAndSize.set(fileType, {large: [], small: []});
        }
    }

    /**
     * 向队列中添加任务
     * 【事件总线】任务入队后发布事件，由调度器统一处理分配
     */
    enqueueTask(task: Task): void {
        this.ensureTypeQueue(task.fileType);
        const queues = this.queueByTypeAndSize.get(task.fileType)!;

        if (task.isLargeFile) {
            queues.large.push(task);
        } else {
            queues.small.push(task);
        }

        // 【事件总线】发布任务入队事件
        this.eventBus.emit('task.enqueued', task);
    }

    /**
     * 从队列中移除任务
     * @param fileType 文件类型
     * @param isLargeFile 是否为大文件
     * @returns 任务对象，如果队列为空则返回 null
     */
    dequeueTask(fileType: string, isLargeFile: boolean): Task | null {
        const queues = this.queueByTypeAndSize.get(fileType);
        if (!queues) return null;

        const queue = isLargeFile ? queues.large : queues.small;
        if (queue.length === 0) return null;

        const task = queue.shift();  // O(1) - 从头部移除
        return task || null;
    }

    /**
     * 获取队列中的任务总数
     */
    getQueueLength(): number {
        let total = 0;
        for (const queues of this.queueByTypeAndSize.values()) {
            total += queues.large.length + queues.small.length;
        }
        return total;
    }

    /**
     * 清理空的队列类型，防止 Map 无限增长
     */
    cleanupEmptyQueues(): void {
        for (const [fileType, queues] of this.queueByTypeAndSize.entries()) {
            if (queues.large.length === 0 && queues.small.length === 0) {
                this.queueByTypeAndSize.delete(fileType);
            }
        }
    }

    /**
     * 清空所有队列
     */
    clearAll(): void {
        for (const queues of this.queueByTypeAndSize.values()) {
            queues.large.length = 0;
            queues.small.length = 0;
        }
        this.queueByTypeAndSize.clear();
    }

    /**
     * 获取所有文件类型列表
     */
    getFileTypes(): string[] {
        return Array.from(this.queueByTypeAndSize.keys());
    }

    /**
     * 获取指定类型的队列信息
     */
    getTypeQueueInfo(fileType: string): {largeCount: number, smallCount: number} | null {
        const queues = this.queueByTypeAndSize.get(fileType);
        if (!queues) return null;

        return {
            largeCount: queues.large.length,
            smallCount: queues.small.length
        };
    }

    /**
     * 获取下一个要处理的类型（轮询策略）
     * @param typeOrder 类型顺序数组
     * @param nextTypeIndexRef
     */
    getNextType(typeOrder: string[], nextTypeIndexRef: {value: number}): string | null {
        if (typeOrder.length === 0) return null;

        const index = nextTypeIndexRef.value % typeOrder.length;
        nextTypeIndexRef.value++;
        return typeOrder[index];
    }

    /**
     * 【关键功能】获取所有任务的统计信息（用于智能内存计算）
     * @returns 总大小和总数量
     */
    getAllTasksStats(): { totalSize: number; totalCount: number } {
        let totalSize = 0;
        let totalCount = 0;

        for (const queues of this.queueByTypeAndSize.values()) {
            for (const task of queues.large) {
                totalSize += task.fileSize;
                totalCount++;
            }
            for (const task of queues.small) {
                totalSize += task.fileSize;
                totalCount++;
            }
        }

        return { totalSize, totalCount };
    }
}
