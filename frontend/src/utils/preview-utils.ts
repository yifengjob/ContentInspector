/**
 * 文件预览支持的工具函数
 */

/**
 * 支持原生预览的文件格式列表（使用 jit-viewer）
 */
export const SUPPORTED_NATIVE_FORMATS = [
  // Office 格式
  'docx',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  // PDF
  'pdf',
  // 国产格式
  'ofd',
  // 文本格式
  'md',
  'markdown',
  'txt',
  // 代码文件
  'js',
  'ts',
  'py',
  'java',
  'htm',
  'html',
  'css',
] as const;

/**
 * 文件类型描述映射表
 * 【优化】从 SUPPORTED_NATIVE_FORMATS 自动生成键，避免重复维护
 */
const FILE_TYPE_DESCRIPTIONS: Record<(typeof SUPPORTED_NATIVE_FORMATS)[number], string> = {
  // Office
  docx: 'Word 文档',
  xlsx: 'Excel 表格',
  xls: 'Excel 表格',
  pptx: 'PowerPoint 演示文稿',
  ppt: 'PowerPoint 演示文稿',
  // PDF
  pdf: 'PDF 文档',
  // OFD
  ofd: 'OFD 版式文档',
  // 文本
  md: 'Markdown 文档',
  markdown: 'Markdown 文档',
  txt: '纯文本文件',
  // 代码
  js: 'JavaScript 文件',
  ts: 'TypeScript 文件',
  py: 'Python 文件',
  java: 'Java 文件',
  html: 'HTML 文件',
  htm: 'HTML 文件',
  css: 'CSS 样式表',
};

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
