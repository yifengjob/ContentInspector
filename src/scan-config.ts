/**
 * 扫描器配置常量
 * 集中管理所有边界条件、超时时间、内存限制等配置
 */

// ==================== 单位转换常量 ====================

/** 字节到 MB 的转换因子 */
export const BYTES_TO_MB = 1024 * 1024;

/** 字节到 GB 的转换因子 */
export const BYTES_TO_GB = 1024 * 1024 * 1024;

/** 毫秒到天的转换因子 */
export const MS_TO_DAYS = 1000 * 60 * 60 * 24;

// ==================== Worker 内存限制 ====================

/** Consumer Worker 最大旧生代内存（MB）- 提高到 768MB，支持超大型文件解析 */
export const WORKER_MAX_OLD_GENERATION_MB = 768;

/** Consumer Worker 最大新生代内存（MB）- 提高到 128MB，减少 GC 压力 */
export const WORKER_MAX_YOUNG_GENERATION_MB = 128;

// ==================== 超时时间配置 ====================

// 【重构】统一使用智能超时计算，移除硬编码的分段超时

// --- Worker 超时配置（主进程用于监控 Worker 任务）---

/** Worker 基础超时时间（毫秒）- 适用于 <1MB 的小文件 */
export const WORKER_BASE_TIMEOUT = 30000; // 30 秒

/** Worker 超时增长系数（毫秒/MB）- 每增加 1MB 文件大小，增加的超时时间 */
export const WORKER_TIMEOUT_PER_MB = 3000; // 3 秒/MB

/** Worker 最大超时时间（毫秒）- 防止超大文件超时过长 */
export const WORKER_MAX_TIMEOUT = 120000; // 120 秒

// --- 文件解析超时配置（解析器内部使用）---

/** 文件解析基础超时时间（毫秒）- 适用于 <1MB 的小文件 */
export const PARSER_BASE_TIMEOUT = 10000; // 10 秒

/** 文件解析超时增长系数（毫秒/MB）- 每增加 1MB 文件大小，增加的超时时间 */
export const PARSER_TIMEOUT_PER_MB = 2000; // 2 秒/MB

/** 文件解析最大超时时间（毫秒）- 防止超大文件超时过长 */
export const PARSER_MAX_TIMEOUT = 30000; // 30 秒

// --- 预览超时配置（预览模式使用，比解析更短）---

/** 预览基础超时时间（毫秒）- 适用于 <1MB 的小文件 */
export const PREVIEW_BASE_TIMEOUT = 8000; // 8 秒

/** 预览超时增长系数（毫秒/MB）- 每增加 1MB 文件大小，增加的超时时间 */
export const PREVIEW_TIMEOUT_PER_MB = 1500; // 1.5 秒/MB

/** 预览最大超时时间（毫秒）- 防止超大文件超时过长 */
export const PREVIEW_MAX_TIMEOUT = 20000; // 20 秒

// ==================== 智能超时计算函数 ====================

/**
 * 根据文件大小智能计算解析超时时间
 * @param fileSizeBytes 文件大小（字节）
 * @returns 超时时间（毫秒）
 */
export function calculateParserTimeout(fileSizeBytes: number): number {
    const sizeMB = fileSizeBytes / BYTES_TO_MB;

    // 基础超时 + 按大小增长的超时
    let timeoutMs = PARSER_BASE_TIMEOUT + (sizeMB * PARSER_TIMEOUT_PER_MB);

    // 限制在最大超时范围内
    timeoutMs = Math.min(timeoutMs, PARSER_MAX_TIMEOUT);

    // 确保至少为基础超时
    timeoutMs = Math.max(timeoutMs, PARSER_BASE_TIMEOUT);

    return Math.floor(timeoutMs);
}

/**
 * 根据文件大小智能计算 Worker 超时时间
 * @param fileSizeBytes 文件大小（字节）
 * @returns 超时时间（毫秒）
 */
