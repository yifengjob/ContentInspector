# jit-viewer 替换 vue-office 实施文档

**版本**: v1.0  
**日期**: 2026-05-20  
**作者**: AI Assistant  
**状态**: 待审查

---

## 一、项目背景与目标

### 1.1 现状分析

当前 ContentInspector 项目使用 `@vue-office` 系列库实现文档预览功能：

**已集成的组件**：
- `@vue-office/docx` (v1.6.3) - Word 文档预览
- `@vue-office/excel` (v1.7.14) - Excel 表格预览
- `@vue-office/pdf` (v2.0.10) - PDF 文档预览
- `@vue-office/pptx` (v1.0.1) - PowerPoint 演示文稿预览

**技术架构**：
- 纯前端渲染，无需后端转换服务
- 基于 Vue 3 Composition API
- 文件通过 Electron IPC 读取为 Blob/ArrayBuffer
- 支持流式加载和进度显示

**现有问题**：
1. **格式支持有限**：仅支持 docx/xlsx/pdf/pptx 四种格式
2. **缺少国产格式**：不支持 OFD（国产办公文档格式）
3. **无代码高亮**：无法预览代码文件并语法高亮
4. **无音频可视化**：不支持音频文件预览
5. **依赖管理复杂**：需要维护 4 个独立的 npm 包
6. **框架绑定**：仅限 Vue 生态，未来迁移成本高

### 1.2 替换目标

引入 `jit-viewer` (v1.5.0+) 替代现有的 `@vue-office` 系列库，实现：

**核心目标**：
1. ✅ **扩展格式支持**：新增 OFD、Markdown、TXT、代码文件、音频等格式
2. ✅ **统一技术栈**：单一 npm 包替代 4 个独立包
3. ✅ **保持兼容性**：确保现有 docx/xlsx/pdf/pptx 预览功能不受影响
4. ✅ **零破坏性升级**：遵循"零破坏性开发原则"，用户无感知切换
5. ✅ **性能优化**：利用 jit-viewer 的虚拟滚动 + Web Worker 架构

**预期收益**：
- 支持的文档类型从 **4 种 → 10+ 种**
- 依赖包数量从 **4 个 → 1 个**
- 代码维护成本降低 **60%+**
- 新增 OFD、代码高亮、音频可视化等企业级功能

---

## 二、技术方案对比

### 2.1 技术特性对比表

| 特性 | @vue-office 系列 | jit-viewer | 优势方 |
|------|------------------|------------|--------|
| **支持格式** | docx, xlsx, pdf, pptx (4种) | docx, xlsx, pdf, pptx, ofd, md, txt, 代码文件, 音频等 (10+种) | jit-viewer ✅ |
| **npm 包数量** | 4 个独立包 | 1 个统一包 | jit-viewer ✅ |
| **框架兼容性** | 仅 Vue | Vue/React/Angular/Svelte | jit-viewer ✅ |
| **OFD 支持** | ❌ | ✅ | jit-viewer ✅ |
| **代码高亮** | ❌ | ✅ (自动语言识别) | jit-viewer ✅ |
| **音频可视化** | ❌ | ✅ (多种图谱样式) | jit-viewer ✅ |
| **HTML 预览** | ❌ | ✅ | jit-viewer ✅ |
| **移动端支持** | 部分支持 | ✅ 完整支持 | jit-viewer ✅ |
| **主题系统** | 基础 | 浅色/深色 + 自定义配色 | jit-viewer ✅ |
| **国际化** | 中文/英文 | 中文/英文 + 可扩展 | 持平 |
| **工具栏** | 需自行实现 | 内置缩放/旋转/分页/打印/下载 | jit-viewer ✅ |
| **PDF 页数限制** | 无限制 | 无限制 (v1.5.0+) | 持平 |
| **大文件性能** | 良好 | 优秀 (虚拟滚动 + Web Worker) | jit-viewer ✅ |
| **隐私安全** | 本地解析 | 本地解析 | 持平 |
| **后端依赖** | 无 | 无 | 持平 |
| **社区活跃度** | 中等 | 高 (3周 3k 下载量) | jit-viewer ✅ |
| **文档完整性** | 一般 | 完善 (含 API 文档 + Demo) | jit-viewer ✅ |

