# 增强搜索功能需求文档

**版本**: v1.3  
**创建日期**: 2026-05-08  
**最后更新**: 2026-05-08  
**状态**: 待审查

---

## 📝 版本历史

### v1.3 (2026-05-08) - 完整整合版
- 整合所有补充内容到主文档
- 修正章节编号错误
- 添加状态管理、错误处理、数据流等详细说明

### v1.2 (2026-05-08) - 简化为纯需求文档
- 移除具体代码实现细节
- 聚焦功能需求和设计规范

### v1.1 (2026-05-08) - 关键设计修正
- 开关逻辑：打开=敏感检测+内容搜索，关闭=仅内容搜索
- 界面布局：移动现有按钮而非新增

### v1.0 (2026-05-08) - 初始版本
- 定义布尔逻辑表达式搜索功能

---

## 一、背景与目标

### 1.1 现有功能

**已实现的核心功能**:
1. **敏感信息扫描** - 扫描文件内容，检测身份证、手机号、邮箱等敏感数据
2. **结果列表简单搜索** - 在 ResultsTable 中通过文件路径字符串匹配过滤结果

**当前局限性**:
- ❌ 结果列表搜索仅支持简单字符串匹配
- ❌ 不支持布尔逻辑运算符（AND、OR、NOT）
- ❌ 仅在文件名/路径中搜索，无法搜索文件内容
- ❌ 需要先完成扫描才能搜索

### 1.2 增强目标

1. ✅ **保留现有功能** - 不改变核心逻辑
2. ✅ **增强结果列表搜索** - 支持布尔逻辑表达式
3. ✅ **新增文件内容搜索** - 工具栏表达式搜索
4. ✅ **单次遍历优化** - 敏感检测和内容搜索一次完成
5. ✅ **统一语法** - 两种搜索使用相同表达式语法
6. ✅ **增强预览功能** - 支持 Office/PDF 完整渲染

---

## 二、功能规格

### 2.1 两种搜索功能对比

| 特性 | 结果列表搜索（增强） | 文件内容搜索（新增） |
|------|-------------------|-------------------|
| **位置** | ResultsTable 表头 | 主工具栏右侧 |
| **搜索范围** | 文件名/路径 | 文件内容 |
| **搜索时机** | 扫描完成后过滤 | 扫描过程中实时匹配 |
| **当前能力** | 简单字符串匹配 | - |
| **增强后能力** | 布尔逻辑表达式 | 布尔逻辑表达式 |
| **性能影响** | 无（内存过滤） | 小（单次遍历） |
| **适用场景** | 快速定位已知文件 | 查找包含特定内容的文件 |

**重要原则**: 两种搜索并存，使用相同语法，保持一致体验。

### 2.2 布尔逻辑运算符（通用）

| 运算符 | 含义 | 优先级 | 示例 | 说明 |
|--------|------|--------|------|------|
| `()` | 分组 | 最高 | `(A \| B) & C` | 改变运算顺序 |
| `!` | 非(NOT) | 高 | `!测试` | 排除匹配项 |
| `&` | 与(AND) | 中 | `密码 & 银行卡` | 同时满足 |
| `\|` | 或(OR) | 低 | `身份证 \| 手机号` | 任一满足 |

**优先级**: `()` > `!` > `&` > `|`

### 2.3 文件内容搜索开关逻辑

#### 模式 A：开关打开（默认）

**行为**: 单次遍历同时执行两项任务
- 敏感信息检测
- 文件内容关键词搜索

**界面表现**:
- ✅ 显示敏感信息数量列
- ✅ 操作列显示删除按钮
- ✅ 多选时显示一键删除按钮
- ✅ 支持完整预览功能

**优势**: 功能完整

#### 模式 B：开关关闭

**行为**: 仅执行内容搜索，跳过敏感检测

**界面表现**:
- ❌ 隐藏敏感信息数量列
- ❌ 隐藏删除按钮
- ❌ 隐藏一键删除按钮
- ⚠️ 受限的预览功能

**优势**: 速度更快，界面简洁

**状态持久化**: 
- 使用 localStorage 保存开关状态
- 默认值: `true`
- 用户会话间保持

### 2.4 搜索示例

#### 结果列表搜索（路径匹配）

