import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {BrowserWindow} from 'electron';
import {Worker} from 'worker_threads';
import {ScanConfig, ScanResultItem} from './types';
import {ScanState} from './scan-state';
import {addAllowedPath, clearAllowedPaths} from './file-operations';
import {calculateActualConcurrency} from './config-manager';
// 【优化】导入扫描配置常量
import {
    WORKER_MAX_OLD_GENERATION_MB,
    WORKER_MAX_YOUNG_GENERATION_MB,
    STAGNATION_CHECK_INTERVAL,
    STAGNATION_THRESHOLD,
    MAX_IDLE_TIME,
    PROGRESS_THROTTLE_INTERVAL,
    WORKER_RESTART_DELAY,
    BYTES_TO_MB,  // 【A1 优化】用于计算平均文件大小
    // 【智能调度】导入智能调度配置
    ENABLE_SMART_SCHEDULING,
    LARGE_FILE_THRESHOLD_MB,
    MAX_LARGE_FILES_CONCURRENT,
    TYPE_MUTEX_TIMEOUT_MS
} from './scan-config';
// 【新增】导入辅助函数
import {
    createLogger,
    createProgressUpdater,
    markConsumerIdle,
    sendToMainWindow,
    calculateTimeout as calcTimeout,
    safelyTerminateWorker// 【新增】日志级别
} from './scanner-helpers';
// 【新增】导入文件类型工具函数
import { getFileType } from './file-types';

