/**
 * 预览 Worker 管理模块
 * 
 * 职责：
 * - 预览 Worker 的创建和注册
 * - 流式预览消息处理
 * - Worker 取消和终止
 * - 超时管理
 */

import {Worker} from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import {BrowserWindow} from 'electron';
import {Logger} from '../../logger/logger';
import {calculatePreviewTimeout, PREVIEW_CHUNK_SIZE, WORKER_MAX_OLD_GENERATION_MB, WORKER_MAX_YOUNG_GENERATION_MB, PREVIEW_BASE_TIMEOUT} from '../config/constants';
import {loadConfig} from '../config/manager';
import {FILE_WORKER_PATH} from '../../workers/file-worker';

/**
 * 预览 Worker 管理器接口
 */
export interface PreviewWorkerManager {
    /**
     * 预览文件（流式模式）
     * 
     * @param filePath 文件路径
     * @param mainWindow 主窗口实例
     * @returns 预览结果 Promise
     */
    previewFile(filePath: string, mainWindow: BrowserWindow): Promise<any>;

    /**
     * 取消预览
     * 
     * @param taskId 任务 ID
     */
    cancelPreview(taskId: number): void;

    /**
     * 清理所有预览 Worker
     */
    cleanup(): void;
}

/**
 * 创建预览 Worker 管理器
 * 
 * @param log 日志记录器
 * @param getMainWindow 获取主窗口的函数
 * @returns 预览 Worker 管理器实例
 */
export function createPreviewWorkerManager(
    log: Logger,
    getMainWindow: () => BrowserWindow | null
): PreviewWorkerManager {
    const previewWorkers = new Map<number, Worker>();

    return {
        async previewFile(filePath: string, mainWindow: BrowserWindow): Promise<any> {
            try {
                // 获取配置
                const config = await loadConfig();
                const enabledTypes = config.enabledSensitiveTypes || [];

                // 创建 Worker
                const workerPath = path.join(__dirname, '..', '..', 'workers', 'file-worker.js');
                const taskId = Date.now();
                const worker = new Worker(workerPath, {
                    resourceLimits: {
                        maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB,
                        maxYoungGenerationSizeMb: WORKER_MAX_YOUNG_GENERATION_MB,
                    }
                });

                // 注册 Worker，支持取消
                previewWorkers.set(taskId, worker);

                return new Promise((resolve) => {
                    let messageReceived = false;
                    let isResolved = false;  // 【P0修复】防止重复 resolve
                    let timeout: NodeJS.Timeout | null = null; // 【重构】提升 timeout 到外层作用域

                    // 【重构】根据文件大小智能计算预览超时
                    const getTimeout = async () => {
                        try {
                            const stat = await fs.promises.stat(filePath);
                            return calculatePreviewTimeout(stat.size);
                        } catch (error) {
                            log.warn('[预览] 无法获取文件大小，使用默认超时');
                            return PREVIEW_BASE_TIMEOUT; // 使用基础超时
                        }
                    };

                    getTimeout().then((timeoutMs) => {
                        timeout = setTimeout(() => {
                            if (!messageReceived && !isResolved) {  // 【P0修复】防止重复处理
                                isResolved = true;
                                worker.terminate();
                                previewWorkers.delete(taskId);
                                resolve({error: '预览超时，文件可能太大或太复杂'});
                            }
                        }, timeoutMs);
                    });

                    worker.on('message', (result: any) => {
                        // 跳过 ready 消息
                        if (result.type === 'ready') {
                            return;
                        }

                        // 【P0修复】防止重复处理
                        if (isResolved) return;

                        // 【方案 D3】处理流式数据块
                        if (result.type === 'chunk') {
                            // 转发数据块到前端
                            mainWindow.webContents.send('preview-chunk', {
                                chunkIndex: result.chunkIndex,
                                lines: result.lines,
                                highlights: result.highlights,
                                startLine: result.startLine,
                                totalLines: result.totalLines
                            });
                            return;
                        }

                        // 处理完成消息
                        if (result.type === 'complete') {
                            messageReceived = true;
                            isResolved = true;  // 【P0修复】标记已解决
                            if (timeout) clearTimeout(timeout);
                            previewWorkers.delete(taskId);
                            worker.terminate();
                            resolve({success: true, totalChunks: result.totalChunks});
                            return;
                        }

                        // 处理错误
                        if (result.error) {
                            messageReceived = true;
                            isResolved = true;  // 【P0修复】标记已解决
                            if (timeout) clearTimeout(timeout);
                            previewWorkers.delete(taskId);
                            worker.terminate();
                            resolve({error: result.error});
                            return;
                        }
                    });

                    worker.on('error', (error: any) => {
                        // 【P0修复】防止重复处理
                        if (isResolved) return;
                        isResolved = true;

                        if (timeout) clearTimeout(timeout);
                        previewWorkers.delete(taskId);
                        resolve({error: '预览失败：' + error.message});
                    });

                    worker.on('exit', (code: number) => {
                        // 【P0修复】防止重复处理
                        if (isResolved) return;

                        if (code !== 0 && !messageReceived) {
                            isResolved = true;  // 【P0修复】标记已解决
                            if (timeout) clearTimeout(timeout);
                            previewWorkers.delete(taskId);
                            resolve({error: `预览异常退出 (代码: ${code})`});
                        }
                    });

                    // 发送任务到 Worker（启用流式模式）
                    worker.postMessage({
                        taskId: taskId,
                        filePath: filePath,
                        enabledSensitiveTypes: enabledTypes,  // 【修复】传递用户配置的敏感词类型
                        previewMode: true,
                        streamMode: true,  // 【方案 D3】启用流式模式
                        chunkSize: PREVIEW_CHUNK_SIZE,   // 每块行数（配置常量）
                        config: {
                            enabledSensitiveTypes: enabledTypes,
                            maxFileSizeMb: config.maxFileSizeMb,  // 【修复】传递用户配置
                            maxPdfSizeMb: config.maxPdfSizeMb      // 【修复】传递用户配置
                        }
                    });
                });
            } catch (error: any) {
                return {error: error.message};
            }
        },

        cancelPreview(taskId: number): void {
            const worker = previewWorkers.get(taskId);
            if (worker) {
                log.info(`[预览取消] 终止 Worker (taskId: ${taskId})`);
                worker.terminate();  // 强制终止
                previewWorkers.delete(taskId);  // 清理
            }
        },

        cleanup(): void {
            // 终止所有预览 Worker
            for (const [taskId, worker] of previewWorkers.entries()) {
                try {
                    worker.terminate();
                    log.info(`[预览清理] 终止 Worker (taskId: ${taskId})`);
                } catch (error) {
                    log.error(`[预览清理] 终止 Worker 失败 (taskId: ${taskId}):`, error);
                }
            }
            previewWorkers.clear();
        }
    };
}
