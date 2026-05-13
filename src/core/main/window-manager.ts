/**
 * 窗口管理模块
 * 
 * 职责：
 * - BrowserWindow 的创建和配置
 * - 窗口位置和尺寸计算
 * - 图标加载
 * - 窗口生命周期管理
 * - LogManager 初始化
 */

import {app, BrowserWindow, nativeImage, Menu, screen} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {Logger} from '../../logger/logger';
import {LogManager} from '../infra/log-manager';
import {ScanState} from '../state/scan-state';
import {cancelScan} from '../scanner';
import {WINDOW_DEFAULT_HEIGHT, WINDOW_DEFAULT_WIDTH, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, WINDOW_TARGET_RATIO} from '../config/constants';
import {PowerSaveManager} from './power-save-manager';

/**
 * 窗口管理器接口
 */
export interface WindowManager {
    /**
     * 创建主窗口
     * 
     * @param powerSaveManager 电源阻止器管理器
     * @returns BrowserWindow 实例
     */
    createWindow(powerSaveManager: PowerSaveManager): BrowserWindow;

    /**
     * 获取主窗口实例
     */
    getWindow(): BrowserWindow | null;

    /**
     * 获取 LogManager 实例
     */
    getLogManager(): LogManager | null;

    /**
     * 销毁窗口管理器
     */
    destroy(): void;
}

/**
 * 计算窗口位置和尺寸（屏幕的 85%，居中显示）
 * 
 * @param log 日志记录器
 * @returns 窗口位置和尺寸
 */
function getWindowBounds(log: Logger): { x?: number; y?: number; width: number; height: number } {
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

        log.info(`窗口位置: (${x}, ${y}), 尺寸: ${width}x${height}`);
        log.info(`显示器工作区: ${workArea.width}x${workArea.height}, 缩放: ${display.scaleFactor}x`);

        return {x, y, width, height};
    } catch (error) {
        log.error('计算窗口位置失败，使用默认值:', error);
        // 降级方案：使用默认尺寸，系统会自动居中
        return {width: WINDOW_DEFAULT_WIDTH, height: WINDOW_DEFAULT_HEIGHT};
    }
}

/**
 * 创建窗口管理器
 * 
 * @param log 日志记录器
 * @returns 窗口管理器实例
 */
export function createWindowManager(log: Logger): WindowManager {
    let mainWindow: BrowserWindow | null = null;
    let logManager: LogManager | null = null;
    let scanState: ScanState | null = null;
    let powerSaveManagerRef: PowerSaveManager | null = null;

    return {
        createWindow(powerSaveManager: PowerSaveManager): BrowserWindow {
            // 【重构】保存引用以便后续使用
            powerSaveManagerRef = powerSaveManager;
            scanState = ScanState.getInstance();

            // 【新增】计算窗口位置和尺寸
            const bounds = getWindowBounds(log);

            // 加载应用图标
            let icon: any = undefined;
            try {
                // macOS优先使用.icns，其他平台使用.png
                const iconPath = process.platform === 'darwin'
                    ? path.join(__dirname, '..', 'build', 'icons', 'icon.icns')
                    : path.join(__dirname, '..', 'build', 'icons', 'icon.png');

                log.info('尝试加载图标，路径:', iconPath);
                if (fs.existsSync(iconPath)) {
                    icon = nativeImage.createFromPath(iconPath);
                    log.info('✓ 图标加载成功，尺寸:', icon.getSize());
                } else {
                    log.warn('⚠ 图标文件不存在:', iconPath);
                }
            } catch (error) {
                log.error('✗ 加载图标失败:', error);
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
                log.info('✓ 已设置Dock图标');
            }

            // 检查是否为开发模式
            // 优先使用环境变量，其次检查dist目录是否存在
            const isDev = process.env.NODE_ENV === 'development' ||
                process.env.ELECTRON_IS_DEV === '1' ||
                !require('fs').existsSync(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));

            log.info('运行模式:', isDev ? '开发模式 (Vite)' : '生产模式 (文件)');

            if (isDev) {
                log.info('加载开发服务器: http://localhost:1420');
                mainWindow.loadURL('http://localhost:1420').catch((err) => {
                    log.error('加载开发服务器失败:', err);
                    log.info('尝试加载本地文件...');
                    // 如果开发服务器不可用，尝试加载本地文件
                    if (mainWindow) {
                        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html')).catch((fileErr) => {
                            log.error('加载本地文件也失败:', fileErr);
                        });
                    }
                });
                mainWindow.webContents.openDevTools();
            } else {
                // 生产模式：使用 __dirname 确保路径准确
                const indexPath = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
                log.info('应用路径:', app.getAppPath());
                log.info('加载本地文件:', indexPath);

                // 检查文件是否存在
                const fs = require('fs');
                if (!fs.existsSync(indexPath)) {
                    log.error('前端文件不存在:', indexPath);
                    // 尝试打印 __dirname 看看实际指向哪里
                    log.error('当前 __dirname:', __dirname);
                } else {
                    mainWindow.loadFile(indexPath).catch((err) => {
                        log.error('加载前端文件失败:', err);
                    });
                }
            }

            mainWindow.on('closed', () => {
                // 如果窗口关闭时正在扫描，取消扫描并重置状态
                if (scanState && scanState.isScanning) {
                    cancelScan(scanState);
                    scanState.isScanning = false;
                }

                // 【新增】窗口关闭时停止电源阻止器
                if (powerSaveManagerRef) {
                    powerSaveManagerRef.stop();
                }

                mainWindow = null;
            });

            return mainWindow;
        },

        getWindow(): BrowserWindow | null {
            return mainWindow;
        },

        getLogManager(): LogManager | null {
            return logManager;
        },

        destroy(): void {
            if (mainWindow) {
                mainWindow.destroy();
                mainWindow = null;
            }
            if (logManager) {
                logManager.destroy();
                logManager = null;
            }
        }
    };
}
