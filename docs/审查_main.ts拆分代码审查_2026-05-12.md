# main.ts 模块化拆分 - 全面代码审查报告

**审查日期**: 2026-05-12  
**对比版本**: 0f0adcae (原始单文件版本)  
**审查范围**: 所有拆分后的模块

---

## 📋 审查清单

### ✅ 已完成的优化（在审查过程中发现并修复）

1. ✅ **移除未使用的导入** - `preview-worker-manager.ts` 中的 `Logger` 和 `FILE_WORKER_PATH`
2. ✅ **使用 FILE_WORKER_PATH 常量** - 替代 `path.join` 计算路径
3. ✅ **移除未使用的参数** - `preview-worker-manager.ts` 的 `getMainWindow` 参数
4. ✅ **统一静态导入** - `main.ts` 中移除动态 `require`
5. ✅ **移除动态 require** - `ipc-handlers.ts` 中使用静态 `mainLogger`
6. ✅ **补充 logManager.destroy()** - 应用退出时正确清理资源

---

## 🔍 逐模块审查结果

### 1. app-initializer.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L5-6 | 导入日志抑制工具 | L15 | ✅ 一致 |
| L8-12 | 设置日志文件 | L33-35 | ✅ 一致 |
| L15 | V8 GC 配置 | L38 | ✅ 一致 |
| L17-20 | PDF polyfills | L17, L41 | ✅ 一致 |
| L41-49 | 全局错误处理 | L44-52 | ✅ 一致 |
| L53-60 | 进程退出监听 | L56-63 | ✅ 一致 |
| L63-75 | before-quit 事件 | L86-101 | ✅ 一致 + 补充 logManager.destroy() |

#### ⚠️ 发现的问题

**问题 1**: 原始代码中 `before-quit` 事件在 L63-75，直接调用 `logManager?.destroy()`
- 原始代码：L74 `logManager?.destroy();`
- 新代码：L97-100 通过回调获取 logManager 后调用 destroy()
- **结论**: ✅ 功能完整，且更优（避免循环依赖）

**问题 2**: 原始代码中 `setupScanFinishedListener()` 函数（L738-753）**完全缺失**！
- 这是一个**严重的功能缺失**
- 该函数用于监听扫描完成事件，停止电源阻止器
- **需要立即修复**

---

### 2. window-manager.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L89-119 | getWindowBounds() | L23-73 | ✅ 一致 |
| L121-231 | createWindow() | L78-220 | ✅ 一致 |
| L129-131 | 图标路径计算 | L103-106 | ⚠️ 路径可能有问题 |
| L154 | preload 路径 | L133 | ✅ 已修复为两个 .. |
| L161 | LogManager 初始化 | L147 | ✅ 一致 |
| L164 | 隐藏菜单栏 | L150 | ✅ 一致 |
| L167-170 | macOS Dock 图标 | L153-156 | ✅ 一致 |
| L174-210 | 开发/生产模式加载 | L159-199 | ✅ 一致 |
| L212-227 | closed 事件 | L202-216 | ✅ 一致 |
| L230 | setupScanFinishedListener() | ❌ **缺失** | ❌ **严重问题** |

#### ⚠️ 发现的问题

**问题 1**: 前端文件路径可能错误
```typescript
// L166, L177, L185: 当前代码
const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
// __dirname = /dist/core/main/
// .. → /dist/core/
// + renderer/index.html → /dist/core/renderer/index.html ❌

// 应该是：
const indexPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
// .. → /dist/core/
// .. → /dist/
// + renderer/index.html → /dist/renderer/index.html ✅
```

**问题 2**: `setupScanFinishedListener()` 函数完全缺失
- 原始代码 L738-753 有这个函数
- 拆分后没有迁移这个函数
- **这是严重的功能缺失**

---

### 3. power-save-manager.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L83 | powerSaveBlockerId 变量 | L17 | ✅ 一致 |
| L301-304 | start() 方法 | L27-37 | ✅ 一致 |
| L336-339 | stop() 方法（取消扫描时） | L42-52 | ✅ 一致 |
| L354-358 | stop() 方法（超时时） | L42-52 | ✅ 一致 |
| L220-224 | stop() 方法（窗口关闭时） | L42-52 | ✅ 一致 |
| L744-748 | stop() 方法（扫描完成时） | ❌ **缺失** | ❌ **严重问题** |

#### ⚠️ 发现的问题

**问题**: 扫描完成时停止电源阻止器的逻辑缺失
- 原始代码在 `setupScanFinishedListener()` 中处理（L744-748）
- 拆分后这个逻辑丢失了
- **需要修复**

---

### 4. preview-worker-manager.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L86 | previewWorkers Map | L50 | ✅ 一致 |
| L366-502 | preview-file-stream IPC | L57-183 | ✅ 一致 |
| L378 | worker 路径 | L64 | ✅ 已优化为 FILE_WORKER_PATH |
| L380-385 | Worker 创建 | L65-70 | ✅ 一致 |
| L388 | 注册 Worker | L73 | ✅ 一致 |
| L390-498 | Promise 处理 | L75-183 | ✅ 一致 |
| L511-519 | cancel-preview IPC | L189-195 | ✅ 一致 |

#### ✅ 无问题

这个模块审查通过，所有功能完整。

---

