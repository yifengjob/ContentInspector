/**
 * 解析器抽象基类
 *
 * 职责：
 * - 定义统一的解析器接口
 * - 提供通用的超时保护
 * - 提供通用的错误处理
 * - 提供通用的日志记录
 * - 实现模板方法模式
 */

import * as fs from 'fs';
import { extractorLogger } from '../logger/logger';
import type { ExtractorResult } from './types';

/**
 * 解析器配置接口
 */
export interface ExtractorConfig {
  /** 解析器名称（用于日志） */
  name: string;
  /** 是否记录详细日志（默认 false） */
  verboseLogging?: boolean;
}

/**
 * 解析器抽象基类
 *
 * 使用示例：
 * ```typescript
 * class MyExtractor extends BaseExtractor {
 *     constructor() {
 *         super({ name: 'MyExtractor' });
 *     }
 *
 *     protected async doExtract(filePath: string): Promise<ExtractorResult> {
 *         // 实现具体的提取逻辑
 *         const text = await this.readFile(filePath);
 *         return this.buildResult(text);
 *     }
 * }
 * ```
 */
export abstract class BaseExtractor {
  protected readonly config: ExtractorConfig;
  protected readonly logger: typeof extractorLogger;

  protected constructor(config: ExtractorConfig) {
    this.config = {
      name: config.name,
      verboseLogging: config.verboseLogging ?? false,
    };
    this.logger = extractorLogger;
  }

  /**
   * 【模板方法】提取文件内容（公开接口）
   *
   * 流程：
   * 1. 验证文件
   * 2. 执行提取（由装饰器提供超时保护）
   * 3. 处理结果
   * 4. 返回结果
   *
   * @param filePath 文件路径
   * @returns 提取结果
   */
  async extract(filePath: string): Promise<ExtractorResult> {
    const startTime = Date.now();

    try {
      // 1. 验证文件
      await this.validateFile(filePath);

      // 2. 执行提取（超时由装饰器处理）
      const result = await this.doExtract(filePath);

      // 3. 记录成功日志
      const duration = Date.now() - startTime;
      if (this.config.verboseLogging) {
        this.logger.debug(`[${this.config.name}] 提取成功 (${duration}ms)`);
      }

      return result;
    } catch (error: any) {
      // 4. 处理错误（不记录日志，由装饰器统一记录）
      return this.handleError(error, filePath);
    }
  }

  /**
   * 【模板方法】验证文件
   *
   * @param filePath 文件路径
   * @throws Error 如果文件无效
   */
  protected async validateFile(filePath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(filePath);

      if (!stat.isFile()) {
        throw new Error('不是有效文件');
      }

      if (stat.size === 0) {
        throw new Error('文件为空');
      }

      // 子类可以重写此方法进行额外验证
      await this.doValidateFile(filePath, stat);
    } catch (error: any) {
      // 【修复】保留原始错误的 cause 属性
      const newError = new Error(`文件验证失败: ${error.message}`);
      (newError as any).cause = error;
      throw newError;
    }
  }

  /**
   * 【钩子方法】子类可重写的文件验证逻辑
   *
   * @param filePath 文件路径
   * @param stat 文件统计信息
   */
  protected async doValidateFile(filePath: string, stat: fs.Stats): Promise<void> {
    // 默认不做额外验证，子类可重写
  }
  /**
   * 【抽象方法】子类必须实现的提取逻辑
   *
   * @param filePath 文件路径
   * @returns 提取结果
   */
  protected abstract doExtract(filePath: string): Promise<ExtractorResult>;

  /**
   * 【工具方法】处理错误
   *
   * @param error 错误对象
   * @param filePath 文件路径
   * @returns 错误结果
   */
  protected handleError(error: any, filePath: string): ExtractorResult {
    // 默认返回空结果，标记为不支持预览
    return { text: '', unsupportedPreview: true };
  }

  /**
   * 【工具方法】构建提取结果
   *
   * @param text 提取的文本
   * @param logPrefix 日志前缀（可选，默认使用配置的名称）
   * @returns 提取结果
   */
  protected buildResult(text: string, logPrefix?: string): ExtractorResult {
    const hasContent = text && text.trim().length > 0;

    if (!hasContent && this.config.verboseLogging) {
      this.logger.debug(`[${logPrefix || this.config.name}] 未提取到有效内容`);
    }

    return {
      text: hasContent ? text : '',
      unsupportedPreview: !hasContent,
    };
  }

  /**
   * 【工具方法】读取文件为 Buffer
   *
   * @param filePath 文件路径
   * @returns 文件内容 Buffer
   */
  protected async readFileAsBuffer(filePath: string): Promise<Buffer> {
    return await fs.promises.readFile(filePath);
  }

  /**
   * 【工具方法】读取文件为字符串
   *
   * @param filePath 文件路径
   * @param encoding 编码（默认 utf-8）
   * @returns 文件内容字符串
   */
  protected async readFileAsString(
    filePath: string,
    encoding: BufferEncoding = 'utf-8'
  ): Promise<string> {
    return await fs.promises.readFile(filePath, encoding);
  }

  /**
   * 【工具方法】检测文件编码（简单实现）
   *
   * @param buffer 文件缓冲区
   * @returns 检测到的编码
   */
  protected detectEncoding(buffer: Buffer): string {
    // 检查 BOM
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return 'utf-8';
    }

    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return 'utf-16le';
    }

    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      return 'utf-16be';
    }

    // 默认 UTF-8
    return 'utf-8';
  }
}
