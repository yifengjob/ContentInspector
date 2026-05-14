/**
 * 自定义敏感词逻辑表达式解析器
 * 
 * 基于 expr-eval 库封装，提供表达式验证和评估功能
 * 
 * 支持的运算符：
 * - ! : 非（NOT）
 * - & : 与（AND）
 * - | : 或（OR）
 * - () : 分组
 * 
 * 优先级：( ) > ! > & > |
 * 
 * 示例：
 * - "密码" → 匹配包含"密码"的文本
 * - "!密码" → 匹配不包含"密码"的文本
 * - "密码 & 身份证" → 匹配同时包含"密码"和"身份证"的文本
 * - "密码 | 身份证" → 匹配包含"密码"或"身份证"的文本
 * - "!密码 & (身份证 | 银行卡)" → 复杂逻辑组合
 */

import { Parser } from 'expr-eval';
import { mainLogger } from '../logger/logger';
import { 
  ExpressionValidationResult, 
  ExpressionEvaluationResult 
} from '../types/expression';

// ==================== 单例 Parser 实例 ====================

/**
 * 全局唯一的 Parser 实例，避免重复创建
 * 配置自定义函数用于关键词匹配
 */
const parser = new Parser();

// 注册自定义函数：检查文本是否包含关键词
parser.functions = {
  /**
   * 检查文本是否包含关键词
   * @param text 文本内容
   * @param keyword 关键词
   * @returns 是否包含
   */
  contains: (text: string, keyword: string): boolean => {
    if (!text || !keyword) {
      return false;
    }
    return text.includes(keyword);
  }
};

// ==================== 表达式转换 ====================

/**
 * 将用户输入的表达式转换为 expr-eval 支持的格式
 * 
 * 转换规则：
 * - 关键词 "密码" → contains(text, '密码')
 * - 运算符 "&" → "&&"
 * - 运算符 "|" → "||"
 * - 运算符 "!" → "!"
 * - 括号保持不变
 * 
 * 示例：
 * 输入: "密码 & (身份证 | 银行卡)"
 * 输出: "contains(text, '密码') && (contains(text, '身份证') || contains(text, '银行卡'))"
 * 
 * @param expression 用户输入的表达式
 * @returns 转换后的表达式
 */
function transformExpression(expression: string): string {
  // 1. Tokenize：分解为 token 数组
  const tokens = tokenize(expression);
  
  // 2. 转换每个 token
  const transformedTokens = tokens.map(token => {
    if (isKeyword(token)) {
      // 关键词转换为 contains 函数调用
      return `contains(text, '${escapeString(token)}')`;
    } else if (token === '&') {
      return '&&';
    } else if (token === '|') {
      return '||';
    } else {
      // 括号和 ! 保持不变
      return token;
    }
  });
  
  // 3. 拼接为最终表达式
  return transformedTokens.join(' ');
}

/**
 * 词法分析：将表达式字符串分解为 token 数组
 * 
 * 处理逻辑：
 * - 空格作为分隔符
 * - 运算符和括号单独作为 token
 * - 其他字符累积为关键词
 * 
 * 示例：
 * "密码 & (身份证 | 银行卡)" → ["密码", "&", "(", "身份证", "|", "银行卡", ")"]
 * 
 * @param expression 表达式字符串
 * @returns token 数组
 */
function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    
    if (char === ' ') {
      // 空格作为分隔符
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
    } else if (['(', ')', '!', '&', '|'].includes(char)) {
      // 运算符和括号单独作为 token
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
      tokens.push(char);
    } else {
      // 其他字符累积为关键词
      currentToken += char;
    }
  }
  
  // 处理最后一个 token
  if (currentToken) {
    tokens.push(currentToken);
  }
  
  return tokens;
}

/**
 * 判断 token 是否为关键词
 * @param token token 字符串
 * @returns 是否为关键词
 */
function isKeyword(token: string): boolean {
  return !['(', ')', '!', '&', '|'].includes(token);
}

/**
 * 转义字符串中的特殊字符（防止注入攻击）
 * @param str 原始字符串
 * @returns 转义后的字符串
 */
