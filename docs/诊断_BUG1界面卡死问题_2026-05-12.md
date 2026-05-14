# Bug 1 诊断报告 - 扫描特定目录界面卡死

## 问题描述
扫描 `/Users/yifeng/Downloads/临时文件/测试文档/` 目录时，界面会卡死，应用没有响应。

## 目录内容
```
-rw-r--r--@ 1 yifeng  staff    79K Apr 30 14:23 18900786699.dps
-rw-r--r--@ 1 yifeng  staff   9.5K Apr 30 14:54 43092319841103.wps
-rw-r--r--@ 1 yifeng  staff    20K May  1 13:18 工作簿1.et
-rw-r--r--@ 1 yifeng  staff   5.8K Apr 30 14:06 长沙农村商业银行股份有限公司关于蒋磊等同志职务任免的通知.odt
-rw-r--r--@ 1 yifeng  staff   9.6K Apr 30 14:36 长沙农村商业银行股份有限公司关于蒋磊等同志职务任免的通知.rtf
```

共 5 个文件，总大小约 124KB，都很小。

## 文件类型映射
- `.dps` → PowerPoint (extractPptx)
- `.wps` → Word (extractWithWordExtractor)
- `.et` → Excel (extractWithExcelJS)
- `.odt` → OpenDocument (extractOdt)
- `.rtf` → RTF (extractRtf)

## 可能的原因分析

### 1. Worker 线程阻塞（最可能）
某个解析器在处理特定文件时陷入无限循环或长时间阻塞，导致 Worker 无法响应。

**可疑点：**
- `word-extractor` 处理 OLE2 格式的 .wps 文件
- `exceljs` 处理 .et 文件
- `pptx-parser` 处理 .dps 文件

### 2. 主线程 IPC 繁忙
如果 Worker 发送大量消息（如流式预览），可能导致主线程 IPC 处理繁忙。

### 3. 前端渲染阻塞
如果扫描结果很多，或者日志更新频繁，可能导致 Vue 渲染阻塞。

## 诊断步骤

### Step 1: 添加详细日志
在关键位置添加日志，定位卡死的具体位置：

1. **file-worker.ts** - 记录每个文件的处理开始和结束
2. **各个解析器** - 记录解析开始、完成、错误
3. **scanner.ts** - 记录任务分发和完成

### Step 2: 测试单个文件
逐个测试这 5 个文件，找出哪个文件导致卡死：

```bash
# 创建测试脚本
node test-single-file.js /path/to/file
```

### Step 3: 检查超时机制
确认所有解析器都有正确的超时保护：
- word-extractor.ts ✅ 有超时（calculateParserTimeout）
- excel-streaming-extractor.ts ✅ 有超时
- pdf-extractor.ts ✅ 有超时
- ppt-extractor.ts ✅ 有超时
- odt-extractor.ts ❓ 需要检查
- rtf-extractor.ts ❓ 需要检查

## 修复方案

### 方案 A：增强超时保护（推荐）
确保所有解析器都有超时保护，并且超时时间合理。

### 方案 B：添加心跳检测
Worker 定期发送心跳消息，主进程检测到无响应时强制终止。

### 方案 C：限制并发数
对于已知有问题的文件类型，降低并发数或串行处理。

## 下一步行动
1. 运行扫描并收集日志
2. 确定是哪个文件导致卡死
3. 检查该文件的解析器是否有超时保护
4. 添加或修复超时机制
