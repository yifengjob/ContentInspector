# Windows 内存泄漏修复 - 分步实施待办清单

> **生成时间**: 2026-05-06  
> **重要原则**: ⚠️ **每个步骤实施前必须经过用户审查确认**  
> **状态**: 📋 待开始实施

---

## ⚠️ **实施原则**

### **核心规则**

1. ✅ **逐个步骤实施**：完成一个步骤后，等待用户审查确认
2. ✅ **不提前实施**：方案未最终审定前，不修改任何代码
3. ✅ **充分测试**：每个步骤实施后，进行验证测试
4. ✅ **可回滚**：每个步骤都应该可以独立回滚

### **工作流程**

```
步骤 N:
  1. AI 提供详细的实施方案
  2. 用户审查方案
  3. 用户确认实施
  4. AI 实施代码修改
  5. AI 提供测试方法
  6. 用户验证测试结果
  7. 用户确认通过 → 进入下一步骤
     或
  用户发现问题 → 修正方案 → 重新审查
```

---

## 📋 **待办清单总览**

### **P0 - 严重问题（必须修复）**

- [ ] **步骤 1**: 删除后端路径清理逻辑（前端已实现）
- [ ] **步骤 2**: 简化 seenFiles 重置机制
- [ ] **步骤 3**: 修复 postMessage 失败时 Promise 未 reject

### **P1 - 重要问题（建议修复）**

- [ ] **步骤 4**: FileStreamProcessor 添加 destroy() 方法
- [ ] **步骤 5**: Logger 添加 destroy() 方法
- [ ] **步骤 6**: Consumer Workers 重启时增强引用清理
- [ ] **步骤 7**: 使用 counted 标志防止 activeWorkerCount 重复计数

### **P2 - 中等问题（可选优化）**

- [ ] **步骤 8**: queueByTypeAndSize Map 定期清理
- [ ] **步骤 9**: countedTaskIds Set 在 cleanup 时清空
- [ ] **步骤 10**: Walker Worker 超时定时器在 catch 中清理
- [ ] **步骤 11**: 增强符号链接文件过滤
- [ ] **步骤 12**: IPC 消息批量发送（可选）

---

## 🔴 **P0 步骤详情**

---

### **步骤 1: 删除后端路径清理 + 增强符号链接过滤**

**优先级**: P0  
**预计时间**: 30 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

**任务 A: 删除路径清理**
- 前端已通过 `getEffectiveScanPaths()` 实现路径去重
- 后端无需重复实现

**任务 B: 增强符号链接过滤**
- 当前 `follow_symlinks: false` 只防止递归进入符号链接目录
- 需要显式过滤符号链接文件，避免重复处理和循环引用

**前端代码**（`frontend/src/stores/app.ts` 第 269-294 行）：

```typescript
function getEffectiveScanPaths(): string[] {
    const paths = Array.from(selectedPaths.value)
    paths.sort((a, b) => a.length - b.length)
    
    const effectivePaths: string[] = []
    
    for (const path of paths) {
        const separator = path.includes('\\') ? '\\' : '/'
        const hasDescendantSelected = paths.some(otherPath => 
            otherPath !== path && otherPath.startsWith(path + separator)
        )
        
        if (!hasDescendantSelected) {
            effectivePaths.push(path)
        }
    }
    
    return effectivePaths
}
```

**使用位置**（`frontend/src/App.vue` 第 342 行）：

```typescript
const effectivePaths = appStore.getEffectiveScanPaths()
const scanConfig = {
    selectedPaths: effectivePaths,  // ← 已去重
    // ...
}
await startScan(scanConfig)
```

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner.ts`（任务 A）
- `src/walker-worker.ts`（任务 B）

---

### **任务 A: 删除路径清理逻辑**

**修改内容**:

1. **删除** `deduplicatePaths` 函数（如果已添加）
2. **删除** `startScan` 中对 `deduplicatePaths` 的调用
3. **直接使用** `config.selectedPaths`
4. **添加注释**说明前端已做去重

**具体代码变更**:

```typescript
// src/scanner.ts

export async function startScan(
    config: ScanConfig,
    mainWindow: BrowserWindow,
    scanState: ScanState
): Promise<void> {
    // ... 初始化代码 ...
    
    log.info('开始扫描...');
    log.info(`扫描路径数: ${config.selectedPaths.length}`);
    log.info(`【注意】前端已通过 getEffectiveScanPaths() 去重，后端无需再次清理`);
    
    // 【直接使用】不再需要调用 deduplicatePaths
    let isFirstPath = true;
    
    for (const rootPath of config.selectedPaths) {  // ← 直接使用
        // ... 路径验证 ...
        
        walkerWorker.postMessage({
            type: 'start-walking',
            config: {
                rootPath,
                selectedExtensions: config.selectedExtensions,
                ignoreDirNames: config.ignoreDirNames,
                systemDirs: config.systemDirs,
                maxFileSizeMb: config.maxFileSizeMb,
                maxPdfSizeMb: config.maxPdfSizeMb
            }
        });
        
        isFirstPath = false;
    }
}
```

---

### **任务 B: 增强符号链接过滤**

**当前问题**:

```typescript
// walker-worker.ts 第 181 行
const walker = walkdir(rootPath, {
    follow_symlinks: false,  // ✅ 防止递归进入 symlink 目录
    no_recurse: false,
    filter: ...
});