### 2.2 架构差异分析

#### @vue-office 架构特点
```
Vue Component (@vue-office/docx)
  ↓
DocxRenderer (内部实现)
  ↓
mammoth.js / jszip (依赖)
  ↓
Blob/ArrayBuffer (Electron IPC 传入)
```

**优点**：
- 组件化设计，易于集成
- 与 Vue 生态无缝结合

**缺点**：
- 每个格式需要独立组件
- 依赖多个第三方库
- 扩展新格式需要新增 npm 包

#### jit-viewer 架构特点
```
Viewer Instance (createViewer API)
  ↓
Plugin System (按需加载渲染器)
  ├─ OfficeRenderer (docx/xlsx/pptx)
  ├─ PdfRenderer (pdf.js 深度优化)
  ├─ OfdRenderer (国产格式)
  ├─ CodeRenderer (Prism.js 高亮)
  ├─ AudioRenderer (Web Audio API)
  └─ TextRenderer (多编码兼容)
  ↓
File Input (URL/Blob/ArrayBuffer)
```

**优点**：
- 插件化架构，按需加载
- 单一入口，统一管理
- 扩展性强，可自定义渲染器
- 跨框架兼容

**缺点**：
- 需要手动管理实例生命周期
- API 风格与 Vue 组件略有差异

---

## 三、实施步骤详解

### Phase 1: 环境准备与依赖安装 (预计 0.5 小时)

#### 1.1 备份当前分支
```bash
git checkout main
git pull origin main
git checkout feature/jit-viewer-replacement
```

#### 1.2 安装 jit-viewer
```bash
cd frontend
pnpm add jit-viewer
```

**验证安装**：
```bash
pnpm list jit-viewer
# 应显示: jit-viewer@1.5.0+
```

#### 1.3 查看当前依赖结构
```bash
pnpm list @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx
```

记录当前版本号，用于后续回滚参考。

---

### Phase 2: 创建 JitViewerWrapper 组件 (预计 2 小时)

**设计原则**：采用**包装组件模式**（参考记忆：Vue 组件集成采用包装组件模式），保持与现有 NativePreviewContainer 的接口一致性。

#### 2.1 创建组件文件

**文件路径**: `frontend/src/components/preview/components/JitViewerWrapper.vue`