``bash
合同                    # 文件名包含"合同"
财务 报告               # 文件名同时包含"财务"和"报告"
合同 | 协议             # 文件名包含"合同"或"协议"
2024 & 总结             # 文件名同时包含"2024"和"总结"
!草稿                   # 文件名不包含"草稿"
(财务 | 预算) & 2024    # 文件名包含("财务"或"预算")且包含"2024"
```

#### 文件内容搜索（内容匹配）

``bash
机密                    # 文件内容包含"机密"
密码 银行卡             # 文件内容同时包含"密码"和"银行卡"
身份证 | 手机号         # 文件内容包含"身份证"或"手机号"
(密码 | 银行卡) & !测试 # 包含("密码"或"银行卡")且不包含"测试"
```

### 2.5 预览功能增强

**新增独立的文档预览功能**，支持 Office 和 PDF 完整渲染。

#### 支持的文档类型

| 文档类型 | 格式 | 预览支持 | 说明 |
|---------|------|---------|------|
| Word | .doc, .docx | ✅ 完整渲染 | 保留格式、样式、图片 |
| Excel | .xls, .xlsx | ✅ 完整渲染 | 保留表格、公式、图表 |
| PowerPoint | .ppt, .pptx | ✅ 完整渲染 | 保留幻灯片、动画 |
| PDF | .pdf | ✅ 完整渲染 | 保留布局、字体、链接 |
| 文本文件 | .txt, .md, .csv | ✅ 简单预览 | 纯文本显示 |
| 其他格式 | .jpg, .png, .zip | ❌ 不支持 | 提示打开原文件 |

#### 技术选型

**推荐方案**: `@vue-office` 系列组件

**选择理由**:
1. ✅ Vue 3 原生支持
2. ✅ 完整的 Office 支持
3. ✅ PDF 支持
4. ✅ 轻量级，按需加载
5. ✅ 活跃维护
6. ✅ TypeScript 支持

**组件清单**:
- `@vue-office/docx` - Word
- `@vue-office/excel` - Excel
- `@vue-office/pptx` - PowerPoint
- `@vue-office/pdf` - PDF

#### 交互设计

1. **Office/PDF**: 完整渲染，支持缩放、翻页
2. **文本文件**: 现有方式，支持语法高亮
3. **不支持格式**: 友好提示 + “打开原文件”按钮

#### 高亮显示规则

**开关打开时**（敏感检测 + 内容搜索）:
- ✅ **敏感信息高亮**: 身份证、手机号、邮箱等用红色标记
- ✅ **搜索关键词高亮**: 表达式匹配的关键词用蓝色标记
- 📝 **侧边栏显示**: 
  - 敏感信息列表（类型、数量、位置）
  - 匹配关键词列表（关键词、出现次数）
  - 点击可跳转到对应位置

**开关关闭时**（仅内容搜索）:
- ❌ **不显示敏感信息高亮**
- ✅ **仅搜索关键词高亮**: 表达式匹配的关键词用蓝色标记
- 📝 **侧边栏显示**: 
  - 仅显示匹配关键词列表
  - 隐藏敏感信息相关UI

**高亮颜色规范**:
- 敏感信息: `#ff4d4f` (红色) + 黄色背景
- 搜索关键词: `#1890ff` (蓝色) + 浅蓝背景
- 同时匹配: 叠加显示或特殊标记

**高亮实现要点**:
- Office/PDF: 依赖 vue-office 组件的高亮API（如果支持）
- 文本文件: 使用现有的文本高亮机制
- 性能考虑: 大量匹配时使用虚拟滚动或分页

#### 实现要点

- 新建独立预览接口
- 按需加载组件
- 权限检查
- 大文件处理（>10MB 提示）
- 组件加载失败降级

---

## 三、界面设计

### 3.1 工具栏布局

**布局结构**:
```
┌─────────────────────────────────────────────────┐
│ Toolbar                                         │
│ [导出][设置][日志][主题][关于]                   │
│ [敏感开关][搜索框][开始扫描][取消][帮助]         │
└─────────────────────────────────────────────────┘
```

**右侧元素**:
1. 敏感内容开关（默认打开）
2. 搜索输入框（placeholder: "搜索表达式: 合同 | (密码 & 银行卡)"）
3. 开始扫描按钮（从左侧移过来）
4. 取消按钮（从左侧移过来）
5. 帮助图标

### 3.2 结果列表 UI 动态调整

