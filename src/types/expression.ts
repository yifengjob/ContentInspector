/**
 * 搜索表达式相关类型定义
 */

/**
 * 表达式验证结果
 */
export interface ExpressionValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误消息（如果无效） */
  error?: string;
  /** 错误位置（字符索引，如果可用） */
  position?: number;
}

/**
 * 表达式评估上下文
 */
export interface ExpressionContext {
  /** 待检测文本 */
  text: string;
  /** 关键词匹配结果（由 contains 函数动态计算） */
  keywords: Record<string, boolean>;
}

/**
 * 表达式评估结果
 */
export interface ExpressionEvaluationResult {
  /** 是否匹配 */
  matched: boolean;
  /** 错误消息（如果评估失败） */
  error?: string;
}
