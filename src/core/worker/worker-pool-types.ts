/**
 * Worker Pool 类型定义
 * 
 * 职责：
 * - 定义 Worker Pool 相关的接口和类型
 * - 提供类型安全的契约
 */

import {Worker} from 'worker_threads';
import type {BrowserWindow} from 'electron';

/**
 * Consumer Worker 接口
 */
export interface Consumer {
    id: number;
    worker: Worker;
    busy: boolean;
    taskId?: number;
    counted?: boolean;
    isTerminating?: boolean;
    // 【智能调度】扩展字段
    currentFileType?: string;
    currentFileSize?: number;
    taskStartTime?: number;
}

/**
 * Pending Task 接口
 */
export interface PendingTask {
    filePath: string;
    resolve: (result: any) => void;
    reject: (error: any) => void;
    timeoutId: NodeJS.Timeout;
}

/**
 * WorkerPool 回调接口
 */
export interface WorkerPoolCallbacks {
    onUpdateConsumerCount: (taskId?: number) => void;
    onCleanupConsumerState: (consumer: Consumer) => void;
    onSendProgressUpdate: (filePath: string) => void;
    onCheckAndComplete: () => void;
    onTryDispatch: () => void;
    onErrorLog: (error: string) => void;
    onResultLog: (resultCount: number, result: any) => void;
    onResultBatchSend: (mainWindow: BrowserWindow, resultItem: any) => void;
    calculateTimeout: (fileSize: number) => number;
}
