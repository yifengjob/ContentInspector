import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {app} from 'electron';
import {AppConfig} from '../../types/';
// 【优化】导入配置常量
import {
    BYTES_TO_GB,
    CONCURRENCY_ABSOLUTE_MAX,
    CONCURRENCY_MEMORY_RATIO,
    DEFAULT_CONCURRENCY_CPU_RATIO,
    DEFAULT_CONCURRENCY_MAX,
    DEFAULT_CONCURRENCY_MIN,
    DEFAULT_MAX_FILE_SIZE_MB,
    DEFAULT_MAX_PDF_SIZE_MB,
    MEMORY_PER_WORKER_GB
} from './constants';
// 【D3 优化】导入错误处理工具
import {createConfigSaveError,} from '../../utils/error-utils';
import {logger} from "../../logger/logger";

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

/**
 * 获取基础系统目录（不包含其他磁盘）
 */
function getBaseSystemDirs(): string[] {
    let systemDirs: string[] = [];
    if (process.platform === 'win32') {
        // 【动态获取】使用环境变量获取真正的系统安装目录
        const windir = process.env.WINDIR || 'C:\\Windows';
        const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
        const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const systemDrive = path.parse(windir).root; // 获取系统盘符，如 C:\

        systemDirs = [
            // Windows 核心系统目录
            windir, // 例如 D:\Windows
            path.join(systemDrive, 'WinNT'), // 兼容旧版本
            path.join(systemDrive, 'Windows.old'),
            // 程序安装目录
            programFiles,
            programFilesX86,
            // 恢复和性能日志
            path.join(systemDrive, 'Recovery'),
            path.join(systemDrive, 'PerfLogs'),
            // 系统引导和驱动
            path.join(systemDrive, 'Boot'),
            path.join(systemDrive, 'EFI'),
            // Windows Installer 缓存
            path.join(systemDrive, 'Config.Msi'),
            // 系统文件（pagefile.sys 等）
            path.join(systemDrive, 'pagefile.sys'),
            path.join(systemDrive, 'hiberfil.sys'),
            path.join(systemDrive, 'swapfile.sys'),
        ];
    } else if (process.platform === 'darwin') {
        systemDirs = [
            '/System', '/usr',
            '/bin', '/sbin',
            '/etc', '/dev',
            '/cores', '/Network',
            '/Applications', '/Library',
        ];
    } else if (process.platform === 'linux') {
        systemDirs = [
            '/proc', '/sys', '/dev', '/dev/pts',
            '/run', '/var/run', '/var/lock',
            '/etc',
            '/bin', '/sbin', '/lib', '/lib64', '/usr',
            '/boot', '/initrd', '/vmlinuz',
        ];
    }
    return systemDirs;
}

/**
 * 根据配置生成完整的系统目录列表
 */
export function generateSystemDirs(ignoreOtherDrives: boolean = false): string[] {
    const baseDirs = getBaseSystemDirs();

    // 仅在 Windows 且启用选项时添加其他磁盘
    if (process.platform === 'win32' && ignoreOtherDrives) {
        const allDirs = [...baseDirs];

        // 【动态获取】使用环境变量获取系统盘符
        const windir = process.env.WINDIR || 'C:\\Windows';
        const systemDrive = path.parse(windir).root;

        // 添加其他磁盘的系统目录（C-Z），与 getBaseSystemDirs 保持一致
        for (let i = 67; i <= 90; i++) {
            const drive = String.fromCharCode(i);
            const driveRoot = `${drive}:\\`;

            // 跳过系统盘（已经在 baseDirs 中）
            // 【兼容性】不区分大小写比较，防止 C: 和 c: 的情况
            if (driveRoot.toLowerCase() === systemDrive.toLowerCase()) {
                continue;
            }

            allDirs.push(
                `${driveRoot}Windows`,
                `${driveRoot}Windows.old`,
                `${driveRoot}WinNT`,
                `${driveRoot}Program Files`,
                `${driveRoot}Program Files (x86)`,
                `${driveRoot}Recovery`,
                `${driveRoot}PerfLogs`,
                `${driveRoot}Boot`,
                `${driveRoot}EFI`,
                `${driveRoot}Config.Msi`
            );
        }
        return allDirs;
    }

    return baseDirs;
}

