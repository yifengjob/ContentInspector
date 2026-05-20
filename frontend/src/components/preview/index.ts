/**
 * 预览组件统一导出
 */

export { default as NativePreviewContainer } from './NativePreviewContainer.vue';
// 【临时注释】旧组件已备份为 .bak 文件，待测试验证通过后可删除
// export { default as DocxPreview } from './components/DocxPreview.vue';
// export { default as ExcelPreview } from './components/ExcelPreview.vue';
// export { default as PdfPreview } from './components/PdfPreview.vue';
// export { default as PptxPreview } from './components/PptxPreview.vue';

// 工具函数
export * from './utils/file-reader';
