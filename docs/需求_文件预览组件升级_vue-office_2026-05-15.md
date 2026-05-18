# 需求：文件预览组件升级（引入 vue-office 系列）

**创建时间**：2026-05-15  
**版本**：v2.0  
**状态**：待实施  
**优先级**：P1（重要）

---

## 📋 需求背景

### 当前问题

ContentInspector 当前的文件预览功能采用**纯文本提取 + 高亮显示**的方式，存在以下局限性：

1. **格式丢失**：Word、Excel、PDF、PPT 等富文本文档的格式信息完全丢失
2. **体验不佳**：用户无法看到文档的真实排版和视觉效果
3. **专业性不足**：对于需要审查正式文档的场景，纯文本预览无法满足需求

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
2. **保持兼容性**：不支持的格式继续使用现有文本预览方式
3. **性能优化**：大文件预览不卡顿，内存占用可控
4. **用户体验**：预览界面美观、交互流畅，支持缩放等操作
5. **代码质量**：模块化设计，类型安全，无内存泄漏
6. **零破坏性**：**除预览功能外，不破坏其他任何功能**（扫描、结果展示、配置等）
7. **平滑降级**：原生预览失败时自动降级到现有文本预览，用户无感知
8. **合理的代码组织**：清晰的目录结构，避免后续重构风险

### 量化指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **首屏加载时间** | < 3秒 | 10MB 以内文件（PDF < 2秒，Word/Excel < 3秒） |
| **内存峰值** | < 800MB | 单个预览窗口（50MB 文件） |
| **FPS** | ≥ 30 | 滚动/缩放时 |
| **崩溃率** | < 2% | 大文件（50MB+） |
| **TypeScript 错误** | 0 | 编译时无类型错误 |
| **内存泄漏** | 0 | 关闭预览后完全释放 |
| **功能破坏** | 0 | 扫描、结果展示等其他功能不受影响 |
| **降级成功率** | 100% | 原生预览失败后能成功降级到文本预览 |

---

## 🔗 与现有系统集成（重要）

### 1. 现有预览功能分析

**当前实现位置**：`frontend/src/components/PreviewModal.vue`

**已有功能**：
- ✅ **流式文本预览**：通过 IPC 分块读取文件内容
- ✅ **虚拟滚动**：`PreviewVirtualScroller` 处理大量文本行
- ✅ **关键字高亮**：基于 `GlobalHighlight` 和 `LineHighlight`
- ✅ **错误处理**：`getFriendlyErrorMessage` 提供友好提示
- ✅ **进度反馈**：加载状态和错误严重程度分级
- ✅ **用户交互**：打开文件、复制内容、关闭预览

**技术栈**：
```typescript
// 已有的核心模块
import { PreviewVirtualScroller } from '@/utils/preview-virtual-scroller'
import { getFriendlyErrorMessage } from '@/utils/error-handler'
import { previewFileStream, cancelPreview } from '@/utils/electron-api'
```

**关键特性**：
1. **非响应式数组存储**：`allLines[]` 和 `allHighlights[]` 避免 Vue 响应式开销
2. **批量渲染调度**：`scheduleRender()` 使用 setTimeout 避开响应式追踪
3. **流式接收**：通过 `onPreviewChunk` 事件逐步接收数据
4. **内存优化**：及时清理旧 chunk，控制内存占用

---

### 2. 集成策略：扩展现有 PreviewModal.vue

**决策**：✅ **推荐方案 A - 扩展现有组件**

**原因**：
1. ✅ **保留现有功能**：不破坏已实现的流式预览和虚拟滚动
2. ✅ **代码复用**：复用 UI 样式、错误处理、用户交互逻辑
3. ✅ **降低风险**：避免创建新组件带来的维护成本
4. ✅ **用户体验一致**：统一的界面和交互方式

**实施方式**：在 `PreviewModal.vue` 中添加条件渲染，根据文件类型选择使用原生预览或文本预览。

#### 核心实现思路