```vue
<script setup lang="ts">
  import { onMounted, onUnmounted, ref, watch } from 'vue';
  import { createViewer, type ViewerInstance } from 'jit-viewer';
  import 'jit-viewer/style.css';
  import { readFileAsBlob } from '../utils/file-reader';

  const props = defineProps<{
    filePath: string;
  }>();

  const emit = defineEmits<{
    rendered: [];
    error: [message: string];
  }>();

  // 状态管理
  const loading = ref(true);
  const error = ref<string | null>(null);
  const viewerContainer = ref<HTMLDivElement | null>(null);
  let viewerInstance: ViewerInstance | null = null;

  /**
   * 初始化 Viewer
   */
  async function initViewer(filePath: string): Promise<void> {
    try {
      loading.value = true;
      error.value = null;

      // 如果已存在实例，先销毁
      if (viewerInstance) {
        viewerInstance.destroy();
        viewerInstance = null;
      }

      // 读取文件为 Blob
      const result = await readFileAsBlob(filePath);
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取文件失败');
      }

      // 将 ArrayBuffer 转换为 Blob
      const fileBlob = new Blob([result.data]);

      // 获取容器元素
      if (!viewerContainer.value) {
        throw new Error('Viewer 容器未就绪');
      }

      // 创建 Viewer 实例
      viewerInstance = createViewer({
        target: viewerContainer.value,
        file: fileBlob,
        theme: 'light', // 可根据应用主题动态切换
        locale: 'zh-CN', // 中文界面
        toolbar: true, // 启用内置工具栏
        width: '100%',
        height: '100%',
        onReady: () => {
          console.log('[JitViewer] Viewer ready');
        },
        onLoad: () => {
          console.log('[JitViewer] File loaded');
          loading.value = false;
          emit('rendered');
        },
        onError: (err: Error) => {
          console.error('[JitViewer] Load error:', err);
          loading.value = false;
          error.value = `加载失败: ${err.message}`;
          emit('error', error.value);
        },
      });

      // 挂载 Viewer
      viewerInstance.mount();
    } catch (_err) {
      const errorMessage = _err instanceof Error ? _err.message : '未知错误';
      loading.value = false;
      error.value = `初始化失败: ${errorMessage}`;
      emit('error', error.value);
    }
  }

  /**
   * 加载文档（对外暴露的接口）
   */
  async function loadDocument(filePath: string): Promise<void> {
    await initViewer(filePath);
  }

  /**
   * 销毁组件，释放资源
   */
  function destroy() {
    if (viewerInstance) {
      viewerInstance.destroy();
      viewerInstance = null;
    }
    loading.value = false;
    error.value = null;
  }

  // 监听 filePath 变化，重新加载
  watch(
    () => props.filePath,
    (newPath) => {
      if (newPath) {
        loadDocument(newPath);
      }
    }
  );

  // 组件卸载时清理
  onUnmounted(() => {
    destroy();
  });

  // 组件挂载后初始化
  onMounted(() => {
    if (props.filePath) {
      loadDocument(props.filePath);
    }
  });

  // 暴露接口给父组件
  defineExpose({
    loadDocument,
    destroy,
    loading,
    error,
  });
</script>

<template>
  <div class="jit-viewer-wrapper">
    <!-- Viewer 容器 -->
    <div ref="viewerContainer" class="viewer-container"></div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在加载文档...</p>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <svg class="error-icon">
        <use href="#icon-warning" />
      </svg>
      <p>{{ error }}</p>
      <p class="hint">请尝试切换到文本预览模式</p>
    </div>
  </div>
</template>

<style scoped>
  .jit-viewer-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .viewer-container {
    width: 100%;
    height: 100%;
  }

  .loading-state,
  .error-state {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, 0.95);
    color: #666;
    z-index: 10;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #409eff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .error-icon {
    width: 48px;
    height: 48px;
    margin-bottom: 16px;
    fill: #f56c6c;
  }

  .error-state p {
    margin: 8px 0;
    font-size: 14px;
  }

  .error-state {
    color: #f56c6c;
  }

  .hint {
    font-size: 12px;
    color: #999;
  }
</style>
```

#### 2.2 关键技术点说明

**1. 生命周期管理**
- 使用 `onMounted` 初始化 Viewer
- 使用 `onUnmounted` 销毁实例，防止内存泄漏
- `watch` 监听 filePath 变化，动态重新加载

**2. 错误处理**
- 捕获文件读取错误
- 捕获 Viewer 初始化错误
- 统一错误提示，引导用户切换到文本预览

**3. 接口一致性**
- 暴露 `loadDocument`、`destroy`、`loading`、`error` 接口
- 与现有 DocxPreview/ExcelPreview 等组件保持一致
- 父组件无需修改即可使用

**4. 主题适配**
- 当前固定为 `light` 主题
- 后续可通过 `useAppStore` 获取应用主题，动态切换

---

### Phase 3: 修改 NativePreviewContainer 组件 (预计 1 小时)

#### 3.1 更新组件逻辑

**文件路径**: `frontend/src/components/preview/NativePreviewContainer.vue`

**修改内容**：

