# 方案 D3：混合方案 - 流式传输 + 虚拟滚动

## 📋 文档信息

- **方案名称**：流式分块传输 + 虚拟滚动渲染
- **适用场景**：大文件预览（10MB - 100MB+）
- **预计工期**：1.5-2 天
- **技术难度**：⭐⭐⭐⭐（中高）
- **创建时间**：2026-05-02
- **最后更新**：2026-05-02（整合流式传输方案）

---

## 🎯 核心目标

实现大文件预览的流式传输和虚拟滚动，确保：

- ✅ **首屏极速**：< 500ms 显示内容（流式传输）
- ✅ **支持任意大小文件**（100MB+）
- ✅ **内存占用恒定**（~20-30MB）
- ✅ **滚动流畅**（60fps，虚拟滚动）
- ✅ **高亮显示正常**（异步计算 + 分批应用）
- ✅ **保持搜索、复制等功能**

---

## 🔍 问题分析

### 当前问题

**现象**：预览 15.7MB 文件（含 67,788 个 IP 地址）时，界面卡死 8-10 秒

**根本原因**：
1. Worker 返回完整文本和高亮数据
2. **IPC 传输大数据阻塞渲染进程**（15.7MB 序列化 + 传输 + 反序列化需 2-5 秒）
3. 前端生成大量 DOM 节点（~70,000 个 `<mark>` 标签）
4. 浏览器渲染和重排耗时过长

### 解决方案对比

| 方案 | 优点 | 缺点 | 开发时间 |
|------|------|------|----------|
| **方案 C**：文件大小限制 | 简单快速 | 功能受限，用户体验差 | 0.5 天 |
| **方案 E**：Web Worker 异步渲染 | 实现简单，不阻塞 UI | 内存占用高，DOM 节点多 | 0.5-1 天 |
| **方案 D1**：分块流式传输 | 首屏极快，内存友好 | 实现复杂，搜索困难 | 1-2 天 |
| **方案 D2**：延迟加载高亮 | 实现简单，首屏较快 | IPC 仍传输完整文本 | 0.5 天 |
| **方案 D3**：混合方案（本方案） | 首屏极速 + 完整功能 | 实现较复杂 | 1.5-2 天 |

**选择理由**：
- 方案 C 只是权宜之计，无法根本解决问题
- 方案 E 仍会因 DOM 节点过多导致卡顿
- 方案 D1 虽然性能好，但搜索等功能受限
- 方案 D2 实现简单，但 IPC 传输仍是瓶颈
- **方案 D3 结合流式传输和虚拟滚动，达到最佳平衡**

---

## 🏗️ 技术架构设计

### 整体流程

```
┌─────────────────────────────────────────────────────────┐
│                     用户交互层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 滚动事件  │  │ 搜索功能  │  │ 复制功能  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
└───────┼─────────────┼─────────────┼────────────────────┘
        │             │             │
┌───────▼─────────────▼─────────────▼────────────────────┐
│              流式接收 + 虚拟滚动管理器                   │
│  ┌──────────────────────────────────────────────┐      │
│  │ • 分块接收文本（生产者 - 消费者模式）         │      │
│  │ • 队列缓冲接收的数据块                       │      │
│  │ • 计算可见区域 (startLine, endLine)           │      │
│  │ • 提取可见行文本                               │      │
│  │ • 映射高亮坐标到可见区域                       │      │
│  │ • 批量渲染（requestAnimationFrame）          │      │
│  └──────────────────────────────────────────────┘      │
└───────────────────────┬────────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────────┐
│                   渲染层                                │
│  ┌──────────────────────────────────────────────┐      │
│  │ • 渲染可见行的 HTML                            │      │
│  │ • 应用高亮样式                                 │      │
│  │ • 处理滚动条位置                               │      │
│  └──────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────┘
```

### 数据流（流式传输）

```
Worker 解析文件
    ↓
按块分割（每块 1000 行）
    ↓
【流式】逐块发送到前端（不等待）
    ↓
前端接收并加入队列
    ↓
requestAnimationFrame 触发批量渲染
    ↓
合并已接收的块
    ↓
构建行索引（增量）
    ↓
计算可见区域
    ↓
提取可见行 + 对应高亮
    ↓
渲染 HTML
    ↓
继续接收下一块...（并行执行）
```

---

## 🔄 流式传输核心设计

### 生产者 - 消费者模式

