/**
 * Walker Worker 消息处理模块
 *
 * 职责：
 * - 处理 Walker Worker 的消息（files-batch, walking-complete, walking-error）
 * - 管理文件入队逻辑
 * - 处理 Walker 完成后的内存调整
 */

import {Worker} from 'worker_threads';
import {ScanState} from '../state';
import {ScannerContext} from './scan-initializer';
import {getFileType} from '../../utils/file-type-utils';
import {LARGE_FILE_THRESHOLD_MB, BYTES_TO_MB, WORKER_RESTART_DELAY} from '../config';

export interface WalkerHandlerOptions {
    state: ScanState;
    context: ScannerContext;
    walkerCompletedCountRef: { value: number };
    totalWalkerTasks: number;
    onCheckAndComplete: () => void;
}

export class WalkerHandler {
    private worker: Worker;
    private readonly options: WalkerHandlerOptions;
    private lastProgressUpdateTime = 0;
    private lastTaskEnqueueTime = Date.now();

    constructor(worker: Worker, options: WalkerHandlerOptions) {
        this.worker = worker;
        this.options = options;
    }

    /**
     * 设置消息监听器
     */
    setupMessageListener(): void {
        this.worker.on('message', (message: any) => {
            try {
                if (message.type === 'files-batch') {
                    this.handleFilesBatch(message.files);
                } else if (message.type === 'walking-complete') {
                    this.handleWalkingComplete(message);
                } else if (message.type === 'walking-error') {
                    this.handleWalkingError(message);
                }
            } catch (error: any) {
                this.options.context.log.error('[Walker] 处理消息失败: {}', error.message);
            }
        });

        this.worker.on('error', (error: any) => {
            this.options.context.log.error('Walker Worker 错误: {}', error.message);
            this.options.onCheckAndComplete();
        });

        this.worker.on('exit', (code) => {
            if (code !== 0) {
                this.options.context.log.info('Walker Worker 异常退出，代码: {}', code);
            }
        });
    }

    /**
     * 处理文件批次消息
     */
    private handleFilesBatch(files: any[]): void {
        if (!files || files.length === 0) {
            return;
        }

        const {state, context} = this.options;

        for (const file of files) {
            state.incrementWalkerTotalCount();

            if (state.getWalkerTotalCount() % 100 === 0 || Date.now() - this.lastProgressUpdateTime > 1000) {
                context.sendProgressUpdate(file.filePath);
                this.lastProgressUpdateTime = Date.now();
            }

            const fileType = getFileType(file.filePath);
            const isLargeFile = file.stat.size > LARGE_FILE_THRESHOLD_MB * BYTES_TO_MB;

            context.queueManager.enqueueTask({
                filePath: file.filePath,
                fileSize: file.stat.size,
                fileMtime: file.stat.mtime,
                enqueueTime: Date.now(),
                fileType,
                isLargeFile
            });
        }

        this.lastTaskEnqueueTime = Date.now();
        context.eventBus.emit('walker.batch-ready');
    }

    /**
     * 处理 Walker 完成消息
     */
    private handleWalkingComplete(message: any): void {
        const {state, context} = this.options;
        const log = context.log;

        log.info('Walker 完成: 找到 {} 个文件, 过滤 {} 个, 跳过 {} 个', message.fileCount, message.filteredCount || 0, message.skippedCount);

        // Bug2修复：walkerTotalCount 应该包含所有文件（找到+过滤+跳过）
        state.addWalkerTotalCount((message.filteredCount || 0) + message.skippedCount);
        state.addWalkerFilteredCount(message.filteredCount || 0);
        state.addWalkerSkippedCount(message.skippedCount);

        // 关键修复：Walker 完成后立即发送进度更新，确保前端 totalCount 包含所有文件
        context.sendProgressUpdate();

        this.options.walkerCompletedCountRef.value++;

        // 【防御性检查】正常情况下不应该发生，如果发生说明有严重 bug
        if (this.options.walkerCompletedCountRef.value > this.options.totalWalkerTasks) {
            log.error('[Walker] 错误: 完成计数 ({}) 超过总任务数 ({})，这不应该发生！', this.options.walkerCompletedCountRef.value, this.options.totalWalkerTasks);
            this.options.walkerCompletedCountRef.value = this.options.totalWalkerTasks;
        }

        log.info('[Walker] 已完成 {}/{} 个任务', this.options.walkerCompletedCountRef.value, this.options.totalWalkerTasks);

        // A1 优化：Walker 完成后，根据实际文件大小重新计算内存限制
        this.adjustMemoryAfterWalkerComplete();

        this.options.onCheckAndComplete();
    }

