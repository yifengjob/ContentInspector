import {app, BrowserWindow, dialog, ipcMain, nativeImage, Menu, screen, powerSaveBlocker} from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 【关键】首先导入日志抑制工具（必须在任何其他导入之前）
import './utils/log-utils';

// 【新增】设置日志文件
import {setupFileLogger, mainLogger, flushLogStream} from './logger/logger';

const logDir = path.join(app.getPath('userData'), 'logs');
setupFileLogger(logDir);

// 【新增】启用 V8 垃圾回收 API（用于扫描完成后释放内存）
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// 【修复】初始化 PDF.js 所需的 polyfill（包括 Promise.withResolvers、DOMMatrix、浏览器环境模拟）
import {setupAllPdfPolyfills} from './utils/pdf-polyfills';
setupAllPdfPolyfills();

import {ScanState} from './core/scan-state';
import {LogManager} from './core/log-manager';  // 【新增】导入日志管理器
import {getDirectoryTree} from './services/directory-tree';
import {cancelScan, startScan} from './core/scanner';
import {deleteFile, openFile, openFileLocation} from './services/file-operations';
import {exportReport} from './services/report-exporter';
import {loadConfig, saveConfig, calculateRecommendedConcurrency} from './core/config-manager';
import {checkEnvironment} from './core/environment-check';
import {getSensitiveRules} from './detection/sensitive-detector';
// 【优化】导入配置常量
import {
    CANCEL_SCAN_MAX_WAIT,
    CANCEL_SCAN_CHECK_INTERVAL,
    WORKER_MAX_OLD_GENERATION_MB,
    WORKER_MAX_YOUNG_GENERATION_MB,
    PREVIEW_CHUNK_SIZE,  // 【方案 D3】预览流式传输块大小
    calculatePreviewTimeout,  // 【重构】智能预览超时计算
    PREVIEW_BASE_TIMEOUT,  // 【重构】预览基础超时
    WINDOW_MIN_WIDTH,
    WINDOW_MIN_HEIGHT,
    WINDOW_DEFAULT_WIDTH,
    WINDOW_DEFAULT_HEIGHT,
    WINDOW_TARGET_RATIO,
    MS_TO_DAYS,
    BYTES_TO_MB,
    LOG_RETENTION_DAYS// 【方案 C】预览文件大小限制
} from './core/scan-config';

// 【修复】添加全局未处理异常处理器，防止 Windows 闪退
process.on('unhandledRejection', (reason, _promise) => {
    mainLogger.error('[全局错误] 未处理的 Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    mainLogger.error('[全局错误] 未捕获的异常:', error);
    // 【关键】不退出进程，让应用继续运行
    // 注意：某些致命错误（如 OOM）可能无法阻止退出
});

// 【新增】监听进程退出，帮助诊断闪退原因
// 如果闪退时看不到这条日志，说明进程被外部强制终止（如杀毒软件、段错误）
process.on('exit', (code) => {
    // 【修复】使用本地时间（北京时间），24小时制
    const timestamp = new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false  // 24小时制
    });
    mainLogger.info(`[进程退出] 代码: ${code}, 时间: ${timestamp}`);
});

// 【新增】监听应用即将退出，flush 日志确保完整性
app.on('before-quit', async () => {
    mainLogger.info('[应用退出] 正在 flush 日志...');
    try {
        await flushLogStream();
        mainLogger.info('[应用退出] 日志已 flush 完成');
    } catch (error) {
        // 使用 process.stderr 避免循环依赖
        process.stderr.write(`[应用退出] 日志 flush 失败: ${error}\n`);
    }
    
    // 【新增】清理 LogManager
    logManager?.destroy();
});

let mainWindow: BrowserWindow | null = null;
const scanState = new ScanState();
let logManager: LogManager | null = null;  // 【新增】日志管理器实例

// 【新增】电源阻止器 ID（用于防止锁屏时扫描中断）
let powerSaveBlockerId: number | null = null;

