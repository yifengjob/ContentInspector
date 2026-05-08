/**
 * 统一日志工具
 *
 * 提供结构化的日志记录功能，支持：
 * - 多级别日志（DEBUG/INFO/WARN/ERROR）
 * - 日志文件输出
 * - 前端 IPC 通信
 * - 内存缓冲区（环形队列）
 * - 日志抑制（过滤无关警告）
 */

import * as fs from 'fs';
import * as path from 'path';
import {LogLevel} from './types';

// 【配置】日志保留天数
const LOG_RETENTION_DAYS = 30;

// 【配置】内存中最大日志条数
const MAX_LOG_ENTRIES = 1000;

// 【配置】日志更新频率限制（毫秒）
const LOG_UPDATE_INTERVAL = 1000;

/**
 * 日志记录器接口（提供便捷的日志方法，支持可变参数和占位符）
 */
export interface Logger {
    (...args: any[]): void;              // 默认调用方式，支持可变参数
    debug(...args: any[]): void;         // log.debug()
    info(...args: any[]): void;          // log.info()
    warn(...args: any[]): void;          // log.warn()
    error(...args: any[]): void;         // log.error()
    destroy?: () => void;                // 【新增】销毁方法，清理资源
}

/**
 * 日志配置
 */
interface LogConfig {
    context: string;              // 日志上下文（模块名）
    enableFile?: boolean;         // 是否写入文件
    enableFrontend?: boolean;     // 是否发送到前端
    enableMemory?: boolean;       // 是否保存到内存
}

// 【新增】全局日志流引用（用于应用退出时 flush）
let globalLogStream: fs.WriteStream | null = null;

/**
 * 设置日志文件（重定向 console 输出）
 *
 * 应该在应用启动时立即调用
 *
 * @param logDir - 日志目录路径（由调用方提供，例如：app.getPath('userData') + '/logs'）
 */
export function setupFileLogger(logDir: string): void {
    // 创建日志目录
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, {recursive: true});
    }

    // 清理旧日志文件
    cleanupOldLogs(logDir);

    // 生成日志文件名（使用北京时间）
    const now = new Date();
    const beijingTimeStr = now.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const timeStr = beijingTimeStr
        .replace(/\//g, '-')
        .replace(/ /g, 'T')
        .replace(/:/g, '-');

    const logFile = path.join(logDir, `app-${timeStr}.log`);
    const logStream = fs.createWriteStream(logFile, {flags: 'a'});
    
    // 【新增】保存全局引用，用于应用退出时 flush
    globalLogStream = logStream;

    console.log(`日志文件已创建: ${logFile}`);

    // 保存原始的 console 方法
    const originalLog = console.log;
    const originalError = console.error;
    const originalDebug = console.debug;
    const originalWarn = console.warn;

    // 重定向 console.log（带日志抑制）
    console.log = function (...args) {
        const message = args.join(' ');
        
        // 【改进】统一日志抑制逻辑
        if (shouldSuppressLog(message)) {
            return; // 静默丢弃
        }
        
        const timestamp = getBeijingTimestamp();
        const logMessage = `[${timestamp}] [INFO] ${formatLogMessage(args)}\n`;
        logStream.write(logMessage, (err) => {
            if (err) {
                // 【改进】使用 process.stderr 避免递归日志
                process.stderr.write(`[日志写入失败] ${err.message}\n`);
            }
        });
        originalLog.apply(console, args);
    };
    // 重定向 console.debug（带日志抑制）
    console.debug = function (...args) {
        const message = args.join(' ');
        
        // 【改进】统一日志抑制逻辑
        if (shouldSuppressLog(message)) {
            return; // 静默丢弃
        }
        
        const timestamp = getBeijingTimestamp();
        const debugMessage = `[${timestamp}] [DEBUG] ${formatLogMessage(args)}\n`;
        logStream.write(debugMessage, (err) => {
            if (err) {
                // 【改进】使用 process.stderr 避免递归日志
                process.stderr.write(`[日志写入失败] ${err.message}\n`);
            }
        });
        originalDebug.apply(console, args);
    };

    // 重定向 console.error（带日志抑制）
    console.error = function (...args) {
        const message = args.join(' ');
        
        // 【改进】统一日志抑制逻辑
        if (shouldSuppressLog(message)) {
            return; // 静默丢弃
        }
        
        const timestamp = getBeijingTimestamp();
        const errorMessage = `[${timestamp}] [ERROR] ${formatLogMessage(args)}\n`;
        logStream.write(errorMessage, (err) => {
            if (err) {
                // 【改进】使用 process.stderr 避免递归日志
                process.stderr.write(`[日志写入失败] ${err.message}\n`);
            }
        });
        originalError.apply(console, args);
    };

    // 重定向 console.warn（带日志抑制）
    console.warn = function (...args) {
        const message = args.join(' ');

        // 检查是否需要抑制
        if (shouldSuppressLog(message)) {
            return; // 静默丢弃
        }

        const timestamp = getBeijingTimestamp();
        const warnMessage = `[${timestamp}] [WARN] ${formatLogMessage(args)}\n`;
        logStream.write(warnMessage, (err) => {
            if (err) {
                // 【改进】使用 process.stderr 避免递归日志
                process.stderr.write(`[日志写入失败] ${err.message}\n`);
            }
        });
        originalWarn.apply(console, args);
    };
}