```vue
<template>
  <div class="modal-body">
    <!-- 原生预览模式 -->
    <component
      v-if="previewMode === 'native' && nativeComponent"
      :is="nativeComponent"
      :file-path="filePath"
      @error="handleNativePreviewError"
    />
    
    <!-- 文本预览模式（现有逻辑） -->
    <template v-else>
      <div v-if="loading" class="loading-container">
        <!-- ... 现有代码 ... -->
      </div>
      <div v-else-if="error" class="error">
        <!-- ... 现有代码 ... -->
      </div>
      <div v-else class="preview-content">
        <!-- ... 现有虚拟滚动代码 ... -->
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
// 导入原生预览组件
import DocxPreview from './preview/components/DocxPreview.vue'
import ExcelPreview from './preview/components/ExcelPreview.vue'
import PdfPreview from './preview/components/PdfPreview.vue'
import PptxPreview from './preview/components/PptxPreview.vue'

const previewMode = ref<'native' | 'text'>('native')
const nativeComponent = ref<any>(null)

// 根据文件类型选择预览组件
const fileType = computed(() => {
  return props.filePath.split('.').pop()?.toLowerCase() || ''
})

const supportedFormats = ['docx', 'xlsx', 'xls', 'pdf', 'pptx']

watch([() => props.filePath, previewMode], () => {
  if (previewMode.value === 'native' && supportedFormats.includes(fileType.value)) {
    // 选择对应的原生预览组件
    switch (fileType.value) {
      case 'docx':
        nativeComponent.value = DocxPreview
        break
      case 'xlsx':
      case 'xls':
        nativeComponent.value = ExcelPreview
        break
      case 'pdf':
        nativeComponent.value = PdfPreview
        break
      case 'pptx':
        nativeComponent.value = PptxPreview
        break
    }
  } else {
    // 使用文本预览
    nativeComponent.value = null
    loadFileAsText(props.filePath)  // 触发原有的加载逻辑
  }
}, { immediate: true })

// 处理原生预览错误，自动降级
function handleNativePreviewError(error: string) {
  previewMode.value = 'text'
  loadFileAsText(props.filePath)
}
</script>
```

---

### 3. 零破坏性保证

#### 3.1 不影响的功能清单

**确保以下功能完全不受影响**：
- ✅ **扫描功能**：`scanStart`, `scanCancel` 等 IPC 接口不变
- ✅ **结果展示**：`ResultsTable.vue` 及其相关逻辑不变
- ✅ **配置管理**：`SettingsModal.vue` 及配置保存逻辑不变
- ✅ **目录树**：`DirectoryTree.vue` 不变
- ✅ **报告导出**：`exportReport` IPC 接口不变
- ✅ **日志系统**：日志收集和显示不变
- ✅ **敏感规则**：规则管理和匹配逻辑不变

#### 3.2 隔离措施

**代码隔离**：
```
新增代码全部放在 preview/ 目录下：
frontend/src/components/preview/
├── components/       # 原生预览组件
│   ├── DocxPreview.vue
│   ├── ExcelPreview.vue
│   ├── PdfPreview.vue
│   └── PptxPreview.vue
└── utils/           # 预览工具函数
    └── file-reader.ts

不修改其他目录的文件：
frontend/src/components/ResultsTable.vue    # ❌ 不修改
frontend/src/components/SettingsModal.vue   # ❌ 不修改
frontend/src/stores/scanStore.ts            # ❌ 不修改
```

**IPC 接口隔离**：
```typescript
// 新增的 IPC 接口（仅预览使用）
ipcMain.handle('read-file-as-blob', ...)     // ✅ 新增
ipcMain.handle('get-file-stats', ...)        // ✅ 新增

// 现有的 IPC 接口（保持不变）
ipcMain.handle('scan-start', ...)            // ❌ 不修改
ipcMain.handle('scan-cancel', ...)           // ❌ 不修改
ipcMain.handle('export-report', ...)         // ❌ 不修改
```

#### 3.3 测试验证清单

**实施后必须验证**：
- [ ] 扫描功能正常工作（开始、暂停、取消）
- [ ] 结果表格正常显示和排序
- [ ] 配置文件正常保存和加载
- [ ] 目录树正常展开和折叠
- [ ] 报告导出功能正常
- [ ] 日志收集正常
- [ ] 敏感规则匹配正常
- [ ] **只有预览功能发生变化**

---

### 4. 平滑降级策略

