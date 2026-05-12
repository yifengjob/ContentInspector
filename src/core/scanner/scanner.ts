/**
 * 扫描器主入口 - 协调层
 *
 * 职责：
 * - 协调各个模块完成扫描任务
 * - 管理扫描生命周期
 * - 启动和取消扫描
 */

import * as fs from 'fs';
import * as path from 'path';
import {Worker} from 'worker_threads';
import {BrowserWindow} from 'electron';
import {ScanConfig} from '../../types';
import {ScanState} from '../state';
import {initializeScanner} from './scan-initializer';
import {WalkerHandler} from './scan-walker-handler';
import {StagnationDetector} from './scan-stagnation-detector';
import {ScanCleanup} from './scan-cleanup';
import {getScannerLogger} from "../../logger/logger";
import {WALKER_WORKER_PATH} from "../../workers/walker-worker";

export async function startScan(
    config: ScanConfig,
    mainWindow: BrowserWindow,
    scanState?: ScanState  // 【优化】可选参数，默认使用单例
): Promise<void> {
    // 【优化】如果没有传入 scanState，则使用单例
    const state = scanState || ScanState.getInstance();
    
    if (state.isScanning) {
        throw new Error('扫描正在进行中');
    }

    state.isScanning = true;
    state.cancelFlag = false;
    state.logs = [];
    
    // 【重构】重置扫描状态管理器
    state.reset();

    const log = getScannerLogger();

    log.info('开始扫描...');
    log.info(`扫描路径数: ${config.selectedPaths.length}`);
    log.info(`文件类型数: ${config.selectedExtensions.length}`);
    log.info(`选中的扩展名: ${config.selectedExtensions.join(', ')}`);
    log.info(`敏感检测类型: ${config.enabledSensitiveTypes.join(', ')}`);
    log.info('---');

    // ==================== 【初始化模块】====================
    const context = await initializeScanner(config, mainWindow, state);

    // ==================== 【Walker Worker】====================
    // 【优化】使用统一的常量路径，便于维护和 IDE 跟踪
    const walkerWorker = new Worker(WALKER_WORKER_PATH);

    // Walker 完成计数
    const walkerCompletedCountRef = {value: 0};
    const totalPathsCount = config.selectedPaths.length;  // 总路径数
    const actualWalkerTasksRef = {value: 0};  // 【修复】使用引用传递，动态更新

    // 检查并完成扫描
    function checkAndComplete(): void {
        if (state.cancelFlag) {
            performCleanup();
            return;
        }

        const allWalkersCompleted = walkerCompletedCountRef.value >= actualWalkerTasksRef.value;

        // 【重构】使用 state.isScanComplete 统一完成条件判断
        if (state.isScanComplete(allWalkersCompleted)) {
            log.info(`扫描完成: 遍历 ${state.getWalkerTotalCount()} 个文件, 处理 ${state.getConsumerProcessedCount()} 个, 跳过 ${state.getWalkerSkippedCount()} 个, 发现 ${state.getResultCount()} 个敏感文件`);
            performCleanup();
            return;
        }
    }

    // 【关键】设置 WorkerPool 的 onCheckAndComplete 回调
    context.workerPool.updateCallback('onCheckAndComplete', checkAndComplete);

    // 创建 Walker Handler
    const walkerHandler = new WalkerHandler(walkerWorker, {
        state,
        context,
        walkerCompletedCountRef,
        totalWalkerTasks: actualWalkerTasksRef.value,  // 【修复】使用引用值
        onCheckAndComplete: checkAndComplete
    });

    // 设置消息监听器
    walkerHandler.setupMessageListener();

    // 创建停滞检测器
    const stagnationDetector = new StagnationDetector({
        state,
        workerPool: context.workerPool,
        log,
        getLastTaskEnqueueTime: () => walkerHandler.getLastTaskEnqueueTime(),
        onStagnationDetected: performCleanup
    });

    // 启动停滞检测
    stagnationDetector.start();

    // 执行清理
    function performCleanup(): void {
        const cleanup = new ScanCleanup({
            state,
            mainWindow,
            workerPool: context.workerPool,
            queueManager: context.queueManager,
            eventBus: context.eventBus,
            scheduler: context.scheduler,  // 【新增】传递调度器
            resultLogThrottler: context.resultLogThrottler,
            log,
            walkerWorker,
            stagnationDetector // 传递停滞检测器
        });
        cleanup.cleanup();
    }

    // ==================== 【启动扫描】====================

    // 【关键修复】创建取消函数并保存到局部变量（避免使用 any 类型断言）
    // 将取消函数挂载到 ScanState，供外部 cancelScan() 调用
    (state as any)._cancelScan = () => {
        if (state.cancelFlag) {
            log.info('[取消扫描] 已经在取消过程中，忽略重复请求');
            return;
        }

        log.info('[取消扫描] 收到取消请求，正在停止扫描...');
        state.cancelFlag = true;

        // 停止停滞检测器
        stagnationDetector.stop();

        // 立即清理资源，停止所有 Worker
        log.info('[取消扫描] 开始调用 cleanup...');
        performCleanup();
        log.info('[取消扫描] cleanup 调用完成');
    };

    const totalPaths = config.selectedPaths.length;
    let currentPathIndex = 0;

    for (const rootPath of config.selectedPaths) {
        currentPathIndex++;

        if (state.cancelFlag) {
            log.info('扫描已取消');
            break;
        }

        // 【关键修复】使用异步文件操作，防止阻塞主线程
        try {
            const stat = await fs.promises.stat(rootPath);
            if (stat.isFile()) {
                const basename = path.basename(rootPath);
                if (config.ignoreDirNames.includes(basename)) {
                    log.info(`跳过忽略的文件: ${rootPath}`);
                    continue;
                }
            }
        } catch (error: any) {
            log.info(`无法访问路径: ${rootPath} - ${error.message}`);
            continue;
        }

        log.info(`正在扫描: ${rootPath} (${currentPathIndex}/${totalPaths})`);

        // 【关键修复】使用异步检查，防止阻塞主线程
        try {
            await fs.promises.access(rootPath, fs.constants.F_OK);
        } catch (error: any) {
            log.info(`路径不存在或无权限: ${rootPath}`);
            continue;
        }

        // 【修复】只有成功发送的任务才计入总数
        actualWalkerTasksRef.value++;

        walkerWorker.postMessage({
            type: 'start-walking',
            config: {
                rootPath,
                selectedExtensions: config.selectedExtensions,
                ignoreDirNames: config.ignoreDirNames,
                systemDirs: config.systemDirs,
                maxFileSizeMb: config.maxFileSizeMb,
                maxPdfSizeMb: config.maxPdfSizeMb
            }
        });
    }
    
    // 【修复】输出实际发送的任务数
    log.info(`[Walker] 实际发送任务数: ${actualWalkerTasksRef.value}/${totalPathsCount}`);
    
    // 【关键修复】更新 WalkerHandler 中的 totalWalkerTasks
    walkerHandler.updateTotalTasks(actualWalkerTasksRef.value);
}

export function cancelScan(scanState?: ScanState): void {
    const state = scanState || ScanState.getInstance();
    
    // 【关键修复】调用内部挂载的取消函数
    if ((state as any)._cancelScan) {
        (state as any)._cancelScan();
    } else {
        // 后备方案：仅设置标志（适用于未通过 startScan 启动的情况）
        // 注意：正常情况下不应该走到这里，因为 _cancelScan 应该在 startScan 中挂载
        state.cancelFlag = true;
    }
}
