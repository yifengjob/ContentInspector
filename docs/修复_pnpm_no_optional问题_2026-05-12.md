# pnpm --no-optional 选项修复

## 🔍 问题描述

**错误信息：**
```
ERROR  Unknown option: 'ignore-optional'
Did you mean 'ignore-pnpmfile', or 'ignore-scripts', or 'optional'?
For help, run: pnpm help install
Error: Process completed with exit code 1.
```

---

## 💡 根本原因

### **pnpm 与 npm/yarn 的命令差异**

| 包管理器 | 跳过可选依赖的命令 |
|---------|------------------|
| **npm** | `npm install --no-optional` 或 `npm install --omit=optional` |
| **yarn** | `yarn install --ignore-optional` |
| **pnpm** | `pnpm install --no-optional` ✅ |

**错误原因：**
- ❌ 使用了 yarn 的语法 `--ignore-optional`
- ✅ pnpm 的正确语法是 `--no-optional`

---

## ✅ 修复方案

### **修改前（错误）**

```yaml
- name: Install root dependencies
  run: |
    if [[ "${{ matrix.platform }}" == windows-* ]]; then
      echo "Skipping canvas optional dependency for Windows..."
      pnpm install --ignore-optional  # ❌ pnpm 不支持此选项
    else
      pnpm install
    fi
  shell: bash
```

### **修改后（正确）**

```yaml
- name: Install root dependencies
  run: |
    if [[ "${{ matrix.platform }}" == windows-* ]]; then
      echo "Skipping canvas optional dependency for Windows..."
      pnpm install --no-optional  # ✅ pnpm 正确选项
    else
      pnpm install
    fi
  shell: bash
```

---

## 📊 pnpm install 常用选项

### **依赖相关选项**

| 选项 | 说明 | 示例 |
|------|------|------|
| `--no-optional` | 不安装 optionalDependencies | `pnpm install --no-optional` |
| `--prod` | 只安装 dependencies | `pnpm install --prod` |
| `--dev` | 只安装 devDependencies | `pnpm install --dev` |
| `--frozen-lockfile` | 严格使用 lockfile，不允许更新 | `pnpm install --frozen-lockfile` |
| `--prefer-offline` | 优先使用缓存 | `pnpm install --prefer-offline` |
| `--offline` | 完全离线模式 | `pnpm install --offline` |

### **其他常用选项**

| 选项 | 说明 |
|------|------|
| `--ignore-scripts` | 不执行 postinstall 等脚本 |
| `--shamefully-hoist` | 提升所有依赖（类似 npm） |
| `--filter <package>` | 只安装指定包 |
| `--recursive` | 递归安装 monorepo 所有包 |

---

## 🎯 --no-optional 的作用

### **什么是 optionalDependencies？**

在 `package.json` 中：

```json
{
  "dependencies": {
    "pdfjs-dist": "3.11.174"
  },
  "optionalDependencies": {
    "canvas": "^2.11.2"  // ← 可选依赖
  }
}
```

**特点：**
- ✅ 如果安装失败，不会导致整个安装失败
- ✅ 通常用于平台特定的优化（如性能增强）
- ⚠️ 缺失时，功能可能降级但不影响核心功能

### **我们的场景**

```
pdfjs-dist@3.11.174
├── 核心功能：PDF 文本提取 ✅
└── 可选依赖：canvas（用于渲染）❌ 我们不需要

使用 --no-optional：
✅ 跳过 canvas 安装
✅ 避免 Windows 编译错误
✅ PDF 文本提取功能正常
```

---

## 🧪 验证方法

### **本地测试**

```bash
# 测试 --no-optional 选项
pnpm install --no-optional

# 检查是否安装了 canvas
pnpm ls canvas
# 应该显示：未安装或不在依赖树中

# 验证 pdfjs-dist 正常工作
node -e "const pdfjs = require('pdfjs-dist'); console.log('PDF.js:', pdfjs.version);"
# 输出：PDF.js: 3.11.174
```

---

### **CI 验证**

