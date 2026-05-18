/**
 * Worker 生命周期管理模块
 *
 * 职责：
 * - Worker 的创建和销毁
 * - Worker 重启逻辑
 * - 串行化创建队列处理
 * - Worker 错误和退出监听
 */

import { Worker } from 'worker_threads';
import type { Consumer } from './worker-pool-types';
import { safelyTerminateWorker } from './worker-utils';
import { WORKER_RESTART_DELAY, WORKER_CREATE_MAX_RETRY } from '../config/constants';
import { FILE_WORKER_PATH } from '../../workers/file-worker';
import { Logger } from '../../logger/logger';
import type { EventBus } from '../infra/event-bus';

/**
 * Worker 创建任务
 */
export interface WorkerCreateTask {
  consumerId: number;
  oldGen?: number;
  youngGen?: number;
}

/**
 * Worker 生命周期管理器
 */
export class WorkerLifecycleManager {
  private readonly log: Logger;
  private isCreatingWorker = false;
  private workerCreateQueue: WorkerCreateTask[] = [];

  constructor(
    private consumers: Map<number, Consumer>,
    private poolSize: number,
    private defaultOldGenMB: number,
    private defaultYoungGenMB: number,
    private setupMessageListener: (consumer: Consumer) => void,
    private setupErrorListener: (consumer: Consumer) => void,
    private setupExitListener: (consumer: Consumer) => void,
    private eventBus: EventBus,
    log: Logger
  ) {
    this.log = log;
  }

  /**
   * 添加 Worker 创建任务到队列
   */
  enqueueCreateTask(task: WorkerCreateTask): void {
    this.workerCreateQueue.push(task);
  }

