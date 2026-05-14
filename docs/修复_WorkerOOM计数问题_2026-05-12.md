# Worker OOM 导致 activeWorkerCount 负数修复

## 🔍 问题描述

**现象：**
```
[ERROR] [Consumer 1] Worker 错误: Worker terminated due to reaching memory limit: JS heap out of memory
[ERROR] [Consumer 1] Worker 异常退出，代码: 1, 信号: none

提示: 30秒内无任何进展（活跃Worker:-48, 队列:0, 待处理:0）...
警告: 120秒内无任何进展（...活跃Worker:-48...），强制结束
```

**结果：**
- ❌ 扫描到一半就停止（31893 / 63784 = 50%）
- ❌ `activeWorkerCount` 变成 **-48**（应该是 >= 0）
- ❌ 停滞检测误判，强制结束扫描

---

## 💡 根本原因

### **Worker OOM 时的事件触发顺序**

当 Worker 内存溢出（OOM）时，会**同时触发两个事件**：

```
1. Worker 内存溢出
   ↓
2. worker.on('error') 触发 
   → activeWorkerCount-- (Line 276)
   ↓
3. worker.on('exit') 触发
   → activeWorkerCount-- (Line 319)
   ↓
4. 结果：同一个 Worker 被减少了 2 次计数！❌
```

### **数学计算**

假设有 50 个 Worker：
- 48 个 Worker OOM 崩溃
- 每个 Worker 减少 2 次 = 96 次减少
- 但 dispatch 时只增加了 48 次
- 结果：`activeWorkerCount = 48 - 96 = -48` ❌

### **为什么会导致扫描停止？**

停滞检测逻辑（Line 704）：
```typescript
const hasRealProgress =
    // ... 其他指标 ...
    activeWorkerCount !== lastStagnationCheckState.activeWorkers ||  // ← -48 != -48 = false
    // ...
```

当 `activeWorkerCount` 变成负数后：
1. ✅ 所有任务都完成了（taskQueue.length = 0）
2. ✅ pendingTasks.size = 0
3. ❌ 但 `activeWorkerCount = -48`（不等于 0）
4. ❌ 停滞检测认为"还有 -48 个 Worker 在工作"
5. ❌ 等待 120 秒后超时，强制结束

---

## ✅ 修复方案

### **核心思路：防止重复计数**

添加 `counted` 标志位，确保每个 Worker **只减少一次计数**：

```typescript
const consumer = {
    worker,
    busy: false,
    taskId: undefined,
    counted: false,       // 【P0修复】防止重复计数
    isTerminating: false  // 【新增】标记主动终止
};
```

### **修复点 1: worker.on('error')**

```typescript
worker.on('error', (error: any) => {
    log.error(`[Consumer ${id}] Worker 错误: ${error.message}`);

    // 【P0修复】只有当 consumer 处于 busy 状态且未处理过才减少计数
    if (consumer.busy && !consumer.counted) {
        consumer.counted = true;  // 标记已计数
        activeWorkerCount--;

        if (consumer.taskId !== undefined) {
            const pending = pendingTasks.get(consumer.taskId);
            if (pending) {
                clearTimeout(pending.timeoutId);
                pendingTasks.delete(consumer.taskId);
                incrementConsumerCount(consumer.taskId);
                pending.reject(error);
            }
        }
    }
});
```

**关键改动：**
- ✅ 添加 `!consumer.counted` 检查
- ✅ 设置 `consumer.counted = true`
- ✅ 移除 `consumer.busy = false`（由 `markConsumerIdle` 统一处理）

---

### **修复点 2: worker.on('exit')**

```typescript
if (code !== 0 && !scanState.cancelFlag) {
    log.error(`[Consumer ${id}] Worker 异常退出，代码: ${code}, 信号: ${signal || 'none'}`);

    // 【新增】检测是否是 OOM 导致的退出
    const isOOM = signal === 'SIGABRT' || code === 134;
    if (isOOM) {
        log.error(`[Consumer ${id}] ⚠️ 检测到 Worker OOM！将重启 Worker 并跳过当前文件`);
    }

    // 【P0修复】只有当 consumer 处于 busy 状态且未处理过才更新计数
    if (consumerRef.busy && consumerRef.taskId !== undefined && !consumerRef.counted) {
        consumerRef.counted = true;  // 标记已计数
        activeWorkerCount--;

        const pending = pendingTasks.get(consumerRef.taskId);
        if (pending) {
            clearTimeout(pending.timeoutId);
            pendingTasks.delete(consumerRef.taskId);
            incrementConsumerCount(consumerRef.taskId);

            // 【新增】返回友好的 OOM 错误信息
            const errorMsg = isOOM
                ? '内存不足，文件可能过大或格式异常，已跳过'
                : `Worker 异常退出（代码: ${code}）`;
            pending.reject(new Error(errorMsg));
        }
    } else {
        // Worker 空闲时退出，只需标记
        consumerRef.busy = false;
    }
    
    // ... Worker 重启逻辑 ...
}
```

