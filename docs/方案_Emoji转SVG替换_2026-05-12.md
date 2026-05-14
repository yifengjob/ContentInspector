# Emoji → SVG 图标替换计划

## 📋 待替换文件清单

### ✅ 已完成
- [x] **PreviewModal.vue** - ℹ️ ⚠️ ❌ (错误状态图标 + 底部提示)

### ⏳ 待处理

#### 1. EnvironmentCheck.vue (5 处)
```
第 6 行:   🔍 系统环境检查 (标题)
第 25 行:  ✅ 成功图标
第 33 行:  ⚠️ 警告图标  
第 57 行:  📥 下载链接
第 67 行:  ❌ 错误图标
第 91 行:  📥 立即下载
```

**替换方案：**
```vue
<!-- 标题图标 -->
<h2>
  <svg class="title-icon" viewBox="0 0 24 24" width="24" height="24">
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor"/>
  </svg>
  系统环境检查
</h2>

<!-- 状态图标 -->
<div class="success-icon">
  <svg viewBox="0 0 24 24" width="32" height="32">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
  </svg>
</div>

<!-- 下载按钮 -->
<button>
  <svg viewBox="0 0 24 24" width="16" height="16">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
  </svg>
  下载链接
</button>
```

---

#### 2. ExportModal.vue (1 处)
```
第 12 行: ⚠️ 暂无扫描结果，无法导出报告
```

**替换方案：**
```vue
<p>
  <svg class="warning-icon-inline" viewBox="0 0 24 24" width="16" height="16">
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor"/>
  </svg>
  暂无扫描结果，无法导出报告
</p>
```

---

#### 3. SettingsModal.vue (1 处)
```
第 80 行: 🗑️ 清理应用缓存
```

**替换方案：**
```vue
<button>
  <svg viewBox="0 0 24 24" width="16" height="16">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
  </svg>
  清理应用缓存
</button>
```

---

#### 4. FileTypeFilter.vue (1 处)
```
第 5 行: ▶ ▼ 折叠箭头
```

**替换方案：**
```vue
<span class="collapse-icon">
  <svg v-if="collapsed" viewBox="0 0 24 24" width="12" height="12">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
  </svg>
  <svg v-else viewBox="0 0 24 24" width="12" height="12">
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/>
  </svg>
</span>
```

---

#### 5. TreeNode.vue (1 处)
```
第 13 行: ▼ ▶ 树节点展开箭头
```

**替换方案：**
```vue
<span class="expand-icon">
  <svg v-if="isExpanded" viewBox="0 0 24 24" width="12" height="12">
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/>
  </svg>
  <svg v-else viewBox="0 0 24 24" width="12" height="12">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
  </svg>
</span>
```

---

#### 6. App.vue (1 处)
```
第 111 行: ▶ ◀ 侧边栏折叠箭头
```

**替换方案：**
```vue
<button class="sidebar-toggle">
  <svg v-if="isSidebarCollapsed" viewBox="0 0 24 24" width="16" height="16">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
  </svg>
  <svg v-else viewBox="0 0 24 24" width="16" height="16">
    <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" fill="currentColor"/>
  </svg>
</button>
```

---

#### 7. DirectoryTree.vue (1 处 - JavaScript 代码)
```
第 213 行: if (expandIcon && expandIcon.textContent === '▶') {
```

**替换方案：**
需要修改判断逻辑，改为检查 CSS class 或 data 属性：
```typescript
// 原代码
if (expandIcon && expandIcon.textContent === '▶') {

// 新代码（添加 data-expanded 属性）
if (expandIcon && expandIcon.getAttribute('data-expanded') === 'true') {
```

同时需要在模板中添加 `data-expanded` 属性。

---

## 🎨 SVG 图标尺寸规范

| 使用场景 | 尺寸 | 示例 |
|---------|------|------|
| 大图标（错误/成功状态） | 32-48px | EnvironmentCheck 状态图标 |
| 中等图标（标题） | 24px | EnvironmentCheck 标题 |
| 小图标（按钮内） | 16px | 下载、删除按钮 |
| 微小图标（箭头） | 12px | 折叠箭头 |

---

## 📝 CSS 样式建议

```css
/* 通用 SVG 图标样式 */
.svg-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

/* 内联图标（与文字同行） */
.icon-inline {
  width: 16px;
  height: 16px;
  margin-right: 6px;
}

/* 状态图标（独立显示） */
.icon-status {
  width: 32px;
  height: 32px;
  margin-bottom: 12px;
}

/* 标题图标 */
.icon-title {
  width: 24px;
  height: 24px;
  margin-right: 8px;
}

/* 箭头图标 */
.icon-arrow {
  width: 12px;
  height: 12px;
  transition: transform 0.2s ease;
}
```

---

## ⚠️ 注意事项

1. **currentColor 继承**：所有 SVG 使用 `fill="currentColor"`，自动继承父元素的 `color` 属性
2. **主题适配**：确保父元素设置了正确的颜色变量（如 `var(--text-secondary)`）
3. **无障碍**：为装饰性图标添加 `aria-hidden="true"`，功能性图标添加 `role="img"` 和 `<title>`
4. **性能**：SVG 内联在 HTML 中，避免额外的 HTTP 请求

---

## 🔄 批量替换脚本（可选）

如果需要自动化替换，可以使用以下正则表达式：

```bash
# 查找所有 emoji
grep -rn '[⚠️❌✅ℹ️🔍📁📄💾🗑️]' frontend/src --include="*.vue"

# 替换示例（需手动调整每个文件）
sed -i '' 's/⚠️/<svg viewBox="0 0 24 24" width="16" height="16"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor\/><\/svg>/g' file.vue
```

**建议**：由于每个文件的上下文不同，推荐手动替换以确保准确性。

---

## ✅ 验收标准

- [ ] 所有 emoji 已替换为 SVG
- [ ] 跨平台显示一致（Windows/macOS/Linux）
- [ ] 主题切换时颜色正确适配
- [ ] 图标尺寸合理，视觉层次清晰
- [ ] 编译无错误
- [ ] 功能测试通过

---

**创建时间**: 2026-05-06  
**预计工作量**: 30-60 分钟（手动替换 7 个文件）
