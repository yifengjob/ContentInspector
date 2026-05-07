<template>
  <div class="app-container">


    <!-- 工具栏 -->
    <div class="toolbar">
      <button
          class="btn btn-primary"
          @click="handleStartScan"
          :disabled="isScanning || isCancelling"
          title="开始扫描选中的目录"
      >
        <svg class="btn-icon">
          <use href="#icon-play"/>
        </svg>
        <span>{{ isScanning ? '扫描中...' : isCancelling ? '取消中...' : '开始扫描' }}</span>
      </button>
      <button
          class="btn btn-danger"
          @click="handleCancelScan"
          :disabled="!isScanning || isCancelling"
          title="取消当前扫描任务"
      >
        <svg class="btn-icon">
          <use href="#icon-pause"/>
        </svg>
        <span>{{ isCancelling ? '取消中...' : '取消' }}</span>
      </button>
      <button
          class="btn btn-icon-only"
          @click="handleExportReport"
          :disabled="scanResults.length === 0"
          :title="scanResults.length === 0 ? '暂无扫描结果，无法导出' : '导出报告'"
      >
        <svg class="btn-icon">
          <use href="#icon-export"/>
        </svg>
      </button>
      <button
          class="btn btn-icon-only"
          @click="showSettings = true"
          title="打开设置"
      >
        <svg class="btn-icon">
          <use href="#icon-setting"/>
        </svg>
      </button>
      <button
          class="btn btn-icon-only"
          @click="showLogs = true"
          title="查看日志"
      >
        <svg class="btn-icon">
          <use href="#icon-log"/>
        </svg>
      </button>
      <button
          class="btn btn-icon-only"
          @click="handleOpenDevTools"
          title="打开开发者工具"
      >
        <svg class="btn-icon">
          <use href="#icon-dev-tools"/>
        </svg>
      </button>
      <button
          class="btn btn-icon-only theme-toggle"
          @click="toggleTheme"
          :title="getThemeTooltip()"
      >
        <!-- 跟随系统主题 -->
        <svg v-if="currentTheme === 'system'" class="btn-icon">
          <use href="#icon-system-theme"/>
        </svg>
        <!-- 浅色/深色主题 -->
        <svg v-else class="btn-icon">
          <use href="#icon-light-dark"/>
        </svg>
      </button>
      <button
          class="btn btn-icon-only"
          @click="showAbout = true"
          title="关于"
      >
        <svg class="btn-icon">
          <use href="#icon-about"/>
        </svg>
      </button>

    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧区域（侧边栏 + 按钮） -->
      <div class="sidebar-area" :class="{ collapsed: isSidebarCollapsed }">
        <!-- 侧边栏 -->
        <div class="sidebar">
          <!-- 目录树 -->
          <DirectoryTree/>

          <!-- 文件类型筛选 -->
          <FileTypeFilter/>
        </div>

        <!-- 折叠按钮（独立于侧边栏，始终可见） -->
        <div
            class="sidebar-toggle"
            @click="isSidebarCollapsed = !isSidebarCollapsed"
            :title="isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        >
          <svg v-if="isSidebarCollapsed"><use href="#icon-arrow-right"/></svg>
          <svg v-else><use href="#icon-arrow-left"/></svg>
        </div>
      </div>

      <!-- 右侧结果表格 -->
      <div class="results-panel">
        <ResultsTable @preview="handlePreview"/>
      </div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
      <div class="status-item status-status">
        <span class="status-dot" :class="{ scanning: isScanning, cancelling: isCancelling }"></span>
        <span>{{ isCancelling ? '取消中...' : isScanning ? '扫描中...' : '就绪' }}</span>
      </div>
      <div class="status-divider"></div>
      <div class="status-item">
        <!-- 【修复】已处理 = 已扫描 + 已过滤 + 已跳过，总数 = walker遍历的所有文件 -->
        <span class="status-label">已处理：</span>
        <span class="status-value mono-font">{{ formatNumber(scannedCount + filteredCount + skippedCount) }}{{ totalCount > 0 ? ' / ' + formatNumber(totalCount) : '' }}</span>
      </div>
      <div class="status-divider"></div>
      <div class="status-item">
        <span class="status-label">敏感文件：</span>
        <span class="status-value warning mono-font">{{ formatNumber(sensitiveFilesCount) }}</span>
      </div>
      <div class="status-divider"></div>
      <div class="status-item">
        <span class="status-label">敏感信息：</span>
        <span class="status-value danger mono-font">{{ formatNumber(totalSensitiveItems) }} 条</span>
      </div>
      <div class="status-divider"></div>
      <div class="status-item status-elapsed">
        <span class="status-label">耗时：</span>
        <span class="status-value mono-font">{{ scanElapsedTime }}</span>
      </div>
      <!-- 【新增】电源管理状态提示 -->
      <div v-if="isScanning" class="status-divider"></div>
      <div v-if="isScanning" class="status-item power-save-indicator" title="扫描进行中，系统已阻止休眠">
        <svg class="power-icon"><use href="#icon-power"/></svg>
        <span class="power-text">防休眠已开启</span>
      </div>
    </div>

    <!-- 预览弹窗 -->
    <PreviewModal :file-path="previewFilePath" :visible="showPreview" @close="showPreview = false"/>

    <!-- 设置窗口 -->
    <Transition name="modal">
      <SettingsModal v-if="showSettings" @close="showSettings = false"/>
    </Transition>

    <!-- 日志窗口 -->
    <Transition name="modal">
      <LogsModal v-if="showLogs" @close="showLogs = false"/>
    </Transition>

    <!-- 关于窗口 -->
    <Transition name="modal">
      <AboutModal v-if="showAbout" @close="showAbout = false"/>
    </Transition>

    <!-- 导出窗口 -->
    <Transition name="modal">
      <ExportModal v-if="showExport" :results="scanResults" @close="showExport = false"/>
    </Transition>

    <!-- 环境检查窗口 -->
    <EnvironmentCheck/>
  </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue'