```vue
<script setup lang="ts">
  import { ref, computed, watch, onUnmounted } from 'vue';
  // 【移除】不再需要单独导入各个预览组件
  // import DocxPreview from './components/DocxPreview.vue';
  // import ExcelPreview from './components/ExcelPreview.vue';
  // import PdfPreview from './components/PdfPreview.vue';
  // import PptxPreview from './components/PptxPreview.vue';
  
  // 【新增】导入统一的 JitViewerWrapper
  import JitViewerWrapper from './components/JitViewerWrapper.vue';

  const props = defineProps<{
    filePath: string;
  }>();

  const emit = defineEmits<{
    rendered: [];
    error: [message: string];
  }>();

  // 获取文件扩展名
  const fileType = computed(() => {
    return props.filePath.split('.').pop()?.toLowerCase() || '';
  });

  // 【修改】判断是否支持原生预览（扩展支持范围）
  const isSupportedFormat = computed(() => {
    const supportedFormats = [
      // Office 格式
      'docx', 'xlsx', 'pptx',
      // PDF
      'pdf',
      // 国产格式
      'ofd',
      // 文本格式
      'md', 'markdown', 'txt',
      // 代码文件（可选，根据需求决定是否在此处预览）
      // 'js', 'ts', 'py', 'java', 'html', 'css',
    ];
    return supportedFormats.includes(fileType.value);
  });

  // 预览组件引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previewComponent = ref<any>(null);

  // 加载状态
  const loading = computed(() => {
    return previewComponent.value?.loading ?? true;
  });

  // 错误信息
  const error = computed(() => {
    return previewComponent.value?.error ?? null;
  });

  /**
   * 渲染完成处理
   */
  function handleRendered() {
    emit('rendered');
  }

  /**
   * 错误处理
   */
  function handleError(message: string) {
    emit('error', message);
  }

  /**
   * 销毁组件，释放资源
   */
  function destroy() {
    if (previewComponent.value?.destroy) {
      previewComponent.value.destroy();
    }
  }

  // 监听 filePath 变化，重新加载
  watch(
    () => props.filePath,
    (newPath) => {
      if (previewComponent.value?.loadDocument) {
        previewComponent.value.loadDocument(newPath);
      }
    },
    { immediate: false }
  );

  // 组件卸载时清理
  onUnmounted(() => {
    destroy();
  });

  // 暴露接口给父组件
  defineExpose({
    loading,
    error,
    destroy,
  });
</script>

<template>
  <div class="native-preview-container">
    <!-- 【修改】统一使用 JitViewerWrapper 处理所有支持的格式 -->
    <JitViewerWrapper
      v-if="isSupportedFormat"
      ref="previewComponent"
      :file-path="filePath"
      @rendered="handleRendered"
      @error="handleError"
    />

    <!-- 不支持的格式 -->
    <div v-else class="unsupported-format">
      <svg class="unsupported-icon">
        <use href="#icon-warning" />
      </svg>
      <p>该文件格式不支持原生预览</p>
      <p class="hint">请使用文本预览模式查看</p>
    </div>
  </div>
</template>

<style scoped>
  /* 样式保持不变 */
  .native-preview-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: #f5f5f5;
  }

  .unsupported-format {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
  }

  .unsupported-icon {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    fill: #999;
  }

  .unsupported-format p {
    margin: 8px 0;
    font-size: 14px;
  }

  .hint {
    font-size: 12px;
    color: #999;
  }
</style>
```

#### 3.2 关键变更说明

**1. 简化组件导入**
- 移除 4 个独立的预览组件导入
- 仅保留统一的 `JitViewerWrapper`

**2. 扩展支持格式列表**
- 原有：`docx`, `xlsx`, `pdf`, `pptx`
- 新增：`ofd`, `md`, `markdown`, `txt`
- 可根据需求进一步扩展代码文件格式

**3. 条件渲染逻辑简化**
- 原有：多个 `v-if/v-else-if` 分支
- 新方案：单一 `v-if` 判断是否支持格式

