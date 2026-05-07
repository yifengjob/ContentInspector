import {shell} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
    createPermissionError,
    createDeleteError,
} from './error-utils';
import {fileLogger} from "./logger";

// 允许的文件路径列表（由扫描模块维护）
const allowedPaths = new Set<string>();

/**
 * 添加允许访问的路径
 */
export function addAllowedPath(allowedPath: string): void {
    // 标准化路径，确保以 / 结尾
    const normalized = allowedPath.endsWith(path.sep) ? allowedPath : allowedPath + path.sep;
    allowedPaths.add(normalized);
}

/**
 * 清除所有允许的路径
 */
export function clearAllowedPaths(): void {
    allowedPaths.clear();
}

/**
 * 检查文件路径是否在允许的范围内
 */
export function isPathAllowed(filePath: string): boolean {
    // 【A2 优化】安全检查：拒绝空路径
    if (!filePath || filePath.trim() === '') {
        fileLogger.warn(`isPathAllowed: 拒绝访问：文件路径为空`);
        return false;
    }

    // 【A2 优化】安全检查：拒绝相对路径
    if (!path.isAbsolute(filePath)) {
        fileLogger.warn('isPathAllowed: ', '拒绝访问：相对路径不被允许: ', filePath);
        return false;
    }

    // 【A2 优化】安全检查：解析真实路径，防止符号链接攻击
    let realPath: string;
    try {
        realPath = fs.realpathSync(filePath);
    } catch (error) {
        // 文件不存在时，使用原始路径进行目录检查
        realPath = filePath;
    }

    // 如果没有限制，允许所有路径（向后兼容）
    if (allowedPaths.size === 0) {
        return true;
    }

    // 检查文件路径是否在任何允许的路径下
    for (const allowed of allowedPaths) {
        if (realPath.startsWith(allowed) || realPath === allowed.slice(0, -1)) {
            return true;
        }
    }

    return false;
}

export async function openFile(filePath: string): Promise<void> {
    // 安全检查：验证路径是否在允许范围内
    if (!isPathAllowed(filePath)) {
        throw createPermissionError(filePath);
    }
    await shell.openPath(filePath);
}

export async function openFileLocation(filePath: string): Promise<void> {
    // 安全检查：验证路径是否在允许范围内
    if (!isPathAllowed(filePath)) {
        throw createPermissionError(filePath);
    }
    shell.showItemInFolder(filePath);
}

export async function deleteFile(filePath: string, toTrash: boolean = false): Promise<void> {
    // 安全检查：验证路径是否在允许范围内
    if (!isPathAllowed(filePath)) {
        throw createPermissionError(filePath);
    }

    try {
        if (toTrash) {
            // 移入回收站 - 【修复】使用 Function 构造器绕过 TypeScript 编译转换
            // trash v9.0.0 是纯 ES Module，不能用 require() 加载
            const importTrash = new Function('return import("trash")') as () => Promise<any>;
            const trashModule = await importTrash();
            await trashModule.default(filePath);
        } else {
            // 永久删除
            await fs.promises.unlink(filePath);
        }
    } catch (error: any) {
        fileLogger.error('deleteFile: ', error.message);
        throw createDeleteError(filePath, error);
    }
}
