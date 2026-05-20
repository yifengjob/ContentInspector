/**
 * OFD 文件提取器 - 使用 fflate 解压 + XML 解析
 * 支持: ofd
 * 
 * OFD (Open Fixed-layout Document) 是中国国家标准的版式文档格式
 * 本质是 ZIP 压缩包，内部包含 XML 格式的页面描述
 */

import { unzipFile, extractEntriesText } from '../../utils/zip-utils';
import type { ExtractorResult } from '../types';
import { BaseExtractor } from '../base-extractor';
import { withTimeout, withLogging, composeDecorators } from '../extractor-decorators';

/**
 * OFD 提取器类
 */
class OfdExtractor extends BaseExtractor {
  constructor() {
    super({
      name: 'OfdExtractor',
      verboseLogging: false,
    });
  }

  protected async doExtract(filePath: string): Promise<ExtractorResult> {
    try {
      // 1. 解压 OFD 文件（ZIP 格式）
      const entries = await unzipFile(filePath);

      if (entries.length === 0) {
        this.logger.warn('[OfdExtractor] OFD 文件为空或无法解压');
        return this.buildResult('', this.config.name);
      }

      // 2. 查找所有 Content.xml 文件（页面内容）
      // OFD 结构中，文本通常在 Doc_*/Pages/Page_*/Content.xml 中
      const contentFiles = entries.filter((e) => {
        const name = e.name.toLowerCase();
        return name.includes('content.xml');
      });

      if (contentFiles.length === 0) {
        this.logger.warn('[OfdExtractor] 未找到 Content.xml 文件');
        return this.buildResult('', this.config.name);
      }

      // 3. 提取所有页面的文本
      const textChunks: string[] = [];

      for (const contentEntry of contentFiles) {
        const xmlContent = extractEntriesText([contentEntry])[0];
        if (!xmlContent || xmlContent.trim().length === 0) {
          continue;
        }

        // 4. 从 XML 中提取文本
        const pageTexts = this.extractTextFromXml(xmlContent);
        if (pageTexts.length > 0) {
          textChunks.push(...pageTexts);
        }
      }

      if (textChunks.length === 0) {
        this.logger.warn('[OfdExtractor] 未能从 OFD 文件中提取到文本');
        return this.buildResult('', this.config.name);
      }

      // 5. 合并所有文本
      const allText = textChunks.join('\n');
      
      this.logger.debug(
        `[OfdExtractor] 成功提取 ${textChunks.length} 个文本块，` +
          `总长度: ${allText.length} 字符`
      );

      return this.buildResult(allText, this.config.name);
    } catch (error: any) {
      // 识别加密或损坏的 OFD 文件
      if (error.message.includes('unknown compression type')) {
        this.logger.warn('[OfdExtractor] OFD 文件可能已加密或损坏');
      } else if (error.message.includes('invalid zip file')) {
        this.logger.warn('[OfdExtractor] 无效的 OFD 文件格式');
      } else {
        this.logger.error(`[OfdExtractor] 解析失败: ${error.message}`);
      }

      return this.handleError(error, filePath);
    }
  }

  /**
   * 从 OFD XML 中提取文本
   * 
   * OFD 文本通常存储在以下标签中：
   * 1. <TextCode> - 最常见的文本标签
   * 2. <CTM> - 某些变体格式
   * 3. 其他文本节点 - Fallback 方案
   * 
   * @param xmlContent XML 内容字符串
   * @returns 提取的文本数组
   */
  private extractTextFromXml(xmlContent: string): string[] {
    const textChunks: string[] = [];

    // 方法 1: 提取 <TextCode> 标签中的文本（最常见）
    // 示例: <TextCode>这是文本内容</TextCode>
    const textCodeMatches = xmlContent.match(/<TextCode[^>]*>(.*?)<\/TextCode>/gs);
    if (textCodeMatches && textCodeMatches.length > 0) {
      for (const match of textCodeMatches) {
        // 移除内部的 XML 标签，只保留纯文本
        const text = match.replace(/<[^>]+>/g, '').trim();
        if (text && text.length > 0) {
          textChunks.push(text);
        }
      }
      
      // 如果找到了 TextCode，直接返回
      if (textChunks.length > 0) {
        return textChunks;
      }
    }

    // 方法 2: 提取 <CGTransform> 中的文本（某些 OFD 变体）
    const cgMatches = xmlContent.match(/<CGTransform[^>]*>(.*?)<\/CGTransform>/gs);
    if (cgMatches && cgMatches.length > 0) {
      for (const match of cgMatches) {
        const text = match.replace(/<[^>]+>/g, '').trim();
        if (text && text.length > 0) {
          textChunks.push(text);
        }
      }
      
      if (textChunks.length > 0) {
        return textChunks;
      }
    }

    // 方法 3: 提取 <Layer> 中的文本对象（备选方案）
    const layerMatches = xmlContent.match(/<Layer[^>]*>(.*?)<\/Layer>/gs);
    if (layerMatches && layerMatches.length > 0) {
      for (const layerMatch of layerMatches) {
        // 在 Layer 中查找文本相关标签
        const textObjects = layerMatch.match(/<(?:TextObject|PathObject)[^>]*>(.*?)<\/(?:TextObject|PathObject)>/gs);
        if (textObjects) {
          for (const obj of textObjects) {
            const text = obj.replace(/<[^>]+>/g, '').trim();
            if (text && text.length > 0) {
              textChunks.push(text);
            }
          }
        }
      }
      
      if (textChunks.length > 0) {
        return textChunks;
      }
    }

    // 方法 4: 通用 Fallback - 提取所有有意义的文本节点
    // 过滤掉单个字符（可能是符号或空格）
    const allTextNodes = xmlContent.match(/>([^<>]{2,})</g);
    if (allTextNodes && allTextNodes.length > 0) {
      for (const node of allTextNodes) {
        // 提取 > 和 < 之间的内容
        const text = node.slice(1, -1).trim();
        
        // 过滤掉纯空白、太短或看起来像标签属性的内容
        if (
          text &&
          text.length > 1 &&
          !text.startsWith('/') &&
          !text.startsWith('?') &&
          !text.startsWith('!') &&
          !text.includes('=') &&
          !text.startsWith('xmlns') &&
          !text.startsWith('version')
        ) {
          textChunks.push(text);
        }
      }
    }

    return textChunks;
  }
}

// 创建实例并应用装饰器
const ofdExtractor = new OfdExtractor();

const enhancedOfdExtract = composeDecorators(ofdExtractor.extract.bind(ofdExtractor), [
  (fn) => withTimeout(fn, { timeoutMs: 30000 }),  // 30秒超时
  (fn) => withLogging(fn, { logError: true, prefix: 'OfdExtractor' }),
]);

/**
 * 提取 OFD 文件内容
 * 
 * @param filePath OFD 文件路径
 * @returns 提取结果（包含文本内容）
 * 
 * @example
 * ```typescript
 * const result = await extractOfd('/path/to/document.ofd');
 * console.log(result.text); // 提取的文本内容
 * ```
 */
export async function extractOfd(filePath: string): Promise<ExtractorResult> {
  return await enhancedOfdExtract(filePath);
}