import {useAppStore} from '@/stores/app'
import {storeToRefs} from 'pinia'
import {
  cancelScan,
  getRecommendedConcurrency,
  loadConfig,
  onScanError,
  onScanFinished,
  onScanLog,
  onScanProgress,
  onScanResult,
  showMessage,
  startScan
} from './utils/electron-api'
import DirectoryTree from './components/DirectoryTree.vue'
import FileTypeFilter from './components/FileTypeFilter.vue'
import ResultsTable from './components/ResultsTable.vue'
import PreviewModal from './components/PreviewModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import LogsModal from './components/LogsModal.vue'
import AboutModal from './components/AboutModal.vue'
import ExportModal from './components/ExportModal.vue'
import EnvironmentCheck from './components/EnvironmentCheck.vue'
import type {ThemeMode} from './utils/theme'
import {applyTheme, loadTheme, watchSystemTheme} from './utils/theme'
import {formatNumber} from './utils/format'
import {classifyError} from './utils/error-handler' // 【C2优化】错误分类工具

// 不再需要导入 SVG 文件
// 插件会自动将 src/assets 下的 SVG 转换为 sprite

const appStore = useAppStore()
const {
  isScanning,
  scannedCount,
  totalCount,
  filteredCount,   // 【新增】过滤计数
  skippedCount,    // 【修改】跳过计数（原 errorCount）
  sensitiveFilesCount,
  totalSensitiveItems,
  scanStartTime,   // 【UI优化】扫描开始时间
  scanElapsedTime, // 【UI优化】扫描耗时
  config,
  scanResults
} = storeToRefs(appStore)

// 【UI优化】直接从 store 获取函数（不使用 storeToRefs）
const { startElapsedTimeTimer, stopElapsedTimeTimer } = appStore

const showPreview = ref(false)
const previewFilePath = ref('')
const showSettings = ref(false)
const showLogs = ref(false)
const showAbout = ref(false)
const showExport = ref(false)
const isSidebarCollapsed = ref(false)
const currentTheme = ref<ThemeMode>('system')
const isCancelling = ref(false) // 【新增】取消扫描状态

