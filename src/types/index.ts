export interface DirectoryNode {
  path: string;
  name: string;
  isDir: boolean;
  isHidden: boolean;
  hasChildren: boolean;
  children?: DirectoryNode[];
}

export interface ScanConfig {
  selectedPaths: string[];
  selectedExtensions: string[];
  enabledSensitiveTypes: string[];
  ignoreDirNames: string[];
  systemDirs: string[];
  maxFileSizeMb: number;
  maxPdfSizeMb: number;
  scanConcurrency: number;
}

export interface ScanResultItem {
  filePath: string;
  fileSize: number;
  modifiedTime: string;
  counts: Record<string, number>;
  total: number;
  expressionMatched?: number; // 【需求变更】自定义表达式匹配状态（0或1）
  unsupportedPreview: boolean;
}

export interface HighlightRange {
  start: number;
  end: number;
  typeId: string;
  typeName: string;
}

export interface PreviewResult {
  content: string;
  highlights: HighlightRange[];
}

export interface SensitiveRule {
  id: string;
  name: string;
  regexPattern?: string;
  isKeyword: boolean;
  keywords?: string[];
  enabledByDefault: boolean;
}

export interface AppConfig {
  selectedPaths: string[];
  selectedExtensions: string[];
  enabledSensitiveTypes: string[];
  ignoreDirNames: string[];
  systemDirs: string[];
  maxFileSizeMb: number;
  maxPdfSizeMb: number;
  scanConcurrency: number;
  theme: string;
  language: string;
  enableExperimentalParsers: boolean;
  enableOfficeParsers: boolean;
  deleteToTrash: boolean;
  ignoreOtherDrivesSystemDirs: boolean; // 是否忽略其他磁盘的系统目录（仅 Windows）
    
  /**
   * 是否启用内置敏感词扫描规则
   * - true: 检测身份证号、手机号、邮箱等 8 种内置规则
   * - false: 跳过所有内置规则检测，仅使用搜索表达式
   * @default true
   */
  enableBuiltinRules: boolean;
    
  /**
   * 搜索表达式（支持逻辑运算符：&、|、!、()）
   * 
   * 使用场景：
   * - 启用内置规则时：作为额外过滤条件
   * - 禁用内置规则时：作为唯一搜索条件
   * 
   * 示例：
   * - "密码 & 身份证" - 同时包含“密码”和“身份证”
   * - "信息安全 | 数据" - 包含“信息安全”或“数据”
   * - "!密码 & (身份证 | 银行卡)" - 不包含“密码”，但包含“身份证”或“银行卡”
   * 
   * @default '' - 空字符串表示不启用表达式搜索
   */
  searchExpression?: string;
}

export interface EnvironmentIssue {
  title: string;
  description: string;
  severity: 'critical' | 'warning';
  solution: string;
  downloadUrl?: string;
}

export interface EnvironmentCheck {
  osVersion: string;
  isReady: boolean;
  issues: EnvironmentIssue[];
}

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}
