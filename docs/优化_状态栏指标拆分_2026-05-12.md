# 状态栏指标拆分优化报告

## 📋 修改概述

将状态栏中模糊的"不扫描文档"指标拆分为两个清晰的指标：
- **已过滤**：用户主动配置导致的文件过滤
- **跳过/错误**：系统技术原因导致的文件跳过

---

## 🎯 问题背景

### 原问题分析
原状态栏显示"不扫描文档"，但实际统计包含了多种不同性质的跳过情况：

1. **用户主动过滤**
   - 扩展名不匹配（用户选择的文件类型）
   - 空文件（0字节）

2. **系统被动跳过**
   - 文件大小超限（超过配置的 maxFileSizeMb/maxPdfSizeMb）
   - 无读取权限
   - 文件被其他程序锁定

### 存在的问题
- ❌ 语义不准确，误导用户以为是主动排除
- ❌ 混淆了两种不同性质的跳过原因
- ❌ 无法帮助用户排查权限或文件锁定问题

---

## ✅ 解决方案

### 方案一：拆分为两个独立指标

#### 数据分类标准

| 指标名称 | 统计内容 | 颜色样式 | 含义 |
|---------|---------|---------|------|
| **已过滤** | 扩展名不匹配、空文件 | 普通文本色 | 用户配置导致的正常过滤 |
| **跳过/错误** | 文件过大、权限不足、文件锁定 | 红色（error） | 系统技术原因导致的异常跳过 |

#### 优势
1. **语义清晰**：明确区分用户行为和系统行为
2. **便于排查**：如果"跳过/错误"数量过高，提示用户检查权限或文件状态
3. **信息透明**：用户能清楚了解哪些是正常过滤，哪些是异常情况

---

## 🔧 技术实现

### 后端修改

#### 1. walker-worker.ts
```typescript
// 新增两个计数器
let filteredCount = 0;  // 用户主动过滤的文件数
let skippedCount = 0;   // 系统跳过的文件数

// 扩展名不匹配 → filteredCount++
if (!selectedExtensions.includes(ext)) {
  filteredCount++;
  return;
}

// 空文件 → filteredCount++
if (fileSize === 0) {
  filteredCount++;
  return;
}

// 文件过大 → skippedCount++
if (fileSize > maxSize) {
  skippedCount++;
  return;
}

// 权限问题 → skippedCount++
catch (accessError: any) {
  skippedCount++;
  return;
}
```

#### 2. scanner.ts
```typescript
// 新增统计变量
let walkerFilteredCount = 0;   // 过滤计数
let walkerSkippedCount = 0;    // 跳过计数

// 累加 Walker 返回的统计数据
walkerFilteredCount += message.filteredCount || 0;
walkerSkippedCount += message.skippedCount;

// 更新停滞检测状态快照
lastStagnationCheckState = {
  processed: consumerProcessedCount,
  total: walkerTotalCount,
  filtered: walkerFilteredCount,  // 新增
  skipped: walkerSkippedCount,
  // ...其他字段
};
```

#### 3. scanner-helpers.ts
```typescript
// createProgressUpdater 新增参数
export function createProgressUpdater(
  mainWindow: BrowserWindow | null,
  getConsumerProcessedCount: () => number,
  getWalkerTotalCount: () => number,
  getWalkerFilteredCount: () => number,  // 新增
  getWalkerSkippedCount: () => number,
  baseThrottleInterval: number = 500
): (currentFile?: string) => void {
  // 发送进度时包含 filteredCount
  mainWindow.webContents.send('scan-progress', {
    currentFile,
    scannedCount: getConsumerProcessedCount(),
    totalCount: getWalkerTotalCount(),
    filteredCount: getWalkerFilteredCount(),  // 新增
    skippedCount: getWalkerSkippedCount()
  });
}
```

---

### 前端修改

#### 1. stores/app.ts
```typescript
// 替换 errorCount 为两个独立状态
const filteredCount = ref(0)   // 用户主动过滤的文件数
const skippedCount = ref(0)    // 系统跳过的文件数

// 清空时重置两个计数
function clearScanResults() {
  filteredCount.value = 0;
  skippedCount.value = 0;
  // ...
}

// 导出两个状态
return {
  // ...
  filteredCount,
  skippedCount,
  // ...
}
```

