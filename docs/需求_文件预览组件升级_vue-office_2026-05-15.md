# 需求：文件预览组件升级（引入 vue-office 系列）

**创建时间**：2026-05-15  
**版本**：v1.0  
**状态**：待实施  
**优先级**：P1（重要）

---

## 📋 需求背景

### 当前问题

ContentInspector 当前的文件预览功能采用**纯文本提取 + 高亮显示**的方式，存在以下局限性：

1. **格式丢失**：Word、Excel、PDF、PPT 等富文本文档的格式信息（字体、颜色、表格、图片、图表等）完全丢失
2. **体验不佳**：用户无法看到文档的真实排版和视觉效果，难以理解内容上下文
3. **专业性不足**：对于需要审查正式文档的场景，纯文本预览无法满足专业需求
4. **对比困难**：无法直观对比敏感信息在原文中的位置和样式

### 行业现状

主流文档预览方案：
- **Microsoft Office Online**：需要联网，依赖微软服务
- **LibreOffice**：本地部署复杂，性能较差
- **@vue-office 系列**：基于 Vue 3 的轻量级文档预览组件，支持离线渲染，性能优秀

### 解决方案

引入 `@vue-office` 系列组件，为支持的格式提供**原生格式预览**，其他格式保持现有文本预览方式。

**目标组件**：
- `@vue-office/docx` - Word 文档预览（.docx）
- `@vue-office/excel` - Excel 表格预览（.xlsx, .xls）
- `@vue-office/pdf` - PDF 文档预览（.pdf）
- `@vue-office/pptx` - PowerPoint 演示文稿预览（.pptx）

---

## 🎯 需求目标

### 核心目标

1. **提升预览质量**：支持格式的文档以原生格式渲染，保留完整样式和布局
2. **保持兼容性**：不支持的格式继续使用现有文本预览方式，确保功能完整性
3. **性能优化**：大文件预览不卡顿，内存占用可控，首屏加载 < 2秒
4. **用户体验**：预览界面美观、交互流畅，支持缩放、翻页、搜索等操作
5. **代码质量**：模块化设计，类型安全，无内存泄漏，遵循最佳实践
6. **流式预览**：支持流式处理的文件格式实现边读边处理，降低内存峰值
7. **关键字高亮**：在支持的预览模式中实现敏感信息关键字高亮显示
8. **合理的代码组织**：清晰的目录结构，避免后续重构风险

### 量化指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **首屏加载时间** | < 2秒 | 10MB 以内文件 |
| **内存峰值** | < 500MB | 单个预览窗口 |
| **FPS** | ≥ 50 | 滚动/缩放时 |
| **崩溃率** | < 1% | 大文件（50MB+） |
| **TypeScript 错误** | 0 | 编译时无类型错误 |
| **内存泄漏** | 0 | 关闭预览后完全释放 |
| **流式加载进度** | 实时显示 | 大文件加载时显示进度条 |
| **关键字高亮准确率** | 100% | 所有匹配的敏感信息都被高亮 |

---

## 🔍 官方 API 调研结果

**重要提示**：
> ⚠️ **在实施前，务必查阅 @vue-office 系列组件的官方文档和源码，确认最新的 API 支持和功能特性。**
>
> - 官方 GitHub 仓库：https://github.com/501351981/vue-office
> - 在线 Demo：https://501351981.github.io/vue-office/examples/dist/
> - 文档地址：https://501351981.github.io/vue-office/examples/docs/
>
> **特别注意**：
> 1. 本文档中的 API 信息基于 2024-2025 年的版本，可能存在变化
> 2. 关键字高亮和流式预览的支持情况需要实际验证
> 3. 如果官方 API 发生变化，以官方文档为准，及时调整实施方案

---

### @vue-office/docx

**官方仓库**：https://github.com/501351981/vue-office

**核心 API**：
```typescript
// Props
interface DocxProps {
  src: string | ArrayBuffer | Blob;  // 文档源（支持 URL、ArrayBuffer、Blob）
  options?: {
    inWrapper?: boolean;        // 是否在包装器中渲染（默认 true）
    ignoreWidth?: boolean;      // 是否忽略宽度（默认 false）
    ignoreHeight?: boolean;     // 是否忽略高度（默认 false）
    ignoreFonts?: boolean;      // 是否忽略字体（默认 false）
    breakPages?: boolean;       // 是否分页（默认 true）
    debug?: boolean;            // 是否开启调试模式（默认 false）
    experimentalCacheTables?: boolean;  // 实验性表格缓存（默认 true）
    className?: string;         // 自定义类名
  };
}

// Events
@rendered: () => void;   // 渲染完成
@error: (error: any) => void;  // 渲染失败
```

**关键字高亮支持**：❌ **不支持**
- @vue-office/docx 底层使用 docx-preview 库，不提供关键字搜索和高亮 API
- **替代方案**：需要在渲染完成后，通过 DOM 操作手动实现高亮（复杂度高，不推荐）

**流式预览支持**：❌ **不支持**
- 需要一次性加载整个文档的 ArrayBuffer
- 对于大文件（>50MB），内存占用较高

---

### @vue-office/excel

**核心 API**：
```typescript
// Props
interface ExcelProps {
  src: string | ArrayBuffer | Blob;  // 文档源
  options?: {
    xls?: boolean;           // 是否为 .xls 格式（默认 false）
    minColLength?: number;   // 最小列数
    maxColLength?: number;   // 最大列数
    minRowLength?: number;   // 最小行数
    maxRowLength?: number;   // 最大行数
  };
}

// Events
@rendered: () => void;
@error: (error: any) => void;
```

**关键字高亮支持**：❌ **不支持**
- @vue-office/excel 底层使用 Luckysheet，不提供关键字搜索 API
- **替代方案**：可以通过 Luckysheet 的 API 手动查找并高亮单元格（中等复杂度）

**流式预览支持**：✅ **部分支持**
- Luckysheet 支持虚拟滚动，可以按需加载可见区域的单元格
- 但初始解析仍需完整的 ArrayBuffer

---

### @vue-office/pdf

**核心 API**：
```typescript
// Props
interface PdfProps {
  src: string | ArrayBuffer | Blob;  // 文档源
  options?: {
    password?: string;       // PDF 密码（加密文档）
    cMapUrl?: string;        // CMap URL（用于中文等 CJK 语言）
    cMapPacked?: boolean;    // CMap 是否压缩
    useSystemFonts?: boolean; // 是否使用系统字体
  };
}

// Events
@rendered: () => void;
@error: (error: any) => void;
@page-rendered: (pageNum: number) => void;  // 单页渲染完成
```

**关键字高亮支持**：⚠️ **有限支持**
- @vue-office/pdf 底层使用 pdf.js，支持文本搜索
- **实现方案**：通过 pdf.js 的 `PDFViewerApplication.findController` API 实现关键字高亮
- **参考实现**：见下方"PDF 关键字高亮实现方案"

**流式预览支持**：✅ **支持**
- pdf.js 原生支持流式加载（Range Requests）
- 可以边下载边渲染，首屏加载速度快
- 适合大文件（>50MB）预览

---

### @vue-office/pptx

**核心 API**：
```typescript
// Props
interface PptxProps {
  src: string | ArrayBuffer | Blob;  // 文档源
  options?: {
    // 暂无公开的配置选项
  };
}

// Events
@rendered: () => void;
@error: (error: any) => void;
```

**关键字高亮支持**：❌ **不支持**
- @vue-office/pptx 功能较简单，不提供关键字搜索 API

**流式预览支持**：❌ **不支持**
- 需要一次性加载整个演示文稿

---

### API 调研总结

| 组件 | 关键字高亮 | 流式预览 | 默认策略 | 降级策略 |
|------|----------|---------|---------|----------|
| **@vue-office/docx** | ❌ 不支持 | ❌ 不支持 | 原生预览 | 预览失败 → 文本预览 + 高亮 |
| **@vue-office/excel** | ⚠️ 中等难度 | ✅ 部分支持 | 原生预览 | 预览失败 → 文本预览 + 高亮 |
| **@vue-office/pdf** | ✅ 有限支持 | ✅ 支持 | 原生预览 | 预览失败 → 文本预览 + 高亮 |
| **@vue-office/pptx** | ❌ 不支持 | ❌ 不支持 | 原生预览 | 预览失败 → 文本预览 + 高亮 |

**决策**：
1. **所有格式默认原生预览**：Word、Excel、PDF、PPT 均默认使用 @vue-office 组件进行原生格式预览
2. **统一降级策略**：所有格式在预览失败时自动降级到文本预览 + 高亮
3. **关键字高亮**：
   - PDF：实现关键字高亮（使用 pdf.js API）
   - Excel：实现关键字高亮（使用 Luckysheet API，可选）
   - Word/PPT：降级到文本预览后利用现有高亮功能
4. **流式预览**：仅 PDF 支持真正的流式加载，其他格式采用分块读取优化

---

## 🌊 流式预览实现要求

### 1. PDF 流式预览（真正流式）

**技术方案**：利用 pdf.js 的 Range Requests 功能

**实现要点**：
```typescript
// frontend/src/components/preview/components/PdfPreview.vue

import { ref, onMounted } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';

const loadingProgress = ref(0);
const totalPages = ref(0);
const currentPage = ref(1);

/**
 * 配置 PDF.js 支持流式加载
 */
async function loadPdfStream(filePath: string) {
  // 通过 Electron IPC 创建 ReadableStream
  const stream = await window.electronAPI.createFileStream(filePath);
  
  // 配置 PDF.js 使用流式加载
  const loadingTask = pdfjsLib.getDocument({
    data: stream,
    rangeChunkSize: 65536,  // 64KB 分块
    disableAutoFetch: false,  // 允许自动获取后续内容
    disableStream: false,     // 启用流式加载
  });
  
  // 监听加载进度
  loadingTask.onProgress = (progressData) => {
    loadingProgress.value = (progressData.loaded / progressData.total) * 100;
  };
  
  const pdfDocument = await loadingTask.promise;
  totalPages.value = pdfDocument.numPages;
  
  return pdfDocument;
}
```