#### 开关打开时
```
文件名 | 路径 | 大小 | 修改时间 | 敏感数量 | 操作
file1  | ...  | ...  | ...      | 5      | [预览][删除]
```

#### 开关关闭时
```
文件名 | 路径 | 大小 | 修改时间 | 操作
file1  | ...  | ...  | ...      | [预览]
```

**多选行为**:
- 开关打开：显示"一键删除"
- 开关关闭：隐藏"一键删除"

### 3.3 视觉规范

**响应式**:
- 小屏幕 (<1200px): 搜索框 200px
- 中屏幕 (1200-1600px): 搜索框 300px
- 大屏幕 (>1600px): 搜索框 400px

**颜色变量**（基于现有主题系统）:

项目已有完整的主题系统和 CSS 变量定义（`frontend/src/style.css`），新增功能应复用现有变量：

#### 现有颜色变量清单

```css
:root {
  /* 主色调 */
  --primary-color: #1890ff;
  
  /* 功能色 */
  --success-color: #52c41a;
  --warning-color: #faad14;
  --error-color: #ff4d4f;
  
  /* 文本颜色 */
  --text-color: #333;           /* 亮主题 */
  --text-secondary: #666;
  
  /* 背景颜色 */
  --bg-color: #fff;             /* 亮主题 */
  --bg-hover: #f5f5f5;
  --bg-selected: #e6f7ff;
  --modal-bg: white;
  --input-bg: white;
  --toolbar-bg: #fafafa;
  
  /* 边框颜色 */
  --border-color: #d9d9d9;
}

/* 暗主题 */
[data-theme="dark"] {
  --text-color: rgba(255, 255, 255, 0.85);
  --text-secondary: rgba(255, 255, 255, 0.45);
  --bg-color: #141414;
  --bg-hover: #1f1f1f;
  --bg-selected: #111a2c;
  --modal-bg: #1f1f1f;
  --input-bg: #1f1f1f;
  --toolbar-bg: #1f1f1f;
  --border-color: #434343;
}
```

#### 新增高亮颜色变量

在 `style.css` 中添加以下变量（扩展现有高亮样式）：

**设计原则**: 
- 定义基本色变量
- 使用 `rgb(from var() r g b / alpha)` 生成透明背景色
- 不同敏感类型使用不同的基本色
- 关键词使用统一的基本色

```css
:root {
  /* ========== 高亮基本色定义 ========== */
  
  /* 敏感信息基本色 - 红色系 */
  --highlight-base-sensitive: #ff4d4f;        /* 基础红色 */
  
  /* 搜索关键词基本色 - 蓝色系 */
  --highlight-base-keyword: #1890ff;          /* 基础蓝色 */
  
  /* ========== 敏感信息高亮（不同类型不同颜色）========== */
  
  /* 身份证 - 红色 */
  --color-highlight-id-card: var(--highlight-base-sensitive);
  --color-highlight-id-card-bg: rgb(from var(--highlight-base-sensitive) r g b / 0.1);
  
  /* 手机号 - 橙色 */
  --color-highlight-phone: #fa8c16;
  --color-highlight-phone-bg: rgb(from var(--color-highlight-phone) r g b / 0.1);
  
  /* 邮箱 - 紫色 */
  --color-highlight-email: #722ed1;
  --color-highlight-email-bg: rgb(from var(--color-highlight-email) r g b / 0.1);
  
  /* 银行卡 - 粉色 */
  --color-highlight-bank-card: #eb2f96;
  --color-highlight-bank-card-bg: rgb(from var(--color-highlight-bank-card) r g b / 0.1);
  
  /* IP地址 - 青色 */
  --color-highlight-ip: #13c2c2;
  --color-highlight-ip-bg: rgb(from var(--color-highlight-ip) r g b / 0.1);
  
  /* URL - 绿色 */
  --color-highlight-url: #52c41a;
  --color-highlight-url-bg: rgb(from var(--color-highlight-url) r g b / 0.1);
  
  /* 通用敏感信息 - 红色 */
  --color-highlight-sensitive: var(--highlight-base-sensitive);
  --color-highlight-sensitive-bg: rgb(from var(--highlight-base-sensitive) r g b / 0.1);
  
  /* ========== 搜索关键词高亮（统一蓝色）========== */
  
  --color-highlight-keyword: var(--highlight-base-keyword);
  --color-highlight-keyword-bg: rgb(from var(--highlight-base-keyword) r g b / 0.1);
}

/* 暗主题下的高亮颜色调整 */
[data-theme="dark"] {
  /* 提高亮度以保证可读性 */
  --highlight-base-sensitive: #ff7875;        /* 更亮的红色 */
  --highlight-base-keyword: #40a9ff;          /* 更亮的蓝色 */
  
  /* 其他类型也相应调整亮度 */
  --color-highlight-phone: #ffa940;
  --color-highlight-email: #9254de;
  --color-highlight-bank-card: #f759ab;
  --color-highlight-ip: #36cfc9;
  --color-highlight-url: #73d13d;
}
```

