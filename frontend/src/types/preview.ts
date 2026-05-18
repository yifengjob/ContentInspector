/**
 * 预览组件相关类型定义
 */

import type { Ref } from 'vue';

/**
 * 预览模式枚举
 */
export enum PreviewMode {
  NATIVE = 'native', // 原生格式预览
  TEXT = 'text', // 文本预览
}

/**
 * 支持的文件格式
 */
export type SupportedFormat =
  | 'docx'
  | 'xlsx'
  | 'xls'
  | 'pdf'
  | 'pptx'
  | 'txt'
  | 'log'
  | 'md'
  | 'csv'
  | 'json'
  | 'xml'
  | 'yaml'
  | string;

/**
 * 预览路由信息
 */
export interface PreviewRoute {
  mode: PreviewMode;
  component?: string; // 组件名称
  filePath: string;
  fileType: string;
  fileName: string;
}

/**
 * 预览配置选项
 */
export interface PreviewOptions {
  /**
   * 是否启用高亮（文本预览专用）
   */
  enableHighlight?: boolean;

  /**
   * 高亮范围数组（文本预览专用）
   */
  highlights?: HighlightRange[];

  /**
   * 初始缩放比例（默认 1.0）
   */
  initialScale?: number;

  /**
   * 最大缩放比例（默认 3.0）
   */
  maxScale?: number;

  /**
   * 最小缩放比例（默认 0.5）
   */
  minScale?: number;
}

/**
 * 高亮范围
 */
export interface HighlightRange {
  start: number;
  end: number;
  typeId: string;
  typeName: string;
}

/**
 * 预览组件通用接口
 * 所有预览组件必须实现此接口
 */
export interface PreviewComponentInstance {
  /**
   * 加载文档
   * @param filePath 文件路径
   * @returns Promise<void>
   */
  loadDocument(filePath: string): Promise<void>;

  /**
   * 销毁组件，释放资源
   */
  destroy(): void;

  /**
   * 获取加载状态
   */
  loading: Ref<boolean>;

  /**
   * 获取错误信息
   */
  error: Ref<string | null>;

  /**
   * 缩放比例（可选）
   */
  scale?: Ref<number>;

  /**
   * 当前页码（可选，用于多页文档）
   */
  currentPage?: Ref<number>;

  /**
   * 总页数（可选，用于多页文档）
   */
  totalPages?: Ref<number>;
}

/**
 * 文件统计信息
 */
export interface FileStats {
  size: number;
  mtime: number;
}

/**
 * IPC 响应格式
 */
export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
