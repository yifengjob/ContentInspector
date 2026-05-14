# 路径清理方案 - 详细设计文档

> **生成时间**: 2026-05-06  
> **功能**: 去除扫描路径中的父子关系，只保留父目录  
> **状态**: ✅ 已整合到修复方案

---

## 📋 **需求背景**

### **问题场景**

用户可能选择多个扫描路径，其中存在父子关系：

```typescript
// 场景 1: 明显的父子关系
['/', '/Users', '/Users/yifeng']
// 期望: 只扫描 '/'，因为其他都是其子目录

// 场景 2: 部分重叠
['/Users', '/Users/yifeng/Documents', '/Documents']
// 期望: 扫描 ['/Users', '/Documents']，去除 '/Users/yifeng/Documents'

// 场景 3: 无重叠
['/Users', '/Applications', '/Library']
// 期望: 全部保留，互不包含
```

### **当前问题**

如果不进行路径清理：
- ❌ **重复遍历**：`/Users` 会被 `/` 的遍历覆盖
- ❌ **性能浪费**：同一文件可能被多次报告
- ❌ **内存泄漏**：`seenFiles` Set 需要处理更多路径

---

## 🎯 **设计方案**

### **核心原则**

**只保留父目录，去除所有子目录**

```
输入:  ['/', '/Users', '/Users/yifeng', '/Documents']
输出:  ['/', '/Documents']

解释:
- '/' 是根目录，包含所有其他路径 → 保留 '/'
- '/Users' 是 '/' 的子目录 → 去除
- '/Users/yifeng' 是 '/' 的子目录 → 去除
- '/Documents' 不是 '/' 的子目录（在 macOS 中）→ 保留
```

---

## 🔧 **实现细节**

### **函数签名**

```typescript
/**
 * 清理扫描路径，去除父子关系
 * @param paths 原始路径数组
 * @returns 清理后的路径数组（只保留父目录）
 */
function deduplicatePaths(paths: string[]): string[];
```

---

### **算法步骤**

#### **步骤 1: 规范化路径**

```typescript
// 将所有路径转换为绝对路径
const normalized = paths.map(p => path.resolve(p));

// 示例
['/', 'Users', './Documents'] 
  → ['/', '/Users', '/Documents']
```

**为什么要规范化？**
- 确保路径格式一致
- 处理相对路径（如 `./Documents`）
- 消除 `..` 和 `.` 的影响

---

#### **步骤 2: 按长度排序**

```typescript
// 短路径更可能是父目录
normalized.sort((a, b) => a.length - b.length);

// 示例
['/Users/yifeng/Documents', '/Users', '/']
  → ['/', '/Users', '/Users/yifeng/Documents']
```

**为什么要排序？**
- 优化性能：先检查短路径（更可能是父目录）
- 简化逻辑：确保父目录先被加入结果集

---

#### **步骤 3: 过滤子目录**

```typescript
const result: string[] = [];

for (const currentPath of normalized) {
    let isSubdirectory = false;
    
    // 检查当前路径是否是已选路径的子目录
    for (const selectedPath of result) {
        if (currentPath === selectedPath || 
            currentPath.startsWith(selectedPath + path.sep)) {
            isSubdirectory = true;
            break;
        }
    }
    
    if (!isSubdirectory) {
        result.push(currentPath);
    }
}
```

**关键判断条件**：

```typescript
// 条件 1: 完全相同
currentPath === selectedPath

// 条件 2: 是子目录（注意路径分隔符）
currentPath.startsWith(selectedPath + path.sep)

// 示例
'/Users/yifeng'.startsWith('/Users' + '/')  → true  ✅
'/usr-local'.startsWith('/usr' + '/')       → false ✅ （避免误判）
```

---

### **边界情况处理**

#### **情况 1: 路径末尾有分隔符**

```typescript
// 输入
['/Users/', '/Users/yifeng']

// 规范化后
path.resolve('/Users/') → '/Users'  （自动去除末尾分隔符）

// 结果
['/Users']  ✅
```

---

#### **情况 2: Windows 路径分隔符**

```typescript
// Windows 路径
['C:\\Users', 'C:\\Users\\yifeng']

// path.sep 在 Windows 上是 '\\'
'C:\\Users\\yifeng'.startsWith('C:\\Users' + '\\')  → true  ✅
```