    /**
     * 处理 Walker 错误消息
     */
    private handleWalkingError(message: any): void {
        this.options.context.log.error('Walker 错误: {}', message.error);
        this.options.onCheckAndComplete();
    }

    /**
     * Walker 完成后调整内存配置
     */
    private adjustMemoryAfterWalkerComplete(): void {
        const {state, context} = this.options;
        const {workerPool, poolSize} = context;

        if (state.getTaskQueueLength() > 0) {
            // 关键修复：从 queueManager 获取所有任务来计算平均大小
            const stats = context.queueManager.getAllTasksStats();
            const avgFileSizeMB = stats.totalCount > 0
                ? (stats.totalSize / stats.totalCount) / BYTES_TO_MB
                : 0;

            if (stats.totalCount > 0) {
                // 导入智能内存计算函数和可用内存函数
                const {calculateSmartMemoryLimits, getFreeMemoryMB} = require('./scan-initializer');
                const freeMemoryMB = getFreeMemoryMB();

                // 计算新的内存限制
                const newLimits = calculateSmartMemoryLimits(avgFileSizeMB, poolSize, freeMemoryMB);
                context.dynamicOldGenMB = newLimits.oldGen;
                context.dynamicYoungGenMB = newLimits.youngGen;

                context.log.info('[智能内存调整]平均文件大小: {}MB, 新内存限制: 老生代={}MB, 新生代={}MB', avgFileSizeMB.toFixed(2), newLimits.oldGen, newLimits.youngGen);

                // 【关键修复】只有在扫描进行中才重启 Worker
                if (!state.cancelFlag && state.isScanning) {
                    setTimeout(() => {
                        // 【再次检查】防止在延迟期间扫描已结束
                        if (!state.cancelFlag && state.isScanning) {
                            const restartedCount = workerPool.restartIdleWorkers(newLimits.oldGen, newLimits.youngGen);

                            if (restartedCount > 0) {
                                context.log.info('[智能内存] 已重启 {} 个空闲 Worker 以应用新内存配置', restartedCount);

                                // 批量重启后强制 GC，释放内存
                                if ((global as any).gc) {
                                    context.log.info('[智能内存]执行强制垃圾回收...');
                                    (global as any).gc();
                                }
                            }
                        }
                    }, WORKER_RESTART_DELAY);
                }
            } else {
                context.log.info('[智能内存调整]平均文件大小: {}MB', avgFileSizeMB.toFixed(2));
            }
        }
    }

    /**
     * 发送取消消息并终止 Worker
     */
    cancel(): void {
        try {
            this.worker.postMessage({type: 'cancel-all'});
            this.worker.removeAllListeners();
            // 【修复】正确处理 terminate 返回的 Promise
            void this.worker.terminate();
        } catch (error) {
            this.options.context.log.info('终止 Walker Worker 失败: {}', error);
        }
    }

    /**
     * 更新总任务数（在 for 循环结束后调用）
     */
    updateTotalTasks(totalTasks: number): void {
        this.options.totalWalkerTasks = totalTasks;
    }

    /**
     * 获取最后任务入队时间
     */
    getLastTaskEnqueueTime(): number {
        return this.lastTaskEnqueueTime;
    }
}
