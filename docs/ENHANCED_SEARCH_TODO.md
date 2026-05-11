# 增强搜索功能实施待办清单

> **分支**: `enhanced-search-feature`  
> **参考文档**: `docs/ENHANCED_SEARCH_REQUIREMENTS.md`  
> **最后更新**: 2026-05-08

---

## 📋 实施阶段总览

### Phase 1: 基础准备（1-2小时）
- [ ] 安装依赖库
- [ ] 创建工具函数
- [ ] 更新 CSS 变量

### Phase 2: 后端实现（4-6小时）
- [ ] 表达式解析器封装
- [ ] Worker 线程集成
- [ ] IPC 通信扩展
- [ ] 单次遍历逻辑

### Phase 3: 前端实现（4-6小时）
- [ ] 工具栏 UI 改造
- [ ] 结果列表增强
- [ ] 预览功能升级
- [ ] UI 动态控制

### Phase 4: 测试与优化（2-3小时）
- [ ] 功能测试
- [ ] 性能测试
- [ ] 边界情况处理
- [ ] 代码清理

---

## ✅ Phase 1: 基础准备

### 1.1 安装依赖库

**任务**: 安装 jsep 表达式解析库

```bash
cd frontend
pnpm add jsep
```

**验收标准**:
- [ ] jsep 成功安装
- [ ] package.json 中记录依赖
- [ ] TypeScript 类型定义可用

**相关文件**:
- `frontend/package.json`

---

### 1.2 创建表达式解析工具

**任务**: 封装布尔表达式解析和评估逻辑

**文件**: `frontend/src/utils/expression-parser.ts`

**功能**:
- [ ] 解析表达式为 AST
- [ ] 评估 AST 匹配文本
- [ ] 支持 AND(&)、OR(|)、NOT(!)、分组(())
- [ ] 错误处理和降级策略

**关键函数**:
```typescript
export function parseExpression(expression: string): any
export function evaluateExpression(ast: any, text: string): boolean
export function extractKeywords(expression: string): string[]
```

**验收标准**:
- [ ] 单元测试覆盖主要场景
- [ ] 支持所有运算符
- [ ] 解析失败返回 null

---

### 1.3 更新 CSS 颜色变量

**任务**: 在 `style.css` 中添加高亮颜色变量

**文件**: `frontend/src/style.css`

**添加内容**:
```css
:root {
  /* 高亮基本色 */
  --highlight-base-sensitive: #ff4d4f;
  --highlight-base-keyword: #1890ff;
  
  /* 敏感信息高亮 - 不同类型不同颜色 */
  --color-highlight-id-card: var(--highlight-base-sensitive);
  --color-highlight-id-card-bg: rgb(from var(--highlight-base-sensitive) r g b / 0.1);
  
  --color-highlight-phone: #fa8c16;
  --color-highlight-phone-bg: rgb(from var(--color-highlight-phone) r g b / 0.1);
  
  --color-highlight-email: #722ed1;
  --color-highlight-email-bg: rgb(from var(--color-highlight-email) r g b / 0.1);
  
  --color-highlight-bank-card: #eb2f96;
  --color-highlight-bank-card-bg: rgb(from var(--color-highlight-bank-card) r g b / 0.1);
  
  --color-highlight-ip: #13c2c2;
  --color-highlight-ip-bg: rgb(from var(--color-highlight-ip) r g b / 0.1);
  
  --color-highlight-url: #52c41a;
  --color-highlight-url-bg: rgb(from var(--color-highlight-url) r g b / 0.1);
  
  /* 通用敏感信息 */
  --color-highlight-sensitive: var(--highlight-base-sensitive);
  --color-highlight-sensitive-bg: rgb(from var(--highlight-base-sensitive) r g b / 0.1);
  
  /* 搜索关键词 */
  --color-highlight-keyword: var(--highlight-base-keyword);
  --color-highlight-keyword-bg: rgb(from var(--highlight-base-keyword) r g b / 0.1);
}

[data-theme="dark"] {
  --highlight-base-sensitive: #ff7875;
  --highlight-base-keyword: #40a9ff;
  
  --color-highlight-phone: #ffa940;
  --color-highlight-email: #9254de;
  --color-highlight-bank-card: #f759ab;
  --color-highlight-ip: #36cfc9;
  --color-highlight-url: #73d13d;
}
```

