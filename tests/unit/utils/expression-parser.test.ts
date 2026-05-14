/**
 * 表达式解析器单元测试
 * 
 * 测试覆盖：
 * 1. validateExpression - 表达式验证
 * 2. evaluateExpression - 表达式评估
 * 3. 边界情况处理
 * 4. 缓存机制
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  validateExpression, 
  evaluateExpression,
  clearExpressionCache,
  getCacheSize
} from '../../../src/utils/expression-parser';

describe('Expression Parser', () => {
  // 每个测试前清除缓存，确保测试独立性
  beforeEach(() => {
    clearExpressionCache();
  });

  describe('validateExpression', () => {
    it('应该接受空表达式', () => {
      const result = validateExpression('');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('应该接受纯空格表达式', () => {
      const result = validateExpression('   ');
      expect(result.valid).toBe(true);
    });

    it('应该接受简单关键词', () => {
      const result = validateExpression('密码');
      expect(result.valid).toBe(true);
    });

    it('应该接受包含特殊字符的关键词', () => {
      const result = validateExpression('C++');
      expect(result.valid).toBe(true);
    });

    it('应该接受逻辑与表达式', () => {
      const result = validateExpression('密码 & 身份证');
      expect(result.valid).toBe(true);
    });

    it('应该接受逻辑或表达式', () => {
      const result = validateExpression('密码 | 身份证');
      expect(result.valid).toBe(true);
    });

    it('应该接受非运算', () => {
      const result = validateExpression('!密码');
      expect(result.valid).toBe(true);
    });

    it('应该接受括号分组', () => {
      const result = validateExpression('(密码 | 身份证) & 机密');
      expect(result.valid).toBe(true);
    });

    it('应该接受复杂表达式', () => {
      const result = validateExpression('!密码 & (身份证 | 银行卡) & (邮箱 | 电话)');
      expect(result.valid).toBe(true);
    });

    it('应该拒绝括号不匹配的表达式（缺少右括号）', () => {
      const result = validateExpression('(密码 & 身份证');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('语法错误');
    });

    it('应该拒绝括号不匹配的表达式（缺少左括号）', () => {
      const result = validateExpression('密码 & 身份证)');
      expect(result.valid).toBe(false);
    });

    it('应该拒绝无效的运算符位置', () => {
      const result = validateExpression('密码 &');
      expect(result.valid).toBe(false);
    });

    it('应该拒绝连续的运算符', () => {
      const result = validateExpression('密码 && 身份证');
      expect(result.valid).toBe(false);
    });

    it('应该接受多层嵌套括号', () => {
      const result = validateExpression('((密码 | 身份证) & (银行卡 | 邮箱))');
      expect(result.valid).toBe(true);
    });

    it('应该接受多个非运算', () => {
      const result = validateExpression('!!密码');
      expect(result.valid).toBe(true);
    });
  });

  describe('evaluateExpression', () => {
    it('空表达式应该返回不匹配', () => {
      const result = evaluateExpression('', '这是测试文本');
      expect(result.matched).toBe(false);
    });

    it('应该匹配简单关键词', () => {
      const result = evaluateExpression('密码', '这是密码测试');
      expect(result.matched).toBe(true);
    });

    it('应该不匹配不存在的关键词', () => {
      const result = evaluateExpression('密码', '这是测试文档');
      expect(result.matched).toBe(false);
    });

    it('应该正确评估逻辑与（两个关键词都存在）', () => {
      const result = evaluateExpression(
        '密码 & 身份证',
        '密码:123, 身份证:456'
      );
      expect(result.matched).toBe(true);
    });

    it('应该在缺少一个关键词时不匹配逻辑与', () => {
      const result = evaluateExpression(
        '密码 & 身份证',
        '只有密码'
      );
      expect(result.matched).toBe(false);
    });

    it('应该在两个关键词都不存在时不匹配逻辑与', () => {
      const result = evaluateExpression(
        '密码 & 身份证',
        '没有任何敏感信息'
      );
      expect(result.matched).toBe(false);
    });

    it('应该正确评估逻辑或（第一个关键词存在）', () => {
      const result = evaluateExpression(
        '密码 | 身份证',
        '只有密码'
      );
      expect(result.matched).toBe(true);
    });

    it('应该正确评估逻辑或（第二个关键词存在）', () => {
      const result = evaluateExpression(
        '密码 | 身份证',
        '只有身份证'
      );
      expect(result.matched).toBe(true);
    });

    it('应该在两个关键词都不存在时不匹配逻辑或', () => {
      const result = evaluateExpression(
        '密码 | 身份证',
        '没有任何敏感信息'
      );
      expect(result.matched).toBe(false);
    });

    it('应该正确评估非运算（关键词不存在）', () => {
      const result = evaluateExpression('!密码', '这是测试文档');
      expect(result.matched).toBe(true);
    });

    it('应该在关键词存在时非运算不匹配', () => {
      const result = evaluateExpression('!密码', '这是密码测试');
      expect(result.matched).toBe(false);
    });

    it('应该正确评估括号分组', () => {
      const result = evaluateExpression(
        '(密码 | 身份证) & 机密',
        '有机密信息和密码'
      );
      expect(result.matched).toBe(true);
    });

    it('应该在分组条件不满足时不匹配', () => {
      const result = evaluateExpression(
        '(密码 | 身份证) & 机密',
        '只有机密信息'
      );
      expect(result.matched).toBe(false);
    });

    it('应该正确评估复杂表达式', () => {
      const result = evaluateExpression(
        '!密码 & (身份证 | 银行卡)',
        '没有任何敏感词，有身份证号码'  // 修改：确保不包含"密码"
      );
      expect(result.matched).toBe(true);
    });

    it('应该在第一个条件为假时复杂表达式不匹配', () => {
      const result = evaluateExpression(
        '!密码 & (身份证 | 银行卡)',
        '有密码，也有身份证'
      );
      expect(result.matched).toBe(false);
    });

    it('应该区分大小写', () => {
      const result = evaluateExpression('Password', 'password: 123');
      expect(result.matched).toBe(false);  // 大小写不匹配
    });

    it('应该匹配完整的关键词', () => {
      const result = evaluateExpression('密码', '这是一个密码测试文档');
      expect(result.matched).toBe(true);
    });

    it('应该支持中文关键词', () => {
      const result = evaluateExpression('身份证号', '我的身份证号是123456');
      expect(result.matched).toBe(true);
    });

    it('应该支持英文关键词', () => {
      const result = evaluateExpression('password', 'My password is 123');
      expect(result.matched).toBe(true);
    });

    it('应该支持数字关键词', () => {
      const result = evaluateExpression('123456', '验证码是123456');
      expect(result.matched).toBe(true);
    });
  });

  describe('优先级测试', () => {
    it('括号应该具有最高优先级', () => {
      // (A | B) & C 应该先计算 A | B
      const result = evaluateExpression(
        '(密码 | 身份证) & 机密',
        '有身份证和机密，但没有密码'
      );
      expect(result.matched).toBe(true);
    });

    it('非运算应该优先于与运算', () => {
      // !A & B 应该先计算 !A
      const result = evaluateExpression(
        '!密码 & 身份证',
        '无任何关键词，有身份证'  // 修改：确保不包含"密码"
      );
      expect(result.matched).toBe(true);
    });

    it('与运算应该优先于或运算', () => {
      // A & B | C 应该先计算 A & B
      const result = evaluateExpression(
        '密码 & 身份证 | 银行卡',
        '有密码和身份证，没有银行卡'
      );
      expect(result.matched).toBe(true);
    });
  });

  describe('边界情况测试', () => {
    it('应该处理超长关键词', () => {
      const longKeyword = 'a'.repeat(100);
      const longText = longKeyword + ' some text';
      const result = evaluateExpression(longKeyword, longText);
      expect(result.matched).toBe(true);
    });

    it('应该处理空文本', () => {
      const result = evaluateExpression('密码', '');
      expect(result.matched).toBe(false);
    });

    it('应该处理特殊字符转义', () => {
      const result = evaluateExpression("it's", "This is it's test");
      expect(result.matched).toBe(true);
    });

    it('应该处理多层嵌套非运算', () => {
      // !!密码 等价于 密码
      const result = evaluateExpression('!!密码', '这是密码测试');
      expect(result.matched).toBe(true);
    });

    it('应该处理极复杂表达式', () => {
      const result = evaluateExpression(
        '(A | B | C) & (D | E | F) & !(G | H) & (I & J)',
        '有A和D和I和J，没有G和H'
      );
      // 由于文本中不包含这些关键词，应该不匹配
      expect(result.matched).toBe(false);
    });
  });

  describe('缓存机制测试', () => {
    it('首次评估应该更新缓存', () => {
      evaluateExpression('密码', '测试文本');
      expect(getCacheSize()).toBeGreaterThan(0);
    });

    it('相同表达式应该使用缓存', () => {
      // 第一次评估
      evaluateExpression('密码', '测试文本1');
      const size1 = getCacheSize();
      
      // 第二次评估（应该使用缓存）
      evaluateExpression('密码', '测试文本2');
      const size2 = getCacheSize();
      
      // 缓存大小应该不变
      expect(size2).toBe(size1);
    });

    it('不同表达式应该增加缓存', () => {
      evaluateExpression('密码', '测试文本');
      const size1 = getCacheSize();
      
      evaluateExpression('身份证', '测试文本');
      const size2 = getCacheSize();
      
      expect(size2).toBe(size1 + 1);
    });

    it('清除缓存后应该重新开始计数', () => {
      evaluateExpression('密码', '测试文本');
      expect(getCacheSize()).toBeGreaterThan(0);
      
      clearExpressionCache();
      expect(getCacheSize()).toBe(0);
    });
  });

  describe('错误处理测试', () => {
    it('语法错误的表达式应该返回错误信息', () => {
      const result = evaluateExpression('(密码 &', '测试文本');
      expect(result.matched).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('评估失败不应该抛出异常', () => {
      // 即使表达式有问题，也不应该抛出异常
      expect(() => {
        evaluateExpression('(密码 &', '测试文本');
      }).not.toThrow();
    });
  });
});