```
Worker 线程（生产者）                前端主线程（消费者）
    |                                    |
    |-- 发送第 1 块 --------------------->|
    |                                    |-- 加入接收队列
100ms|-- 发送第 2 块 --------------------->|
    |                                    |-- 加入接收队列
200ms|-- 发送第 3 块 --------------------->|
    |                                    |-- requestAnimationFrame
300ms|                                    |-- 批量渲染 1-3 块
    |-- 发送第 4 块 --------------------->|
    |                                    |-- 加入接收队列
400ms|-- 发送第 5 块 --------------------->|
    |                                    |-- 加入接收队列
500ms|                                    |-- requestAnimationFrame
    |                                    |-- 批量渲染 4-5 块
```

**关键点**：
1. **Worker 持续发送**，不等待前端响应
2. **前端使用队列缓冲**接收的数据块
3. **requestAnimationFrame 批量渲染**，避免频繁 DOM 操作
4. **背压控制**：队列过大时暂停接收

### 数据结构设计

```typescript
// 数据块接口
interface PreviewChunk {
  chunkIndex: number        // 块索引
  lines: string[]           // 该块的行文本
  highlights: Highlight[]   // 该块的高亮数据
  startLine: number         // 起始行号
  totalLines: number        // 总行数
}

// 预览状态
interface PreviewState {
  receivedChunks: PreviewChunk[]    // 已接收但未渲染的块（队列）
  renderedLines: string[]           // 已渲染的行
  renderedHighlights: Highlight[]   // 已渲染的高亮
  isRendering: boolean              // 是否正在渲染
  totalChunks: number               // 总块数
  receivedChunksCount: number       // 已接收块数
}
```

### 渲染调度器

```typescript
let renderScheduled = false

function scheduleRender() {
  // 如果已经在调度中，不再重复调度
  if (renderScheduled) return
  
  renderScheduled = true
  
  // 使用 requestAnimationFrame 批量渲染
  requestAnimationFrame(() => {
    renderScheduled = false
    performBatchRender()
  })
}

async function performBatchRender() {
  // 如果正在渲染，跳过本次
  if (state.isRendering) return
  
  state.isRendering = true
  
  try {
    // 取出所有待渲染的块
    const chunksToRender = [...state.receivedChunks]
    state.receivedChunks = []  // 清空队列
    
    if (chunksToRender.length === 0) return
    
    // 按块索引排序
    chunksToRender.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    // 合并行和高亮
    for (const chunk of chunksToRender) {
      state.renderedLines.push(...chunk.lines)
      state.renderedHighlights.push(...chunk.highlights)
    }
    
    // 更新虚拟滚动器的数据
    scroller.updateData(state.renderedLines)
    
    // 重新渲染可见区域
    await nextTick()
    renderVisibleContent()
    
  } finally {
    state.isRendering = false
    
    // 如果还有新数据，继续渲染
    if (state.receivedChunks.length > 0) {
      scheduleRender()
    }
  }
}
```

---

## 📝 待办清单（Task List）

### 阶段 7：流式传输基础（预计 0.5 天）⭐ **新增**

#### T7.1: Worker 端分块发送

**文件**：`src/file-worker.ts`

**改造内容**：

- [ ] 修改预览模式，支持流式发送
  ```typescript
  if (previewMode && streamMode) {
    const lines = text.split('\n');
    const chunkSize = task.chunkSize || 1000;
    
    // 连续发送所有块，不等待前端响应
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const chunkHighlights = getHighlightsForLines(
        chunkLines, 
        globalHighlights, 
        i
      );
      
      parentPort?.postMessage({
        type: 'chunk',
        chunkIndex: Math.floor(i / chunkSize),
        lines: chunkLines,
        highlights: chunkHighlights,
        startLine: i,
        totalLines: lines.length
      });
      
      // 每发送 10 块，让出控制权
      if (i % (chunkSize * 10) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    parentPort?.postMessage({ 
      type: 'complete',
      totalChunks: Math.ceil(lines.length / chunkSize)
    });
  }
  ```

- [ ] 实现 `getHighlightsForLines` 函数，按行范围提取高亮
- [ ] 添加流式模式标志判断

**验收标准**：
- [ ] Worker 能够正确分块发送
- [ ] 每块包含正确的行文本和高亮数据
- [ ] 发送完成后发送 complete 消息

---

#### T7.2: 前端队列接收与渲染调度

**文件**：`frontend/src/components/PreviewModal.vue`

**改造内容**：

- [ ] 定义数据结构
  ```typescript
  interface PreviewChunk {
    chunkIndex: number
    lines: string[]
    highlights: Highlight[]
    startLine: number
    totalLines: number
  }
  
  const state = reactive({
    receivedChunks: [] as PreviewChunk[],
    renderedLines: [] as string[],
    renderedHighlights: [] as Highlight[],
    isRendering: false,
    totalChunks: 0,
    receivedChunksCount: 0
  })
  ```