提交后观察 GitHub Actions 日志：

**预期输出（Windows）：**
```
Run # 【新增】Windows 平台跳过 canvas 可选依赖编译
Skipping canvas optional dependency for Windows...
Progress: resolved 399, reused 399, downloaded 0, added 399, done
Done in 15.2s using pnpm v10.33.0
```

**关键点：**
- ✅ 无 ERROR 信息
- ✅ 安装成功完成
- ✅ 速度快（从缓存恢复）

---

## 📝 npm vs pnpm vs yarn 对比

### **跳过可选依赖的命令**

```bash
# npm (v7+)
npm install --omit=optional        # 推荐
npm install --no-optional          # 也支持

# npm (v6)
npm install --no-optional

# yarn
yarn install --ignore-optional

# pnpm
pnpm install --no-optional         # ✅ 唯一正确的写法
```

### **其他常见命令对比**

| 操作 | npm | yarn | pnpm |
|------|-----|------|------|
| 安装包 | `npm install pkg` | `yarn add pkg` | `pnpm add pkg` |
| 移除包 | `npm uninstall pkg` | `yarn remove pkg` | `pnpm remove pkg` |
| 全局安装 | `npm install -g pkg` | `yarn global add pkg` | `pnpm add -g pkg` |
| 运行脚本 | `npm run script` | `yarn run script` | `pnpm run script` |
| 清理缓存 | `npm cache clean --force` | `yarn cache clean` | `pnpm store prune` |

---

## ⚠️ 注意事项

### **1. --no-optional 的影响范围**

```yaml
# 只影响当前项目的 optionalDependencies
pnpm install --no-optional

# 不会影响：
# ✅ dependencies（必须安装）
# ✅ devDependencies（开发时必须）
# ❌ optionalDependencies（跳过）
```

### **2. 何时使用 --no-optional**

**适用场景：**
- ✅ CI/CD 环境（加快构建速度）
- ✅ 可选依赖编译失败（如 canvas 在 Windows）
- ✅ 不需要可选功能

**不适用场景：**
- ❌ 需要可选依赖提供的优化
- ❌ 生产环境需要最佳性能
- ❌ 可选依赖是核心功能的一部分

### **3. 与其他选项的组合**

```bash
# 组合使用（常见于 CI）
pnpm install --no-optional --frozen-lockfile --prefer-offline

# 解释：
# --no-optional: 跳过可选依赖
# --frozen-lockfile: 严格使用 lockfile
# --prefer-offline: 优先使用缓存
```

---

## 🔧 项目中的实际应用

### **当前配置**

`.github/workflows/build.yml`:

```yaml
- name: Install root dependencies
  run: |
    if [[ "${{ matrix.platform }}" == windows-* ]]; then
      echo "Skipping canvas optional dependency for Windows..."
      pnpm install --no-optional  # Windows 跳过 canvas
    else
      pnpm install                 # 其他平台正常安装
    fi
  shell: bash
```

**效果：**
- ✅ Windows: 跳过 canvas，避免编译错误
- ✅ Linux/macOS: 正常安装所有依赖
- ✅ 跨平台一致性：都使用 bash

---

## 📚 相关文档

- [pnpm install 官方文档](https://pnpm.io/cli/install)
- [npm optionalDependencies](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies)
- [GitHub Actions caching](https://docs.github.com/en/actions/writing-workflows/caching-dependencies-to-speed-up-workflows)

---

## ✅ 总结

**问题**: pnpm 不支持 `--ignore-optional` 选项  
**原因**: 混淆了 yarn 和 pnpm 的命令语法  
**修复**: 使用 `pnpm install --no-optional`  
**影响**: Windows 平台构建将成功跳过 canvas 可选依赖  

**正确的 pnpm 命令：**
```bash
pnpm install --no-optional  # ✅ 正确
pnpm install --ignore-optional  # ❌ 错误
```

---

**修复时间**: 2026-05-06  
**修改文件**: `.github/workflows/build.yml`  
**状态**: ✅ 已修复  