**主进程支持**：
```typescript
// src/core/main/ipc-handlers.ts

import { createReadStream } from 'fs';

ipcMain.handle('create-file-stream', async (_, filePath: string) => {
  try {
    const stats = await fs.promises.stat(filePath);
    const stream = createReadStream(filePath, {
      highWaterMark: 64 * 1024,  // 64KB
    });
    
    // 将 Node.js Stream 转换为 Web ReadableStream
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        stream.on('end', () => {
          controller.close();
        });
        stream.on('error', (err) => {
          controller.error(err);
        });
      },
    });
    
    return {
      success: true,
      stream: webStream,
      totalSize: stats.size,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
```

**优势**：
- ✅ 首屏加载速度快（只需加载前几页）
- ✅ 内存占用低（按需加载页面）
- ✅ 适合大文件（>50MB）
- ✅ 用户可立即开始浏览，无需等待全部加载

---

### 2. Word/Excel/PPT 伪流式预览

**说明**：由于 @vue-office/docx/excel/pptx 不支持真正的流式加载，采用以下优化策略：

#### 2.1 分块读取 + 进度显示

```typescript
// frontend/src/components/preview/composables/useStreamLoader.ts

import { ref } from 'vue';

export function useStreamLoader() {
  const loadingProgress = ref(0);
  const isStreaming = ref(false);
  
  /**
   * 分块读取文件，模拟流式加载
   */
  async function loadFileInChunks(
    filePath: string,
    chunkSize: number = 1024 * 1024  // 1MB 分块
  ): Promise<ArrayBuffer> {
    isStreaming.value = true;
    loadingProgress.value = 0;
    
    const stats = await window.electronAPI.getFileStats(filePath);
    const totalSize = stats.size;
    let offset = 0;
    const chunks: ArrayBuffer[] = [];
    
    while (offset < totalSize) {
      const chunk = await window.electronAPI.readFileChunk(
        filePath,
        offset,
        chunkSize
      );
      
      chunks.push(chunk);
      offset += chunk.byteLength;
      
      // 更新进度
      loadingProgress.value = (offset / totalSize) * 100;
      
      // 让出主线程，避免阻塞 UI
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    // 合并所有分块
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let position = 0;
    
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), position);
      position += chunk.byteLength;
    }
    
    isStreaming.value = false;
    return merged.buffer;
  }
  
  return {
    loadingProgress,
    isStreaming,
    loadFileInChunks,
  };
}
```

---

## 🔦 关键字高亮实现要求

### 1. PDF 关键字高亮（使用 pdf.js API）

**技术方案**：利用 pdf.js 的 `PDFViewerApplication.findController`

**实现要点**：
```typescript
// frontend/src/components/preview/utils/highlight-engine.ts

import type { HighlightRange } from '@/types';

/**
 * PDF 关键字高亮引擎
 */
export class PdfHighlightEngine {
  private pdfViewer: any;
  private findController: any;
  
  constructor(pdfViewer: any) {
    this.pdfViewer = pdfViewer;
    this.findController = pdfViewer.findController;
  }
  
  /**
   * 高亮关键字
   * @param keywords 关键字数组
   */
  highlightKeywords(keywords: string[]) {
    if (!this.findController) {
      console.warn('[PdfHighlightEngine] findController 未初始化');
      return;
    }
    
    // 执行搜索并高亮
    keywords.forEach(keyword => {
      this.findController.executeCommand('find', {
        query: keyword,
        phraseSearch: false,      // 支持多个词匹配
        caseSensitive: false,     // 忽略大小写
        highlightAll: true,       // 高亮所有匹配
        findPrevious: false,
      });
    });
  }
  
  /**
   * 清除高亮
   */
  clearHighlights() {
    if (this.findController) {
      this.findController.reset();
    }
  }
}
```

### 2. Excel 关键字高亮（使用 Luckysheet API）

**技术方案**：通过 Luckysheet 的单元格样式 API 实现高亮

**实现要点**：
```typescript
/**
 * Excel 关键字高亮引擎
 */
export class ExcelHighlightEngine {
  private luckysheet: any;
  
  constructor(luckysheet: any) {
    this.luckysheet = luckysheet;
  }
  
  /**
   * 高亮包含关键字的单元格
   * @param keywords 关键字数组
   */
  highlightKeywords(keywords: string[]) {
    if (!this.luckysheet) return;
    
    const sheetData = this.luckysheet.getAllSheets();
    
    sheetData.forEach((sheet: any) => {
      const rows = sheet.data || [];
      
      rows.forEach((row: any[], rowIndex: number) => {
        row.forEach((cell: any, colIndex: number) => {
          if (!cell || !cell.v) return;
          
          const cellValue = String(cell.v).toLowerCase();
          
          // 检查是否包含关键字
          const matchedKeyword = keywords.find(keyword => 
            cellValue.includes(keyword.toLowerCase())
          );
          
          if (matchedKeyword) {
            // 设置单元格背景色为黄色
            this.luckysheet.setCellValue(
              rowIndex,
              colIndex,
              { bg: '#FFF59D', fc: '#000000' },
              { order: sheet.order }
            );
          }
        });
      });
    });
  }
}
```

### 3. Word/PPT 降级到文本预览 + 高亮

**决策原因**：
- @vue-office/docx 和 @vue-office/pptx 不支持关键字高亮 API
- DOM 操作实现高亮复杂度高，容易出错
- 现有的文本预览已经有完善的高亮功能

**实现方案**：在路由逻辑中判断是否有高亮需求，如果不支持则降级到文本预览。

---

## 🏗️ 代码组织结构要求

### 1. 目录结构设计

```
frontend/src/
├── components/
│   └── preview/                    # 预览组件模块
│       ├── index.ts                # 统一导出
│       ├── PreviewModal.vue        # 预览模态框（现有，修改）
│       ├── NativePreviewContainer.vue  # 原生预览容器（新建）
│       ├── TextPreview.vue         # 文本预览组件（现有，保持不变）
│       ├── types.ts                # 类型定义（新建）
│       ├── composables/            # 组合式函数
│       │   ├── usePreviewRouter.ts     # 预览路由逻辑
│       │   ├── useHighlight.ts         # 关键字高亮逻辑
│       │   └── useStreamLoader.ts      # 流式加载逻辑
│       ├── components/             # 子组件
│       │   ├── DocxPreview.vue         # Word 预览
│       │   ├── ExcelPreview.vue        # Excel 预览
│       │   ├── PdfPreview.vue          # PDF 预览
│       │   ├── PptxPreview.vue         # PowerPoint 预览
│       │   └── common/                 # 通用子组件
│       │       ├── PreviewToolbar.vue      # 工具栏
│       │       ├── LoadingIndicator.vue    # 加载指示器
│       │       └── ErrorDisplay.vue        # 错误显示
│       └── utils/                  # 工具函数
│           ├── highlight-engine.ts     # 高亮引擎
│           ├── stream-processor.ts     # 流式处理器
│           └── cache-manager.ts        # 缓存管理器
├── types/
│   └── preview.ts                  # 预览相关类型定义（新建）
└── utils/
    └── file-utils.ts               # 文件工具（扩展）
```

### 2. 设计原则

1. **模块化**：所有预览相关代码集中在 `preview/` 目录下
2. **分层清晰**：组件层、组合式函数层、工具层分离
3. **可扩展性**：新增预览格式只需在 `components/` 下添加新组件
4. **避免循环依赖**：单向依赖关系（组件 → composables → utils）
5. **类型安全**：所有模块都有明确的 TypeScript 类型定义

### 3. 依赖关系图

```
PreviewModal.vue
  ↓
NativePreviewContainer.vue
  ↓
[DocxPreview | ExcelPreview | PdfPreview | PptxPreview | TextPreview]
  ↓
composables (usePreviewRouter, useHighlight, useStreamLoader)
  ↓
utils (highlight-engine, stream-processor, cache-manager)
  ↓
types (PreviewComponent, PreviewOptions, HighlightRange)
```

**禁止的依赖关系**：
- ❌ 子组件不能直接导入父组件
- ❌ utils 不能导入 composables
- ❌ composables 不能导入组件
- ❌ 避免出现 A → B → C → A 的循环依赖

### 4. 避免重构风险的设计要点

**核心原则**：一次设计到位，避免后续重新组织代码结构

#### 4.1 为什么需要谨慎设计目录结构？

1. **引用路径稳定性**：一旦确定目录结构，所有 import 路径都会固定下来
2. **团队协作成本**：频繁重构会导致团队成员的代码冲突和沟通成本增加
3. **Git 历史混乱**：大规模文件移动会破坏 Git 历史记录，难以追溯变更
4. **测试用例失效**：重构可能导致单元测试和集成测试的路径引用失效

#### 4.2 设计时的考虑因素

✅ **应该考虑**：
- 未来可能新增的文件格式（如 `.odt`, `.key` 等）
- 功能扩展的可能性（如打印、导出、批注等）
- 性能优化的空间（如缓存、懒加载、虚拟滚动）
- 国际化支持的需求
- 无障碍访问的要求

❌ **应该避免**：
- 过度嵌套的目录层级（不超过 4 层）
- 模糊的模块边界（如 `misc/`, `utils/` 过大）
- 硬编码的路径引用（使用别名 `@/`）
- 紧耦合的组件关系（通过 props/events 通信）

#### 4.3 扩展示例

**场景**：未来需要支持 `.odt` (OpenDocument Text) 格式

**只需添加**：
```
frontend/src/components/preview/components/
└── OdtPreview.vue         # 新增 ODT 预览组件
```

