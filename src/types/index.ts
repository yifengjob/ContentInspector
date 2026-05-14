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
  
  // 自定义敏感词逻辑表达式
  customSensitiveExpression?: string; // 默认为空字符串（不启用）
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