// 加载配置
onMounted(async () => {
  try {
    const loadedConfig = await loadConfig()
    Object.assign(config.value, loadedConfig)

    // 如果配置中的并发数为 0，则使用系统推荐的值
    if (config.value.scanConcurrency === 0) {
      config.value.scanConcurrency = await getRecommendedConcurrency()
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }

  // 初始化主题
  currentTheme.value = loadTheme()
  applyTheme(currentTheme.value)

  // 监听系统主题变化（仅在 system 模式下）
  watchSystemTheme(() => {
    if (currentTheme.value === 'system') {
      applyTheme('system')
    }
  })

  // 监听扫描事件
  await onScanProgress((data) => {
    scannedCount.value = data.scannedCount
    if (data.totalCount !== undefined) {
      totalCount.value = data.totalCount  // ← 更新总数
    }
    appStore.currentFile = data.currentFile
    // 【方案一】分别更新过滤和跳过计数
    if (data.filteredCount !== undefined) {
      appStore.filteredCount = data.filteredCount
    }
    if (data.skippedCount !== undefined) {
      appStore.skippedCount = data.skippedCount
    }
  })

  await onScanResult((item) => {
    appStore.addScanResult(item)
  })

  await onScanFinished(() => {
    isScanning.value = false
    isCancelling.value = false // 【新增】重置取消状态
    stopElapsedTimeTimer()  // 【UI优化】停止耗时更新定时器
    
    // 【关键修复】扫描完成时，确保已处理数等于总数
    // 已处理 = 已扫描 + 已过滤 + 已跳过 = 总数（walker遍历的所有文件）
    const expectedTotal = totalCount.value
    const actualProcessed = scannedCount.value + filteredCount.value + skippedCount.value
    if (actualProcessed < expectedTotal) {
      // 修正 scannedCount，使已处理数等于总数
      scannedCount.value = expectedTotal - filteredCount.value - skippedCount.value
    }
  })

  await onScanError(async (error) => {
    console.error('扫描错误:', error)
    isScanning.value = false
    isCancelling.value = false // 【新增】重置取消状态
    stopElapsedTimeTimer()  // 【UI优化】停止耗时更新定时器
    
    // 【C2优化】使用友好错误提示
    const errorInfo = classifyError(error)
    let message = errorInfo.message
    if (errorInfo.suggestion) {
      message += `\n\n${errorInfo.suggestion}`
    }
    
    await showMessage(message, {
      title: '扫描错误',
      type: errorInfo.severity === 'error' ? 'error' : errorInfo.severity === 'warning' ? 'warning' : 'info'
    })
  })

  // 监听日志事件
  await onScanLog((log) => {
    appStore.addLog(log)
  })
})

// 开始扫描
const handleStartScan = async () => {
  if (appStore.selectedPaths.size === 0) {
    await showMessage('请至少选择一个扫描路径', {
      title: '提示',
      type: 'warning'
    })
    return
  }

  // 获取有效的扫描路径（只保留叶子节点）
  const effectivePaths = appStore.getEffectiveScanPaths()

  appStore.clearScanResults()  // 这会清空 logs 和 logVersion
  isScanning.value = true
  scanStartTime.value = Date.now()  // 【UI优化】记录扫描开始时间
  startElapsedTimeTimer()  // 【UI优化】启动耗时更新定时器

  // 将Proxy对象转换为普通对象，以便通过IPC传递
  const scanConfig = {
    selectedPaths: effectivePaths,
    selectedExtensions: [...config.value.selectedExtensions],
    enabledSensitiveTypes: [...config.value.enabledSensitiveTypes],
    ignoreDirNames: [...config.value.ignoreDirNames],
    systemDirs: [...(config.value.systemDirs || [])],
    maxFileSizeMb: config.value.maxFileSizeMb,
    maxPdfSizeMb: config.value.maxPdfSizeMb,
    scanConcurrency: config.value.scanConcurrency,
  }

  try {
    await startScan(scanConfig)
  } catch (error) {
    console.error('启动扫描失败:', error)
    isScanning.value = false
  }
}

// 取消扫描
const handleCancelScan = async () => {
  isCancelling.value = true // 【新增】设置取消状态
  try {
    await cancelScan()
    isScanning.value = false
    isCancelling.value = false // 【新增】重置取消状态
    stopElapsedTimeTimer()  // 【UI优化】停止耗时更新定时器
  } catch (error) {
    console.error('取消扫描失败:', error)
    isCancelling.value = false // 【新增】重置取消状态
    stopElapsedTimeTimer()  // 【UI优化】停止耗时更新定时器
  }
}

// 导出报告
const handleExportReport = async () => {
  if (scanResults.value.length === 0) {
    await showMessage('暂无扫描结果，无法导出报告', {
      title: '提示',
      type: 'warning'
    })
    return
  }
  showExport.value = true
}

// 【新增】打开开发者工具
const handleOpenDevTools = () => {
  // 通过 window.electronAPI 调用主进程的 openDevTools
  if ((window as any).electronAPI?.openDevTools) {
    (window as any).electronAPI.openDevTools()
  } else {
    console.warn('electronAPI.openDevTools 不可用')
  }
}

// 预览文件
const handlePreview = (filePath: string) => {
  // 同时设置，让 watch 立即触发
  previewFilePath.value = filePath
  showPreview.value = true
}

// 主题切换
const toggleTheme = () => {
  const themes: ThemeMode[] = ['light', 'dark', 'system']
  const currentIndex = themes.indexOf(currentTheme.value)
  const nextIndex = (currentIndex + 1) % themes.length
  currentTheme.value = themes[nextIndex]
  applyTheme(currentTheme.value)
}

// 获取主题图标

// 获取主题提示文本
const getThemeTooltip = () => {
  switch (currentTheme.value) {
    case 'light':
      return '当前：浅色主题，点击切换到深色'
    case 'dark':
      return '当前：深色主题，点击切换到跟随系统'
    case 'system':
      return '当前：跟随系统，点击切换到浅色'
    default:
      return '切换主题'
  }
}
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  will-change: auto; /* ← 优化整体布局 */
  contain: layout style; /* ← 限制重排范围 */
}

