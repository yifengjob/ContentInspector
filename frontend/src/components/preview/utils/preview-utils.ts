/**
 * 文件预览支持的工具函数
 */

/**
 * 文件格式配置接口
 */
interface FileFormatConfig {
  ext: string; // 文件扩展名（不含点）
  description: string; // 文件类型描述
  mimeType: string; // MIME 类型
}

/**
 * 支持原生预览的文件格式配置（vue-office 支持的格式）
 * 【优化】单一数据源，同时定义扩展名、描述和 MIME 类型
 *
 * 注意：vue-office 仅支持以下格式：
 * - @vue-office/docx: .docx
 * - @vue-office/excel: .xlsx, .xls
 * - @vue-office/pdf: .pdf
 * - @vue-office/pptx: .pptx
 */
const NATIVE_PREVIEW_CONFIG: FileFormatConfig[] = [
  {
    ext: 'docx',
    description: 'Word 文档',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  // {
  //   ext: 'doc',
  //   description: 'Word 文档',
  //   mimeType: 'application/msword',
  // },
  {
    ext: 'xlsx',
    description: 'Excel 表格',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    ext: 'xls',
    description: 'Excel 表格',
    mimeType: 'application/vnd.ms-excel',
  },
  {
    ext: 'pdf',
    description: 'PDF 文档',
    mimeType: 'application/pdf',
  },
  {
    ext: 'pptx',
    description: 'PowerPoint 演示文稿',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  // {
  //   ext: 'ppt',
  //   description: 'PowerPoint 演示文稿',
  //   mimeType: 'application/vnd.ms-powerpoint',
  // },
] as const;

/**
 * 支持原生预览的文件格式列表（从配置中提取扩展名）
 */
export const SUPPORTED_NATIVE_FORMATS = NATIVE_PREVIEW_CONFIG.map((config) => config.ext);

/**
 * 文件类型描述映射表（从配置中提取）
 */
const FILE_TYPE_DESCRIPTIONS: Record<string, string> = NATIVE_PREVIEW_CONFIG.reduce(
  (acc, config) => {
    acc[config.ext] = config.description;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * MIME 类型映射表（从配置中提取）
 */
const MIME_TYPES: Record<string, string> = NATIVE_PREVIEW_CONFIG.reduce(
  (acc, config) => {
    acc[config.ext] = config.mimeType;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * 获取文件扩展名
 * @param filePath 文件路径
 * @returns 小写扩展名（不含点）
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
  return SUPPORTED_NATIVE_FORMATS.includes(ext);
}

/**
 * 获取文件类型描述
 * @param filePath 文件路径
 * @returns 文件类型描述
 */
export function getFileTypeDescription(filePath: string): string {
  const ext = getFileExtension(filePath);
  const description = FILE_TYPE_DESCRIPTIONS[ext];
  return description || `.${ext.toUpperCase()} 文件`;
}

/**
 * 获取文件的 MIME 类型
 * @param filePath 文件路径
 * @returns MIME 类型，如果未知则返回 application/octet-stream
 */
export function getMimeType(filePath: string): string {
  const ext = getFileExtension(filePath);
  return MIME_TYPES[ext] || 'application/octet-stream';
}
