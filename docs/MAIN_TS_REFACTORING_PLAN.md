# Main.ts 模块化拆分方案

## 一、拆分目标

将 `src/main.ts`（754行）拆分为多个职责单一的模块，提高代码可维护性和可读性。

### 核心原则
1. **逐行对比**：确保每一处逻辑与拆分前版本（0f0adcae）完全一致
2. **功能完整**：不允许任何功能缺失或简化
3. **业务逻辑不变**：只改变代码组织结构，不改变业务逻辑
4. **先原样后优化**：发现原代码问题先按原样实现，标记为待优化项
5. **模块职责单一**：每个模块只负责一个明确的职责
6. **依赖关系清晰**：模块间依赖明确，避免循环依赖
7. **类型安全**：无 TypeScript 类型问题
8. **内存安全**：无内存泄漏风险

---

## 二、当前 main.ts 职责分析

### 2.1 功能模块划分

| 模块 | 行数范围 | 行数 | 职责描述 |
|------|---------|------|---------|
| 初始化配置 | L1-20 | 20 | 日志、GC、polyfills、全局错误处理 |
| 全局变量 | L77-86 | 10 | mainWindow, scanState, logManager, powerSaveBlockerId, previewWorkers |
| 窗口管理 | L89-231 | 143 | getWindowBounds, createWindow |
| 应用生命周期 | L233-259 | 27 | app.whenReady, activate, window-all-closed |
| 辅助函数 | L262-283 | 22 | getDirectorySize |
| IPC 处理器 | L285-731 | 447 | setupIpcHandlers 及所有 handler |
| 扫描完成监听 | L738-753 | 16 | setupScanFinishedListener |

### 2.2 发现的问题

1. ✅ **已修复**：handleTaskTimeout 方法签名错误（已在之前修复）
2. ⚠️ **待优化**：getDirectorySize 在多个地方重复 require('fs')
3. ⚠️ **待优化**：setupScanFinishedListener 使用 monkey-patching 方式拦截 send 方法

---

## 三、拆分后的目录结构

```
src/core/
├── main/                           # 新增：main 相关模块
│   ├── index.ts                    # 主入口，协调各模块
│   ├── app-initializer.ts          # 应用初始化
│   ├── window-manager.ts           # 窗口管理
│   ├── ipc-handlers.ts             # IPC 处理器
│   ├── preview-worker-manager.ts   # 预览 Worker 管理
│   ├── power-save-manager.ts       # 电源管理
│   └── utils.ts                    # 辅助函数
│
├── config/                         # 现有：配置管理
├── state/                          # 现有：状态管理
├── queue/                          # 现有：任务队列
├── worker/                         # 现有：Worker 池管理
├── scheduler/                      # 现有：智能调度
└── infra/                          # 现有：基础设施
```

---

## 四、详细模块设计

### 4.1 app-initializer.ts (~90行)

**职责**：应用级别的初始化配置和全局错误处理

**导出内容**：
```typescript
export function initializeApp(): void;
export function getAppLogger(): Logger;
```

**包含内容**：
1. 导入语句（L1-38 的初始化部分）
2. 日志系统设置（L9-12）
3. V8 GC 配置（L15）
4. PDF polyfills 设置（L18-20）
5. 全局错误处理器（L41-75）
   - unhandledRejection
   - uncaughtException
   - exit
   - before-quit

**依赖**：
- electron (app)
- path, fs
- ./logger/logger
- ./utils/log-utils
- ./extractors/pdf/polyfills/pdf-polyfills

**注意事项**：
- 必须在任何其他模块之前初始化
- 返回 Logger 实例供其他模块使用

---

### 4.2 window-manager.ts (~180行)

**职责**：BrowserWindow 的创建、配置和生命周期管理

**导出内容**：
```typescript
export interface WindowManager {
    createWindow(): BrowserWindow;
    getWindow(): BrowserWindow | null;
    destroy(): void;
}

export function createWindowManager(log: Logger): WindowManager;
```

**包含内容**：
1. getWindowBounds 函数（L89-119）
2. createWindow 函数（L121-231）
3. 窗口关闭事件处理（L212-227）
4. LogManager 初始化（L161）

**依赖**：
- electron (BrowserWindow, nativeImage, Menu, screen)
- path, fs
- ./core/config/constants
- ./core/state/scan-state
- ./core/main/app-initializer (logManager)
- ./services/directory-tree (如果需要)