// 【方案 B】预览 Worker 管理（支持取消）
const previewWorkers = new Map<number, any>(); // taskId -> Worker

// 【新增】计算窗口位置和尺寸（屏幕的 85%，居中显示）
function getWindowBounds(): { x?: number; y?: number; width: number; height: number } {
    try {
        // 获取鼠标所在的显示器
        const cursorPoint = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursorPoint);

        // 获取工作区（排除任务栏/Dock）
        const workArea = display.workArea;

        // 计算目标尺寸
        const targetWidth = Math.floor(workArea.width * WINDOW_TARGET_RATIO);
        const targetHeight = Math.floor(workArea.height * WINDOW_TARGET_RATIO);

        // 应用尺寸限制
        const width = Math.max(WINDOW_MIN_WIDTH, Math.min(1920, targetWidth));
        const height = Math.max(WINDOW_MIN_HEIGHT, Math.min(1080, targetHeight));

        // 居中计算
        const x = workArea.x + Math.floor((workArea.width - width) / 2);
        const y = workArea.y + Math.floor((workArea.height - height) / 2);

        mainLogger.info(`窗口位置: (${x}, ${y}), 尺寸: ${width}x${height}`);
        mainLogger.info(`显示器工作区: ${workArea.width}x${workArea.height}, 缩放: ${display.scaleFactor}x`);

        return {x, y, width, height};
    } catch (error) {
        mainLogger.error('计算窗口位置失败，使用默认值:', error);
        // 降级方案：使用默认尺寸，系统会自动居中
        return {width: WINDOW_DEFAULT_WIDTH, height: WINDOW_DEFAULT_HEIGHT};
    }
}

function createWindow() {
    // 【新增】计算窗口位置和尺寸
    const bounds = getWindowBounds();

    // 加载应用图标
    let icon: any = undefined;
    try {
        // macOS优先使用.icns，其他平台使用.png
        const iconPath = process.platform === 'darwin'
            ? path.join(__dirname, '..', 'build', 'icons', 'icon.icns')
            : path.join(__dirname, '..', 'build', 'icons', 'icon.png');

        mainLogger.info('尝试加载图标，路径:', iconPath);
        if (fs.existsSync(iconPath)) {
            icon = nativeImage.createFromPath(iconPath);
            mainLogger.info('✓ 图标加载成功，尺寸:', icon.getSize());
        } else {
            mainLogger.warn('⚠ 图标文件不存在:', iconPath);
        }
    } catch (error) {
        mainLogger.error('✗ 加载图标失败:', error);
    }

    mainWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'DataGuard Scanner - 敏感数据扫描工具',
        icon: icon
    });

    // 【新增】初始化日志管理器（只需一行代码）
    logManager = new LogManager(mainWindow);

    // 【新增】隐藏原生菜单栏（Windows/Linux）
    Menu.setApplicationMenu(null);

    // macOS下设置Dock图标（开发模式）
    if (process.platform === 'darwin' && icon && !icon.isEmpty()) {
        app.dock.setIcon(icon);
        mainLogger.info('✓ 已设置Dock图标');
    }

    // 检查是否为开发模式
    // 优先使用环境变量，其次检查dist目录是否存在
    const isDev = process.env.NODE_ENV === 'development' ||
        process.env.ELECTRON_IS_DEV === '1' ||
        !require('fs').existsSync(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));

    mainLogger.info('运行模式:', isDev ? '开发模式 (Vite)' : '生产模式 (文件)');

    if (isDev) {
        mainLogger.info('加载开发服务器: http://localhost:1420');
        mainWindow.loadURL('http://localhost:1420').catch((err) => {
            mainLogger.error('加载开发服务器失败:', err);
            mainLogger.info('尝试加载本地文件...');
            // 如果开发服务器不可用，尝试加载本地文件
            if (mainWindow) {
                mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html')).catch((fileErr) => {
                    mainLogger.error('加载本地文件也失败:', fileErr);
                });
            }
        });
        mainWindow.webContents.openDevTools();
    } else {
        // 生产模式：使用 __dirname 确保路径准确
        const indexPath = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
        mainLogger.info('应用路径:', app.getAppPath());
        mainLogger.info('加载本地文件:', indexPath);

        // 检查文件是否存在
        const fs = require('fs');
        if (!fs.existsSync(indexPath)) {
            mainLogger.error('前端文件不存在:', indexPath);
            // 尝试打印 __dirname 看看实际指向哪里
            mainLogger.error('当前 __dirname:', __dirname);
        } else {
            mainWindow.loadFile(indexPath).catch((err) => {
                mainLogger.error('加载前端文件失败:', err);
            });
        }
    }

    mainWindow.on('closed', () => {
        // 如果窗口关闭时正在扫描，取消扫描并重置状态
        if (scanState.isScanning) {
            cancelScan(scanState);
            scanState.isScanning = false;
        }

        // 【新增】窗口关闭时停止电源阻止器
        if (powerSaveBlockerId !== null) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            mainLogger.info(`[电源管理] 窗口关闭，已停止电源阻止器 (ID: ${powerSaveBlockerId})`);
            powerSaveBlockerId = null;
        }

        mainWindow = null;
    });

    // 【新增】设置扫描完成监听器
    setupScanFinishedListener();
}