// 第 211-213 行
walker.on('path', (filePath: string, stat: any) => {
    // 只处理文件
    if (!stat.isFile()) return;  // ⚠️ symlink 文件也会通过 isFile() 检查
    
    // ... 后续处理
});
```

**问题**:
- ✅ `follow_symlinks: false` 防止了**目录级**符号链接的递归
- ❌ 但**文件级**符号链接仍会被报告（因为 `stat.isFile()` 对 symlink 文件返回 true）
- ❌ 没有显式检查和跳过符号链接文件

**修改内容**:

在 `walker.on('path')` 回调中，添加符号链接文件的检测和跳过。

**具体代码变更**:

```typescript
// src/walker-worker.ts

walker.on('path', (filePath: string, stat: any) => {
    // 【关键】跳过符号链接文件（包括文件和目录）
    if (stat.isSymbolicLink && stat.isSymbolicLink()) {
        skippedCount++;
        parentPort?.postMessage({
            type: 'walker-log',
            message: `[Walker] 跳过符号链接: ${filePath}`
        });
        return;
    }
    
    // 只处理普通文件
    if (!stat.isFile()) return;

    // ... 其余过滤逻辑保持不变 ...
});
```

---

#### **验收标准**

**任务 A: 路径清理**
- [ ] 删除了 `deduplicatePaths` 函数（如果存在）
- [ ] `startScan` 中直接使用 `config.selectedPaths`
- [ ] 添加了注释说明前端已做去重
- [ ] 编译无错误
- [ ] 前端选择多个路径，后端收到的路径正确（已去重）

**任务 B: 符号链接过滤**
- [ ] 符号链接文件被正确检测和跳过
- [ ] 日志中记录跳过的符号链接
- [ ] `skippedCount` 正确累加
- [ ] 编译无错误
- [ ] 扫描包含符号链接的目录，验证符号链接被跳过

---

#### **测试方法**

```bash
# 任务 A: 路径清理测试

# 1. 启动开发环境
pnpm dev

# 2. 在前端树形结构中选择多个路径
#    例如：选择 /Users 和 /Users/yifeng

# 3. 开始扫描，查看日志输出
#    应该看到：扫描路径数: 1（而不是 2）

# 4. 验证扫描结果正常

---

# 任务 B: 符号链接过滤测试

# 1. 创建测试目录和符号链接
mkdir -p /tmp/test-symlink
echo "test content" > /tmp/test-symlink/real-file.txt
ln -s /tmp/test-symlink/real-file.txt /tmp/test-symlink/link-to-file.txt

# 2. 在前端选择 /tmp/test-symlink 目录

# 3. 开始扫描，查看日志
#    应该看到：
#    [Walker] 跳过符号链接: /tmp/test-symlink/link-to-file.txt
#    [Walker] walker 'end' 事件触发: ..., skippedCount=1

# 4. 验证扫描结果
#    - real-file.txt 应该被扫描
#    - link-to-file.txt 不应该出现在结果中

# 5. 清理测试文件
rm -rf /tmp/test-symlink
```

---

#### **回滚方案**

如果出现问题，恢复 `deduplicatePaths` 函数和调用即可。

---

**⏸️ 等待用户审查确认后实施**

请审查以上方案，确认无误后回复"实施步骤 1"，我将开始修改代码。

---

### **步骤 2: 验证 seenFiles 重置机制（无需修改）**

**优先级**: P0  
**预计时间**: 5 分钟（仅验证）  
**风险等级**: 🟢 无风险  

#### **背景说明**

经过深入分析，**当前实现已经正确，无需修改**。

**关键发现**：
1. ✅ Walker Worker 在 `cleanup()` 时被完全终止（`terminate()`）
2. ✅ 新扫描时创建全新的 Worker 进程
3. ✅ 新进程的模块级变量自动初始化为 `null`
4. ✅ 无需手动重置，进程隔离保证状态干净

**当前实现**（已经正确）:

```typescript
// walker-worker.ts - 模块级变量
let seenFiles: Set<string> | null = null;

async function startWalking(config: WalkerConfig) {
    try {
        await initWalkdir();
        
        // 【当前逻辑】如果 seenFiles 为 null，创建新的 Set
        if (seenFiles === null) {
            seenFiles = new Set<string>();
        }
        
        // ... 使用 seenFiles ...
        
    } catch (error: any) {
        // ...
    }
}
```

---

#### **Worker 生命周期分析**

```
扫描开始:
  startScan()
    ↓
  创建新的 Walker Worker (scanner.ts 第 1008 行)
    ↓
  walkerWorker = new Worker(walkerWorkerPath, {...})
    ↓
  新 Worker 进程启动，模块级变量 seenFiles = null ✅

扫描进行中:
  seenFiles = new Set()
  处理文件，累积路径

扫描结束:
  cleanup() (scanner.ts 第 1290 行)
    ↓
  walkerWorker.terminate() (第 1312 行)
    ↓
  Worker 进程被销毁
    ↓
  (walkerWorker as any) = null (第 1313 行)
    ↓
  所有内存被释放，包括 seenFiles ✅

下次扫描:
  startScan() 再次调用
    ↓
  创建全新的 Walker Worker
    ↓
  新进程的 seenFiles = null ✅
```

---

#### **实施方案**

**无需修改代码**，仅进行验证测试。

---

#### **验收标准**

- [ ] 验证 Worker 在 cleanup 时被正确终止
- [ ] 验证新扫描时创建新的 Worker
- [ ] 验证多次扫描之间 seenFiles 正确隔离
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 第一次扫描
#    选择 /Users，开始扫描

# 3. 等待扫描完成或中途取消

# 4. 第二次扫描
#    选择 /Documents，开始扫描

# 5. 验证两次扫描的结果互不影响
#    （/Documents 中的文件应该被正确扫描，不会因为 seenFiles 而跳过）

# 6. 查看日志，确认：
#    - 第一次扫描时创建了 Walker Worker
#    - cleanup 时终止了 Walker Worker
#    - 第二次扫描时创建了新的 Walker Worker
```