- [ ] 监听数据块事件
  ```typescript
  const unsubscribe = await onPreviewChunk((chunk: PreviewChunk) => {
    state.receivedChunks.push(chunk)
    state.receivedChunksCount++
    
    if (chunk.chunkIndex === 0) {
      loading.value = false  // 立即隐藏加载动画
    }
    
    scheduleRender()
  })
  ```

- [ ] 实现渲染调度器（见上文“渲染调度器”部分）
- [ ] 添加背压控制（MAX_QUEUE_SIZE = 50）

**验收标准**：
- [ ] 能够正确接收数据块
- [ ] 队列缓冲正常工作
- [ ] 批量渲染触发正常
- [ ] 首屏在 500ms 内显示

---

### 阶段 1：基础架构搭建（预计 0.5 天）

#### T1.1: 创建虚拟滚动管理器类

**文件**：`frontend/src/utils/preview-virtual-scroller.ts`

**核心数据结构**：

```typescript
interface VirtualScrollerState {
  allLines: string[]          // 所有行（分割后的文本）
  totalLines: number          // 总行数
  lineHeight: number          // 每行高度（像素）
  viewportHeight: number      // 视口高度
  scrollTop: number           // 滚动位置
  visibleStartLine: number    // 可见起始行
  visibleEndLine: number      // 可见结束行
  bufferLines: number         // 缓冲行数（上下各多渲染几行）
  
  // 行索引缓存
  lineStartPositions: number[]  // 每行的起始字符位置 [0, 45, 98, ...]
}
```

**核心方法**：

- [ ] `constructor(text: string, lineHeight: number, bufferLines?: number)`
  - 分割文本为行数组
  - 构建行索引缓存
  
- [ ] `calculateVisibleRange(scrollTop: number, viewportHeight: number): { startLine: number, endLine: number }`
  - 根据滚动位置和视口高度计算可见区域
  - 考虑缓冲区域
  
- [ ] `getVisibleLines(startLine: number, endLine: number): string[]`
  - 提取指定范围的行文本
  
- [ ] `updateScrollPosition(scrollTop: number): void`
  - 更新滚动位置
  - 触发重新计算

**验收标准**：
- [ ] 能够正确分割文本
- [ ] 行索引缓存构建正确
- [ ] 可见区域计算准确

---

#### T1.2: 修改 PreviewModal 模板结构

**文件**：`frontend/src/components/PreviewModal.vue`

**改造内容**：

- [ ] 替换现有的 `<pre>` 标签为虚拟滚动容器
  ```vue
  <div 
    class="virtual-scroll-container"
    ref="scrollContainer"
    @scroll="handleScroll"
  >
    <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
      <div 
        class="virtual-content"
        :style="{ transform: `translateY(${offsetTop}px)` }"
      >
        <!-- 可见行将在这里动态渲染 -->
      </div>
    </div>
  </div>
  ```

- [ ] 添加滚动监听器
  ```typescript
  const handleScroll = debounce((e: Event) => {
    const target = e.target as HTMLElement
    scroller.updateScrollPosition(target.scrollTop)
    updateVisibleContent()
  }, 50)
  ```

- [ ] 添加视口尺寸监听器（响应式）
  ```typescript
  watch(() => containerHeight, () => {
    updateVisibleContent()
  })
  ```

**验收标准**：
- [ ] 模板结构正确
- [ ] 滚动事件能够触发
- [ ] 视口变化能够响应

---

### 阶段 2：行号映射与高亮转换（预计 1 天）⭐ **核心难点**

#### T2.1: 实现字符偏移量 → 行号转换

**算法设计**：

```typescript
// 预计算：分割文本时建立索引
function buildLineIndex(text: string): {
  lines: string[]
  lineStartPositions: number[]
} {
  const lines = text.split('\n')
  const lineStartPositions = [0]
  
  let position = 0
  for (let i = 0; i < lines.length; i++) {
    position += lines[i].length + 1  // +1 是换行符
    lineStartPositions.push(position)
  }
  
  return { lines, lineStartPositions }
}

// 查询：二分查找定位行号
function findLineNumberByOffset(
  offset: number,
  lineStartPositions: number[]
): number {
  let left = 0
  let right = lineStartPositions.length - 2
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    
    if (offset >= lineStartPositions[mid] && 
        offset < lineStartPositions[mid + 1]) {
      return mid
    } else if (offset < lineStartPositions[mid]) {
      right = mid - 1
    } else {
      left = mid + 1
    }
  }
  
  return lineStartPositions.length - 2
}
```

**实现任务**：

