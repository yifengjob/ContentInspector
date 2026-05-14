import {HighlightRange} from '../types';
import {evaluateExpression} from '../utils/expression-parser';
import {mainLogger} from '../logger/logger';

interface SensitiveRule {
  id: string;
  name: string;
  pattern: RegExp;
  enabledByDefault: boolean;
  validate?: (match: string, text: string, matchIndex: number) => boolean;
}

// 身份证号校验（包含日期验证和校验码）
function validateIdCard(idCard: string): boolean {
  if (idCard.length !== 18) return false;
  
  // 前17位必须是数字，最后一位可以是数字或X/x
  for (let i = 0; i < 17; i++) {
    if (idCard[i] < '0' || idCard[i] > '9') return false;
  }
  const lastChar = idCard[17].toUpperCase();
  if ((lastChar < '0' || lastChar > '9') && lastChar !== 'X') return false;
  
  // 提取出生日期（第7-14位）
  const year = parseInt(idCard.substring(6, 10));
  const month = parseInt(idCard.substring(10, 12));
  const day = parseInt(idCard.substring(12, 14));
  
  // 校验年份：1900至今
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) return false;
  
  // 校验月份：1-12
  if (month < 1 || month > 12) return false;
  
  // 校验日期：根据月份和闰年判断
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [0, 31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  
  if (day < 1 || day > daysInMonth[month]) return false;
  
  // 校验码验证（ISO 7064:1983.MOD 11-2）
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(idCard[i]) * weights[i];
  }
  
  const expectedCheckCode = checkCodes[sum % 11];
  return lastChar === expectedCheckCode;
}

// Luhn算法验证银行卡号
function validateBankCard(cardNumber: string): boolean {
  // 检查卡BIN（银行卡号开头）
  // 银联借记卡：62开头
  // 银联信用卡：62、60开头
  // Visa：4开头
  // MasterCard：51-55或2开头
  const validBins = [
    '62', '60',  // 银联
    '4',         // Visa
    '51', '52', '53', '54', '55',  // MasterCard 51-55
    '22', '23', '24', '25', '26', '27'  // MasterCard 2系列
  ];
  
  const hasValidBin = validBins.some(bin => cardNumber.startsWith(bin));
  if (!hasValidBin) return false;
  
  // Luhn算法校验
  let sum = 0;
  let isEven = false;
  
  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNumber[i]);
    
    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    isEven = !isEven;
  }
  
  return sum % 10 === 0;
}

// IP地址验证
function validateIpAddress(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  
  for (const part of parts) {
    const num = parseInt(part);
    if (isNaN(num) || num < 0 || num > 255) return false;
    // 检查前导零（除了"0"本身）
    if (part.length > 1 && part[0] === '0') return false;
  }
  
  return true;
}

// 检查匹配前后是否有数字（用于手机号、银行卡号、身份证号）
function hasAdjacentDigit(text: string, matchStart: number, matchEnd: number): boolean {
  // 检查前面是否有数字
  const prevIsDigit = matchStart > 0 && /\d/.test(text[matchStart - 1]);
  // 检查后面是否有数字
  const nextIsDigit = matchEnd < text.length && /\d/.test(text[matchEnd]);
  
  return prevIsDigit || nextIsDigit;
}

const sensitiveRules: SensitiveRule[] = [
  {
    id: 'person_id',
    name: '身份证号',
    // 18位身份证：前17位数字，最后1位数字或X
    pattern: /\d{17}[\dXx]/g,
    enabledByDefault: true,
    validate: (match, text, index) => {
      // 检查前后是否有数字
      if (hasAdjacentDigit(text, index, index + match.length)) return false;
      // 验证身份证号
      return validateIdCard(match);
    }
  },
  {
    id: 'phone',
    name: '手机号',
    // 中国大陆手机号：1开头，第二位3-9，共11位
    pattern: /1[3-9]\d{9}/g,
    enabledByDefault: true,
    validate: (match, text, index) => {
      // 检查前后是否有数字
      return !hasAdjacentDigit(text, index, index + match.length);
    }
  },
  {
    id: 'email',
    name: '电子邮箱',
    // 标准邮箱格式：用户名@域名.顶级域名
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    enabledByDefault: true
  },
  {
    id: 'bank_card',
    name: '银行卡号',
    // 银行卡号：以特定卡BIN开头，16-19位
    pattern: /(?:62|60|4|5[1-5]|2[2-7])\d{14,18}/g,
    enabledByDefault: true,
    validate: (match, text, index) => {
      // 检查前后是否有数字
      if (hasAdjacentDigit(text, index, index + match.length)) return false;
      // Luhn校验
      return validateBankCard(match);
    }
  },
  {
    id: 'name',
    name: '中文姓名',
    // 2-4个连续汉字（易误报，默认关闭）
    pattern: /[\u4e00-\u9fa5]{2,4}/g,
    enabledByDefault: false
  },
  {
    id: 'address',
    name: '地址',
    // 极其严格的地址匹配：必须是真实的中国行政区划格式
    // 核心要求：必须包含"XX路/街/道"或"XX号"等明确地址标识
    pattern: /(?:[\u4e00-\u9fa5]{2,4}(?:省|自治区))?[\u4e00-\u9fa5]{2,4}(?:市|自治州|地区|盟)(?:[\u4e00-\u9fa5]{2,4}[区县市旗])?[\u4e00-\u9fa5]{2,10}(?:路|街|道|巷|胡同|里|弄|桥|广场|镇|乡)(?:\d+(?:号|栋|楼|单元|室|房)?)?/g,
    enabledByDefault: true
  },
  {
    id: 'ip_address',
    name: 'IP地址',
    // IPv4地址：每段0-255，用点分隔
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    enabledByDefault: true,
    validate: validateIpAddress
  },
  {
    id: 'password',
    name: '密码密钥',
    // 匹配 password/pwd/passwd/密码 后面跟着 := 和值的模式
    pattern: /(?:password|pwd|passwd|密码)\s*[:=]\s*\S+/gi,
    enabledByDefault: true
  }
];

