/**
 * 【新增】日志事件数据结构
 */
export interface LogEventData {
  level: string; // 日志级别（DEBUG/INFO/WARN/ERROR）
  message: string; // 格式化后的消息
  context: string; // 日志上下文（模块名）
  timestamp: string; // 时间戳
}
