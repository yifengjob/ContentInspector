import { EventEmitter } from 'events';

/**
 * 扫描状态数据接口
 */
export interface ScanStateData {
    // Worker 相关
    activeWorkerCount: number;        // 活跃 Worker 数量
    
    // Walker 相关
    walkerTotalCount: number;         // Walker 遍历的文件总数
    walkerFilteredCount: number;      // Walker 过滤的文件数
    walkerSkippedCount: number;       // Walker 跳过的文件数
    
    // Consumer 相关
    consumerProcessedCount: number;   // Consumer 已处理的文件数
    
    // 结果相关
    resultCount: number;              // 发现的敏感文件数
    totalSensitiveItems: number;      // 敏感项总数
    
    // 任务队列相关
    taskQueueLength: number;          // 任务队列长度
    pendingTasksSize: number;         // 待处理任务数
}

export class ScanState extends EventEmitter {
    // 【单例模式】全局唯一的 ScanState 实例
    private static instance: ScanState | null = null;
    
    public isScanning: boolean = false;
    public cancelFlag: boolean = false;
    public logs: string[] = [];
    
    // 【新增】扫描过程中的共享状态
    private state: ScanStateData = {
        activeWorkerCount: 0,
        walkerTotalCount: 0,
        walkerFilteredCount: 0,
        walkerSkippedCount: 0,
        consumerProcessedCount: 0,
        resultCount: 0,
        totalSensitiveItems: 0,
        taskQueueLength: 0,
        pendingTasksSize: 0
    };
    
    // 【新增】已计数的任务 ID 集合（用于防止重复计数）
    private countedTaskIds: Set<number> = new Set();
    
    /**
     * 私有构造函数，防止外部直接实例化
     */
    private constructor() {
        super();
    }
    
    /**
     * 获取单例实例（类似 Pinia 的 useStore）
     * @returns ScanState 单例实例
     */
    static getInstance(): ScanState {
        if (!ScanState.instance) {
            ScanState.instance = new ScanState();
        }
        return ScanState.instance;
    }
    
    /**
     * 重置单例实例（仅在测试或特殊场景使用）
     */
    static resetInstance(): void {
        if (ScanState.instance) {
            ScanState.instance.reset();
        }
    }
    
    /**
     * 重置所有状态（开始新扫描时调用）
     */
    reset(): void {
        this.isScanning = false;
        this.cancelFlag = false;
        this.logs = [];
        
        // 【新增】重置扫描状态
        this.state = {
            activeWorkerCount: 0,
            walkerTotalCount: 0,
            walkerFilteredCount: 0,
            walkerSkippedCount: 0,
            consumerProcessedCount: 0,
            resultCount: 0,
            totalSensitiveItems: 0,
            taskQueueLength: 0,
            pendingTasksSize: 0
        };
        this.countedTaskIds.clear();
        
        // 通知监听器状态已重置
        this.emit('state-reset');
    }
    
    // ==================== Active Worker Count ====================
    
    /**
     * 增加活跃 Worker 计数
     * @returns 增加后的计数值
     */
    incrementActiveWorkers(): number {
        this.state.activeWorkerCount++;
        this.emit('active-workers-changed', this.state.activeWorkerCount);
        return this.state.activeWorkerCount;
    }
    
    /**
     * 减少活跃 Worker 计数
     * @returns 减少后的计数值
     */
    decrementActiveWorkers(): number {
        if (this.state.activeWorkerCount > 0) {
            this.state.activeWorkerCount--;
        }
        this.emit('active-workers-changed', this.state.activeWorkerCount);
        return this.state.activeWorkerCount;
    }
    
    /**
     * 获取活跃 Worker 计数
     */
    getActiveWorkerCount(): number {
        return this.state.activeWorkerCount;
    }
    
    /**
     * 设置活跃 Worker 计数（直接设置，慎用）
     */
    setActiveWorkerCount(count: number): void {
        this.state.activeWorkerCount = Math.max(0, count);
        this.emit('active-workers-changed', this.state.activeWorkerCount);
    }
    
    // ==================== Walker Counts ====================
    
    /**
     * 增加 Walker 遍历的文件总数
     */
    incrementWalkerTotalCount(): number {
        this.state.walkerTotalCount++;
        this.emit('walker-total-changed', this.state.walkerTotalCount);
        return this.state.walkerTotalCount;
    }
    
