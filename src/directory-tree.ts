import * as fs from 'fs';
import * as path from 'path';
import {DirectoryNode} from './types';
import {logger} from "./logger";

export async function getDirectoryTree(dirPath: string, showHidden: boolean): Promise<DirectoryNode[]> {
    if (!fs.existsSync(dirPath)) {
        throw new Error('路径不存在');
    }

    const nodes: DirectoryNode[] = [];

    try {
        const entries = await fs.promises.readdir(dirPath, {withFileTypes: true});

        for (const entry of entries) {
            const fileName = entry.name;
            const filePath = path.join(dirPath, fileName);
            const isDir = entry.isDirectory();
            const isHidden = fileName.startsWith('.');

            if (!showHidden && isHidden) {
                continue;
            }

            let hasChildren = false;
            if (isDir) {
                try {
                    const children = await fs.promises.readdir(filePath);
                    hasChildren = children.length > 0;
                } catch {
                    hasChildren = false;
                }
            }

            nodes.push({
                path: filePath,
                name: fileName,
                isDir,
                isHidden,
                hasChildren,
                children: undefined
            });
        }
    } catch (error: any) {
        // 【优化】仅在生产环境记录错误
        if (process.env.NODE_ENV === 'development') {
            logger.error('[directory-tree]', '读取目录失败:', error.message);
        }
        throw error;
    }

    // 按名称排序，目录在前
    nodes.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
    });

    return nodes;
}