**降级流程**：
```
用户点击文件
  ↓
尝试原生预览
  ↓
成功？
  ├─ 是 → 显示原生格式
  └─ 否 → 自动降级到文本预览
            ↓
          加载文本内容 + 高亮
```

**用户体验**：
- ✅ 用户看到原生预览（最佳体验）
- ⚠️ 如果失败，自动切换到文本预览（仍可接受）
- 💡 可选：显示提示"该文档无法以原始格式显示，已切换到文本模式"

---

## 🌊 流式加载优化

### PDF 流式加载（真正流式）

**技术方案**：利用 pdf.js 内置的 Range Requests 支持

**实现方式**：
```typescript
// frontend/src/components/preview/components/PdfPreview.vue
import { ref } from 'vue';
import VueOfficePdf from '@vue-office/pdf';

const pdfSrc = ref<string | ArrayBuffer>('');

/**
 * @vue-office/pdf 内部已经实现了流式加载
 * 只需传入文件路径或 ArrayBuffer 即可
 */
async function loadPdf(filePath: string) {
  // 方式 1：直接传入路径（推荐，pdf.js 会自动处理流式加载）
  pdfSrc.value = filePath;
}
```

**优势**：
- ✅ pdf.js 原生支持流式加载
- ✅ 自动处理 Range Requests
- ✅ 首屏加载速度快

---

### Word/Excel/PPT 分块加载（模拟流式）

**说明**：这些格式不支持真正的流式加载，但可以通过分块读取优化用户体验。

**实现方式**：
```typescript
// frontend/src/components/preview/utils/file-reader.ts

/**
 * 分块读取文件，显示进度条
 */
export async function readFileWithProgress(
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const stats = await window.electronAPI.getFileStats(filePath);
  const totalSize = stats.stats.size;
  
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  const chunkSize = 1024 * 1024; // 1MB
  
  while (offset < totalSize) {
    const result = await window.electronAPI.readFileChunk(
      filePath,
      offset,
      Math.min(chunkSize, totalSize - offset)
    );
    
    chunks.push(result.chunk);
    offset += result.chunk.byteLength;
    
    if (onProgress) {
      onProgress((offset / totalSize) * 100);
    }
    
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
  
  return merged.buffer;
}
```

**UI 展示**：
```vue
<div v-if="loadingProgress > 0" class="loading-with-progress">
  <div class="progress-bar">
    <div class="progress-fill" :style="{ width: loadingProgress + '%' }"></div>
  </div>
  <div class="progress-text">{{ loadingProgress.toFixed(0) }}%</div>
</div>
```

---

## 🔦 关键字高亮策略

### 统一降级策略

**决策**：✅ **所有格式需要高亮时，统一降级到文本预览**

**原因**：
1. ❌ **@vue-office/docx**：不支持关键字高亮 API
2. ❌ **@vue-office/excel**：Luckysheet 遍历单元格性能差
3. ❌ **@vue-office/pdf**：不暴露 pdf.js 的 findController API
4. ❌ **@vue-office/pptx**：不支持关键字高亮
5. ✅ **现有文本预览**：已有完善的高亮功能（`PreviewVirtualScroller` + `GlobalHighlight`）

**实现方案**：用户可手动切换预览模式

```vue
<!-- PreviewModal.vue -->
<template>
  <div class="modal-footer">
    <!-- 模式切换按钮 -->
    <button 
      v-if="canToggleMode"
      @click="togglePreviewMode"
    >
      {{ previewMode === 'native' ? '查看高亮版本' : '查看原始格式' }}
    </button>
    
    <!-- ... 其他按钮 ... -->
  </div>
</template>

<script setup lang="ts">
const previewMode = ref<'native' | 'text'>('native');

function togglePreviewMode() {
  if (previewMode.value === 'native') {
    previewMode.value = 'text';
    loadFileAsText(props.filePath);  // 触发文本预览
  } else {
    previewMode.value = 'native';
  }
}
</script>
```

**用户体验**：
- ✅ 默认显示原生格式（最佳视觉效果）
- ✅ 用户可主动切换到高亮版本（查看敏感信息）
- ✅ 切换流畅，无需重新加载文件

---

