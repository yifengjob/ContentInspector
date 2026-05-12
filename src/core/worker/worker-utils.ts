/**
 * Worker 工具函数
 * 
 * 职责：
 * - 提供 Worker 相关的辅助函数
 * - 避免循环依赖（从 scanner 模块导入）
 */

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
