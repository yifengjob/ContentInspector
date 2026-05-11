/**
 * 日志管理器模块
 *
 * 职责：
 * - 管理 EventBus 实例
 * - 监听日志事件并转发到前端
 * - 接收 Worker 日志消息
 * - 保持 main.ts 精简
 */

import {BrowserWindow} from 'electron';
import {EventBus, setGlobalEventBus} from './event-bus';
import {LogEventData} from "./event-types";
import {logManagerLogger} from "../logger/logger";

/**
 * 日志管理器类
 *
 * 封装所有日志管理逻辑，保持 main.ts 精简
 */
export class LogManager {
    private readonly eventBus: EventBus;
    private readonly mainWindow: BrowserWindow;

    // 【新增】IPC 节流相关
    private logBuffer: string[] = [];
    private lastSendTime: number = 0;
    private sendTimer: NodeJS.Timeout | null = null;
    private readonly SEND_INTERVAL = 500;  // 最小发送间隔 500ms
    private readonly BATCH_SIZE = 500;       // 批量大小 500 条

    /**
     * 构造函数
     *
     * @param mainWindow - 主窗口引用
     */
    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow;

        // 获取 EventBus 单例实例
        this.eventBus = EventBus.getInstance();

        // 设置全局引用（供 logger.ts 使用）
        setGlobalEventBus(this.eventBus);

        // 注册日志事件监听器
        this.setupLogListeners();
    }

    /**
     * 获取 EventBus 实例（供其他模块使用）
     *
     * @returns EventBus 实例
     */
    getEventBus(): EventBus {
        return this.eventBus;
    }

    /**
     * 处理 Worker 日志消息
     *
     * @param workerId - Worker ID
     * @param message - 日志消息对象
     */
    handleWorkerLog(workerId: number, message: any): void {
        if (message.type === 'log') {
            this.eventBus.emit('log:message', {
                level: message.level,
                message: `[Worker #${workerId}] ${message.message}`,
                context: message.context || 'Worker',
                timestamp: message.timestamp
            });
        }
    }

    /**
     * 清理资源
     * 应该在应用退出时调用
     */
    destroy(): void {
        // 【关键】刷新剩余的日志
        this.flushLogs();

        // 清除定时器
        if (this.sendTimer) {
            clearTimeout(this.sendTimer);
            this.sendTimer = null;
        }

        this.eventBus.clearAll();
        setGlobalEventBus(null);
    }

    /**
     * 设置日志事件监听器
     * 监听 log:message 事件并转发到前端（带节流）
     */
    private setupLogListeners(): void {
        this.eventBus.on('log:message', (data: LogEventData) => {
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                return;
            }

            // 【P1优化】ERROR 级别日志立即发送，不经过批量节流
            if (data.level === 'ERROR') {
                try {
                    this.mainWindow.webContents.send('scan-log', data.message);
                } catch (error: any) {
                    logManagerLogger.error('日志 IPC 发送失败:{}', error.message);
                }
                return;
            }

            // 将日志加入缓冲区
            this.logBuffer.push(data.message);

            const now = Date.now();
            const timeSinceLastSend = now - this.lastSendTime;

            // 【节流策略】满足以下任一条件时发送：
            // 1. 缓冲区达到 BATCH_SIZE
            // 2. 距离上次发送超过 SEND_INTERVAL
            if (this.logBuffer.length >= this.BATCH_SIZE ||
                (this.logBuffer.length > 0 && timeSinceLastSend >= this.SEND_INTERVAL)) {

                this.flushLogs();
            } else if (!this.sendTimer) {
                // 设置定时器，确保日志不会积压太久
                this.sendTimer = setTimeout(() => {
                    this.flushLogs();
                }, this.SEND_INTERVAL - timeSinceLastSend);
            }
        });
    }

    /**
     * 刷新日志缓冲区，发送到前端
     */
    private flushLogs(): void {
        if (this.logBuffer.length === 0 || !this.mainWindow || this.mainWindow.isDestroyed()) {
            return;
        }

        // 批量发送（合并为一条消息）
        const messages = this.logBuffer.join('\n');

        // 【P1优化】添加错误处理
        try {
            this.mainWindow.webContents.send('scan-log-batch', messages);
        } catch (error: any) {
            logManagerLogger.error('批量日志 IPC 发送失败:{}', error.message);
        }

        // 清空缓冲区
        this.logBuffer = [];
        this.lastSendTime = Date.now();

        // 清除定时器
        if (this.sendTimer) {
            clearTimeout(this.sendTimer);
            this.sendTimer = null;
        }
    }
}