## 🏗️ 代码组织结构

### 目录结构

```
frontend/src/
├── components/
│   ├── PreviewModal.vue        # 预览模态框（现有，修改）
│   └── preview/                # 预览组件模块（新建）
│       ├── components/         # 原生预览组件
│       │   ├── DocxPreview.vue
│       │   ├── ExcelPreview.vue
│       │   ├── PdfPreview.vue
│       │   └── PptxPreview.vue
│       └── utils/              # 预览工具函数
│           └── file-reader.ts
├── types/
│   └── preview.ts              # 预览相关类型定义（新建）
└── utils/
    └── electron-api.ts         # 扩展文件读取接口
```

### 设计原则

1. **模块化**：所有预览相关代码集中在 `preview/` 目录下
2. **最小化修改**：只修改 `PreviewModal.vue`，不碰其他组件
3. **可扩展性**：新增预览格式只需在 `components/` 下添加新组件
4. **类型安全**：所有模块都有明确的 TypeScript 类型定义

---

## 📦 依赖管理

### 1. 需要安装的包

```json
{
  "dependencies": {
    "@vue-office/docx": "^1.6.0",
    "@vue-office/excel": "^1.7.0",
    "@vue-office/pdf": "^1.6.0",
    "@vue-office/pptx": "^1.0.0",
    "vue-demi": "^0.14.6"
  }
}
```

**重要说明**：
- `vue-demi` 是 @vue-office 系列组件的必需依赖
- 它提供了 Vue 2 和 Vue 3 之间的 API 兼容性
- **版本必须指定为 0.14.6**，不同版本可能存在兼容性问题

### 2. 安装命令

```bash
cd frontend
pnpm add @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx vue-demi@0.14.6
```

**注意**：
- 项目根目录已有 `shamefully-hoist=true` 配置（`.npmrc`），可以正常处理 pnpm 的 peer dependency
- 如果使用其他包管理器（npm/yarn），请确保正确安装 vue-demi

---

## 🛠️ 后端支持

### 1. 新增 IPC 接口

**位置**：`src/main.ts` 或 `src/core/main/ipc-handlers.ts`

```typescript
import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';

/**
 * 读取文件为 Blob（ArrayBuffer）
 */
ipcMain.handle('read-file-as-blob', async (_, filePath: string) => {
  try {
    // 路径安全检查
    const normalizedPath = path.normalize(filePath);
    const allowedDirs = [app.getPath('userData'), app.getPath('home')];
    
    const isAllowed = allowedDirs.some(dir => 
      normalizedPath.startsWith(path.normalize(dir) + path.sep) ||
      normalizedPath === path.normalize(dir)
    );
    
    if (!isAllowed) {
      throw new Error('无权访问该文件');
    }
    
    const buffer = await fs.readFile(normalizedPath);
    return {
      success: true,
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      )
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * 获取文件信息
 */
ipcMain.handle('get-file-stats', async (_, filePath: string) => {
  try {
    const stats = await fs.stat(filePath);
    return {
      success: true,
      stats: {
        size: stats.size,
        mtime: stats.mtimeMs
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
});
```

### 2. Preload 扩展

**位置**：`src/preload.ts`

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有接口
  
  // 新增预览相关接口
  readFileAsBlob: (filePath: string) => 
    ipcRenderer.invoke('read-file-as-blob', filePath),
  getFileStats: (filePath: string) => 
    ipcRenderer.invoke('get-file-stats', filePath),
});
```

### 3. TypeScript 类型扩展

**位置**：`frontend/src/types/electron.d.ts`

```typescript
interface ElectronAPI {
  // ... 现有接口
  
