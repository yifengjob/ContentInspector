/**
 * Walker Worker 消息类型定义
 * 
 * 职责：
 * - 定义主进程与 Walker Worker 之间的通信协议
 * - 提供类型安全的消息接口
 */

/**
 * Walker 配置接口
 */
export interface WalkerConfig {
    rootPath: string;
    selectedExtensions: string[];
    ignoreDirNames: string[];
    systemDirs: string[];
    maxFileSizeMb: number;
    maxPdfSizeMb: number;
}

/**
 * 初始化配置消息（方案C）
 * 
 * 用途：主进程在创建 Worker 后立即发送，缓存支持的扩展名列表
 */
export interface InitConfigMessage {
    type: 'init-config';
    supportedExtensions: string[];
}

/**
 * 开始遍历消息
 * 
 * 用途：通知 Worker 开始遍历指定路径
 */
export interface StartWalkingMessage {
    type: 'start-walking';
    config: WalkerConfig;
}

/**
 * 取消所有任务消息
 * 
 * 用途：立即停止所有遍历任务
 */
export interface CancelAllMessage {
    type: 'cancel-all';
}

/**
 * Worker 接收的消息联合类型
 */
export type WalkerWorkerMessage = InitConfigMessage | StartWalkingMessage | CancelAllMessage;