/**
 * 获取敏感规则列表
 * 
 * 【新增】如果配置中存在自定义表达式，会添加到列表中
 */
export function getSensitiveRules(): Array<[string, string]> {
  // 【需求变更】不再将 custom_expression 添加到规则列表
  // 原因：表达式列是独立显示的，不属于敏感类型循环
  // 前端通过 expressionMatched 字段判断是否显示该列
  
  return sensitiveRules.map(rule => [rule.id, rule.name]);
}

/**
 * 检测敏感数据
 * 
 * 【注意】此函数仅处理内置规则，不处理自定义表达式
 * 自定义表达式应在流式处理器 (FileStreamProcessor) 中处理
 * 
 * @param text 待检测文本
 * @param enabledTypes 启用的内置规则类型
 * @returns 敏感类型计数
 */
export function detectSensitiveData(
  text: string, 
  enabledTypes: string[]
): Record<string, number> {
  return detectBuiltinRules(text, enabledTypes);
}

/**
 * 提取内置规则检测逻辑为独立函数
 */
function detectBuiltinRules(text: string, enabledTypes: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  
  for (const rule of sensitiveRules) {
    if (!enabledTypes.includes(rule.id)) continue;
    
    // 为每次检测创建新的正则表达式实例，避免lastIndex污染
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    
    const matches = Array.from(text.matchAll(pattern));
    if (!matches || matches.length === 0) continue;
    
    let validCount = 0;
    for (const match of matches) {
      if (rule.validate) {
        if (rule.validate(match[0], text, match.index!)) {
          validCount++;
        }
      } else {
        validCount++;
      }
    }
    
    if (validCount > 0) {
      counts[rule.id] = validCount;
    }
  }
  
  return counts;
}

export function getHighlights(text: string, enabledTypes: string[]): HighlightRange[] {
  const highlights: HighlightRange[] = [];
  
  for (const rule of sensitiveRules) {
    if (!enabledTypes.includes(rule.id)) continue;
    
    // 为每次检测创建新的正则表达式实例，避免lastIndex污染
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    
    const matches = Array.from(text.matchAll(pattern));
    
    for (const match of matches) {
      if (rule.validate && !rule.validate(match[0], text, match.index!)) {
        continue;
      }
      
      highlights.push({
        start: match.index!,
        end: match.index! + match[0].length,
        typeId: rule.id,
        typeName: rule.name
      });
    }
  }
  
  // 按起始位置排序
  highlights.sort((a, b) => a.start - b.start);
  
  return highlights;
}

/**
 * 仅评估自定义表达式（不扫描内置规则）
 * 
 * 【性能优化】用于流式处理场景，避免重复扫描文本
 * 
 * @param text 待检测文本
 * @param customExpression 自定义逻辑表达式
 * @returns 是否匹配
 */
export function evaluateCustomExpressionOnly(
  text: string,
  customExpression: string
): boolean {
  if (!customExpression || !customExpression.trim()) {
    return false;
  }
  
  try {
    const result = evaluateExpression(customExpression, text);
    return result.matched;
  } catch (error: any) {
    mainLogger.warn('自定义表达式评估失败: {}', error.message);
    return false;
  }
}

// 【新增】扫描模式专用：只统计数量，不保存结果（防止 OOM）
// 
// 【注意】此函数仅处理内置规则，不处理自定义表达式
// 自定义表达式应在流式处理器 (FileStreamProcessor) 中处理
export function countSensitiveMatches(
  text: string, 
  enabledTypes: string[]
): Record<string, number> {
  return detectBuiltinRules(text, enabledTypes);
}