- [ ] 在 `VirtualScroller` 构造函数中调用 `buildLineIndex`
- [ ] 实现 `findLineNumberByOffset` 函数
- [ ] 实现反向查询 `findOffsetByLineNumber(lineNumber: number): number`
- [ ] 添加单元测试验证边界情况

**验收标准**：
- [ ] 对于任意字符偏移量，能正确找到行号
- [ ] 二分查找性能良好（O(log n)）
- [ ] 边界情况处理正确（首行、末行、超出范围）

---

#### T2.2: 高亮数据转换

**数据结构定义**：

```typescript
// 全局高亮（Worker 返回的格式）
interface GlobalHighlight {
  start: number   // 全局字符偏移
  end: number
  typeId: string
  typeName: string
}

// 行内高亮（渲染时使用的格式）
interface LineHighlight {
  lineIndex: number    // 行号
  localStart: number   // 行内起始位置
  localEnd: number     // 行内结束位置
  typeId: string
  typeName: string
}
```

**转换算法**：

```typescript
function convertHighlights(
  globalHighlights: GlobalHighlight[],
  lineStartPositions: number[]
): Map<number, LineHighlight[]> {
  const lineHighlightsMap = new Map<number, LineHighlight[]>()
  
  for (const highlight of globalHighlights) {
    const startLine = findLineNumberByOffset(highlight.start, lineStartPositions)
    const endLine = findLineNumberByOffset(highlight.end, lineStartPositions)
    
    if (startLine === endLine) {
      // 情况 1：高亮在同一行内
      const localStart = highlight.start - lineStartPositions[startLine]
      const localEnd = highlight.end - lineStartPositions[startLine]
      
      if (!lineHighlightsMap.has(startLine)) {
        lineHighlightsMap.set(startLine, [])
      }
      lineHighlightsMap.get(startLine)!.push({
        lineIndex: startLine,
        localStart,
        localEnd,
        typeId: highlight.typeId,
        typeName: highlight.typeName
      })
    } else {
      // 情况 2：高亮跨越多行，需要拆分
      
      // 第一行：从起始位置到行尾
      const firstLocalEnd = lineStartPositions[startLine + 1] - 1 - lineStartPositions[startLine]
      if (!lineHighlightsMap.has(startLine)) {
        lineHighlightsMap.set(startLine, [])
      }
      lineHighlightsMap.get(startLine)!.push({
        lineIndex: startLine,
        localStart: highlight.start - lineStartPositions[startLine],
        localEnd: firstLocalEnd,
        typeId: highlight.typeId,
        typeName: highlight.typeName
      })
      
      // 中间行：整行高亮
      for (let line = startLine + 1; line < endLine; line++) {
        if (!lineHighlightsMap.has(line)) {
          lineHighlightsMap.set(line, [])
        }
        lineHighlightsMap.get(line)!.push({
          lineIndex: line,
          localStart: 0,
          localEnd: lineStartPositions[line + 1] - lineStartPositions[line] - 1,
          typeId: highlight.typeId,
          typeName: highlight.typeName
        })
      }
      
      // 最后一行：从行首到结束位置
      const lastLocalEnd = highlight.end - lineStartPositions[endLine]
      if (!lineHighlightsMap.has(endLine)) {
        lineHighlightsMap.set(endLine, [])
      }
      lineHighlightsMap.get(endLine)!.push({
        lineIndex: endLine,
        localStart: 0,
        localEnd: lastLocalEnd,
        typeId: highlight.typeId,
        typeName: highlight.typeName
      })
    }
  }
  
  return lineHighlightsMap
}
```

**实现任务**：

- [ ] 实现 `convertHighlights` 函数
- [ ] 处理三种情况：
  - [ ] 高亮在同一行内
  - [ ] 高亮跨越两行
  - [ ] 高亮跨越多行
- [ ] 优化性能：批量处理，避免重复查找
- [ ] 添加日志记录转换过程

**验收标准**：
- [ ] 单行高亮转换正确
- [ ] 跨行高亮拆分正确
- [ ] 67,788 个 IP 高亮能在 1 秒内完成转换
- [ ] 内存占用合理

---

#### T2.3: 性能优化

**优化策略**：

- [ ] 使用二分查找加速行号定位（已实现）
- [ ] 缓存转换结果，避免重复计算
  ```typescript
  private highlightsCache: Map<string, Map<number, LineHighlight[]>> = new Map()
  
  getConvertedHighlights(highlights: GlobalHighlight[]): Map<number, LineHighlight[]> {
    const cacheKey = JSON.stringify(highlights)
    if (this.highlightsCache.has(cacheKey)) {
      return this.highlightsCache.get(cacheKey)!
    }
    
    const result = convertHighlights(highlights, this.lineStartPositions)
    this.highlightsCache.set(cacheKey, result)
    return result
  }
  ```

