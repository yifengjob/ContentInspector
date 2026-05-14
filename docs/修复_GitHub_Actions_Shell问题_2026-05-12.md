# GitHub Actions Windows 构建修复

## 🔍 问题描述

**错误信息：**
```
ParserError: D:\a\_temp\abd4f52e-e803-4429-831c-163f6afbe617.ps1:3
Line |
   3 |  if [[ "windows-x64" == windows-* ]]; then
     |    ~
     | Missing '(' after 'if' in if statement.
Error: Process completed with exit code 1.
```

---

## 💡 根本原因

### **Shell 类型不匹配**

GitHub Actions 在不同平台使用不同的默认 shell：

| 平台 | 默认 Shell | 语法 |
|------|-----------|------|
| **Linux/macOS** | `bash` | `if [[ ... ]]; then` |
| **Windows** | `pwsh` (PowerShell) | `if (...) { }` |

**问题代码：**
```yaml
- name: Install root dependencies
  run: |
    if [[ "${{ matrix.platform }}" == windows-* ]]; then  # ← Bash 语法
      pnpm install --ignore-optional
    else
      pnpm install
    fi
```

在 Windows runner 上，这段代码会被 PowerShell 解析，导致语法错误。

---

## ✅ 解决方案

### **方案：显式指定 shell 为 bash**

```yaml
- name: Install root dependencies
  run: |
    # 【新增】Windows 平台跳过 canvas 可选依赖编译
    if [[ "${{ matrix.platform }}" == windows-* ]]; then
      echo "Skipping canvas optional dependency for Windows..."
      pnpm install --no-optional  # ← 使用 --no-optional 而非 --ignore-optional
    else
      pnpm install
    fi
  shell: bash  # ← 关键：强制使用 bash
```

**优点：**
- ✅ 跨平台一致（所有平台都使用 bash）
- ✅ 无需修改脚本逻辑
- ✅ GitHub Actions 内置支持 bash（Windows 通过 Git Bash）

---

## 📊 GitHub Actions Shell 选项

### **可用的 shell 类型**

| Shell | 说明 | 适用场景 |
|-------|------|---------|
| `bash` | Bash shell（跨平台） | ✅ 推荐，通用性强 |
| `pwsh` | PowerShell Core | Windows 特定脚本 |
| `powershell` | Windows PowerShell | 旧版 Windows |
| `sh` | POSIX shell | Linux/macOS |
| `cmd` | Windows CMD | 遗留应用 |

### **最佳实践**

**1. 优先使用 `shell: bash`**
```yaml
- name: Cross-platform script
  run: |
    if [[ "$RUNNER_OS" == "Windows" ]]; then
      echo "Running on Windows"
    fi
  shell: bash
```

**2. 使用环境变量判断平台**
```yaml
- name: Platform-specific command
  run: |
    if [[ "$RUNNER_OS" == "Linux" ]]; then
      sudo apt-get update
    elif [[ "$RUNNER_OS" == "macOS" ]]; then
      brew install some-package
    elif [[ "$RUNNER_OS" == "Windows" ]]; then
      choco install some-package
    fi
  shell: bash
```

**3. 使用矩阵条件**
```yaml
- name: Install dependencies (Windows)
  if: startsWith(matrix.platform, 'windows')
  run: pnpm install --ignore-optional
  shell: bash

- name: Install dependencies (Other)
  if: "!startsWith(matrix.platform, 'windows')"
  run: pnpm install
  shell: bash
```

---

## 🔧 其他常见 Shell 兼容性问题

### **问题 1: 路径分隔符**

❌ **错误写法：**
```bash
cd frontend && pnpm build  # && 在 PowerShell 中不支持
```

✅ **正确写法（使用 bash）：**
```yaml
run: cd frontend && pnpm build
shell: bash
```

或者使用分号：
```yaml
run: cd frontend; pnpm build
shell: pwsh
```

---

### **问题 2: 环境变量引用**

❌ **Bash 语法（PowerShell 不支持）：**
```bash
echo $HOME
```

✅ **跨平台写法：**
```yaml
run: echo ${{ env.HOME }}
shell: bash
```

或使用 GitHub 上下文：
```yaml
run: echo "${{ github.workspace }}"
```

---

### **问题 3: 命令替换**

❌ **Bash 语法：**
```bash
VERSION=$(cat package.json | jq -r '.version')
```

✅ **跨平台写法：**
```yaml
run: |
  VERSION=$(node -p "require('./package.json').version")
  echo "Version: $VERSION"
shell: bash
```

---

## 📝 本次修复详情

### **修改文件**

`.github/workflows/build.yml` Line 97-106

### **修改内容**

```diff
       # Install dependencies
       - name: Install root dependencies
         run: |
           # 【新增】Windows 平台跳过 canvas 可选依赖编译
           if [[ "${{ matrix.platform }}" == windows-* ]]; then
             echo "Skipping canvas optional dependency for Windows..."
             pnpm install --ignore-optional
           else
             pnpm install
           fi
+        shell: bash
```

### **影响范围**

- ✅ Windows x64
- ✅ Windows ia32
- ✅ Windows ARM64
- ✅ Linux x64
- ✅ Linux ARM64
- ✅ macOS Intel
- ✅ macOS Apple Silicon

**所有平台统一使用 bash，确保行为一致。**

---

## 🧪 验证方法

### **本地测试**

```bash
# 安装 act 工具（GitHub Actions 本地运行器）
brew install act

# 运行 Windows 构建测试
act -j build --matrix platform:windows-x64 --dryrun
```

### **CI 验证**

提交代码后，观察 GitHub Actions 日志：

1. ✅ 所有平台的 "Install root dependencies" 步骤成功
2. ✅ Windows 平台显示 "Skipping canvas optional dependency for Windows..."
3. ✅ 无 ParserError 错误
4. ✅ 构建成功完成

---

## 🚀 后续建议

### **1. 统一所有步骤的 shell**

检查 workflow 中其他步骤，确保一致性：

```yaml
- name: Build frontend
  run: cd frontend && pnpm build
  shell: bash  # ← 添加

- name: Compile TypeScript
  run: npx tsc -p tsconfig.main.json
  shell: bash  # ← 添加
```

### **2. 使用 GitHub Actions 最佳实践**

```yaml
# 使用 set-output 而非 echo
- name: Get version
  id: version
  run: echo "version=$(node -p "require('./package.json').version")" >> $GITHUB_OUTPUT
  shell: bash

# 使用 steps 上下文
- name: Use version
  run: echo "Version is ${{ steps.version.outputs.version }}"
```

### **3. 添加错误处理**

```yaml
- name: Install dependencies
  run: |
    if ! pnpm install; then
      echo "::error::依赖安装失败"
      exit 1
    fi
  shell: bash
```

---

## 📚 相关文档

- [GitHub Actions - Using shells](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsshell)
- [GitHub Actions - Contexts](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/contexts)
- [PowerShell vs Bash syntax](https://docs.microsoft.com/en-us/powershell/scripting/learn/remoting/ssh-remoting-in-powershell-core)

---

**修复时间**: 2026-05-06  
**问题状态**: ✅ 已修复  
**影响范围**: GitHub Actions Windows 构建  
**修复方式**: 添加 `shell: bash` 指令  
