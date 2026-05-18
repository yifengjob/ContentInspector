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
  ignoreDirNames: string[]; // 忽略目录名（任意位置）
  systemDirs: string[]; // 系统目录完整路径
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
  type_id: string;
  type_name: string;
}

export interface PreviewResult {
  content?: string;
  highlights?: HighlightRange[];
  error?: string;
  unsupportedPreview?: boolean;
}

export interface AppConfig {
  selectedPaths: string[];
  selectedExtensions: string[];
  enabledSensitiveTypes: string[];
  ignoreDirNames: string[]; // 忽略目录名（任意位置）
  systemDirs: string[]; // 系统目录完整路径
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
   * @default '' - 空字符串表示不启用表达式搜索
   */
  searchExpression?: string;
}

export interface SensitiveRule {
  id: string;
  name: string;
  enabled_by_default: boolean;
}