function escapeString(str: string): string {
  // 转义单引号和反斜杠
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ==================== 缓存机制 ====================

/**
 * 缓存条目接口
 */
interface CacheEntry {
  transformed: string;
  timestamp: number;
}

/**
 * 简单的 LRU 缓存，避免重复转换相同的表达式
 */
const expressionCache = new Map<string, CacheEntry>();

/** 缓存最大容量 */
const CACHE_MAX_SIZE = 100;

/** 缓存过期时间（5 分钟） */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * 获取或计算转换后的表达式（带缓存）
 * @param expression 原始表达式
 * @returns 转换后的表达式
 */
function getTransformedExpression(expression: string): string {
  const now = Date.now();
  const cached = expressionCache.get(expression);
  
  // 检查缓存是否有效
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    mainLogger.debug('表达式缓存命中: {}', expression);
    return cached.transformed;
  }
  
  // 计算并缓存
  const transformed = transformExpression(expression);
  
  // 如果缓存已满，删除最旧的条目
  if (expressionCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = Array.from(expressionCache.keys())[0];
    expressionCache.delete(oldestKey);
    mainLogger.debug('表达式缓存已满，删除最旧条目');
  }
  
  expressionCache.set(expression, {
    transformed,
    timestamp: now
  });
  
  mainLogger.debug('表达式缓存更新: {}', expression);
  
  return transformed;
}

// ==================== 公开 API ====================

/**
 * 验证表达式语法是否正确
 * 
 * @param expression 用户输入的表达式
 * @returns 验证结果
 * 
 * @example
 * ```typescript
 * const result = validateExpression('密码 & 身份证');
 * if (result.valid) {
 *   console.log('表达式有效');
 * } else {
 *   console.log('错误:', result.error);
 * }
 * ```
 */
export function validateExpression(expression: string): ExpressionValidationResult {
  // 空表达式视为有效（表示不启用）
  if (!expression || !expression.trim()) {
    return { valid: true };
  }
  
  try {
    // 尝试转换表达式
    const transformed = getTransformedExpression(expression);
    
    // 尝试解析（会抛出异常如果语法错误）
    parser.parse(transformed);
    
    mainLogger.debug('表达式验证通过: {}', expression);
    
    return { valid: true };
  } catch (error: any) {
    mainLogger.warn('表达式验证失败: {}, 错误: {}', expression, error.message);
    
    return {
      valid: false,
      error: `语法错误: ${error.message}`,
      position: extractErrorPosition(error.message)
    };
  }
}

/**
 * 从错误消息中提取错误位置（如果可能）
 * @param errorMessage 错误消息
 * @returns 错误位置（字符索引），如果无法提取则返回 undefined
 */
function extractErrorPosition(errorMessage: string): number | undefined {
  // expr-eval 的错误消息可能包含位置信息
  const match = errorMessage.match(/position\s+(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * 评估表达式是否匹配文本
 * 
 * @param expression 用户输入的表达式
 * @param text 待检测文本
 * @returns 评估结果
 * 
 * @example
 * ```typescript
 * const result = evaluateExpression('密码 & 身份证', '密码:123, 身份证:456');
 * if (result.matched) {
 *   console.log('文本匹配表达式');
 * }
 * ```
 */
export function evaluateExpression(
  expression: string,
  text: string
): ExpressionEvaluationResult {
  // 空表达式视为不匹配
  if (!expression || !expression.trim()) {
    return { matched: false };
  }
  
  try {
    // 获取转换后的表达式（使用缓存）
    const transformed = getTransformedExpression(expression);
    
    // 解析表达式
    const parsed = parser.parse(transformed);
    
    // 评估表达式
    // context 中的 text 会被 contains 函数使用
    const context = { text };
    
    const result = parsed.evaluate(context);
    
    const matched = Boolean(result);
    
    mainLogger.debug(
      '表达式评估完成: {}, 文本长度: {}, 匹配结果: {}',
      expression,
      text.length,
      matched
    );
    
    return { matched };
  } catch (error: any) {
    mainLogger.error('表达式评估失败: {}, 错误: {}', expression, error.message);
    
    return {
      matched: false,
      error: `评估失败: ${error.message}`
    };
  }
}

/**
 * 清除表达式缓存
 * 
 * 用于测试或内存管理场景
 */
export function clearExpressionCache(): void {
  expressionCache.clear();
  mainLogger.info('表达式缓存已清除');
}

/**
 * 获取缓存统计信息
 * 
 * @returns 缓存大小
 */
export function getCacheSize(): number {
  return expressionCache.size;
}
