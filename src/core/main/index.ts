/**
 * Main 模块统一导出
 * 
 * 职责：
 * - 提供简化的 API
 * - 导出主要功能
 */

export {initializeApp, getAppLogger, setupAppQuitHandler} from './app-initializer';
export {createWindowManager, WindowManager} from './window-manager';
export {createPowerSaveManager, PowerSaveManager} from './power-save-manager';
export {createPreviewWorkerManager, PreviewWorkerManager} from './preview-worker-manager';
export {setupIpcHandlers} from './ipc-handlers';
export {getDirectorySize} from './utils';
