/**
 * Walker Worker - 专门的目录遍历线程（生产者）
 * 负责遍历目录树，将符合条件的文件发送到主线程
 */
import {parentPort} from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
// 【修复】从 file-type-utils 导入 getSupportedExtensions 函数
import {getSupportedExtensions} from '../utils/file-type-utils';
// 【关键】导入 extractors 模块以触发自动注册
// 注意：Worker 线程有独立的内存空间，需要单独初始化注册中心
// 这不是单例模式的失败，而是 Worker 线程架构的正常行为
import '../extractors';
// 【调试】输出注册完成状态
import {getRegistryStats} from '../extractors/registry';
const stats = getRegistryStats();
workerLogger.info(`[Walker Worker] 注册中心初始化完成: ${stats.totalExtensions} 个扩展名, ${stats.totalConfigs} 个配置`);
// 【优化】导入配置常量
import {BYTES_TO_MB} from '../core/config/constants';
import {workerLogger} from "../logger/logger";

// 动态导入 walkdir（避免顶层 import 导致的问题）
let walkdir: any;

interface WalkerConfig {
    rootPath: string;
    selectedExtensions: string[];
    ignoreDirNames: string[];
    systemDirs: string[];
    maxFileSizeMb: number;
    maxPdfSizeMb: number;
}

/**
 * 检查是否应该忽略目录
 */
function shouldIgnoreDirectory(dirName: string, dirPath: string, config: WalkerConfig): boolean {
    // 检查是否在忽略目录名列表中
    if (config.ignoreDirNames.includes(dirName)) {
        return true;
    }

    // 检查是否是系统目录
    const normalizedDirPath = path.normalize(dirPath).toLowerCase();
    return config.systemDirs.some(sysDir => {
        const normalizedSysDir = path.normalize(sysDir).toLowerCase();
        return normalizedDirPath === normalizedSysDir ||
            normalizedDirPath.startsWith(normalizedSysDir + path.sep);
    });
}

/**
 * 初始化 walkdir
 */
async function initWalkdir() {
    if (!walkdir) {
        const module = await import('walkdir');
        walkdir = module.default || module;
    }
}

/**
 * 开始遍历
 */