.toolbar {
  display: flex;
  gap: var(--spacing-sm);
  padding: 0.5em 1em; /* 8px 16px - 工具栏内边距 */
  background-color: var(--toolbar-bg);
  border-bottom: var(--border-width) solid var(--border-color);
  contain: layout style; /* ← 限制重排范围 */
}

.btn {
  padding: 0.375em 1em; /* 6px 16px - 按钮内边距 */
  border: var(--border-width) solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.95em; /* 接近基础字体 */
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.375em; /* 6px - 图标与文字间距 */
}

.btn-icon {
  width: 1.5em; /* 相对于按钮字体 */
  height: 1.5em;
  flex-shrink: 0;
  color: currentColor;
  transition: color 0.3s ease; /* 主题切换时图标颜色平滑过渡 */
}

.btn-icon-only {
  padding: 0.375em 0.625em; /* 6px 10px - 图标按钮 */
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); /* 轻微阴影 */
}

.btn:active:not(:disabled) {
  transform: translateY(0);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.btn-primary:hover:not(:disabled) {
  background-color: #40a9ff;
  box-shadow: 0 2px 4px rgba(24, 144, 255, 0.2);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn-danger {
  background-color: var(--error-color);
  color: white;
  border-color: var(--error-color);
}

.btn-danger:hover:not(:disabled) {
  background-color: #ff7875;
  box-shadow: 0 2px 4px rgba(255, 77, 79, 0.2);
}

.btn-danger:active:not(:disabled) {
  transform: translateY(0);
}

.theme-toggle {
  transition: all 0.2s ease;
}

.theme-toggle .btn-icon {
  color: var(--text-color); /* 明确指定使用主题文本颜色 */
  transition: color 0.2s ease;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  contain: layout style; /* ← 限制重排范围 */
}

/* 左侧区域容器 */
.sidebar-area {
  display: flex;
  flex-shrink: 0;
  position: relative; /* 为按钮提供定位上下文 */
  width: 300px; /* 固定宽度，与侧边栏一致 */
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* ← 恢复动画 */
}

.sidebar-area.collapsed {
  width: 0;
}

/* 侧边栏 - 使用 transform 平移，避免重排 */
.sidebar {
  width: 300px;
  height: 100%;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  overflow-x: hidden; /* 防止横向滚动 */
  display: flex;
  flex-direction: column;
  background-color: var(--sidebar-bg);
  position: absolute; /* 绝对定位，脱离文档流 */
  left: 0;
  top: 0;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* ← 恢复动画 */
  transform: translateX(0);
}

.sidebar-area.collapsed .sidebar {
  transform: translateX(-100%); /* 向左平移，完全隐藏 */
}

/* 折叠按钮 - 绝对定位，紧贴侧边栏右侧边缘 */
.sidebar-toggle {
  position: absolute;
  right: -1em; /* 16px - 完全在侧边栏外部 */
  top: 50%;
  transform: translateY(-50%);
  width: 1em; /* 16px - 紧凑宽度 */
  height: 3.75em; /* 60px */
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-hover);
  border: var(--border-width) solid var(--border-color);
  border-left: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  cursor: pointer;
  user-select: none;
  font-size: 0.75em; /* 12px */
  color: var(--text-secondary);
  transition: all 0.2s ease; /* ← 恢复动画 */
  z-index: 100; /* 高于所有表格固定列 */
  contain: layout style; /* ← 限制重排范围 */
}

.sidebar-toggle:hover {
  background-color: var(--bg-hover);
  color: var(--primary-color);
  transform: translateY(-50%) scale(1.1);
}

.sidebar-toggle svg {
  width: 12px;
  height: 12px;
}

.results-panel {
  flex: 1;
  overflow: hidden;
  contain: layout style paint; /* ← 限制重排范围 */
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 8px 16px;
  background-color: var(--menu-bg);
  border-top: var(--border-width) solid var(--border-color);
  font-size: 13px;
  color: var(--text-secondary);
  contain: layout style; /* ← 限制重排范围 */
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0; /* 防止压缩 */
}

.status-status {
  gap: 8px;
  font-weight: 500;
  min-width: 90px; /* 容纳 "取消中..." */
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--success-color);
  transition: all 0.3s ease;
}

