/**
 * 日志工具 - 统一处理日志过滤和抑制
 *
 * 【重要】此模块必须在其他任何模块导入之前被导入和执行
 * 因为我们需要在 pdfjs-dist 等库加载之前就设置好过滤规则
 */

// 【优化】需要抑制的警告模式
const SUPPRESS_PATTERNS = [
    // pdfjs-dist 的字体警告
    'Warning: TT: undefined function',
    'Warning: TT: invalid offset',
    'Warning: Indexing all PDF objects',
    'Warning: Ran out of space in font private use area',
    'Warning: TT: undefined subroutine',
    'Warning: TT: invalid glyph index',
    'Warning: Required "glyf" table is not found -- trying to recover.',
    'Warning: fetchStandardFontData: failed to fetch file',
    'Warning: loadFont - translateFont failed:',
    
    // 【新增】canvas 模块缺失警告（不影响文本提取功能）
    'Cannot polyfill `Path2D`',
    'Cannot find module',
    'canvas.node',
];

/**
 * 初始化日志抑制（拦截 console.warn 和 stderr）
 * 应该在应用启动时立即调用
 */
export function setupLogSuppression(): void {
    // 1. 拦截 console.warn
    const originalWarn = console.warn;
    console.warn = function (...args: any[]) {
        const message = args.join(' ');

        // 检查是否匹配任何抑制模式
        const shouldSuppress = SUPPRESS_PATTERNS.some(pattern => message.includes(pattern));

        if (shouldSuppress) {
            return; // 静默丢弃
        }

        originalWarn.apply(console, args);
    };

    // 2. 拦截 process.stderr.write
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = function (chunk: any, encoding?: any, callback?: any) {
        // 处理不同的参数形式
        let text = chunk;
        if (Buffer.isBuffer(chunk)) {
            text = chunk.toString(encoding || 'utf8');
        }
        
        if (typeof text === 'string') {
            const shouldSuppress = SUPPRESS_PATTERNS.some(pattern => text.includes(pattern));
            if (shouldSuppress) {
                // 如果有回调，调用它
                if (typeof encoding === 'function') {
                    encoding();
                } else if (typeof callback === 'function') {
                    callback();
                }
                return true; // 抑制输出
            }
        }
        
        // 正常写入
        if (typeof encoding === 'function') {
            return originalStderrWrite(chunk, encoding);
        } else if (typeof callback === 'function') {
            return originalStderrWrite(chunk, encoding, callback);
        } else {
            return originalStderrWrite(chunk);
        }
    };
}

/**
 * 添加额外的抑制模式
 * @param patterns 要抑制的警告模式数组
 */
export function addSuppressPatterns(patterns: string[]): void {
    SUPPRESS_PATTERNS.push(...patterns);
}

/**
 * 恢复原始的 console.warn（用于调试）
 */
export function restoreConsoleWarn(): void {
    // 注意：这只恢复 console.warn，不恢复 stderr
    // 如果需要完全恢复，需要保存更多的原始引用
    const originalWarn = (console as any)._originalWarn;
    if (originalWarn) {
        console.warn = originalWarn;
    }
}

// 【关键】模块加载时立即执行抑制逻辑
setupLogSuppression();