async function startWalking(config: WalkerConfig) {
    let timeoutId: NodeJS.Timeout | undefined;

    // 【批量优化】批次缓冲区和批次大小
    const fileBatch: Array<{ filePath: string, stat: any }> = [];
    const BATCH_SIZE = 100;  // 每批 100 个文件

    /**
     * 发送批次文件（如果缓冲区已满）
     */
    function flushBatch() {
        if (fileBatch.length > 0) {
            parentPort?.postMessage({
                type: 'files-batch',
                files: [...fileBatch]  // 复制数组，避免引用问题
            });
            fileBatch.length = 0;  // 清空缓冲区
        }
    }

    try {
        await initWalkdir();

        const {rootPath, selectedExtensions, systemDirs, maxFileSizeMb, maxPdfSizeMb} = config;

        // 【修复】检查 rootPath 是文件还是目录
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(rootPath);
        } catch (error: any) {
            workerLogger.error(`[Walker] 无法访问路径: ${rootPath}`, error.message);
            parentPort?.postMessage({
                type: 'walking-error',
                error: `无法访问路径: ${rootPath}`
            });
            return;
        }

        // 如果是文件，直接处理该文件
        if (stat.isFile()) {
            const ext = path.extname(rootPath).toLowerCase().replace('.', '');

            // 检查扩展名
            let shouldProcess: boolean;
            let isFiltered = false;  // 【新增】是否被过滤
            let isSkipped = false;   // 【新增】是否被跳过

            if (selectedExtensions.includes('*')) {
                // 【修复】延迟获取支持的扩展名列表，确保注册已完成
                const supportedExts = getSupportedExtensions();
                shouldProcess = supportedExts.includes(ext);
            } else {
                shouldProcess = selectedExtensions.includes(ext);
            }

            // 扩展名不匹配视为过滤
            if (!shouldProcess) {
                isFiltered = true;
            }

            // 空文件视为过滤
            if (stat.size === 0) {
                isFiltered = true;
            }

            if (shouldProcess && stat.size > 0) {
                // 检查文件大小
                const maxSize = rootPath.toLowerCase().endsWith('.pdf')
                    ? maxPdfSizeMb * BYTES_TO_MB
                    : maxFileSizeMb * BYTES_TO_MB;

                if (stat.size <= maxSize) {
                    // 【批量优化】添加到批次缓冲区
                    fileBatch.push({
                        filePath: rootPath,
                        stat: {
                            size: stat.size,
                            mtime: stat.mtime.toISOString()
                        }
                    });
                    // 立即发送（只有一个文件）
                    flushBatch();
                } else {
                    // 文件过大视为跳过
                    isSkipped = true;
                }
            }

            // 发送完成信号
            parentPort?.postMessage({
                type: 'walking-complete',
                fileCount: !isFiltered && !isSkipped ? 1 : 0,
                filteredCount: isFiltered ? 1 : 0,  // 【新增】传递过滤计数
                skippedCount: isSkipped ? 1 : 0
            });
            return;
        }

        // 如果是目录，使用 walkdir 遍历
        if (!stat.isDirectory()) {
            parentPort?.postMessage({
                type: 'walking-error',
                error: `路径既不是文件也不是目录: ${rootPath}`
            });
            return;
        }

        // 【修复】将 walker 事件包装成 Promise
        return new Promise<void>((resolve, reject) => {
            // 预处理：构建快速查找的忽略目录集合
            const ignoredDirsNormalized = new Set<string>();
            systemDirs.forEach(dir => {
                ignoredDirsNormalized.add(path.normalize(dir).toLowerCase());
            });

            let fileCount = 0;
            let filteredCount = 0;  // 【新增】用户主动过滤的文件数
            let skippedCount = 0;   // 【修改】系统跳过的文件数

            // 【新增】去重集合，防止同一文件被多次报告
            const seenFiles = new Set<string>();

            // 【新增】超时保护 - 如果 60 秒内没有完成，强制 resolve（防止卡死）
            timeoutId = setTimeout(() => {  // ✅ 使用赋值而非重新声明
                // 【批量优化】发送剩余批次
                flushBatch();

                parentPort?.postMessage({
                    type: 'walking-complete',
                    fileCount,
                    filteredCount,  // 【新增】传递过滤计数
                    skippedCount
                });
                resolve();
            }, 60 * 1000); // 60 秒

            const walker = walkdir(rootPath, {
                follow_symlinks: false,
                no_recurse: false,
                filter: (directory: string, files: string[]) => {
                    const dirName = path.basename(directory);

                    // 【调试】输出过滤日志
                    if (shouldIgnoreDirectory(dirName, directory, config)) {
                        return [];
                    }

                    // 检查当前目录是否在系统目录的子目录下
                    const normalizedDir = path.normalize(directory).toLowerCase();
                    for (const sysDir of ignoredDirsNormalized) {
                        if (normalizedDir.startsWith(sysDir + path.sep) || normalizedDir === sysDir) {
                            return [];
                        }
                    }

                    return files;
                }
            });

            walker.on('path', (filePath: string, stat: any) => {
                // 【关键】跳过符号链接文件（包括文件和目录）
                if (stat.isSymbolicLink && stat.isSymbolicLink()) {
                    skippedCount++;
                    return;
                }

                // 只处理普通文件
                if (!stat.isFile()) return;

                // 检查扩展名
                const ext = path.extname(filePath).toLowerCase().replace('.', '');

                // 如果用户选择了 '*'，只扫描支持的文件类型
                if (selectedExtensions.includes('*')) {
                    // 【修复】延迟获取支持的扩展名列表，确保注册已完成
                    const supportedExts = getSupportedExtensions();
                    if (!supportedExts.includes(ext)) {
                        filteredCount++;  // 【修改】用户配置过滤
                        return;
                    }
                } else {
                    // 用户指定了具体类型，按指定类型过滤
                    if (!selectedExtensions.includes(ext)) {
                        filteredCount++;  // 【修改】用户配置过滤
                        return;
                    }
                }

                // 检查文件大小
                const fileSize = stat.size;

                // 跳过 0 字节文件
                if (fileSize === 0) {
                    filteredCount++;  // 【修改】空文件视为用户过滤
                    return;
                }

                const maxSize = filePath.toLowerCase().endsWith('.pdf')
                    ? maxPdfSizeMb * BYTES_TO_MB
                    : maxFileSizeMb * BYTES_TO_MB;

                if (fileSize > maxSize) {
                    skippedCount++;  // 【保持】文件过大属于系统跳过
                    return;
                }

                // 【新增】检查文件可读性和可打开性（Windows 专用）
                try {
                    fs.accessSync(filePath, fs.constants.R_OK);

                    // Windows 专用：尝试以只读方式打开文件，检测是否被锁定
                    if (process.platform === 'win32') {
                        const fd = fs.openSync(filePath, 'r');
                        fs.closeSync(fd);
                    }
                } catch (accessError: any) {
                    skippedCount++;  // 【保持】权限问题属于系统跳过
                    return;
                }

                // 【关键修复】先去重，再计数
                const realPath = path.resolve(filePath);
                if (seenFiles.has(realPath)) {
                    // 已处理过，跳过（不计入 fileCount）
                    return;
                }
                seenFiles.add(realPath);

                // 【批量优化】累积到批次缓冲区
                fileCount++;
                fileBatch.push({
                    filePath,
                    stat: {
                        size: stat.size,
                        mtime: stat.mtime.toISOString()
                    }
                });

                // 达到批次大小，发送一批
                if (fileBatch.length >= BATCH_SIZE) {
                    flushBatch();
                }
            });

            walker.on('end', () => {
                clearTimeout(timeoutId); // 【新增】清除超时定时器

                // 【批量优化】发送剩余不足批次的文件
                flushBatch();

                parentPort?.postMessage({
                    type: 'walking-complete',
                    fileCount,
                    filteredCount,  // 【新增】传递过滤计数
                    skippedCount
                });
                resolve(); // 【修复】Promise resolve
            });

            walker.on('error', (err: any) => {
                clearTimeout(timeoutId); // 【新增】清除超时定时器
                parentPort?.postMessage({
                    type: 'walking-error',
                    error: err.message
                });
                reject(err); // 【修复】Promise reject
            });

        }); // 【修复】关闭 Promise

    } catch (error: any) {
        // 【P2修复】在异常路径也清除超时定时器
        if (typeof timeoutId !== 'undefined') {
            clearTimeout(timeoutId);
        }

        parentPort?.postMessage({
            type: 'walking-error',
            error: error.message
        });
        throw error; // 【修复】重新抛出错误
    }
}

