# 真正的流式处理实施方案

## 📋 方案概述

实现边读边处理的真正流式架构,确保内存可控、无漏检、统一接口。

### 核心目标

1. **内存可控**: 峰值内存固定在 ~5MB,与文件大小无关
2. **无漏检**: 通过滑动窗口重叠区防止敏感词跨边界被切断
3. **统一接口**: 扫描模式和预览模式都使用同一套流式逻辑
4. **智能路由**: 根据文件类型自动选择最优处理路径

---

## 🏗️ 架构设计

### 当前架构 (伪流式)

```
文件 → [Worker一次性读取完整文本] → 按行分割 → 逐块发送 → 前端
       ↑ 占用大量内存 (文件大小)
```

**问题**:
- ❌ 整个文件先被加载到 Worker 内存
- ❌ 100MB 的文件会占用 100MB+ 内存
- ❌ 只是"流式传输",不是"流式读取"

### 新架构 (真流式)

```
文件 → [createReadStream 64KB缓冲] → [累积到5MB] → 检测+发送 → 前端
                                         ↑ 峰值内存固定 ~5MB
```

**优势**:
- ✅ 峰值内存固定 (~5MB),与文件大小无关
- ✅ 边读边处理,无需等待全部加载
- ✅ 支持超大文件(GB级别)

---

## 🔧 核心技术方案

### 1. 智能路由策略

使用 `file-types.ts` 中已有的配置系统进行智能路由:

```typescript
import { 
  supportsTrueStreaming, 
  getFileTypeConfig,
  FileProcessorType 
} from './file-types';

const config = getFileTypeConfig(filePath);

if (config.supportsStreaming) {
  // ✅ 路径A: 真正的流式处理 (txt/log/csv等)
  await processor.processRawFile(filePath, options);
} else {
  // ❌ 路径B: 先解析,再流式发送 (docx/xlsx/pdf等)
  const { text } = await extractTextFromFile(filePath);
  await processor.processExtractedText(text, options);
}
```

### 2. 分块策略

**原则**: 按字节分块 + 智能边界调整

```typescript
// 当缓冲区达到 5MB 时
if (buffer.length >= this.chunkSize) {
  // 1. 找到最近的行边界 (\n)
  let splitPos = buffer.lastIndexOf('\n', this.chunkSize);
  
  // 2. 如果找不到行边界 (超长行),强制在 chunkSize 处分割
  if (splitPos === -1 || splitPos < this.chunkSize * 0.8) {
    splitPos = this.chunkSize;
  }
  
  // 3. 提取当前块 (包含上一块的重叠区)
  const currentChunk = this.previousOverlap + buffer.slice(0, splitPos);
  
  // 4. 计算新的重叠区
  this.previousOverlap = currentChunk.slice(-this.overlapSize);
  
  // 5. 移除已处理的部分
  buffer = buffer.slice(splitPos);
  
  // 6. 处理当前块
  this.processChunk(currentChunk, enabledTypes);
}
```

**优势**:
- ✅ 优先在行边界分割,保持语义完整性
- ✅ 对超长行有保护机制 (不会无限等待)
- ✅ 重叠区保证跨边界敏感词不被遗漏

### 3. 滑动窗口重叠策略

```
块1: [......重叠区][新内容...................]
                    ↑ 检测到敏感词 "password123"
                    
块2: [重叠区][新内容.........................]
      ↑ 这部分在块1中已检测过,需要过滤
```

**过滤逻辑**:

```typescript
private processChunk(chunk: string, overlapLength: number, enabledTypes: string[]) {
  // 检测整个块 (包括重叠区)
  const allHighlights = getHighlights(chunk, enabledTypes);
  
  // 只保留非重叠区的结果 (position >= overlapLength)
  const newHighlights = allHighlights.filter(h => h.start >= overlapLength);
  
  return {
    highlights: newHighlights,  // 新的检测结果
    overlapTail: chunk.slice(-this.overlapSize)  // 传递给下一块
  };
}
```

### 4. 两种处理路径

#### 路径A: 真正流式 (纯文本文件)

**适用文件**: txt, log, csv, json, xml, 源代码文件等

**流程**:
```
createReadStream (64KB缓冲)
  ↓
累积到 5MB
  ↓
滑动窗口检测
  ↓
逐块发送
```

**内存占用**: ~5MB (固定)

#### 路径B: 半流式 (二进制文件)

**适用文件**: docx, xlsx, pdf, pptx 等

**流程**:
```
extractTextFromFile (解析器提取完整文本)
  ↓
按行分割 + 滑动窗口检测
  ↓
逐块发送
```

**内存占用**: 文件大小 + ~5MB

**说明**: 虽然解析阶段需要加载完整文件,但**敏感词检测和传输仍然是流式的**,这已经比当前实现更好。

