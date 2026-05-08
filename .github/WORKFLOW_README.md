# GitHub Actions CI/CD 配置说明

## 📋 概述

本项目已配置 GitHub Actions 自动构建和发布流程，支持：
- ✅ macOS (.dmg, .zip)
- ✅ Windows (.exe - NSIS 安装版和便携版)
- ✅ Linux (.AppImage, .deb)

---

## 🚀 触发条件

### 1. Push 到 main 分支
- 自动构建所有平台
- 上传构建产物作为 Artifacts
- **不会**创建 Release

### 2. 推送 Tag (如 v1.0.6)
- 自动构建所有平台
- 上传构建产物作为 Artifacts
- **自动创建 GitHub Release** 并附加安装包

### 3. Pull Request
- 自动构建所有平台
- 用于测试 PR 是否能成功构建
- **不会**创建 Release

---

## 📦 构建产物

### Artifacts (保留30天)

每次构建都会生成 Artifacts，可以在 GitHub Actions 页面下载：

- `macos-build` - macOS 安装包
- `windows-build` - Windows 安装包
- `linux-build` - Linux 安装包

### GitHub Releases (永久保存)

当推送 tag 时（如 `v1.0.6`），会自动创建 Release 并附加：

#### macOS
- `DataGuard Scanner x.x.x.dmg` - DMG 安装文件
- `DataGuard Scanner x.x.x.zip` - ZIP 压缩包

#### Windows
- `DataGuard Scanner Setup x.x.x.exe` - NSIS 安装程序
- `DataGuard Scanner x.x.x portabl.exe` - 便携版（无需安装）

#### Linux
- `DataGuard Scanner x.x.x.AppImage` - AppImage 通用格式
- `DataGuard Scanner_x.x.x_amd64.deb` - Debian/Ubuntu 安装包

---

## 🔧 使用方法

### 方法 1: 通过 Tag 发布（推荐）

```bash
# 1. 更新版本号
# 编辑 package.json: "version": "1.0.6"

# 2. 提交更改
git add package.json
git commit -m "chore: bump version to 1.0.6"

# 3. 创建并推送 tag
git tag v1.0.6
git push origin v1.0.6

# 4. 等待 GitHub Actions 完成构建
# 访问: https://github.com/yourusername/DataGuardScanner/actions
```

GitHub 会自动：
1. 在三个平台（macOS, Windows, Linux）上并行构建
2. 创建一个新的 Release
3. 上传所有安装包到 Release

### 方法 2: 仅构建（不发布）

```bash
# 推送到 main 分支会触发构建
git push origin main

# 构建完成后，在 Actions 页面下载 Artifacts
```

---

## ⚙️ 配置说明

### 工作流文件位置

```
.github/workflows/build.yml
```

### 关键配置

#### Node.js 版本
```yaml
node-version: '18'
```
与 Electron 22 兼容

#### pnpm 版本
```yaml
pnpm: 10.33.0
```
与项目配置一致

#### 缓存优化
使用 pnpm store 缓存加速依赖安装

#### 并行构建
三个平台的构建同时运行，节省时间

---

## 🔐 安全配置

### GITHUB_TOKEN

工作流使用自动生成的 `GITHUB_TOKEN` 来：
- 上传 Artifacts
- 创建 Release

**无需手动配置**，GitHub 会自动提供。

### 权限设置

```yaml
permissions:
  contents: write
```

允许工作流写入仓库内容（创建 Release）。

---

## 📊 构建状态

### 查看构建进度

1. 访问仓库的 **Actions** 标签页
2. 点击最近的工作流运行
3. 查看各个步骤的状态

### 构建失败排查

如果构建失败：

1. **检查日志**
   - 点击失败的步骤
   - 查看详细错误信息

2. **常见问题**
   - ❌ 依赖安装失败 → 检查 pnpm-lock.yaml
   - ❌ TypeScript 编译错误 → 本地运行 `npx tsc -p tsconfig.main.json`
   - ❌ 前端构建失败 → 本地运行 `pnpm build:renderer`
   - ❌ 图标文件缺失 → 确认 build/icons 目录有 icon.ico, icon.icns, icon.png

3. **本地测试**
   ```bash
   # 模拟 CI 环境
   rm -rf node_modules dist frontend/dist
   pnpm install
   pnpm build
   ```

---

## 🎯 最佳实践

### 1. 版本号管理

在 `package.json` 中维护版本号：

```json
{
  "name": "DataGuardScanner",
  "version": "1.0.6",  // ← 修改这里
  ...
}
```

### 2. Tag 命名规范

使用语义化版本：

```bash
git tag v1.0.6      # ✅ 正确
git tag 1.0.6       # ❌ 缺少 v 前缀
git tag v1.0.6-beta # ✅ 预发布版本
```

### 3. Release Notes

GitHub 会自动生成 Release Notes，包含：
- 自上一个版本以来的所有 commits
- 贡献者列表
- 变更的文件统计

您也可以手动编辑 Release Notes。

### 4. 预发布版本

对于测试版本：

```bash
git tag v1.0.6-beta.1
git push origin v1.0.6-beta.1
```

工作流会自动标记为 "Pre-release"。

---

## 🔄 自定义配置

### 修改触发条件

编辑 `.github/workflows/build.yml`：

```yaml
on:
  push:
    branches: [main, develop]  # 添加更多分支
    tags:
      - 'v*'
```

### 添加代码签名

如果需要代码签名，添加环境变量：

```yaml
env:
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

在 GitHub Secrets 中配置证书。

### 添加通知

构建完成后发送通知：

```yaml
- name: Notify on success
  if: success()
  uses: slackapi/slack-github-action@v1
  with:
    channel-id: 'builds'
    slack-message: "Build succeeded!"
  env:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

---

## 📈 性能优化

### 当前优化措施

1. ✅ **pnpm 缓存** - 加速依赖安装
2. ✅ **并行构建** - 三个平台同时构建
3. ✅ **增量编译** - TypeScript 只编译变化的文件

### 预计构建时间

- macOS: ~5-8 分钟
- Windows: ~3-5 分钟
- Linux: ~3-5 分钟

总时间取决于最慢的平台（通常是 macOS）。

---

## ❓ 常见问题

### Q1: 如何只构建特定平台？

注释掉其他平台的 job：

```yaml
jobs:
  build-macos:
    # ...
  
  # build-windows:  # 注释掉
  #   ...
  
  # build-linux:  # 注释掉
  #   ...
```

### Q2: 构建失败后如何重试？

在 Actions 页面点击 **"Re-run jobs"** 按钮。

### Q3: 如何删除旧的 Artifacts？

Artifacts 会在 30 天后自动删除，或手动在 Actions 页面删除。

### Q4: 可以本地测试工作流吗？

可以使用 [act](https://github.com/nektos/act) 工具：

```bash
# 安装 act
brew install act

# 运行工作流
act push
```

### Q5: 如何跳过某次构建？

在 commit message 中添加：

```bash
git commit -m "fix: some fix [skip ci]"
```

---

## 📞 技术支持

如果遇到问题：

1. 查看 [GitHub Actions 文档](https://docs.github.com/en/actions)
2. 查看 [electron-builder 文档](https://www.electron.build/)
3. 检查项目的 Issues 是否有类似问题

---

<div align="center">

**CI/CD 配置完成！现在可以自动化构建和发布了！** 🎉

</div>