**关键改动：**
- ✅ 添加 `!consumerRef.counted` 检查
- ✅ 设置 `consumerRef.counted = true`
- ✅ 移除 `consumerRef.busy = false`（避免重复设置）

---

### **修复点 3: dispatchNextTask**

```typescript
function dispatchNextTask(consumer: typeof consumers[0]) {
    const task = taskQueue.shift();
    if (!task) {
        return;
    }

    consumer.busy = true;
    consumer.counted = false;  // 【P0修复】重置计数标志
    activeWorkerCount++;
    const taskId = nextTaskId++;
    consumer.taskId = taskId;
    
    // ... 发送任务到 Worker ...
}
```

**关键改动：**
- ✅ 每次分发新任务时，重置 `counted = false`
- ✅ 允许下次任务重新计数

---

### **修复点 4: markConsumerIdle**

```typescript
/**
 * 标记 Consumer 为空闲状态
 * @param consumer Consumer 对象
 */
export function markConsumerIdle(consumer: any): void {
    consumer.busy = false;
    consumer.taskId = undefined;
    consumer.counted = false;  // 【P0修复】重置计数标志，允许下次任务重新计数
}
```

**关键改动：**
- ✅ 在标记空闲时，也重置 `counted` 标志

---

### **修复点 5: TypeScript 类型定义**

```typescript
// scanner.ts Line 80-86
const consumers: Array<{
    worker: Worker;
    busy: boolean;
    taskId?: number;
    counted?: boolean;         // 【P0修复】防止重复计数
    isTerminating?: boolean;   // 【新增】标记是否正在被主动终止
}> = [];
```

**关键改动：**
- ✅ 添加 `counted?: boolean` 类型定义

---

## 📊 修复效果

### **修复前**

```
Worker OOM 事件流程：
1. error 事件 → activeWorkerCount-- (48 → 47)
2. exit 事件  → activeWorkerCount-- (47 → 46)
3. 结果：减少了 2 次 ❌

48 个 Worker OOM：
activeWorkerCount = 48 - (48 × 2) = -48 ❌

停滞检测：
- taskQueue.length = 0 ✅
- pendingTasks.size = 0 ✅
- activeWorkerCount = -48 ❌（不等于 0）
→ 等待 120 秒后超时，强制结束
```

### **修复后**

```
Worker OOM 事件流程：
1. error 事件 → counted = true, activeWorkerCount-- (48 → 47)
2. exit 事件  → counted = true, 跳过（因为 already counted）
3. 结果：只减少 1 次 ✅

48 个 Worker OOM：
activeWorkerCount = 48 - 48 = 0 ✅

停滞检测：
- taskQueue.length = 0 ✅
- pendingTasks.size = 0 ✅
- activeWorkerCount = 0 ✅
→ 正常完成扫描
```

---

## 🧪 验证方法

### **本地测试**

1. **模拟 Worker OOM**
   ```bash
   # 创建一个超大文件（>500MB）
   dd if=/dev/zero of=large_file.pdf bs=1M count=500
   
   # 扫描包含该文件的目录
   # 观察日志中是否有 "Worker OOM" 错误
   # 确认 activeWorkerCount 不会变成负数
   ```

2. **监控计数器**
   ```bash
   # 在日志中搜索
   grep "activeWorkerCount" app-*.log
   
   # 应该看到：
   # [进度] ... activeWorkers=50
   # [进度] ... activeWorkers=49
   # [进度] ... activeWorkers=0
   # 不应该看到负数
   ```

---

### **CI 验证**

提交后在 Windows 上测试：
1. 扫描大量文件（包含大 PDF、DOCX、PPTX）
2. 观察日志中是否有 Worker OOM
3. 确认 `activeWorkerCount` 始终 >= 0
4. 确认扫描能完成 100%（不再停在 50%）

---

## 📝 相关修改文件

| 文件 | 修改内容 | 行数 |
|------|---------|------|
| `src/scanner.ts` | 添加 `counted` 标志位和检查逻辑 | +8 |
| `src/scanner-helpers.ts` | 在 `markConsumerIdle` 中重置 `counted` | +1 |

---

## 🎯 总结

**问题**: Worker OOM 时，`error` 和 `exit` 事件都触发，导致 `activeWorkerCount` 被重复减少  
**影响**: 计数器变成负数（-48），停滞检测误判，扫描在 50% 处强制结束  
**修复**: 添加 `counted` 标志位，确保每个 Worker 只减少一次计数  
**效果**: `activeWorkerCount` 始终 >= 0，扫描能正常完成  

**关键代码：**
```typescript
// 防止重复计数
if (consumer.busy && !consumer.counted) {
    consumer.counted = true;  // 标记已计数
    activeWorkerCount--;
}

// 重置标志
consumer.counted = false;  // 下次任务可以重新计数
```

---

**修复时间**: 2026-05-06  
**严重程度**: P0（阻塞性问题）  
**状态**: ✅ 已修复  
**编译状态**: ✅ 成功  
