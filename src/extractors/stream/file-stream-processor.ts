/**
 * 流式文件处理器 - 使用滑动窗口重叠策略处理大文件
 * 
 * 核心优势：
 * 1. 内存可控：峰值内存 = CHUNK_SIZE + OVERLAP_SIZE（约 5MB）
 * 2. 无漏检：通过重叠区保证跨边界敏感词不被遗漏
 * 3. 统一接口：检测和预览复用同一处理方法
 */

import { createReadStream } from 'fs';
import {
  SLIDING_WINDOW_CHUNK_SIZE_MB,
  SLIDING_WINDOW_OVERLAP_SIZE,
  BYTES_TO_MB
} from '../../core/config/constants';
import { getHighlights, evaluateCustomExpressionOnly } from '../../detection/sensitive-detector';
import { mainLogger } from '../../logger/logger';
import type { HighlightRange } from '../../types';

/**
 * 敏感词检测结果
 */
export interface SensitiveResult {
  keyword: string;        // 匹配的敏感词
  position: number;       // 在当前块中的位置
  typeId: string;         // 类型 ID
  typeName: string;       // 类型名称
}

/**
 * 数据块信息
 */
export interface ChunkData {
  chunkIndex: number;           // 块索引 (从0开始)
  text: string;                 // 块的文本内容
  lines: string[];              // 按行分割
  highlights: HighlightRange[]; // 敏感词高亮
  startLine?: number;           // 起始行号
  byteOffset: number;           // 字节偏移量
}

/**
 * 处理统计信息
 */
export interface ProcessingStats {
  totalChunks: number;      // 总块数
  totalBytes: number;       // 总字节数
  totalLines?: number;      // 总行数 (可选)
}

/**
 * 流式处理器选项
 */
export interface StreamProcessorOptions {
  mode: 'detect' | 'preview';           // 处理模式
  enabledTypes: string[];               // 启用的敏感词类型
  customExpression?: string;            // 自定义敏感词逻辑表达式
  
  // 回调函数
  onChunk?: (chunkData: ChunkData) => void;           // 每块就绪回调
  onComplete?: (stats: ProcessingStats) => void;      // 完成回调
  onError?: (error: Error) => void;                   // 错误回调
}

/**
 * 流式文件处理器
 */
export class FileStreamProcessor {
  private readonly chunkSize: number;     // 分块大小（字节）
  private readonly overlapSize: number;   // 重叠区大小（字符）
  
  // 状态变量
  private buffer: string = '';            // 累积缓冲区
  private previousOverlap: string = '';   // 上一块的重叠尾部
  private totalProcessed: number = 0;     // 已处理的总字节数
  private totalChars: number = 0;         // 【新增】已处理的总字符数（用于高亮偏移）
  private chunkIndex: number = 0;         // 当前块索引
  private globalLineOffset: number = 0;   // 全局行偏移
  
  // 扫描模式：累加计数
  private accumulatedCounts: Record<string, number> = {};
  private totalCount: number = 0;
  
  // 【新增】自定义表达式：记录关键词出现状态
  private keywordFoundFlags: Record<string, boolean> = {};
  private hasEvaluatedExpression: boolean = false;

  constructor() {
    this.chunkSize = SLIDING_WINDOW_CHUNK_SIZE_MB * BYTES_TO_MB;
    this.overlapSize = SLIDING_WINDOW_OVERLAP_SIZE;
    // 【优化】Walker 阶段已过滤文件大小，此处无需维护 maxFileSize
  }

  /**
   * 主入口: 流式处理文件
   * 
   * @param filePath - 文件路径 (路径A需要,路径B可为空)
   * @param options - 处理选项
   * @param preExtractedText - 预提取的文本 (路径B使用)
   */
  async processFile(
    filePath: string,
    options: StreamProcessorOptions,
    preExtractedText?: string
  ): Promise<void> {
    if (preExtractedText) {
      // 路径B: 处理已提取的文本 (docx/xlsx/pdf)
      await this.processExtractedText(preExtractedText, options);
    } else {
      // 路径A: 直接流式读取原始文件 (txt/log/csv)
      await this.processRawFile(filePath, options);
    }
  }

