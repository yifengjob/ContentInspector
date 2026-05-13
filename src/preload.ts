import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    // 目录树
    getDirectoryTree: (path: string, showHidden: boolean) =>
        ipcRenderer.invoke('get-directory-tree', path, showHidden),

    // 扫描
    scanStart: (config: any) =>
        ipcRenderer.invoke('scan-start', config),
    scanCancel: () =>
        ipcRenderer.invoke('scan-cancel'),

    // 预览（统一使用流式模式）
    previewFileStream: (filePath: string) =>
        ipcRenderer.invoke('preview-file-stream', filePath),
    cancelPreview: (taskId: number) =>
        ipcRenderer.invoke('cancel-preview', taskId),

    // 文件操作
    openFile: (filePath: string) =>
        ipcRenderer.invoke('open-file', filePath),
    openFileLocation: (filePath: string) =>
        ipcRenderer.invoke('open-file-location', filePath),
    deleteFile: (filePath: string, toTrash: boolean) =>
        ipcRenderer.invoke('delete-file', filePath, toTrash),

    // 报告导出
    exportReport: (results: any[], format: string, filePath?: string) =>
        ipcRenderer.invoke('export-report', results, format, filePath),

    // 日志
    getLogs: () =>
        ipcRenderer.invoke('get-logs'),

    // 敏感规则
    getSensitiveRules: () =>
        ipcRenderer.invoke('get-sensitive-rules'),

    // 配置
    saveConfig: (config: any) =>
        ipcRenderer.invoke('save-config', config),
    loadConfig: () =>
        ipcRenderer.invoke('load-config'),
    getRecommendedConcurrency: () =>
        ipcRenderer.invoke('get-recommended-concurrency'),

    // 环境检查
    checkSystemEnvironment: () =>
        ipcRenderer.invoke('check-system-environment'),

    // 事件监听
    onScanProgress: (callback: (data: any) => void) => {
        const listener = (_event: any, data: any) => callback(data);
        ipcRenderer.on('scan-progress', listener);
        return () => ipcRenderer.removeListener('scan-progress', listener);
    },

    onScanResult: (callback: (data: any) => void, batchMode: boolean = false) => {
        const listener = (_event: any, data: any) => {
            if (batchMode && Array.isArray(data)) {
                // 【P3优化】批量模式：直接传递数组给 callback
                callback(data);
            } else if (Array.isArray(data)) {
                // 兼容模式：遍历数组，逐个调用 callback
                data.forEach(item => callback(item));
            } else {
                // 单个消息：直接调用 callback（向后兼容）
                callback(data);
            }
        };
        ipcRenderer.on('scan-result', listener);
        return () => ipcRenderer.removeListener('scan-result', listener);
    },

    onScanFinished: (callback: () => void) => {
        const listener = (_event: any) => callback();
        ipcRenderer.on('scan-finished', listener);
        return () => ipcRenderer.removeListener('scan-finished', listener);
    },

    onScanError: (callback: (error: string) => void) => {
        const listener = (_event: any, error: string) => callback(error);
        ipcRenderer.on('scan-error', listener);
        return () => ipcRenderer.removeListener('scan-error', listener);
    },

    onScanLog: (callback: (msg: string) => void) => {
        const listener = (_event: any, msg: string) => callback(msg);
        ipcRenderer.on('scan-log', listener);
        return () => ipcRenderer.removeListener('scan-log', listener);
    },

    // 【新增】批量日志监听（带节流）
    onScanLogBatch: (callback: (messages: string[]) => void) => {
        const listener = (_event: any, batchText: string) => {
            // 将批量文本拆分为数组
            const messages = batchText.split('\n').filter(msg => msg.length > 0);
            if (messages.length > 0) {
                callback(messages);
            }
        };
        ipcRenderer.on('scan-log-batch', listener);
        return () => ipcRenderer.removeListener('scan-log-batch', listener);
    },

    // 【方案 D3】预览数据块事件
    onPreviewChunk: (callback: (chunk: any) => void) => {
        const listener = (_event: any, chunk: any) => callback(chunk);
        ipcRenderer.on('preview-chunk', listener);
        return () => ipcRenderer.removeListener('preview-chunk', listener);
    },

    // 保存文件对话框
    showSaveDialog: (options?: any) =>
        ipcRenderer.invoke('show-save-dialog', options),

    // 【新增】消息对话框（确认/提示）
    showMessageBox: (options: {
        message: string;
        title?: string;
        type?: 'info' | 'warning' | 'error' | 'question';
        buttons?: string[];
        cancelId?: number;
    }) =>
        ipcRenderer.invoke('show-message-box', options),

    // 清理缓存
    clearCache: () =>
        ipcRenderer.invoke('clear-cache'),

    // 【新增】打开开发者工具
    openDevTools: () =>
        ipcRenderer.invoke('open-dev-tools')
});

// 声明全局类型
declare global {
    interface Window {
        electronAPI: {
            getDirectoryTree: (path: string, showHidden: boolean) => Promise<any>;
            scanStart: (config: any) => Promise<any>;
            scanCancel: () => Promise<any>;
            previewFileStream: (filePath: string) => Promise<any>;  // 流式预览
            cancelPreview: (taskId: number) => Promise<any>;
            openFile: (filePath: string) => Promise<any>;
            openFileLocation: (filePath: string) => Promise<any>;
            deleteFile: (filePath: string, toTrash: boolean) => Promise<any>;
            exportReport: (results: any[], format: string, filePath?: string) => Promise<any>;
            getLogs: () => Promise<any>;
            getSensitiveRules: () => Promise<any>;
            saveConfig: (config: any) => Promise<any>;
            loadConfig: () => Promise<any>;
            getRecommendedConcurrency: () => Promise<number>;
            checkSystemEnvironment: () => Promise<any>;
            onScanProgress: (callback: (data: any) => void) => () => void;
            onScanResult: (callback: (data: any) => void) => () => void;
            onScanFinished: (callback: () => void) => () => void;
            onScanError: (callback: (error: string) => void) => () => void;
            onScanLog: (callback: (msg: string) => void) => () => void;
            onPreviewChunk: (callback: (chunk: any) => void) => () => void;  // 【方案 D3】
            showSaveDialog: (options?: any) => Promise<any>;
            showMessageBox: (options: {
                message: string;
                title?: string;
                type?: 'info' | 'warning' | 'error' | 'question';
                buttons?: string[];
                cancelId?: number;
            }) => Promise<{ response: number }>;
            clearCache: () => Promise<{ success: boolean; cleanedSize?: number }>;
            openDevTools: () => Promise<void>;
        };
    }
}

export const PRELOAD_TS_PATH = __filename;