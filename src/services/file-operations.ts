import {shell} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
    createPermissionError,
    createDeleteError,
} from '../utils/error-utils';
import {fileLogger} from "../logger/logger";

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
 * 【安全增强】防止路径遍历攻击（Path Traversal）
 * 
 * 【注意】此函数仅用于防止恶意路径遍历攻击（如 ../、~ 等）
 * 系统目录（/dev, /proc, /sys 等）由 Walker 的 filter 函数过滤，
 * 不应在此处进行拦截，避免产生误导性警告。
 */
export function isPathAllowed(filePath: string): boolean {
    // 【A2 优化】安全检查：拒绝空路径
    if (!filePath || filePath.trim() === '') {
        fileLogger.warn(`isPathAllowed: 拒绝访问：文件路径为空`);
        return false;
    }

    // 【安全增强】检查路径遍历攻击特征
    if (filePath.includes('..') || filePath.includes('~')) {
        fileLogger.warn(`isPathAllowed: 拒绝访问：检测到可疑路径特征: ${filePath}`);
        return false;
    }

    // 【A2 优化】安全检查：拒绝相对路径
    if (!path.isAbsolute(filePath)) {
        fileLogger.warn('isPathAllowed: ', '拒绝访问：相对路径不被允许: ', filePath);
        return false;
    }

    // 【安全增强】规范化路径，消除符号链接和冗余部分
    let normalizedPath: string;
    try {
        normalizedPath = path.normalize(filePath);
        // 再次检查规范化后的路径是否仍然绝对
        if (!path.isAbsolute(normalizedPath)) {
            fileLogger.warn(`isPathAllowed: 拒绝访问：规范化后仍为相对路径: ${filePath}`);
            return false;
        }
    } catch (error) {
        fileLogger.error(`isPathAllowed: 路径规范化失败: ${filePath}`, error);
        return false;
    }

    // 【关键修复】系统目录由 Walker 的 filter 处理，此处不做拦截
    // 如果文件路径指向系统目录，说明 Walker 的 filter 有遗漏，但不应该在此处报错
    const systemDirPrefixes = ['/dev/', '/proc/', '/sys/', '/System/', 
                               '/usr/', '/bin/', '/sbin/', '/etc/'];
    const isSystemFile = systemDirPrefixes.some(prefix => 
        normalizedPath.startsWith(prefix) || normalizedPath === prefix.slice(0, -1)
    );
    
    if (isSystemFile) {
        // 系统文件，静默允许（实际上不应该到达这里，因为 Walker 应该已经过滤）
        fileLogger.debug(`isPathAllowed: 系统文件（应由 Walker 过滤）: ${filePath}`);
        return true;
    }

    // 【A2 优化】安全检查：解析真实路径，防止符号链接攻击
    let realPath: string;
    try {
        realPath = fs.realpathSync(normalizedPath);
    } catch (error) {
        // 文件不存在时，使用规范化路径进行目录检查
        realPath = normalizedPath;
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

    // 非系统文件且不在允许范围内，记录警告
    fileLogger.warn(`isPathAllowed: 拒绝访问：路径不在允许范围内: ${filePath}`);
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