**状态管理**：
- mainWindow: BrowserWindow | null
- logManager: LogManager | null

**注意事项**：
- 需要访问 scanState 用于窗口关闭时取消扫描
- 需要访问 powerSaveManager 用于停止电源阻止器

---

### 4.3 power-save-manager.ts (~70行)

**职责**：电源阻止器的统一管理

**导出内容**：
```typescript
export interface PowerSaveManager {
    start(): void;
    stop(): void;
    isStarted(): boolean;
}

export function createPowerSaveManager(log: Logger): PowerSaveManager;
```

**包含内容**：
1. powerSaveBlockerId 状态管理
2. start() 方法（对应 L301-304）
3. stop() 方法（对应 L335-339, L354-358, L744-748）
4. isStarted() 方法

**依赖**：
- electron (powerSaveBlocker)
- ./logger/logger

**使用场景**：
- 扫描开始时启动（scan-start handler）
- 扫描取消时停止（scan-cancel handler）
- 扫描完成时停止（setupScanFinishedListener）
- 窗口关闭时停止（window closed event）

---

### 4.4 preview-worker-manager.ts (~160行)

**职责**：预览 Worker 的创建、管理和销毁

**导出内容**：
```typescript
export interface PreviewWorkerManager {
    previewFile(filePath: string, mainWindow: BrowserWindow): Promise<any>;
    cancelPreview(taskId: number): void;
    cleanup(): void;
}

export function createPreviewWorkerManager(
    log: Logger,
    mainWindow: () => BrowserWindow | null
): PreviewWorkerManager;
```

**包含内容**：
1. previewWorkers Map 管理（L86）
2. preview-file-stream 处理逻辑（L366-502）
3. cancel-preview 处理逻辑（L511-519）

**依赖**：
- worker_threads (Worker)
- path, fs
- electron (BrowserWindow)
- ./core/config/constants
- ./core/config/scan-config (loadConfig)
- ./workers/file-worker (FILE_WORKER_PATH)

**关键逻辑**：
- Worker 创建和注册
- 超时计算和管理
- 流式消息处理（chunk, complete, error）
- Worker 终止和清理

---

### 4.5 utils.ts (~30行)

**职责**：辅助工具函数

**导出内容**：
```typescript
export function getDirectorySize(dirPath: string): number;
```

**包含内容**：
1. getDirectorySize 函数（L262-283）

**依赖**：
- fs
- path

---

### 4.6 ipc-handlers.ts (~450行)

**职责**：所有 IPC 通信处理器的注册和实现

**导出内容**：
```typescript
export function setupIpcHandlers(
    mainWindow: () => BrowserWindow | null,
    scanState: ScanState,
    logManager: LogManager | null,
    powerSaveManager: PowerSaveManager,
    previewWorkerManager: PreviewWorkerManager
): void;
```

**包含内容**：
完整的 setupIpcHandlers 函数（L285-731），包括：

1. **目录树**（L287-293）
   - get-directory-tree

2. **扫描控制**（L296-363）
   - scan-start（含电源管理启动）
   - scan-cancel（含电源管理停止）

3. **文件预览**（L366-519）
   - preview-file-stream → 委托给 previewWorkerManager
   - cancel-preview → 委托给 previewWorkerManager

4. **文件操作**（L522-549）
   - open-file
   - open-file-location
   - delete-file

5. **报告导出**（L552-559）
   - export-report

6. **日志和配置**（L562-588）
   - get-logs
   - get-sensitive-rules
   - save-config
   - load-config

7. **系统信息**（L591-598）
   - get-recommended-concurrency
   - check-system-environment

8. **对话框**（L601-624）
   - show-save-dialog
   - show-message-box

9. **缓存清理**（L627-721）
   - clear-cache（使用 getDirectorySize）

10. **开发者工具**（L724-730）
    - open-dev-tools

