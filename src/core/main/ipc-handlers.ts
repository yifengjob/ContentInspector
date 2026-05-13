/**
 * IPC 通信处理器模块
 * 
 * 职责：
 * - 注册和管理所有 IPC 通信处理器
 * - 处理来自渲染进程的请求
 */

import {ipcMain, dialog, BrowserWindow} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {Logger} from '../../logger/logger';
import {ScanState} from '../state/scan-state';
import {startScan, cancelScan} from '../scanner';
import {getDirectoryTree} from '../../services/directory-tree';
import {deleteFile, openFile, openFileLocation} from '../../services/file-operations';
import {exportReport} from '../../services/report-exporter';
import {getSensitiveRules} from '../../detection/sensitive-detector';
import {loadConfig, saveConfig, calculateRecommendedConcurrency} from '../config/manager';
import {checkEnvironment} from '../infra';
import {LOG_RETENTION_DAYS, MS_TO_DAYS, BYTES_TO_MB} from '../config/constants';
import {PowerSaveManager} from './power-save-manager';
import {PreviewWorkerManager} from './preview-worker-manager';
import {getDirectorySize} from './utils';

/**
 * 设置所有 IPC 处理器
 * 
 * @param getMainWindow 获取主窗口的函数
 * @param scanState 扫描状态实例
 * @param powerSaveManager 电源阻止器管理器
 * @param previewWorkerManager 预览 Worker 管理器
 */