**跨平台兼容性**：
- ✅ 使用 `path.sep` 而不是硬编码 `'/'`
- ✅ `path.resolve()` 自动处理不同平台的路径格式

---

#### **情况 3: 相似但不相关的路径**

```typescript
// 容易误判的场景
['/usr', '/usr-local', '/users']

// 正确的判断
'/usr-local'.startsWith('/usr' + '/')  → false  ✅ （不是子目录）
'/users'.startsWith('/usr' + '/')      → false  ✅ （不是子目录）

// 结果
['/usr', '/usr-local', '/users']  ✅ 全部保留
```

---

#### **情况 4: 空路径或无效路径**

```typescript
// 输入包含空字符串
['', '/Users', null]

// 处理
paths.filter(p => p && typeof p === 'string')
  .map(p => path.resolve(p))

// 结果
['/Users']  ✅
```

---

#### **情况 5: 重复路径**

```typescript
// 输入
['/Users', '/Users', '/Users']

// 处理后
['/Users']  ✅ （自动去重）
```

---

## 🧪 **测试用例**

### **测试 1: 基本父子关系**

```typescript
const input = ['/', '/Users', '/Users/yifeng'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/']
// 原因: '/Users' 和 '/Users/yifeng' 都是 '/' 的子目录
```

---

### **测试 2: 多层嵌套**

```typescript
const input = ['/a/b/c/d', '/a/b/c', '/a/b', '/a'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/a']
// 原因: 所有路径都是 '/a' 的子目录
```

---

### **测试 3: 部分重叠**

```typescript
const input = ['/Users', '/Users/yifeng/Documents', '/Documents'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/Users', '/Documents']
// 原因: '/Users/yifeng/Documents' 是 '/Users' 的子目录
```

---

### **测试 4: 无重叠**

```typescript
const input = ['/Users', '/Applications', '/Library'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/Users', '/Applications', '/Library']
// 原因: 三个路径互不包含
```

---

### **测试 5: 相似路径（边界情况）**

```typescript
const input = ['/usr', '/usr-local', '/users', '/usr/lib'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/usr', '/usr-local', '/users']
// 原因:
// - '/usr/lib' 是 '/usr' 的子目录 → 去除
// - '/usr-local' 不是 '/usr' 的子目录 → 保留
// - '/users' 不是 '/usr' 的子目录 → 保留
```

---

### **测试 6: Windows 路径**

```typescript
const input = ['C:\\Users', 'C:\\Users\\yifeng', 'D:\\Data'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['C:\\Users', 'D:\\Data']
// 原因: 'C:\\Users\\yifeng' 是 'C:\\Users' 的子目录
```

---

### **测试 7: 相对路径**

```typescript
const input = ['./Documents', '../Users', '/absolute/path'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: 取决于当前工作目录
// path.resolve() 会转换为绝对路径
```

---

### **测试 8: 空输入**

```typescript
const input = [];
const output = deduplicatePaths(input);

console.log(output);
// 期望: []
```

---

### **测试 9: 单一路径**

```typescript
const input = ['/Users'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/Users']
```

---

### **测试 10: 重复路径**

```typescript
const input = ['/Users', '/Users', '/Users'];
const output = deduplicatePaths(input);

console.log(output);
// 期望: ['/Users']
```

---

## 📊 **性能分析**

### **时间复杂度**

```
O(n² × m)

n = 路径数量
m = 平均路径长度

最坏情况: 所有路径都互不包含
- 外层循环: n 次
- 内层循环: 最多 n 次
- startsWith 检查: O(m)
```

**实际性能**：
- 通常 n < 10（用户很少选择超过 10 个路径）
- m < 200（路径长度通常很短）
- 总计算量: 10² × 200 = 20,000 次操作
- **耗时**: < 1ms

---

### **空间复杂度**

```
O(n)

- normalized 数组: n 个字符串
- result 数组: 最多 n 个字符串
```

**内存占用**：
- n = 10 个路径
- 每个路径平均 50 字节
- 总内存: 10 × 50 × 2 = 1KB
- **可忽略不计**

---

## 🔍 **日志输出**

### **成功场景**

