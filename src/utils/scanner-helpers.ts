/**
 * Scanner 辅助函数模块
 * 用于简化 scanner.ts 中的复杂逻辑，提高代码可读性和可维护性
 */

import {BrowserWindow} from 'electron';
import {ScanState} from '../core/scan-state';
import {
    BYTES_TO_MB,
    MAX_LOG_ENTRIES,
    WORKER_BASE_TIMEOUT,
    WORKER_TIMEOUT_PER_MB,
    WORKER_MAX_TIMEOUT, SCAN_LOG_FILE_LEVEL, SCAN_LOG_FRONTEND_LEVEL, SCAN_LOG_MEMORY_LEVEL
} from '../core/scan-config';
import {LogLevel} from "../types";
// 【新增】导入公共工具函数
import {getBeijingTimestamp, formatLogMessage, Logger} from '../logger/logger';


/**
 * 日志配置
 */
interface LogConfig {
    fileLevel: LogLevel;      // 写入文件的最低级别
    frontendLevel: LogLevel;  // 发送到前端的最低级别
    memoryLevel: LogLevel;    // 保存到内存的最低级别
}

/**
 * 默认日志配置
 * - 文件：记录 WARN 及以上（减少磁盘 I/O）
 * - 前端：记录 INFO 及以上（实时显示扫描进度）
 * - 内存：记录 INFO 及以上（保留必要历史）
 */
const DEFAULT_LOG_CONFIG: LogConfig = {
    fileLevel: SCAN_LOG_FILE_LEVEL,
    frontendLevel: SCAN_LOG_FRONTEND_LEVEL,
    memoryLevel: SCAN_LOG_MEMORY_LEVEL,
};

/**
 * 创建扫描器专用日志记录器（高性能版本）
 *
 * 【适用场景】
 * - 扫描过程的高频日志
 * - 需要实时更新前端 UI
 * - 需要保存到 ScanState 供前端查询
 *
 * 【注意】
 * - 仅适用于主进程（依赖 BrowserWindow）
 * - Worker 线程请使用 logger.ts 的 createLogger
 *
 * 【性能优化】
 * - ✅ 环形缓冲区优化（O(1) 时间复杂度）
 * - ✅ 前端 IPC 实时通信
 * - ✅ 自适应更新频率（防止 OOM）
 * - ✅ 缓存转换后的数组，避免重复创建
 *
 * @param scanState 扫描状态
 * @param mainWindow 主窗口
 * @param config 日志配置（可选）
 * @returns 日志记录器（可调用 + 便捷方法）
 */
export function createScannerLogger(
    scanState: ScanState,
    mainWindow: BrowserWindow | null,
    config: LogConfig = DEFAULT_LOG_CONFIG
): Logger {
    // 【B1 优化】使用环形缓冲区替代数组 shift()
    const logs = new Array<string>(MAX_LOG_ENTRIES);
    let logIndex = 0;
    let logCount = 0;

    // 【性能优化】缓存转换后的数组，避免每次日志都重新创建
    // 注意：此变量通过 scanState.logs 对外提供，供前端读取
    let cachedLogsArray: string[] = [];

    // 【性能优化】限制日志更新频率，防止 OOM
    let lastLogUpdateTime = 0;

    // 【核心】内部日志处理函数（支持可变参数和占位符）
    const logInternal = (...args: any[]) => {
        processLogEntry(args, LogLevel.INFO);
    };

    // 【新增】创建带便捷方法的日志记录器（支持可变参数和占位符）
    const logger = logInternal as Logger;
    
    // 【重构】提取公共日志处理逻辑，避免代码重复
    function processLogEntry(args: any[], level: LogLevel): void {
        // 【复用】使用 logger.ts 的 formatLogMessage 支持占位符
        const msg = formatLogMessage(args);
        
        // 【优化】根据级别判断是否需要处理
        const shouldSaveToMemory = level >= config.memoryLevel;
        const shouldSendToFrontend = level >= config.frontendLevel;
        const shouldWriteToFile = level >= config.fileLevel;

        // 如果都不需要，直接返回
        if (!shouldSaveToMemory && !shouldSendToFrontend && !shouldWriteToFile) {
            return;
        }

        // 【复用】使用 logger.ts 的公共工具函数
        const timeStr = getBeijingTimestamp();
        const levelPrefix = LogLevel[level];
        const logWithTime = `[${timeStr}] [${levelPrefix}] ${msg}`;

        // 【优化】只有需要保存到内存时才执行
        if (shouldSaveToMemory) {
            // 【B1 优化】环形缓冲区：O(1) 时间复杂度
            logs[logIndex % MAX_LOG_ENTRIES] = logWithTime;
            logIndex++;
            logCount = Math.min(logCount + 1, MAX_LOG_ENTRIES);

            // 【性能优化】限制更新频率，每 50 条日志或每秒更新一次
            const now = Date.now();
            if (!lastLogUpdateTime || now - lastLogUpdateTime >= 1000 || logCount % 50 === 0) {
                // 将环形缓冲区转换为普通数组（供前端显示）
                if (logCount < MAX_LOG_ENTRIES) {
                    // 未满时，直接截取
                    cachedLogsArray = logs.slice(0, logCount);
                } else {
                    // 已满时，从当前位置开始循环读取
                    const start = logIndex % MAX_LOG_ENTRIES;
                    cachedLogsArray = [
                        ...logs.slice(start),
                        ...logs.slice(0, start)
                    ];
                }

                // 更新到 scanState
                scanState.logs = cachedLogsArray;
                lastLogUpdateTime = now;
            }
        }

        // 【优化】只有需要发送到前端时才执行
        if (shouldSendToFrontend) {
            setImmediate(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('scan-log', logWithTime);
                }
            });
        }

        // 【优化】只有需要写入文件时才执行
        if (shouldWriteToFile) {
            setImmediate(() => {
                console.log(logWithTime);  // 通过 console.log 写入日志文件
            });
        }
    }
    
    logger.debug = (...args: any[]) => processLogEntry(args, LogLevel.DEBUG);
    logger.info = (...args: any[]) => processLogEntry(args, LogLevel.INFO);
    logger.warn = (...args: any[]) => processLogEntry(args, LogLevel.WARN);
    logger.error = (...args: any[]) => processLogEntry(args, LogLevel.ERROR);

    // 【新增】添加销毁方法，清理资源
    logger.destroy = () => {
        // 清空日志数组
        logs.fill('');
        logIndex = 0;
        logCount = 0;
        
        // 清空缓存数组
        cachedLogsArray = [];
        
        // 清空 scanState 中的引用
        scanState.logs = [];
        
        lastLogUpdateTime = 0;
    };

    return logger;
}

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
    private readonly batchSize: number;
    private readonly batchInterval: number;
    
    constructor(batchSize: number = 100, batchInterval: number = 500) {
        this.batchSize = batchSize;
        this.batchInterval = batchInterval;
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
