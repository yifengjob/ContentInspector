# 基于事件总线的全面日志改造方案

## 📋 目录

1. [背景与目标](#背景与目标)
2. [现状分析](#现状分析)
3. [架构设计](#架构设计)
4. [实施方案](#实施方案)
5. [迁移计划](#迁移计划)
6. [风险评估](#风险评估)
7. [验收标准](#验收标准)

---

## 🎯 背景与目标

### **背景**

当前项目的日志系统存在以下问题：

1. **日志输出分散**：
   - `logger.ts`：通用日志记录器，无法发送到前端
   - `scanner-helpers.ts`：扫描器专用日志，可以发送到前端
   - 两套日志系统职责不清，维护成本高

2. **紧耦合问题**：
   - `createScannerLogger` 直接依赖 `BrowserWindow`
   - 无法在 Worker 线程中使用
   - 日志模块与 UI 模块耦合

3. **扩展性差**：
   - 添加新的日志输出渠道（如远程日志服务）需要修改核心代码
   - 无法灵活控制不同模块的日志路由

4. **Worker 线程支持不足**：
   - Worker 线程无法直接发送日志到前端
   - 需要手动通过 `parentPort` 发送消息
   - 缺乏统一的封装

### **目标**

通过事件总线重构日志系统，实现：

1. ✅ **完全解耦**：日志模块不依赖 Electron，可在任何环境使用
2. ✅ **灵活路由**：通过事件监听者控制日志输出渠道
3. ✅ **统一管理**：所有日志都通过事件总线发布
4. ✅ **易于扩展**：可以轻松添加新的日志监听者
5. ✅ **Worker 友好**：Worker 线程也能透明地发送日志到前端
6. ✅ **性能优化**：保留高频日志场景的性能优化（环形缓冲区、自适应节流）

---

## 🔍 现状分析

### **当前日志架构**

```
┌─────────────────────────────────────────┐
│         应用层（各种模块）                │
├──────────────┬──────────────────────────┤
│ logger.ts    │ scanner-helpers.ts       │
│ (通用日志)    │ (扫描器日志)              │
├──────────────┼──────────────────────────┤
│ • 文件输出    │ • 文件输出               │
│ • 内存缓冲    │ • 内存缓冲 (ScanState)   │
│ • ❌ 无前端   │ • ✅ IPC 到前端          │
└──────────────┴──────────────────────────┘
```

**问题**：
- 两套独立的日志系统
- `scanner-helpers.ts` 紧耦合 `BrowserWindow`
- `logger.ts` 无法发送到前端

### **目标日志架构**

```
┌─────────────────────────────────────────┐
│         应用层（各种模块）                │
├─────────────────────────────────────────┤
│         logger.ts (统一日志入口)          │
│         • 文件输出                       │
│         • 内存缓冲                       │
│         • 发布到事件总线                  │
├─────────────────────────────────────────┤
│         EventBus (事件总线)              │
│         • log:message 事件               │
│         • 错误隔离                       │
├──────────────┬──────────────────────────┤
│ 主进程监听器  │ Worker 消息桥接           │
│ • IPC 到前端  │ • parentPort → EventBus  │
└──────────────┴──────────────────────────┘
```

**优势**：
- 单一日志入口
- 完全解耦
- 灵活扩展

---

## 🏗️ 架构设计

### **核心组件**

#### **1. 日志事件定义**

在 `event-bus.ts` 中添加日志相关的事件类型：

```typescript
export type WorkerEventType =
    | 'worker.created'
    | 'worker.idle'
    | 'worker.busy'
    | 'task.enqueued'
    | 'task.completed'
    | 'walker.batch-ready'
    // 【新增】日志事件
    | 'log:message';        // 日志消息事件

/**
 * 日志事件数据结构
 */
export interface LogEventData {
    level: LogLevel;         // 日志级别
    message: string;         // 格式化后的消息
    context: string;         // 日志上下文（模块名）
    timestamp: string;       // 时间戳
}
```

#### **2. logger.ts 改造**

**改造前**：
```typescript
// TODO: 需要通过全局变量或依赖注入获取 mainWindow
// if (mainWindow && !mainWindow.isDestroyed()) {
//   mainWindow.webContents.send('scan-log', formattedMsg);
// }
```

**改造后**：
```typescript
import {EventBus} from '../core/event-bus';

// 在 logWithLevel 函数中
if (shouldSendToFrontend) {
    setImmediate(() => {
        // 发布日志事件到事件总线
        const eventData: LogEventData = {
            level,
            message: formattedMsg,
            context,
            timestamp: getBeijingTimestamp()
        };
        
        // 尝试获取全局 EventBus 实例并发布
        const eventBus = getGlobalEventBus();
        if (eventBus) {
            eventBus.emit('log:message', eventData);
        }
    });
}
```

**关键设计**：
- 通过全局函数 `getGlobalEventBus()` 获取 EventBus 实例
- 如果 EventBus 不存在（如 Worker 线程），静默忽略
- 保持 `logger.ts` 的纯净性（可选依赖）

#### **3. 主进程监听器**

在 `main.ts` 中设置日志事件监听：

```typescript
import {EventBus} from './core/event-bus';

// 在 createWindow 之后
const eventBus = new EventBus(scanState, mainWindow);

// 【新增】监听日志事件，转发到前端
eventBus.on('log:message', (data: LogEventData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-log', data.message);
    }
});
```

#### **4. Worker 线程日志桥接**

在 `file-worker.ts` 中，将日志消息发送到主进程：

```typescript
// Worker 线程中
parentPort?.on('message', (task: WorkerTask) => {
    // ... 处理任务
    
    // 发送日志到主进程
    parentPort?.postMessage({
        type: 'log',
        level: 'INFO',
        message: '处理文件...',
        context: 'Worker'
    });
});
```

在主进程中接收并转发：

```typescript
// main.ts 或 worker-pool.ts
worker.on('message', (message: any) => {
    if (message.type === 'log') {
        // 发布到事件总线
        eventBus.emit('log:message', {
            level: message.level,
            message: `[Worker] ${message.message}`,
            context: message.context || 'Worker',
            timestamp: getBeijingTimestamp()
        });
    }
    // ... 其他消息处理
});
```

---

### **全局 EventBus 管理**

由于 `logger.ts` 需要在不知道 `mainWindow` 的情况下发布事件，我们需要一个全局的 EventBus 访问方式。

#### **方案：单例模式**

```typescript
// event-bus.ts
let globalEventBus: EventBus | null = null;

/**
 * 设置全局 EventBus 实例
 * 应该在应用启动时调用
 */
export function setGlobalEventBus(bus: EventBus): void {
    globalEventBus = bus;
}

/**
 * 获取全局 EventBus 实例
 * @returns EventBus 实例或 null（如果未初始化）
 */
export function getGlobalEventBus(): EventBus | null {
    return globalEventBus;
}

// 在 main.ts 中
const eventBus = new EventBus(scanState, mainWindow);
setGlobalEventBus(eventBus);
```

**优点**：
- ✅ 简单易用
- ✅ 符合项目现有架构
- ✅ Worker 线程可以通过主进程间接访问

**缺点**：
- ⚠️ 全局状态（但这是必要的权衡）

---

## 📝 实施方案

### **阶段 1：基础设施准备**

#### **任务 1.1：扩展事件类型**

**文件**：`src/core/event-bus.ts`

**修改内容**：
1. 添加 `'log:message'` 事件类型
2. 定义 `LogEventData` 接口
3. 添加 `getGlobalEventBus()` 和 `setGlobalEventBus()` 函数

**预计工作量**：30 分钟

---

#### **任务 1.2：创建 LogManager 模块**

**文件**：`src/core/log-manager.ts`（新建）

**修改内容**：
1. 创建 `LogManager` 类
2. 封装 EventBus 的初始化和清理
3. 提供 `handleWorkerLog` 方法处理 Worker 日志
4. 提供 `getEventBus` 方法供其他模块使用
5. 注册日志事件监听器，转发到前端

**详见架构设计中的完整代码**

**预计工作量**：1 小时

---

#### **任务 1.3：修改 logger.ts（支持自动桥接）**

**文件**：`src/logger/logger.ts`

**核心设计**：
- 自动检测运行环境（Worker 线程 vs 主进程）
- Worker 线程：通过 `parentPort` 发送消息到主进程
- 主进程：通过 EventBus 发布事件
- 对使用者透明，统一使用 `createLogger` API

**修改内容**：
1. 导入 `EventBus` 和 `getGlobalEventBus`
2. 添加 `isWorkerThread` 检测逻辑
3. 添加 `bridgeWorkerLogToMain` 辅助函数
4. 添加 `emitLogToEventBus` 辅助函数
5. 在 `logWithLevel` 中根据环境选择桥接方式

**代码示例**：
```typescript
import {EventBus, getGlobalEventBus} from '../core/event-bus';

// 【新增】检测是否在 Worker 线程
const isWorkerThread = typeof process !== 'undefined' && 
                       typeof process.send === 'function';

// 在 logWithLevel 函数中
if (shouldSendToFrontend) {
    setImmediate(() => {
        if (isWorkerThread) {
            // Worker 线程：通过 parentPort 发送消息到主进程
            bridgeWorkerLogToMain(level, formattedMsg, context);
        } else {
            // 主进程：通过 EventBus 发布事件
            emitLogToEventBus(level, formattedMsg, context);
        }
    });
}

/**
 * Worker 线程日志桥接到主进程
 */
function bridgeWorkerLogToMain(level: LogLevel, message: string, context: string): void {
    try {
        const {parentPort} = require('worker_threads');
        if (parentPort) {
            parentPort.postMessage({
                type: 'log',
                level: LogLevel[level],
                message,
                context,
                timestamp: getBeijingTimestamp()
            });
        }
    } catch (error) {
        // 静默失败，避免影响主流程
        process.stderr.write(`[Worker 日志桥接失败] ${error}\n`);
    }
}

/**
 * 主进程发布日志到 EventBus
 */
function emitLogToEventBus(level: LogLevel, message: string, context: string): void {
    try {
        const eventBus = getGlobalEventBus();
        if (eventBus) {
            eventBus.emit('log:message', {
                level,
                message,
                context,
                timestamp: getBeijingTimestamp()
            });
        }
    } catch (error) {
        // 静默失败，避免影响主流程
        process.stderr.write(`[日志事件发布失败] ${error}\n`);
    }
}
```

**关键设计**：
- ✅ **自动检测**：无需手动配置，自动识别运行环境
- ✅ **透明桥接**：Worker 代码无需关心日志如何发送
- ✅ **统一 API**：所有模块都使用 `createLogger`
- ✅ **错误隔离**：桥接失败不影响主流程

**预计工作量**：1.5 小时

---

#### **任务 1.4：简化 main.ts**

**文件**：`src/main.ts`

**修改内容**：
1. 导入 `LogManager`
2. 在 `createWindow` 中初始化 `LogManager`（一行代码）
3. 在应用退出时调用 `destroy()`

**详见架构设计中的完整代码**

**预计工作量**：30 分钟

---

### **阶段 2：Worker 线程支持（自动桥接）**

#### **任务 2.1：在 logger.ts 中添加自动桥接逻辑**

**文件**：`src/logger/logger.ts`

**修改内容**：
1. 添加 `isWorkerThread` 检测逻辑
2. 添加 `bridgeWorkerLogToMain` 辅助函数
3. 添加 `emitLogToEventBus` 辅助函数
4. 在 `logWithLevel` 中根据环境选择桥接方式

**代码已在任务 1.2 中实现**，此任务主要是验证和测试。

**预计工作量**：30 分钟（测试和验证）

---

#### **任务 2.2：在主进程中接收 Worker 日志（通过 LogManager）**

**文件**：`src/core/worker-pool.ts`

**修改内容**：
1. 导入 `LogManager`（或通过依赖注入获取）
2. 在 Worker 消息处理器中，检测 `type === 'log'` 的消息
3. 委托给 `LogManager.handleWorkerLog` 处理
4. 添加 Worker ID 前缀，便于区分来源

**代码示例**：
```typescript
// worker-pool.ts
import {LogManager} from './log-manager';

// 假设 logManager 通过构造函数或全局方式传入
worker.on('message', (message: any) => {
    // 【新增】处理日志消息
    if (message.type === 'log') {
        // 委托给 LogManager 处理
        logManager?.handleWorkerLog(consumer.id, message);
        return; // 不再继续处理其他逻辑
    }
    
    // ... 其他消息处理（task completed, error, etc.）
});
```

**关键点**：
- ✅ 在 Worker 消息处理的早期阶段拦截日志消息
- ✅ 委托给 LogManager 处理，保持 worker-pool.ts 精简
- ✅ 添加 Worker ID 前缀，便于调试
- ✅ 返回 early，避免进入其他消息处理逻辑

**优势**：
- ✅ worker-pool.ts 只需 2 行代码处理日志
- ✅ 日志路由逻辑集中在 LogManager
- ✅ 职责清晰，易于维护

**预计工作量**：1 小时

---

#### **任务 2.3：Worker 中使用日志（无需修改）**

**文件**：`src/workers/file-worker.ts`

**说明**：
- Worker 中的日志使用方式**无需修改**
- 继续使用 `workerLogger.info()`, `workerLogger.warn()` 等
- 自动桥接逻辑对 Worker 透明

**示例**：
```typescript
// file-worker.ts（现有代码保持不变）
import {createLogger} from '../logger/logger';
import {LogLevel} from '../types';

const workerLogger = createLogger({
    context: 'Worker',
    enableFile: true,
    enableFrontend: true,  // 启用前端输出
    enableMemory: false,
    fileLevel: LogLevel.WARN,
    frontendLevel: LogLevel.INFO,
});

// 正常使用，无需关心如何发送
workerLogger.info('开始处理文件: {}', filePath);
workerLogger.warn('文件过大，跳过预览');
workerLogger.error('解析失败: {}', error.message);
```

**优势**：
- ✅ Worker 代码零修改
- ✅ 统一的 API
- ✅ 透明的桥接机制

**预计工作量**：0（无需修改）

---

### **阶段 3：清理和优化（保留性能优化）**

#### **任务 3.1：保留 scanner-helpers.ts 的高性能优化**

**文件**：`src/utils/scanner-helpers.ts`

**重要决策**：**必须保留所有性能优化！**

**原因**：
1. 扫描过程中可能产生数千条日志（高频场景）
2. 频繁的数组操作和 IPC 通信会导致性能问题
3. 现有的优化经过充分测试，效果显著

**需要保留的优化**：

1. **环形缓冲区**（O(1) 时间复杂度）：
   ```typescript
   const logs = new Array<string>(MAX_LOG_ENTRIES);
   let logIndex = 0;
   let logCount = 0;
   
   // O(1) 写入
   logs[logIndex % MAX_LOG_ENTRIES] = logWithTime;
   logIndex++;
   ```

2. **缓存转换数组**（避免重复创建）：
   ```typescript
   let cachedLogsArray: string[] = [];
   
   // 只在需要时更新
   if (logCount < MAX_LOG_ENTRIES) {
       cachedLogsArray = logs.slice(0, logCount);
   } else {
       const start = logIndex % MAX_LOG_ENTRIES;
       cachedLogsArray = [
           ...logs.slice(start),
           ...logs.slice(0, start)
       ];
   }
   scanState.logs = cachedLogsArray;
   ```

3. **自适应更新频率**（防止 OOM）：
   ```typescript
   let lastLogUpdateTime = 0;
   
   // 每 50 条日志或每秒更新一次
   if (!lastLogUpdateTime || now - lastLogUpdateTime >= 1000 || logCount % 50 === 0) {
       // 更新 UI
       lastLogUpdateTime = now;
   }
   ```

**修改内容**：
仅修改前端 IPC 部分，改为通过 EventBus 发送：

```typescript
// 在 processLogEntry 函数中
if (shouldSendToFrontend) {
    setImmediate(() => {
        // 【改造】通过 EventBus 发送，而不是直接操作 mainWindow
        const eventBus = getGlobalEventBus();
        if (eventBus) {
            eventBus.emit('log:message', {
                level,
                message: logWithTime,
                context: 'Scanner',
                timestamp: timeStr
            });
        }
    });
}
```

**优势**：
- ✅ 保留了所有性能优化
- ✅ 解耦了与 BrowserWindow 的依赖
- ✅ 通过 EventBus 统一管理
- ✅ 扫描性能不受影响

**预计工作量**：1 小时

---

#### **任务 3.2：统一日志配置**

**文件**：`src/core/scan-config.ts`

**修改内容**：
- 确认所有日志配置常量都已添加
- 添加注释说明各配置的用途

**已完成**：
- ✅ `LOG_FILE_LEVEL`
- ✅ `LOG_FRONTEND_LEVEL`
- ✅ `LOG_MEMORY_LEVEL`
- ✅ `LOG_ENABLE_FILE`
- ✅ `LOG_ENABLE_FRONTEND`
- ✅ `LOG_ENABLE_MEMORY`

**预计工作量**：15 分钟

---

#### **任务 3.3：添加文档和注释**

**文件**：
- `src/core/event-bus.ts`
- `src/logger/logger.ts`
- `src/utils/scanner-helpers.ts`

**修改内容**：
1. 更新 JSDoc 注释，说明新的日志架构
2. 添加使用示例
3. 说明各模块的职责

**预计工作量**：1 小时

---

## 📅 迁移计划

### **第 1 天：基础设施**

- [ ] 任务 1.1：扩展事件类型
- [ ] 任务 1.2：创建 LogManager 模块
- [ ] 任务 1.3：修改 logger.ts（支持自动桥接）
- [ ] 任务 1.4：简化 main.ts
- [ ] 测试：验证通用日志能发送到前端

### **第 2 天：Worker 支持（自动桥接）**

- [ ] 任务 2.1：在 logger.ts 中添加自动桥接逻辑（验证和测试）
- [ ] 任务 2.2：在主进程中接收 Worker 日志
- [ ] 任务 2.3：验证 Worker 日志使用方式（应无需修改）
- [ ] 测试：验证 Worker 日志能发送到前端

### **第 3 天：清理和优化（保留性能优化）**

- [ ] 任务 3.1：保留 scanner-helpers.ts 的高性能优化
- [ ] 任务 3.2：统一日志配置
- [ ] 任务 3.3：添加文档和注释
- [ ] 全面测试：验证所有日志渠道正常工作
- [ ] 性能测试：对比改造前后的扫描性能

### **第 4 天：回归测试**

- [ ] 运行完整扫描流程
- [ ] 检查日志文件输出
- [ ] 检查前端日志显示
- [ ] 检查内存占用
- [ ] 性能测试：对比改造前后的性能

---

## ⚠️ 风险评估

### **风险 1：循环依赖**

**描述**：
- `event-bus.ts` 导入 `scanner-helpers.ts`
- `scanner-helpers.ts` 可能需要导入 `event-bus.ts`

**解决方案**：
- 避免 `scanner-helpers.ts` 导入 `event-bus.ts`
- 通过全局函数 `getGlobalEventBus()` 间接访问
- 或者将 `LogEventData` 接口移到单独的文件

**风险等级**：⭐⭐ 中

---

### **风险 2：性能影响**

**描述**：
- 每次日志都发布事件，可能影响性能
- 高频日志（如扫描进度）可能导致事件队列积压
- 移除性能优化会导致扫描速度下降

**解决方案**：
- ✅ **保留 `scanner-helpers.ts` 的所有性能优化**（环形缓冲区、缓存数组、自适应节流）
- ✅ 对于高频日志，使用已有的自适应节流策略（50条/秒 或 每秒）
- ✅ 监控事件队列长度，必要时添加背压机制
- ✅ 性能测试对比改造前后，确保无明显下降

**风险等级**：⭐ 低（因为保留了优化）

---

### **风险 3：Worker 线程兼容性**

**描述**：
- Worker 线程无法直接访问 EventBus
- 需要通过 `parentPort` 消息传递机制
- 消息格式不一致可能导致解析错误

**解决方案**：
- ✅ **自动桥接**：在 `logger.ts` 中自动检测环境并选择桥接方式
- ✅ **统一消息格式**：定义标准的日志消息结构
- ✅ **错误隔离**：桥接失败静默处理，不影响主流程
- ✅ **添加 Worker ID 前缀**：便于区分日志来源

**风险等级**：⭐ 低

---

### **风险 4：向后兼容性**

**描述**：
- 现有代码可能依赖旧的日志行为
- 修改后可能影响某些模块

**解决方案**：
- 逐步迁移，先测试再推广
- 保留原有的 API 接口
- 添加降级逻辑（如果 EventBus 不存在，使用旧方式）

**风险等级**：⭐ 低

---

## ✅ 验收标准

### **功能验收**

1. ✅ **通用日志能发送到前端**：
   - 使用 `createLogger` 创建的日志实例
   - 配置 `enableFrontend: true`
   - 日志能在前端实时显示

2. ✅ **Worker 日志能发送到前端**：
   - Worker 线程中的日志
   - 通过主进程转发
   - 日志能在前端实时显示

3. ✅ **扫描器日志正常工作**：
   - `createScannerLogger` 仍然高效
   - 日志能通过 EventBus 发送到前端
   - 性能无明显下降

4. ✅ **文件日志正常输出**：
   - 所有日志都能写入文件
   - 日志级别过滤正常工作

5. ✅ **内存日志正常保存**：
   - 日志保存到 ScanState
   - 前端可以查询历史日志

---

### **性能验收**

1. ✅ **扫描性能无明显下降**：
   - 扫描速度不低于改造前（允许 ±5% 波动）
   - 内存占用不超过改造前 10%
   - 环形缓冲区优化仍然生效

2. ✅ **事件队列无积压**：
   - 高频日志不会导致事件队列过长
   - 前端响应流畅，无卡顿
   - 自适应节流策略正常工作

3. ✅ **Worker 通信无阻塞**：
   - Worker 日志不影响任务处理
   - 消息传递延迟 < 10ms
   - Worker 线程无额外性能开销

---

### **代码质量验收**

1. ✅ **无循环依赖**：
   - 模块依赖关系清晰
   - 可以通过编译检查

2. ✅ **类型安全**：
   - TypeScript 类型定义完整
   - 无 `any` 类型滥用

3. ✅ **错误处理完善**：
   - EventBus 不存在时静默失败
   - Worker 消息格式错误时有容错

4. ✅ **文档完整**：
   - JSDoc 注释清晰
   - 使用示例完整

---

## 📊 预期收益

### **短期收益**

1. ✅ **代码解耦**：日志模块不再依赖 Electron
2. ✅ **灵活性提升**：可以轻松添加新的日志输出渠道
3. ✅ **Worker 支持**：Worker 线程透明地发送日志到前端
4. ✅ **性能保持**：保留所有高频日志的性能优化
5. ✅ **main.ts 精简**：从 20+ 行减少到 1 行（减少 85%）
6. ✅ **职责清晰**：LogManager 专门负责日志管理

### **长期收益**

1. ✅ **可维护性**：统一的日志架构，易于理解和维护
2. ✅ **可扩展性**：可以轻松集成远程日志服务、日志分析工具等
3. ✅ **可测试性**：LogManager 可独立测试，易于 mock
4. ✅ **API 简洁**：统一的 `createLogger` API，降低学习成本

### **关键设计原则**

1. **透明性**：Worker 代码无需关心日志如何发送
2. **自动化**：自动检测运行环境，选择合适的桥接方式
3. **性能优先**：保留所有经过验证的性能优化
4. **向后兼容**：现有代码无需大规模修改
5. **单一职责**：每个模块职责清晰，main.ts 保持精简

---

## 🎓 总结

本方案通过引入事件总线作为日志系统的中间层，实现了：

1. **完全解耦**：日志模块与 UI 模块分离
2. **灵活路由**：通过事件监听者控制日志输出
3. **统一管理**：所有日志都通过事件总线发布
4. **易于扩展**：可以轻松添加新的日志渠道
5. **Worker 友好**：Worker 线程也能发送日志到前端

**实施建议**：
- 分阶段实施，先完成基础设施，再逐步迁移
- 充分测试，确保向后兼容
- 监控性能，及时调整优化

**预计总工作量**：2-3 天

---

**文档版本**：v1.0  
**创建日期**：2026-05-11  
**作者**：AI Assistant  
**审核状态**：待审核
