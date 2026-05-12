/**
 * Scanner 辅助函数模块
 * 用于简化 scanner.ts 中的复杂逻辑，提高代码可读性和可维护性
 */

import {BrowserWindow} from 'electron';
import {
    BYTES_TO_MB,
    WORKER_BASE_TIMEOUT,
    WORKER_TIMEOUT_PER_MB,
    WORKER_MAX_TIMEOUT
} from '../core/scan-config';

/**
 * 创建进度更新函数（带自适应节流）
 * @param mainWindow 主窗口
 * @param getConsumerProcessedCount 获取已处理文件数的回调
 * @param getWalkerTotalCount 获取总文件数的回调
 * @param getWalkerFilteredCount 【新增】获取过滤文件数的回调
 * @param getWalkerSkippedCount 获取跳过文件数的回调
 * @param baseThrottleInterval 基础节流间隔（毫秒）
 * @returns 进度更新函数
 */
export function createProgressUpdater(
    mainWindow: BrowserWindow | null,
    getConsumerProcessedCount: () => number,
    getWalkerTotalCount: () => number,
    getWalkerFilteredCount: () => number,  // 【新增】过滤计数回调
    getWalkerSkippedCount: () => number,
    baseThrottleInterval: number = 500
): (currentFile?: string) => void {
    let lastProgressTime = 0;
    let lastScannedCount = 0;

    // 【B3 优化】自适应节流参数
    const MIN_THROTTLE = 200;   // 最小间隔 200ms（快速更新）
    const MAX_THROTTLE = 1000;  // 最大间隔 1000ms（慢速更新）
    const FAST_THRESHOLD = 50;  // 每秒处理 > 50 个文件视为快速
    const SLOW_THRESHOLD = 10;  // 每秒处理 < 10 个文件视为慢速

    return (currentFile: string = '') => {
        const now = Date.now();

        // 【B3 优化】计算当前扫描速度（文件/秒）
        const timeDiff = (now - lastProgressTime) / 1000; // 转换为秒
        const countDiff = getConsumerProcessedCount() - lastScannedCount;
        const speed = timeDiff > 0 ? countDiff / timeDiff : 0;

        // 【B3 优化】根据速度动态调整节流间隔
        let adaptiveInterval = baseThrottleInterval;
        if (speed > FAST_THRESHOLD) {
            // 快速扫描：减少更新频率，降低 UI 压力
            adaptiveInterval = Math.min(MAX_THROTTLE, baseThrottleInterval * 1.5);
        } else if (speed < SLOW_THRESHOLD && speed > 0) {
            // 慢速扫描：增加更新频率，提升用户体验
            adaptiveInterval = Math.max(MIN_THROTTLE, baseThrottleInterval * 0.7);
        }

        if (!lastProgressTime || now - lastProgressTime >= adaptiveInterval) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                // 【修复】确保 totalCount 不小于 scannedCount，避免 Windows 平台因时序问题导致显示异常
                const currentScanned = getConsumerProcessedCount();
                const currentTotal = getWalkerTotalCount();
                const safeTotalCount = Math.max(currentTotal, currentScanned);

                mainWindow.webContents.send('scan-progress', {
                    currentFile,
                    scannedCount: currentScanned,
                    totalCount: safeTotalCount,  // 【修复】使用安全值
                    filteredCount: getWalkerFilteredCount(),  // 【新增】传递过滤计数
                    skippedCount: getWalkerSkippedCount()
                });
            }
            lastProgressTime = now;
            lastScannedCount = getConsumerProcessedCount();
        }
    };
}

/**
 * 清理待处理任务
 * @param pendingTasks 待处理任务映射
 * @param taskId
 * @param onCleanup 清理回调
 */
export function cleanupPendingTask(
    pendingTasks: Map<number, any>,
    taskId: number,
    onCleanup?: (taskId: number) => void
): void {
    const pending = pendingTasks.get(taskId);
    if (pending) {
        clearTimeout(pending.timeoutId);
        pendingTasks.delete(taskId);
        if (onCleanup) {
            onCleanup(taskId);
        }
    }
}

/**
 * 标记 Consumer 为空闲状态
 * @param consumer Consumer 对象
 */
export function markConsumerIdle(consumer: any): void {
    consumer.busy = false;
    consumer.taskId = undefined;
    consumer.counted = false;  // 【P0修复】重置计数标志，允许下次任务重新计数
}

/**
 * 检查窗口是否可用并发送消息
 * @param mainWindow 主窗口
 * @param channel IPC 通道
 * @param data 发送的数据
 * @returns 是否成功发送
 */
export function sendToMainWindow(
    mainWindow: BrowserWindow | null,
    channel: string,
    data: any
): boolean {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
        return true;
    }
    return false;
}

/**
 * 【重构】根据文件大小智能计算超时时间
 * @param fileSize 文件大小（字节）
 * @returns 超时时间（毫秒）
 */