/**
 * 创建通用日志记录器
 *
 * 【适用场景】
 * - 应用启动、配置加载等低频日志
 * - Worker 线程日志（无 electron 依赖）
 * - 不需要前端实时显示的场景
 *
 * 【不适用场景】
 * - 扫描过程的高频日志 → 使用 scanner-helpers.ts 的 createScannerLogger
 * - 需要实时更新 UI 的场景 → 使用 createScannerLogger
 *
 * 【注意】这是通用日志记录器，适用于低频日志场景（应用启动、配置加载等）
 * 如果需要高频日志（如扫描过程），请使用 scanner-helpers.ts 中的 createScannerLogger
 * （提供环形缓冲区、前端 IPC 通信等高级优化）
 *
 * @param config 日志配置
 * @returns 日志记录器（可调用 + 便捷方法）
 */
export function createLogger(config: string | LogConfig): Logger {
    const context = typeof config === 'string' ? config : config.context;
    const enableFile = typeof config === 'object' ? (config.enableFile ?? true) : true;
    const enableFrontend = typeof config === 'object' ? (config.enableFrontend ?? false) : false;
    const enableMemory = typeof config === 'object' ? (config.enableMemory ?? false) : false;

    // 内存缓冲区（仅在需要时初始化）
    let logs: string[] | null = enableMemory ? [] : null;
    let lastUpdateTime = 0;

    // 【新增】统一的日志输出函数
    const logWithLevel = (formattedMsg: string, level: LogLevel) => {
        // 写入文件（根据级别使用不同的 console 函数）
        if (enableFile) {
            setImmediate(() => {
                switch (level) {
                    case LogLevel.ERROR:
                        console.error(formattedMsg);
                        break;
                    case LogLevel.WARN:
                        console.warn(formattedMsg);
                        break;
                    case LogLevel.DEBUG:
                        console.debug(formattedMsg);
                        break;
                    default:
                        console.log(formattedMsg);
                }
            });
        }

        // 发送到前端（通过 IPC）
        if (enableFrontend) {
            setImmediate(() => {
                // TODO: 需要通过全局变量或依赖注入获取 mainWindow
                // if (mainWindow && !mainWindow.isDestroyed()) {
                //   mainWindow.webContents.send('scan-log', formattedMsg);
                // }
            });
        }

        // 保存到内存
        if (enableMemory && logs) {
            logs.push(formattedMsg);

            // 限制内存中的日志数量
            if (logs.length > MAX_LOG_ENTRIES) {
                logs.shift();
            }

            // 限制更新频率
            const now = Date.now();
            if (now - lastUpdateTime >= LOG_UPDATE_INTERVAL) {
                // TODO: 更新到全局状态
                lastUpdateTime = now;
            }
        }
    };

    // 【重构】提取公共日志格式化逻辑，避免代码重复
    const formatLogEntry = (args: any[], level: LogLevel): string => {
        const message = formatLogMessage(args);
        const timestamp = getBeijingTimestamp();
        const levelPrefix = LogLevel[level];
        return `[${timestamp}] [${levelPrefix}] [${context}] ${message}`;
    };

    // 内部日志函数（支持可变参数和占位符）
    const logInternal = (...args: any[]) => {
        const formattedMsg = formatLogEntry(args, LogLevel.INFO);
        logWithLevel(formattedMsg, LogLevel.INFO);
    };

    // 创建带便捷方法的日志记录器（支持可变参数和占位符）
    const logger = logInternal as Logger;
    logger.debug = (...args: any[]) => {
        const formattedMsg = formatLogEntry(args, LogLevel.DEBUG);
        logWithLevel(formattedMsg, LogLevel.DEBUG);
    };
    logger.info = (...args: any[]) => {
        const formattedMsg = formatLogEntry(args, LogLevel.INFO);
        logWithLevel(formattedMsg, LogLevel.INFO);
    };
    logger.warn = (...args: any[]) => {
        const formattedMsg = formatLogEntry(args, LogLevel.WARN);
        logWithLevel(formattedMsg, LogLevel.WARN);
    };
    logger.error = (...args: any[]) => {
        const formattedMsg = formatLogEntry(args, LogLevel.ERROR);
        logWithLevel(formattedMsg, LogLevel.ERROR);
    };

    return logger;
}