  /**
   * 路径A: 直接流式读取原始文件
   */
  private async processRawFile(
    filePath: string,
    options: StreamProcessorOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, {
        encoding: 'utf-8',
        highWaterMark: 64 * 1024  // 64KB 缓冲区
      });

      let isResolved = false;

      stream.on('data', (chunk: string | Buffer) => {
        if (isResolved) return;

        const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        this.buffer += chunkStr;
        this.totalProcessed += Buffer.byteLength(chunkStr, 'utf-8');

        // 【修复】文件大小检查已移至 file-worker.ts 前置检查，此处不再重复检查
        // 当缓冲区达到阈值时处理
        if (this.buffer.length >= this.chunkSize) {
          this.processBufferChunk(options);
        }
      });

      stream.on('end', () => {
        if (isResolved) return;

        // 处理剩余的缓冲区
        if (this.buffer.length > 0) {
          this.processBufferChunk(options);
        }
        
        // 【新增】在文件结束时评估自定义表达式
        this.evaluateCustomExpressionAtEnd(options.customExpression);

        // 发送完成消息
        options.onComplete?.({
          totalChunks: this.chunkIndex,
          totalBytes: this.totalProcessed,
          totalLines: this.globalLineOffset
        });

        resolve();
      });

      stream.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          options.onError?.(error);
          reject(error);
        }
      });
    });
  }

  /**
   * 路径B: 处理已提取的文本
   */
  private async processExtractedText(
    text: string,
    options: StreamProcessorOptions
  ): Promise<void> {
    // 【关键修复】边界检查，防止无限循环
    if (!text || text.length === 0) {
      options.onComplete?.({
        totalChunks: 0,
        totalBytes: 0,
        totalLines: 0
      });
      return;
    }
    
    // 【安全保护】限制最大迭代次数，防止无限循环
    const MAX_ITERATIONS = text.length + 100; // 最多迭代 text.length + 100 次
    let iterations = 0;
    
    const chunkSize = this.chunkSize;
    let offset = 0;

    while (offset < text.length) {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        console.error(`[FileStreamProcessor] 警告: processExtractedText 迭代次数过多 (${iterations}/${MAX_ITERATIONS})，强制退出`);
        break;
      }
      
      // 找到合适的分割点 (优先行边界)
      let splitPos = Math.min(offset + chunkSize, text.length);

      // 尝试在行边界分割
      if (splitPos < text.length) {
        const nextNewline = text.indexOf('\n', splitPos - 100);
        if (nextNewline !== -1 && nextNewline < splitPos + 100) {
          splitPos = nextNewline + 1;
        }
      }
      
      // 【安全检查】确保 splitPos > offset，否则强制推进
      if (splitPos <= offset) {
        splitPos = offset + 1;
      }

      const chunkText = text.slice(offset, splitPos);
      const lines = chunkText.split('\n');

      // 检测敏感词 (带重叠区)
      const fullChunk = this.previousOverlap + chunkText;
      const localHighlights = this.detectWithOverlap(fullChunk, options.enabledTypes, options.customExpression);
      
      // 【修复】将局部偏移转换为全局偏移（基于字符数）
      const charsBefore = this.totalChars;  // 当前块之前的总字符数
      const globalHighlights = localHighlights.map(h => ({
        ...h,
        start: h.start - this.previousOverlap.length + charsBefore,
        end: h.end - this.previousOverlap.length + charsBefore
      }));

      // 发送数据块
      options.onChunk?.({
        chunkIndex: this.chunkIndex,
        text: chunkText,
        lines,
        highlights: globalHighlights,
        startLine: this.globalLineOffset,
        byteOffset: offset
      });
      
      // 更新状态
      this.previousOverlap = fullChunk.slice(-this.overlapSize);
      this.globalLineOffset += lines.length;
      this.chunkIndex++;
      this.totalProcessed += Buffer.byteLength(chunkText, 'utf-8');
      this.totalChars += chunkText.length;  // 【新增】累加字符数

      offset = splitPos;
    }

    // 【新增】在文件结束时评估自定义表达式
    this.evaluateCustomExpressionAtEnd(options.customExpression);
    
    // 发送完成消息
    options.onComplete?.({
      totalChunks: this.chunkIndex,
      totalBytes: this.totalProcessed,
      totalLines: this.globalLineOffset
    });
  }

  /**
   * 处理缓冲区中的一个块
   */
  private processBufferChunk(options: StreamProcessorOptions): void {
    // 找到合适的分割点
    const splitPos = this.findSplitPoint(this.buffer, this.chunkSize);

    // 提取当前块
    const currentChunk = this.previousOverlap + this.buffer.slice(0, splitPos);

    // 检测敏感词
    const localHighlights = this.detectWithOverlap(currentChunk, options.enabledTypes, options.customExpression);
    
    // 【修复】将局部偏移转换为全局偏移（基于字符数）
    const charsBefore = this.totalChars;  // 当前块之前的总字符数
    const globalHighlights = localHighlights.map(h => ({
      ...h,
      start: h.start - this.previousOverlap.length + charsBefore,
      end: h.end - this.previousOverlap.length + charsBefore
    }));

    // 分割成行
    const chunkText = this.buffer.slice(0, splitPos);
    const lines = chunkText.split('\n');

    // 发送数据块
    options.onChunk?.({
      chunkIndex: this.chunkIndex,
      text: chunkText,
      lines,
      highlights: globalHighlights,
      startLine: this.globalLineOffset,
      byteOffset: this.totalProcessed - this.buffer.length
    });

    // 更新状态
    this.previousOverlap = currentChunk.slice(-this.overlapSize);
    this.globalLineOffset += lines.length;
    this.chunkIndex++;
    this.totalProcessed += splitPos;
    this.totalChars += chunkText.length;  // 【新增】累加字符数

    // 移除已处理的部分
    this.buffer = this.buffer.slice(splitPos);
  }

  /**
   * 查找合适的分割点 (优先行边界)
   */
  private findSplitPoint(buffer: string, targetPos: number): number {
    // 在目标位置附近寻找行边界
    const searchStart = Math.max(0, targetPos - 1000);
    const searchEnd = Math.min(buffer.length, targetPos + 100);

    // 优先找换行符 (向前搜索)
    for (let i = targetPos; i >= searchStart; i--) {
      if (buffer[i] === '\n') {
        return i + 1;
      }
    }

    // 如果找不到,向后找
    for (let i = targetPos; i < searchEnd; i++) {
      if (buffer[i] === '\n') {
        return i + 1;
      }
    }

    // 都没有,强制分割
    return targetPos;
  }

  /**
   * 带重叠区的敏感词检测
   */
  private detectWithOverlap(
    chunk: string,
    enabledTypes: string[],
    customExpression?: string
  ): HighlightRange[] {
    // 【优化】一次性获取内置规则的高亮
    const allHighlights = getHighlights(chunk, enabledTypes);

    // 过滤掉重叠区的重复结果
    const overlapLength = this.previousOverlap.length;
    const newHighlights = allHighlights.filter(h => h.start >= overlapLength);

    // 【扫描模式】累加计数（在一次调用中完成）
    if (enabledTypes.length > 0 || (customExpression && customExpression.trim())) {
      this.accumulateCounts(newHighlights, chunk, enabledTypes, customExpression);
    }

    return newHighlights;
  }

  /**
   * 累加敏感词计数 (扫描模式)
   * 
   * 【优化】在一次调用中完成内置规则和自定义表达式的计数，避免多次扫描文本
   */
  private accumulateCounts(
    highlights: HighlightRange[],
    chunkText: string,
    enabledTypes: string[],
    customExpression?: string
  ): void {
    // 1. 累加内置规则的计数（基于已有的高亮结果，无需再次扫描）
    for (const highlight of highlights) {
      this.accumulatedCounts[highlight.typeId] = 
        (this.accumulatedCounts[highlight.typeId] || 0) + 1;
      this.totalCount++;
    }
    
    // 2. 【新方案】记录自定义表达式中关键词的出现状态
    if (customExpression && customExpression.trim()) {
      // 提取表达式中的所有关键词
      const keywords = this.extractKeywordsFromExpression(customExpression);
      
      // 检查每个关键词是否在当前 chunk 中出现
      for (const keyword of keywords) {
        if (chunkText.includes(keyword)) {
          this.keywordFoundFlags[keyword] = true;
          mainLogger.debug('[流式处理] 发现关键词: "{}"', keyword);
        }
      }
    }
  }
  
  /**
   * 【新增】从表达式中提取所有关键词
   * 例如："信息安全 & 数据" -> ["信息安全", "数据"]
   */
  private extractKeywordsFromExpression(expression: string): string[] {
    // 移除逻辑运算符和括号
    const cleaned = expression
      .replace(/[&|!()]/g, ' ')  // 替换运算符为空格
      .trim();
    
    // 按空格分割，过滤空字符串
    return cleaned.split(/\s+/).filter(k => k.length > 0);
  }
  
  /**
   * 【新增】在文件处理结束时评估自定义表达式
   * 基于累积的关键词出现状态进行评估
   */
  private evaluateCustomExpressionAtEnd(customExpression?: string): void {
    if (!customExpression || !customExpression.trim() || this.hasEvaluatedExpression) {
      return;
    }
    
    try {
      // 构建上下文文本：包含所有出现过的关键词
      const foundKeywords = Object.keys(this.keywordFoundFlags)
        .filter(k => this.keywordFoundFlags[k])
        .join(' ');
      
      mainLogger.info('[流式处理] 📊 文件处理完成，评估自定义表达式');
      mainLogger.info('[流式处理] 表达式: "{}"', customExpression);
      mainLogger.info('[流式处理] 发现的关键词: {}', foundKeywords || '(无)');
      mainLogger.info('[流式处理] 关键词状态: {}', JSON.stringify(this.keywordFoundFlags));
      
      // 使用 evaluateCustomExpressionOnly 评估
      const isMatched = evaluateCustomExpressionOnly(foundKeywords, customExpression);
      
      mainLogger.info('[流式处理] 评估结果: {}', isMatched ? '✅ 匹配' : '❌ 不匹配');
      
      if (isMatched) {
        this.accumulatedCounts['custom_expression'] = 
          (this.accumulatedCounts['custom_expression'] || 0) + 1;
        // 【需求变更】自定义表达式不计入敏感信息总数，只记录有无
        // this.totalCount++;  // ← 已注释，不再累加到总数
        mainLogger.info('[流式处理] ✅ 自定义表达式匹配成功');
      }
      
      this.hasEvaluatedExpression = true;
    } catch (error: any) {
      mainLogger.error('[流式处理] 自定义表达式评估失败: {}', error.message);
    }
  }

  /**
   * 获取累计的计数 (扫描模式)
   */
  getAccumulatedCounts(): Record<string, number> {
    return { ...this.accumulatedCounts };
  }

  /**
   * 获取总计数 (扫描模式)
   */
  getTotalCount(): number {
    return this.totalCount;
  }

  /**
   * 重置状态 (用于复用处理器实例)
   */
  reset(): void {
    this.buffer = '';
    this.previousOverlap = '';
    this.totalProcessed = 0;
    this.totalChars = 0;  // 【新增】重置字符计数
    this.chunkIndex = 0;
    this.globalLineOffset = 0;
    this.accumulatedCounts = {};
    this.totalCount = 0;
    // 【新增】重置自定义表达式相关状态
    this.keywordFoundFlags = {};
    this.hasEvaluatedExpression = false;
  }

  /**
   * 【新增】销毁处理器，释放资源
   * 与 reset() 功能相同，语义更明确
   */
  destroy(): void {
    this.reset();
  }
}