- [ ] 对于跨行高亮，拆分为多个行内高亮（已实现）
- [ ] 限制最大高亮数量（可选，如前 10,000 个）

**验收标准**：
- [ ] 首次转换耗时 < 1 秒
- [ ] 后续查询使用缓存，耗时 < 10ms
- [ ] 内存占用 < 50MB

---

### 阶段 3：渲染引擎实现（预计 0.5 天）

#### T3.1: 实现可见行渲染

**渲染函数设计**：

```typescript
function renderVisibleLines(
  lines: string[],
  startLineIndex: number,
  lineHighlightsMap: Map<number, LineHighlight[]>
): string {
  let html = ''
  
  for (let i = 0; i < lines.length; i++) {
    const lineIndex = startLineIndex + i
    const lineText = lines[i]
    const highlights = lineHighlightsMap.get(lineIndex) || []
    
    // 对该行应用高亮
    const highlightedLine = highlightLine(lineText, highlights)
    
    html += `<div class="code-line" data-line="${lineIndex}">${highlightedLine}</div>`
  }
  
  return html
}

function highlightLine(text: string, highlights: LineHighlight[]): string {
  if (highlights.length === 0) {
    return escapeHtml(text)
  }
  
  // 按起始位置排序
  const sorted = [...highlights].sort((a, b) => a.localStart - b.localStart)
  
  let result = ''
  let lastIndex = 0
  
  for (const highlight of sorted) {
    // 添加高亮前的普通文本
    result += escapeHtml(text.substring(lastIndex, highlight.localStart))
    
    // 添加高亮文本
    const highlightedText = escapeHtml(text.substring(highlight.localStart, highlight.localEnd))
    const colorClass = getColorClass(highlight.typeId)
    result += `<mark class="${colorClass}" title="${highlight.typeName}">${highlightedText}</mark>`
    
    lastIndex = highlight.localEnd
  }
  
  // 添加剩余文本
  if (lastIndex < text.length) {
    result += escapeHtml(text.substring(lastIndex))
  }
  
  return result
}
```

**实现任务**：

- [ ] 复用现有的 `highlightText` 逻辑，改为按行处理
- [ ] 实现 `escapeHtml` 函数（防止 XSS）
- [ ] 实现 `getColorClass` 函数（映射类型到 CSS 类）
- [ ] 添加行号显示（可选）

**验收标准**：
- [ ] 单行高亮渲染正确
- [ ] 多行渲染性能良好
- [ ] HTML 转义正确，无 XSS 风险

---

#### T3.2: 实现动态高度容器

**CSS 设计**：

```css
.virtual-scroll-container {
  height: 100%;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}

.virtual-spacer {
  position: relative;
  width: 100%;
  /* 高度由 JS 动态设置 */
}

.virtual-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* transform 由 JS 动态设置 */
  will-change: transform;
}

.code-line {
  height: 20px;  /* 固定行高 */
  line-height: 20px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  white-space: pre;
  padding: 0 10px;
}
```

**实现任务**：

- [ ] 设置容器总高度 = `totalLines * lineHeight`
- [ ] 使用 `transform: translateY()` 放置可见行
- [ ] 确保滚动条正确反映总内容高度
- [ ] 添加 `will-change: transform` 优化性能

**验收标准**：
- [ ] 滚动条长度正确反映总行数
- [ ] 滚动位置与实际内容同步
- [ ] 无布局抖动

---

#### T3.3: 滚动同步

**实现逻辑**：

```typescript
const handleScroll = debounce((e: Event) => {
  const target = e.target as HTMLElement
  const scrollTop = target.scrollTop
  
  // 更新滚动位置
  scroller.updateScrollPosition(scrollTop)
  
  // 重新计算可见区域
  const { startLine, endLine } = scroller.calculateVisibleRange(scrollTop, viewportHeight)
  
  // 更新状态
  currentStartLine.value = startLine
  currentEndLine.value = endLine
  
  // 获取可见行
  visibleLines.value = scroller.getVisibleLines(startLine, endLine)
  
  // 获取该行范围的高亮
  visibleHighlightsMap.value = getHighlightsForRange(startLine, endLine)
  
  // 渲染
  nextTick(() => {
    renderContent()
  })
}, 50)
```

**实现任务**：

- [ ] 监听滚动事件，更新 `scrollTop`
- [ ] 触发重新计算可见区域
- [ ] 使用 `requestAnimationFrame` 优化性能
- [ ] 添加防抖（50ms）

**验收标准**：
- [ ] 滚动流畅，无卡顿
- [ ] FPS ≥ 50
- [ ] 无闪烁现象