---

#### **回滚方案**

无需回滚（没有修改代码）。

---

**✅ 步骤 2 完成：无需修改，当前实现已正确**

---

**⏸️ 等待用户审查确认后实施**

请审查以上方案，确认无误后回复"实施步骤 2"，我将开始修改代码。

---

### **步骤 3: 修复 postMessage 失败时 Promise 未 reject**

**优先级**: P0  
**预计时间**: 15 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

当前代码在 `postMessage` 失败时，只删除了 `pendingTasks` 中的条目，但没有调用 `reject()`，导致 Promise 永远不 settle，造成内存泄漏。

**当前问题代码**（`src/scanner.ts` 第 978-999 行）:

```typescript
try {
    consumer.worker.postMessage({...});
} catch (error: any) {
    log.error(`[TaskQueue] 发送任务失败: ${error.message}`);
    consumer.busy = false;
    consumer.taskId = undefined;
    activeWorkerCount--;
    pendingTasks.delete(taskId);  // ❌ 删除了但没有 reject
    enqueueTask(task);
}
```

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner.ts`

**修改内容**:

在 `catch` 块中添加 `pending.reject()` 调用。

**具体代码变更**:

```typescript
try {
    consumer.worker.postMessage({
        taskId,
        filePath: task.filePath,
        enabledSensitiveTypes: config.enabledSensitiveTypes,
        config: {
            enabledSensitiveTypes: config.enabledSensitiveTypes,
            maxFileSizeMb: config.maxFileSizeMb,
            maxPdfSizeMb: config.maxPdfSizeMb
        }
    });
} catch (error: any) {
    log.error(`[TaskQueue] 发送任务失败: ${error.message}`);
    
    // 回滚状态
    consumer.busy = false;
    consumer.taskId = undefined;
    activeWorkerCount--;
    
    // 【修复】清理 pendingTasks 并 reject Promise
    const pending = pendingTasks.get(taskId);
    if (pending) {
        clearTimeout(pending.timeoutId);
        pendingTasks.delete(taskId);
        pending.reject(new Error(`发送任务失败: ${error.message}`));
    }
    
    // 将任务放回队列
    enqueueTask(task);
}
```

---

#### **验收标准**

- [ ] postMessage 失败时，Promise 被正确 reject
- [ ] 错误信息清晰，便于调试
- [ ] 任务被放回队列，可以重试
- [ ] 无内存泄漏
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 这个场景较难手动触发，可以通过以下方式验证：

# 1. 代码审查：确认 catch 块中有 pending.reject() 调用
# 2. 单元测试：模拟 postMessage 失败，验证 Promise 被 reject
# 3. 长时间运行测试：监控内存使用，确认无泄漏
```

---

#### **回滚方案**

如果出现问题，删除 `pending.reject()` 调用即可（但不建议回滚，因为这是修复 bug）。

---

**⏸️ 等待用户审查确认后实施**

请审查以上方案，确认无误后回复"实施步骤 3"，我将开始修改代码。

---

## 🟠 **P1 步骤详情**

---

### **步骤 4: FileStreamProcessor 添加 destroy() 方法**

**优先级**: P1  
**预计时间**: 30 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

当前 `FileStreamProcessor` 实例在每次文件处理时创建，但任务结束后没有被销毁，导致内部缓冲区和计数器持续增长。

**问题**:
- ❌ 每次任务都创建新实例
- ❌ 无销毁方法
- ❌ 内部缓冲区未清理（`buffer`、`previousOverlap`）
- ❌ 累积计数器未重置（`accumulatedCounts`、`totalCount`）

---

#### **实施方案**

**需要修改的文件**:
- `src/file-stream-processor.ts`
- `src/file-worker.ts`

---

### **任务 A: 为 FileStreamProcessor 添加 destroy() 方法**

**具体代码变更**:

```typescript
// src/file-stream-processor.ts
export class FileStreamProcessor {
    // ... 现有代码 ...
    
    /**
     * 【新增】销毁处理器，释放资源
     */
    destroy(): void {
        // 清空缓冲区
        this.buffer = '';
        this.previousOverlap = '';
        
        // 重置计数器
        this.totalProcessed = 0;
        this.totalChars = 0;
        this.chunkIndex = 0;
        this.globalLineOffset = 0;
        
        // 清空累积计数
        this.accumulatedCounts = {};
        this.totalCount = 0;
    }
}
```

---

### **任务 B: 在 file-worker.ts 中使用 try-finally 确保清理**

**具体代码变更**:

```typescript
// src/file-worker.ts
const processor = new FileStreamProcessor();

try {
    // ... 文件处理逻辑 ...
} finally {
    // 【修复】确保无论成功还是失败，都清理资源
    processor.destroy();
}
```

---

#### **验收标准**

- [ ] `FileStreamProcessor` 添加了 `destroy()` 方法
- [ ] `file-worker.ts` 中使用 try-finally 确保清理
- [ ] 每个文件处理完成后，资源都被清理
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 扫描大量文件（例如 1000+ 个）

# 3. 监控内存使用
#    - 处理 10,000 个文件后，内存增长不超过 20MB
#    - 无明显内存泄漏
```

---

### **步骤 5: Logger 添加 destroy() 方法**

**优先级**: P1  
**预计时间**: 30 分钟  
**风险等级**: 🟡 中风险  

#### **背景说明**

`createScannerLogger` 创建的 Logger 实例在扫描结束后未被销毁，导致日志数组和闭包引用的对象无法被垃圾回收。

**问题**:
- ❌ `cachedLogsArray` 频繁创建
- ❌ `scanState.logs` 引用可能导致前端持有旧数组
- ❌ 闭包捕获了大对象
- ❌ 无清理机制

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner-helpers.ts`
- `src/scanner.ts`