**验收标准**:
- [ ] 变量正确定义
- [ ] 暗主题适配
- [ ] 现有高亮类使用新变量

---

## ✅ Phase 2: 后端实现

### 2.1 后端表达式解析器

**任务**: 在主进程中集成表达式解析

**文件**: `src/utils/expression-parser.ts` (新建)

**功能**:
- [ ] 复用前端解析逻辑
- [ ] 支持 Worker 线程调用
- [ ] 关键词提取

**验收标准**:
- [ ] 前后端解析结果一致
- [ ] 可在 Worker 中使用

---

### 2.2 扩展 ScanConfig 接口

**任务**: 在配置中添加搜索相关字段

**文件**: `src/types.ts`

**修改**:
```typescript
interface ScanConfig {
  // ... 现有字段
  
  // 新增字段
  searchExpression?: string          // 搜索表达式
  enableSensitiveSearch?: boolean    // 是否启用敏感检测
}
```

**验收标准**:
- [ ] 类型定义完整
- [ ] 向后兼容

---

### 2.3 Worker 线程集成关键词匹配

**任务**: 在 file-worker.ts 中添加内容搜索逻辑

**文件**: `src/file-worker.ts`

**修改点**:
1. 接收 `searchExpression` 参数
2. 根据 `enableSensitiveSearch` 决定是否执行敏感检测
3. 始终执行关键词匹配（如果有表达式）
4. 合并结果返回

**关键逻辑**:
```typescript
// 伪代码
if (params.enableSensitiveSearch) {
  sensitiveResult = detectSensitive(text)
}

if (params.searchExpression) {
  contentResult = matchContent(text, params.searchExpression)
}

return mergeResults(sensitiveResult, contentResult)
```

**验收标准**:
- [ ] 开关关闭时跳过敏感检测
- [ ] 有表达式时执行内容匹配
- [ ] 结果正确合并

---

### 2.4 扩展 IPC 通信

**任务**: 修改 startScan 接口传递新参数

**文件**: 
- `src/main.ts` (主进程)
- `src/preload.ts` (预加载脚本)
- `frontend/src/utils/electron-api.ts` (前端 API)

**修改**:
```typescript
// 前端调用
startScan({
  paths: selectedPaths,
  config: scanConfig,
  searchExpression: searchInput.value,
  enableSensitiveSearch: enableSwitch.value
})
```

**验收标准**:
- [ ] 参数正确传递
- [ ] 类型安全
- [ ] 向后兼容

---

### 2.5 结果数据结构扩展

**任务**: 扩展 ScanResultItem 接口

**文件**: `src/types.ts`

**修改**:
```typescript
interface ScanResultItem {
  filePath: string
  fileSize: number
  modifiedTime: string
  
  // 敏感信息（开关打开时有值）
  counts?: Record<string, number>
  total?: number
  
  // 内容搜索（有表达式时有值）
  matchedKeywords?: string[]
  matchPositions?: Array<{
    keyword: string
    position: number
    context: string
  }>
  
  // 来源标记
  fromSensitiveScan?: boolean
  fromContentSearch?: boolean
}
```

**验收标准**:
- [ ] 字段可选
- [ ] 前端 TypeScript 同步更新

---

## ✅ Phase 3: 前端实现

### 3.1 工具栏 UI 改造

**任务**: 调整 App.vue 工具栏布局

**文件**: `frontend/src/App.vue`

**修改**:
1. 移动"开始扫描"和"取消"按钮到右侧
2. 在按钮左侧添加敏感内容开关
3. 在开关左侧添加搜索输入框