---

### 阶段 4：功能适配（预计 0.5 天）

#### T4.1: 搜索功能适配

**需求**：
- 在虚拟滚动中搜索文本
- 跳转到匹配的行
- 高亮当前搜索结果

**实现方案**：

```typescript
// 预构建搜索索引
function buildSearchIndex(lines: string[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  
  for (let i = 0; i < lines.length; i++) {
    const words = lines[i].toLowerCase().split(/\s+/)
    for (const word of words) {
      if (!index.has(word)) {
        index.set(word, [])
      }
      index.get(word)!.push(i)
    }
  }
  
  return index
}

// 搜索并跳转
function searchAndJump(keyword: string) {
  const matchingLines = searchIndex.get(keyword.toLowerCase()) || []
  
  if (matchingLines.length > 0) {
    // 跳转到第一个匹配行
    const targetLine = matchingLines[0]
    scrollToLine(targetLine)
    
    // 高亮该行
    highlightSearchResult(targetLine)
  }
}

// 滚动到指定行
function scrollToLine(lineNumber: number) {
  const targetScrollTop = lineNumber * lineHeight
  scrollContainer.value!.scrollTop = targetScrollTop
}
```

**实现任务**：

- [ ] 修改搜索逻辑，支持在虚拟滚动中定位
- [ ] 实现"跳转到匹配行"功能
- [ ] 高亮当前搜索结果
- [ ] 支持"上一个/下一个"导航

**验收标准**：
- [ ] 搜索响应迅速（< 500ms）
- [ ] 跳转准确
- [ ] 高亮显示清晰

---

#### T4.2: 复制功能适配

**需求**：
- 复制全部内容（拼接所有行）
- 复制可见内容（只复制当前可见行）

**实现方案**：

```typescript
// 复制全部内容
async function copyAllContent() {
  const fullText = scroller.allLines.join('\n')
  
  // 对于大文件，显示进度提示
  if (fullText.length > 10 * 1024 * 1024) {  // > 10MB
    showMessage('正在准备复制内容，请稍候...', { type: 'info' })
  }
  
  await navigator.clipboard.writeText(fullText)
  showMessage('✅ 已复制到剪贴板', { type: 'info' })
}

// 复制可见内容
async function copyVisibleContent() {
  const visibleText = visibleLines.value.join('\n')
  await navigator.clipboard.writeText(visibleText)
  showMessage('✅ 已复制可见内容', { type: 'info' })
}
```

**实现任务**：

- [ ] 实现"复制全部内容"（拼接所有行）
- [ ] 实现"复制可见内容"（只复制当前可见行）
- [ ] 添加复制进度提示（大文件可能需要时间）
- [ ] 在 UI 中添加两个选项

**验收标准**：
- [ ] 复制内容完整
- [ ] 大文件复制有进度提示
- [ ] 用户体验友好

---

#### T4.3: 错误处理与边界情况

**需要处理的场景**：

- [ ] 空文件（0 字节）
- [ ] 单行超长文件（无换行符，如 10MB 单行）
- [ ] 特殊字符编码（UTF-8, GBK 等）
- [ ] Worker 返回的空数据
- [ ] 高亮数据为空
- [ ] 行高不一致（混合字体大小）

**实现方案**：

```typescript
// 处理单行超长文件
if (lines.length === 1 && lines[0].length > 10000) {
  // 自动换行显示
  lines = wrapLongLine(lines[0], 120)  // 每 120 字符换行
}

// 处理空文件
if (text.length === 0) {
  showError('文件内容为空')
  return
}

// 处理 Worker 错误
if (!result.content) {
  showError('文件解析失败')
  return
}
```

**验收标准**：
- [ ] 所有边界情况都有处理
- [ ] 错误提示友好
- [ ] 不会崩溃或卡死

---

### 阶段 5：性能优化与测试（预计 0.5 天）

#### T5.1: 性能优化

**优化措施**：

- [ ] 添加防抖：滚动事件防抖（50ms）
- [ ] 使用 `will-change: transform` 优化渲染
- [ ] 限制最大渲染行数（如最多 100 行可见）
- [ ] 添加缓冲区域（上下各 10 行），减少闪烁
- [ ] 使用 `requestIdleCallback` 在非关键路径执行低优先级任务
- [ ] 启用 GPU 加速：`transform: translateZ(0)`

**配置参数**：

```typescript
const CONFIG = {
  LINE_HEIGHT: 20,           // 行高（像素）
  BUFFER_LINES: 10,          // 缓冲行数
  MAX_VISIBLE_LINES: 100,    // 最大可见行数
  SCROLL_DEBOUNCE_MS: 50,    // 滚动防抖时间
  HIGHLIGHT_CACHE_SIZE: 100, // 高亮缓存大小
}
```

