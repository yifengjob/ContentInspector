/**
 * 文件预览支持的工具函数
 */

/**
 * 支持原生预览的文件格式配置
 * 【优化】单一数据源，同时定义格式和描述，避免重复维护
 */
const NATIVE_PREVIEW_CONFIG = {
  // Office 格式
  docx: 'Word 文档',
  xlsx: 'Excel 表格',
  xls: 'Excel 表格',
  pptx: 'PowerPoint 演示文稿',
  ppt: 'PowerPoint 演示文稿',
  // PDF
  pdf: 'PDF 文档',
  // 国产格式
  ofd: 'OFD 版式文档',
  // 文本格式
  md: 'Markdown 文档',
  markdown: 'Markdown 文档',
  txt: '纯文本文件',
  // 代码文件
  js: 'JavaScript 文件',
  ts: 'TypeScript 文件',
  py: 'Python 文件',
  java: 'Java 文件',
  htm: 'HTML 文件',
  html: 'HTML 文件',
  css: 'CSS 样式表',
} as const;

/**
 * 支持原生预览的文件格式列表（从配置中提取）
 */
export const SUPPORTED_NATIVE_FORMATS = Object.keys(
  NATIVE_PREVIEW_CONFIG
) as (keyof typeof NATIVE_PREVIEW_CONFIG)[];

/**
 * 文件类型描述映射表（从配置中提取）
 */
const FILE_TYPE_DESCRIPTIONS: Record<keyof typeof NATIVE_PREVIEW_CONFIG, string> =
  NATIVE_PREVIEW_CONFIG;

/**
 * 获取文件扩展名
 * @param filePath 文件路径
 * @returns 小写扩展名
 */
export function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() || '';
}

/**
 * 判断文件是否支持原生预览
 * @param filePath 文件路径
 * @returns 是否支持
 */
export function isNativePreviewSupported(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return SUPPORTED_NATIVE_FORMATS.includes(ext as (typeof SUPPORTED_NATIVE_FORMATS)[number]);
}

/**
 * 获取文件类型描述
 * @param filePath 文件路径
 * @returns 文件类型描述
 */
export function getFileTypeDescription(filePath: string): string {
  const ext = getFileExtension(filePath);

  // 【优化】直接使用类型安全的映射表，如果不存在则返回默认格式
  const description = (FILE_TYPE_DESCRIPTIONS as Record<string, string>)[ext];
  return description || `.${ext.toUpperCase()} 文件`;
}