**优势**:
1. ✅ **统一管理** - 只需修改基本色，所有相关颜色自动更新
2. ✅ **自动生成** - 使用 `rgb(from var())` 自动计算透明度
3. ✅ **类型区分** - 不同敏感类型用不同颜色，便于识别
4. ✅ **主题适配** - 暗主题下自动调整亮度
5. ✅ **易扩展** - 新增类型只需添加两个变量

#### 高亮颜色对照表

| 类型 | 类名 | 亮主题 | 暗主题 | 用途 |
|------|------|--------|--------|------|
| **基本色** | - | - | - | - |
| 敏感信息基础 | `--highlight-base-sensitive` | #ff4d4f | #ff7875 | 红色基准 |
| 关键词基础 | `--highlight-base-keyword` | #1890ff | #40a9ff | 蓝色基准 |
| **敏感信息** | - | - | - | - |
| 身份证 | `.highlight-id-card` | #ff4d4f | #ff7875 | 红色 |
| 手机号 | `.highlight-phone` | #fa8c16 | #ffa940 | 橙色 |
| 邮箱 | `.highlight-email` | #722ed1 | #9254de | 紫色 |
| 银行卡 | `.highlight-bank-card` | #eb2f96 | #f759ab | 粉色 |
| IP地址 | `.highlight-ip` | #13c2c2 | #36cfc9 | 青色 |
| URL | `.highlight-url` | #52c41a | #73d13d | 绿色 |
| **搜索关键词** | - | - | - | - |
| 通用关键词 | `.highlight-keyword` | #1890ff | #40a9ff | 蓝色 |

#### 使用示例

``vue
<template>
  <!-- 敏感信息高亮 - 不同类型不同颜色 -->
  <mark class="highlight-id-card" title="身份证号码">
    110101199001011234
  </mark>
  
  <mark class="highlight-phone" title="手机号">
    13800138000
  </mark>
  
  <mark class="highlight-email" title="邮箱">
    user@example.com
  </mark>
  
  <!-- 搜索关键词高亮 - 统一蓝色 -->
  <mark class="highlight-keyword">
    合同
  </mark>
</template>

<style scoped>
/* 敏感信息高亮样式 */
.highlight-id-card {
  color: var(--color-highlight-id-card);
  background-color: var(--color-highlight-id-card-bg);
  padding: 2px 4px;
  border-radius: 2px;
}

.highlight-phone {
  color: var(--color-highlight-phone);
  background-color: var(--color-highlight-phone-bg);
  padding: 2px 4px;
  border-radius: 2px;
}

.highlight-email {
  color: var(--color-highlight-email);
  background-color: var(--color-highlight-email-bg);
  padding: 2px 4px;
  border-radius: 2px;
}

/* 搜索关键词高亮样式 */
.highlight-keyword {
  color: var(--color-highlight-keyword);
  background-color: var(--color-highlight-keyword-bg);
  padding: 2px 4px;
  border-radius: 2px;
}
</style>
```

#### 与现有高亮类的整合

项目中已有敏感信息高亮类（`style.css` 第105-155行），可以统一使用新变量：

``css
/* 现有高亮类 - 使用新变量替换硬编码颜色 */
.highlight-id-card { 
  background-color: var(--color-highlight-id-card-bg); 
  color: var(--color-highlight-id-card); 
}

.highlight-phone { 
  background-color: var(--color-highlight-phone-bg); 
  color: var(--color-highlight-phone); 
}

.highlight-email { 
  background-color: var(--color-highlight-email-bg); 
  color: var(--color-highlight-email); 
}

.highlight-bank-card { 
  background-color: var(--color-highlight-bank-card-bg); 
  color: var(--color-highlight-bank-card); 
}

.highlight-ip { 
  background-color: var(--color-highlight-ip-bg); 
  color: var(--color-highlight-ip); 
}

.highlight-url { 
  background-color: var(--color-highlight-url-bg); 
  color: var(--color-highlight-url); 
}

/* 新增通用高亮类 */
.highlight-sensitive { 
  background-color: var(--color-highlight-sensitive-bg); 
  color: var(--color-highlight-sensitive); 
}

.highlight-keyword { 
  background-color: var(--color-highlight-keyword-bg); 
  color: var(--color-highlight-keyword); 
}
```

