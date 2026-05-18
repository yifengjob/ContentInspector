/**
 * RTF 富文本提取器 - 编码转换 + 正则提取
 * 支持: rtf
 */

import * as iconv from 'iconv-lite';
import { FILE_READ_TIMEOUT_STANDARD_MS } from '../../core/config/constants';
import type { ExtractorResult } from '../types';
import { BaseExtractor } from '../base-extractor';
import { readFileWithTimeout } from '../../utils/file-utils';
import { withTimeout, withLogging, composeDecorators } from '../extractor-decorators';

/**
 * RTF 文件提取器类
 */
class RtfExtractor extends BaseExtractor {
  constructor() {
    super({
      name: 'RtfExtractor',
      verboseLogging: false,
    });
  }

  protected async doExtract(filePath: string): Promise<ExtractorResult> {
    // 读取文件
    const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
    const content = buffer.toString('utf-8');

    // 第一步：检测 RTF 文件的编码（从 \ansicpgN 中提取代码页）
    const encoding = this.detectRtfEncoding(content);

    // 第二步：将十六进制转义序列（\'xx）转换为对应编码的字符
    let text = this.decodeRtfHexSequences(content, encoding);

    // 第三步：移除其他 RTF 控制字和标记
    text = this.cleanRtfMarkup(text);

    return this.buildResult(text, 'RtfExtractor');
  }

  /**
   * 检测 RTF 文件编码
   */
  private detectRtfEncoding(content: string): string {
    const codePageMatch = content.match(/\\ansicpg(\d+)/i);
    let encoding = 'gbk'; // 默认 GBK（简体中文）

    if (codePageMatch) {
      const codePage = parseInt(codePageMatch[1]);
      // 根据代码页映射到 iconv-lite 支持的编码名称
      switch (codePage) {
        case 936: // 简体中文 GBK
          encoding = 'gbk';
          break;
        case 950: // 繁体中文 Big5
          encoding = 'big5';
          break;
        case 932: // 日语 Shift_JIS
          encoding = 'shift_jis';
          break;
        case 949: // 韩语 EUC-KR
          encoding = 'euc-kr';
          break;
        case 1252: // 西欧 Windows-1252
          encoding = 'windows-1252';
          break;
        case 1251: // 西里尔文 Windows-1251
          encoding = 'windows-1251';
          break;
        case 1250: // 东欧 Windows-1250
          encoding = 'windows-1250';
          break;
        case 65001: // UTF-8
          encoding = 'utf-8';
          break;
        default:
          // 其他代码页尝试使用 GBK（最常见）
          this.logger.warn(
            `[${this.config.name}] 未知的 RTF 代码页: ${codePage}，尝试使用 GBK 解码`
          );
          encoding = 'gbk';
      }
    }

    return encoding;
  }

  /**
   * 解码 RTF 十六进制转义序列
   */
  private decodeRtfHexSequences(content: string, encoding: string): string {
    return content.replace(/(\\'[0-9a-fA-F]{2})+/g, (match) => {
      // 提取所有十六进制字节
      const hexPairs = match.match(/\\'([0-9a-fA-F]{2})/g);
      if (!hexPairs) return '';

      // 转换为字节数组
      const bytes = hexPairs.map((pair) => {
        const hex = pair.substring(2); // 去掉 \'
        return parseInt(hex, 16);
      });

      // 复用 Buffer，减少临时对象创建
      let decoded = '';
      try {
        const buffer = Buffer.from(bytes);
        decoded = iconv.decode(buffer, encoding as any);
      } catch (e) {
        this.logger.warn(`[${this.config.name}] ${encoding} 解码失败，尝试 GBK`);
        // 降级到 GBK
        try {
          const gbkBuffer = Buffer.from(bytes);
          decoded = iconv.decode(gbkBuffer, 'gbk');
        } catch (e2) {
          return '';
        }
      }
      return decoded;
    });
  }

  /**
   * 清理 RTF 标记
   */
  private cleanRtfMarkup(text: string): string {
    return (
      text
        // 移除 Unicode 转义序列（\uN?）
        .replace(/\\u-?\d+\??/g, '')
        // 移除 RTF 控制字（\word）
        .replace(/\\[a-z]+[0-9]*[ ;]?/g, ' ')
        // 移除花括号
        .replace(/[{}]/g, ' ')
        // 合并多余空白
        .replace(/\s+/g, ' ')
        .trim()
    );
  }
}

// 创建基础实例
const baseExtractor = new RtfExtractor();

// 应用装饰器：超时 + 日志
const enhancedExtract = composeDecorators(baseExtractor.extract.bind(baseExtractor), [
  (fn) => withTimeout(fn, { timeoutMs: 30000 }),
  (fn) =>
    withLogging(fn, {
      logStart: false,
      logEnd: false,
      logError: true,
      prefix: 'RtfExtractor',
    }),
]);

/**
 * 提取 RTF 文件内容（兼容旧接口）
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractRtf(filePath: string): Promise<ExtractorResult> {
  return await enhancedExtract(filePath);
}