---

## 📦 核心组件

### 1. FileStreamProcessor 类

**位置**: `src/file-stream-processor.ts`

**职责**: 
- 管理流式读取状态
- 处理分块和滑动窗口
- 协调敏感词检测

**关键属性**:

```typescript
class FileStreamProcessor {
  private readonly chunkSize: number;      // 5MB (SLIDING_WINDOW_CHUNK_SIZE_MB)
  private readonly overlapSize: number;    // 200字符 (SLIDING_WINDOW_OVERLAP_SIZE)
  private readonly maxFileSize: number;    // 用户配置的最大文件大小
  
  private buffer: string = '';             // 累积缓冲区
  private previousOverlap: string = '';    // 上一块的重叠尾部
  private totalProcessed: number = 0;      // 已处理的总字节数
}
```

**核心方法**:

```typescript
// 主入口: 流式处理文件
async processFile(
  filePath: string,
  options: StreamProcessorOptions
): Promise<void>

// 路径A: 直接流式读取原始文件
private async processRawFile(
  filePath: string,
  options: StreamProcessorOptions
): Promise<void>

// 路径B: 处理已提取的文本
private async processExtractedText(
  text: string,
  options: StreamProcessorOptions
): Promise<void>
```

### 2. 修改 file-worker.ts

**智能路由逻辑**:

```typescript
parentPort?.on('message', async (task: WorkerTask) => {
  const config = getFileTypeConfig(filePath);
  
  if (!config) {
    // 未知文件类型
    handleError();
    return;
  }
  
  if (config.processor === FileProcessorType.BINARY_SCAN) {
    // 不支持预览
    handleUnsupported();
    return;
  }
  
  const processor = new FileStreamProcessor(maxSizeMB);
  
  if (config.supportsStreaming) {
    // ✅ 路径A: 真正的流式处理
    await processor.processRawFile(filePath, options);
  } else {
    // ❌ 路径B: 先解析,再流式发送
    const { text } = await extractTextFromFile(filePath);
    await processor.processExtractedText(text, options);
  }
});
```

---

## 📊 数据流对比

### 预览模式

| 阶段 | 当前实现 | 新实现 |
|------|---------|--------|
| **读取** | 一次性读取完整文件 | 流式读取 (64KB缓冲) |
| **内存** | 文件大小 (可能100MB+) | 固定 ~5MB |
| **分块** | 按行分割 (内存中) | 按字节分块 + 行边界调整 |
| **检测** | 每块独立检测 | 滑动窗口检测 (含重叠区) |
| **发送** | 逐块发送 | 逐块发送 (相同) |

### 扫描模式

| 阶段 | 当前实现 | 新实现 |
|------|---------|--------|
| **读取** | 一次性读取完整文件 | 流式读取 (64KB缓冲) |
| **内存** | 文件大小 | 固定 ~5MB |
| **检测** | 一次性检测全部文本 | 分块检测 + 累加计数 |
| **返回** | 一次性返回结果 | 最后返回累加结果 |

---

## ⚠️ 潜在问题和解决方案

### 问题1: UTF-8 多字节字符被切断

**场景**: 在 5MB 边界处,一个中文汉字 (3字节) 可能被切断

**解决**: 

```typescript
function findValidSplitPoint(buffer: string, targetPos: number): number {
  // 尝试在 targetPos 附近找到行边界
  let pos = buffer.lastIndexOf('\n', targetPos);
  
  if (pos === -1) {
    // 没有行边界,向前查找安全的分割点
    pos = Math.max(0, targetPos - 10);
  }
  
  return pos;
}
```

### 问题2: 超大单行 (>5MB)

**场景**: 某些日志文件可能有一行非常长

**解决**:

```typescript
const MAX_LINE_LENGTH = 100 * 1024; // 100KB

if (currentLine.length > MAX_LINE_LENGTH) {
  console.warn(`[FileStreamProcessor] 单行过长 (${currentLine.length}字节)，截断处理`);
  // 强制分割
}
```

### 问题3: 性能开销

**担心**: 流式处理是否比一次性处理慢?

**分析**:
- ❌ 流式读取: 多次 I/O 操作
- ✅ 但 Node.js 的 `createReadStream` 有内部优化
- ✅ 敏感词检测可以并行 (处理下一块时,前一块已在发送)
- ✅ 对于大文件,避免 OOM 更重要

**结论**: 对于 <10MB 的文件,可能有轻微性能损失;对于 >50MB 的文件,流式是必须的。

---

## 🎨 实施步骤

### Phase 1: 创建 FileStreamProcessor 类

1. 新建 `src/file-stream-processor.ts`
2. 实现核心的 `processFile()` 方法
3. 实现两个路径:
   - `processRawFile()` - 真正流式
   - `processExtractedText()` - 半流式