---

### **任务 A: 为 Logger 添加 destroy() 方法**

**具体代码变更**:

```typescript
// src/scanner-helpers.ts
export function createScannerLogger(
    scanState: ScanState,
    mainWindow: BrowserWindow | null,
    config: LogConfig = DEFAULT_LOG_CONFIG
): Logger & { destroy: () => void } {  // 【修改】返回类型包含 destroy 方法
    // ... 现有代码 ...
    
    const logger = logInternal as Logger & { destroy: () => void };
    logger.debug = (...args: any[]) => processLogEntry(args, LogLevel.DEBUG);
    logger.info = (...args: any[]) => processLogEntry(args, LogLevel.INFO);
    logger.warn = (...args: any[]) => processLogEntry(args, LogLevel.WARN);
    logger.error = (...args: any[]) => processLogEntry(args, LogLevel.ERROR);
    
    // 【新增】添加销毁方法
    logger.destroy = () => {
        // 清空日志数组
        logs.fill('');
        logIndex = 0;
        logCount = 0;
        
        // 清空缓存数组
        cachedLogsArray = [];
        
        // 清空 scanState 中的引用
        scanState.logs = [];
        
        lastLogUpdateTime = 0;
    };
    
    return logger;
}
```

---

### **任务 B: 在 scanner.ts 的 cleanup 中调用 destroy**

**具体代码变更**:

```typescript
// src/scanner.ts
function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    
    try {
        // ... 现有清理代码 ...
        
        // 【新增】销毁 Logger
        if (log && typeof (log as any).destroy === 'function') {
            (log as any).destroy();
        }
        
        // ... 其余清理代码 ...
    } catch (error) {
        // ...
    }
}
```

---

#### **验收标准**

- [ ] Logger 添加了 `destroy()` 方法
- [ ] `cleanup()` 中调用了 `logger.destroy()`
- [ ] 扫描结束后，日志数组被清空
- [ ] `scanState.logs` 被重置为空数组
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 执行一次完整扫描

# 3. 扫描结束后，检查内存
#    - Logger 相关的内存应该被释放
#    - scanState.logs 应该是空数组

# 4. 再次扫描，验证日志功能正常
```

---

## 📝 **实施记录**

### **步骤执行情况**

| 步骤 | 状态 | 实施时间 | 审查人 | 备注 |
|------|------|---------|--------|------|
| 步骤 1 | ✅ 已完成 | 2026-05-06 | 用户 | 删除路径清理 + 增强符号链接过滤 |
| 步骤 2 | ✅ 已完成 | 2026-05-06 | 用户 | 验证 seenFiles 重置（无需修改） |
| 步骤 3 | ✅ 已完成 | 2026-05-06 | 用户 | 修复 postMessage 失败时 Promise 未 reject |
| 步骤 4 | ✅ 已完成 | 2026-05-06 | 用户 | FileStreamProcessor 添加 destroy() 方法 |
| 步骤 5 | ✅ 已完成 | 2026-05-06 | 用户 | Logger 添加 destroy() 方法 |
| 步骤 6 | ✅ 已完成 | 2026-05-06 | 用户 | Consumer Workers 重启时增强引用清理 |
| 步骤 7 | ✅ 已完成 | 2026-05-06 | 用户 | 使用 counted 标志防止 activeWorkerCount 重复计数 |
| 步骤 8 | ✅ 已完成 | 2026-05-06 | 用户 | queueByTypeAndSize Map 定期清理 |
| 步骤 9 | ✅ 已完成 | 2026-05-06 | 用户 | countedTaskIds Set 在 cleanup 时清空 |
| 步骤 10 | ✅ 已完成 | 2026-05-06 | 用户 | Walker Worker 超时定时器在 catch 中清理 |
| 步骤 11 | ✅ 已完成 | 2026-05-06 | 用户 | mainWindow.webContents.send 批量发送优化（含前端批量处理） |
| 步骤 12.1 | ✅ 已完成 | 2026-05-06 | 用户 | 移除未使用的导入和变量（selectAllPaths、deselectAllPaths） |
| 步骤 12.2 | ✅ 已完成 | 2026-05-06 | 用户 | 优化日志输出频率（抽取 LogThrottler 辅助类） |
| 步骤 12.3 | ✅ 已完成 | 2026-05-06 | 用户 | 添加错误边界（Consumer调度、Walker消息处理） |

---

### **步骤 6: Consumer Workers 重启时增强引用清理**

**优先级**: P1  
**预计时间**: 30 分钟  
**风险等级**: 🟡 中风险  

#### **背景说明**

Consumer Workers 在重启时，旧的 Worker 引用可能未被完全清理，导致内存泄漏。

**问题**:
- ❌ `consumer.worker` 引用未清空
- ❌ 事件监听器未完全移除
- ❌ 可能导致旧 Worker 无法被垃圾回收

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner.ts`

**具体代码变更**:

```typescript
// src/scanner.ts - createConsumer 函数中

// 【修复】终止旧的 Worker（如果存在）
if (consumers.has(id)) {
    const oldConsumer = consumers.get(id);
    if (oldConsumer) {
        try {
            oldConsumer.worker.terminate();
            oldConsumer.worker.removeAllListeners();
            // 【新增】清空引用
            (oldConsumer as any).worker = null;
        } catch (e) {
            // 忽略终止错误
        }
    }
}

// 创建新的 Worker
const worker = new Worker(workerPath, {
    resourceLimits: {
        maxOldGenerationSizeMb: oldGenMB,
        maxYoungGenerationSizeMb: youngGenMB,
    }
});

// ... 设置事件监听器 ...

consumers.set(id, {
    worker,
    busy: false,
    taskId: undefined,
    counted: false  // 【新增】用于防止重复计数
});
```

