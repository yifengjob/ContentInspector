/**
 * DataGuard Scanner - 主进程入口
 * 
 * 职责：
 * - 应用初始化
 * - 窗口创建和管理
 * - IPC 通信设置
 * - 应用生命周期管理
 */

// 【关键】首先初始化应用（日志、GC、polyfills、错误处理）
import {initializeApp, getAppLogger, setupAppQuitHandler} from './core/main';

initializeApp();
const log = getAppLogger();

// 导入必要的模块
import {app, BrowserWindow, dialog} from 'electron';
import {createWindowManager} from './core/main/window-manager';
import {createPowerSaveManager} from './core/main/power-save-manager';
import {createPreviewWorkerManager} from './core/main/preview-worker-manager';
import {setupIpcHandlers} from './core/main/ipc-handlers';
import {ScanState, checkEnvironment} from './core';

let mainWindow: BrowserWindow | null = null;
// 【重构】使用 ScanState 单例，类似 Pinia 的 useStore
const scanState = ScanState.getInstance();

// 【新增】创建管理器实例
const powerSaveManager = createPowerSaveManager();
const previewWorkerManager = createPreviewWorkerManager();

// 【重构】使用窗口管理器
let windowManager: any = null;

function createWindow() {
    const wm = createWindowManager(log);
    windowManager = wm;
    mainWindow = wm.createWindow(powerSaveManager);
    
    // 设置 IPC handlers
    setupIpcHandlers(
        () => mainWindow,
        scanState,
        powerSaveManager,
        previewWorkerManager
    );
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
    
    // 【新增】设置应用退出处理器（flush 日志）
    setupAppQuitHandler(() => windowManager?.getLogManager());

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