// 监听主线程消息
let isWalking = false; // 【修复】标记是否正在遍历
const taskQueue: any[] = []; // 【修复】任务队列

// 【修复】迭代处理下一个任务，避免递归导致的栈溢出
async function processNextTask() {
    while (taskQueue.length > 0 || isWalking) {
        if (taskQueue.length === 0) {
            // 队列为空，等待新任务
            return;
        }

        const config = taskQueue.shift();

        try {
            await startWalking(config);

            // 遍历完成
            isWalking = false;
        } catch (error: any) {
            parentPort?.postMessage({
                type: 'walking-error',
                error: error.message || String(error)
            });
            isWalking = false;
        }
    }
}

parentPort?.on('message', (message: any) => {
    if (message.type === 'start-walking') {
        // 【修复】如果正在遍历，将任务加入队列
        if (isWalking) {
            taskQueue.push(message.config);
            return;
        }

        // 开始遍历第一个任务
        isWalking = true;
        taskQueue.push(message.config); // 先加入队列
        void processNextTask(); // 启动迭代处理（忽略返回值）
    } else if (message.type === 'cancel-all') {
        // 【内存安全】清空所有待处理的任务
        taskQueue.length = 0;
        isWalking = false;
    }
});

// 发送就绪信号
parentPort?.postMessage({type: 'ready'});


export const WALKER_WORKER_PATH = __filename;