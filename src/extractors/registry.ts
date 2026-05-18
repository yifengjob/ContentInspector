/**
 * 提取器注册中心
 *
 * 职责：
 * - 管理所有文件提取器的配置注册
 * - 提供基于扩展名的快速查询
 * - 支持多扩展名共享同一配置
 *
 * 使用方式：
 * 1. 各提取器模块在加载时调用 registerExtractor() 自动注册
 * 2. 通过 getExtractorByExtension() 根据扩展名查询配置
 * 3. 通过 getAllConfigs() 获取所有配置（用于生成扩展名列表）
 */

import { createLogger } from '../logger/logger';
import type { FileTypeConfig } from './types';

const log = createLogger('ExtractorRegistry');

// 全局注册表：extension -> config
const registry = new Map<string, FileTypeConfig>();

// 跟踪已注册的配置对象（用于调试和防重复）
const registeredConfigs = new Set<FileTypeConfig>();

/**
 * 注册一个提取器配置
 *
 * @param config - 提取器配置对象
 *
 * @example
 * ```typescript
 * registerExtractor({
 *     extensions: ['pdf'],
 *     fileType: 'pdf',
 *     processor: FileProcessorType.PARSER_REQUIRED,
 *     supportsStreaming: false,
 *     extractor: extractPdf,
 *     description: 'PDF 文件'
 * });
 *
 * // 多个扩展名共享同一配置
 * registerExtractor({
 *     extensions: ['txt', 'log', 'md'],
 *     fileType: 'text',
 *     processor: FileProcessorType.STREAMING_TEXT,
 *     supportsStreaming: true,
 *     extractor: extractTextFile,
 *     description: '文本文件'
 * });
 * ```
 */
export function registerExtractor(config: FileTypeConfig): void {
  // 防止重复注册同一个配置对象
  if (registeredConfigs.has(config)) {
    log.warn(`⚠️ 配置已被注册，跳过: ${config.description}`);
    return;
  }

  // 为每个扩展名注册
  let hasConflict = false;
  for (const ext of config.extensions) {
    const normalizedExt = ext.toLowerCase();

    if (registry.has(normalizedExt)) {
      const existingConfig = registry.get(normalizedExt);
      log.warn(
        `⚠️ 扩展名 .${normalizedExt} 已被注册 ` +
          `(现有: ${existingConfig?.description}, ` +
          `新配置: ${config.description})，将被覆盖`
      );
      hasConflict = true;
    }

    registry.set(normalizedExt, config);
  }

  // 标记为已注册
  registeredConfigs.add(config);

  // 日志输出（仅在调试模式下）
  if (process.env.NODE_ENV === 'development' && !hasConflict) {
    log.debug(
      `✅ 注册提取器: ${config.description} ` +
        `(${config.extensions.map((e) => `.${e}`).join(', ')})`
    );
  }
}

/**
 * 根据扩展名获取提取器配置
 *
 * @param ext - 文件扩展名（不带点，如 'pdf'）
 * @returns 配置对象，未找到返回 null
 *
 * @example
 * ```typescript
 * const config = getExtractorByExtension('pdf');
 * if (config) {
 *     const result = await config.extractor(filePath);
 * }
 * ```
 */
export function getExtractorByExtension(ext: string): FileTypeConfig | null {
  const normalizedExt = ext.toLowerCase().replace(/^\./, ''); // 移除可能的前导点
  return registry.get(normalizedExt) || null;
}

/**
 * 获取所有已注册的配置（去重）
 *
 * @returns 配置数组（每个配置对象只出现一次）
 *
 * @example
 * ```typescript
 * const allConfigs = getAllConfigs();
 * const supportedExtensions = allConfigs.flatMap(c => c.extensions);
 * ```
 */
export function getAllConfigs(): FileTypeConfig[] {
  // 使用 Set 去重（因为多个扩展名指向同一配置）
  const uniqueConfigs = new Set<FileTypeConfig>(registry.values());
  return Array.from(uniqueConfigs);
}

/**
 * 获取所有支持的扩展名列表
 *
 * @returns 扩展名数组（小写，不带点）
 *
 * @example
 * ```typescript
 * const extensions = getAllSupportedExtensions();
 * // ['pdf', 'txt', 'log', 'md', 'docx', ...]
 * ```
 */
export function getAllSupportedExtensions(): string[] {
  return Array.from(registry.keys()).sort();
}

/**
 * 清空注册表（主要用于测试）
 *
 * @internal
 */
export function clearRegistry(): void {
  registry.clear();
  registeredConfigs.clear();
}

/**
 * 获取注册表统计信息（用于调试）
 *
 * @returns 统计信息对象
 */
export function getRegistryStats(): {
  totalExtensions: number;
  totalConfigs: number;
  extensions: string[];
} {
  const configs = getAllConfigs();
  return {
    totalExtensions: registry.size,
    totalConfigs: configs.length,
    extensions: getAllSupportedExtensions(),
  };
}
