/**
 * OFD 提取器单元测试
 */

import { describe, it, expect } from 'vitest';
import { extractOfd } from '../../../src/extractors/ofd/ofd-extractor';
import * as path from 'path';
import * as fs from 'fs';

describe('OFD Extractor', () => {
  const testDir = path.join(__dirname, '../../../test-data');

  it('应该能够加载 OFD 提取器模块', () => {
    expect(extractOfd).toBeDefined();
    expect(typeof extractOfd).toBe('function');
  });

  it('应该拒绝不存在的文件', async () => {
    const result = await extractOfd('/nonexistent/file.ofd');
    expect(result).toBeDefined();
    expect(result.text).toBe('');
    // 注意：文件不存在时会返回空结果，extractorName 可能为空
  });

  // 如果有测试文件，可以添加以下测试
  /*
  it('应该能够从简单 OFD 文件中提取文本', async () => {
    const testFile = path.join(testDir, 'test_ofd_simple.ofd');
    
    if (!fs.existsSync(testFile)) {
      console.warn('跳过测试: 测试文件不存在');
      return;
    }
    
    const result = await extractOfd(testFile);
    
    expect(result).toBeDefined();
    expect(result.extractorName).toBe('OfdExtractor');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.unsupportedPreview).toBe(false);
  });

  it('应该能够处理加密的 OFD 文件', async () => {
    const testFile = path.join(testDir, 'test_ofd_encrypted.ofd');
    
    if (!fs.existsSync(testFile)) {
      console.warn('跳过测试: 测试文件不存在');
      return;
    }
    
    const result = await extractOfd(testFile);
    
    expect(result).toBeDefined();
    expect(result.text).toBe('');
  });

  it('应该在超时时间内完成', async () => {
    const testFile = path.join(testDir, 'test_ofd_simple.ofd');
    
    if (!fs.existsSync(testFile)) {
      console.warn('跳过测试: 测试文件不存在');
      return;
    }
    
    const startTime = Date.now();
    const result = await extractOfd(testFile);
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(30000); // 30秒超时
    expect(result).toBeDefined();
  });
  */
});