  /**
   * 串行化创建 Worker，避免并发创建导致 EAGAIN
   */
  async processWorkerCreateQueue(): Promise<void> {
    if (this.isCreatingWorker || this.workerCreateQueue.length === 0) {
      return;
    }

    this.isCreatingWorker = true;

    let iterationCount = 0;
    const MAX_RETRY_PER_WORKER = WORKER_CREATE_MAX_RETRY;
    const MAX_ITERATIONS = this.poolSize * MAX_RETRY_PER_WORKER;

    const retryCounts = new Map<number, number>();
    const failedWorkers: number[] = [];

    while (this.workerCreateQueue.length > 0) {
      iterationCount++;

      if (iterationCount > MAX_ITERATIONS) {
        this.log.error(
          '[致命错误] processWorkerCreateQueue 迭代次数过多（{}/{}），强制退出以防止卡死',
          iterationCount,
          MAX_ITERATIONS
        );
        break;
      }

      const allRemainingFailed = this.workerCreateQueue.every((item) => {
        const retry = retryCounts.get(item.consumerId) || 0;
        return retry >= MAX_RETRY_PER_WORKER;
      });

      if (allRemainingFailed) {
        this.log.error('[致命错误] 所有 Worker 创建均失败，放弃继续尝试');
        break;
      }

      const task = this.workerCreateQueue.shift()!;
      const currentRetry = retryCounts.get(task.consumerId) || 0;

      if (currentRetry >= MAX_RETRY_PER_WORKER) {
        this.log.error(
          '[Worker创建] Worker ${task.consumerId} 重试次数过多（{}/{}），放弃创建',
          currentRetry,
          MAX_RETRY_PER_WORKER
        );
        failedWorkers.push(task.consumerId);
        continue;
      }

      this.log.info(
        '[Worker创建] 尝试创建 Worker {} (第{}次迭代, 重试{}/{})',
        task.consumerId,
        iterationCount,
        currentRetry + 1,
        MAX_RETRY_PER_WORKER
      );

      try {
        this.createConsumer(
          task.consumerId,
          task.oldGen ?? this.defaultOldGenMB,
          task.youngGen ?? this.defaultYoungGenMB
        );

        // 【关键】每个 Worker 创建后延迟，避免资源竞争
        await new Promise((resolve) => setTimeout(resolve, WORKER_RESTART_DELAY));

        // 成功后清除重试计数
        retryCounts.delete(task.consumerId);
      } catch (error: any) {
        const newRetryCount = currentRetry + 1;
        retryCounts.set(task.consumerId, newRetryCount);
        this.log.error(
          '[Worker创建] 创建 Worker {} 失败 ({}/{}): {}',
          task.consumerId,
          newRetryCount,
          MAX_RETRY_PER_WORKER,
          error.message
        );

        // 【修复】如果是因为资源不足（EAGAIN），记录警告
        if (error.code === 'EAGAIN') {
          this.log.warn('[Worker创建] 系统资源不足，Worker {} 将在稍后重试创建', task.consumerId);
        }

        // 重新加入队列头部，稍后重试
        this.workerCreateQueue.unshift(task);

        // 【关键】增加等待时间，给系统资源恢复的时间
        const waitTime = 500 * newRetryCount; // 第一次 500ms，第二次 1000ms，第三次 1500ms
        this.log.warn('[Worker创建] 等待 {}ms 后重试...', waitTime);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.isCreatingWorker = false;

    if (failedWorkers.length > 0) {
      this.log.warn('[Worker创建] 以下 Worker 创建失败: {}', failedWorkers.join(', '));
      this.log.warn('[Worker创建] 实际可用 Worker 数量: {}/{}', this.consumers.size, this.poolSize);

      // 【降级策略】如果所有 Worker 都失败，抛出错误
      if (this.consumers.size === 0) {
        throw new Error('所有 Worker 创建失败，无法启动扫描');
      }
    }
  }

  /**
   * 创建单个 Consumer Worker
   */
  private createConsumer(id: number, customOldGen?: number, customYoungGen?: number): void {
    const oldGenMB = customOldGen ?? this.defaultOldGenMB;
    const youngGenMB = customYoungGen ?? this.defaultYoungGenMB;

    let worker: Worker;
    try {
      worker = new Worker(FILE_WORKER_PATH, {
        resourceLimits: {
          maxOldGenerationSizeMb: oldGenMB,
          maxYoungGenerationSizeMb: youngGenMB,
        },
      });
    } catch (error: any) {
      this.log.error('无法创建 Worker {} - {}', id, error.message);

      // 【修复】如果是因为资源不足（EAGAIN），将创建请求放回队列重试
      if (error.code === 'EAGAIN') {
        this.log.warn('[Worker创建] 系统资源不足，Worker {} 将在稍后重试创建', id);
      }

      throw error; // 抛出错误，让队列处理重试
    }

    const consumer: Consumer = {
      id,
      worker,
      busy: false,
      counted: false,
      isTerminating: false,
    };

    this.consumers.set(id, consumer);

    // 【事件总线】发布 Worker 创建事件
    this.eventBus.emit('worker.created', consumer);

    // 设置监听器
    this.setupMessageListener(consumer);
    this.setupErrorListener(consumer);
    this.setupExitListener(consumer);

    this.log.info('[Worker创建] Worker {} 创建成功', id);
  }

  /**
   * 终止单个 Consumer（不重启）
   */
  terminateConsumer(consumer: Consumer): void {
    safelyTerminateWorker(consumer.worker, consumer, (msg) => this.log.info(msg));
    // 从 Map 中删除
    this.consumers.delete(consumer.id);
  }

  /**
   * 批量重启空闲 Worker（用于应用新内存配置）
   */
  restartIdleWorkers(newOldGenMB: number, newYoungGenMB: number): number {
    // 【修复】先收集需要重启的空闲 Worker ID，避免遍历时修改 Map
    const idleConsumerIds: number[] = [];

    for (const [consumerId, consumer] of this.consumers) {
      if (!consumer.busy) {
        idleConsumerIds.push(consumerId);
      }
    }

    let restartedCount = 0;

    // 【修复】遍历收集的 ID 列表，安全地重启 Worker
    for (const consumerId of idleConsumerIds) {
      const consumer = this.consumers.get(consumerId);
      if (!consumer) continue; // 可能已被其他操作删除

      // 终止旧的 Worker
      try {
        // 【修复】正确处理 terminate 返回的 Promise
        void consumer.worker.terminate();
        consumer.worker.removeAllListeners();
      } catch (e) {
        // 忽略终止错误
      }

      // 【关键】删除旧 Consumer，创建新的 Worker（使用新内存限制）
      this.consumers.delete(consumerId);
      this.createConsumer(consumerId, newOldGenMB, newYoungGenMB);
      restartedCount++;
    }

    return restartedCount;
  }

  /**
   * 清理所有 Worker
   */
  cleanup(): void {
    this.log.info('[WorkerPool] 开始清理 Worker 池...');

    for (const [, consumer] of this.consumers) {
      try {
        // 【修复】正确处理 terminate 返回的 Promise
        void consumer.worker.terminate();
        consumer.worker.removeAllListeners();
        (consumer as any).worker = null;
      } catch (error: any) {
        this.log.info('终止 Consumer Worker 失败: {}', error.message);
      }
    }

    this.consumers.clear();
    this.workerCreateQueue = [];
    this.isCreatingWorker = false;

    this.log.info('[WorkerPool] Worker 池清理完成');
  }
}
