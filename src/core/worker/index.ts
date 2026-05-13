/**
 * Worker 模块 - Worker 池管理
 * 
 * 职责：
 * - Consumer Worker 的创建、销毁、重启
 * - Worker 状态管理
 * - Worker 消息处理协调
 */

export { WorkerPool, type Consumer, type WorkerPoolCallbacks } from './worker-pool';
export { markConsumerIdle, safelyTerminateWorker } from './worker-utils';