.status-dot.scanning {
  background-color: var(--primary-color);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-dot.cancelling {
  background-color: var(--warning-color);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
}

.status-divider {
  width: 1px;
  height: 16px;
  background-color: var(--border-color);
  margin: 0 12px;
  flex-shrink: 0;
}

.status-label {
  color: var(--text-secondary);
}

.status-value {
  color: var(--text-color);
  font-weight: 500;
  text-align: right;
  /* 【UI优化】移除 min-width，让宽度自适应 */
}

.status-value.error {
  color: var(--error-color);
  /* 【UI优化】移除 min-width */
}

.status-value.warning {
  color: var(--warning-color);
  /* 【UI优化】移除 min-width */
}

.status-value.danger {
  color: #ff4d4f;
  font-weight: 600;
  /* 【UI优化】移除 min-width */
}

/* 【UI优化】扫描耗时项靠右显示 */
.status-elapsed {
  margin-left: auto; /* 推到最右边 */
}

/* 【新增】电源管理状态指示器样式 */
.power-save-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  /* 【优化】使用主题色，自动适配明暗主题 */
  /* 注：如果浏览器不支持 rgb(from ...), 会使用 fallback 值 */
  background-color: rgba(250, 173, 20, 0.1);  /* fallback: 亮色主题 */
  background-color: rgb(from var(--warning-color) r g b / 0.1);  /* 现代浏览器 */
  border-radius: 4px;
}

.power-icon {
  width: 16px;
  height: 16px;
  color: var(--warning-color);
  /* 【优化】闪电图标呼吸效果，类似扫描状态 */
  animation: power-breathe 1.5s ease-in-out infinite;
}

.power-text {
  color: var(--warning-color);
  font-weight: 500;
  font-size: 12px;
}

/* 【优化】闪电图标呼吸动画 */
@keyframes power-breathe {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.9);
  }
}

/* 模态框过渡动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active :deep(.modal-container),
.modal-leave-active :deep(.modal-container) {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-enter-from :deep(.modal-container),
.modal-leave-to :deep(.modal-container) {
  transform: scale(0.9) translateY(20px);
}
</style>
