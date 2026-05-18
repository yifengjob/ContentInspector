/**
 * 前端 UI 配置常量
 * 集中管理所有 UI 相关的边界条件、延迟时间等配置
 */

// ==================== UI 批量更新配置 ====================

/** 扫描结果批量更新间隔（毫秒） */
export const UI_BATCH_UPDATE_INTERVAL = 100;

/** 日志批量更新间隔（毫秒） */
export const UI_LOG_BATCH_INTERVAL = 300; // 【优化】从 200ms 增加到 300ms，减少 IPC 压力

/** 搜索防抖延迟（毫秒） */
export const UI_SEARCH_DEBOUNCE_DELAY = 300;

// ==================== UI 优化配置 ====================
/** 前端日志最大长度（防止内存泄漏） */
export const MAX_FRONTEND_LOGS = 2000;