**修改**：
```typescript
// frontend/src/utils/preview-router.ts
const nativeFormats: Record<string, string> = {
  '.docx': 'VueOfficeDocx',
  '.odt': 'VueOfficeOdt',   // 新增
  // ...
};
```

**无需修改**：
- ✅ NativePreviewContainer.vue（自动支持新组件）
- ✅ PreviewModal.vue（无需改动）
- ✅ 其他现有组件（完全隔离）

这证明了当前设计的可扩展性和稳定性。

---

## 🌊 流式预览实现要求

## ✨ 功能需求

### 1. 智能路由预览策略

#### 1.1 预览模式分类

根据文件扩展名自动选择预览模式：

| 文件类型 | 扩展名 | 预览模式 | 组件 |
|---------|--------|---------|------|
| Word | `.docx` | 原生格式预览 | `@vue-office/docx` |
| Excel | `.xlsx`, `.xls` | 原生格式预览 | `@vue-office/excel` |
| PDF | `.pdf` | 原生格式预览 | `@vue-office/pdf` |
| PowerPoint | `.pptx` | 原生格式预览 | `@vue-office/pptx` |
| 文本文件 | `.txt`, `.log`, `.md`, `.csv`, `.json`, `.xml`, `.yaml` 等 | 文本预览（现有） | 保持不变 |
| 代码文件 | `.js`, `.ts`, `.py`, `.java` 等 | 文本预览（现有） | 保持不变 |
| 其他 | 所有未列出的格式 | 文本预览（现有） | 保持不变 |

#### 1.2 路由逻辑实现

**位置**：`frontend/src/utils/preview-router.ts`（新建）

```typescript
export enum PreviewMode {
  NATIVE = 'native',      // 原生格式预览
  TEXT = 'text'           // 文本预览
}

export interface PreviewRoute {
  mode: PreviewMode;
  component?: string;     // 组件名称
  filePath: string;
  fileType: string;
}

/**
 * 根据文件路径确定预览模式和组件
 */
export function determinePreviewRoute(filePath: string): PreviewRoute {
  const ext = path.extname(filePath).toLowerCase();
  
  const nativeFormats: Record<string, string> = {
    '.docx': 'VueOfficeDocx',
    '.xlsx': 'VueOfficeExcel',
    '.xls': 'VueOfficeExcel',
    '.pdf': 'VueOfficePdf',
    '.pptx': 'VueOfficePptx'
  };
  
  if (nativeFormats[ext]) {
    return {
      mode: PreviewMode.NATIVE,
      component: nativeFormats[ext],
      filePath,
      fileType: ext.substring(1)
    };
  }
  
  return {
    mode: PreviewMode.TEXT,
    filePath,
    fileType: ext.substring(1) || 'unknown'
  };
}
```

---

### 2. 原生格式预览组件封装

#### 2.1 组件架构设计

**职责单一原则**：每个组件只负责一种格式的预览

**代码组织目录结构**：
```
frontend/src/
├── components/
│   └── preview/                    # 预览组件模块
│       ├── index.ts                # 统一导出
│       ├── PreviewModal.vue        # 预览模态框（现有，修改）
│       ├── NativePreviewContainer.vue  # 原生预览容器（新建）
│       ├── TextPreview.vue         # 文本预览组件（现有，保持不变）
│       ├── types.ts                # 类型定义（新建）
│       ├── composables/            # 组合式函数
│       │   ├── usePreviewRouter.ts     # 预览路由逻辑
│       │   ├── useHighlight.ts         # 关键字高亮逻辑
│       │   └── useStreamLoader.ts      # 流式加载逻辑
│       ├── components/             # 子组件
│       │   ├── DocxPreview.vue         # Word 预览
│       │   ├── ExcelPreview.vue        # Excel 预览
│       │   ├── PdfPreview.vue          # PDF 预览
│       │   ├── PptxPreview.vue         # PowerPoint 预览
│       │   └── common/                 # 通用子组件
│       │       ├── PreviewToolbar.vue      # 工具栏
│       │       ├── LoadingIndicator.vue    # 加载指示器
│       │       └── ErrorDisplay.vue        # 错误显示
│       └── utils/                  # 工具函数
│           ├── highlight-engine.ts     # 高亮引擎
│           ├── stream-processor.ts     # 流式处理器
│           └── cache-manager.ts        # 缓存管理器
├── types/
│   └── preview.ts                  # 预览相关类型定义（新建）
└── utils/
    └── file-utils.ts               # 文件工具（扩展）
```

**设计原则**：
1. **模块化**：所有预览相关代码集中在 `preview/` 目录下
2. **分层清晰**：组件层、组合式函数层、工具层分离
3. **可扩展性**：新增预览格式只需在 `components/` 下添加新组件
4. **避免循环依赖**：单向依赖关系（组件 → composables → utils）
5. **类型安全**：所有模块都有明确的 TypeScript 类型定义

#### 2.2 通用接口定义

**位置**：`frontend/src/types/preview.ts`（新建）

```typescript
import type { Ref } from 'vue';

/**
 * 预览组件通用接口
 * 所有预览组件必须实现此接口
 */
export interface PreviewComponent {
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
```

#### 2.3 Word 预览组件（DocxPreview.vue）

**位置**：`frontend/src/components/preview/DocxPreview.vue`（新建）

**核心功能**：
- 使用 `@vue-office/docx` 渲染 Word 文档
- 支持缩放控制（放大/缩小/重置）
- 加载状态和错误处理
- 资源清理（Blob URL 释放）

**关键实现要点**：
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import VueOfficeDocx from '@vue-office/docx';
import '@vue-office/docx/lib/index.css';
import type { PreviewComponent, PreviewOptions } from '@/types/preview';
import { readFileAsBlob } from '@/utils/file-utils';

// 状态管理
const loading = ref(true);
const error = ref<string | null>(null);
const docxBlob = ref<Blob | null>(null);
const scale = ref(1.0);

/**
 * 加载文档
 */
async function loadDocument(filePath: string): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    
    // 读取文件为 Blob
    const blob = await readFileAsBlob(filePath);
    docxBlob.value = blob;
    
  } catch (err: any) {
    error.value = `加载失败: ${err.message}`;
  } finally {
    loading.value = false;
  }
}

/**
 * 销毁组件，释放资源
 */
function destroy() {
  // 释放 Blob URL
  if (docxBlob.value) {
    URL.revokeObjectURL(URL.createObjectURL(docxBlob.value));
    docxBlob.value = null;
  }
  
  // 重置状态
  loading.value = false;
  error.value = null;
  scale.value = 1.0;
}

// 生命周期钩子确保资源清理
onUnmounted(() => {
  destroy();
});

// 暴露接口
defineExpose<PreviewComponent>({
  loadDocument,
  destroy,
  loading,
  error,
  scale
});
</script>
```

#### 2.4 Excel 预览组件（ExcelPreview.vue）

**位置**：`frontend/src/components/preview/ExcelPreview.vue`（新建）

**核心功能**：
- 使用 `@vue-office/excel` 渲染 Excel 表格
- Sheet 切换功能
- 支持缩放控制
- 资源清理

**特殊要求**：
- 支持多 Sheet 切换
- 保持表格格式和公式
- 支持单元格选中和高亮

#### 2.5 PDF 预览组件（PdfPreview.vue）

**位置**：`frontend/src/components/preview/PdfPreview.vue`（新建）

**核心功能**：
- 使用 `@vue-office/pdf` 渲染 PDF 文档
- 页码导航（上一页/下一页/跳转）
- 缩放控制
- 旋转功能（可选）
- 资源清理

**特殊要求**：
- 支持页码显示和快速跳转
- 保持 PDF 原始布局和字体
- 支持文本选择和复制

#### 2.6 PowerPoint 预览组件（PptxPreview.vue）

**位置**：`frontend/src/components/preview/PptxPreview.vue`（新建）

**核心功能**：
- 使用 `@vue-office/pptx` 渲染 PowerPoint 演示文稿
- 幻灯片切换（上一张/下一张）
- 缩略图导航（可选）
- 全屏播放模式（可选）
- 资源清理

**特殊要求**：
- 保持动画和过渡效果（如果支持）
- 支持备注显示（可选）
- 支持演讲者视图（可选）

---

### 3. 统一预览容器

#### 3.1 NativePreviewContainer.vue

**位置**：`frontend/src/components/preview/NativePreviewContainer.vue`（新建）

**职责**：
- 根据文件类型动态加载对应的预览组件
- 统一管理加载状态和错误处理
- 提供统一的工具栏（缩放、翻页等）
- 协调不同预览组件的行为
- **实现自动降级策略**：原生预览失败时自动降级到文本预览

**实现要点**：
```vue
<template>
  <div class="native-preview-container">
    <!-- 动态加载预览组件 -->
    <component
      :is="currentComponent"
      v-if="currentComponent"
      ref="previewComponentRef"
      :file-path="filePath"
      :options="previewOptions"
      @loaded="onLoaded"
      @error="onError"
    />
    
    <!-- 降级到文本预览 -->
    <TextPreview
      v-else-if="fallbackToText"
      :file-path="filePath"
      :highlights="highlights"
    />
    
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <p>正在加载预览...</p>
    </div>
    
    <!-- 错误状态 -->
    <div v-if="error && !fallbackToText" class="error-overlay">
      <svg class="error-icon"><use href="#icon-error"/></svg>
      <p>{{ error }}</p>
      <button @click="retry" class="btn-retry">重试</button>
      <button @click="fallbackToTextMode" class="btn-fallback">
        切换到文本预览
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, markRaw, onUnmounted } from 'vue';
import { determinePreviewRoute, PreviewMode } from '@/utils/preview-router';
import type { PreviewComponent, PreviewOptions } from '@/types/preview';
import TextPreview from './TextPreview.vue';

