/**
 * 文件解析 Worker 线程
 * 负责在后台线程中执行 CPU 密集型的文件解析和敏感数据检测
 */

// 【关键】首先导入日志抑制工具（必须在任何其他导入之前）
import '../utils/log-utils';

// 【新增】拦截 stderr，抑制 PDF 字体警告（防止前端卡死）
const originalStderrWrite = process.stderr.write;
process.stderr.write = function(chunk: any, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void): boolean {
    const str = chunk.toString();
    // 过滤 PDF.js 的所有警告（包括字体、CMap、canvas 等）
    if (str.includes('Warning:') && 
        (str.includes('fetchStandardFontData') || 
         str.includes('loadFont - translateFont failed') ||
         str.includes('CMap') ||
         str.includes('baseUrl') ||
         str.includes('Path2D') ||
         str.includes('canvas.node') ||
         str.includes('TT: undefined') ||
         str.includes('TT: invalid') ||
         str.includes('Indexing all PDF objects') ||
         str.includes('Ran out of space in font'))) {
        return true;  // 抑制输出
    }
    return originalStderrWrite.call(process.stderr, chunk, encoding as any, cb);
};

// 【新增】设置环境变量抑制 pdfjs-dist 警告（Worker 进程中也需要）
process.env.PDFJS_DISABLE_WARNINGS = '1';
process.env.NODE_NO_WARNINGS = '1';

// 【修复】初始化 PDF.js 所需的 polyfill
import { setupAllPdfPolyfills } from '../utils/pdf-polyfills';
setupAllPdfPolyfills();

import { parentPort, threadId } from 'worker_threads';

import { extractTextFromFile } from '../extractors';
// 【新增】导入流式处理器
import { FileStreamProcessor } from '../utils/file-stream-processor';
// 【新增】导入文件类型配置
import { 
  getFileTypeConfig, 
  FileProcessorType
} from '../utils/file-types';
// 【优化】导入配置常量和智能超时计算函数
import {calculateWorkerTimeout} from '../core/scan-config';
import {workerLogger} from "../logger/logger";

interface WorkerTask {
  taskId: number;
  filePath: string;
  enabledSensitiveTypes: string[];
  previewMode?: boolean; // 预览模式：只提取文本，不检测敏感数据
  config?: {
    maxFileSizeMb?: number;
    maxPdfSizeMb?: number;
    enabledSensitiveTypes?: string[];
  };
}

interface WorkerResult {
  taskId: number;
  filePath: string;
  text?: string; // 预览模式下返回文本内容
  fileSize?: number;
  modifiedTime?: string;
  counts?: Record<string, number>;
  total?: number;
  unsupportedPreview?: boolean;
  error?: string;
}

// 【新增】添加全局错误处理器，防止 Worker 因未捕获异常而崩溃
process.on('unhandledRejection', (reason, _promise) => {
  if (process.env.NODE_ENV === 'development') {
    workerLogger.error(`[Worker TID:${threadId}] 未处理的 Promise Rejection:`, reason);
  }
});

process.on('uncaughtException', (error) => {
  if (process.env.NODE_ENV === 'development') {
    workerLogger.error(`[Worker TID:${threadId}] 未捕获的异常:`, error.message);
  }
  // 【关键】即使发生未捕获异常，也要通知主进程，而不是直接退出
  parentPort?.postMessage({
    taskId: -1,
    filePath: 'unknown',
    error: `Worker 内部错误: ${error.message}`
  } as WorkerResult);
});

