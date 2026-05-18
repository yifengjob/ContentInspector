/**
 * 事件总线模块 - 轻量级发布-订阅模式
 *
 * 职责：
 * - 统一管理所有状态变化事件
 * - 提供类型安全的事件发布和订阅
 * - 支持错误隔离和异常处理
 */

import { createLogger, Logger } from '../../logger/logger';

/**
 * Worker 事件类型定义
 */
export type WorkerEventType =
  | 'worker.created' // Worker 创建完成
  | 'worker.idle' // Worker 变为空闲
  | 'worker.busy' // Worker 变为繁忙（预留）
  | 'task.enqueued' // 任务入队
  | 'task.completed' // 任务完成（预留）
  | 'walker.batch-ready' // Walker 批量文件就绪
  | 'log:message' // 【新增】日志消息事件
  | 'task-queue-length-changed' // 【状态同步】队列长度变化
  | 'pending-tasks-size-changed'; // 【状态同步】待处理任务数变化

/**
 * 事件处理器类型
 */
export type EventHandler = (data?: any) => void;

/**
 * 事件总线类
 *
 * 【单例模式】整个应用只创建一个 EventBus 实例
 *
 * 使用示例：
 * ```typescript
 * const eventBus = EventBus.getInstance();
 *
 * // 订阅事件
 * eventBus.on('worker.idle', (consumer) => {
 *     console.log('Worker 空闲:', consumer.id);
 * });
 *
 * // 发布事件
 * eventBus.emit('worker.idle', consumer);
 *
 * // 清理所有监听器
 * eventBus.clearAll();
 * ```
 */
export class EventBus {
  private static instance: EventBus | null = null;
  private listeners: Map<WorkerEventType, EventHandler[]>;
  private log: Logger;

  /**
   * 私有构造函数，防止外部直接创建实例
   */
  private constructor() {
    this.listeners = new Map();
    this.log = createLogger('EventBus');
  }

  /**
   * 获取 EventBus 单例实例
   *
   * @returns EventBus 单例实例
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 重置单例（用于测试或重新初始化）
   */
  static resetInstance(): void {
    EventBus.instance = null;
  }

  /**
   * 发布事件
   * @param event 事件类型
   * @param data 事件数据（可选）
   */
  emit(event: WorkerEventType, data?: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error: any) {
          this.log.error('[EventBus] 事件 {} 处理失败: {}', event, error.message);
        }
      });
    }
  }

  /**
   * 订阅事件
   * @param event 事件类型
   * @param handler 事件处理器
   */
  on(event: WorkerEventType, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  /**
   * 取消订阅
   * @param event 事件类型
   * @param handler 要移除的事件处理器
   */
  off(event: WorkerEventType, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 清空所有监听器（用于扫描结束时清理）
   */
  clearAll(): void {
    this.listeners.clear();
  }

  /**
   * 获取某个事件的监听器数量（用于调试）
   */
  getListenerCount(event: WorkerEventType): number {
    return this.listeners.get(event)?.length || 0;
  }

  /**
   * 【新增】获取所有事件的监听器统计信息
   *
   * @returns Map<事件类型, 监听器数量>
   *
   * 【使用场景】
   * - 清理后验证监听器是否被正确清除
   * - 检测内存泄漏风险
   * - 调试 EventBus 状态
   *
   * 【示例】
   * ```typescript
   * const stats = eventBus.getAllListenerStats();
   * console.log('监听器统计:', stats);
   * // Map {
   * //   'worker.idle' => 0,
   * //   'worker.created' => 0,
   * //   'log:message' => 1
   * // }
   * ```
   */
  getAllListenerStats(): Map<WorkerEventType, number> {
    const stats = new Map<WorkerEventType, number>();
    for (const [event, handlers] of this.listeners.entries()) {
      stats.set(event, handlers.length);
    }
    return stats;
  }

  /**
   * 【新增】检查是否有非预期的监听器
   *
   * @param expectedEvents 期望存在的事件列表（这些事件的监听器数量可以 > 0）
   * @returns 非预期事件的列表 [{ event, count }]
   *
   * 【使用场景】
   * - 清理后验证只有预期的监听器存在
   * - 检测是否有遗漏的清理操作
   *
   * 【示例】
   * ```typescript
   * // 期望只有 log:message 监听器存在
   * const unexpected = eventBus.checkUnexpectedListeners(['log:message']);
   * if (unexpected.length > 0) {
   *     console.warn('发现非预期监听器:', unexpected);
   * }
   * ```
   */
  checkUnexpectedListeners(
    expectedEvents: WorkerEventType[]
  ): Array<{ event: WorkerEventType; count: number }> {
    const unexpected: Array<{ event: WorkerEventType; count: number }> = [];

    for (const [event, handlers] of this.listeners.entries()) {
      if (!expectedEvents.includes(event) && handlers.length > 0) {
        unexpected.push({ event, count: handlers.length });
      }
    }

    return unexpected;
  }
}