    /**
     * 批量增加 Walker 遍历的文件总数
     */
    addWalkerTotalCount(count: number): number {
        this.state.walkerTotalCount += count;
        this.emit('walker-total-changed', this.state.walkerTotalCount);
        return this.state.walkerTotalCount;
    }
    
    /**
     * 获取 Walker 遍历的文件总数
     */
    getWalkerTotalCount(): number {
        return this.state.walkerTotalCount;
    }
    
    /**
     * 增加 Walker 过滤的文件数
     */
    incrementWalkerFilteredCount(): number {
        this.state.walkerFilteredCount++;
        return this.state.walkerFilteredCount;
    }
    
    /**
     * 批量增加 Walker 过滤的文件数
     */
    addWalkerFilteredCount(count: number): number {
        this.state.walkerFilteredCount += count;
        return this.state.walkerFilteredCount;
    }
    
    /**
     * 获取 Walker 过滤的文件数
     */
    getWalkerFilteredCount(): number {
        return this.state.walkerFilteredCount;
    }
    
    /**
     * 增加 Walker 跳过的文件数
     */
    incrementWalkerSkippedCount(): number {
        this.state.walkerSkippedCount++;
        return this.state.walkerSkippedCount;
    }
    
    /**
     * 批量增加 Walker 跳过的文件数
     */
    addWalkerSkippedCount(count: number): number {
        this.state.walkerSkippedCount += count;
        return this.state.walkerSkippedCount;
    }
    
    /**
     * 获取 Walker 跳过的文件数
     */
    getWalkerSkippedCount(): number {
        return this.state.walkerSkippedCount;
    }
    
    // ==================== Consumer Processed Count ====================
    
    /**
     * 增加 Consumer 已处理的文件数（带去重）
     * @param taskId 任务 ID
     * @returns 是否成功增加（false 表示该任务已计数）
     */
    incrementConsumerProcessedCount(taskId: number): boolean {
        if (this.countedTaskIds.has(taskId)) {
            return false; // 已计数，跳过
        }
        this.countedTaskIds.add(taskId);
        this.state.consumerProcessedCount++;
        this.emit('consumer-processed-changed', this.state.consumerProcessedCount);
        return true;
    }
    
    /**
     * 获取 Consumer 已处理的文件数
     */
    getConsumerProcessedCount(): number {
        return this.state.consumerProcessedCount;
    }
    
    /**
     * 检查任务是否已计数
     */
    isTaskCounted(taskId: number): boolean {
        return this.countedTaskIds.has(taskId);
    }
    
    // ==================== Result Counts ====================
    
    /**
     * 增加敏感文件计数
     */
    incrementResultCount(): number {
        this.state.resultCount++;
        this.emit('result-count-changed', this.state.resultCount);
        return this.state.resultCount;
    }
    
    /**
     * 获取敏感文件计数
     */
    getResultCount(): number {
        return this.state.resultCount;
    }
    
    /**
     * 增加敏感项总数
     */
    addTotalSensitiveItems(count: number): number {
        this.state.totalSensitiveItems += count;
        return this.state.totalSensitiveItems;
    }
    
    /**
     * 获取敏感项总数
     */
    getTotalSensitiveItems(): number {
        return this.state.totalSensitiveItems;
    }
    
    // ==================== Task Queue ====================
    
    /**
     * 设置任务队列长度
     */
    setTaskQueueLength(length: number): void {
        this.state.taskQueueLength = length;
    }
    
    /**
     * 获取任务队列长度
     */
    getTaskQueueLength(): number {
        return this.state.taskQueueLength;
    }
    
    /**
     * 设置待处理任务数
     */
    setPendingTasksSize(size: number): void {
        this.state.pendingTasksSize = size;
    }
    
    /**
     * 获取待处理任务数
     */
    getPendingTasksSize(): number {
        return this.state.pendingTasksSize;
    }
    
    // ==================== Complete State ====================
    
    /**
     * 获取完整状态快照
     */
    getStateSnapshot(): ScanStateData {
        return { ...this.state };
    }
    
    /**
     * 检查是否满足完成条件
     * @param allWalkersCompleted 所有 Walker 是否已完成
     */
    isScanComplete(allWalkersCompleted: boolean): boolean {
        return (
            allWalkersCompleted &&
            this.state.activeWorkerCount === 0 &&
            this.state.taskQueueLength === 0 &&
            this.state.pendingTasksSize === 0
        );
    }
}