**迁移策略**:
1. ✅ **保留现有类名** - 避免破坏性变更（`.highlight-id` → `.highlight-id-card`）
2. ✅ **替换硬编码颜色** - 所有颜色值改为 CSS 变量
3. ✅ **新增类型规范** - 使用 `--color-highlight-{type}` 命名

**动画**:
- 列显示/隐藏: `transition: all 0.3s ease`
- 按钮禁用: `transition: opacity 0.2s`
- 主题切换: `.theme-transitioning` 类（已有，0.3s 过渡）

---

## 四、技术架构

### 4.1 核心设计原则

1. **单次遍历** - 避免重复读取
2. **复用解析器** - 统一语法
3. **向后兼容** - 不破坏现有功能
4. **优雅降级** - 解析失败退回简单匹配

### 4.2 系统架构

```
前端 (Vue)
├── 结果列表搜索 (ResultsTable)
└── 文件内容搜索 (工具栏)
    ↓ IPC
后端 (Electron)
├── scanner.ts (文件遍历)
└── file-worker.ts (Worker Pool)
    ├── 提取文本
    ├── 敏感检测（条件执行）
    ├── 关键词匹配（始终执行）
    └── 合并结果
```

### 4.3 关键技术点

#### 表达式解析器

**技术选型**: `jsep` + 自定义评估器

**选择理由**:
- 成熟稳定（5k+ stars）
- 轻量级（6KB）
- 零依赖
- TypeScript 支持
- 可扩展

**实现方式**:
```typescript
import jsep from 'jsep'

// 解析为 AST
const ast = jsep('合同 | (密码 & 银行卡)')

// 自定义评估器
function evaluate(ast, context): boolean {
  // 遍历 AST 执行匹配
}
```

#### Worker 线程处理

- 嵌入关键词匹配到 file-worker.ts
- 根据开关决定是否执行敏感检测
- 始终执行关键词匹配（有表达式时）
- 合并结果返回

#### 结果列表过滤

- 前端使用相同解析器
- 同时匹配文件名和路径
- 解析失败降级到简单匹配

#### UI 动态控制

- 根据 `enableSensitiveSearch` 状态
- 使用 `v-if` 或 `v-show`
- 保持表格布局一致

#### 文档预览

- 独立预览接口
- @vue-office 系列组件
- 按需加载
- 格式判断
- 降级处理
- Electron shell.openPath

---

## 五、数据流详解

### 5.1 扫描数据流

```
用户点击"开始扫描"
  ↓
收集参数:
  - selectedPaths
  - config
  - searchExpression
  - enableSensitiveSearch
  ↓
IPC: startScan(params)
  ↓
主进程: 创建 Worker Pool
  ↓
Worker 对每个文件:
  1. 提取文本
  2. IF enableSensitiveSearch: 敏感检测
  3. IF searchExpression 非空: 内容匹配
  4. 合并结果
  5. 返回
  ↓
主进程聚合
  ↓
IPC: onScanProgress / onScanComplete
  ↓
前端更新 ResultsTable
```

### 5.2 结果数据结构

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

### 5.3 结果合并逻辑