---

#### **验收标准**

- [ ] 旧 Worker 的引用被清空
- [ ] 事件监听器被完全移除
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 扫描大量文件，触发 Worker 重启

# 3. 监控内存使用
#    - Worker 重启后，旧 Worker 的内存应该被释放
```

---

### **步骤 7: 使用 counted 标志防止 activeWorkerCount 重复计数**

**优先级**: P1  
**预计时间**: 45 分钟  
**风险等级**: 🟡 中风险  

#### **背景说明**

当前代码中 `activeWorkerCount++` 和 `activeWorkerCount--` 的时机不一致，可能导致计数错误。

**问题**:
- ❌ `activeWorkerCount++` 在任务分发时立即执行（第 953 行）
- ❌ `activeWorkerCount--` 在多个地方执行（超时、message、error、exit 等）
- ❌ 同一个任务可能触发多次 `--`（例如：超时后又有 error/exit 事件）
- ❌ 可能导致 `activeWorkerCount` 变成负数

**示例场景**:
```
1. dispatchNextTask: activeWorkerCount++ (0→1), counted = false
2. 超时定时器触发: activeWorkerCount-- (1→0)
3. worker.on('error'): activeWorkerCount-- (0→-1) ❌
4. worker.on('exit'): activeWorkerCount-- (-1→-2) ❌
```

**解决方案核心思路**:
- `counted` 标志用于**防止重复减少计数**
- 任务开始时：`activeWorkerCount++`，`counted = false`
- 第一次需要减少时：检查 `!counted`，执行 `--`，设置 `counted = true`
- 后续再需要减少时：因为 `counted = true`，不再执行 `--`
- 任务结束时：重置 `counted = false`，为下一个任务做准备

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner.ts`

**具体代码变更**:

```typescript
// src/scanner.ts

/**
 * 【新增】统一的 Consumer 计数更新函数
 * 防止重复计数
 */
function updateConsumerCount(consumer: any, taskId?: number): void {
    if (consumer.busy && !consumer.counted) {
        consumer.counted = true;  // 标记已计数
        activeWorkerCount--;
        
        if (taskId !== undefined) {
            incrementConsumerCount(taskId);
        }
    }
}

// 1. 在 dispatchNextTask 中，只增加计数，不设置 counted
function dispatchNextTask(consumer: ReturnType<typeof consumers.get>) {
    if (!consumer) return;

    const task = selectOptimalTask();
    if (!task) {
        return;
    }

    consumer.busy = true;
    consumer.counted = false;  // 【修复】重置为 false，表示还未减少过计数
    activeWorkerCount++; // 【优化】增加活跃计数
    const taskId = nextTaskId++;
    consumer.taskId = taskId;
    
    // ... 其余代码 ...
}

// 2. 在超时定时器中使用 updateConsumerCount
const timeoutId = setTimeout(() => {
    const pending = pendingTasks.get(taskId);
    if (pending) {
        clearTimeout(pending.timeoutId);
        pendingTasks.delete(taskId);
        sendProgressUpdate(task.filePath);
        pending.reject(new Error(`文件处理超时`));
    }
    
    // 【统一】无论 pending 是否存在，都更新计数
    updateConsumerCount(consumer, taskId);
    markConsumerIdle(consumer);  // 这里会重置 counted = false
    restartWorker(consumer, taskId);
}, timeout);

// 3. 在 worker.on('message') 中使用 updateConsumerCount
worker.on('message', (result) => {
    const pending = pendingTasks.get(result.taskId);
    
    if (pending) {
        clearTimeout(pending.timeoutId);
        pendingTasks.delete(result.taskId);
        
        // 处理结果...
        if (result.error) {
            pending.reject(new Error(result.error));
        } else {
            pending.resolve(result);
        }
    }
    
    // 【统一】无论 pending 是否存在，都更新计数
    updateConsumerCount(consumer, result.taskId);
    markConsumerIdle(consumer);  // 这里会重置 counted = false
    cleanupConsumerState(consumer);
    tryDispatch();
});

// 4. 在 worker.on('error') 中使用 updateConsumerCount
worker.on('error', (error: any) => {
    log.error(`[Consumer ${id}] Worker 错误: ${error.message}`);

    // 【统一】使用统一的计数更新函数
    updateConsumerCount(consumer, consumer.taskId);
    
    // 注意：这里不调用 markConsumerIdle，因为 error 后会有 exit 事件
});

// 5. 在 worker.on('exit') 中使用 updateConsumerCount
worker.on('exit', (code: number, signal: string | null) => {
    const consumerRef = consumer as ReturnType<typeof consumers.get> & { id: number };

    if (consumerRef.isTerminating) {
        // 主动终止（超时等情况），不视为异常
        log.info(`[Consumer ${id}] Worker 已终止（代码: ${code}）`);
        consumerRef.isTerminating = false;
        consumerRef.busy = false;

        // 【智能调度】清理状态
        cleanupConsumerState(consumerRef);
        return;
    }

    if (code !== 0 && !scanState.cancelFlag) {
        log.error(`[Consumer ${id}] Worker 异常退出，代码: ${code}, 信号: ${signal || 'none'}`);

        // 【新增】检测是否是 OOM 导致的退出
        const isOOM = signal === 'SIGABRT' || code === 134;
        if (isOOM) {
            log.error(`[Consumer ${id}] ⚠️ 检测到 Worker OOM！将重启 Worker 并跳过当前文件`);
        }

        // 【统一】使用统一的计数更新函数
        updateConsumerCount(consumerRef, consumerRef.taskId);

        // 【智能调度】清理状态
        cleanupConsumerState(consumerRef);
        
        // 标记为空闲
        markConsumerIdle(consumerRef);  // 这里会重置 counted = false

        // 【关键】延迟重启 Worker，避免频繁创建销毁
        setTimeout(() => {
            if (!scanState.cancelFlag) {
                log.info(`[Consumer ${id}] 正在重启 Worker...`);
                consumers.delete(consumerRef.id);
                createConsumer(consumerRef.id);

                if ((global as any).gc) {
                    log.info(`[Consumer ${id}] 执行强制垃圾回收...`);
                    (global as any).gc();
                }
                setTimeout(() => tryDispatch(), 100);
            }
        }, WORKER_RESTART_DELAY);
    } else {
        consumerRef.busy = false;
    }
});

// 6. 在 postMessage 失败时，需要特殊处理
try {
    consumer.worker.postMessage({ ... });
} catch (error: any) {
    log.error(`[TaskQueue] 发送任务失败: ${error.message}`);
    
    // 回滚状态
    consumer.busy = false;
    consumer.taskId = undefined;
    
    // 【修复】因为 counted 还是 false，可以安全地减少计数
    // 但这里不使用 updateConsumerCount，因为我们要立即重置状态
    if (!consumer.counted) {
        consumer.counted = true;  // 标记已计数
        activeWorkerCount--;
    }
    
    // 【修复】清理 pendingTasks 并 reject Promise
    const pending = pendingTasks.get(taskId);
    if (pending) {
        clearTimeout(pending.timeoutId);
        pendingTasks.delete(taskId);
        pending.reject(new Error(`发送任务失败: ${error.message}`));
    }
    
    // 将任务放回队列头部
    enqueueTask(task);
}
```

