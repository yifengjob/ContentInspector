# 文档整理方案

## 📋 整理原则

1. **保留**：重要的技术文档、架构设计、实施记录
2. **合并**：主题相关的多个小文档
3. **删除**：临时调试文件、重复内容、过时信息
4. **移动**：所有技术文档统一放入 `docs/` 目录

---

## 📁 根目录 .md 文件分类

### ✅ 保留在根目录（项目级文档）

| 文件名 | 说明 | 操作 |
|--------|------|------|
| README.md | 项目主文档 | ✅ 保留 |
| LICENSE | 许可证 | ✅ 保留 |

### 📦 移动到 docs/ （技术文档）

#### A. PDF 相关文档（合并为一个）

| 原文件 | 新文件 | 说明 |
|--------|--------|------|
| PDF_OOM_FIX.md | docs/PDF_MEMORY_OPTIMIZATION.md | 合并以下文件 |
| PDF_OOM_TIMEOUT_ANALYSIS.md | ↑ | OOM 和超时分析 |
| TIMEOUT_FIX_REPORT.md | ↑ | 超时修复报告 |
| TIMEOUT_OOM_ROOT_CAUSE_ANALYSIS.md | ↑ | 根本原因分析 |
| PDF_PARSER_REPLACEMENT_PLAN.md | ↑ | pdfreader 替换方案 |

**新文件结构**：
```markdown
# PDF 内存优化完整指南

## 1. 问题背景
- OOM 崩溃现象
- 超时问题分析

## 2. 根本原因
- pdf-parse 内存泄漏
- Native 内存累积

## 3. 解决方案演进
- 第一阶段：添加大小限制（已废弃）
- 第二阶段：缩短超时时间（已实施）
- 第三阶段：替换为 pdfreader（当前方案）

## 4. pdfreader 实施方案
- 安装和配置
- 代码修改
- 性能对比

## 5. 效果验证
- 内存使用对比
- 成功率提升
```

#### B. 代码质量相关（合并）

| 原文件 | 新文件 | 说明 |
|--------|--------|------|
| CODE_REVIEW.md | docs/CODE_QUALITY_IMPROVEMENTS.md | 合并代码审查相关 |
| UNUSED_IMPORTS_CLEANUP.md | ↑ | 未使用导入清理 |
| CONSTANT_CHECK_COMPLETE.md | ↑ | 常量检查完成报告 |
| CONSTANT_LOCATION_CHECK.md | ↑ | 常量位置检查 |
| DUPLICATE_CODE_REFACTOR.md | ↑ | 重复代码重构 |

#### C. 智能路由和流式处理（合并）

| 原文件 | 新文件 | 说明 |
|--------|--------|------|
| SMART_ROUTING_IMPLEMENTATION.md | docs/SMART_ROUTING_AND_STREAMING.md | 合并智能路由和流式处理 |
| SMART_ROUTING_SUMMARY.md | ↑ | 智能路由总结 |
| STREAM_PROCESSOR_IMPLEMENTATION.md | ↑ | 流式处理器实现 |
| PREVIEW_STREAM_UNIFICATION.md | ↑ | 预览流式统一 |

#### D. 配置和文件大小限制

| 原文件 | 新文件 | 说明 |
|--------|--------|------|
| CONFIG_FIX_REPORT.md | docs/CONFIGURATION_MANAGEMENT.md | 配置管理文档 |
| FILE_SIZE_LIMITS_FIX.md | ↑ | 文件大小限制修复 |
| FILE_WORKER_CLEANUP.md | ↑ | Worker 清理优化 |

---

## 🗑️ 可以删除的文件

无（所有文件都有价值，建议归档而非删除）

---

## 📝 执行步骤

### 步骤 1：创建合并后的文档

1. **PDF 内存优化** → `docs/PDF_MEMORY_OPTIMIZATION.md`
2. **代码质量改进** → `docs/CODE_QUALITY_IMPROVEMENTS.md`
3. **智能路由和流式处理** → `docs/SMART_ROUTING_AND_STREAMING.md`
4. **配置管理** → `docs/CONFIGURATION_MANAGEMENT.md`

### 步骤 2：移动文件到 docs/

```bash
# 移动单个文件
mv PDF_OOM_FIX.md docs/archive/
mv PDF_OOM_TIMEOUT_ANALYSIS.md docs/archive/
mv TIMEOUT_FIX_REPORT.md docs/archive/
mv TIMEOUT_OOM_ROOT_CAUSE_ANALYSIS.md docs/archive/
mv PDF_PARSER_REPLACEMENT_PLAN.md docs/archive/
mv CODE_REVIEW.md docs/archive/
mv UNUSED_IMPORTS_CLEANUP.md docs/archive/
mv CONSTANT_CHECK_COMPLETE.md docs/archive/
mv CONSTANT_LOCATION_CHECK.md docs/archive/
mv DUPLICATE_CODE_REFACTOR.md docs/archive/
mv SMART_ROUTING_IMPLEMENTATION.md docs/archive/
mv SMART_ROUTING_SUMMARY.md docs/archive/
mv STREAM_PROCESSOR_IMPLEMENTATION.md docs/archive/
mv PREVIEW_STREAM_UNIFICATION.md docs/archive/
mv CONFIG_FIX_REPORT.md docs/archive/
mv FILE_SIZE_LIMITS_FIX.md docs/archive/
mv FILE_WORKER_CLEANUP.md docs/archive/
```

### 步骤 3：更新引用

检查代码中是否有对这些 .md 文件的引用（通常没有）

---

## 🎯 最终目录结构

```
DataGuardScanner/
├── README.md                    # 项目主文档
├── LICENSE                      # 许可证
├── docs/
│   ├── PDF_MEMORY_OPTIMIZATION.md           # ⭐ PDF 内存优化（合并）
│   ├── CODE_QUALITY_IMPROVEMENTS.md         # ⭐ 代码质量改进（合并）
│   ├── SMART_ROUTING_AND_STREAMING.md       # ⭐ 智能路由和流式处理（合并）
│   ├── CONFIGURATION_MANAGEMENT.md          # ⭐ 配置管理（合并）
│   ├── CLEANUP_SUMMARY.md                   # 现有
│   ├── CODE_REVIEW_REPORT.md                # 现有
│   ├── CODE_REVIEW_SUPPLEMENT.md            # 现有
│   ├── COPY_FIX_REPORT.md                   # 现有
│   ├── D3_IMPLEMENTATION_CHECKLIST.md       # 现有
│   ├── SCAN_RESOURCE_CLEANUP_AUDIT.md       # 现有
│   ├── USE_EVENT_LISTENER_*.md              # 现有（4个文件）
│   ├── VIRTUAL_SCROLL_PREVIEW_PLAN.md       # 现有
│   ├── VITE_CONFIG_OPTIMIZATION_REPORT.md   # 现有
│   ├── WINDOWS_7_COMPATIBILITY.md           # 现有
│   ├── WORKER_THREADS_IMPLEMENTED.md        # 现有
│   └── archive/                             # 归档原始文件
│       ├── PDF_OOM_FIX.md
│       ├── PDF_OOM_TIMEOUT_ANALYSIS.md
│       ├── ... (其他原始文件)
└── ...
```

---

## ✨ 优势

1. **根目录清爽**：只保留 README 和 LICENSE
2. **文档集中管理**：所有技术文档在 docs/ 目录
3. **避免重复**：相关主题合并为一个完整文档
4. **便于查找**：按主题分类，易于导航
5. **历史追溯**：保留原始文件在 archive/ 子目录

---

**是否执行此整理方案？**