export function calculateWorkerTimeout(fileSizeBytes: number): number {
    const sizeMB = fileSizeBytes / BYTES_TO_MB;

    // 基础超时 + 按大小增长的超时
    let timeoutMs = WORKER_BASE_TIMEOUT + (sizeMB * WORKER_TIMEOUT_PER_MB);

    // 限制在最大超时范围内
    timeoutMs = Math.min(timeoutMs, WORKER_MAX_TIMEOUT);

    // 确保至少为基础超时
    timeoutMs = Math.max(timeoutMs, WORKER_BASE_TIMEOUT);

    return Math.floor(timeoutMs);
}

/**
 * 根据文件大小智能计算预览超时时间
 * @param fileSizeBytes 文件大小（字节）
 * @returns 超时时间（毫秒）
 */
export function calculatePreviewTimeout(fileSizeBytes: number): number {
    const sizeMB = fileSizeBytes / BYTES_TO_MB;

    // 基础超时 + 按大小增长的超时
    let timeoutMs = PREVIEW_BASE_TIMEOUT + (sizeMB * PREVIEW_TIMEOUT_PER_MB);

    // 限制在最大超时范围内
    timeoutMs = Math.min(timeoutMs, PREVIEW_MAX_TIMEOUT);

    // 确保至少为基础超时
    timeoutMs = Math.max(timeoutMs, PREVIEW_BASE_TIMEOUT);

    return Math.floor(timeoutMs);
}

// ==================== 文件大小限制配置 ====================

/** 默认最大文件大小（MB） */
export const DEFAULT_MAX_FILE_SIZE_MB = 25;

/** 默认最大 PDF 文件大小（MB）- pdf.js 性能更好，但仍需限制 */
export const DEFAULT_MAX_PDF_SIZE_MB = 50;

/** 文本文件最大内容大小（MB）- 防止超大文本文件导致 OOM */
export const MAX_TEXT_CONTENT_SIZE_MB = 25;

/** 文件大小限制配置对象 */
export const FILE_SIZE_LIMITS = {
    defaultMaxSizeMB: DEFAULT_MAX_FILE_SIZE_MB,
    pdfMaxSizeMB: DEFAULT_MAX_PDF_SIZE_MB,
    maxTextContentSizeMB: MAX_TEXT_CONTENT_SIZE_MB
};

// ==================== PDF 解析配置 ====================

/** PDF 单页解析超时时间（毫秒）- 防止某一页卡死 */
export const PDF_PAGE_TIMEOUT_MS = 5000; // 5秒/页

/** PDF 文档总解析超时时间（毫秒）- 防止整个文档解析过久 */
export const PDF_TOTAL_TIMEOUT_MS = 60000; // 60秒

/** PDF OCR 功能开关 - 当前未启用，预留扩展接口 */
export const PDF_OCR_ENABLED = false;

/**
 * PDF 纯图页面检测策略
 * - 如果页面没有任何文本项，判定为纯图
 * - OCR 未启用时跳过纯图页面
 * - 如果全部为纯图，返回 unsupportedPreview
 */

// ==================== 流式处理配置 ====================

/** 滑动窗口分块大小（MB）- 每块处理的文本大小 */
export const SLIDING_WINDOW_CHUNK_SIZE_MB = 5;

/** 敏感词库最大长度（字符）- 用于确定滑动窗口重叠区大小 */
export const MAX_SENSITIVE_KEYWORD_LENGTH = 100;

/** 滑动窗口重叠区大小（字符）- 至少是最大敏感词长度的 2 倍 */
export const SLIDING_WINDOW_OVERLAP_SIZE = MAX_SENSITIVE_KEYWORD_LENGTH * 2; // 200 字符

// ==================== 预览流式传输配置 ====================

/** 预览流式传输每块行数 */
export const PREVIEW_CHUNK_SIZE = 1000;

// ==================== 停滞检测配置 ====================

/** 停滞检测检查间隔（毫秒） */
export const STAGNATION_CHECK_INTERVAL = 1000; // 1 秒

/** 停滞判定阈值（毫秒） */
export const STAGNATION_THRESHOLD = 15000; // 15 秒

/** 兜底超时时间（毫秒）- 保留作为最后保护 */
export const MAX_IDLE_TIME = 120000; //  120 秒

// ==================== IPC 节流配置 ====================