const props = defineProps<{
  filePath: string;
  highlights?: HighlightRange[];
}>();

// 动态组件
const currentComponent = ref<any>(null);
const previewComponentRef = ref<PreviewComponent | null>(null);

// 状态
const loading = ref(true);
const error = ref<string | null>(null);
const fallbackToText = ref(false);

// 预览选项
const previewOptions = computed<PreviewOptions>(() => ({
  initialScale: 1.0,
  maxScale: 3.0,
  minScale: 0.5,
  enableHighlight: !!props.highlights,
  highlights: props.highlights
}));

/**
 * 根据文件类型加载对应组件
 */
async function loadPreviewComponent() {
  try {
    loading.value = true;
    error.value = null;
    fallbackToText.value = false;
    
    const route = determinePreviewRoute(props.filePath);
    
    if (route.mode === PreviewMode.NATIVE && route.component) {
      // 动态导入组件（懒加载，减少初始包体积）
      let component: any;
      
      switch (route.component) {
        case 'VueOfficeDocx':
          component = await import('./DocxPreview.vue');
          break;
        case 'VueOfficeExcel':
          component = await import('./ExcelPreview.vue');
          break;
        case 'VueOfficePdf':
          component = await import('./PdfPreview.vue');
          break;
        case 'VueOfficePptx':
          component = await import('./PptxPreview.vue');
          break;
        default:
          throw new Error(`未知的预览组件: ${route.component}`);
      }
      
      // 使用 markRaw 避免响应式开销
      currentComponent.value = markRaw(component.default);
      
    } else {
      // 降级到文本预览
      fallbackToText.value = true;
    }
    
  } catch (err: any) {
    error.value = `加载预览组件失败: ${err.message}`;
    console.error('[NativePreviewContainer]', err);
  } finally {
    loading.value = false;
  }
}

/**
 * 重试加载
 */
async function retry() {
  await loadPreviewComponent();
}

/**
 * 切换到文本预览模式
 */
function fallbackToTextMode() {
  fallbackToText.value = true;
  error.value = null;
}

/**
 * 加载完成回调
 */
function onLoaded() {
  loading.value = false;
}

/**
 * 错误处理（自动降级策略）
 */
function onError(err: string) {
  error.value = err;
  loading.value = false;
  
  // 自动降级到文本预览
  console.warn('[NativePreviewContainer] 原生预览失败，降级到文本预览:', err);
  fallbackToText.value = true;
}

// 初始化
loadPreviewComponent();

// 清理资源
onUnmounted(() => {
  if (previewComponentRef.value) {
    previewComponentRef.value.destroy();
  }
});
</script>
```

---

### 4. 文件读取工具

#### 4.1 readFileAsBlob 函数

**位置**：`frontend/src/utils/file-utils.ts`（扩展现有文件）

```typescript
/**
 * 读取文件为 Blob 对象
 * 
 * @param filePath 文件路径（绝对路径）
 * @returns Promise<Blob>
 */
export async function readFileAsBlob(filePath: string): Promise<Blob> {
  try {
    // 通过 Electron IPC 调用主进程读取文件
    const result = await window.electronAPI.readFileAsBlob(filePath);
    
    if (!result.success) {
      throw new Error(result.error || '读取文件失败');
    }
    
    return result.blob;
  } catch (error: any) {
    console.error('[readFileAsBlob] 失败:', error);
    throw error;
  }
}
```

#### 4.2 主进程 IPC 处理器

**位置**：`src/core/main/ipc-handlers.ts`（扩展现有文件）

```typescript
// 读取文件为 Blob（用于预览）
ipcMain.handle('read-file-as-blob', async (_, filePath: string) => {
  try {
    // 安全检查：验证文件路径
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    // 读取文件
    const buffer = await fs.promises.readFile(filePath);
    
    // 转换为 Blob（通过 ArrayBuffer）
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    
    return {
      success: true,
      blob: new Blob([arrayBuffer])
    };
  } catch (error: any) {
    mainLogger.error('[read-file-as-blob] 失败:', error.message);
    return { success: false, error: error.message };
  }
});
```

---

## 🔌 Electron 主进程需求

### 1. 后端代码组织架构

**核心原则**：与前端保持一致的模块化设计，职责清晰，易于维护

#### 1.1 目录结构

```
src/
├── core/
│   ├── main/                       # 主进程核心模块
│   │   ├── index.ts                # 主进程入口（现有）
│   │   ├── ipc-handlers.ts         # IPC 处理器（扩展）
│   │   ├── window-manager.ts       # 窗口管理（现有）
│   │   └── power-save.ts           # 电源管理（现有）
│   ├── preview/                    # 预览功能模块（新建）
│   │   ├── index.ts                # 统一导出
│   │   ├── handlers/               # IPC 处理器
│   │   │   ├── file-reader.ts      # 文件读取处理器
│   │   │   ├── stream-handler.ts   # 流式处理 handler
│   │   │   └── stats-handler.ts    # 文件信息 handler
│   │   ├── services/               # 业务服务层
│   │   │   ├── file-cache.ts       # 文件缓存服务
│   │   │   ├── concurrency-control.ts  # 并发控制服务
│   │   │   └── mime-detector.ts    # MIME 类型检测
│   │   ├── validators/             # 验证器
│   │   │   ├── path-validator.ts   # 路径验证器
│   │   │   └── size-validator.ts   # 大小验证器
│   │   ├── utils/                  # 工具函数
│   │   │   ├── stream-converter.ts # Stream 转换工具
│   │   │   └── buffer-utils.ts     # Buffer 工具函数
│   │   ├── errors/                 # 错误处理
│   │   │   ├── preview-error.ts    # 预览错误定义
│   │   │   └── error-handler.ts    # 错误处理器
│   │   └── metrics/                # 性能监控
│   │       ├── metrics-collector.ts    # 指标收集器
│   │       └── performance-monitor.ts  # 性能监控器
│   └── ...
├── types/
│   ├── preview.ts                  # 预览相关类型（新建）
│   └── electron.d.ts               # Electron API 类型定义（新建）
├── preload.ts                      # Preload 脚本（扩展）
└── main.ts                         # 应用入口（现有）
```

#### 1.2 模块职责说明

| 模块 | 职责 | 关键文件 |
|------|------|----------|
| **handlers/** | 处理来自渲染进程的 IPC 请求 | `file-reader.ts`, `stream-handler.ts` |
| **services/** | 核心业务逻辑（缓存、并发控制） | `file-cache.ts`, `concurrency-control.ts` |
| **validators/** | 安全验证（路径、大小） | `path-validator.ts`, `size-validator.ts` |
| **utils/** | 通用工具函数 | `stream-converter.ts`, `buffer-utils.ts` |
| **errors/** | 错误定义和处理 | `preview-error.ts`, `error-handler.ts` |
| **metrics/** | 性能监控和统计 | `metrics-collector.ts` |

#### 1.3 依赖关系图

```
ipc-handlers.ts (主入口)
  ↓
handlers/ (具体 handler)
  ↓
services/ (业务逻辑)
  ↓
validators/ (安全验证) + utils/ (工具函数)
  ↓
errors/ (错误处理) + metrics/ (性能监控)
```

**禁止的依赖关系**：
- ❌ handlers 不能直接访问 validators（应通过 services）
- ❌ utils 不能导入 services（避免循环依赖）
- ❌ errors 不能依赖业务逻辑

---

### 2. IPC 通信接口

#### 2.1 文件读取接口

**位置**：`src/core/main/ipc-handlers.ts`（扩展现有文件）

##### 2.1.1 读取文件为 Blob

```typescript
/**
 * 读取文件为 Blob 对象（用于原生预览）
 * 
 * @param filePath 文件绝对路径
 * @returns Promise<{ success: boolean; blob?: Blob; error?: string }>
 */
ipcMain.handle('read-file-as-blob', async (_, filePath: string) => {
  try {
    // 安全检查：验证文件路径
    if (!validateFilePath(filePath)) {
      return { success: false, error: '不允许访问该文件' };
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    // 检查文件大小
    const stats = await fs.promises.stat(filePath);
    const MAX_PREVIEW_SIZE_MB = 100;
    
    if (stats.size > MAX_PREVIEW_SIZE_MB * 1024 * 1024) {
      return {
        success: false,
        error: `文件过大（${(stats.size / 1024 / 1024).toFixed(2)}MB），无法预览`
      };
    }
    
    // 读取文件
    const buffer = await fs.promises.readFile(filePath);
    
    // 转换为 ArrayBuffer（渲染进程可以从中创建 Blob）
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    
    return {
      success: true,
      data: arrayBuffer,
      size: stats.size,
      mimeType: getMimeType(filePath)
    };
  } catch (error: any) {
    mainLogger.error('[read-file-as-blob] 失败:', error.message);
    return { success: false, error: error.message };
  }
});
```

##### 2.1.2 PDF 流式加载方案（已调整）

**重要说明**：
> ⚠️ Electron IPC 不支持直接传递 Web ReadableStream 对象。
> 
> **推荐方案**：使用分块读取模拟流式加载（已在 2.1.3 实现）
> 
> **替代方案**：注册自定义协议（高级用法，见下方说明）

**当前实现**：使用 `read-file-chunk` 接口实现伪流式加载

```typescript
// 渲染进程：分块读取实现流式效果
async function loadPdfInChunks(filePath: string, onProgress?: (progress: number) => void) {
  const stats = await window.electronAPI.getFileStats(filePath);
  if (!stats.success || !stats.stats) {
    throw new Error('无法获取文件信息');
  }
  
  const totalSize = stats.stats.size;
  const chunkSize = 1024 * 1024; // 1MB 分块
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  
  while (offset < totalSize) {
    const result = await window.electronAPI.readFileChunk(
      filePath,
      offset,
      Math.min(chunkSize, totalSize - offset)
    );
    
    if (!result.success || !result.chunk) {
      throw new Error('读取文件块失败');
    }
    
    chunks.push(result.chunk);
    offset += result.chunk.byteLength;
    
    // 更新进度
    if (onProgress) {
      onProgress((offset / totalSize) * 100);
    }
    
    // 让出主线程，避免阻塞 UI
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // 合并所有分块
  return mergeArrayBuffers(chunks);
}

function mergeArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const buffer of buffers) {
    merged.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  
  return merged.buffer;
}
```

**性能优化**：
- ✅ 每读取 1MB 让出主线程，保持 UI 响应
- ✅ 实时进度回调，显示加载进度条
- ✅ 适合 50-100MB 的 PDF 文件

---

**附录：自定义协议方案（可选，高级用法）**

如果确实需要真正的流式加载，可以注册自定义协议：

```typescript
// 主进程：注册自定义协议（src/core/main/custom-protocol.ts）
import { protocol } from 'electron';
import { createReadStream } from 'fs';

export function registerPreviewProtocol() {
  protocol.registerBufferProtocol('preview', (request, callback) => {
    try {
      const filePath = decodeURIComponent(request.url.replace('preview://', ''));
      
      // 安全验证
      if (!validateFilePath(filePath)) {
        callback({ statusCode: 403 });
        return;
      }
      
      const stream = createReadStream(filePath);
      let data = Buffer.alloc(0);
      
      stream.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
      });
      
      stream.on('end', () => {
        callback({
          mimeType: getMimeType(filePath),
          data: data
        });
      });
      
      stream.on('error', () => {
        callback({ statusCode: 500 });
      });
    } catch (error) {
      callback({ statusCode: 500 });
    }
  });
}

