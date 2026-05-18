/**
 * OpenDocument 提取器 - 使用 fflate 解压 + XML 解析
 * 支持: odt, ods, odp
 */

import { unzipFile, extractEntriesText } from '../../utils/zip-utils';
import type { ExtractorResult } from '../types';
import { BaseExtractor } from '../base-extractor';
import { withTimeout, withLogging, composeDecorators } from '../extractor-decorators';

/**
 * OpenDocument 基础提取器类
 */
class OpenDocumentExtractor extends BaseExtractor {
  private readonly fileTypeName: string;
  private readonly extractTextFn: (xmlContent: string) => string[];

  constructor(fileTypeName: string, extractTextFn: (xmlContent: string) => string[]) {
    super({
      name: `OpenDocument${fileTypeName}Extractor`,
      verboseLogging: false,
    });
    this.fileTypeName = fileTypeName;
    this.extractTextFn = extractTextFn;
  }

  protected async doExtract(filePath: string): Promise<ExtractorResult> {
    try {
      const entries = await unzipFile(filePath);

      // OpenDocument 的内容在 content.xml 中
      const contentEntry = entries.find((e) => e.name === 'content.xml');
      if (!contentEntry) {
        this.logger.warn(`[${this.config.name}] 未找到 content.xml`);
        return this.buildResult('', this.config.name);
      }

      const xmlContent = extractEntriesText([contentEntry])[0];
      if (!xmlContent) {
        this.logger.warn(`[${this.config.name}] content.xml 为空`);
        return this.buildResult('', this.config.name);
      }

      // 使用自定义函数提取文本
      const textChunks = this.extractTextFn(xmlContent);

      // 使用 join 合并所有文本块
      const allText = textChunks.join('\n');
      return this.buildResult(allText, this.config.name);
    } catch (error: any) {
      // 识别加密或损坏的 OpenDocument 文件
      if (error.message.includes('unknown compression type')) {
        this.logger.warn(`[${this.config.name}] ${this.fileTypeName} 文件可能已加密或损坏`);
      } else {
        this.logger.error(`[${this.config.name}] 解析失败: ${error.message}`);
      }

      return this.handleError(error, filePath);
    }
  }
}

/**
 * ODT 文本提取器类
 */
class OdtExtractor extends OpenDocumentExtractor {
  constructor() {
    super('ODT', (xmlContent) => {
      // 使用数组收集文本块，避免字符串拼接产生大量临时对象
      const textChunks: string[] = [];

      // 提取 <text:p> (段落) 和 <text:h> (标题) 标签中的文本
      const textMatches = xmlContent.match(/<text:[ph][^>]*>(.*?)<\/text:[ph]>/gs);

      if (textMatches) {
        for (const match of textMatches) {
          // 移除内部的 XML 标签，只保留纯文本
          const text = match.replace(/<[^>]+>/g, '').trim();
          if (text) {
            textChunks.push(text);
          }
        }
      }

      return textChunks;
    });
  }
}

/**
 * ODS 表格提取器类
 */
class OdsExtractor extends OpenDocumentExtractor {
  constructor() {
    super('ODS', (xmlContent) => {
      // 使用数组收集文本块，避免字符串拼接产生大量临时对象
      const textChunks: string[] = [];

      // 提取表格行和单元格
      const rowMatches = xmlContent.match(/<table:table-row[^>]*>(.*?)<\/table:table-row>/gs);

      if (rowMatches) {
        for (const rowMatch of rowMatches) {
          // 提取单元格
          const cellMatches = rowMatch.match(/<table:table-cell[^>]*>(.*?)<\/table:table-cell>/gs);
          if (cellMatches) {
            const cells: string[] = [];
            for (const cellMatch of cellMatches) {
              // 提取单元格内的文本
              const textMatches = cellMatch.match(/<text:p[^>]*>(.*?)<\/text:p>/gs);
              if (textMatches) {
                const cellText = textMatches.map((m) => m.replace(/<[^>]+>/g, '').trim()).join(' ');
                if (cellText) {
                  cells.push(cellText);
                }
              }
            }
            if (cells.length > 0) {
              textChunks.push(cells.join('\t'));
            }
          }
        }
      }

      return textChunks;
    });
  }
}

/**
 * ODP 演示文稿提取器类
 */
class OdpExtractor extends OpenDocumentExtractor {
  constructor() {
    super('ODP', (xmlContent) => {
      // 使用数组收集文本块，避免字符串拼接产生大量临时对象
      const textChunks: string[] = [];

      // 提取 <draw:frame> 中的 <text:p> 标签
      const frameMatches = xmlContent.match(/<draw:frame[^>]*>(.*?)<\/draw:frame>/gs);

      if (frameMatches) {
        for (const frameMatch of frameMatches) {
          const textMatches = frameMatch.match(/<text:p[^>]*>(.*?)<\/text:p>/gs);
          if (textMatches) {
            for (const textMatch of textMatches) {
              const text = textMatch.replace(/<[^>]+>/g, '').trim();
              if (text) {
                textChunks.push(text);
              }
            }
          }
        }
      }

      return textChunks;
    });
  }
}

// 创建实例并应用装饰器
const odtExtractor = new OdtExtractor();
const odsExtractor = new OdsExtractor();
const odpExtractor = new OdpExtractor();

const enhancedOdtExtract = composeDecorators(odtExtractor.extract.bind(odtExtractor), [
  (fn) => withTimeout(fn, { timeoutMs: 30000 }),
  (fn) => withLogging(fn, { logError: true, prefix: 'OdtExtractor' }),
]);

const enhancedOdsExtract = composeDecorators(odsExtractor.extract.bind(odsExtractor), [
  (fn) => withTimeout(fn, { timeoutMs: 30000 }),
  (fn) => withLogging(fn, { logError: true, prefix: 'OdsExtractor' }),
]);

const enhancedOdpExtract = composeDecorators(odpExtractor.extract.bind(odpExtractor), [
  (fn) => withTimeout(fn, { timeoutMs: 30000 }),
  (fn) => withLogging(fn, { logError: true, prefix: 'OdpExtractor' }),
]);

/**
 * 提取 ODT 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractOdt(filePath: string): Promise<ExtractorResult> {
  return await enhancedOdtExtract(filePath);
}

/**
 * 提取 ODS 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractOds(filePath: string): Promise<ExtractorResult> {
  return await enhancedOdsExtract(filePath);
}

/**
 * 提取 ODP 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractOdp(filePath: string): Promise<ExtractorResult> {
  return await enhancedOdpExtract(filePath);
}