### 5. ipc-handlers.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L287-293 | get-directory-tree | L44-50 | ✅ 一致 |
| L296-317 | scan-start | L53-66 | ✅ 一致 |
| L320-363 | scan-cancel | L72-107 | ✅ 一致 |
| L366-502 | preview-file-stream | （已移至 preview-worker-manager） | ✅ 已迁移 |
| L511-519 | cancel-preview | （已移至 preview-worker-manager） | ✅ 已迁移 |
| L522-529 | open-file | L110-117 | ✅ 一致 |
| L532-539 | open-file-location | L120-127 | ✅ 一致 |
| L542-549 | delete-file | L130-137 | ✅ 一致 |
| L552-559 | export-report | L140-147 | ✅ 一致 |
| L562-564 | get-logs | L150-152 | ✅ 一致 |
| L567-569 | get-sensitive-rules | L155-157 | ✅ 一致 |
| L572-579 | save-config | L160-167 | ✅ 一致 |
| L582-588 | load-config | L170-176 | ✅ 一致 |
| L591-593 | get-recommended-concurrency | L179-181 | ✅ 一致 |
| L596-598 | check-system-environment | L184-186 | ✅ 一致 |
| L601-605 | show-save-dialog | L189-194 | ✅ 一致 |
| L608-624 | show-message-box | L197-213 | ✅ 一致 |
| L627-721 | clear-cache | L216-337 | ✅ 一致 |
| L724-730 | open-dev-tools | L340-346 | ✅ 一致 |

#### ✅ 无问题

所有 IPC handlers 都已正确迁移，功能完整。

---

### 6. utils.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L262-283 | getDirectorySize() | L11-32 | ✅ 一致 |

#### ✅ 无问题

辅助函数正确迁移。

---

### 7. main.ts

#### ✅ 功能完整性检查

| 原始代码位置 | 功能描述 | 新代码位置 | 状态 |
|------------|---------|----------|------|
| L77-80 | 全局变量声明 | L14-17 | ✅ 一致 |
| L233-253 | app.whenReady() | L50-71 | ✅ 一致 |
| L255-259 | window-all-closed | L73-77 | ✅ 一致 |

#### ⚠️ 发现的问题

**问题**: 缺少 `setupScanFinishedListener()` 的调用
- 原始代码在 `createWindow()` 中调用（L230）
- 拆分后这个调用丢失了

---

## ❌ 严重问题汇总

### 问题 1: setupScanFinishedListener() 函数完全缺失

**影响**: 
- 扫描完成后不会自动停止电源阻止器
- 可能导致系统持续阻止休眠，影响用户体验

**原始代码** (L738-753):
```typescript
let originalSend: any = null;

function setupScanFinishedListener() {
    if (!originalSend && mainWindow) {
        originalSend = mainWindow.webContents.send.bind(mainWindow.webContents);
        mainWindow.webContents.send = function (channel: string, ...args: any[]) {
            if (channel === 'scan-finished') {
                // 扫描完成时停止电源阻止器
                if (powerSaveBlockerId !== null) {
                    powerSaveBlocker.stop(powerSaveBlockerId);
                    mainLogger.info(`[电源管理] 扫描完成，已停止电源阻止器 (ID: ${powerSaveBlockerId})`);
                    powerSaveBlockerId = null;
                }
            }
            return originalSend(channel, ...args);
        };
    }
}
```

**调用位置** (L230):
```typescript
// 【新增】设置扫描完成监听器
setupScanFinishedListener();
```

**修复方案**:
需要在 `window-manager.ts` 中添加这个函数，并在 `createWindow()` 中调用。

---

### 问题 2: 前端文件路径可能错误

**影响**:
- 生产模式下可能无法加载前端页面

**当前代码** (window-manager.ts L166, L177, L185):
```typescript
const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
```

**应该改为**:
```typescript
const indexPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
```

---

## 📊 审查统计

| 类别 | 数量 |
|------|------|
| ✅ 功能完整 | 95% |
| ⚠️ 需要修复 | 2 个严重问题 |
| ❌ 功能缺失 | 1 个（setupScanFinishedListener） |
| 🔧 路径问题 | 1 个（前端文件路径） |

---

## 🔧 修复计划

### P0 - 立即修复

1. **添加 setupScanFinishedListener() 函数**
   - 位置: `window-manager.ts`
   - 优先级: P0（严重功能缺失）
   - 预计工作量: 15 分钟

2. **修复前端文件路径**
   - 位置: `window-manager.ts` L166, L177, L185
   - 优先级: P0（可能导致生产模式无法启动）
   - 预计工作量: 5 分钟

### P1 - 后续优化

3. **验证所有路径计算**
   - 检查所有 `path.join` 是否正确
   - 优先级: P1
   - 预计工作量: 30 分钟

---

## ✅ 审查结论

**总体评价**: ⚠️ **需要修复后才能合并**

- ✅ 大部分功能已正确迁移
- ✅ 代码结构清晰，模块职责单一
- ✅ 类型安全，无 TypeScript 错误
- ❌ **存在 2 个严重问题需要立即修复**
  1. `setupScanFinishedListener()` 函数缺失
  2. 前端文件路径可能错误

**建议**:
1. 先修复 P0 问题
2. 进行全面的功能测试
3. 确认无误后再合并到主分支

---

## 📝 待优化项（非阻塞）

以下问题不影响功能，但可以优化：

1. **重复的 require('fs')** - ipc-handlers.ts 中多处出现
2. **嵌套回调过深** - preview-file-stream 中的多层嵌套
3. **魔法数字** - 500, 1920, 1080 等可以提取为常量
4. **注释更新** - 部分注释仍引用原始行号

---

**审查人**: AI Assistant  
**审查时间**: 2026-05-12  
**下次审查**: 修复完成后重新审查
