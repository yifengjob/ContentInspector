/**
 * 电源阻止器管理模块
 * 
 * 职责：
 * - 防止系统在扫描时进入休眠/锁屏状态
 * - 统一管理电源阻止器的启动和停止
 */

import {powerSaveBlocker} from 'electron';
import {Logger} from '../../logger/logger';

/**
 * 电源阻止器管理器接口
 */
export interface PowerSaveManager {
    /**
     * 启动电源阻止器
     */
    start(): void;

    /**
     * 停止电源阻止器
     */
    stop(): void;

    /**
     * 检查电源阻止器是否已启动
     */
    isStarted(): boolean;
}

/**
 * 创建电源阻止器管理器
 * 
 * @param log 日志记录器
 * @returns 电源阻止器管理器实例
 */
export function createPowerSaveManager(log: Logger): PowerSaveManager {
    let powerSaveBlockerId: number | null = null;

    return {
        start(): void {
            if (powerSaveBlockerId === null && !powerSaveBlocker.isStarted(0)) {
                powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
                log.info(`[电源管理] 已启动电源阻止器 (ID: ${powerSaveBlockerId})，防止系统休眠`);
            }
        },

        stop(): void {
            if (powerSaveBlockerId !== null) {
                powerSaveBlocker.stop(powerSaveBlockerId);
                log.info(`[电源管理] 已停止电源阻止器 (ID: ${powerSaveBlockerId})`);
                powerSaveBlockerId = null;
            }
        },

        isStarted(): boolean {
            return powerSaveBlockerId !== null;
        }
    };
}