// 在 main.ts 中调用
registerPreviewProtocol();

// 渲染进程：直接使用 URL
const previewUrl = `preview://${encodeURIComponent(filePath)}`;
<VueOfficePdf :src="previewUrl" />
```

**注意**：自定义协议方案会将整个文件加载到内存，不适合超大文件（>100MB）。

##### 2.1.3 分块读取文件（伪流式预览）

```typescript
/**
 * 分块读取文件（用于 Word/Excel/PPT 的伪流式加载）
 * 
 * @param filePath 文件绝对路径
 * @param offset 起始偏移量（字节）
 * @param size 读取大小（字节）
 * @returns Promise<{ success: boolean; chunk?: ArrayBuffer; error?: string }>
 */
ipcMain.handle('read-file-chunk', async (_, filePath: string, offset: number, size: number) => {
  try {
    // 安全检查
    if (!validateFilePath(filePath)) {
      return { success: false, error: '不允许访问该文件' };
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    const stats = await fs.promises.stat(filePath);
    
    // 验证偏移量和大小
    if (offset < 0 || offset >= stats.size) {
      return { success: false, error: '无效的偏移量' };
    }
    
    if (size <= 0) {
      return { success: false, error: '无效的大小' };
    }
    
    // 调整读取大小，避免超出文件末尾
    const actualSize = Math.min(size, stats.size - offset);
    
    // 打开文件并读取指定范围
    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(actualSize);
    
    await fd.read(buffer, 0, actualSize, offset);
    await fd.close();
    
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    
    return {
      success: true,
      chunk: arrayBuffer,
      bytesRead: actualSize
    };
  } catch (error: any) {
    mainLogger.error('[read-file-chunk] 失败:', error.message);
    return { success: false, error: error.message };
  }
});
```

##### 2.1.4 获取文件信息

```typescript
/**
 * 获取文件基本信息
 * 
 * @param filePath 文件绝对路径
 * @returns Promise<{ success: boolean; stats?: FileStats; error?: string }>
 */
ipcMain.handle('get-file-stats', async (_, filePath: string) => {
  try {
    if (!validateFilePath(filePath)) {
      return { success: false, error: '不允许访问该文件' };
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    const stats = await fs.promises.stat(filePath);
    
    return {
      success: true,
      stats: {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      }
    };
  } catch (error: any) {
    mainLogger.error('[get-file-stats] 失败:', error.message);
    return { success: false, error: error.message };
  }
});
```

#### 2.2 安全验证函数

```typescript
/**
 * 验证文件路径是否允许访问
 * 
 * @param filePath 待验证的文件路径
 * @returns boolean
 */
function validateFilePath(filePath: string): boolean {
  try {
    const resolvedPath = path.resolve(filePath);
    
    // 获取允许的路径前缀列表
    const allowedPrefixes = [
      app.getPath('userData'),
      app.getPath('downloads'),
      ...getConfig().allowedScanPaths || []
    ];
    
    // 检查是否在允许的目录中
    return allowedPrefixes.some(prefix => {
      const normalizedPrefix = path.resolve(prefix);
      
      // 确保是完整的路径前缀，防止路径遍历攻击
      // 例如：/home/user/data vs /home/user/data-backup
      return resolvedPath === normalizedPrefix || 
             resolvedPath.startsWith(normalizedPrefix + path.sep);
    });
  } catch (error) {
    mainLogger.error('[validateFilePath] 验证失败:', error);
    return false;
  }
}

/**
 * 根据文件扩展名获取 MIME 类型
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  const mimeTypes: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 验证文件类型（通过魔数检查）
 * 
 * @param filePath 文件路径
 * @param expectedExt 期望的文件扩展名
 * @returns boolean
 */
async function validateFileType(filePath: string, expectedExt: string): Promise<boolean> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    // 只检查支持的格式
    const magicNumbers: Record<string, Buffer> = {
      '.pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]),           // %PDF
      '.docx': Buffer.from([0x50, 0x4B, 0x03, 0x04]),          // PK..
      '.xlsx': Buffer.from([0x50, 0x4B, 0x03, 0x04]),          // PK..
      '.pptx': Buffer.from([0x50, 0x4B, 0x03, 0x04]),          // PK..
      '.xls': Buffer.from([0xD0, 0xCF, 0x11, 0xE0]),           // OLE2
      '.doc': Buffer.from([0xD0, 0xCF, 0x11, 0xE0])            // OLE2
    };
    
    const expectedMagic = magicNumbers[ext];
    if (!expectedMagic) {
      // 未知类型，跳过检查
      return true;
    }
    
    // 读取文件头 8 字节
    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(8);
    await fd.read(buffer, 0, 8, 0);
    await fd.close();
    
    // 检查魔数
    return buffer.slice(0, expectedMagic.length).equals(expectedMagic);
  } catch (error) {
    mainLogger.error('[validateFileType] 验证失败:', error);
    return false;
  }
}
```

---

### 3. Preload 脚本接口

**位置**：`src/preload.ts`（扩展现有文件）

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcResponse } from './types/preview';

// 暴露预览相关的 IPC 接口给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有接口
  
  // 预览相关接口
  readFileAsBlob: (filePath: string): Promise<IpcResponse<{
    data: ArrayBuffer;
    size: number;
    mimeType: string;
  }>> => ipcRenderer.invoke('read-file-as-blob', filePath),
  
  readFileChunk: (
    filePath: string,
    offset: number,
    size: number
  ): Promise<IpcResponse<{
    chunk: ArrayBuffer;
    bytesRead: number;
  }>> => ipcRenderer.invoke('read-file-chunk', filePath, offset, size),
  
  getFileStats: (filePath: string): Promise<IpcResponse<{
    size: number;
    created: Date;
    modified: Date;
    isFile: boolean;
    isDirectory: boolean;
  }>> => ipcRenderer.invoke('get-file-stats', filePath)
});
```

**类型定义文件**：

```typescript
// src/types/electron.d.ts

import type { IpcResponse } from './preview';

export interface ElectronAPI {
  // ... 现有接口
  
  // 预览相关接口
  readFileAsBlob: (filePath: string) => Promise<IpcResponse<{
    data: ArrayBuffer;
    size: number;
    mimeType: string;
  }>>;
  
  readFileChunk: (
    filePath: string,
    offset: number,
    size: number
  ) => Promise<IpcResponse<{
    chunk: ArrayBuffer;
    bytesRead: number;
  }>>;
  
  getFileStats: (filePath: string) => Promise<IpcResponse<{
    size: number;
    created: Date;
    modified: Date;
    isFile: boolean;
    isDirectory: boolean;
  }>>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

---

### 4. 性能优化要求

#### 4.1 文件缓存策略

**位置**：`src/core/main/file-cache.ts`（新建）

```typescript
import { LRUCache } from 'lru-cache';

interface CachedFile {
  data: Buffer;
  timestamp: number;
  accessCount: number;
  ttl: number; // 生存时间（毫秒）
  windowId?: string; // 所属窗口 ID（用于清理）
}

/**
 * 文件缓存管理器
 */
class FileCacheManager {
  private cache: LRUCache<string, CachedFile>;
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5分钟
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  
  constructor(maxSize: number = 50 * 1024 * 1024) {
    this.cache = new LRUCache({
      max: 10,  // 最多缓存 10 个文件
      maxSize: maxSize,
      sizeCalculation: (value) => value.data.length,
      ttl: this.DEFAULT_TTL  // 自动过期
    });
  }
  
  /**
   * 缓存文件
   */
  set(filePath: string, data: Buffer, windowId?: string, ttl?: number): void {
    // 超过限制的文件不缓存
    if (data.length > this.MAX_FILE_SIZE) {
      return;
    }
    
    this.cache.set(filePath, {
      data,
      timestamp: Date.now(),
      accessCount: 0,
      ttl: ttl || this.DEFAULT_TTL,
      windowId
    });
  }
  
  /**
   * 获取缓存的文件
   */
  get(filePath: string): Buffer | undefined {
    const cached = this.cache.get(filePath);
    
    if (cached) {
      cached.accessCount++;
      return cached.data;
    }
    
    return undefined;
  }
  