**验收标准**：
- [ ] 滚动 FPS ≥ 55
- [ ] 内存占用 < 30MB
- [ ] 无明显闪烁

---

#### T5.2: 测试用例

**测试矩阵**：

| 文件大小 | 行数 | 高亮数 | 预期结果 |
|---------|------|--------|---------|
| 100KB | 1,000 | 100 | ✅ 流畅 |
| 1MB | 10,000 | 1,000 | ✅ 流畅 |
| 10MB | 100,000 | 10,000 | ✅ 流畅 |
| 15.7MB | 150,000 | 67,788 | ✅ 流畅（当前痛点） |
| 50MB | 500,000 | 50,000 | ✅ 流畅 |
| 100MB | 1,000,000 | 100,000 | ⚠️ 可能稍慢 |

**极端情况测试**：

- [ ] 单行 10MB 的文件
- [ ] 100 万行的文件
- [ ] 包含 10 万个高亮的文件
- [ ] 无高亮的纯文本文件
- [ ] 包含特殊字符的文件（emoji、中文、阿拉伯文等）

**验收标准**：
- [ ] 所有测试用例通过
- [ ] 无崩溃或严重卡顿
- [ ] 功能完整

---

#### T5.3: 性能指标监控

**监控指标**：

```typescript
// 性能日志
const perfMetrics = {
  loadTime: 0,           // 首次加载时间
  conversionTime: 0,     // 高亮转换时间
  renderTime: 0,         // 单次渲染时间
  scrollFPS: 0,          // 滚动帧率
  memoryUsage: 0,        // 内存占用
}

// 记录性能数据
function logPerformance(metric: string, value: number) {
  console.log(`[Performance] ${metric}: ${value}`)
  
  // 可以发送到分析服务
  // analytics.track('preview_performance', { metric, value })
}
```

**实现任务**：

- [ ] 测量首次加载时间
- [ ] 测量滚动 FPS
- [ ] 测量内存占用
- [ ] 添加性能日志
- [ ] 生成性能报告

**验收标准**：
- [ ] 性能数据可追溯
- [ ] 能够发现性能瓶颈
- [ ] 为后续优化提供依据

---

## ⚠️ 风险与挑战

### 高风险项

#### 1. 高亮跨行处理（复杂度：⭐⭐⭐⭐⭐）

**风险描述**：
- 需要正确处理跨越多行的高亮
- 拆分逻辑容易出错
- 边界情况多（高亮正好在行尾、行首等）

**缓解措施**：
- 编写详细的单元测试
- 手动测试各种边界情况
- 添加日志记录拆分过程
- 准备降级方案：如果跨行高亮太复杂，暂时不支持

---

#### 2. 性能瓶颈（复杂度：⭐⭐⭐⭐）

**风险描述**：
- 如果单次渲染超过 100 行，仍可能卡顿
- 需要精确控制缓冲区域大小
- 不同浏览器性能差异大

**缓解措施**：
- 限制最大可见行数
- 使用性能监控工具
- 在不同浏览器上测试
- 准备降级方案：降低缓冲区域大小

---

#### 3. 搜索定位（复杂度：⭐⭐⭐⭐）

**风险描述**：
- 在虚拟滚动中跳转到指定行需要特殊处理
- 需要维护搜索结果的行号索引
- 大量搜索结果时性能下降

**缓解措施**：
- 先实现基础搜索，再优化
- 限制搜索结果数量（如前 1000 个）
- 使用 Web Worker 进行搜索
- 准备降级方案：提示用户缩小搜索范围

---

## 📊 预期效果

### 性能指标对比（15.7MB 文件，67,788 个 IP）

| 指标 | 当前（卡死） | 方案 D3 预期 | 提升倍数 |
|------|-------------|------------|----------|
| **首屏时间** | 8-10 秒 | < 500ms | **20x** |
| **首次可见** | N/A（卡死） | 300ms | ∞ |
| **滚动 FPS** | 0（卡死） | 60fps | ∞ |
| **内存占用** | ~200MB | ~30MB | **6.7x** |
| **DOM 节点数** | ~70,000 | ~100 | **700x** |
| **总加载时间** | 8-10 秒 | 2-3 秒 | **3x** |

### 时间轴分析

```
0ms     - 用户点击预览
100ms   - Worker 开始解析
300ms   - 第 1 块文本到达（1000 行）
350ms   - ✅ 首屏渲染完成（用户看到内容）
400ms   - 第 2 块文本到达
500ms   - 第 3 块文本到达
600ms   - 批量渲染 2-3 块
...
2000ms  - 所有文本传输完成
2100ms  - 开始异步计算高亮
2500ms  - 第 1 批高亮应用（前 1000 个）
3000ms  - 第 2 批高亮应用
...
5000ms  - ✅ 全部高亮完成
```