---

#### **验收标准**

- [ ] 添加了 `updateConsumerCount` 函数
- [ ] 在 `dispatchNextTask` 中，`activeWorkerCount++` 时设置 `counted = false`
- [ ] 所有 `activeWorkerCount--` 的地方都通过 `updateConsumerCount` 或检查 `!counted`
- [ ] `counted` 标志在任务开始时为 false，第一次减少计数后设为 true，任务结束时重置为 false
- [ ] `activeWorkerCount` 不会变成负数
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 扫描大量文件，模拟超时场景

# 3. 监控 activeWorkerCount
#    - 应该不会变成负数
#    - 应该在扫描结束时归零

# 4. 特别测试 postMessage 失败的场景
#    - 模拟 Worker 创建失败
#    - 验证 activeWorkerCount 正确回滚
```

---

## 🟡 **P2 步骤详情**

---

### **步骤 8: queueByTypeAndSize Map 定期清理**

**优先级**: P2  
**预计时间**: 20 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

`queueByTypeAndSize` Map 中的键在队列为空后仍然存在，导致 Map 无限增长。

**问题**:
- ❌ Task 对象包含字符串（`filePath`、`fileMtime`、`fileType`）
- ❌ 队列可能积累大量任务
- ❌ 扫描结束后才清理
- ❌ Map 键未清理：即使队列为空，Map 中的键仍存在

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner.ts`

**具体代码变更**:

```typescript
// src/scanner.ts

/**
 * 【新增】清理空的队列类型
 */
function cleanupEmptyQueues(): void {
    for (const [fileType, queues] of queueByTypeAndSize.entries()) {
        if (queues.large.length === 0 && queues.small.length === 0) {
            queueByTypeAndSize.delete(fileType);
        }
    }
}

// 在 checkAndComplete 中调用
function checkAndComplete() {
    // ... 现有代码 ...
    
    // 【新增】定期清理空的队列
    if (getQueueLength() === 0) {
        cleanupEmptyQueues();
    }
    
    // ... 其余代码 ...
}

// 【关键修复】在 enqueueTask 中自动重建队列，防止竞态条件
function enqueueTask(task: Task): void {
    // 【修复】如果队列不存在，自动创建
    if (!queueByTypeAndSize.has(task.fileType)) {
        queueByTypeAndSize.set(task.fileType, {
            large: [],
            small: []
        });
    }
    
    const queues = queueByTypeAndSize.get(task.fileType)!;
    
    if (task.isLargeFile) {
        queues.large.push(task);
    } else {
        queues.small.push(task);
    }
}
```

**说明**:
- ✅ `cleanupEmptyQueues()` 定期清理空的队列
- ✅ `enqueueTask()` 在入队时检查队列是否存在，不存在则自动创建
- ✅ 避免了竞态条件：即使队列被删除，下次入队时会自动重建

---

#### **验收标准**

- [ ] 添加了 `cleanupEmptyQueues` 函数
- [ ] 空的队列类型被及时删除
- [ ] Map 中的键数量不会无限增长
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 扫描大量文件

# 3. 监控 queueByTypeAndSize.size
#    - 扫描结束后，size 应该为 0
#    - 扫描过程中，空的类型应该被及时删除
```

---

### **步骤 9: countedTaskIds Set 在 cleanup 时清空**

**优先级**: P2  
**预计时间**: 10 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

`countedTaskIds` Set 中的 taskId 永远不会被移除，导致 Set 无限增长。

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner.ts`

**具体代码变更**:

```typescript
// src/scanner.ts
function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    
    try {
        // ... 现有清理代码 ...
        
        // 【新增】清空 countedTaskIds
        countedTaskIds.clear();
        
        // ... 其余清理代码 ...
    } catch (error) {
        // ...
    }
}
```