4. 实现滑动窗口重叠逻辑
5. 实现辅助方法:
   - `findSplitPoint()` - 查找分割点
   - `detectWithOverlap()` - 带重叠区的检测

### Phase 2: 修改 file-worker.ts

1. 导入 `file-types.ts` 的工具函数
2. 使用 `getFileTypeConfig()` 获取配置
3. 根据 `config.supportsStreaming` 选择处理路径
4. 删除旧的伪流式代码
5. 实现扫描模式的计数累加

### Phase 3: 测试和优化

1. 测试小文件 (<1MB)
2. 测试中等文件 (10-50MB)
3. 测试大文件 (>100MB)
4. 测试各种文件类型 (txt, pdf, docx, xlsx等)
5. 性能基准测试
6. 验证敏感词跨边界检测

### Phase 4: 清理和优化

1. 删除旧的伪流式代码
2. 更新注释和文档
3. 优化性能瓶颈
4. 添加错误处理和日志

---

## ✅ 验收标准

### 功能正确性

- ✅ 所有文件类型都能正常预览
- ✅ 敏感词检测无漏检 (包括跨边界的)
- ✅ 高亮显示正确
- ✅ 扫描模式计数准确

### 内存控制

- ✅ 处理 500MB 文件时,Worker 内存 < 20MB
- ✅ 无内存泄漏
- ✅ 纯文本文件峰值内存 < 10MB

### 性能

- ✅ 小文件 (<10MB) 性能下降 < 15%
- ✅ 大文件 (>100MB) 能正常处理 (之前会 OOM)
- ✅ 流式传输流畅,无明显卡顿

### 兼容性

- ✅ 现有功能不受影响
- ✅ 前端无需修改 (接口保持一致)
- ✅ 所有现有文件类型正常工作

---

## 📝 API 设计

### ChunkData 接口

```typescript
interface ChunkData {
  chunkIndex: number;           // 块索引 (从0开始)
  text: string;                 // 块的文本内容
  lines: string[];              // 按行分割 (预览模式)
  highlights: HighlightRange[]; // 敏感词高亮
  sensitiveResults?: SensitiveResult[]; // 详细检测结果 (扫描模式)
  startLine?: number;           // 起始行号 (预览模式)
  byteOffset: number;           // 字节偏移量
}
```

### StreamProcessorOptions 接口

```typescript
interface StreamProcessorOptions {
  mode: 'detect' | 'preview';           // 处理模式
  enabledTypes: string[];               // 启用的敏感词类型
  
  // 回调函数
  onChunk?: (chunkData: ChunkData) => void;     // 每块就绪回调
  onComplete?: (stats: ProcessingStats) => void; // 完成回调
  onError?: (error: Error) => void;             // 错误回调
}
```

### ProcessingStats 接口

```typescript
interface ProcessingStats {
  totalChunks: number;      // 总块数
  totalBytes: number;       // 总字节数
  totalLines?: number;      // 总行数 (可选)
}
```

---

## 🔄 文件类型路由表

| 文件类型 | 扩展名 | 处理器类型 | 流式支持 | 内存峰值 | 说明 |
|---------|-------|-----------|---------|---------|------|
| 纯文本 | txt, log, md | STREAMING_TEXT | ✅ | ~5MB | 真正流式 |
| 源代码 | js, ts, py, java | STREAMING_TEXT | ✅ | ~5MB | 真正流式 |
| 配置文件 | json, yaml, xml | STREAMING_TEXT | ✅ | ~5MB | 真正流式 |
| Word | docx, doc, wps | PARSER_REQUIRED | ❌ | 文件大小 + ~5MB | 半流式 |
| Excel | xlsx, xls, et | PARSER_REQUIRED | ❌ | 文件大小 + ~5MB | 半流式 |
| PDF | pdf | PARSER_REQUIRED | ❌ | 文件大小 + ~5MB | 半流式 |
| PPT | pptx, dps | PARSER_REQUIRED | ❌ | 文件大小 + ~5MB | 半流式 |
| 压缩文件 | zip, rar | BINARY_SCAN | ❌ | - | 不支持预览 |

---

## 📚 相关文档

- [file-types.ts](../src/utils/file-types.ts) - 文件类型配置
- [scan-config.ts](../src/core/scan-config.ts) - 扫描配置常量
- [file-worker.ts](../src/workers/file-worker.ts) - Worker 线程实现

---

## 📅 实施记录

- **2025-05-01**: 创建分支 `feature/true-streaming-processing`,开始实施
- **待完成**: 创建 FileStreamProcessor 类
- **待完成**: 修改 file-worker.ts 实现智能路由
- **待完成**: 测试和优化

---

**文档版本**: v1.0  
**最后更新**: 2025-05-01  
**作者**: Lingma AI Assistant
