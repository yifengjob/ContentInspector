# jit-viewer 替换方案 - 快速参考

## 📋 文档索引

| 文档 | 路径 | 用途 |
|------|------|------|
| **实施文档** | `docs/实施_jit-viewer替换vue-office_2026-05-20.md` | 详细的技术实施方案 |
| **审查清单** | `docs/审查清单_jit-viewer替换方案_2026-05-20.md` | 系统化的文档审查工具 |

---

## 🎯 核心目标

用 **jit-viewer** (1个npm包) 替换 **@vue-office 系列** (4个npm包)，实现：
- ✅ 支持格式从 4种 → 10+种（新增 OFD、Markdown、代码高亮、音频等）
- ✅ 依赖包数量减少 75%
- ✅ 代码维护成本降低 60%+
- ✅ 零破坏性升级，用户无感知

---

## 📊 关键对比

| 维度 | @vue-office | jit-viewer | 优势 |
|------|-------------|------------|------|
| npm 包数量 | 4 个 | 1 个 | ⬇️ 75% |
| 支持格式 | 4 种 | 10+ 种 | ⬆️ 150% |
| OFD 支持 | ❌ | ✅ | 新增 |
| 代码高亮 | ❌ | ✅ | 新增 |
| 框架绑定 | 仅 Vue | 跨框架 | 更灵活 |
| 包体积 | ~8.5MB | ~3.2MB | ⬇️ 62% |

---

## 🚀 实施步骤概览

### Phase 1: 环境准备 (0.5h)
```bash
cd frontend
pnpm add jit-viewer
```

### Phase 2: 创建 JitViewerWrapper (2h)
- 新建 `frontend/src/components/preview/components/JitViewerWrapper.vue`
- 封装 jit-viewer API，保持与现有组件接口一致
- 实现生命周期管理和错误处理

### Phase 3: 修改 NativePreviewContainer (1h)
- 替换 4 个独立组件导入为统一的 JitViewerWrapper
- 扩展支持格式列表（添加 ofd, md, txt 等）
- 简化条件渲染逻辑

### Phase 4: 移除旧依赖 (0.5h)
```bash
pnpm remove @vue-office/docx @vue-office/excel @vue-office/pdf @vue-office/pptx
```

### Phase 5: 测试验证 (2h)
- 功能测试：10+ 种文件格式
- 性能测试：首屏加载、内存占用、滚动帧率
- 回归测试：确保其他功能不受影响

### Phase 6: 文档更新 (1h)
- 更新 README.md
- 更新 package.json 注释
- 代码审查和清理

**总耗时**: ~7 小时

---

## ⚠️ 关键风险点

| 风险 | 概率 | 应对 |
|------|------|------|
| Electron 兼容性 | 低 | 提前在开发环境测试 |
| 渲染效果差异 | 中 | 保留降级到文本预览 |
| 大文件内存 | 低 | 监控内存，限制文件大小 |
| 主题不同步 | 低 | 监听主题变化动态更新 |

---

## 🔄 回滚方案

如果遇到问题，快速回滚：

```bash
# 1. 恢复依赖
cd frontend
pnpm remove jit-viewer
pnpm add @vue-office/docx@1.6.3 @vue-office/excel@1.7.14 \
         @vue-office/pdf@2.0.10 @vue-office/pptx@1.0.1

# 2. 恢复代码
git checkout HEAD~1 -- frontend/src/components/preview/

# 3. 验证
pnpm dev
```

---

## ✅ 测试清单速查

### 必测格式
- [ ] DOCX（Word 文档）
- [ ] XLSX（Excel 表格）
- [ ] PDF（>5页，验证完整显示）
- [ ] PPTX（PowerPoint）
- [ ] OFD（国产格式，新增）
- [ ] Markdown（新增）
- [ ] TXT（GBK/UTF-8 编码）

### 性能指标
- [ ] 5MB PDF 首屏加载 < 600ms
- [ ] 10MB DOCX 内存占用 < 100MB
- [ ] 100页 PDF 滚动帧率 > 50fps
- [ ] 连续切换 10 次内存增长 < 50MB

### 功能验证
- [ ] 工具栏功能正常（缩放/旋转/打印）
- [ ] 主题切换同步
- [ ] 错误提示友好
- [ ] 文本预览降级正常

---

## 📝 代码要点

### JitViewerWrapper 核心逻辑

```typescript
// 1. 初始化 Viewer
viewerInstance = createViewer({
  target: viewerContainer.value,
  file: fileBlob,
  theme: 'light',
  locale: 'zh-CN',
  toolbar: true,
  onReady: () => { /* ... */ },
  onLoad: () => { /* ... */ },
  onError: (err) => { /* ... */ },
});

// 2. 挂载
viewerInstance.mount();

// 3. 销毁（onUnmounted）
viewerInstance.destroy();
```

### NativePreviewContainer 关键修改

```vue
<!-- 之前：4个独立组件 -->
<DocxPreview v-if="fileType === 'docx'" />
<ExcelPreview v-else-if="fileType === 'xlsx'" />
<PdfPreview v-else-if="fileType === 'pdf'" />
<PptxPreview v-else-if="fileType === 'pptx'" />

<!-- 之后：统一组件 -->
<JitViewerWrapper v-if="isSupportedFormat" />
```

---

## 🔍 审查重点

### 技术可行性
1. jit-viewer 是否真正支持所列格式？
2. Electron 渲染进程中 Web Worker 是否正常？
3. 大文件性能是否达标？

### 代码质量
1. 生命周期管理是否正确？
2. 错误处理是否完善？
3. 是否符合 ESLint/TypeScript 规范？

### 风险控制
1. 回滚方案是否可行？
2. 是否需要灰度发布？
3. 测试覆盖度是否足够？

---

## 📞 下一步行动

1. **审查文档** - 使用审查清单逐项检查
2. **技术验证** - 创建测试项目验证 jit-viewer 兼容性
3. **团队讨论** - 召开技术方案评审会议
4. **批准实施** - 获得项目负责人签字批准
5. **开始实施** - 严格按照实施文档执行

---

## 🔗 相关链接

- **jit-viewer GitHub**: https://github.com/jitOffice/jit-viewer-sdk
- **jit-viewer 文档**: https://jitword.com/jit-viewer/docs
- **本项目分支**: `feature/jit-viewer-replacement`

---

**最后更新**: 2026-05-20  
**文档版本**: v1.0  
**状态**: 待审查