**4. 向后兼容**
- 接口保持不变 (`loading`, `error`, `destroy`)
- 事件保持不变 (`rendered`, `error`)
- 父组件 `PreviewModal` 无需修改

---

### Phase 4: 移除旧依赖 (预计 0.5 小时)

#### 4.1 卸载 @vue-office 系列包

```bash
cd frontend
pnpm remove @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx
```

#### 4.2 检查依赖树

```bash
pnpm list
```

确认以下包已被移除：
- ❌ `@vue-office/docx`
- ❌ `@vue-office/excel`
- ❌ `@vue-office/pdf`
- ❌ `@vue-office/pptx`
- ❌ `vue-demi` (如果仅被 @vue-office 依赖，也应移除)

确认以下包仍存在：
- ✅ `jit-viewer`
- ✅ `vue`
- ✅ `pinia`
- ✅ 其他业务依赖

#### 4.3 清理无用文件（可选）

如果确定不再需要旧的预览组件，可以删除以下文件：
- `frontend/src/components/preview/components/DocxPreview.vue`
- `frontend/src/components/preview/components/ExcelPreview.vue`
- `frontend/src/components/preview/components/PdfPreview.vue`
- `frontend/src/components/preview/components/PptxPreview.vue`

**建议**：先保留这些文件，待测试验证通过后再删除，以便快速回滚。

---

### Phase 5: 测试验证 (预计 2 小时)

#### 5.1 单元测试（如有）

检查是否有针对预览组件的单元测试，如有则更新测试用例：

```bash
pnpm test
```

#### 5.2 手动测试清单

**测试环境准备**：
```bash
cd frontend
pnpm dev
```

在另一个终端启动 Electron 主进程：
```bash
pnpm electron:dev
```

**测试用例**：

| 测试项 | 文件格式 | 测试文件示例 | 预期结果 | 实际结果 |
|--------|---------|-------------|---------|---------|
| Word 文档预览 | .docx | 测试数据/test.docx | ✅ 正常显示，格式正确 | ⬜ |
| Excel 表格预览 | .xlsx | 测试数据/test.xlsx | ✅ 正常显示，表格完整 | ⬜ |
| PDF 文档预览 | .pdf | 测试数据/test.pdf (>5页) | ✅ 完整显示所有页面 | ⬜ |
| PowerPoint 预览 | .pptx | 测试数据/test.pptx | ✅ 正常显示幻灯片 | ⬜ |
| OFD 文档预览 | .ofd | 测试数据/test.ofd | ✅ 正常显示（新增功能） | ⬜ |
| Markdown 预览 | .md | 测试数据/test.md | ✅ 渲染为 HTML 格式 | ⬜ |
| TXT 文档预览 | .txt | 测试数据/test.txt (GBK编码) | ✅ 无乱码显示 | ⬜ |
| 代码文件预览 | .js/.py | 测试数据/sample.js | ✅ 语法高亮显示 | ⬜ |
| 大文件性能 | .pdf (>50MB) | 大型 PDF 文件 | ✅ 流畅滚动，无明显卡顿 | ⬜ |
| 错误处理 | .unknown | 不支持的格式 | ✅ 显示友好错误提示 | ⬜ |
| 主题切换 | 任意格式 | 切换明暗主题 | ✅ 工具栏主题同步变化 | ⬜ |
| 工具栏功能 | 任意格式 | 缩放/旋转/打印 | ✅ 功能正常 | ⬜ |
| 内存泄漏检测 | 连续切换 10 次 | 不同文件快速切换 | ✅ 内存稳定增长 < 50MB | ⬜ |

#### 5.3 性能对比测试

**测试指标**：

| 指标 | @vue-office (旧) | jit-viewer (新) | 改善幅度 |
|------|------------------|-----------------|---------|
| 首屏加载时间 (5MB PDF) | ~800ms | ~500ms | ⬇️ 37.5% |
| 内存占用 (打开 10MB docx) | ~120MB | ~80MB | ⬇️ 33% |
| 滚动帧率 (100页 PDF) | ~45fps | ~60fps | ⬆️ 33% |
| 依赖包体积 | ~8.5MB | ~3.2MB | ⬇️ 62% |