/** 进度更新节流间隔（毫秒） */
export const PROGRESS_THROTTLE_INTERVAL = 500; // 500ms

// ==================== 取消扫描配置 ====================

/** 取消扫描时最大等待时间（毫秒） */
export const CANCEL_SCAN_MAX_WAIT = 10000; // 10 秒

/** 取消扫描时检查间隔（毫秒） */
export const CANCEL_SCAN_CHECK_INTERVAL = 100; // 100ms

// ==================== Worker 重启配置 ====================

/** Worker 异常退出后重启延迟（毫秒） */
export const WORKER_RESTART_DELAY = 100; // 100ms

// ==================== 日志配置 ====================

/** 日志数组最大长度（防止内存泄漏） */
export const MAX_LOG_ENTRIES = 1000;

/** 日志文件保留天数 */
export const LOG_RETENTION_DAYS = 30;

// ==================== 并发数配置 ====================

/** 每个 Worker 预估内存占用（GB） */
export const MEMORY_PER_WORKER_GB = 0.3;

/** 并发数绝对最大值 */
export const CONCURRENCY_ABSOLUTE_MAX = 6;

/** 并发数计算时使用的安全内存比例 - 提高到 0.7，充分利用可用内存 */
export const CONCURRENCY_MEMORY_RATIO = 0.7;

/** 默认并发数的 CPU 核心数比例 */
export const DEFAULT_CONCURRENCY_CPU_RATIO = 0.5;

/** 默认并发数最大值 */
export const DEFAULT_CONCURRENCY_MAX = 4;

/** 默认并发数最小值 */
export const DEFAULT_CONCURRENCY_MIN = 2;

// ==================== 窗口配置 ====================

/** 窗口最小宽度（像素） */
export const WINDOW_MIN_WIDTH = 1000;

/** 窗口最小高度（像素） */
export const WINDOW_MIN_HEIGHT = 600;

/** 窗口默认宽度（像素） */
export const WINDOW_DEFAULT_WIDTH = 1024;

/** 窗口默认高度（像素） */
export const WINDOW_DEFAULT_HEIGHT = 768;

/** 窗口目标尺寸比例（屏幕的百分比） */
export const WINDOW_TARGET_RATIO = 0.85;

// ==================== UI 显示配置 ====================

/** 文件大小显示精度（小数位数） */
export const FILE_SIZE_DECIMAL_PLACES = 1;

// ==================== 文件 I/O 超时配置 ====================
// 注意：这些超时仅针对文件 I/O 操作（读取/打开/统计/关闭），不包含解析时间
// 解析超时请使用 PARSER_* 系列常量，Worker 监控超时请使用 WORKER_* 系列常量

/** 标准文件读取超时时间（毫秒）- 用于 PDF/Excel/Binary/RTF/ZIP 等复杂解析 */
export const FILE_READ_TIMEOUT_STANDARD_MS = 15000;  // 15秒（适应 Windows 锁屏场景）

/** 快速失败文件读取超时时间（毫秒）- 用于降级逻辑或简单操作 */
export const FILE_READ_TIMEOUT_FAST_MS = 5000;  // 5秒

/** 文件打开超时时间（毫秒） */
export const FILE_OPEN_TIMEOUT_MS = 3000;  // 3秒

/** 文件统计超时时间（毫秒） */
export const FILE_STAT_TIMEOUT_MS = 3000;  // 3秒

/** 文件关闭超时时间（毫秒） */
export const FILE_CLOSE_TIMEOUT_MS = 1000;  // 1秒

// ==================== Worker 智能调度配置 ====================

/** 是否启用智能调度（默认启用） */
export const ENABLE_SMART_SCHEDULING = true;

/** 大文件大小阈值（MB）- 超过此值视为大文件 */
export const LARGE_FILE_THRESHOLD_MB = 10;

/** 最大并发大文件数 - 防止多个大文件同时处理导致 OOM */
export const MAX_LARGE_FILES_CONCURRENT = 2;

/** 类型互斥超时时间（毫秒）- 如果超过此时间找不到不同类型，允许同类型 */
export const TYPE_MUTEX_TIMEOUT_MS = 5000;