  /**
   * 清除指定窗口的缓存
   */
  clearForWindow(windowId: string): void {
    for (const [key, value] of this.cache.entries()) {
      if (value.windowId === windowId) {
        this.cache.delete(key);
      }
    }
  }
  
  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * 删除指定文件的缓存
   */
  delete(filePath: string): void {
    this.cache.delete(filePath);
  }
  
  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      size: this.cache.calculatedSize,
      itemCount: this.cache.size,
      hitRate: this.getHitRate()
    };
  }
  
  private getHitRate(): number {
    const stats = this.cache.stats;
    if (!stats) return 0;
    const total = stats.hits + stats.misses;
    return total > 0 ? (stats.hits / total) * 100 : 0;
  }
}

export const fileCache = new FileCacheManager();
```

#### 4.2 内存管理

**说明**：由于预览功能是单例模态对话框，同一时间只会预览一个文件，因此**不需要并发控制**。

**但仍需要注意内存管理**：

1. **及时释放大对象**
   ```typescript
   // 预览窗口关闭时清理资源
   onUnmounted(() => {
     // 清除缓存的 ArrayBuffer
     cachedFileData.value = null;
     
     // 清理事件监听器
     window.removeEventListener('beforeunload', handleBeforeUnload);
     
     // 强制 GC（如果需要）
     if ((global as any).gc) {
       (global as any).gc();
     }
   });
   ```

2. **限制单次加载的文件大小**
   ```typescript
   const MAX_FILE_SIZE_MB = 100;
   
   async function loadFile(filePath: string) {
     const stats = await window.electronAPI.getFileStats(filePath);
     
     if (!stats.success || !stats.stats) {
       throw new Error('无法获取文件信息');
     }
     
     const fileSizeMB = stats.stats.size / (1024 * 1024);
     
     if (fileSizeMB > MAX_FILE_SIZE_MB) {
       throw new Error(`文件过大 (${fileSizeMB.toFixed(1)}MB)，超过限制 (${MAX_FILE_SIZE_MB}MB)`);
     }
     
     // 继续加载...
   }
   ```

3. **使用流式加载处理大文件**
   - PDF：使用 pdf.js 的流式加载（原生支持）
   - Word/Excel/PPT：分块读取，避免一次性加载到内存

---

### 5. 错误处理与日志

#### 5.1 统一错误类型定义

**位置**：`src/types/preview.ts`

```typescript
/**
 * 统一的 IPC 响应格式
 */
export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: PreviewErrorType;
}

/**
 * 预览错误类型枚举
 */
export enum PreviewErrorType {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  READ_ERROR = 'READ_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  TIMEOUT = 'TIMEOUT'
}
```

#### 5.2 统一错误处理

```typescript
// src/core/main/preview-error-handler.ts

export enum PreviewErrorType {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  READ_ERROR = 'READ_ERROR',
  TIMEOUT = 'TIMEOUT'
}

export function handlePreviewError(error: any): {
  success: false;
  error: string;
  errorCode: PreviewErrorType;
} {
  let errorType: PreviewErrorType;
  let userMessage: string;
  
  if (error.code === 'ENOENT') {
    errorType = PreviewErrorType.FILE_NOT_FOUND;
    userMessage = '文件不存在';
  } else if (error.code === 'EACCES') {
    errorType = PreviewErrorType.ACCESS_DENIED;
    userMessage = '没有权限访问该文件';
  } else if (error.message?.includes('too large')) {
    errorType = PreviewErrorType.FILE_TOO_LARGE;
    userMessage = '文件过大，无法预览';
  } else if (error.message?.includes('timeout')) {
    errorType = PreviewErrorType.TIMEOUT;
    userMessage = '加载超时，请重试';
  } else {
    errorType = PreviewErrorType.READ_ERROR;
    userMessage = '文件读取失败';
  }
  
  mainLogger.error(`[Preview Error] ${errorType}:`, {
    message: error.message,
    stack: error.stack
  });
  
  return {
    success: false,
    error: userMessage,
    errorCode: errorType
  };
}
```

#### 5.2 性能监控

```typescript
// src/core/main/preview-metrics.ts

interface PreviewMetrics {
  totalRequests: number;
  successfulLoads: number;
  failedLoads: number;
  fallbackToText: number;
  averageLoadTime: number;
}

class PreviewMetricsCollector {
  private metrics: PreviewMetrics = {
    totalRequests: 0,
    successfulLoads: 0,
    failedLoads: 0,
    fallbackToText: 0,
    averageLoadTime: 0
  };
  
  private loadTimes: number[] = [];
  
  recordRequest() {
    this.metrics.totalRequests++;
  }
  
  recordSuccess(loadTime: number) {
    this.metrics.successfulLoads++;
    this.loadTimes.push(loadTime);
    this.updateAverageLoadTime();
  }
  
  recordFailure() {
    this.metrics.failedLoads++;
  }
  
  recordFallback() {
    this.metrics.fallbackToText++;
  }
  
  private updateAverageLoadTime() {
    if (this.loadTimes.length > 0) {
      const sum = this.loadTimes.reduce((a, b) => a + b, 0);
      this.metrics.averageLoadTime = sum / this.loadTimes.length;
    }
  }
  
  getMetrics(): PreviewMetrics {
    return { ...this.metrics };
  }
}

export const previewMetrics = new PreviewMetricsCollector();
```

---

## 🔄 统一降级策略

### 1. 降级触发条件

以下情况会触发自动降级到文本预览：

1. **组件加载失败**：动态导入预览组件时出错
2. **文件读取失败**：无法读取文件或文件格式损坏
3. **渲染错误**：@vue-office 组件渲染过程中抛出异常
4. **超时**：预览加载超过 30 秒仍未完成
5. **内存不足**：大文件导致内存溢出

### 2. 降级流程

```
开始预览
  ↓
尝试原生预览（@vue-office 组件）
  ↓
┌──────────────┐
│ 是否成功？    │
└──────┬───────┘
       │
   Yes ├────────→ 显示原生预览
       │
   No  ↓
记录错误日志
       ↓
自动切换到 TextPreview
       ↓
提取文本内容 + 应用高亮
       ↓
显示文本预览
```

### 3. 降级实现细节

#### 3.1 错误捕获

```typescript
// 在每个预览组件中捕获错误
try {
  await loadDocument(filePath);
} catch (error: any) {
  console.error('[DocxPreview] 加载失败:', error);
  emit('error', error.message);
  // NativePreviewContainer 接收到 error 事件后自动降级
}
```

#### 3.2 超时检测

```typescript
// NativePreviewContainer.vue
const LOAD_TIMEOUT = 30000; // 30秒