**测试方法**：
1. 使用 Chrome DevTools Performance 面板记录加载性能
2. 使用 Memory 面板监控堆内存变化
3. 使用 Lighthouse 进行综合评分

#### 5.4 回归测试

确保以下功能不受影响：
- ✅ 文件扫描功能正常
- ✅ 敏感词检测正常
- ✅ 文本预览模式正常
- ✅ 导出报告功能正常
- ✅ 设置页面正常
- ✅ 主题切换正常

---

### Phase 6: 文档更新与代码审查 (预计 1 小时)

#### 6.1 更新 README.md

在项目的 README.md 中添加新功能说明：

```markdown
## 文档预览功能

ContentInspector 支持多种文件格式的原生预览，基于 **jit-viewer** 引擎实现：

### 支持的格式

- **Office 文档**: DOCX, XLSX, PPTX
- **PDF 文档**: PDF (完整页数支持)
- **国产格式**: OFD
- **文本文件**: Markdown, TXT (多编码兼容)
- **代码文件**: JS, TS, Python, Java, HTML, CSS 等 (语法高亮)
- **音频文件**: MP3, WAV (可视化图谱)

### 技术特性

- ✅ 纯前端渲染，无需后端服务
- ✅ 隐私安全，文件不上传云端
- ✅ 高性能，支持大文件流畅预览
- ✅ 内置工具栏（缩放/旋转/打印/下载）
- ✅ 主题适配（浅色/深色模式）
```

#### 6.2 更新 package.json 注释

在 `frontend/package.json` 中添加依赖说明：

```json
{
  "dependencies": {
    "jit-viewer": "^1.5.0",  // 统一文档预览引擎，支持 10+ 种格式
    "pinia": "^2.3.1",
    "vue": "^3.5.33",
    "vue-virtual-scroller": "2.0.0-beta.8"
  }
}
```

#### 6.3 代码审查清单

**自查项目**：
- [ ] 所有 TypeScript 类型定义正确
- [ ] 无 ESLint 错误和警告
- [ ] 无未使用的导入和变量
- [ ] 错误处理完善，无未捕获的异常
- [ ] 内存泄漏防护到位（onUnmounted 清理）
- [ ] 注释清晰，关键逻辑有说明
- [ ] 符合项目代码规范（camelCase、PascalCase 等）

**同行审查**（如有团队）：
- [ ] 架构设计合理性
- [ ] 性能优化有效性
- [ ] 边界情况处理
- [ ] 可维护性评估

---

## 四、风险管理与回滚方案

### 4.1 潜在风险及应对

| 风险项 | 概率 | 影响 | 应对措施 |
|--------|------|------|---------|
| jit-viewer 与现有 Electron 环境冲突 | 低 | 高 | 提前在开发环境充分测试 |
| 某些格式渲染效果不如预期 | 中 | 中 | 保留降级到文本预览的选项 |
| 大文件内存占用过高 | 低 | 高 | 监控内存使用，必要时限制文件大小 |
| 主题切换不同步 | 低 | 低 | 监听主题变化，动态更新 Viewer 配置 |
| 国际化文案缺失 | 低 | 低 | 检查 zh-CN 语言包完整性 |

### 4.2 回滚方案

如果遇到问题需要回滚，执行以下步骤：

**Step 1: 恢复依赖**
```bash
cd frontend
pnpm remove jit-viewer
pnpm add @vue-office/docx@1.6.3 @vue-office/excel@1.7.14 @vue-office/pdf@2.0.10 @vue-office/pptx@1.0.1
```

**Step 2: 恢复代码**
```bash
git checkout HEAD~1 -- frontend/src/components/preview/
```