export async function startScan(
    config: ScanConfig,
    mainWindow: BrowserWindow,
    scanState: ScanState
): Promise<void> {
    if (scanState.isScanning) {
        throw new Error('扫描正在进行中');
    }

    scanState.isScanning = true;
    scanState.cancelFlag = false;
    scanState.logs = [];

    // 清除旧的允许路径，添加新的扫描路径
    clearAllowedPaths();
    config.selectedPaths.forEach(p => addAllowedPath(p));

    // 【重构】使用辅助函数创建 logger
    const log = createLogger(scanState, mainWindow);

    log.info('开始扫描...');
    log.info(`扫描路径数: ${config.selectedPaths.length}`);
    log.info(`文件类型数: ${config.selectedExtensions.length}`);
    log.info(`选中的扩展名: ${config.selectedExtensions.join(', ')}`);
    log.info(`敏感检测类型: ${config.enabledSensitiveTypes.join(', ')}`);
    log.info('---');

    // 计算并发数
    const concurrencyInfo = calculateActualConcurrency(config.scanConcurrency);
    const poolSize = concurrencyInfo.actualConcurrency;

    if (config.scanConcurrency && config.scanConcurrency > concurrencyInfo.maxAllowedConcurrency) {
        log.warn(`配置的并发数 ${config.scanConcurrency} 超过最大值 ${concurrencyInfo.maxAllowedConcurrency}，已自动调整`);
        log.info(`系统可用内存 ${concurrencyInfo.freeMemoryGB.toFixed(1)} GB, CPU ${concurrencyInfo.cpuCount} 核, 建议不超过 ${concurrencyInfo.maxAllowedConcurrency}`);
    }

    log.info(`使用 ${poolSize} 个 Consumer Workers (CPU: ${concurrencyInfo.cpuCount}核, 可用内存: ${concurrencyInfo.freeMemoryGB.toFixed(1)}GB)`);

    // 统计信息
    let walkerTotalCount = 0;      // Walker 找到的文件总数
    let walkerFilteredCount = 0;   // 【新增】Walker 过滤的文件数（用户配置）
    let walkerSkippedCount = 0;    // 【修改】Walker 跳过的文件数（系统原因）
    let consumerProcessedCount = 0; // Consumer 已处理的文件数
    let resultCount = 0;            // 发现的敏感文件数
    let totalSensitiveItems = 0;    // 【新增】发现的敏感信息总条数
    let activeWorkerCount = 0;      // 【优化】跟踪活跃的 Worker 数量
    const countedTaskIds = new Set<number>(); // 【修复】防止重复计数

    // 【Map优化】创建 Consumer Workers 池（使用 Map 提升查找/删除效率）
    const consumers = new Map<number, {
        id: number;              // Worker ID
        worker: Worker;
        busy: boolean;
        taskId?: number;
        counted?: boolean;         // 【P0修复】防止重复计数
        isTerminating?: boolean;   // 【新增】标记是否正在被主动终止
        // 【智能调度】扩展字段
        currentFileType?: string;      // 当前处理的文件类型
        currentFileSize?: number;      // 当前处理的文件大小（字节）
        taskStartTime?: number;        // 任务开始时间（用于超时检测）
    }>();

    const pendingTasks = new Map<number, {
        filePath: string;
        resolve: (result: any) => void;
        reject: (error: any) => void;
        timeoutId: NodeJS.Timeout;
    }>();

    let nextTaskId = 0;

    // 【智能调度】扩展 Task 接口
    interface Task {
        filePath: string;
        fileSize: number;
        fileMtime: string;
        enqueueTime: number;           // 入队时间（用于等待时间计算）
        fileType: string;              // 文件类型（excel/pdf/word等）
        isLargeFile: boolean;          // 是否为大文件
    }

    // 【新架构】按文件类型和大小分类的多队列结构
    interface TypeQueues {
        large: Task[];  // 大文件队列
        small: Task[];  // 小文件队列
    }

    const queueByTypeAndSize: Map<string, TypeQueues> = new Map();

    /**
     * 【新架构】初始化某个类型的队列
     */
    function ensureTypeQueue(fileType: string): void {
        if (!queueByTypeAndSize.has(fileType)) {
            queueByTypeAndSize.set(fileType, {large: [], small: []});
        }
    }

    /**
     * 【新架构】向队列中添加任务（O(1)）
     */
    function enqueueTask(task: Task): void {
        ensureTypeQueue(task.fileType);
        const queues = queueByTypeAndSize.get(task.fileType)!;

        if (task.isLargeFile) {
            queues.large.push(task);
        } else {
            queues.small.push(task);
        }

    }

    /**
     * 【新架构】从队列中移除任务（O(1) - 使用 shift）
     */
    function dequeueTask(fileType: string, isLargeFile: boolean): Task | null {
        const queues = queueByTypeAndSize.get(fileType);
        if (!queues) return null;

        const queue = isLargeFile ? queues.large : queues.small;
        if (queue.length === 0) return null;

        const task = queue.shift();  // O(1) - 从头部移除

        return task || null;
    }

    /**
     * 【新架构】获取队列中的任务数量
     */
    function getQueueLength(): number {
        let total = 0;
        for (const queues of queueByTypeAndSize.values()) {
            total += queues.large.length + queues.small.length;
        }
        return total;
    }

    // 【智能调度】跟踪正在处理的文件类型和数量
    const processingTypeCount = new Map<string, number>();

    // 【智能调度】跟踪正在处理的大文件数量
    let largeFilesProcessing = 0;

    // 【智能调度】记录每种类型最后被调度的时间（用于超时检测）
    const lastTypeScheduleTime = new Map<string, number>();

    // 【新架构】跟踪下一个要处理的类型（轮询策略）
    let nextTypeIndex = 0;
    const typeOrder: string[] = [];

    // 【事件驱动】跟踪最后活动时间（必须在前面声明）
    let lastActivityTime = Date.now();

    // 【修复】跟踪最后进度更新时间，防止 OOM
    let lastProgressUpdateTime = 0;

    // 【重构】使用辅助函数创建进度更新器
    const sendProgressUpdate = createProgressUpdater(
        mainWindow,
        () => consumerProcessedCount,
        () => walkerTotalCount,
        () => walkerFilteredCount,  // 【修改】传递过滤计数
        () => walkerSkippedCount,   // 【保持】传递跳过计数
        PROGRESS_THROTTLE_INTERVAL
    );

    // 【重构】防止重复计数的辅助方法
    function incrementConsumerCount(taskId: number): void {
        if (!countedTaskIds.has(taskId)) {
            countedTaskIds.add(taskId);
            consumerProcessedCount++;
        }
    }

    // 【A1 优化】根据系统可用内存和文件大小动态计算每个 Worker 的内存限制
    // 【修复】macOS 使用 getAvailableMemoryGB() 获取真实可用内存
    const freeMemoryMB = (process.platform === 'darwin'
        ? (() => {
            try {
                const {execSync} = require('child_process');
                const output = execSync('vm_stat', {encoding: 'utf-8'});
                const pageSizeMatch = output.match(/page size of (\d+) bytes/);
                const freeMatch = output.match(/Pages free:\s+(\d+)/);
                const inactiveMatch = output.match(/Pages inactive:\s+(\d+)/);
                const speculativeMatch = output.match(/Pages speculative:\s+(\d+)/);
                if (pageSizeMatch && freeMatch && inactiveMatch) {
                    const pageSize = parseInt(pageSizeMatch[1]);
                    const freePages = parseInt(freeMatch[1]);
                    const inactivePages = parseInt(inactiveMatch[1]);
                    const speculativePages = speculativeMatch ? parseInt(speculativeMatch[1]) : 0;
                    return ((freePages + inactivePages + speculativePages) * pageSize) / BYTES_TO_MB;
                }
            } catch (error) {
                log.warn('[内存计算] vm_stat 失败，使用 os.freemem()');
            }
            return os.freemem() / BYTES_TO_MB;
        })()
        : os.freemem() / BYTES_TO_MB);

    // 这里先使用默认值，在 Walker 完成后会重新调整
    // 【修复】提高到 90%，防止 Worker OOM 崩溃（原 80% 仍不够）
    let dynamicOldGenMB = Math.floor(WORKER_MAX_OLD_GENERATION_MB * 0.9);  // 512 * 0.9 = 461MB
    let dynamicYoungGenMB = Math.floor(WORKER_MAX_YOUNG_GENERATION_MB * 0.9); // 96 * 0.9 = 86MB

    // 【新增】计算智能内存配置的函数
    function calculateSmartMemoryLimits(avgFileSizeMB: number, workerCount: number): {
        oldGen: number;
        youngGen: number
    } {
        // 根据平均文件大小调整内存分配策略
        let memoryMultiplier = 1.0;

        if (avgFileSizeMB > 50) {
            // 超大文件：增加内存限制，减少并发压力
            memoryMultiplier = 1.5;
            log.info(`【智能内存】检测到大文件（平均 ${avgFileSizeMB.toFixed(1)}MB），增加 Worker 内存至 ${memoryMultiplier}x`);
        } else if (avgFileSizeMB > 10) {
            // 大文件：适度增加内存
            memoryMultiplier = 1.2;
            log.info(`【智能内存】检测到中大文件（平均 ${avgFileSizeMB.toFixed(1)}MB），适度增加 Worker 内存`);
        } else if (avgFileSizeMB < 1) {
            // 小文件：降低内存限制，提高并发效率
            memoryMultiplier = 0.6;
            log.info(`【智能内存】检测到小文件（平均 ${avgFileSizeMB.toFixed(2)}MB），降低 Worker 内存以节省资源`);
        }

        // 基础内存计算：取系统可用内存的 60% / Worker 数量
        const systemBasedLimit = Math.floor(freeMemoryMB * 0.6 / workerCount);

        // 配置限制的内存
        const configBasedLimit = Math.floor(
            (WORKER_MAX_OLD_GENERATION_MB + WORKER_MAX_YOUNG_GENERATION_MB) * memoryMultiplier
        );

        // 取两者中的较小值，确保不超过系统承受能力
        const baseMemoryPerWorker = Math.min(systemBasedLimit, configBasedLimit);

        // 设置最低和最高限制
        const minMemoryPerWorker = 200; // 【修复】最少 512MB（原200MB，防止 PDF/DOCX 解析超时）
        const maxMemoryPerWorker = Math.floor(freeMemoryMB * 0.8 / workerCount); // 最多使用 80% 可用内存

        const finalMemoryPerWorker = Math.max(
            minMemoryPerWorker,
            Math.min(baseMemoryPerWorker, maxMemoryPerWorker)
        );

        return {
            oldGen: Math.floor(finalMemoryPerWorker * 0.8),
            youngGen: Math.floor(finalMemoryPerWorker * 0.2)
        };
    }

    // 初始日志
    log.info(`【内存优化】可用内存: ${freeMemoryMB.toFixed(0)}MB, 初始每 Worker 限制: ${dynamicOldGenMB + dynamicYoungGenMB}MB`);

    // 创建 Consumer Worker
    function createConsumer(id: number, customOldGen?: number, customYoungGen?: number) {
        const workerPath = path.join(__dirname, 'file-worker.js');

        // 使用自定义内存限制或默认值
        const oldGenLimit = customOldGen || dynamicOldGenMB;
        const youngGenLimit = customYoungGen || dynamicYoungGenMB;

        let worker: Worker;
        try {
            worker = new Worker(workerPath, {
                resourceLimits: {
                    maxOldGenerationSizeMb: oldGenLimit,
                    maxYoungGenerationSizeMb: youngGenLimit,
                }
            });
        } catch (error: any) {
            log.error(`无法创建 Worker ${id} - ${error.message}`);
            return; // 跳过这个 Worker
        }

        const consumer = {
            id,                    // 【Map优化】保存 ID
            worker,
            busy: false,
            taskId: undefined,
            counted: false,       // 【P0修复】防止重复计数
            isTerminating: false  // 【新增】标记主动终止
        };

        // 【Map优化】使用 Map.set() 存储，O(1) 复杂度
        consumers.set(id, consumer);

        worker.on('message', (result) => {
            if (result.type === 'ready') {
                return;
            }

            const taskId = result.taskId;
            const pending = pendingTasks.get(taskId);

            if (!pending) {
                // 【重构】使用辅助函数标记 Consumer 为空闲
                markConsumerIdle(consumer);
                activeWorkerCount--;
                incrementConsumerCount(taskId);

                // 【智能调度】清理状态
                cleanupConsumerState(consumer);

                tryDispatch();
                return;
            }

            // 清除超时定时器
            clearTimeout(pending.timeoutId);
            pendingTasks.delete(taskId);

            // 【重构】使用辅助函数标记 Worker 为空闲
            markConsumerIdle(consumer);
            activeWorkerCount--;
            incrementConsumerCount(taskId);

            // 【智能调度】清理状态
            cleanupConsumerState(consumer);

            // 【事件驱动】更新最后活动时间
            lastActivityTime = Date.now();

            // 【优化】使用统一的进度更新函数
            sendProgressUpdate(result.filePath || '');

            // 处理结果
            if (result.error) {
                log.info(`处理文件失败: ${result.error}`);
                pending.reject(new Error(result.error));
            } else {
                if (result.total && result.total > 0) {
                    resultCount++;
                    totalSensitiveItems += result.total; // 【新增】累加敏感信息总条数

                    // 【关键修复】抑制高频日志，每100个敏感文件输出一次
                    if (resultCount % 100 === 0 || resultCount <= 10) {
                        log.info(`发现敏感文件 [${resultCount}]: ${result.filePath} (总计: ${result.total} 个敏感项)`);
                    }

                    const resultItem: ScanResultItem = {
                        filePath: result.filePath,
                        fileSize: result.fileSize || 0,
                        modifiedTime: result.modifiedTime || new Date().toISOString(),
                        counts: result.counts || {},
                        total: result.total,
                        unsupportedPreview: false
                    };

                    // 【重构】使用辅助函数发送扫描结果
                    sendToMainWindow(mainWindow, 'scan-result', resultItem);
                }
                pending.resolve(result);
            }

            // 调度下一个任务
            tryDispatch();

            // 【事件驱动】检查是否应该结束
            checkAndComplete();
        });

        worker.on('error', (error: any) => {
            log.error(`[Consumer ${id}] Worker 错误: ${error.message}`);

            // 【P0修复】只有当 consumer 处于 busy 状态且未处理过才减少计数
            if (consumer.busy && !consumer.counted) {
                consumer.counted = true;  // 标记已计数
                activeWorkerCount--;

                if (consumer.taskId !== undefined) {
                    const pending = pendingTasks.get(consumer.taskId);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        pendingTasks.delete(consumer.taskId);
                        incrementConsumerCount(consumer.taskId);
                        pending.reject(error);
                    }
                }
            }
        });

        worker.on('exit', (code: number, signal: string | null) => {
            // 【修复】区分主动终止和异常退出
            const consumerRef = consumer as ReturnType<typeof consumers.get> & { id: number };

            // 【新增】记录详细的退出信息
            if (signal) {
                log.warn(`[Consumer ${id}] Worker 被信号终止: ${signal}, 代码: ${code}`);
            }

            if (consumerRef.isTerminating) {
                // 主动终止（超时等情况），不视为异常
                log.info(`[Consumer ${id}] Worker 已终止（代码: ${code}）`);
                consumerRef.isTerminating = false;
                consumerRef.busy = false;

                // 【智能调度】清理状态
                cleanupConsumerState(consumerRef);
                return;
            }

            if (code !== 0 && !scanState.cancelFlag) {
                log.error(`[Consumer ${id}] Worker 异常退出，代码: ${code}, 信号: ${signal || 'none'}`);

                // 【新增】检测是否是 OOM 导致的退出
                const isOOM = signal === 'SIGABRT' || code === 134; // 134 是 abort() 的退出码
                if (isOOM) {
                    log.error(`[Consumer ${id}] ⚠️ 检测到 Worker OOM！将重启 Worker 并跳过当前文件`);
                }

                // 【P0修复】只有当 consumer 处于 busy 状态且未处理过才更新计数
                if (consumerRef.busy && consumerRef.taskId !== undefined && !consumerRef.counted) {
                    consumerRef.counted = true;  // 标记已计数
                    activeWorkerCount--;

                    const pending = pendingTasks.get(consumerRef.taskId);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        pendingTasks.delete(consumerRef.taskId);
                        incrementConsumerCount(consumerRef.taskId);

                        // 【新增】返回友好的 OOM 错误信息
                        const errorMsg = isOOM
                            ? '内存不足，文件可能过大或格式异常，已跳过'
                            : `Worker 异常退出（代码: ${code}）`;
                        pending.reject(new Error(errorMsg));
                    }

                    // 【智能调度】清理状态
                    cleanupConsumerState(consumerRef);
                } else {
                    // Worker 空闲时退出，只需标记
                    consumerRef.busy = false;

                    // 【智能调度】清理状态
                    cleanupConsumerState(consumerRef);
                }

                // 【关键】延迟重启 Worker，避免频繁创建销毁
                setTimeout(() => {
                    if (!scanState.cancelFlag) {
                        log.info(`[Consumer ${id}] 正在重启 Worker...`);

                        // 【Map优化】使用 Map.delete() 删除，O(1) 复杂度
                        consumers.delete(id);

                        // 【Map优化】复用相同的 ID 创建新 Worker
                        createConsumer(id);

                        // 【新增】Worker 重启后强制 GC，释放内存
                        if ((global as any).gc) {
                            log.info(`[Consumer ${id}] 执行强制垃圾回收...`);
                            (global as any).gc();
                        }
                        // 【关键】重启后立即尝试调度任务，防止停滞
                        setTimeout(() => tryDispatch(), 100);
                    }
                }, WORKER_RESTART_DELAY);
            } else {
                consumerRef.busy = false;
            }
        });
    }

    // 创建所有 Consumer Workers
    for (let i = 0; i < poolSize; i++) {
        createConsumer(i);
    }

    // 【重构】使用智能超时计算函数
    const calculateTimeout = (fileSize: number) => calcTimeout(fileSize);

    // ==================== 【智能调度】核心函数 ====================

    /**
     * 检查类型是否被阻塞（同类型已达上限）
     * 【关键修复】区分大文件和小文件：
     * - 大文件：严格互斥，最多 1 个并发
     * - 小文件：允许同类型并行，不阻塞
     */
    function isTypeBlocked(fileType: string, isLargeFile: boolean = false): boolean {
        const count = processingTypeCount.get(fileType) || 0;

        if (isLargeFile) {
            // 大文件：严格互斥，最多 1 个并发
            return count >= 1;
        } else {
            // 小文件：不阻塞，允许同类型并行 ✅
            return false;
        }
    }

    /**
     * 【新架构】检查类型超时，如果超时则允许同类型
     */
    function checkTypeTimeoutAndSelect(): Task | null {
        const now = Date.now();

        for (const [fileType, lastTime] of lastTypeScheduleTime.entries()) {
            if (now - lastTime > TYPE_MUTEX_TIMEOUT_MS) {
                // 超时，允许该类型的任务
                log.info(`[智能调度] 类型 '${fileType}' 超时 ${(now - lastTime) / 1000}s，解除互斥`);

                // 【新架构】直接从队列中获取（优先小文件）
                const queues = queueByTypeAndSize.get(fileType);
                if (!queues) continue;

                if (queues.small.length > 0) {
                    return dequeueTask(fileType, false);
                }

                if (queues.large.length > 0) {
                    return dequeueTask(fileType, true);
                }
            }
        }

        return null;
    }

    /**
     * 【新架构】为指定 Worker 选择最优任务（O(1) 复杂度）
     *
     * 调度策略优先级：
     * 1. 优先处理大文件（如果未达上限且类型不冲突）
     * 2. 选择不同类型的小文件（确保 Worker 不闲置）
     * 3. 类型超时后允许同类型（防止死锁）
     * 4. 兜底：违反类型互斥，但遵守大文件限制（确保 Worker 不闲置）
     */
    function selectOptimalTask(): Task | null {
        // 如果队列为空，直接返回
        if (getQueueLength() === 0) {
            return null;
        }

        // 更新类型顺序列表
        typeOrder.length = 0;
        for (const fileType of queueByTypeAndSize.keys()) {
            typeOrder.push(fileType);
        }

        // 【边界条件检查】如果 typeOrder 为空（竞态条件），直接返回
        if (typeOrder.length === 0) {
            return null;
        }

        // ==================== 策略 1: 优先处理大文件（类型不冲突）====================
        // 目标：充分利用并发能力，尽早开始处理大文件
        // 条件：大文件未达上限 + 类型未被阻塞
        if (largeFilesProcessing < MAX_LARGE_FILES_CONCURRENT) {
            // 轮询所有类型，找到第一个未被阻塞的大文件
            for (let i = 0; i < typeOrder.length; i++) {
                const idx = (nextTypeIndex + i) % typeOrder.length;
                const fileType = typeOrder[idx];

                if (!isTypeBlocked(fileType, true)) {  // ✅ 大文件严格互斥
                    const queues = queueByTypeAndSize.get(fileType);
                    if (queues && queues.large.length > 0) {
                        // 找到！更新轮询索引
                        nextTypeIndex = (idx + 1) % typeOrder.length;
                        log.debug(`[智能调度] 策略1: 优先处理大文件 ${fileType}`);
                        return dequeueTask(fileType, true);  // ✅ 要求1：最多 MAX_LARGE_FILES_CONCURRENT 个大文件
                    }
                }
            }
        }

        // ==================== 策略 2: 选择不同类型的小文件 ====================
        // 目标：确保 Worker 不闲置，同时遵守类型互斥规则
        // 【关键修复】小文件允许同类型并行，不检查 isTypeBlocked
        for (let i = 0; i < typeOrder.length; i++) {
            const idx = (nextTypeIndex + i) % typeOrder.length;
            const fileType = typeOrder[idx];

            const queues = queueByTypeAndSize.get(fileType);
            if (!queues) continue;

            // 优先大文件（如果未达上限且类型未被阻塞）
            if (queues.large.length > 0 && largeFilesProcessing < MAX_LARGE_FILES_CONCURRENT) {
                if (!isTypeBlocked(fileType, true)) {  // ✅ 大文件严格互斥
                    nextTypeIndex = (idx + 1) % typeOrder.length;
                    log.debug(`[智能调度] 策略2: 选择大文件 ${fileType}`);
                    return dequeueTask(fileType, true);  // ✅ 要求1：最多 MAX_LARGE_FILES_CONCURRENT 个大文件
                }
            }

            // 其次选择小文件（不检查类型阻塞，允许同类型并行）✅
            if (queues.small.length > 0) {
                nextTypeIndex = (idx + 1) % typeOrder.length;
                log.debug(`[智能调度] 策略2: 选择小文件 ${fileType}（允许同类型并行）`);
                return dequeueTask(fileType, false);
            }
        }

        // ==================== 策略 3: 类型超时检查 ====================
        // 目标：防止死锁（当所有类型都被阻塞时）
        // 条件：某个类型的最后调度时间超过 TYPE_MUTEX_TIMEOUT_MS
        const timeoutTask = checkTypeTimeoutAndSelect();
        if (timeoutTask) {
            log.debug(`[智能调度] 策略3: 类型超时，允许同类型 ${path.basename(timeoutTask.filePath)}`);
            return timeoutTask;
        }

        // ==================== 策略 4: 兜底 - 违反类型互斥，但遵守大文件限制 ====================
        // 目标：确保 Worker 不闲置（宁可违反类型互斥）
        // 原则：✅ 要求3：当文件类型数量不够时，可以有多个 Worker 处理相同类型的文件
        //      ✅ 前提：不违反大文件规则

        // 优先选择大文件（如果未达上限）
        if (largeFilesProcessing < MAX_LARGE_FILES_CONCURRENT) {  // ✅ 要求1：最多 MAX_LARGE_FILES_CONCURRENT 个大文件
            for (const fileType of typeOrder) {
                const queues = queueByTypeAndSize.get(fileType);
                if (queues && queues.large.length > 0) {
                    log.debug(`[智能调度] 策略4: 所有类型阻塞，选择大文件 ${fileType}（违反类型互斥）`);
                    return dequeueTask(fileType, true);  // ✅ 要求3：允许多个 Worker 处理同类型
                }
            }
        }

        // 其次选择小文件（即使违反类型互斥）
        for (const fileType of typeOrder) {
            const queues = queueByTypeAndSize.get(fileType);
            if (queues && queues.small.length > 0) {
                log.debug(`[智能调度] 策略4: 所有类型阻塞，选择小文件 ${fileType}（违反类型互斥）`);
                return dequeueTask(fileType, false);  // ✅ 要求3：允许多个 Worker 处理同类型
            }
        }

        // 唯一能让 Worker 闲置的情况：全是大文件且已达上限
        log.debug(`[智能调度] 策略4: 全是大文件且已达上限，Worker 等待中...`);
        return null;  // ❌ 无法分配任务，只能等待
    }

    /**
     * 智能调度主函数
     */
    function smartDispatch(): void {
        // 【安全检查】如果禁用智能调度，使用原始逻辑
        if (!ENABLE_SMART_SCHEDULING) {
            originalDispatch();
            return;
        }

        let dispatched = false;

        // 【修复】使用 while 循环，每次只分配一个任务，然后重新检查
        // 这样可以确保每次选择任务时都能看到最新的处理状态
        let hasIdleWorker = true;
        let noTaskAvailable = false;  // 【新增】标记是否没有可用任务
        // 【新架构】使用新的队列长度检查
        while (hasIdleWorker && getQueueLength() > 0 && !noTaskAvailable) {
            hasIdleWorker = false;

            // 查找第一个空闲的 Worker
            for (const consumer of consumers.values()) {
                if (consumer.busy) {
                    continue;
                }

                hasIdleWorker = true;

                // 尝试为这个 Worker 找到合适的任务
                const selectedTask = selectOptimalTask();

                if (selectedTask) {
                    // 【新架构】任务已在 dequeueTask 中移除，无需再次操作

                    // 分配任务（会立即更新 processingTypeCount）
                    assignTaskToConsumer(consumer, selectedTask);
                    dispatched = true;

                    // 【关键修复】分配后立即跳出，重新检查状态
                    // 这样下一个 Worker 能看到最新的 processingTypeCount
                    break;
                } else {
                    // 【关键修复】如果没有合适的任务，标记并跳出所有循环
                    // 这种情况发生在：全是大文件且已达上限，或者其他类型阻塞
                    noTaskAvailable = true;  // 【新增】标记没有可用任务
                    break;
                }
            }
        }

        // 【调试日志】
        if (dispatched && process.env.NODE_ENV === 'development') {
            log.debug(`[智能调度] 成功调度 ${getQueueLength()} 个任务待处理`);
        }
    }

    /**
     * 分配任务给 Consumer
     */
    function assignTaskToConsumer(consumer: any, task: Task): void {
        // 更新调度状态
        processingTypeCount.set(
            task.fileType,
            (processingTypeCount.get(task.fileType) || 0) + 1
        );

        if (task.isLargeFile) {
            largeFilesProcessing++;
        }

        lastTypeScheduleTime.set(task.fileType, Date.now());

        // 更新 Consumer 状态
        consumer.busy = true;
        consumer.taskId = nextTaskId;
        consumer.currentFileType = task.fileType;
        consumer.currentFileSize = task.fileSize;
        consumer.taskStartTime = Date.now();
        consumer.counted = false;

        // 创建超时保护
        const timeoutMs = calculateTimeout(task.fileSize);
        const timeoutId = setTimeout(() => {
            handleTaskTimeout(consumer, task);
        }, timeoutMs);

        // 添加到待处理任务
        pendingTasks.set(nextTaskId, {
            filePath: task.filePath,
            resolve: () => {
            },  // 占位，实际在 worker.on('message') 中设置
            reject: () => {
            },
            timeoutId
        });

        // 发送任务给 Worker
        consumer.worker.postMessage({
            taskId: nextTaskId,
            filePath: task.filePath,
            enabledSensitiveTypes: config.enabledSensitiveTypes,
            config: {
                enabledSensitiveTypes: config.enabledSensitiveTypes,
                maxFileSizeMb: config.maxFileSizeMb,
                maxPdfSizeMb: config.maxPdfSizeMb
            }
        });

        activeWorkerCount++;
        nextTaskId++;

        // 【事件驱动】更新最后活动时间
        lastActivityTime = Date.now();

        log.debug(`[智能调度] 分配任务 [${consumer.id}] ${path.basename(task.filePath)} (${task.fileType}, ${(task.fileSize / BYTES_TO_MB).toFixed(1)}MB)`);
    }

    /**
     * 【重构】处理 Worker 重启和清理的通用逻辑
     * @param consumer Consumer 对象
     * @param taskId 任务 ID（可选，用于日志）
     */
    function restartWorker(consumer: any, taskId?: number): void {
        // 标记为主动终止
        consumer.isTerminating = true;

        // 安全终止 Worker
        safelyTerminateWorker(consumer.worker, consumer, log);

        // 【修复】延迟 100ms 确保旧 Worker 完全终止后再创建新 Worker
        setTimeout(() => {
            // 删除并重建 Consumer
            const consumerId = consumer.id;
            consumers.delete(consumerId);
            createConsumer(consumerId);

            // 强制 GC
            if ((global as any).gc) {
                log.info(`[Worker重启] 执行强制垃圾回收...${taskId !== undefined ? ` (任务 ${taskId})` : ''}`);
                (global as any).gc();
            }

            // 延迟调度新任务
            setTimeout(() => {
                tryDispatch();
            }, 50);
        }, 100);
    }

    /**
     * 处理任务超时
     */
    function handleTaskTimeout(consumer: any, task: Task): void {
        log.warn(`[TaskQueue] 任务 ${consumer.taskId} 超时: ${task.filePath}`);

        const pending = pendingTasks.get(consumer.taskId);
        if (pending) {
            pendingTasks.delete(consumer.taskId);
            activeWorkerCount--;
            incrementConsumerCount(consumer.taskId);
            sendProgressUpdate(task.filePath);
            pending.reject(new Error(`文件处理超时`));
        }

        // 清理智能调度状态
        cleanupConsumerState(consumer);

        // 标记为空闲
        markConsumerIdle(consumer);

        // 【重构】复用通用的 Worker 重启逻辑
        restartWorker(consumer, consumer.taskId);
    }

    /**
     * 清理 Consumer 的智能调度状态
     * 【修复】增加安全检查，防止重复清理和访问已删除的 consumer
     */
    function cleanupConsumerState(consumer: any): void {
        // 【安全检查】如果 consumer 不存在或已被清理，直接返回
        if (!consumer || !consumer.currentFileType) {
            return;
        }

        // 【安全检查】确保 processingTypeCount 中存在该类型
        const count = processingTypeCount.get(consumer.currentFileType);
        if (count !== undefined && count > 0) {
            if (count > 1) {
                processingTypeCount.set(consumer.currentFileType, count - 1);
            } else {
                processingTypeCount.delete(consumer.currentFileType);
            }
        }

        // 【安全检查】确保 largeFilesProcessing 不会变成负数
        if (consumer.currentFileSize && consumer.currentFileSize > LARGE_FILE_THRESHOLD_MB * BYTES_TO_MB) {
            if (largeFilesProcessing > 0) {
                largeFilesProcessing--;
            }
        }

        // 清除 Consumer 状态
        consumer.currentFileType = undefined;
        consumer.currentFileSize = undefined;
        consumer.taskStartTime = undefined;
    }

    /**
     * 原始调度函数（作为备用）
     */
    function originalDispatch(): void {
        let dispatched = 0;
        const consumerIds = Array.from(consumers.keys());
        const totalConsumers = consumerIds.length;

        if (totalConsumers === 0) return;

        const startIndex = nextConsumerIndex;

        for (let i = 0; i < totalConsumers; i++) {
            const currentIndex = (startIndex + i) % totalConsumers;
            const consumerId = consumerIds[currentIndex];
            const consumer = consumers.get(consumerId);

            if (consumer && !consumer.busy && getQueueLength() > 0) {
                const promise = dispatchNextTask(consumer);
                if (promise) {
                    dispatched++;
                    nextConsumerIndex = (currentIndex + 1) % totalConsumers;
                    promise.catch((error) => {
                        log.info(`[TaskQueue] 任务分发失败: ${error.message}`);
                    });
                }
            }
        }
    }

    // 【关键修复】轮询索引，实现 Round-Robin 调度
    let nextConsumerIndex = 0;

    // 尝试调度任务
    function tryDispatch() {
        // 【智能调度】使用智能调度或原始调度
        // 【关键修复】使用 setImmediate 异步执行，避免阻塞主线程
        setImmediate(() => {
            if (ENABLE_SMART_SCHEDULING) {
                smartDispatch();
            } else {
                originalDispatch();
            }
        });
    }

    // 分发下一个任务
    function dispatchNextTask(consumer: ReturnType<typeof consumers.get>) {
        if (!consumer) return;  // 【Map优化】安全检查

        // 【关键修复】使用智能调度选择任务，而不是直接从 taskQueue.shift()
        const task = selectOptimalTask();
        if (!task) {
            return;
        }

        consumer.busy = true;
        consumer.counted = false;  // 【P0修复】重置计数标志
        activeWorkerCount++; // 【优化】增加活跃计数
        const taskId = nextTaskId++;
        consumer.taskId = taskId;

        // 创建 Promise 并保存
        return new Promise<void>((resolve, reject) => {
            // 设置超时
            const timeout = calculateTimeout(task.fileSize);
            const timeoutId = setTimeout(() => {
                log.warn(`[TaskQueue] 任务 ${taskId} 超时 (${timeout / 1000}秒): ${task.filePath}`);
                const pending = pendingTasks.get(taskId);
                if (pending) {
                    pendingTasks.delete(taskId);
                    activeWorkerCount--; // 【优化】减少活跃计数
                    incrementConsumerCount(taskId);

                    // 【修复】发送进度更新，确保前端数字继续动
                    sendProgressUpdate(task.filePath);

                    pending.reject(new Error(`文件处理超时（${timeout / 1000}秒）`));
                }

                // 【修复】更新 Consumer 状态
                markConsumerIdle(consumer);

                // 【重构】复用通用的 Worker 重启逻辑
                restartWorker(consumer, taskId);

                resolve(); // 超时处理后继续
            }, timeout);

            pendingTasks.set(taskId, {
                filePath: task.filePath,
                resolve,
                reject,
                timeoutId
            });

            // 发送任务到 Worker
            try {
                consumer.worker.postMessage({
                    taskId,
                    filePath: task.filePath,
                    enabledSensitiveTypes: config.enabledSensitiveTypes,
                    config: {
                        enabledSensitiveTypes: config.enabledSensitiveTypes,
                        maxFileSizeMb: config.maxFileSizeMb,  // 【修复】传递用户配置
                        maxPdfSizeMb: config.maxPdfSizeMb      // 【修复】传递用户配置
                    }
                });
            } catch (error: any) {
                log.error(`[TaskQueue] 发送任务失败: ${error.message}`);
                // 回滚状态
                consumer.busy = false;
                consumer.taskId = undefined;
                activeWorkerCount--;
                pendingTasks.delete(taskId);
                // 将任务放回队列头部（【关键修复】使用 enqueueTask）
                enqueueTask(task);
            }
        });
    }

    // 创建 Walker Worker
    const walkerWorkerPath = path.join(__dirname, 'walker-worker.js');
    let walkerWorker: Worker;
    try {
        // 【修复】给 Walker Worker 也设置内存限制，防止 OOM
        walkerWorker = new Worker(walkerWorkerPath, {
            resourceLimits: {
                maxOldGenerationSizeMb: dynamicOldGenMB,
                maxYoungGenerationSizeMb: dynamicYoungGenMB,
            }
        });
    } catch (error: any) {
        log.error(`错误: 无法创建 Walker Worker - ${error.message}`);
        scanState.isScanning = false;
        // 【重构】使用辅助函数发送错误信息
        sendToMainWindow(mainWindow, 'scan-error', `无法创建 Walker Worker: ${error.message}`);
        return; // 直接退出
    }

    walkerWorker.on('message', (message: any) => {
        if (message.type === 'ready') {
            return;
        }

        if (message.type === 'file-found') {
            walkerTotalCount++;

            // 【事件驱动】更新最后活动时间
            lastActivityTime = Date.now();

            // 【新增】记录最后任务入队时间
            lastTaskEnqueueTime = Date.now();

            // 【修复】限制进度更新频率，防止 OOM
            // 每 100 个文件或每秒更新一次进度
            if (walkerTotalCount % 100 === 0 || Date.now() - lastProgressUpdateTime > 1000) {
                sendProgressUpdate(message.filePath);
                lastProgressUpdateTime = Date.now();
            }

            // 【修复】移除队列大小限制，允许 Walker 将所有文件加入队列
            // 【原因】之前的 5000 限制导致大量文件被丢弃，影响扫描完整性
            // 【内存安全】依赖 Worker 的内存限制和流式解析来防止 OOM

            // 添加到任务队列
            const fileType = getFileType(message.filePath);
            const isLargeFile = message.stat.size > LARGE_FILE_THRESHOLD_MB * BYTES_TO_MB;

            // 【新架构】使用新的入队函数
            enqueueTask({
                filePath: message.filePath,
                fileSize: message.stat.size,
                fileMtime: message.stat.mtime,
                enqueueTime: Date.now(),
                fileType,
                isLargeFile
            });

            // 尝试调度
            tryDispatch();
        }

        if (message.type === 'walking-complete') {
            log.info(`Walker 完成: 找到 ${message.fileCount} 个文件, 过滤 ${message.filteredCount || 0} 个, 跳过 ${message.skippedCount} 个`);

            // 【关键修复】walkerTotalCount 应该包含所有遍历到的文件：已入队 + 过滤 + 跳过
            walkerTotalCount += (message.filteredCount || 0) + message.skippedCount;
            walkerFilteredCount += message.filteredCount || 0;  // 【新增】累加过滤计数
            walkerSkippedCount += message.skippedCount;

            walkerCompletedCount++; // 【修复】增加完成计数

            // 【内存安全】防止计数器溢出
            if (walkerCompletedCount > totalWalkerTasks) {
                log.warn(`[Walker] 警告: 完成计数 (${walkerCompletedCount}) 超过总任务数 (${totalWalkerTasks})`);
                walkerCompletedCount = totalWalkerTasks;
            }

            log.info(`[Walker] 已完成 ${walkerCompletedCount}/${totalWalkerTasks} 个任务`);

            // 【A1 优化】Walker 完成后，根据实际文件大小重新计算内存限制
            if (getQueueLength() > 0) {
                // 【关键修复】从 queueByTypeAndSize 计算总大小
                let totalSize = 0;
                let totalCount = 0;
                for (const queues of queueByTypeAndSize.values()) {
                    for (const task of queues.large) {
                        totalSize += task.fileSize;
                        totalCount++;
                    }
                    for (const task of queues.small) {
                        totalSize += task.fileSize;
                        totalCount++;
                    }
                }

                const avgFileSizeMB = totalCount > 0 ? (totalSize / totalCount) / BYTES_TO_MB : 0;

                // 计算新的内存限制
                const newLimits = calculateSmartMemoryLimits(avgFileSizeMB, poolSize);
                dynamicOldGenMB = newLimits.oldGen;
                dynamicYoungGenMB = newLimits.youngGen;

                log.info(`【智能内存调整】平均文件大小: ${avgFileSizeMB.toFixed(2)}MB, 新内存限制: 老生代=${dynamicOldGenMB}MB, 新生代=${dynamicYoungGenMB}MB`);

                // 【关键】重启所有空闲的 Consumer Workers 以应用新配置
                // 【修复】延迟 100ms 确保所有 Worker 的状态已同步
                setTimeout(() => {
                    let restartedCount = 0;

                    // 【Map优化】遍历 Map 中的所有 Consumer
                    for (const [consumerId, consumer] of consumers) {
                        if (!consumer.busy) {
                            // 终止旧的 Worker
                            try {
                                consumer.worker.terminate();
                                consumer.worker.removeAllListeners();
                            } catch (e) {
                                // 忽略终止错误
                            }

                            // 【Map优化】删除旧 Consumer，创建新的 Worker（使用新内存限制）
                            consumers.delete(consumerId);
                            createConsumer(consumerId, dynamicOldGenMB, dynamicYoungGenMB);
                            restartedCount++;
                        }
                    }

                    if (restartedCount > 0) {
                        log.info(`【智能内存】已重启 ${restartedCount} 个空闲 Worker 以应用新内存配置`);

                        // 【新增】批量重启后强制 GC，释放内存
                        if ((global as any).gc) {
                            log.info(`【智能内存】执行强制垃圾回收...`);
                            (global as any).gc();
                        }
                    }
                }, 100);
            }

            // 【事件驱动】检查是否应该结束
            checkAndComplete();
        }

        if (message.type === 'walking-error') {
            log.error(`Walker 错误: ${message.error}`);

            // 【事件驱动】检查是否应该结束
            checkAndComplete();
        }

        // 【调试】接收 Walker Worker 的日志
        if (message.type === 'walker-log') {
            log.info(message.message);
        }
    });

    walkerWorker.on('error', (error: any) => {
        log.error(`Walker Worker 错误: ${error.message}`);

        // 【事件驱动】检查是否应该结束
        checkAndComplete();
    });

    walkerWorker.on('exit', (code) => {
        if (code !== 0) {
            log.info(`Walker Worker 异常退出，代码: ${code}`);
        }
    });

    // 【事件驱动】检查是否应该结束扫描
    let completionCheckTimer: NodeJS.Timeout | null = null;
    let isCleaningUp = false; // 【修复】防止 cleanup 被多次调用
    let walkerCompletedCount = 0; // 【修复】记录已完成的 Walker 任务数
    const totalWalkerTasks = config.selectedPaths.length; // 【修复】总 Walker 任务数

    // 【优化】多指标停滞检测 - 记录上次检查时的状态快照
    let lastStagnationCheckState = {
        processed: consumerProcessedCount, // 【修复】已处理的文件数
        total: walkerTotalCount, // 【修复】总文件数
        filtered: walkerFilteredCount,  // 【新增】过滤计数
        skipped: walkerSkippedCount, // 【新增】跳过计数
        results: resultCount, // 【修复】结果数
        sensitiveItems: totalSensitiveItems,  // 【新增】敏感信息总条数
        taskQueueLength: getQueueLength(),     // 【新增】任务队列长度
        pendingTasksSize: pendingTasks.size,   // 【新增】待处理任务数
        activeWorkers: activeWorkerCount,      // 【新增】活跃 Worker 数
        lastEnqueueTime: Date.now()            // 【新增】最后入队时间
    };
    let lastStagnationCheckTime = Date.now();
    let lastTaskEnqueueTime = Date.now();  // 【新增】记录最后任务入队时间

    function checkAndComplete() {
        // 检查是否取消
        if (scanState.cancelFlag) {
            cleanup();
            return;
        }

        // 【修复】只有在以下情况才结束扫描：
        // 1. 所有 Walker 任务都已完成
        // 2. 没有活跃的 Worker
        // 3. 任务队列为空
        // 4. 没有待处理的任务
        const hasPendingTasks = pendingTasks.size > 0;
        const allWalkersCompleted = walkerCompletedCount >= totalWalkerTasks;

        // 【调试】输出详细状态
        if (allWalkersCompleted && (activeWorkerCount > 0 || getQueueLength() > 0 || hasPendingTasks)) {
            log.info(`[checkAndComplete] Walker已完成，但仍在等待: activeWorkers=${activeWorkerCount}, taskQueue=${getQueueLength()}, pendingTasks=${pendingTasks.size}`);
        }

        if (allWalkersCompleted && activeWorkerCount === 0 && getQueueLength() === 0 && !hasPendingTasks) {
            log.info(`扫描完成: 遍历 ${walkerTotalCount} 个文件, 处理 ${consumerProcessedCount} 个, 跳过 ${walkerSkippedCount} 个, 发现 ${resultCount} 个敏感文件`);
            cleanup();
            return;
        }

        // 更新最后活动时间
        lastActivityTime = Date.now();
    }

    // 【优化】多指标停滞检测 - 定期检查
    completionCheckTimer = setInterval(() => {
        const now = Date.now();

        // 检查是否有任何实质性进展
        const hasRealProgress =
            consumerProcessedCount !== lastStagnationCheckState.processed ||
            walkerTotalCount !== lastStagnationCheckState.total ||
            walkerFilteredCount !== lastStagnationCheckState.filtered ||  // 【新增】过滤计数变化
            walkerSkippedCount !== lastStagnationCheckState.skipped ||
            resultCount !== lastStagnationCheckState.results ||
            totalSensitiveItems !== lastStagnationCheckState.sensitiveItems ||  // 敏感信息条数变化
            getQueueLength() !== lastStagnationCheckState.taskQueueLength ||    // 任务队列变化
            pendingTasks.size !== lastStagnationCheckState.pendingTasksSize ||  // 待处理任务变化
            activeWorkerCount !== lastStagnationCheckState.activeWorkers ||     // 活跃 Worker 变化
            lastTaskEnqueueTime !== lastStagnationCheckState.lastEnqueueTime;   // 【新增】任务入队时间变化

        if (hasRealProgress) {
            // 有进展，更新状态快照和时间
            lastStagnationCheckState = {
                processed: consumerProcessedCount,
                total: walkerTotalCount,
                filtered: walkerFilteredCount,  // 【新增】过滤计数
                skipped: walkerSkippedCount,
                results: resultCount,
                sensitiveItems: totalSensitiveItems,
                taskQueueLength: getQueueLength(),
                pendingTasksSize: pendingTasks.size,
                activeWorkers: activeWorkerCount,
                lastEnqueueTime: lastTaskEnqueueTime  // 【新增】最后入队时间
            };
            lastStagnationCheckTime = now;
        } else {
            // 无进展，检查是否应该超时
            const idleTime = now - lastStagnationCheckTime;

            // 【双层保护策略】
            // 第一层：短时间停滞警告（30秒）
            if (idleTime > STAGNATION_THRESHOLD &&
                idleTime <= MAX_IDLE_TIME) {
                log.warn(`提示: ${idleTime / 1000}秒内无任何进展（活跃Worker:${activeWorkerCount}, 队列:${getQueueLength()}, 待处理:${pendingTasks.size}），但仍在等待可能的恢复...`);
            }

            // 第二层：长时间停滞强制结束（2分钟），避免长时间等待
            if (idleTime > MAX_IDLE_TIME
                || (idleTime > STAGNATION_THRESHOLD
                    && getQueueLength() <= 0
                    && pendingTasks.size <= 0
                    && activeWorkerCount <= 0
                    && (consumerProcessedCount + walkerFilteredCount + walkerSkippedCount) >= walkerTotalCount)
            ) {
                const timeSinceLastEnqueue = now - lastTaskEnqueueTime;
                log.error(`警告: ${idleTime / 1000}秒内无任何进展（已处理:${consumerProcessedCount}, 总数:${walkerTotalCount}, 过滤:${walkerFilteredCount}, 跳过:${walkerSkippedCount}, 敏感文件:${resultCount}, 敏感信息:${totalSensitiveItems}, 活跃Worker:${activeWorkerCount}, 队列:${getQueueLength()}, 待处理:${pendingTasks.size}, 最后入队:${(timeSinceLastEnqueue / 1000).toFixed(1)}秒前），强制结束`);
                // 先清理所有 pendingTasks
                for (const [_taskId, pending] of pendingTasks.entries()) {
                    clearTimeout(pending.timeoutId);
                    pending.reject(new Error('扫描超时强制结束'));
                }
                pendingTasks.clear();
                cleanup();
            }
        }
    }, STAGNATION_CHECK_INTERVAL); // 定期检查

    // 清理资源
    function cleanup() {
        // 【修复】防止重复调用 - 使用原子检查
        if (isCleaningUp) {
            log.info('[cleanup] 警告: cleanup 已被调用，忽略重复调用');
            return;
        }
        isCleaningUp = true;

        log.info('[cleanup] 开始清理资源...');

        try {
            // 【事件驱动】清除超时检测定时器
            if (completionCheckTimer) {
                clearInterval(completionCheckTimer);
                completionCheckTimer = null;
            }

            // 【修复】终止 Walker Worker 并清除引用
            try {
                // 【内存安全】先发送清空队列的信号
                walkerWorker.postMessage({type: 'cancel-all'});
                walkerWorker.removeAllListeners();
                walkerWorker.terminate();
                (walkerWorker as any) = null;
            } catch (error) {
                log.info(`终止 Walker Worker 失败: ${error}`);
            }

            // 【修复】终止所有 Consumer Workers 并清除引用
            // 【Map优化】遍历 Map 中的所有 Consumer
            for (const [, consumer] of consumers) {
                try {
                    consumer.worker.terminate();
                    // 【关键】清除引用，帮助垃圾回收
                    consumer.worker.removeAllListeners();
                    (consumer as any).worker = null;
                } catch (error) {
                    log.info(`终止 Consumer Worker 失败: ${error}`);
                }
            }

            // 【Map优化】清空 Map，释放内存
            consumers.clear();

            // 清除所有超时定时器（如果还没有被清理）
            if (pendingTasks.size > 0) {
                for (const pending of pendingTasks.values()) {
                    clearTimeout(pending.timeoutId);
                }
                pendingTasks.clear();
            }

            // 【关键】清空任务队列
            // 【新架构】清空 queueByTypeAndSize
            for (const queues of queueByTypeAndSize.values()) {
                queues.large.length = 0;
                queues.small.length = 0;
            }
            queueByTypeAndSize.clear();

            scanState.isScanning = false;
            log.info('扫描完成');

            // 【重构】使用辅助函数发送扫描完成信号
            sendToMainWindow(mainWindow, 'scan-finished', null);

            log.info('[cleanup] 资源清理完成');

            // 【新增】强制触发垃圾回收（如果可用）
            if ((global as any).gc) {
                log.info('[cleanup] 触发垃圾回收...');
                (global as any).gc();
            }
        } catch (error) {
            log('[cleanup] 清理过程中出错: ' + error);
            // 即使出错也要标记为完成
            scanState.isScanning = false;
        }
    }

    // 启动 Walker Worker
    const totalPaths = config.selectedPaths.length;
    let currentPathIndex = 0;

    for (const rootPath of config.selectedPaths) {
        currentPathIndex++;

        if (scanState.cancelFlag) {
            log.info('扫描已取消');
            break;
        }

        // 【修复】检查路径是否是文件，如果是文件且在 ignoreDirNames 中，则跳过
        try {
            const stat = fs.statSync(rootPath);
            if (stat.isFile()) {
                const basename = path.basename(rootPath);
                if (config.ignoreDirNames.includes(basename)) {
                    log.info(`跳过忽略的文件: ${rootPath}`);
                    continue;
                }
            }
        } catch (error: any) {
            log.info(`无法访问路径: ${rootPath} - ${error.message}`);
            continue;
        }

        log.info(`正在扫描: ${rootPath} (${currentPathIndex}/${totalPaths})`);

        if (!fs.existsSync(rootPath)) {
            log.info(`路径不存在: ${rootPath}`);
            continue;
        }

        // 【修复】支持文件和目录，walker-worker 会自行判断
        // if (!fs.statSync(rootPath).isDirectory()) {
        //     log(`路径不是目录: ${rootPath}`);
        //     continue;
        // }

        // 发送配置到 Walker Worker
        walkerWorker.postMessage({
            type: 'start-walking',
            config: {
                rootPath,
                selectedExtensions: config.selectedExtensions,
                ignoreDirNames: config.ignoreDirNames,
                systemDirs: config.systemDirs,
                maxFileSizeMb: config.maxFileSizeMb,
                maxPdfSizeMb: config.maxPdfSizeMb
            }
        });
    }
}

export function cancelScan(scanState: ScanState): void {
    scanState.cancelFlag = true;
}