---

#### **验收标准**

- [ ] `cleanup()` 中调用了 `countedTaskIds.clear()`
- [ ] 扫描结束后，Set 被清空
- [ ] 下次扫描时，Set 从零开始
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 执行一次完整扫描

# 3. 扫描结束后，检查 countedTaskIds.size
#    - 应该为 0

# 4. 再次扫描，验证功能正常
```

---

### **步骤 10: Walker Worker 超时定时器在 catch 中清理**

**优先级**: P2  
**预计时间**: 15 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

如果 `startWalking` 抛出异常，超时定时器可能未被清理。

---

#### **实施方案**

**需要修改的文件**:
- `src/walker-worker.ts`

**具体代码变更**:

```typescript
// src/walker-worker.ts
async function startWalking(config: WalkerConfig) {
    let timeoutId: NodeJS.Timeout | undefined;
    
    try {
        await initWalkdir();
        
        // ... 现有代码 ...
        
        const timeoutId = setTimeout(() => {
            // ... 超时处理 ...
        }, 30 * 1000);
        
        return new Promise<void>((resolve, reject) => {
            // ... walker 事件监听 ...
            
            walker.on('end', () => {
                clearTimeout(timeoutId); // ✅ 已清理
                // ...
            });
            
            walker.on('error', (err: any) => {
                clearTimeout(timeoutId); // ✅ 已清理
                // ...
            });
        });
        
    } catch (error: any) {
        // 【修复】在异常路径也清除定时器
        if (typeof timeoutId !== 'undefined') {
            clearTimeout(timeoutId);
        }
        
        parentPort?.postMessage({
            type: 'walking-error',
            error: error.message
        });
        throw error;
    }
}
```

---

#### **验收标准**

- [ ] 所有代码路径都清除了超时定时器
- [ ] 无定时器泄漏警告
- [ ] 编译无错误

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 模拟 Walker Worker 异常

# 3. 监控定时器数量
#    - 不应该有定时器泄漏
```

---

### **步骤 11: mainWindow.webContents.send 批量发送优化**

**优先级**: P3  
**预计时间**: 60 分钟  
**风险等级**: 🟡 中风险（需要前端配合）  

#### **背景说明**

当前 `sendToMainWindow` 函数每次都会立即发送 IPC 消息，如果前端处理慢，会导致 IPC 队列堆积。

**问题**:
- ❌ 同步发送：`webContents.send()` 是同步调用
- ❌ 无背压控制：如果前端处理慢，IPC 消息会堆积
- ❌ 消息序列化开销：每个 `resultItem` 都要序列化为 JSON
- ❌ Windows IPC 性能差：Windows 上的 Electron IPC 比 macOS/Linux 慢 30-50%

---

#### **实施方案**

**需要修改的文件**:
- `src/scanner-helpers.ts` - 添加 BatchSender 类
- `src/scanner.ts` - 使用批量发送

**具体代码变更**:

##### **1. 在 scanner-helpers.ts 中添加 BatchSender 类**

```typescript
// src/scanner-helpers.ts

/**
 * 【P3优化】批量发送管理器
 */
export class BatchSender {
    private buffer: any[] = [];
    private timer: NodeJS.Timeout | null = null;
    private readonly batchSize: number;
    private readonly batchInterval: number;
    
    constructor(batchSize: number = 100, batchInterval: number = 500) {
        this.batchSize = batchSize;
        this.batchInterval = batchInterval;
    }
    
    send(mainWindow: BrowserWindow | null, channel: string, data: any): void {
        this.buffer.push(data);
        
        // 如果达到批量大小，立即发送
        if (this.buffer.length >= this.batchSize) {
            this.flush(mainWindow, channel);
            return;
        }
        
        // 否则等待间隔时间后发送
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.flush(mainWindow, channel);
            }, this.batchInterval);
        }
    }
    
    private flush(mainWindow: BrowserWindow | null, channel: string): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        if (mainWindow && !mainWindow.isDestroyed() && this.buffer.length > 0) {
            // 批量发送
            mainWindow.webContents.send(channel, this.buffer);
            this.buffer = [];
        }
    }
    
    destroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.buffer = [];
    }
}

// 导出单例
export const resultBatchSender = new BatchSender(100, 500);
```

##### **2. 在 scanner.ts 中使用批量发送**

```typescript
// src/scanner.ts
import { resultBatchSender } from './scanner-helpers';

// 替换原来的直接发送
// sendToMainWindow(mainWindow, 'scan-result', resultItem);

// 使用批量发送
resultBatchSender.send(mainWindow, 'scan-result', resultItem);

// 在 cleanup 时销毁
function cleanup() {
    // ... 现有代码 ...
    
    // 【P3优化】销毁批量发送器
    resultBatchSender.destroy();
    
    // ... 其余清理代码 ...
}
```

---

#### **验收标准**

- [ ] 添加了 `BatchSender` 类
- [ ] IPC 消息批量发送（每 100 条或 500ms 发送一次）
- [ ] 在 `cleanup()` 中调用 `destroy()`
- [ ] 编译无错误
- [ ] 前端能够接收批量消息（可能需要调整前端代码）

---

#### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 扫描大量文件（1000+ 文件）

# 3. 监控 IPC 消息数量
#    - 应该看到批量发送的消息数组
#    - 而不是单个消息