async function loadPreviewComponent() {
  const timeoutId = setTimeout(() => {
    if (loading.value) {
      console.warn('[NativePreviewContainer] 加载超时，降级到文本预览');
      fallbackToText.value = true;
      loading.value = false;
      error.value = '加载超时';
    }
  }, LOAD_TIMEOUT);
  
  try {
    // ... 加载逻辑
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 3.3 文本提取

降级后需要从原始文件中提取文本：

```typescript
// frontend/src/components/preview/TextPreview.vue

import { extractTextFromFile } from '@/extractors';

async function loadTextPreview(filePath: string) {
  try {
    const { text } = await extractTextFromFile(filePath);
    content.value = text;
    
    // 应用高亮
    if (props.highlights) {
      applyHighlights(text, props.highlights);
    }
  } catch (error: any) {
    error.value = `文本提取失败: ${error.message}`;
  }
}
```

### 4. 用户体验优化

#### 4.1 平滑过渡

```vue
<template>
  <Transition name="fade" mode="out-in">
    <component :is="currentComponent" v-if="!fallbackToText" />
    <TextPreview v-else />
  </Transition>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
```

#### 4.2 用户提示

```vue
<div v-if="fallbackToText" class="fallback-notice">
  <svg class="info-icon"><use href="#icon-info"/></svg>
  <span>原生预览不可用，已切换到文本模式</span>
  <button @click="retry" class="btn-retry">重试原生预览</button>
</div>
```

#### 4.3 重试机制

用户可以手动重试原生预览：

```typescript
function retryNativePreview() {
  fallbackToText.value = false;
  error.value = null;
  loadPreviewComponent();
}
```

### 5. 降级策略的优势

✅ **保证可用性**：即使原生预览失败，用户仍可查看文件内容  
✅ **保留高亮功能**：文本预览模式下敏感信息仍然高亮显示  
✅ **用户体验友好**：自动降级无需用户干预，平滑过渡  
✅ **可恢复性**：提供重试按钮，允许用户重新尝试原生预览  
✅ **错误追踪**：记录降级原因，便于后续优化

---

### 5. 与现有预览窗口集成

#### 5.1 PreviewModal.vue 改造

**位置**：`frontend/src/components/PreviewModal.vue`（修改现有文件）

**改造要点**：
1. **条件渲染**：根据文件类型选择预览模式
2. **保持兼容**：文本预览功能保持不变
3. **统一接口**：两种预览模式共享相同的打开/关闭逻辑

```vue
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="preview-modal-overlay" @click.self="close">
        <div class="preview-modal" :style="{ width: modalWidth, height: modalHeight }">
          <!-- 模态框头部 -->
          <div class="modal-header">
            <h3 class="modal-title">{{ fileName }}</h3>
            <div class="modal-actions">
              <button @click="close" class="btn-close" title="关闭">
                <svg><use href="#icon-close"/></svg>
              </button>
            </div>
          </div>
          
          <!-- 预览内容区域 -->
          <div class="modal-body">
            <!-- 原生格式预览 -->
            <NativePreviewContainer
              v-if="previewMode === 'native'"
              :file-path="filePath"
              :highlights="highlights"
            />
            
            <!-- 文本预览（现有） -->
            <TextPreview
              v-else
              :file-path="filePath"
              :highlights="highlights"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { determinePreviewRoute, PreviewMode } from '@/utils/preview-router';
import NativePreviewContainer from './preview/NativePreviewContainer.vue';
import TextPreview from './preview/TextPreview.vue'; // 现有组件

const props = defineProps<{
  filePath: string;
  visible: boolean;
  highlights?: HighlightRange[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// 计算预览模式
const previewMode = computed(() => {
  const route = determinePreviewRoute(props.filePath);
  return route.mode;
});

// 文件名
const fileName = computed(() => {
  return props.filePath.split(/[\\/]/).pop() || '';
});

// 模态框尺寸
const modalWidth = '90vw';
const modalHeight = '85vh';

/**
 * 关闭模态框
 */
function close() {
  emit('close');
}

// 监听可见性变化，清理资源
watch(() => props.visible, (newVal) => {
  if (!newVal) {
    // 模态框关闭时，清理预览组件资源
    // （由 NativePreviewContainer 的 onUnmounted 处理）
  }
});
</script>
```

---

## 🔧 技术架构要求

### 1. 代码质量规范

#### 1.1 模块职责单一

**原则**：每个模块只负责一个明确的职责

✅ **正确示例**：
```typescript
// DocxPreview.vue - 只负责 Word 文档预览
// ExcelPreview.vue - 只负责 Excel 表格预览
// preview-router.ts - 只负责路由决策
```

❌ **错误示例**：
```typescript
// PreviewManager.vue - 同时处理路由、渲染、状态管理（违反单一职责）
```

#### 1.2 依赖关系清晰

**原则**：模块间依赖明确，避免循环依赖

```
依赖方向：
PreviewModal.vue
  ↓
NativePreviewContainer.vue
  ↓
DocxPreview.vue / ExcelPreview.vue / PdfPreview.vue / PptxPreview.vue
  ↓
@vue-office/* 第三方库
  ↓
file-utils.ts（文件读取）
  ↓
IPC Handlers（主进程）
```

**禁止**：
- ❌ 循环依赖（A → B → A）
- ❌ 跨层级直接访问（PreviewModal 直接访问 @vue-office）

#### 1.3 类型安全

**原则**：无 TypeScript 类型错误，充分利用类型系统

**要求**：
1. 所有组件 props 必须有明确的类型定义
2. 所有函数返回值必须标注类型
3. 使用 `interface` 或 `type` 定义数据结构
4. 避免使用 `any` 类型（除非必要，需注释说明）
5. 使用泛型提高代码复用性

**示例**：
```typescript
// ✅ 正确：明确的类型定义
interface PreviewComponent {
  loadDocument(filePath: string): Promise<void>;
  destroy(): void;
  loading: Ref<boolean>;
}

// ❌ 错误：使用 any
interface PreviewComponent {
  loadDocument(filePath: any): Promise<any>;
  destroy(): any;
}
```

#### 1.4 内存安全

**原则**：无内存泄漏风险，及时释放资源

**关键措施**：
1. **Blob URL 释放**：
```typescript
onUnmounted(() => {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
  }
});
```

2. **事件监听器清理**：
```typescript
onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});
```

3. **定时器清理**：
```typescript
onUnmounted(() => {
  if (timerId) {
    clearTimeout(timerId);
  }
});
```

4. **大型对象置空**：
```typescript
function destroy() {
  largeData.value = null;
  cache.clear();
}
```

---

### 2. 性能优化要求

#### 2.1 懒加载策略

**原则**：按需加载预览组件，减少初始包体积

```typescript
// 动态导入（Webpack/Vite 自动代码分割）
const DocxPreview = () => import('./DocxPreview.vue');
const ExcelPreview = () => import('./ExcelPreview.vue');
```

**优势**：
- 初始加载只包含文本预览组件
- 用户首次打开 Word 文档时才加载 DocxPreview
- 减少首屏加载时间 30-50%

#### 2.2 虚拟滚动（针对超大文档）

**适用场景**：
- Excel 表格超过 1000 行
- Word 文档超过 100 页

**实现方案**：
```vue
<RecycleScroller
  :items="rows"
  :item-size="30"
  key-field="id"
>
  <template #default="{ item }">
    <TableRow :data="item" />
  </template>
</RecycleScroller>
```

#### 2.3 缓存策略

**原则**：合理缓存已加载的文档，避免重复加载

```typescript
// 简单的 LRU 缓存
class PreviewCache {
  private cache = new Map<string, Blob>();
  private maxSize = 10; // 最多缓存 10 个文档
  
  get(key: string): Blob | undefined {
    const item = this.cache.get(key);
    if (item) {
      // 移动到最近使用
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }
  
  set(key: string, value: Blob): void {
    if (this.cache.size >= this.maxSize) {
      // 删除最久未使用的
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}
```

#### 2.4 Web Worker 卸载（可选优化）

**适用场景**：超大文件（>50MB）解析

**实现方案**：
```typescript
// 在 Worker 中解析文档，避免阻塞主线程
const worker = new Worker('./preview-worker.ts');
worker.postMessage({ filePath, type: 'docx' });
worker.onmessage = (event) => {
  const blob = event.data;
  renderDocument(blob);
};
```

---

### 3. 安全要求

#### 3.1 文件路径验证

**原则**：防止路径遍历攻击

```typescript
// 主进程：验证文件路径
function validateFilePath(filePath: string): boolean {
  const userDataPath = app.getPath('userData');
  const resolvedPath = path.resolve(filePath);
  
  // 允许的路径前缀
  const allowedPrefixes = [
    path.resolve(userDataPath),
    ...userConfig.allowedScanPaths
  ];
  
  return allowedPrefixes.some(prefix => 
    resolvedPath.startsWith(prefix)
  );
}
```

#### 3.2 文件大小限制

**原则**：防止超大文件导致 OOM

```typescript
const MAX_PREVIEW_SIZE_MB = 100; // 预览文件最大 100MB

if (fileSize > MAX_PREVIEW_SIZE_MB * 1024 * 1024) {
  throw new Error(`文件过大（${(fileSize / 1024 / 1024).toFixed(2)}MB），无法预览`);
}
```

#### 3.3 沙箱隔离

**原则**：第三方库运行在沙箱环境中

```typescript
// 使用 iframe 隔离（如果 @vue-office 支持）
<iframe
  :srcdoc="documentHtml"
  sandbox="allow-same-origin"
/>
```

#### 3.4 XSS 防护

**原则**：防止恶意脚本注入

```typescript
// 转义 HTML 特殊字符
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

---

### 4. UI/UX 设计要求

#### 4.1 一致性原则

**要求**：
- 所有预览组件的工具栏位置和样式保持一致
- 加载状态和错误提示风格统一
- 快捷键行为一致（Ctrl++ 放大，Ctrl+- 缩小）

#### 4.2 响应式设计

**要求**：
- 支持不同屏幕尺寸（桌面端优先）
- 工具栏在小屏幕上自动折叠
- 触摸设备支持手势缩放

#### 4.3 无障碍访问

**要求**：
- 所有按钮有明确的 `aria-label`
- 支持键盘导航（Tab 键切换焦点）
- 色盲友好配色（不只依赖颜色传达信息）

#### 4.4 国际化准备

**要求**：
- 所有用户可见文本使用 i18n key
- 日期、数字格式支持区域设置
- RTL（从右到左）语言支持预留

---

## 📦 依赖管理

### 1. 新增依赖

**位置**：`frontend/package.json`

```json
{
  "dependencies": {
    "@vue-office/docx": "^1.6.0",
    "@vue-office/excel": "^1.7.0",
    "@vue-office/pdf": "^1.6.0",
    "@vue-office/pptx": "^1.0.0",
    "lru-cache": "^10.0.0"
  }
}
```

### 2. 安装命令

```bash
cd frontend
pnpm add @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx

cd ..
pnpm add lru-cache
```

### 3. 版本兼容性

| 依赖 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Vue | 3.3.0 | 3.5.x | Composition API 支持 |
| Vite | 5.0.0 | 6.4.x | 代码分割支持 |
| TypeScript | 5.0.0 | 5.9.x | 类型推断优化 |

---

## 🧪 测试要求

### 1. 单元测试

**覆盖范围**：
- `preview-router.ts` 路由决策逻辑
- 文件读取工具函数
- 缓存策略实现

**示例**：
```typescript
// tests/unit/utils/preview-router.test.ts
import { describe, it, expect } from 'vitest';
import { determinePreviewRoute, PreviewMode } from '@/utils/preview-router';

describe('determinePreviewRoute', () => {
  it('should return native mode for .docx files', () => {
    const route = determinePreviewRoute('/path/to/document.docx');
    expect(route.mode).toBe(PreviewMode.NATIVE);
    expect(route.component).toBe('VueOfficeDocx');
  });
  
  it('should return text mode for .txt files', () => {
    const route = determinePreviewRoute('/path/to/file.txt');
    expect(route.mode).toBe(PreviewMode.TEXT);
    expect(route.component).toBeUndefined();
  });
});
```

### 2. 集成测试

**测试场景**：
1. 打开 Word 文档预览
2. 打开 Excel 表格预览
3. 打开 PDF 文档预览
4. 打开 PowerPoint 演示文稿预览
5. 打开不支持的格式（降级到文本预览）
6. 预览窗口关闭后资源释放

### 3. 性能测试

**测试指标**：
- 首屏加载时间（Lighthouse）
- 内存占用（Chrome DevTools Memory）
- FPS（Performance Monitor）
- 大文件处理能力（50MB+ 文档）

### 4. 兼容性测试

**测试平台**：
- Windows 10/11（Chrome, Edge）
- macOS 12+（Safari, Chrome）
- Linux Ubuntu 20.04+（Firefox, Chrome）

---

## ⚙️ 配置管理

**位置**：`src/core/config/constants.ts`

```typescript
/**
 * 预览功能配置
 */
export const PREVIEW_CONFIG = {
  // 文件大小限制
  MAX_FILE_SIZE_MB: 100,
  
  // 超时设置
  LOAD_TIMEOUT_MS: 30000,
  
  // 并发控制
  MAX_CONCURRENT_READS: 3,
  
  // 缓存配置
  CACHE_MAX_SIZE_MB: 50,
  CACHE_SINGLE_FILE_MAX_MB: 10,
  CACHE_TTL_MS: 5 * 60 * 1000, // 5分钟
  
  // 流式读取
  CHUNK_SIZE_BYTES: 64 * 1024, // 64KB
  STREAM_CHUNK_SIZE_MB: 1,     // 1MB（伪流式）
  
  // 性能监控
  METRICS_LOG_INTERVAL_MS: 5 * 60 * 1000 // 5分钟
};
```

**在代码中使用**：

```typescript
import { PREVIEW_CONFIG } from '@/core/config/constants';

// 替换硬编码值
const MAX_PREVIEW_SIZE_MB = PREVIEW_CONFIG.MAX_FILE_SIZE_MB;
const LOAD_TIMEOUT = PREVIEW_CONFIG.LOAD_TIMEOUT_MS;
```

---

## 🔄 迁移与回滚指南

### 从现有预览系统升级

#### 步骤 1：备份现有代码

```bash
git checkout -b backup-before-preview-upgrade
git push origin backup-before-preview-upgrade
```

#### 步骤 2：安装新依赖

```bash
cd frontend
pnpm add @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx

cd ..
pnpm add lru-cache async-sema
```

#### 步骤 3：逐步启用新功能

**第一阶段**：仅启用 PDF 预览（风险最低）

```typescript
// frontend/src/utils/preview-router.ts
const nativeFormats: Record<string, string> = {
  // '.docx': 'VueOfficeDocx',    // 暂时注释
  // '.xlsx': 'VueOfficeExcel',   // 暂时注释
  '.pdf': 'VueOfficePdf',         // 先启用 PDF
  // '.pptx': 'VueOfficePptx',    // 暂时注释
};
```

**第二阶段**：测试稳定后启用其他格式

#### 步骤 4：监控关键指标

- 预览成功率
- 平均加载时间
- 内存使用情况
- 用户反馈

---

### 回滚方案

如果新版本出现严重问题，可以快速回滚：

#### 方案 A：Git 回滚（推荐）

```bash
git revert <commit-hash>
# 或
git checkout main
git merge backup-before-preview-upgrade
```

#### 方案 B：临时禁用原生预览

```typescript
// frontend/src/config/feature-flags.ts
export const FEATURE_FLAGS = {
  ENABLE_NATIVE_PREVIEW: false,  // 临时禁用
  FORCE_TEXT_PREVIEW: true       // 强制使用文本预览
};
```

```typescript
// frontend/src/utils/preview-router.ts
import { FEATURE_FLAGS } from '@/config/feature-flags';

export function determinePreviewRoute(filePath: string): PreviewRoute {
  // 如果禁用了原生预览，直接返回文本模式
  if (!FEATURE_FLAGS.ENABLE_NATIVE_PREVIEW || FEATURE_FLAGS.FORCE_TEXT_PREVIEW) {
    return {
      mode: PreviewMode.TEXT,
      filePath,
      fileType: path.extname(filePath).substring(1)
    };
  }
  
  // ... 正常逻辑
}
```

#### 方案 C：降级到上一版本

保留旧版本的构建产物，必要时快速切换：

```bash
# 部署服务器上的回滚脚本
./rollback.sh v1.2.3  # 回滚到指定版本
```

---

### 监控与告警

#### 关键指标监控

| 指标 | 阈值 | 告警级别 |
|------|------|----------|
| 预览失败率 | > 5% | 🔴 紧急 |
| 平均加载时间 | > 5秒 | 🟡 警告 |
| 内存使用峰值 | > 800MB | 🔴 紧急 |
| 降级率 | > 20% | 🟡 警告 |

#### 日志记录

所有预览错误应记录到：

1. **本地日志文件**：`logs/preview-errors.log`
2. **远程监控系统**：Sentry / ELK
3. **用户反馈渠道**：应用内反馈按钮

```typescript
// 错误上报示例
import * as Sentry from '@sentry/electron';

function reportPreviewError(error: PreviewError) {
  Sentry.captureException(error, {
    tags: {
      feature: 'file-preview',
      fileType: error.fileType,
      fileSize: error.fileSize
    },
    extra: {
      errorMessage: error.message,
      stackTrace: error.stack
    }
  });
}
```

---

## 📝 实施计划

### Phase 1：基础架构搭建（预计 2 天）

**任务**：
1. ✅ 创建类型定义文件（`frontend/src/types/preview.ts`）
2. ✅ 创建预览路由工具（`frontend/src/utils/preview-router.ts`）
3. ✅ 扩展文件读取工具（`frontend/src/utils/file-utils.ts`）
4. ✅ 添加主进程 IPC 处理器（`src/core/main/ipc-handlers.ts`）
5. ✅ 安装 `@vue-office` 系列依赖

**验收标准**：
- TypeScript 编译无错误
- 路由逻辑单元测试通过
- 文件读取功能正常工作

---

### Phase 2：预览组件开发（预计 5 天）

**任务**：
1. ✅ 开发 DocxPreview.vue（1 天）
2. ✅ 开发 ExcelPreview.vue（1.5 天）
3. ✅ 开发 PdfPreview.vue（1 天）
4. ✅ 开发 PptxPreview.vue（1 天）
5. ✅ 开发 NativePreviewContainer.vue（0.5 天）

**验收标准**：
- 各组件独立功能正常
- 资源清理逻辑完善
- 错误处理健壮

---

### Phase 3：集成与优化（预计 3 天）

**任务**：
1. ✅ 改造 PreviewModal.vue（1 天）
2. ✅ 实现懒加载策略（0.5 天）
3. ✅ 实现缓存策略（0.5 天）
4. ✅ 性能优化（1 天）

**验收标准**：
- 预览窗口正常打开/关闭
- 首屏加载时间 < 2秒
- 内存峰值 < 500MB

---

### Phase 4：测试与修复（预计 2 天）

**任务**：
1. ✅ 编写单元测试（0.5 天）
2. ✅ 执行集成测试（0.5 天）
3. ✅ 性能测试与优化（0.5 天）
4. ✅ Bug 修复（0.5 天）

**验收标准**：
- 单元测试覆盖率 ≥ 80%
- 所有测试用例通过
- 性能指标达标

---

### Phase 5：文档与发布（预计 1 天）

**任务**：
1. ✅ 更新 README.md
2. ✅ 编写用户使用指南
3. ✅ 代码审查
4. ✅ 发布新版本

**验收标准**：
- 文档完整清晰
- 代码审查通过
- 版本号更新

---

## ⚠️ 风险与应对

### 1. 技术风险

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| @vue-office 组件与现有依赖冲突 | 中 | 高 | 提前在测试分支验证兼容性 |
| 大文件预览性能不佳 | 中 | 中 | 实现虚拟滚动和 Web Worker |
| 内存泄漏 | 低 | 高 | 严格的资源清理和监控 |
| 某些格式渲染异常 | 中 | 中 | 提供降级到文本预览的选项 |

### 2. 进度风险

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| 组件开发超出预期时间 | 中 | 中 | 预留 20% 缓冲时间 |
| 测试发现重大 Bug | 低 | 高 | 早期进行集成测试 |
| 依赖库版本更新导致 API 变化 | 低 | 中 | 锁定依赖版本 |

---

## 📊 成功标准

### 功能标准

- ✅ Word、Excel、PDF、PPT 文档可以正常预览
- ✅ 保留原始格式和布局
- ✅ 不支持的格式自动降级到文本预览
- ✅ 预览窗口可以正常打开/关闭

### 性能标准

- ✅ 首屏加载时间 < 2秒（10MB 以内文件）
- ✅ 内存峰值 < 500MB
- ✅ 滚动/缩放 FPS ≥ 50
- ✅ 大文件（50MB+）崩溃率 < 1%

### 质量标准

- ✅ TypeScript 编译无错误
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ 无内存泄漏
- ✅ 代码审查通过

### 用户体验标准

- ✅ 用户满意度调查 ≥ 4.5/5.0
- ✅ 预览功能使用率提升 ≥ 30%
- ✅ 用户反馈负面评价 < 5%

---

## 🔗 相关文档

- [方案_虚拟滚动预览_2026-05-12.md](./方案_虚拟滚动预览_2026-05-12.md)
- [修复_预览窗口复制功能_2026-05-12.md](./修复_预览窗口复制功能_2026-05-12.md)
- [优化_PDF内存使用_2026-05-12.md](./优化_PDF内存使用_2026-05-12.md)

---

## 📅 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| v1.0 | 2026-05-15 | AI Assistant | 初始版本，完整需求文档 |
| v1.1 | 2026-05-15 | AI Assistant | 修复审查问题：<br>- 修正 Stream 传输方案（改用分块读取）<br>- 加强路径遍历防护<br>- 补充依赖声明（lru-cache）<br>- 添加统一错误处理类型<br>- 添加文件类型魔数验证<br>- 优化缓存 TTL 策略<br>- 修复并发控制死锁风险<br>- 完善 Preload 类型定义<br>- 添加配置管理<br>- 添加迁移与回滚指南 |
| v1.2 | 2026-05-15 | AI Assistant | 移除不必要的 async-sema 依赖：<br>- 分析应用场景：单例模态对话框，一次只预览一个文件<br>- 删除并发控制章节，改为内存管理<br>- 从依赖列表中移除 async-sema<br>- 简化实现，避免过度设计 |

---

**文档结束**