#### 2. App.vue
```vue
<!-- UI 显示拆分 -->
<div class="status-item">
  <span class="status-label">已过滤：</span>
  <span class="status-value mono-font">{{ formatNumber(filteredCount) }}</span>
</div>
<div class="status-divider"></div>
<div class="status-item">
  <span class="status-label">跳过/错误：</span>
  <span class="status-value error mono-font">{{ formatNumber(skippedCount) }}</span>
</div>

<!-- 监听进度更新 -->
await onScanProgress((data) => {
  if (data.filteredCount !== undefined) {
    appStore.filteredCount = data.filteredCount
  }
  if (data.skippedCount !== undefined) {
    appStore.skippedCount = data.skippedCount
  }
})
```

---

## 📊 影响范围

### 修改的文件清单

| 文件路径 | 修改类型 | 说明 |
|---------|---------|------|
| `src/walker-worker.ts` | 核心逻辑 | 区分统计 filteredCount 和 skippedCount |
| `src/scanner.ts` | 数据处理 | 累加并传递两类统计数据 |
| `src/scanner-helpers.ts` | 工具函数 | 进度更新器支持 filteredCount |
| `frontend/src/stores/app.ts` | 状态管理 | 新增 filteredCount 和 skippedCount |
| `frontend/src/App.vue` | UI 展示 | 拆分显示两个指标 |

### 兼容性分析
- ✅ **向后兼容**：IPC 通信使用 `any` 类型，前端可选接收新字段
- ✅ **不影响现有功能**：只是拆分显示，不改变扫描逻辑
- ✅ **无需数据库迁移**：纯内存统计数据

---

## 🧪 测试建议

### 功能测试场景

1. **测试用户过滤**
   - 选择仅扫描 `.pdf` 文件
   - 目录中包含 `.docx`、`.txt` 等非 PDF 文件
   - 预期："已过滤"计数增加，"跳过/错误"不变

2. **测试空文件过滤**
   - 创建 0 字节的测试文件
   - 执行扫描
   - 预期："已过滤"计数增加

3. **测试文件过大跳过**
   - 创建超过 50MB 的 PDF 文件
   - 执行扫描
   - 预期："跳过/错误"计数增加

4. **测试权限问题跳过**
   - 设置某个文件为只读或无权限
   - 执行扫描
   - 预期："跳过/错误"计数增加

5. **测试正常扫描**
   - 选择包含各种文件的目录
   - 观察两个指标的变化
   - 预期：两类数据正确分类统计

### 性能测试
- ✅ 编译通过，无 TypeScript 错误
- ✅ 构建成功，生成 macOS DMG 安装包
- ⏳ 建议实际运行测试大数据量扫描场景

---

## 💡 后续优化建议

### 短期优化（可选）
1. **添加 Tooltip 说明**
   ```vue
   <div class="status-item" title="包含：扩展名不匹配、空文件">
     <span class="status-label">已过滤：</span>
     ...
   </div>
   <div class="status-item" title="包含：文件过大、无权限、文件锁定">
     <span class="status-label">跳过/错误：</span>
     ...
   </div>
   ```

2. **日志增强**
   - 在扫描完成日志中分别输出两类计数
   - 例如：`扫描完成: 遍历 1000 个文件, 过滤 200 个, 跳过 5 个, 处理 795 个`

### 长期优化（如需更精细统计）
1. **细分跳过原因**
   - 文件大小超限：X 个
   - 权限不足：Y 个
   - 文件锁定：Z 个
   
2. **提供修复建议**
   - 如果 skippedCount > 0，在日志中输出具体文件列表和原因
   - 引导用户如何解决权限或锁定问题

---

## 📝 总结

### 修改价值
1. **用户体验提升**：清晰区分用户行为和系统行为
2. **问题排查便利**：快速定位权限或文件锁定问题
3. **代码质量改进**：语义更准确，符合单一职责原则

### 风险评估
- ⚠️ **低风险**：仅修改统计逻辑和 UI 显示，不影响核心扫描流程
- ✅ **已验证**：编译通过，构建成功
- ✅ **可回滚**：修改集中在 5 个文件，易于恢复

### 下一步行动
1. 安装新版本进行实际测试
2. 观察真实扫描场景中的数据统计准确性
3. 根据用户反馈决定是否需要进一步细化统计维度

---

**修改日期**：2026-05-06  
**修改人员**：AI Assistant  
**审核状态**：待测试验证