  // 新增预览相关接口
  readFileAsBlob: (filePath: string) => Promise<{
    success: boolean;
    data?: ArrayBuffer;
    error?: string;
  }>;
  getFileStats: (filePath: string) => Promise<{
    success: boolean;
    stats?: {
      size: number;
      mtime: number;
    };
    error?: string;
  }>;
}
```

---

## 📝 实施计划

### Phase 1：基础架构搭建（1-2天）

1. **安装依赖**
   ```bash
   cd frontend
   pnpm add @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx
   ```

2. **创建类型定义**
   - `frontend/src/types/preview.ts`

3. **扩展后端接口**
   - 在 `src/main.ts` 中添加 `read-file-as-blob` 和 `get-file-stats` IPC 处理器
   - 在 `src/preload.ts` 中暴露新接口
   - 更新 TypeScript 类型定义

4. **创建工具函数**
   - `frontend/src/components/preview/utils/file-reader.ts`

---

### Phase 2：原生预览组件开发（3-4天）

1. **创建 DocxPreview.vue**
   - 使用 `@vue-office/docx`
   - 支持缩放控制
   - 错误处理和资源清理

2. **创建 ExcelPreview.vue**
   - 使用 `@vue-office/excel`
   - 支持 `.xlsx` 和 `.xls` 格式
   - 错误处理

3. **创建 PdfPreview.vue**
   - 使用 `@vue-office/pdf`
   - 利用 pdf.js 的流式加载
   - 支持缩放和翻页

4. **创建 PptxPreview.vue**
   - 使用 `@vue-office/pptx`
   - 基本预览功能

---

### Phase 3：集成到 PreviewModal.vue（2-3天）

1. **修改 PreviewModal.vue**
   - 添加条件渲染逻辑
   - 导入原生预览组件
   - 实现预览模式切换
   - 实现错误降级

2. **测试各种场景**
   - 正常预览（Word/Excel/PDF/PPT）
   - 预览失败降级
   - 模式切换
   - 大文件加载

---

### Phase 4：测试和优化（2-3天）

1. **功能测试**
   - 验证所有支持的格式
   - 验证降级策略
   - 验证零破坏性（其他功能不受影响）

2. **性能测试**
   - 测试大文件加载速度
   - 监控内存占用
   - 优化加载体验

3. **边界情况测试**
   - 损坏的文件
   - 加密的 PDF
   - 超大文件（>100MB）
   - 网络驱动器文件

---

## ✅ 验收标准

### 功能验收

- [ ] Word (.docx) 文件能以原生格式预览
- [ ] Excel (.xlsx/.xls) 文件能以原生格式预览
- [ ] PDF (.pdf) 文件能以原生格式预览
- [ ] PowerPoint (.pptx) 文件能以原生格式预览
- [ ] 不支持的格式仍使用文本预览
- [ ] 原生预览失败时能自动降级到文本预览
- [ ] 用户可手动切换预览模式
- [ ] 预览窗口能正常关闭，无内存泄漏

### 性能验收

- [ ] 10MB PDF 文件首屏加载 < 2秒
- [ ] 10MB Word/Excel 文件加载 < 3秒
- [ ] 50MB 文件内存占用 < 800MB
- [ ] 滚动/缩放时 FPS ≥ 30

### 零破坏性验收

- [ ] 扫描功能正常工作
- [ ] 结果表格正常显示
- [ ] 配置管理正常
- [ ] 目录树正常
- [ ] 报告导出正常
- [ ] 日志系统正常
- [ ] 敏感规则匹配正常

### 代码质量验收

- [ ] TypeScript 编译无错误
- [ ] ESLint 检查通过
- [ ] 无明显的内存泄漏
- [ ] 代码注释清晰
- [ ] 错误处理完善

---

## 📅 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| v1.0 | 2026-05-15 | AI Assistant | 初始版本 |
| v1.1 | 2026-05-15 | AI Assistant | 修复审查问题，移除不必要的并发控制和 async-sema |
| v2.0 | 2026-05-15 | AI Assistant | 重写文档，聚焦与现有系统集成，简化实现方案，强调零破坏性 |
| v2.1 | 2026-05-15 | AI Assistant | 补充 vue-demi 依赖（必需），指定版本为 0.14.6，添加 pnpm 配置说明 |

---

## 📌 注意事项

1. **不要修改其他组件**：除了 `PreviewModal.vue`，不要修改任何其他现有组件
2. **保持向后兼容**：确保文本预览功能仍然可用
3. **充分测试**：每个阶段都要进行充分测试，特别是降级场景
4. **关注内存**：预览大文件时要注意内存管理，及时释放资源
5. **用户优先**：如果原生预览效果不好，应该让用户能轻松切换到文本预览

---

**文档结束**