### 用户体验提升

- ✅ **几乎即时显示**：300ms 内看到第一屏内容
- ✅ **渐进式加载**：用户可以边看边等，无需等待全部加载
- ✅ **滚动丝滑流畅**：60fps，无卡顿
- ✅ **可以随时取消**：用户随时可以关闭预览
- ✅ **支持超大文件**：100MB+ 文件也能流畅浏览

---

## 🎯 实施顺序建议

### 推荐顺序

1. **第 1 步**：T7.1 + T7.2（流式传输基础）
   - 预计时间：0.5 天
   - 目标：实现 Worker 分块发送和前端队列接收

2. **第 2 步**：T1.1 + T1.2（虚拟滚动架构）
   - 预计时间：0.5 天
   - 目标：搭建虚拟滚动框架

3. **第 3 步**：T2.1 + T2.2（核心算法）⭐ 最关键
   - 预计时间：0.5 天
   - 目标：实现行号映射和高亮转换

4. **第 4 步**：T3.1 + T3.2（渲染引擎）
   - 预计时间：0.5 天
   - 目标：实现可见行渲染

5. **第 5 步**：T4.1 + T4.2（功能完善）
   - 预计时间：0.5 天
   - 目标：实现搜索、复制等功能

6. **第 6 步**：T5.1 + T5.2（优化测试）
   - 预计时间：0.5 天
   - 目标：性能优化和全面测试

**总计**：约 1.5-2 天

---

## 🔧 技术栈

### 核心技术

- **Vue 3 Composition API**：响应式状态管理
- **TypeScript**：类型安全
- **原生 JavaScript**：高性能计算
- **CSS Transform**：GPU 加速渲染

### 依赖库

- **现有**：
  - `vue-virtual-scroller`（可选，用于参考）
  - `pinia`（状态管理）

- **新增**：
  - 无（全部手写，避免额外依赖）

---

## 📝 确认事项

在开始实施前，请确认以下问题：

### 1. 是否保留现有的文件大小限制（50MB）？

**建议**：❌ 移除限制，让虚拟滚动处理所有文件

**理由**：
- 虚拟滚动的目标就是支持任意大小文件
- 保留限制会降低用户体验
- 可以通过性能监控发现真正的问题

---

### 2. 是否需要显示行号？

**建议**：✅ 添加行号列，方便定位

**实现**：
```vue
<div class="code-line">
  <span class="line-number">{{ lineIndex + 1 }}</span>
  <span class="line-content" v-html="highlightedLine"></span>
</div>
```

**样式**：
```css
.line-number {
  display: inline-block;
  width: 50px;
  text-align: right;
  color: #999;
  user-select: none;
  margin-right: 10px;
}
```

---

### 3. 是否需要支持"跳转到指定行"？

**建议**：⏸️ 作为增强功能，后续添加

**理由**：
- 基础版本先保证核心功能稳定
- 跳转功能可以在搜索功能基础上扩展
- 避免初期复杂度太高

---

### 4. 缓冲区域大小？

**建议**：上下各 10 行（可配置）

**理由**：
- 太小会导致滚动时闪烁
- 太大会增加内存占用
- 10 行是平衡点

**配置**：
```typescript
const BUFFER_LINES = 10  // 可调整为 5-20
```

---

### 5. 单行最大长度限制？

**建议**：✅ 如果单行超过 10,000 字符，自动换行显示

**实现**：
```typescript
function wrapLongLine(line: string, maxLength: number = 10000): string[] {
  if (line.length <= maxLength) {
    return [line]
  }
  
  const wrapped: string[] = []
  for (let i = 0; i < line.length; i += maxLength) {
    wrapped.push(line.substring(i, i + maxLength))
  }
  
  return wrapped
}
```

**理由**：
- 避免横向滚动条过长
- 提高可读性
- 减少渲染压力

---

## 🚀 下一步行动

1. **确认方案**：请您审阅以上方案，确认是否符合预期
2. **调整细节**：如有需要调整的地方，请指出
3. **开始实施**：确认后，我将按照待办清单逐步实施

---

## 📚 参考资料

- [Vue Virtual Scroller](https://github.com/Akryum/vue-virtual-scroller)
- [React Window](https://github.com/bvaughn/react-window)（设计理念参考）
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)

---

**文档版本**：v1.0  
**最后更新**：2026-05-02  
**作者**：Lingma AI Assistant