# 4. 检查前端是否正常显示结果
```

---

#### **注意事项**

⚠️ **重要**：此优化需要前端配合修改，因为消息格式从单个对象变为数组。

**完整的前后端修改方案**：

---

### **后端修改（scanner.ts）**

已在前面说明，使用 `resultBatchSender.send()` 替代直接发送。

---

### **前端修改（3个文件）**

#### **1. 修改 preload.ts - 支持批量和单个消息**

**文件**: `src/preload.ts`

```typescript
// src/preload.ts

onScanResult: (callback: (data: any) => void) => {
  const listener = (_event: any, data: any) => {
    // 【P3优化】兼容批量和单个消息
    if (Array.isArray(data)) {
      // 批量消息：遍历数组，逐个调用 callback
      data.forEach(item => callback(item));
    } else {
      // 单个消息：直接调用 callback（向后兼容）
      callback(data);
    }
  };
  ipcRenderer.on('scan-result', listener);
  return () => ipcRenderer.removeListener('scan-result', listener);
},
```

**说明**:
- ✅ 在 preload 层统一处理，前端业务代码无需修改
- ✅ 自动兼容批量和单个消息格式
- ✅ 对前端透明，无需修改 App.vue

---

#### **2. 验证 electron-api.ts 无需修改**

**文件**: `frontend/src/utils/electron-api.ts`

当前实现已经正确，无需修改：

```typescript
// 监听扫描结果事件
export async function onScanResult(callback: (data: ScanResultItem) => void): Promise<() => void> {
    return window.electronAPI.onScanResult(callback)
}
```

因为 `preload.ts` 已经将批量消息拆分为单个消息，所以这里的 callback 仍然接收单个 `ScanResultItem`。

---

#### **3. 验证 App.vue 无需修改**

**文件**: `frontend/src/App.vue`

当前实现已经正确，无需修改：

```typescript
await onScanResult((item) => {
  appStore.addScanResult(item)  // item 是单个 ScanResultItem
})
```

因为 preload 层已经处理了批量消息的拆分，App.vue 中的代码保持不变。

---

### **方案优势**

✅ **前端零修改**：只需修改 preload.ts，前端业务代码（App.vue、electron-api.ts）无需改动  
✅ **向后兼容**：同时支持批量和单个消息格式  
✅ **性能提升**：后端批量发送，减少 IPC 通信次数  
✅ **用户体验不变**：前端接收到的仍然是单个消息，UI 更新逻辑不变  

---

### **测试方法**

```bash
# 1. 启动开发环境
pnpm dev

# 2. 扫描大量文件（1000+ 文件）

# 3. 监控 IPC 消息数量（开发者工具）
#    - 后端：每 100 条或 500ms 批量发送一次
#    - preload：自动拆分为单个消息
#    - 前端：逐个接收并显示

# 4. 验证功能正常
#    - 扫描结果正常显示
#    - 进度条正常更新
#    - 无性能问题
```

---

### **可选：前端也支持批量处理（进一步优化）**

如果希望前端也能批量处理消息（进一步提升性能），可以修改 App.vue：

```typescript
// frontend/src/App.vue

await onScanResult((items) => {
  // items 可能是单个对象或数组
  if (Array.isArray(items)) {
    // 批量添加
    items.forEach(item => appStore.addScanResult(item));
  } else {
    // 单个添加（向后兼容）
    appStore.addScanResult(items);
  }
})
```

但这需要修改 `appStore.addScanResult` 以支持批量添加，或者添加一个新方法 `addScanResults(items: ScanResultItem[])`。

**建议**：先实施基础方案（仅修改 preload.ts），观察性能提升效果。如果需要进一步优化，再考虑前端批量处理。

---

### **步骤 12: 其他轻微优化**

**优先级**: P3  
**预计时间**: 30 分钟  
**风险等级**: 🟢 低风险  

#### **背景说明**

一些小的优化点，可以进一步提升代码质量和性能。

---

#### **可能的优化项**

##### **1. 移除未使用的导入和变量**

使用 TypeScript 编译器检查未使用的导入：

```bash
# 检查未使用的导入
pnpm run build
```

如果有未使用的导入，TypeScript 编译器会警告。

---

##### **2. 优化日志输出频率**

当前代码中已经有一些日志抑制逻辑（如每 100 个敏感文件输出一次），可以考虑进一步优化：

```typescript
// 示例：进一步减少高频日志
if (resultCount % 100 === 0 || resultCount <= 10) {
    log.info(`发现敏感文件 [${resultCount}]: ${result.filePath}`);
}
```

---

##### **3. 添加更多错误边界**

在关键位置添加 try-catch，防止单个文件处理失败影响整个扫描：

```typescript
try {
    // 处理文件
} catch (error) {
    log.error(`处理文件失败: ${filePath}`, error);
    // 继续处理下一个文件
}
```

---

#### **验收标准**

- [ ] 移除所有未使用的导入和变量
- [ ] 日志输出频率合理（不会刷屏）
- [ ] 关键位置有错误边界
- [ ] 编译无错误、无警告

---

#### **测试方法**

```bash
# 1. 编译项目，检查是否有警告
pnpm run build

# 2. 运行扫描，观察日志输出
pnpm dev

# 3. 确认没有未使用的导入警告
```

---

## 🎯 **下一步行动**

✅ **P0 + P1 + P2 + P3(部分) 所有任务已完成！**

剩余的步骤 12 是 **P3 级别的最后优化**：

- **步骤 12**: 其他轻微优化（移除未使用导入、优化日志频率、添加错误边界）

这些优化可以根据实际需求决定是否实施。如果需要继续，请回复"**实施步骤 12**"查看方案。

---

**最后更新**: 2026-05-06  
**当前状态**: ✅ 步骤 1-11 已完成（P0 + P1 + P2 + P3部分），⏳ 步骤 12 为最后的 P3 可选优化