// 监听主线程传来的任务
parentPort?.on('message', async (task: WorkerTask) => {
  const { taskId, filePath, enabledSensitiveTypes, previewMode = false } = task;
  
  // 【优化】设置超时保护（使用配置常量）
  let timeoutId: NodeJS.Timeout | null = null;
  
  try {
    // 【优化】获取文件统计信息（添加错误处理）
    const fs = require('fs');
    let stat: any;
    try {
      stat = fs.statSync(filePath);
    } catch (statError: any) {
      if (process.env.NODE_ENV === 'development') {
        workerLogger.error(`[Worker TID:${threadId}] 无法读取文件状态: ${filePath}`, statError.message);
      }
      parentPort?.postMessage({
        taskId,
        filePath,
        error: `无法访问文件: ${statError.message}`
      } as WorkerResult);
      return;
    }
    
    // 【D2 优化】根据文件大小智能计算超时时间
    const timeoutMs = calculateWorkerTimeout(stat.size);
    
    // 创建超时 Promise
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`处理超时 (${Math.floor(timeoutMs / 1000)}秒)`));
      }, timeoutMs);
    });
    
    // 【智能路由】获取文件类型配置
    const config = getFileTypeConfig(filePath);
    
    if (!config) {
      // 未知文件类型
      if (timeoutId) clearTimeout(timeoutId);
      parentPort?.postMessage({
        taskId,
        filePath,
        error: `不支持的文件类型`
      } as WorkerResult);
      return;
    }
    
    // 检查是否支持预览
    if (config.processor === FileProcessorType.BINARY_SCAN) {
      if (timeoutId) clearTimeout(timeoutId);
      parentPort?.postMessage({
        taskId,
        filePath,
        text: '',
        unsupportedPreview: true
      } as WorkerResult);
      return;
    }
    
    // 【优化】Walker 阶段已过滤文件大小，此处无需重复检查
    // 创建流式处理器（使用默认限制作为安全兜底）
    const processor = new FileStreamProcessor();
    
    try {
      // 【重构】提取公共回调函数，消除重复代码
      const createCallbacks = () => ({
        onChunk: (chunkData: any) => {
          if (previewMode) {
            parentPort?.postMessage({
              type: 'chunk',
              chunkIndex: chunkData.chunkIndex,
              lines: chunkData.lines,
              highlights: chunkData.highlights,
              startLine: chunkData.startLine
            });
          }
        },
        
        onComplete: (stats: any) => {
          if (previewMode) {
            parentPort?.postMessage({
              type: 'complete',
              totalChunks: stats.totalChunks
            });
          } else {
            // 返回累计的检测结果
            parentPort?.postMessage({
              taskId,
              filePath,
              fileSize: stat.size,
              modifiedTime: stat.mtime.toISOString(),
              counts: processor.getAccumulatedCounts(),
              total: processor.getTotalCount(),
              unsupportedPreview: false
            } as WorkerResult);
          }
        },
        
        onError: (error: Error) => {
          parentPort?.postMessage({
            taskId,
            filePath,
            error: error.message
          } as WorkerResult);
        }
      });
      
      // 【关键决策】根据 supportsStreaming 选择处理路径
      if (config.supportsStreaming) {
        // ✅ 路径A: 真正的流式处理 (txt/log/csv等)
        await Promise.race([
          processor.processFile(filePath, {
            mode: previewMode ? 'preview' : 'detect',
            enabledTypes: enabledSensitiveTypes,
            ...createCallbacks()
          }),
          timeoutPromise
        ]);
        
      } else {
        // ❌ 路径B: 先解析,再流式发送 (docx/xlsx/pdf等)
        const extractPromise = extractTextFromFile(filePath);
        const { text, unsupportedPreview } = await Promise.race([
          extractPromise,
          timeoutPromise
        ]) as { text: string; unsupportedPreview: boolean };
        
        // 清除超时
        if (timeoutId) clearTimeout(timeoutId);
        
        if (unsupportedPreview || !text) {
          parentPort?.postMessage({
            taskId,
            filePath,
            text: '',
            unsupportedPreview: true
          } as WorkerResult);
          return;
        }
        
        // 对提取后的文本进行流式分块
        await processor.processFile('', {
          mode: previewMode ? 'preview' : 'detect',
          enabledTypes: enabledSensitiveTypes,
          ...createCallbacks()
        }, text); // 传入预提取的文本
      }
    } finally {
      // 【修复】确保无论成功还是失败，都清理资源
      processor.destroy();
    }
    
  } catch (error: any) {
    // 清除超时
    if (timeoutId) clearTimeout(timeoutId);
    
    // 【优化】仅开发环境记录详细错误
    if (process.env.NODE_ENV === 'development') {
      workerLogger.error(`[Worker TID:${threadId}] 任务失败:`, error.message);
    }
    
    // 发生错误，返回错误信息
    parentPort?.postMessage({
      taskId,
      filePath,
      error: error.message
    } as WorkerResult);
  }
});

// 通知主线程 Worker 已就绪
parentPort?.postMessage({ type: 'ready' });