export function setupIpcHandlers(
    getMainWindow: () => BrowserWindow | null,
    scanState: ScanState,
    powerSaveManager: PowerSaveManager,
    previewWorkerManager: PreviewWorkerManager
): void {
    const log = (msg: string, ...args: any[]) => {
        // 使用全局 mainLogger
        require('../../logger/logger').mainLogger.info(msg, ...args);
    };

    // 获取目录树
    ipcMain.handle('get-directory-tree', async (_, dirPath: string, showHidden: boolean) => {
        try {
            return await getDirectoryTree(dirPath, showHidden);
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 开始扫描
    ipcMain.handle('scan-start', async (_, config: any) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) return {error: '窗口未初始化'};

        try {
            // 【新增】启动电源阻止器，防止锁屏/休眠导致扫描中断
            powerSaveManager.start();

            // 不 await，让扫描在后台进行
            startScan(config, mainWindow).catch(error => {
                log('扫描异常:', error);
                if (mainWindow) {
                    mainWindow.webContents.send('scan-error', error.message);
                }
            });
            return {success: true};
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 取消扫描
    ipcMain.handle('scan-cancel', async () => {
        log('[取消扫描] 收到取消请求');

        // 【修复】不再检查 isScanning，始终调用 cancelScan
        // 即使 isScanning 为 false，也要确保清理所有资源
        cancelScan(scanState);

        // 【优化】改为异步通知机制，不阻塞 IPC
        return new Promise((resolve) => {
            const CANCEL_SCAN_CHECK_INTERVAL = 100;
            const CANCEL_SCAN_MAX_WAIT = 5000;
            
            const checkInterval = setInterval(() => {
                if (!scanState.isScanning) {
                    clearInterval(checkInterval);
                    log('[取消扫描] 扫描已安全取消');

                    // 【新增】停止电源阻止器
                    powerSaveManager.stop();

                    resolve({success: true});
                }
            }, CANCEL_SCAN_CHECK_INTERVAL);

            // 超时强制 resolve
            setTimeout(() => {
                clearInterval(checkInterval);
                if (scanState.isScanning) {
                    log(`[取消扫描] 警告: 等待 ${CANCEL_SCAN_MAX_WAIT / 1000} 秒后扫描仍未结束，强制重置状态`);
                    scanState.isScanning = false;
                }

                // 【新增】停止电源阻止器
                powerSaveManager.stop();

                resolve({success: true, warning: '强制重置扫描状态'});
            }, CANCEL_SCAN_MAX_WAIT);
        });
    });

    // 【方案 D3】预览文件（流式模式）
    ipcMain.handle('preview-file-stream', async (_, filePath: string) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            return {error: '窗口未初始化'};
        }
        
        try {
            return await previewWorkerManager.previewFile(filePath, mainWindow);
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 【方案 B】取消预览（真正终止 Worker）
    ipcMain.handle('cancel-preview', (_, taskId: number) => {
        previewWorkerManager.cancelPreview(taskId);
        return {success: true};
    });

    // 打开文件
    ipcMain.handle('open-file', async (_, filePath: string) => {
        try {
            await openFile(filePath);
            return {success: true};
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 打开文件位置
    ipcMain.handle('open-file-location', async (_, filePath: string) => {
        try {
            await openFileLocation(filePath);
            return {success: true};
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 删除文件
    ipcMain.handle('delete-file', async (_, filePath: string, toTrash: boolean) => {
        try {
            await deleteFile(filePath, toTrash);
            return {success: true};
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 导出报告
    ipcMain.handle('export-report', async (_, results: any[], format: string, filePath?: string) => {
        try {
            await exportReport(results, format as 'csv' | 'json' | 'excel', filePath);
            return {success: true};
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 获取日志
    ipcMain.handle('get-logs', () => {
        return {logs: scanState.logs};
    });

    // 获取敏感规则
    ipcMain.handle('get-sensitive-rules', () => {
        return getSensitiveRules();
    });

    // 保存配置
    ipcMain.handle('save-config', async (_, config: any) => {
        try {
            await saveConfig(config);
            return {success: true};
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 加载配置
    ipcMain.handle('load-config', async () => {
        try {
            return await loadConfig();
        } catch (error: any) {
            return {error: error.message};
        }
    });

    // 获取推荐的并发数（根据系统硬件智能计算）
    ipcMain.handle('get-recommended-concurrency', () => {
        return calculateRecommendedConcurrency();
    });

    // 检查系统环境
    ipcMain.handle('check-system-environment', () => {
        return checkEnvironment();
    });

    // 保存文件对话框
    ipcMain.handle('show-save-dialog', async (_, options?: any) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            return {canceled: true};
        }
        return await dialog.showSaveDialog(mainWindow, {
            filters: options?.filters || []
        });
    });

    // 【新增】消息对话框（确认/提示）
    ipcMain.handle('show-message-box', async (_, options: {
        message: string;
        title?: string;
        type?: 'info' | 'warning' | 'error' | 'question';
        buttons?: string[];
        cancelId?: number;
    }) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            return {response: 0};
        }
        const result = await dialog.showMessageBox(mainWindow, {
            type: options.type || 'info',
            title: options.title || '提示',
            message: options.message,
            buttons: options.buttons || ['确定'],
            cancelId: options.cancelId,
            defaultId: 0
        });
        return {response: result.response};
    });

    // 清理应用缓存
    ipcMain.handle('clear-cache', async () => {
        try {
            const userDataPath = require('electron').app.getPath('userData');

            let cleanedSize = 0;
            const cleanedFiles: string[] = [];

            // 1. 清理 Chromium 缓存
            const cacheDirs = [
                path.join(userDataPath, 'Cache'),
                path.join(userDataPath, 'GPUCache'),
                path.join(userDataPath, 'Code Cache'),
                path.join(userDataPath, 'Service Worker'),
            ];

            for (const cacheDir of cacheDirs) {
                if (fs.existsSync(cacheDir)) {
                    const size = getDirectorySize(cacheDir);
                    fs.rmSync(cacheDir, {recursive: true, force: true});
                    cleanedSize += size;
                    cleanedFiles.push(path.basename(cacheDir));
                }
            }

            // 2. 【新增】清理日志文件（保留当前正在使用的日志）
            const logDir = path.join(userDataPath, 'logs');
            if (fs.existsSync(logDir)) {
                const logFiles = fs.readdirSync(logDir);
                const currentLogFile = `app-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;

                for (const logFile of logFiles) {
                    // 跳过当前正在使用的日志文件
                    if (logFile === currentLogFile) {
                        log(`[clear-cache] 保留当前日志: ${logFile}`);
                        continue;
                    }

                    const logFilePath = path.join(logDir, logFile);
                    try {
                        const stat = fs.statSync(logFilePath);
                        if (stat.isFile()) {
                            fs.unlinkSync(logFilePath);
                            cleanedSize += stat.size;
                            cleanedFiles.push(`logs/${logFile}`);
                        }
                    } catch (e) {
                        log(`[clear-cache] 无法删除日志文件 ${logFile}:`, e);
                    }
                }

                // 【优化】清空当前日志文件内容（不删除文件本身）
                const currentLogPath = path.join(logDir, currentLogFile);
                if (fs.existsSync(currentLogPath)) {
                    try {
                        fs.writeFileSync(currentLogPath, '');
                        log('[clear-cache] 已清空当前日志文件内容');
                    } catch (e) {
                        log('[clear-cache] 清空当前日志失败:', e);
                    }
                }
            }

            // 3. 清理系统临时目录中的本应用相关文件
            const tempDir = os.tmpdir();
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    // 清理超过指定天数的临时文件
                    const filePath = path.join(tempDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        const daysOld = (Date.now() - stat.mtimeMs) / MS_TO_DAYS;
                        if (daysOld > LOG_RETENTION_DAYS && stat.isFile()) {
                            fs.unlinkSync(filePath);
                            cleanedSize += stat.size;
                            cleanedFiles.push(`temp/${file}`);
                        }
                    } catch (e) {
                        // 忽略无法删除的文件
                    }
                }
            }

            const cleanedSizeMB = Math.round(cleanedSize / BYTES_TO_MB);
            log(`[clear-cache] 缓存清理完成，释放 ${cleanedSizeMB} MB 空间`);
            log(`[clear-cache] 清理的文件: ${cleanedFiles.join(', ') || '无'}`);

            return {success: true, cleanedSize, cleanedFiles};
        } catch (error: any) {
            log('[clear-cache] 清理缓存失败:', error);
            return {error: error.message};
        }
    });

    // 【新增】打开开发者工具
    ipcMain.handle('open-dev-tools', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.openDevTools();
            return {success: true};
        }
        return {error: '窗口未初始化'};
    });
}