**布局结构**:
```vue
<div class="toolbar-right">
  <!-- 敏感内容开关 -->
  <label class="switch-label">
    <input type="checkbox" v-model="enableSensitiveSearch" />
    <span>敏感检测</span>
  </label>
  
  <!-- 搜索输入框 -->
  <input 
    v-model="searchExpression"
    placeholder="搜索表达式: 合同 | (密码 & 银行卡)"
    class="search-input"
  />
  
  <!-- 开始扫描按钮（从左侧移过来） -->
  <button @click="startScan" :disabled="scanning">
    开始扫描
  </button>
  
  <!-- 取消按钮（从左侧移过来） -->
  <button @click="cancelScan" :disabled="!scanning">
    取消
  </button>
</div>
```

**样式要求**:
- [ ] 响应式宽度（200px/300px/400px）
- [ ] 开关样式美观
- [ ] 输入框 placeholder 提示语法

**验收标准**:
- [ ] 布局正确
- [ ] 响应式适配
- [ ] 状态持久化（localStorage）

---

### 3.2 结果列表路径搜索增强

**任务**: ResultsTable 表头搜索支持布尔表达式

**文件**: `frontend/src/components/ResultsTable.vue`

**修改**:
1. 导入表达式解析器
2. 修改过滤逻辑使用表达式评估
3. 同时匹配文件名和路径
4. 解析失败降级到简单匹配

**关键逻辑**:
```typescript
const filteredResults = computed(() => {
  if (!searchText.value) return results.value
  
  try {
    const ast = parseExpression(searchText.value)
    return results.value.filter(item => {
      const text = `${item.fileName} ${item.filePath}`
      return evaluateExpression(ast, text)
    })
  } catch {
    // 降级到简单字符串匹配
    return results.value.filter(item => 
      item.fileName.includes(searchText.value) ||
      item.filePath.includes(searchText.value)
    )
  }
})
```

**验收标准**:
- [ ] 支持布尔表达式
- [ ] 解析失败优雅降级
- [ ] 性能良好（<100ms for 1000 items）

---

### 3.3 UI 动态控制

**任务**: 根据 `enableSensitiveSearch` 状态显示/隐藏元素

**文件**: `frontend/src/components/ResultsTable.vue`

**修改点**:
1. 敏感数量列：`v-if="enableSensitiveSearch"`
2. 删除按钮：`v-if="enableSensitiveSearch"`
3. 一键删除按钮：`v-if="enableSensitiveSearch && selectedItems.length > 0"`

**示例**:
```vue
<!-- 敏感数量列 -->
<th v-if="enableSensitiveSearch">敏感数量</th>

<!-- 操作列 -->
<td>
  <button v-if="enableSensitiveSearch" @click="deleteItem">删除</button>
  <button @click="previewItem">预览</button>
</td>
```

**验收标准**:
- [ ] 开关切换时 UI 立即响应
- [ ] 表格布局保持一致
- [ ] 动画平滑（transition 0.3s）

---

### 3.4 预览功能增强

**任务**: 升级 PreviewModal 支持 Office/PDF 完整渲染和高亮

**文件**: `frontend/src/components/PreviewModal.vue`

#### 3.4.1 安装 vue-office 组件

```bash
cd frontend
pnpm add @vue-office/docx @vue-office/excel @vue-office/pptx @vue-office/pdf
```

#### 3.4.2 按需加载组件

```typescript
const loadViewerComponent = async (fileType: string) => {
  switch (fileType) {
    case 'docx':
      return import('@vue-office/docx')
    case 'xlsx':
      return import('@vue-office/excel')
    case 'pptx':
      return import('@vue-office/pptx')
    case 'pdf':
      return import('@vue-office/pdf')
    default:
      return null
  }
}
```

#### 3.4.3 高亮显示逻辑

**开关打开时**:
- 敏感信息用红色高亮
- 搜索关键词用蓝色高亮
- 侧边栏显示两者列表

**开关关闭时**:
- 仅搜索关键词用蓝色高亮
- 隐藏敏感信息相关 UI

**实现要点**:
```typescript
// 高亮文本
function highlightText(text: string, highlights: Highlight[]) {
  // 敏感信息 → 红色
  // 搜索关键词 → 蓝色
  // 返回 HTML
}
```

#### 3.4.4 不支持格式处理

```vue
<div v-if="!isSupported" class="unsupported-hint">
  <p>此文件格式暂不支持预览</p>
  <button @click="openOriginalFile">打开原文件</button>
</div>
```

