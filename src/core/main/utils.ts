/**
 * 辅助工具函数模块
 * 
 * 职责：
 * - 提供通用的辅助函数
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 计算目录大小（字节）
 * 
 * @param dirPath 目录路径
 * @returns 目录总大小（字节）
 */
export function getDirectorySize(dirPath: string): number {
    let totalSize = 0;

    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                totalSize += getDirectorySize(filePath);
            } else {
                totalSize += stat.size;
            }
        }
    } catch (e) {
        // 忽略无法访问的文件
    }

    return totalSize;
}
