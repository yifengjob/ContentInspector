# 解析器重构指南

## 已完成的重构（6/10）

✅ text-extractor.ts
✅ binary-extractor.ts  
✅ word-extractor.ts
✅ ppt-extractor.ts
✅ excel-extractor.ts
✅ xml-extractor.ts

## 待完成的解析器（4/10）

### 1. excel-streaming-extractor.ts

**当前问题**：
- 手动超时管理（isResolved, timeoutId）
- 手动错误处理
- 重复的 Promise 包装

**重构方案**：
```typescript
class ExcelStreamingExtractor extends BaseExtractor {
    constructor() {
        super({ name: 'ExcelStreamingExtractor' });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        // 核心逻辑保持不变
        const workbook = new ExcelJS.stream.xlsx.WorkbookReader(...);
        // ... 提取逻辑
        
        return this.buildResult(allText, 'ExcelStreamingExtractor');
    }
}

const enhancedExtract = composeDecorators(
    baseExtractor.extract.bind(baseExtractor),
    [
        (fn) => withTimeout(fn, { timeoutMs: 30000 }),
        (fn) => withLogging(fn, { logError: true, prefix: 'ExcelStreamingExtractor' })
    ]
);
```

---

### 2. pdf-extractor.ts（最复杂，10.3KB）

**当前问题**：
- Polyfill 初始化在模块级别
- 复杂的分页处理逻辑
- 多个 try-catch 块

**重构方案**：
```typescript
class PdfExtractor extends BaseExtractor {
    constructor() {
        super({ 
            name: 'PdfExtractor',
            verboseLogging: false
        });
        
        // Polyfill 只需初始化一次
        setupAllPdfPolyfills();
    }

    protected async doValidateFile(filePath: string, stat: fs.Stats): Promise<void> {
        // PDF 特殊验证：检查是否加密
        // 可以在这里添加额外的验证逻辑
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        // 使用 pdfjs-dist 加载文档
        const loadingTask = getDocument({...});
        const pdfDocument = await loadingTask.promise;
        
        // 逐页提取文本
        const textChunks: string[] = [];
        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
            const page = await pdfDocument.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            textChunks.push(pageText);
        }
        
        const allText = textChunks.join('\n');
        return this.buildResult(allText, 'PdfExtractor');
    }
    
    protected handleError(error: any, filePath: string): ExtractorResult {
        // PDF 特殊的错误处理
        if (error.message.includes('password')) {
            this.logger.warn(`[${this.config.name}] PDF 文件已加密`);
        }
        return super.handleError(error, filePath);
    }
}
```

---

### 3. rtf-extractor.ts

**当前问题**：
- 复杂的编码检测逻辑
- 多重正则替换
- 手动超时管理

**重构方案**：
```typescript
class RtfExtractor extends BaseExtractor {
    constructor() {
        super({ name: 'RtfExtractor' });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        // 读取文件
        const buffer = await readFileWithTimeout(filePath, FILE_READ_TIMEOUT_STANDARD_MS);
        const content = buffer.toString('utf-8');
        
        // 编码检测和转换（保持原有逻辑）
        const encoding = this.detectRtfEncoding(content);
        let text = this.decodeRtfHexSequences(content, encoding);
        
        // 移除 RTF 控制字
        text = this.cleanRtfMarkup(text);
        
        return this.buildResult(text, 'RtfExtractor');
    }
    
    private detectRtfEncoding(content: string): string {
        // 提取原有的编码检测逻辑
        const codePageMatch = content.match(/\\ansicpg(\d+)/i);
        // ... 映射逻辑
        return encoding;
    }
    
    private decodeRtfHexSequences(content: string, encoding: string): string {
        // 提取原有的解码逻辑
        return content.replace(/(\\'[0-9a-fA-F]{2})+/g, (match) => {
            // ... 解码逻辑
        });
    }
    
    private cleanRtfMarkup(text: string): string {
        // 提取原有的清理逻辑
        return text
            .replace(/\\u-?\d+\??/g, '')
            .replace(/\\[a-z]+[0-9]*[ ;]?/g, ' ')
            .replace(/[{}]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
```

---

### 4. opendocument-extractor.ts

**当前问题**：
- ZIP 解压逻辑
- XML 解析逻辑
- 手动超时管理

**重构方案**：
```typescript
class OpenDocumentExtractor extends BaseExtractor {
    constructor() {
        super({ name: 'OpenDocumentExtractor' });
    }

    protected async doExtract(filePath: string): Promise<ExtractorResult> {
        // 解压 ODF 文件
        const entries = await unzipFile(filePath);
        
        // 查找 content.xml
        const contentEntry = findZipEntries(entries, 'content.xml')[0];
        if (!contentEntry) {
            return this.buildResult('', 'OpenDocumentExtractor');
        }
        
        // 解析 XML 内容
        const xmlContent = extractEntriesText([contentEntry])[0];
        const text = this.extractTextFromXml(xmlContent);
        
        return this.buildResult(text, 'OpenDocumentExtractor');
    }
    
    private extractTextFromXml(xmlContent: string): string {
        // 提取 <text:p> 和 <text:h> 标签中的文本
        const paragraphs = xmlContent.match(/<text:[ph][^>]*>([^<]*)<\/text:[ph]>/g);
        if (!paragraphs) return '';
        
        return paragraphs
            .map(p => p.match(/<text:[ph][^>]*>([^<]*)<\/text:[ph]>/)?.[1] || '')
            .filter(t => t.trim())
            .join('\n');
    }
}
```

---

## 重构步骤总结

对于每个解析器，遵循以下步骤：

1. **创建类并继承 BaseExtractor**
   ```typescript
   class XxxExtractor extends BaseExtractor {
       constructor() {
           super({ name: 'XxxExtractor' });
       }
   }
   ```

2. **实现 doExtract 方法**
   - 移除所有超时管理代码（isResolved, timeoutId）
   - 移除 Promise 包装
   - 只保留核心提取逻辑
   - 使用 `this.buildResult()` 返回结果
   - 使用 `this.logger` 记录日志

3. **可选：重写钩子方法**
   - `doValidateFile()` - 文件验证
   - `handleError()` - 错误处理

4. **创建实例并应用装饰器**
   ```typescript
   const baseExtractor = new XxxExtractor();
   const enhancedExtract = composeDecorators(
       baseExtractor.extract.bind(baseExtractor),
       [
           (fn) => withTimeout(fn, { timeoutMs: 30000 }),
           (fn) => withLogging(fn, { logError: true, prefix: 'XxxExtractor' })
       ]
   );
   ```

5. **导出兼容函数**
   ```typescript
   export async function extractXxx(filePath: string): Promise<ExtractorResult> {
       return await enhancedExtract(filePath);
   }
   ```

---

## 重构收益

| 指标 | 改进前 | 改进后 |
|------|--------|--------|
| 代码行数 | ~100-150行/解析器 | ~60-80行/解析器 |
| 超时管理 | 每处手动实现 | 基类自动提供 |
| 错误处理 | 分散的 try-catch | 统一的错误处理 |
| 日志记录 | 不一致的格式 | 统一的日志格式 |
| 可测试性 | 难以单独测试 | 易于单元测试 |
| 可维护性 | 修改需改多处 | 修改一处即可 |

---

## 下一步

完成剩余 4 个解析器的重构后：
1. 运行完整测试套件
2. 更新文档
3. 考虑添加单元测试
4. 性能基准测试
