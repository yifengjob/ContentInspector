/**
 * Worker 模块 - Worker 池管理
 * 
 * 职责：
 * - Consumer Worker 的创建、销毁、重启
 * - Worker 状态管理
 * - Worker 消息处理协调
 */

// 【重构】导出新的模块化结构
export { WorkerPool, type Consumer, type PendingTask, type WorkerPoolCallbacks } from './worker-pool-core';
export { markConsumerIdle, safelyTerminateWorker } from './worker-utils';

// 【新增】导出子模块（供高级用法）
export { WorkerLifecycleManager } from './worker-lifecycle';
export { WorkerMessageHandler } from './worker-message-handler';
