/**
 * 应用初始化模块
 * 
 * 职责：
 * - 日志系统初始化
 * - V8 GC 配置
 * - PDF polyfills 设置
 * - 全局错误处理
 */

import {app} from 'electron';
import * as path from 'path';
import {setupFileLogger, mainLogger, flushLogStream, Logger} from '../../logger/logger';
// 【关键】首先导入日志抑制工具（必须在任何其他导入之前）
import '../../utils/log-utils';
// 【修复】初始化 PDF.js 所需的 polyfill（包括 Promise.withResolvers、DOMMatrix、浏览器环境模拟）
import {setupAllPdfPolyfills} from '../../extractors/pdf/polyfills/pdf-polyfills';

let initialized = false;
let appLogger: Logger | null = null;

/**
 * 初始化应用
 * 
 * 必须在任何其他模块使用之前调用
 */
export function initializeApp(): void {
    if (initialized) {
        return;
    }

    // 设置日志文件
    const logDir = path.join(app.getPath('userData'), 'logs');
    setupFileLogger(logDir);
    appLogger = mainLogger;

    // 【新增】启用 V8 垃圾回收 API（用于扫描完成后释放内存）
    app.commandLine.appendSwitch('js-flags', '--expose-gc');

    // 【修复】初始化 PDF.js 所需的 polyfill（包括 Promise.withResolvers、DOMMatrix、浏览器环境模拟）
    setupAllPdfPolyfills();

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

    initialized = true;
}

/**
 * 监听应用即将退出，flush 日志确保完整性
 * 
 * 注意：这个函数应该在 app.whenReady() 之后调用
 */
export function setupAppQuitHandler(getLogManager: () => any): void {
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
        const logManager = getLogManager();
        if (logManager) {
            logManager.destroy();
        }
    });
}