app.whenReady().then(() => {
    const envCheck = checkEnvironment();

    if (!envCheck.isReady) {
        dialog.showErrorBox('系统环境检查失败',
            `发现以下问题:\n\n${envCheck.issues.map(i => `${i.title}\n${i.description}`).join('\n\n')}`
        );
        app.quit();
        return;
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    setupIpcHandlers();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 计算目录大小（字节）
function getDirectorySize(dirPath: string): number {
    const fs = require('fs');
    let totalSize = 0;

    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                totalSize += getDirectorySize(filePath);
            } else {
                totalSize += stat.size;
            }
        }
    } catch (e) {
        // 忽略无法访问的文件
    }

    return totalSize;
}

function setupIpcHandlers() {
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
        if (!mainWindow) return {error: '窗口未初始化'};

        try {
            // 【新增】启动电源阻止器，防止锁屏/休眠导致扫描中断
            if (powerSaveBlockerId === null && !powerSaveBlocker.isStarted(0)) {
                powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
                mainLogger.info(`[电源管理] 已启动电源阻止器 (ID: ${powerSaveBlockerId})，防止系统休眠`);
            }

            // 不 await，让扫描在后台进行
            startScan(config, mainWindow, scanState).catch(error => {
                mainLogger.error('扫描异常:', error);
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
        if (!scanState.isScanning) {
            return {success: true};
        }

        cancelScan(scanState);

        // 【优化】改为异步通知机制，不阻塞 IPC
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (!scanState.isScanning) {
                    clearInterval(checkInterval);
                    mainLogger.info('[scan-cancel] 扫描已安全取消');

                    // 【新增】停止电源阻止器
                    if (powerSaveBlockerId !== null) {
                        powerSaveBlocker.stop(powerSaveBlockerId);
                        mainLogger.info(`[电源管理] 已停止电源阻止器 (ID: ${powerSaveBlockerId})`);
                        powerSaveBlockerId = null;
                    }

                    resolve({success: true});
                }
            }, CANCEL_SCAN_CHECK_INTERVAL);

            // 超时强制 resolve
            setTimeout(() => {
                clearInterval(checkInterval);
                if (scanState.isScanning) {
                    mainLogger.warn(`[scan-cancel] 警告: 等待 ${CANCEL_SCAN_MAX_WAIT / 1000} 秒后扫描仍未结束，强制重置状态`);
                    scanState.isScanning = false;
                }

                // 【新增】停止电源阻止器
                if (powerSaveBlockerId !== null) {
                    powerSaveBlocker.stop(powerSaveBlockerId);
                    mainLogger.info(`[电源管理] 已停止电源阻止器 (ID: ${powerSaveBlockerId})`);
                    powerSaveBlockerId = null;
                }

                resolve({success: true, warning: '强制重置扫描状态'});
            }, CANCEL_SCAN_MAX_WAIT);
        });
    });

    // 【方案 D3】预览文件（流式模式）
    ipcMain.handle('preview-file-stream', async (_, filePath: string) => {
        try {
            const fs = require('fs');

            const {Worker} = require('worker_threads');
            const pathModule = require('path');

            // 获取配置
            const config = await loadConfig();
            const enabledTypes = config.enabledSensitiveTypes || [];

            // 创建 Worker
            const workerPath = pathModule.join(__dirname, 'workers', 'file-worker.js');
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
                        mainLogger.warn('[预览] 无法获取文件大小，使用默认超时');
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
                        mainWindow?.webContents.send('preview-chunk', {
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
    });

    // 【已删除】非流式预览处理器 - 所有预览统一使用流式模式（preview-file-stream）
    // 旧的 preview-file 已被移除，因为：
    // 1. 前端已完全迁移到 previewFileStream
    // 2. 流式模式内存更可控，支持超大文件
    // 3. 减少代码复杂度

    // 【方案 B】取消预览（真正终止 Worker）
    ipcMain.handle('cancel-preview', (_, taskId: number) => {
        const worker = previewWorkers.get(taskId);
        if (worker) {
            mainLogger.info(`[预览取消] 终止 Worker (taskId: ${taskId})`);
            worker.terminate();  // 强制终止
            previewWorkers.delete(taskId);  // 清理
        }
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
        return await dialog.showSaveDialog(mainWindow!, {
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
        const result = await dialog.showMessageBox(mainWindow!, {
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
            const fs = require('fs');
            const os = require('os');
            const userDataPath = app.getPath('userData');

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
                        mainLogger.info(`[clear-cache] 保留当前日志: ${logFile}`);
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
                        mainLogger.warn(`[clear-cache] 无法删除日志文件 ${logFile}:`, e);
                    }
                }

                // 【优化】清空当前日志文件内容（不删除文件本身）
                const currentLogPath = path.join(logDir, currentLogFile);
                if (fs.existsSync(currentLogPath)) {
                    try {
                        fs.writeFileSync(currentLogPath, '');
                        mainLogger.info('[clear-cache] 已清空当前日志文件内容');
                    } catch (e) {
                        mainLogger.warn('[clear-cache] 清空当前日志失败:', e);
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
            mainLogger.info(`[clear-cache] 缓存清理完成，释放 ${cleanedSizeMB} MB 空间`);
            mainLogger.info(`[clear-cache] 清理的文件: ${cleanedFiles.join(', ') || '无'}`);

            return {success: true, cleanedSize, cleanedFiles};
        } catch (error: any) {
            mainLogger.error('[clear-cache] 清理缓存失败:', error);
            return {error: error.message};
        }
    });

    // 【新增】打开开发者工具
    ipcMain.handle('open-dev-tools', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.openDevTools();
            return {success: true};
        }
        return {error: '窗口未初始化'};
    });
}

// 【新增】监听扫描完成事件，停止电源阻止器
// 注意：scanner.ts 会通过 mainWindow.webContents.send 发送 scan-finished
// 我们需要在 BrowserWindow 层面监听这个事件
let originalSend: any = null;

function setupScanFinishedListener() {
    if (!originalSend && mainWindow) {
        originalSend = mainWindow.webContents.send.bind(mainWindow.webContents);
        mainWindow.webContents.send = function (channel: string, ...args: any[]) {
            if (channel === 'scan-finished') {
                // 扫描完成时停止电源阻止器
                if (powerSaveBlockerId !== null) {
                    powerSaveBlocker.stop(powerSaveBlockerId);
                    mainLogger.info(`[电源管理] 扫描完成，已停止电源阻止器 (ID: ${powerSaveBlockerId})`);
                    powerSaveBlockerId = null;
                }
            }
            return originalSend(channel, ...args);
        };
    }
}