**验收标准**:
- [ ] Office/PDF 完整渲染
- [ ] 高亮正确显示
- [ ] 不支持格式友好提示
- [ ] 大文件处理（>10MB 提示）

---

### 3.5 状态管理

**任务**: 保存和恢复用户偏好

**文件**: `frontend/src/App.vue` 或 Pinia store

**实现**:
```typescript
// 从 localStorage 加载
onMounted(() => {
  const saved = localStorage.getItem('enableSensitiveSearch')
  if (saved !== null) {
    enableSensitiveSearch.value = JSON.parse(saved)
  }
})

// 保存到 localStorage
watch(enableSensitiveSearch, (newValue) => {
  localStorage.setItem('enableSensitiveSearch', JSON.stringify(newValue))
})
```

**验收标准**:
- [ ] 刷新页面后状态保持
- [ ] 首次使用默认打开

---

## ✅ Phase 4: 测试与优化

### 4.1 功能测试

**测试用例**:

#### 表达式解析测试
- [ ] `合同` - 单关键词
- [ ] `合同 | 协议` - OR 运算
- [ ] `密码 & 银行卡` - AND 运算
- [ ] `!(机密)` - NOT 运算
- [ ] `(合同 | 协议) & 财务` - 分组优先级
- [ ] 空表达式
- [ ] 无效表达式（降级测试）

#### 开关逻辑测试
- [ ] 开关打开：敏感检测 + 内容搜索
- [ ] 开关关闭：仅内容搜索
- [ ] 开关切换：UI 动态更新
- [ ] 状态持久化

#### 预览测试
- [ ] Word 文档渲染
- [ ] Excel 表格渲染
- [ ] PowerPoint 渲染
- [ ] PDF 渲染
- [ ] 文本文件高亮
- [ ] 不支持格式提示
- [ ] 高亮颜色正确

---

### 4.2 性能测试

**指标**:
- [ ] 小文件处理时间增加 < 20%
- [ ] 内存峰值增加 < 50MB
- [ ] 表达式解析时间 < 10ms
- [ ] 结果过滤响应 < 100ms (1000条)

**测试方法**:
```bash
# 监控内存
npm run dev -- --inspect

# 性能分析
Chrome DevTools Performance tab
```

---

### 4.3 边界情况处理

**场景**:
- [ ] 超大文件（>100MB）
- [ ] 特殊字符表达式
- [ ] 空文件夹
- [ ] 无权限文件
- [ ] 网络驱动器
- [ ] 符号链接
- [ ] 并发扫描

---

### 4.4 代码清理

**检查项**:
- [ ] 移除 console.log
- [ ] 统一代码风格
- [ ] 添加必要注释
- [ ] 删除未使用代码
- [ ] TypeScript 类型检查通过
- [ ] ESLint 无警告

---

## 📊 进度跟踪

| 阶段 | 任务数 | 完成数 | 进度 |
|------|--------|--------|------|
| Phase 1 | 3 | 3 | 100% ✅ |
| Phase 2 | 5 | 5 | 100% ✅ |
| Phase 3 | 5 | 5 | 100% ✅ |
| Phase 4 | 4 | 3 | 75% 🔄 |
| **总计** | **17** | **16** | **94%** |

---

## 🔗 相关文档

- [需求文档](./ENHANCED_SEARCH_REQUIREMENTS.md)
- [技术架构](./ENHANCED_SEARCH_REQUIREMENTS.md#四技术架构)
- [数据流](./ENHANCED_SEARCH_REQUIREMENTS.md#五数据流详解)

---

## 📝 注意事项

1. **单次遍历原则**: 确保敏感检测和关键词合并在一次文件读取中完成
2. **向后兼容**: 不破坏现有功能，新用户可选择性使用
3. **性能优先**: 避免不必要的计算和内存分配
4. **用户体验**: 错误提示友好，降级策略合理
5. **代码质量**: 遵循项目规范，保持代码整洁

---

**开始实施时间**: ________  
**预计完成时间**: ________  
**实际完成时间**: ________