**依赖**：
- electron (ipcMain, dialog, BrowserWindow)
- ./core/index (startScan, cancelScan, 等)
- ./services/* (directory-tree, file-operations, report-exporter)
- ./detection/sensitive-detector
- ./core/main/preview-worker-manager
- ./core/main/power-save-manager
- ./core/main/utils (getDirectorySize)

---

### 4.7 index.ts (~60行)

**职责**：主入口，协调各模块，保持与原 main.ts 相同的导出

**导出内容**：
```typescript
// 重新导出主要功能
export { initializeApp, getAppLogger } from './app-initializer';
export { createWindowManager, WindowManager } from './window-manager';
export { createPowerSaveManager, PowerSaveManager } from './power-save-manager';
export { createPreviewWorkerManager, PreviewWorkerManager } from './preview-worker-manager';
export { setupIpcHandlers } from './ipc-handlers';
export { getDirectorySize } from './utils';
```

**或者提供更高级的 API**：
```typescript
export function bootstrap(): void;
```

---

## 五、新的 main.ts 结构（~80行）

拆分后的 main.ts 将变得非常简洁：

```typescript
// 1. 初始化应用（日志、GC、polyfills、错误处理）
import { initializeApp, getAppLogger } from './core/main';

initializeApp();
const log = getAppLogger();

// 2. 导入必要的模块
import { app, BrowserWindow } from 'electron';
import { createWindowManager } from './core/main/window-manager';
import { createPowerSaveManager } from './core/main/power-save-manager';
import { createPreviewWorkerManager } from './core/main/preview-worker-manager';
import { setupIpcHandlers } from './core/main/ipc-handlers';
import { ScanState, checkEnvironment } from './core';
import { dialog } from 'electron';

let mainWindow: BrowserWindow | null = null;
const scanState = ScanState.getInstance();

// 3. 创建管理器实例
const powerSaveManager = createPowerSaveManager(log);
const previewWorkerManager = createPreviewWorkerManager(
    log,
    () => mainWindow
);

// 4. 创建窗口
function createWindow() {
    const wm = createWindowManager(log);
    mainWindow = wm.createWindow();
    
    // 设置 IPC handlers
    setupIpcHandlers(
        () => mainWindow,
        scanState,
        wm.getLogManager(),
        powerSaveManager,
        previewWorkerManager
    );
}

// 5. 应用生命周期
app.whenReady().then(() => {
    const envCheck = checkEnvironment();
    if (!envCheck.isReady) {
        dialog.showErrorBox('系统环境检查失败', 
            `发现以下问题:\n\n${envCheck.issues.map(i => `${i.title}\n${i.description}`).join('\n\n')}`
        );
        app.quit();
        return;
    }
    
    createWindow();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
```

---

## 六、实施步骤

### Step 1: 创建目录结构
```bash
mkdir -p src/core/main
```

### Step 2: 创建基础模块（按依赖顺序）

1. **utils.ts** - 无依赖，最基础
2. **power-save-manager.ts** - 仅依赖 electron 和 logger
3. **preview-worker-manager.ts** - 依赖 worker_threads, config, services
4. **app-initializer.ts** - 依赖 logger, polyfills
5. **window-manager.ts** - 依赖 app-initializer, power-save-manager
6. **ipc-handlers.ts** - 依赖所有其他模块
7. **index.ts** - 统一导出

### Step 3: 修改原 main.ts
- 保留必要的导入和初始化
- 使用新的模块化结构
- 保持应用启动流程不变

### Step 4: TypeScript 编译验证
```bash
pnpm exec tsc -p tsconfig.main.json --noEmit
```

### Step 5: 功能测试
- 应用启动
- 窗口创建
- 扫描功能
- 预览功能
- 取消扫描
- 窗口关闭

### Step 6: 代码审查
- 逐行对比确保逻辑一致
- 检查是否有遗漏的功能
- 确认没有引入新问题

---

## 七、关键注意事项

### 7.1 必须保持一致的内容

1. **所有常量值**：WORKER_RESTART_DELAY, WORKER_RESTART_SCHEDULE_DELAY 等
2. **所有日志消息格式**：包括前缀、标点、变量插值
3. **所有错误消息**：包括 Error 对象的 message
4. **所有事件名称**：'worker.idle', 'scan-finished' 等
5. **所有回调函数签名**：参数顺序和类型
6. **所有异步行为**：setTimeout, setImmediate, Promise 的使用

### 7.2 可以优化的内容（标记后重构完成后优化）

1. ⚠️ **重复的 require('fs')**：在多个 handler 中重复出现
2. ⚠️ **嵌套回调过深**：preview-file-stream 中的多层嵌套
3. ⚠️ **魔法数字**：500, 1920, 1080 等可以提取为常量
4. ⚠️ **setupScanFinishedListener**：monkey-patching 方式不够优雅

### 7.3 循环依赖预防

```
app-initializer → logger ✓
window-manager → app-initializer, power-save-manager ✓
power-save-manager → logger ✓
preview-worker-manager → config, services ✓
ipc-handlers → 所有其他模块 ✓
index.ts → 所有模块 ✓
```

**注意**：确保没有反向依赖，例如 app-initializer 不应该依赖 window-manager。

### 7.4 类型安全

1. 所有导出函数必须有明确的类型签名
2. 避免使用 `any`，除非必要（如与原代码保持一致）
3. Consumer, PendingTask 等类型从 worker-pool-types 导入
4. 确保所有回调函数的类型正确

---

## 八、验收标准

### 8.1 功能完整性检查清单

- [ ] 应用能正常启动
- [ ] 窗口能正常创建和显示
- [ ] 开发模式和生产模式都能正常工作
- [ ] 图标加载正常
- [ ] 所有 IPC handlers 注册成功
- [ ] 扫描功能正常（开始、取消、完成）
- [ ] 预览功能正常（流式预览、取消预览）
- [ ] 文件操作正常（打开、删除、定位）
- [ ] 报告导出正常
- [ ] 配置保存加载正常
- [ ] 缓存清理正常
- [ ] 电源管理正常（启动、停止）
- [ ] 窗口关闭时正确清理资源
- [ ] 全局错误处理正常工作
- [ ] 日志系统正常工作

### 8.2 代码质量检查清单

- [ ] TypeScript 编译无错误
- [ ] TypeScript 编译无警告
- [ ] 无 ESLint 错误
- [ ] 模块职责单一清晰
- [ ] 依赖关系合理
- [ ] 无循环依赖
- [ ] 代码注释完整
- [ ] 日志消息格式一致

### 8.3 性能和安全检查清单

- [ ] 无内存泄漏风险
- [ ] Worker 正确清理
- [ ] 事件监听器正确移除
- [ ] 定时器正确清理
- [ ] 无未处理的 Promise rejection
- [ ] 无未捕获的异常

---

## 九、回滚计划

如果拆分过程中出现问题：

1. **立即停止**：不要继续后续步骤
2. **切换回原分支**：`git checkout master`
3. **分析问题**：确定是方案问题还是实施问题
4. **修正方案**：必要时调整方案并获得用户同意
5. **重新实施**：在新分支上重新开始

---

## 十、时间估算

| 步骤 | 预计时间 | 说明 |
|------|---------|------|
| 创建目录和基础模块 | 30分钟 | utils, power-save-manager |
| 创建核心模块 | 60分钟 | preview-worker-manager, app-initializer |
| 创建复杂模块 | 90分钟 | window-manager, ipc-handlers |
| 修改 main.ts | 20分钟 | 简化为主入口 |
| 编译和调试 | 30分钟 | 解决类型错误 |
| 功能测试 | 30分钟 | 验证所有功能 |
| 代码审查 | 30分钟 | 逐行对比 |
| **总计** | **约 5 小时** | |

---

## 十一、风险评估

### 高风险项
1. **ipc-handlers 拆分**：代码量大，容易遗漏细节
   - 缓解措施：逐段复制，每段后立即对比

2. **闭包和作用域**：某些变量可能在拆分后作用域改变
   - 缓解措施：仔细检查所有变量引用

3. **this 指向问题**：拆分后 this 可能指向不同对象
   - 缓解措施：使用箭头函数或显式绑定

### 中风险项
1. **类型导出**：某些类型可能需要重新导出
   - 缓解措施：编译时检查类型错误

2. **循环依赖**：模块间可能形成循环依赖
   - 缓解措施：提前规划依赖关系

### 低风险项
1. **导入路径**：相对路径可能需要调整
   - 缓解措施：使用 IDE 自动导入

---

## 十二、成功标准

拆分成功的标志：

1. ✅ 所有功能与拆分前完全一致
2. ✅ TypeScript 编译通过，无错误无警告
3. ✅ 应用能正常运行，所有功能可用
4. ✅ 代码结构清晰，易于理解和维护
5. ✅ 模块职责单一，依赖关系清晰
6. ✅ 没有引入新的 bug 或性能问题
7. ✅ 代码行数合理（总行数变化不超过 ±5%）

---

**方案制定完成。等待用户确认后开始实施。**
