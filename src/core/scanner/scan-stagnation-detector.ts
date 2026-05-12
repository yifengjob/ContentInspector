/**
 * 停滞检测模块
 * 
 * 职责：
 * - 监控扫描进度，检测是否停滞
 * - 在长时间无进展时强制结束扫描
 */

import {ScanState} from '../state';
import {WorkerPool} from '../worker';
import {STAGNATION_CHECK_INTERVAL, STAGNATION_THRESHOLD, MAX_IDLE_TIME} from '../config';

export interface StagnationDetectorOptions {
    state: ScanState;
    workerPool: WorkerPool;
    log: any;
    getLastTaskEnqueueTime: () => number;
    onStagnationDetected: () => void;
}

export class StagnationDetector {
    private readonly options: StagnationDetectorOptions;
    private timer: NodeJS.Timeout | null = null;
    private lastCheckState: any;
    private lastCheckTime: number;

    constructor(options: StagnationDetectorOptions) {
        this.options = options;
        this.lastCheckTime = Date.now();
        this.lastCheckState = this.captureCurrentState();
    }

    /**
     * 捕获当前状态快照
     */
    private captureCurrentState(): any {
        const {state} = this.options;
        return {
            processed: state.getConsumerProcessedCount(),
            total: state.getWalkerTotalCount(),
            filtered: state.getWalkerFilteredCount(),
            skipped: state.getWalkerSkippedCount(),
            results: state.getResultCount(),
            sensitiveItems: state.getTotalSensitiveItems(),
            taskQueueLength: state.getTaskQueueLength(),
            pendingTasksSize: state.getPendingTasksSize(),
            activeWorkers: state.getActiveWorkerCount(),
            lastEnqueueTime: this.options.getLastTaskEnqueueTime()
        };
    }

    /**
     * 启动停滞检测
     */
    start(): void {
        this.timer = setInterval(() => {
            this.check();
        }, STAGNATION_CHECK_INTERVAL);
    }

    /**
     * 停止停滞检测
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * 检查是否有停滞
     */
    private check(): void {
        const now = Date.now();
        const currentState = this.captureCurrentState();

        // 检查是否有真实进展
        const hasRealProgress = this.hasProgress(currentState);

        if (hasRealProgress) {
            // 有进展，更新状态
            this.lastCheckState = currentState;
            this.lastCheckTime = now;
        } else {
            // 无进展，检查是否需要警告或强制结束
            this.handleStagnation(now);
        }
    }

    /**
     * 判断是否有进展
     */
    private hasProgress(currentState: any): boolean {
        const last = this.lastCheckState;
        return (
            currentState.processed !== last.processed ||
            currentState.total !== last.total ||
            currentState.filtered !== last.filtered ||
            currentState.skipped !== last.skipped ||
            currentState.results !== last.results ||
            currentState.sensitiveItems !== last.sensitiveItems ||
            currentState.taskQueueLength !== last.taskQueueLength ||
            currentState.pendingTasksSize !== last.pendingTasksSize ||
            currentState.activeWorkers !== last.activeWorkers ||
            currentState.lastEnqueueTime !== last.lastEnqueueTime
        );
    }

    /**
     * 处理停滞情况
     */
    private handleStagnation(now: number): void {
        const idleTime = now - this.lastCheckTime;
        const {state, log} = this.options;

        // 警告阶段
        if (idleTime > STAGNATION_THRESHOLD && idleTime <= MAX_IDLE_TIME) {
            log.warn(`提示: ${idleTime / 1000}秒内无任何进展（活跃Worker:${state.getActiveWorkerCount()}, 队列:${state.getTaskQueueLength()}, 待处理:${state.getPendingTasksSize()}），但仍在等待可能的恢复...`);
        }

        // 强制结束阶段
        if (idleTime > MAX_IDLE_TIME ||
            (idleTime > STAGNATION_THRESHOLD &&
                state.getTaskQueueLength() <= 0 &&
                state.getPendingTasksSize() <= 0 &&
                state.getActiveWorkerCount() <= 0 &&
                (state.getConsumerProcessedCount() + state.getWalkerFilteredCount() + state.getWalkerSkippedCount()) >= state.getWalkerTotalCount())
        ) {
            log.error(`警告: ${idleTime / 1000}秒内无任何进展，强制结束`);
            this.forceComplete();
        }
    }

    /**
     * 强制完成扫描
     */
    private forceComplete(): void {
        const {workerPool} = this.options;

        // 清除所有待处理任务的超时
        for (const pending of workerPool.getPendingTasks().values()) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error('扫描超时强制结束'));
        }
        workerPool.getPendingTasks().clear();

        // 触发完成回调
        this.options.onStagnationDetected();
    }
}
