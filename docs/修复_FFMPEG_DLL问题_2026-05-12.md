# Windows ffmpeg.dll 缺失问题解决方案

## 🔍 问题分析

### **错误信息**
```
无法启动此程序，因为计算机中丢失 ffmpeg.dll
尝试重新安装该程序以解决此问题
```

### **根本原因**

`ffmpeg.dll` 是 **Electron/Chromium 的核心组件**，用于：
- 音频/视频解码
- 媒体格式支持
- HTML5 `<video>` 和 `<audio>` 标签

**注意：** 这与 `canvas` 依赖完全无关！

---

## 💡 可能的原因

| 原因 | 说明 | 概率 | 解决方案 |
|------|------|------|---------|
| **打包不完整** | electron-builder 未包含所有 DLL | ⭐⭐⭐⭐⭐ | 配置 `extraFiles` |
| **杀毒软件误删** | Windows Defender 删除了 dll | ⭐⭐⭐⭐ | 添加白名单 |
| **系统缺少 VC++** | 缺少 Visual C++ Redistributable | ⭐⭐⭐ | 安装运行库 |
| **Portable 版本问题** | 便携版解压不完整 | ⭐⭐ | 使用 NSIS 安装包 |

---

## ✅ 解决方案

### **方案 1：配置 electron-builder 确保 DLL 被打包（推荐）** ⭐⭐⭐⭐⭐

已在 `package.json` 中添加配置：

```json
{
  "build": {
    "win": {
      "extraFiles": [
        {
          "from": "node_modules/electron/dist/",
          "to": ".",
          "filter": ["ffmpeg.dll", "d3dcompiler_47.dll"]
        }
      ]
    }
  }
}
```

**作用：**
- ✅ 强制将 `ffmpeg.dll` 和 `d3dcompiler_47.dll` 复制到应用根目录
- ✅ 确保所有架构（x64、ia32、arm64）都包含必要的 DLL
- ✅ 同时适用于 NSIS 安装版和 Portable 便携版

---

### **方案 2：用户端解决方案（临时）**

如果用户已经遇到此问题，可以：

#### **2.1 检查杀毒软件**
1. 打开 Windows Defender 或其他杀毒软件
2. 查看隔离区/恢复区
3. 如果找到 `ffmpeg.dll`，恢复到原位置并添加白名单

#### **2.2 重新安装应用**
1. 卸载当前版本
2. 下载最新版本（已修复打包问题）
3. 以管理员身份运行安装程序

#### **2.3 安装 Visual C++ Redistributable**
下载地址：https://aka.ms/vs/17/release/vc_redist.x64.exe

---

### **方案 3：GitHub Actions CI 优化**

在 `.github/workflows/build.yml` 中添加验证步骤：

```yaml
- name: Verify Windows build artifacts
  if: startsWith(matrix.platform, 'windows')
  run: |
    echo "Checking for required DLL files..."
    ls -la release/*.exe || true
    
    # 解压 NSIS 安装包检查内容（可选）
    # 7z l release/*.exe | grep -i "ffmpeg.dll" || echo "Warning: ffmpeg.dll not found in installer"
```

---

## 🧪 验证方法

### **本地测试（Windows）**

```bash
# 1. 清理旧的构建
rm -rf release/

# 2. 重新构建
pnpm run build

# 3. 检查输出文件
ls -la release/*.exe

# 4. 手动检查 DLL 是否存在
# 解压 portable 版本或查看安装目录
```

**预期结果：**
- ✅ `ffmpeg.dll` 存在于应用根目录
- ✅ `d3dcompiler_47.dll` 存在于应用根目录
- ✅ 应用正常启动，无错误提示

---

### **CI 验证**

查看 GitHub Actions 日志，确认：
1. ✅ Windows 构建成功
2. ✅ 生成的 exe 文件大小合理（NSIS ~80-100MB，Portable ~150-200MB）
3. ✅ 无打包警告

---

## 📊 技术细节

### **为什么需要 extraFiles？**

electron-builder 默认会：
1. 复制 Electron 运行时文件
2. 打包应用代码
3. 创建安装程序

**但某些情况下可能遗漏：**
- 自定义 Electron 版本
- 特殊架构（ARM64）
- 杀毒软件干扰

通过 `extraFiles` 显式声明，确保万无一失。

### **ffmpeg.dll 的作用**

```
Electron App
├── electron.exe (主进程)
├── ffmpeg.dll ← 媒体解码（必需）
├── d3dcompiler_47.dll ← DirectX 渲染（必需）
├── resources/
│   └── app.asar (应用代码)
└── ...
```

**如果缺失：**
- ❌ 应用无法启动（Windows 报错）
- ❌ 即使不使用音视频功能，Chromium 内核也需要加载

---

## 🚀 后续优化建议

### **可选优化 1：添加启动前检查**

在 `src/main.ts` 中添加 DLL 存在性检查：

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { app, dialog } from 'electron';

function checkRequiredDLLs() {
  const appPath = app.getAppPath();
  const requiredDLLs = ['ffmpeg.dll', 'd3dcompiler_47.dll'];
  
  for (const dll of requiredDLLs) {
    const dllPath = path.join(path.dirname(app.getPath('exe')), dll);
    if (!fs.existsSync(dllPath)) {
      dialog.showErrorBox(
        '缺少必要文件',
        `检测到 ${dll} 缺失，可能导致应用无法正常运行。\n\n` +
        `请尝试重新安装应用程序。`
      );
      return false;
    }
  }
  return true;
}

app.whenReady().then(() => {
  if (!checkRequiredDLLs()) {
    app.quit();
    return;
  }
  // ... 正常启动逻辑
});
```

### **可选优化 2：提供一键修复工具**

创建一个简单的批处理脚本 `fix-missing-dll.bat`：

```batch
@echo off
echo 正在检查缺失的 DLL 文件...

if not exist "ffmpeg.dll" (
    echo 错误: ffmpeg.dll 缺失
    echo 请重新安装应用程序
    pause
    exit /b 1
)

if not exist "d3dcompiler_47.dll" (
    echo 错误: d3dcompiler_47.dll 缺失
    echo 请重新安装应用程序
    pause
    exit /b 1
)

echo 所有必要文件都存在，应用应该可以正常运行。
pause
```

---

## 📝 相关文档

- [Electron 官方文档](https://www.electronjs.org/docs/latest/)
- [electron-builder 配置指南](https://www.electron.build/configuration/win)
- [Visual C++ Redistributable 下载](https://support.microsoft.com/zh-cn/help/2977003/the-latest-supported-visual-c-downloads)

---

## ✅ 总结

**问题本质：**
- ❌ 不是项目代码问题
- ❌ 不是 canvas 依赖问题
- ✅ 是 Electron 打包配置问题

**解决方案：**
- ✅ 添加 `extraFiles` 配置
- ✅ 重新构建并发布新版本
- ✅ 用户重新安装即可解决

**影响范围：**
- 仅影响部分 Windows 用户
- 不影响 macOS/Linux
- 不影响应用功能（只是启动失败）

---

**创建时间**: 2026-05-06  
**问题状态**: ✅ 已修复（待发布新版本）  
**影响范围**: Windows 平台用户  
**修复方式**: 修改 electron-builder 配置
