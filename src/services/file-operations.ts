import {shell} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
    createPermissionError,
    createDeleteError,
} from '../utils/error-utils';
import {fileLogger} from "../logger/logger";


/**
 * 检查文件路径是否安全
 * 
 * 【职责】仅防止路径遍历攻击（Path Traversal）
 * - 检测 `..` 路径遍历
 * - 检测 `~` home 目录引用
 * - 拒绝相对路径
 * 
 * 【注意】
 * - 支持全盘扫描，不限制扫描路径范围
 * - 系统目录过滤由 Walker 的 filter 函数处理
 * - 此函数只检查恶意路径特征，不检查是否在"允许列表"中
 */
export function isPathAllowed(filePath: string): boolean {
    // 【安全检查】拒绝空路径
    if (!filePath || filePath.trim() === '') {
        fileLogger.warn(`isPathAllowed: 拒绝访问：文件路径为空`);
        return false;
    }

    // 【安全检查】拒绝路径遍历攻击特征
    if (filePath.includes('..') || filePath.includes('~')) {
        fileLogger.warn(`isPathAllowed: 拒绝访问：检测到可疑路径特征: ${filePath}`);
        return false;
    }

    // 【安全检查】拒绝相对路径
    if (!path.isAbsolute(filePath)) {
        fileLogger.warn('isPathAllowed: ', '拒绝访问：相对路径不被允许: ', filePath);
        return false;
    }

    // 【安全检查】规范化路径验证
    let normalizedPath: string;
    try {
        normalizedPath = path.normalize(filePath);
        if (!path.isAbsolute(normalizedPath)) {
            fileLogger.warn(`isPathAllowed: 拒绝访问：规范化后仍为相对路径: ${filePath}`);
            return false;
        }
    } catch (error) {
        fileLogger.error(`isPathAllowed: 路径规范化失败: ${filePath}`, error);
        return false;
    }

    // 【全盘扫描】所有绝对路径都允许，不做额外限制
    return true;
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