export function calculateTimeout(fileSize: number): number {
    const sizeMB = fileSize / BYTES_TO_MB;

    // 基础超时 + 按大小增长的超时
    let timeoutMs = WORKER_BASE_TIMEOUT + (sizeMB * WORKER_TIMEOUT_PER_MB);

    // 限制在最大超时范围内
    timeoutMs = Math.min(timeoutMs, WORKER_MAX_TIMEOUT);

    // 确保至少为基础超时
    timeoutMs = Math.max(timeoutMs, WORKER_BASE_TIMEOUT);

    return Math.floor(timeoutMs);
}

/**
 * 安全地终止 Worker
 * @param worker Worker 对象
 * @param consumer Consumer 对象
 * @param log 日志函数
 */
export function safelyTerminateWorker(
    worker: any,
    consumer: any,
    log: (msg: string) => void
): void {
    try {
        consumer.isTerminating = true;
        worker.terminate();
    } catch (error: any) {
        log(`终止 Worker 失败: ${error.message}`);
    }
}

/**
 * 【P3优化】批量发送管理器
 * 用于减少 IPC 通信频率，提升性能（特别是 Windows 平台）
 */
export class BatchSender {
    private buffer: any[] = [];
    private timer: NodeJS.Timeout | null = null;
    private batchSize: number;  // 【优化】改为可修改
    private batchInterval: number;  // 【优化】改为可修改
    
    constructor(batchSize: number = 100, batchInterval: number = 500) {
        this.batchSize = batchSize;
        this.batchInterval = batchInterval;
    }
    
    /**
     * 【新增】动态调整批量大小和间隔
     * @param batchSize 新的批量大小
     * @param batchInterval 新的批量间隔（毫秒）
     */
    configure(batchSize?: number, batchInterval?: number): void {
        if (batchSize !== undefined) {
            this.batchSize = Math.max(1, batchSize);  // 至少为 1
        }
        if (batchInterval !== undefined) {
            this.batchInterval = Math.max(0, batchInterval);  // 至少为 0
        }
    }
    
    send(mainWindow: BrowserWindow | null, channel: string, data: any): void {
        this.buffer.push(data);
        
        // 如果达到批量大小，立即发送
        if (this.buffer.length >= this.batchSize) {
            this.flush(mainWindow, channel);
            return;
        }
        
        // 否则等待间隔时间后发送
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.flush(mainWindow, channel);
            }, this.batchInterval);
        }
    }
    
    private flush(mainWindow: BrowserWindow | null, channel: string): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        if (mainWindow && !mainWindow.isDestroyed() && this.buffer.length > 0) {
            // 批量发送
            mainWindow.webContents.send(channel, this.buffer);
            this.buffer = [];
        }
    }
    
    destroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.buffer = [];
    }
    
    /**
     * 【关键修复】flush 剩余数据并销毁
     * 用于扫描结束时，确保最后一批数据被发送
     */
    flushAndDestroy(mainWindow: BrowserWindow | null, channel: string): void {
        // 先 flush 剩余数据
        if (this.buffer.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, this.buffer);
        }
        // 然后销毁
        this.destroy();
    }
}

// 导出单例（用于扫描结果批量发送）
export const resultBatchSender = new BatchSender(100, 500);

/**
 * 【P3优化】日志抑制器 - 基于数量和时间的双重触发机制
 * 
 * 【使用场景】
 * - 高频日志输出需要抑制频率
 * - 既要保证进度可见性，又要避免日志过多
 * - 数量触发 + 时间触发，谁先达到就执行
 * 
 * 【示例】
 * ```typescript
 * const logThrottler = new LogThrottler({
 *   countInterval: 100,      // 每 100 条输出一次
 *   timeIntervalMs: 2000     // 或每 2 秒输出一次
 * });
 * 
 * if (logThrottler.shouldLog()) {
 *   log.info(`处理进度: ${count}`);
 * }
 * ```
 */
export class LogThrottler {
    private lastLogTime: number = 0;
    private readonly countInterval: number;     // 数量间隔
    private readonly timeIntervalMs: number;    // 时间间隔（毫秒）
    
    constructor(options: {
        countInterval: number;      // 每多少条输出一次
        timeIntervalMs: number;     // 至少多少毫秒输出一次
    }) {
        this.countInterval = options.countInterval;
        this.timeIntervalMs = options.timeIntervalMs;
    }
    
    /**
     * 判断是否应该输出日志（数量 + 时间双重触发）
     * @param currentCount 当前计数
     * @returns 是否应该输出日志
     */
    shouldLog(currentCount: number): boolean {
        const now = Date.now();
        const shouldLogByCount = (currentCount % this.countInterval === 0);
        const shouldLogByTime = (now - this.lastLogTime >= this.timeIntervalMs);
        
        if (shouldLogByCount || shouldLogByTime) {
            this.lastLogTime = now;
            return true;
        }
        
        return false;
    }
    
    /**
     * 重置状态（用于扫描重新开始）
     */
    reset(): void {
        this.lastLogTime = 0;
    }
}