``typescript
function mergeResults(sensitiveResult, contentResult): ScanResultItem {
  const base = { /* ... */ }
  
  if (sensitiveResult) {
    base.counts = sensitiveResult.counts
    base.total = sensitiveResult.total
    base.fromSensitiveScan = true
  }
  
  if (contentResult?.isMatch) {
    base.matchedKeywords = contentResult.keywords
    base.matchPositions = contentResult.positions
    base.fromContentSearch = true
  }
  
  return base
}
```

---

## 六、性能要求

### 6.1 性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 小文件处理时间增加 | < 20% | 相比原敏感扫描 |
| 内存峰值增加 | < 50MB | 关键词匹配开销 |
| 表达式解析时间 | < 10ms | 前端实时解析 |
| 结果过滤响应 | < 100ms | 1000条结果 |

### 6.2 优化策略

1. 单次遍历
2. 内存匹配
3. 并发控制
4. AST 缓存（可选）

---

## 七、用户体验

### 7.1 交互设计

1. **实时验证** - 输入时验证表达式
2. **错误提示** - 解析失败友好提示
3. **语法帮助** - 帮助图标显示说明
4. **智能提示** - （可选）常用关键词建议

### 7.2 帮助文档

提供搜索语法帮助：
- 基础用法
- 运算符介绍
- 常见场景
- 注意事项

### 7.3 进度反馈

**状态栏显示**:
```
已扫描: 1234/5678 | 发现: 56 敏感项 | 匹配: 23 文件
```

**更新频率**: 每10个文件更新一次（防抖）

---

## 八、错误处理

### 8.1 文件读取错误

**常见错误**:
- 文件被占用
- 权限不足
- 文件不存在
- 磁盘错误

**处理**: 记录日志，跳过该文件，不中断扫描

### 8.2 表达式解析错误

**常见错误**:
- 括号不匹配
- 运算符位置错误
- 空表达式
- 特殊字符

**处理**: 
- 实时验证
- 输入框红框提示
- 禁用扫描按钮

### 8.3 预览组件错误

**处理**:
- 捕获渲染错误
- 友好提示
- 提供"打开原文件"选项

### 8.4 取消搜索

**机制**:
- 前端发送取消信号
- Worker 检查 cancelled 标志
- 清理资源（Worker、文件句柄、缓存等）

---

## 九、测试要求

### 9.1 功能测试

**结果列表搜索**:
- 单关键词
- AND/OR/NOT
- 分组表达式
- 复杂组合
- 降级处理

**文件内容搜索**:
- 开关打开/关闭
- 各种表达式
- 大文件处理
- 错误处理

**预览功能**:
- Office 文档渲染
- PDF 渲染
- 不支持格式提示
- 大文件处理

### 9.2 边界测试

- 空状态（无目录、空表达式）
- 异常状态（文件占用、权限不足）
- 并发测试（快速切换、多次取消）

### 9.3 性能测试

- 10000+ 文件扫描
- 1000+ 结果过滤
- 100MB+ 文件预览
- 内存泄漏检测

---

## 十、实施计划

### Phase 1: 表达式解析器集成 (1天)
- 安装配置 jsep
- 实现自定义评估器
- 单元测试
- 前后端共用

### Phase 2: 结果列表搜索增强 (1-2天)
- ResultsTable 集成解析器
- 路径匹配逻辑
- 降级机制

### Phase 3: 文件内容搜索集成 (2天)
- file-worker.ts 嵌入匹配
- 结果合并逻辑
- 工具栏 UI
- UI 动态控制

### Phase 4: 文档预览增强 (2天)
- 安装 @vue-office 组件
- 创建预览组件
- 格式判断逻辑
- 降级处理
- shell.openPath 集成

### Phase 5: 测试与优化 (2天)
- 功能测试
- 性能测试
- 文档完善

**总计**: 8-9 个工作日

---

## 十一、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 表达式解析复杂度 | 低 | 中 | 使用成熟库 |
| 性能退化 | 低 | 高 | 单次遍历，严格测试 |
| 用户学习成本 | 中 | 低 | 详细帮助文档 |
| 前后端语法不一致 | 低 | 中 | 共用解析器模块 |

---

## 十二、成功标准

### 功能完整性
- ✅ 两种搜索支持完整布尔表达式
- ✅ 开关逻辑正确
- ✅ 单次遍历完成双重任务

### 性能达标
- ✅ 无明显性能退化
- ✅ 内存在可控范围
- ✅ 响应速度符合预期

### 用户体验
- ✅ 语法简单易学
- ✅ 错误提示友好
- ✅ 帮助文档完善

### 代码质量
- ✅ 不破坏现有功能
- ✅ 代码结构清晰
- ✅ 无安全漏洞
- ✅ 无内存泄漏
- ✅ 符合编码规范
- ✅ 便于维护

---

**文档结束**

*最后更新: 2026-05-08*