```typescript
log.info(`[路径清理] 原始路径: ${paths.length}, 清理后: ${result.length}`);
log.info(`[路径清理] 清理结果: ${result.join(', ')}`);

// 示例输出
// [路径清理] 原始路径: 5, 清理后: 2
// [路径清理] 清理结果: /, /Documents
```

---

### **移除子目录**

```typescript
log.info(`[路径清理] 移除子目录: ${currentPath} (父目录: ${selectedPath})`);

// 示例输出
// [路径清理] 移除子目录: /Users/yifeng (父目录: /Users)
// [路径清理] 移除子目录: /Users (父目录: /)
```

---

### **错误场景**

```typescript
if (cleanedPaths.length === 0) {
    log.error('[路径清理] 错误: 清理后没有有效路径');
    sendToMainWindow(mainWindow, 'scan-error', '没有有效的扫描路径');
    return;
}

// 示例输出
// [路径清理] 错误: 清理后没有有效路径
```

---

## ⚠️ **注意事项**

### **1. 不要过度清理**

```typescript
// ❌ 错误: 将不相关的路径也清理掉
['/usr/local', '/usr/lib']
  → ['/usr']  // 错误！这两个路径互不包含

// ✅ 正确: 只清理真正的子目录
['/usr/local', '/usr/lib']
  → ['/usr/local', '/usr/lib']  // 正确
```

---

### **2. 路径分隔符的重要性**

```typescript
// ❌ 错误: 不使用路径分隔符
'/usr-local'.startsWith('/usr')  → true  // 误判！

// ✅ 正确: 使用路径分隔符
'/usr-local'.startsWith('/usr' + path.sep)  → false  // 正确
```

---

### **3. 跨平台兼容性**

```typescript
// ✅ 使用 Node.js 的 path 模块
import * as path from 'path';

path.resolve('/Users');      // macOS/Linux: '/Users', Windows: 'C:\\Users'
path.sep;                     // macOS/Linux: '/', Windows: '\\'
```

---

### **4. 符号链接的处理**

```typescript
// 路径清理不负责处理符号链接
// 符号链接过滤在 walker-worker.ts 中进行

// 示例
const input = ['/real/path', '/symlink/to/path'];
const output = deduplicatePaths(input);

// 即使两个路径指向同一个地方，也会都保留
// 因为从字符串角度看，它们不是父子关系
// → ['/real/path', '/symlink/to/path']

// 真正的去重在 seenFiles Set 中完成（基于 realpath）
```

---

## 🎯 **与其他方案的配合**

### **三层防御体系**

```
┌─────────────────────────────────────┐
│ 第一层: 路径清理 (deduplicatePaths) │
│ - 去除明显的父子关系                │
│ - 减少不必要的遍历                  │
│ - 性能提升: 30-50%                  │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 第二层: 符号链接过滤 (walker)       │
│ - follow_symlinks: false            │
│ - 跳过 symlink 文件                 │
│ - 避免循环引用                      │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 第三层: seenFiles Set (去重)        │
│ - 处理硬链接                        │
│ - 处理挂载点                        │
│ - 最后一道防线                      │
└─────────────────────────────────────┘
```

---

## 📝 **实施清单**

### **代码修改**

- [ ] 在 `src/scanner.ts` 中添加 `deduplicatePaths` 函数
- [ ] 修改 `startScan` 函数，调用路径清理
- [ ] 添加日志输出，便于调试
- [ ] 在 `walker-worker.ts` 中增强符号链接过滤
- [ ] 实现 `seenFiles` 重置机制

### **测试验证**

- [ ] 单元测试：10 个测试用例全部通过
- [ ] 集成测试：扫描真实目录
- [ ] 性能测试：对比优化前后的遍历时间
- [ ] 内存测试：监控 `seenFiles` 的内存占用

### **文档更新**

- [ ] 更新 README.md，说明路径清理功能
- [ ] 更新 CHANGELOG.md，记录新功能
- [ ] 添加用户指南，说明如何选择扫描路径

---

## 🔗 **相关文件**

- **主扫描器**: `src/scanner.ts`
- **Walker Worker**: `src/walker-worker.ts`
- **待办清单**: `docs/WINDOWS_MEMORY_LEAK_FIX_TODO.md`
- **审查报告**: `docs/FIX_REVIEW_CORRECTIONS.md`

---

**最后更新**: 2026-05-06  
**作者**: AI Assistant  
**审核人**: _______________