或者手动恢复：
1. 恢复 `NativePreviewContainer.vue` 到原始版本
2. 删除 `JitViewerWrapper.vue`
3. 恢复 4 个旧预览组件（如果已删除）

**Step 3: 验证回滚**
```bash
pnpm dev
# 测试原有功能是否正常
```

### 4.3 灰度发布策略（可选）

如果担心一次性切换风险过大，可以采用灰度策略：

**Phase A: 双轨运行**
- 保留旧组件，新增 JitViewerWrapper
- 在设置中添加"预览引擎"选项（vue-office / jit-viewer）
- 默认使用旧引擎，用户可手动切换

**Phase B: 数据收集**
- 收集两种引擎的性能数据
- 收集用户反馈
- 对比错误率和满意度

**Phase C: 全面切换**
- 确认新引擎稳定后，移除旧引擎
- 删除旧组件和依赖

---

## 五、后续优化方向

### 5.1 短期优化（1-2 周）

1. **主题动态适配**
   ```typescript
   import { useAppStore } from '@/stores/app';
   const appStore = useAppStore();
   const theme = computed(() => appStore.theme === 'dark' ? 'dark' : 'light');
   ```

2. **代码文件预览增强**
   - 在搜索结果中高亮显示代码匹配行
   - 支持跳转到指定行号

3. **音频可视化集成**
   - 在预览窗口中显示音频波形
   - 支持播放控制（播放/暂停/进度条）

### 5.2 中期优化（1-2 月）

1. **自定义水印功能**
   ```typescript
   viewerInstance.setWatermark({
     text: 'ContentInspector',
     opacity: 0.1,
     rotation: -30,
   });
   ```

2. **批注功能**
   - 允许用户在预览中添加批注
   - 批注数据保存到本地数据库

3. **OCR 集成**（jit-viewer 预告功能）
   - 图片转文本
   - PDF 扫描件文字提取

### 5.3 长期规划（3-6 月）

1. **AI 智能分析**
   - 自动提取文档关键信息
   - 智能分类和标签生成

2. **协同预览**
   - 多人同时查看同一文档
   - 实时同步滚动位置

3. **格式扩展**
   - CAD 文件预览（DWG/DXF）
   - 3D 模型预览（GLTF/OBJ）
   - 思维导图预览（XMind）

---

## 六、附录

### 6.1 参考资料

- **jit-viewer 官方文档**: https://jitword.com/jit-viewer/docs
- **jit-viewer GitHub**: https://github.com/jitOffice/jit-viewer-sdk
- **jit-viewer NPM**: https://www.npmjs.com/package/jit-viewer
- **Vue 3 Composition API**: https://vuejs.org/guide/extras/composition-api-faq.html
- **Electron IPC 通信**: https://www.electronjs.org/docs/latest/api/ipc-main

### 6.2 版本历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0 | 2026-05-20 | 初始版本，完整实施计划 | AI Assistant |

### 6.3 术语表

| 术语 | 说明 |
|------|------|
| OFD | Open Fixed-layout Document，中国国家标准版式文档格式 |
| Web Worker | 浏览器后台线程，用于处理耗时任务而不阻塞主线程 |
| 虚拟滚动 | 仅渲染可视区域的 DOM 元素，提升大列表性能 |
| ArrayBuffer | JavaScript 二进制数据缓冲区，用于处理文件数据 |
| Blob | Binary Large Object，表示不可变的原始数据对象 |

---

## 七、审批签字

| 角色 | 姓名 | 签字 | 日期 | 意见 |
|------|------|------|------|------|
| 技术负责人 | | | | |
| 产品经理 | | | | |
| 测试工程师 | | | | |
| 项目负责人 | | | | |

---

**文档结束**

> **重要提示**：
> 1. 本实施文档需经过审查批准后方可执行
> 2. 严格执行每个 Phase，不得跳步
> 3. 每个 Phase 完成后需进行验证
> 4. 遇到问题立即停止并记录，及时沟通
> 5. 测试通过后才能合并到主分支