/**
 * 获取北京时间的时间戳字符串
 *
 * 【公共工具函数】可被其他模块复用
 */
export function getBeijingTimestamp(): string {
    return new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Shanghai'
    });
}

/**
 * 格式化日志消息（支持占位符）
 *
 * 【支持两种模式】
 * 1. 占位符模式：'用户{}登录', username → '用户admin登录'
 * 2. 拼接模式：'日志:', msg → '日志: message'（向后兼容）
 *
 * @param args - 日志参数数组，第一个元素为模板字符串
 * @returns 格式化后的日志消息
 *
 * @example
 * // 占位符模式
 * formatLogMessage(['用户{}登录', 'admin']) // '用户admin登录'
 * formatLogMessage(['用户{}年龄{}', '张三', 25]) // '用户张三年龄25'
 *
 * // 拼接模式（向后兼容）
 * formatLogMessage(['日志:', 'message']) // '日志: message'
 *
 * // 对象参数
 * formatLogMessage(['数据{}', {name: 'test'}]) // '数据{"name":"test"}'
 */
export function formatLogMessage(args: any[]): string {
    if (args.length === 0) return '';

    const template = String(args[0]);
    const params = args.slice(1);

    // 检查是否有占位符
    const placeholderCount = (template.match(/\{}/g) || []).length;

    if (placeholderCount > 0 && params.length > 0) {
        // 使用占位符模式
        let argIndex = 0;
        const formatted = template.replace(/\{}/g, () => {
            if (argIndex >= params.length) {
                return '{}';
            }
            const arg = params[argIndex++];
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        });

        // 如果还有多余参数，追加到末尾
        if (argIndex < params.length) {
            const remaining = params.slice(argIndex);
            return formatted + ' ' + remaining.map(a =>
                typeof a === 'object' ? JSON.stringify(a) : String(a)
            ).join(' ');
        }

        return formatted;
    } else {
        // 无占位符，使用原有逻辑（空格连接）
        return args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    }
}

/**
 * 检查是否需要抑制日志
 */
function shouldSuppressLog(message: string): boolean {
    const SUPPRESS_PATTERNS = [
        // pdfjs-dist 的字体警告
        'Warning: TT: undefined function',
        'Warning: TT: invalid offset',
        'Warning: Indexing all PDF objects',
        'Warning: Ran out of space in font private use area',
        'Warning: TT: undefined subroutine',
        'Warning: TT: invalid glyph index',
        'Warning: Required "glyf" table is not found -- trying to recover.',
        'Warning: fetchStandardFontData: failed to fetch file',
        'Warning: loadFont - translateFont failed:',

        // canvas 模块缺失警告
        'Cannot polyfill `Path2D`',
        'Cannot find module',
        'canvas.node',
    ];

    return SUPPRESS_PATTERNS.some(pattern => message.includes(pattern));
}

/**
 * 清理旧日志文件
 */
function cleanupOldLogs(logDir: string): void {
    try {
        const files = fs.readdirSync(logDir);
        const now = Date.now();
        const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

        for (const file of files) {
            if (!file.startsWith('app-') || !file.endsWith('.log')) {
                continue;
            }

            const filePath = path.join(logDir, file);
            const stats = fs.statSync(filePath);
            const age = now - stats.mtimeMs;

            if (age > retentionMs) {
                fs.unlinkSync(filePath);
                console.log(`已删除旧日志文件: ${file}`);
            }
        }
    } catch (error) {
        console.error('清理旧日志文件失败:', error);
    }
}

/**
 * 【新增】flush 日志流，确保所有日志写入磁盘
 * 应该在应用退出前调用
 */
export function flushLogStream(): Promise<void> {
    return new Promise((resolve) => {
        if (!globalLogStream) {
            resolve();
            return;
        }
        
        // 等待所有写入操作完成
        globalLogStream.end(() => {
            resolve();
        });
    });
}

// 【导出】预创建的常用日志实例
export const logger = createLogger('General');
export const fileLogger = createLogger('File');
export const mainLogger = createLogger('Main');
export const workerLogger = createLogger('Worker');
export const extractorLogger = createLogger('Extractor');