export function getDefaultConfig(): AppConfig {
    const ignoreDirNames = [
        // 版本控制和开发工具
        'node_modules', '.git', '.svn', '.hg', '.bzr', '_darcs',
        // IDE 和编辑器
        '.vscode', '.idea', '.eclipse', '.settings', '.project', '.cargo', '.rustup', '.lingma',
        // 构建和缓存
        // 'dist', 'build', '.next', 'out', '.cache', '__pycache__',
        // 包管理器
        '.npm', '.yarn', '.pnpm-store', 'bower_components', '.m2',
        // 操作系统隐藏文件和目录
        'System Volume Information',
        // '$RECYCLE.BIN', 'Recycle.Bin',
        '.Spotlight-V100', '.fseventsd', '.DS_Store',
        // '.Trashes',
        // 'lost+found',
        // '.Trash',
        // 临时文件
        // 'tmp', 'temp', '.temp'
    ];

    // scanConcurrency: 0 表示使用动态计算（根据 CPU 和内存自动调整）
    // 默认设置为 4，这是一个平衡性能和资源消耗的保守值
    return {
        selectedPaths: [],
        selectedExtensions: ['*'],
        enabledSensitiveTypes: [
            'person_id', 'phone', 'email', 'bank_card',
            'address', 'ip_address', 'password'
        ],
        ignoreDirNames,
        systemDirs: generateSystemDirs(false), // 默认只忽略C盘系统目录
        maxFileSizeMb: DEFAULT_MAX_FILE_SIZE_MB,
        maxPdfSizeMb: DEFAULT_MAX_PDF_SIZE_MB,
        scanConcurrency: 4, // 默认并发数，scanner.ts 会根据硬件智能调整
        theme: 'system',
        language: 'zh-CN',
        enableExperimentalParsers: false,
        enableOfficeParsers: true,
        deleteToTrash: false,
        ignoreOtherDrivesSystemDirs: false, // 默认不忽略其他磁盘的系统目录（即会扫描）
        customSensitiveExpression: '' // 默认为空，表示不启用自定义表达式
    };
}

export async function loadConfig(): Promise<AppConfig> {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = await fs.promises.readFile(CONFIG_FILE, 'utf-8');
            const config = JSON.parse(data);
            const defaultConfig = getDefaultConfig();
            const mergedConfig = {...defaultConfig, ...config};

            // 根据 ignoreOtherDrivesSystemDirs 选项重新生成系统目录
            mergedConfig.systemDirs = generateSystemDirs(mergedConfig.ignoreOtherDrivesSystemDirs);

            return mergedConfig;
        }
    } catch (error: any) {
        logger.error('loadConfig: {}', error.message);
    }

    return getDefaultConfig();
}

/**
 * 【新增】同步读取配置（用于 getSensitiveRules 等同步场景）
 */
export function getConfigSync(): AppConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const config = JSON.parse(data);
            const defaultConfig = getDefaultConfig();
            const mergedConfig = {...defaultConfig, ...config};

            // 根据 ignoreOtherDrivesSystemDirs 选项重新生成系统目录
            mergedConfig.systemDirs = generateSystemDirs(mergedConfig.ignoreOtherDrivesSystemDirs);

            return mergedConfig;
        }
    } catch (error: any) {
        logger.warn('getConfigSync: {}', error.message);
    }

    return getDefaultConfig();
}

export async function saveConfig(config: AppConfig): Promise<void> {
    try {
        const data = JSON.stringify(config, null, 2);
        await fs.promises.writeFile(CONFIG_FILE, data, 'utf-8');
    } catch (error: any) {
        logger.error('saveConfig: {}', error.message);
        throw createConfigSaveError(error);
    }
}

/**
 * 【修复】获取 macOS 真实可用内存（包括文件系统缓存）
 * macOS 的 os.freemem() 只返回真正空闲的物理内存，不包括可回收的缓存
 */
function getAvailableMemoryGB(): number {
    if (process.platform === 'darwin') {
        try {
            // macOS: 使用 vm_stat 获取真实的可用内存
            const {execSync} = require('child_process');
            const output = execSync('vm_stat', {encoding: 'utf-8'});

            // 解析 vm_stat 输出
            const pageSizeMatch = output.match(/page size of (\d+) bytes/);
            const freeMatch = output.match(/Pages free:\s+(\d+)/);
            const inactiveMatch = output.match(/Pages inactive:\s+(\d+)/);
            const speculativeMatch = output.match(/Pages speculative:\s+(\d+)/);

            if (pageSizeMatch && freeMatch && inactiveMatch) {
                const pageSize = parseInt(pageSizeMatch[1]);
                const freePages = parseInt(freeMatch[1]);
                const inactivePages = parseInt(inactiveMatch[1]);
                const speculativePages = speculativeMatch ? parseInt(speculativeMatch[1]) : 0;

                // 可用内存 = 空闲页 + 非活跃页 + 推测页（这些都可以被回收）
                const availableBytes = (freePages + inactivePages + speculativePages) * pageSize;
                return availableBytes / BYTES_TO_GB;
            }
        } catch (error) {
            // 如果失败，降级到 os.freemem()
            logger.warn('[内存计算] vm_stat 失败，使用 os.freemem()');
        }
    }

    // Windows/Linux: 使用 os.freemem()
    return os.freemem() / BYTES_TO_GB;
}

/**
 * 根据系统硬件资源智能计算推荐的并发数
 */
export function calculateRecommendedConcurrency(): number {
    const cpuCount = os.cpus().length;
    const freeMemoryGB = getAvailableMemoryGB();
    const maxByMemory = Math.floor(freeMemoryGB * CONCURRENCY_MEMORY_RATIO / MEMORY_PER_WORKER_GB);
    const calculatedMaxConcurrency = Math.min(cpuCount, maxByMemory, CONCURRENCY_ABSOLUTE_MAX);
    return Math.max(calculatedMaxConcurrency, DEFAULT_CONCURRENCY_MIN);
}

/**
 * 根据配置和系统资源计算实际使用的并发数
 * @param configuredConcurrency 配置的并发数（0 表示自动）
 * @returns 实际应该使用的并发数
 */
export function calculateActualConcurrency(configuredConcurrency: number): {
    actualConcurrency: number;
    maxAllowedConcurrency: number;
    cpuCount: number;
    freeMemoryGB: number;
} {
    const cpuCount = os.cpus().length;
    const freeMemoryGB = getAvailableMemoryGB();
    const maxByMemory = Math.floor(freeMemoryGB * CONCURRENCY_MEMORY_RATIO / MEMORY_PER_WORKER_GB);
    const calculatedMaxConcurrency = Math.min(cpuCount, maxByMemory, CONCURRENCY_ABSOLUTE_MAX);
    const maxAllowedConcurrency = Math.max(calculatedMaxConcurrency, DEFAULT_CONCURRENCY_MIN);

    // 【调试】输出详细的计算过程（仅开发环境）
    if (process.env.NODE_ENV === 'development') {
        logger.info('[并发数计算] CPU: {}核, 可用内存: {}GB', cpuCount, freeMemoryGB.toFixed(1));
        logger.info('[并发数计算] 内存限制: {}, CPU限制: {}, 绝对最大值: {}', maxByMemory, cpuCount, CONCURRENCY_ABSOLUTE_MAX);
        logger.info('[并发数计算] 计算最大值: {}, 最大允许值: {}', calculatedMaxConcurrency, maxAllowedConcurrency);
        logger.info('[并发数计算] 配置值: {}', configuredConcurrency);
    }

    let actualConcurrency: number;
    if (configuredConcurrency && configuredConcurrency > 0) {
        actualConcurrency = Math.min(configuredConcurrency, maxAllowedConcurrency);
        if (process.env.NODE_ENV === 'development') {
            logger.info('[并发数计算] 使用配置值: min({}, {}) = {}', configuredConcurrency, maxAllowedConcurrency, actualConcurrency);
        }
    } else {
        // 【优化】更保守的默认并发数，避免 CPU 过载
        // Mac M2/M3 等高性能 CPU 也需要限制，避免风扇狂转
        // 使用 CPU 核心数的比例，但不超过最大值，最少最小值
        actualConcurrency = Math.min(
            Math.max(Math.floor(cpuCount * DEFAULT_CONCURRENCY_CPU_RATIO), DEFAULT_CONCURRENCY_MIN),
            DEFAULT_CONCURRENCY_MAX
        );
        if (process.env.NODE_ENV === 'development') {
            logger.info('[并发数计算] 使用自动计算: min(max(floor({} * {}), {}), {}) = {}', cpuCount, DEFAULT_CONCURRENCY_CPU_RATIO, DEFAULT_CONCURRENCY_MIN, DEFAULT_CONCURRENCY_MAX, actualConcurrency);
        }
    }

    if (process.env.NODE_ENV === 'development') {
        logger.info('[并发数计算] 最终并发数: {}', actualConcurrency);
    }

    return {
        actualConcurrency,
        maxAllowedConcurrency,
        cpuCount,
        freeMemoryGB
    };
}
