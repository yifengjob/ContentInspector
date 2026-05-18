<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { useAppStore } from '@/stores/app';
  import { storeToRefs } from 'pinia';
  import {
    cancelScan,
    getRecommendedConcurrency,
    getSearchExpression,
    loadConfig,
    onScanError,
    onScanFinished,
    onScanLog,
    onScanLogBatch,
    onScanProgress,
    onScanResult,
    setSearchExpression,
    showMessage,
    startScan,
    validateExpression,
  } from './utils/electron-api';
  import DirectoryTree from './components/DirectoryTree.vue';
  import FileTypeFilter from './components/FileTypeFilter.vue';
  import ResultsTable from './components/ResultsTable.vue';
  import PreviewModal from './components/PreviewModal.vue';
  import SettingsModal from './components/SettingsModal.vue';
  import LogsModal from './components/LogsModal.vue';
  import AboutModal from './components/AboutModal.vue';
  import ExportModal from './components/ExportModal.vue';
  import EnvironmentCheck from './components/EnvironmentCheck.vue';
  import type { ThemeMode } from './utils/theme';
  import { applyTheme, loadTheme, watchSystemTheme } from './utils/theme';
  import { formatNumber } from './utils/format';
  import { classifyError } from './utils/error-handler'; // 【C2优化】错误分类工具

  // 不再需要导入 SVG 文件
  // 插件会自动将 src/assets 下的 SVG 转换为 sprite

  const appStore = useAppStore();
  const {
    isScanning,
    scannedCount,
    totalCount,
    filteredCount, // 【新增】过滤计数
    skippedCount, // 【修改】跳过计数（原 errorCount）
    sensitiveFilesCount,
    totalSensitiveItems,
    scanStartTime, // 【UI优化】扫描开始时间
    scanElapsedTime, // 【UI优化】扫描耗时
    config,
    scanResults,
  } = storeToRefs(appStore);

  // 【UI优化】直接从 store 获取函数（不使用 storeToRefs）
  const { startElapsedTimeTimer, stopElapsedTimeTimer } = appStore;

  const showPreview = ref(false);
  const previewFilePath = ref('');
  const showSettings = ref(false);
  const showLogs = ref(false);
  const showAbout = ref(false);
  const showExport = ref(false);
  const isSidebarCollapsed = ref(false);
  const currentTheme = ref<ThemeMode>('system');
  const isCancelling = ref(false); // 【新增】取消扫描状态
  // 【优化】判断是否为开发环境
  const isDevMode = computed(() => import.meta.env.DEV);

  // 【新增】更多菜单显示状态
  const showMoreMenu = ref(false);

  // 【新增】自定义敏感词逻辑表达式相关
  const searchExpression = ref('');
  const expressionValidationError = ref('');
  const expressionValidated = ref(false);
  let validationTimer: number | null = null; // 防抖定时器

  // 加载配置
  onMounted(async () => {
    try {
      const loadedConfig = await loadConfig();
      Object.assign(config.value, loadedConfig);

      // 如果配置中的并发数为 0，则使用系统推荐的值
      if (config.value.scanConcurrency === 0) {
        config.value.scanConcurrency = await getRecommendedConcurrency();
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }

    // 初始化主题
    currentTheme.value = loadTheme();
    applyTheme(currentTheme.value);

    // 监听系统主题变化（仅在 system 模式下）
    watchSystemTheme(() => {
      if (currentTheme.value === 'system') {
        applyTheme('system');
      }
    });

    // 【新增】点击外部关闭更多菜单
    document.addEventListener('click', (e) => {
      const moreMenuContainer = document.querySelector('.more-menu-container');
      if (moreMenuContainer && !moreMenuContainer.contains(e.target as Node)) {
        showMoreMenu.value = false;
      }
    });

    // 监听扫描事件
    await onScanProgress((data) => {
      scannedCount.value = data.scannedCount;
      if (data.totalCount !== undefined) {
        totalCount.value = data.totalCount; // ← 更新总数
      }
      appStore.currentFile = data.currentFile;
      // 【方案一】分别更新过滤和跳过计数
      if (data.filteredCount !== undefined) {
        appStore.filteredCount = data.filteredCount;
      }
      if (data.skippedCount !== undefined) {
        appStore.skippedCount = data.skippedCount;
      }
    });

    await onScanResult((items) => {
      // 【P3优化】支持批量和单个消息
      if (Array.isArray(items)) {
        // 批量添加：一次性添加到 pendingResults
        appStore.addScanResults(items);
      } else {
        // 单个添加（向后兼容）
        appStore.addScanResult(items);
      }
    }, true); // 启用批量模式

    await onScanFinished(() => {
      isScanning.value = false;
      isCancelling.value = false; // 【新增】重置取消状态
      stopElapsedTimeTimer(); // 【UI优化】停止耗时更新定时器

      // 【关键修复】扫描完成时，确保已处理数等于总数
      // 已处理 = 已扫描 + 已过滤 + 已跳过 = 总数（walker遍历的所有文件）
      const expectedTotal = totalCount.value;
      const actualProcessed = scannedCount.value + filteredCount.value + skippedCount.value;
      if (actualProcessed < expectedTotal) {
        // 修正 scannedCount，使已处理数等于总数
        scannedCount.value = expectedTotal - filteredCount.value - skippedCount.value;
      }
    });

    await onScanError(async (error) => {
      console.error('扫描错误:', error);
      isScanning.value = false;
      isCancelling.value = false; // 【新增】重置取消状态
      stopElapsedTimeTimer(); // 【UI优化】停止耗时更新定时器

      // 【C2优化】使用友好错误提示
      const errorInfo = classifyError(error);
      let message = errorInfo.message;
      if (errorInfo.suggestion) {
        message += `\n\n${errorInfo.suggestion}`;
      }

      await showMessage(message, {
        title: '扫描错误',
        type:
          errorInfo.severity === 'error'
            ? 'error'
            : errorInfo.severity === 'warning'
              ? 'warning'
              : 'info',
      });
    });

    // 【P1优化】监听 ERROR 级别日志（立即显示）
    await onScanLog((log) => {
      appStore.addLog(log); // 单条添加，但 ERROR 日志很少，性能影响可忽略
    });

    // 监听普通日志（批量显示）
    await onScanLogBatch((logs) => {
      appStore.addLogs(logs); // ← 批量添加，只触发一次响应式更新
    });

    // 【新增】加载搜索表达式
    try {
      searchExpression.value = await getSearchExpression();
    } catch (error) {
      console.error('加载搜索表达式失败:', error);
    }
  });

  // 开始扫描
  const handleStartScan = async () => {
    if (appStore.selectedPaths.size === 0) {
      await showMessage('请至少选择一个扫描路径', {
        title: '提示',
        type: 'warning',
      });
      return;
    }

    // 【修复】表达式验证已在输入框实时进行，此处无需再次验证
    // 如果表达式有误，按钮会被禁用，无法点击

    // 获取有效的扫描路径（只保留叶子节点）
    const effectivePaths = appStore.getEffectiveScanPaths();

    appStore.clearScanResults(); // 这会清空 logs 和 logVersion
    isScanning.value = true;
    scanStartTime.value = Date.now(); // 【UI优化】记录扫描开始时间
    startElapsedTimeTimer(); // 【UI优化】启动耗时更新定时器

    // 将Proxy对象转换为普通对象，以便通过IPC传递
    const expr = searchExpression.value.trim();
    const scanConfig = {
      selectedPaths: effectivePaths,
      selectedExtensions: [...config.value.selectedExtensions],
      enabledSensitiveTypes: [...config.value.enabledSensitiveTypes],
      ignoreDirNames: [...config.value.ignoreDirNames],
      systemDirs: [...(config.value.systemDirs || [])],
      maxFileSizeMb: config.value.maxFileSizeMb,
      maxPdfSizeMb: config.value.maxPdfSizeMb,
      scanConcurrency: config.value.scanConcurrency,
      searchExpression: expr || undefined, // 【新增】搜索表达式
      enableBuiltinRules: config.value.enableBuiltinRules, // 【新增】内置规则开关
    };

    try {
      await startScan(scanConfig);
    } catch (error) {
      console.error('启动扫描失败:', error);
      isScanning.value = false;
    }
  };

  // 取消扫描
  const handleCancelScan = async () => {
    isCancelling.value = true; // 【新增】设置取消状态
    try {
      await cancelScan();
      isScanning.value = false;
      isCancelling.value = false; // 【新增】重置取消状态
      stopElapsedTimeTimer(); // 【UI优化】停止耗时更新定时器
    } catch (error) {
      console.error('取消扫描失败:', error);
      isCancelling.value = false; // 【新增】重置取消状态
      stopElapsedTimeTimer(); // 【UI优化】停止耗时更新定时器
    }
  };

  // 导出报告
  const handleExportReport = async () => {
    if (scanResults.value.length === 0) {
      await showMessage('暂无扫描结果，无法导出报告', {
        title: '提示',
        type: 'warning',
      });
      return;
    }
    showExport.value = true;
  };

  // 【新增】打开开发者工具
  const handleOpenDevTools = () => {
    // 通过 window.electronAPI 调用主进程的 openDevTools
    if (window.electronAPI?.openDevTools) {
      window.electronAPI.openDevTools();
    } else {
      console.warn('electronAPI.openDevTools 不可用');
    }
  };

  // ==================== 搜索表达式相关 ====================

  // 【修复】实时验证表达式并自动保存（带防抖）
  const validateExpressionDebounced = async () => {
    const expr = searchExpression.value.trim();

    // 清空状态
    if (!expr) {
      expressionValidationError.value = '';
      expressionValidated.value = false;
      // 清空时也保存
      try {
        await setSearchExpression('');
      } catch (_error) {
        console.error('清空表达式失败:', _error);
      }
      return;
    }

    try {
      const result = await validateExpression(expr);
      expressionValidated.value = true;

      if (!result.valid) {
        expressionValidationError.value = result.error || '语法错误';
        // 验证失败，不保存
      } else {
        expressionValidationError.value = '';
        // 验证通过，自动保存
        try {
          await setSearchExpression(expr);
        } catch (_error) {
          console.error('保存表达式失败:', _error);
        }
      }
    } catch (_error) {
      expressionValidationError.value = _error instanceof Error ? _error.message : '验证失败';
      // 验证失败，不保存
    }
  };

  // 【新增】监听输入变化（防抖）
  const onExpressionInput = () => {
    // 清除之前的定时器
    if (validationTimer !== null) {
      clearTimeout(validationTimer);
    }

    // 设置新的定时器（500ms 防抖）
    validationTimer = window.setTimeout(() => {
      validateExpressionDebounced();
    }, 500);
  };

  // 【新增】获取表达式验证状态提示
  const expressionValidationStatus = computed(() => {
    if (expressionValidationError.value) {
      return `语法错误: ${expressionValidationError.value}`;
    }
    if (expressionValidated.value && searchExpression.value.trim()) {
      return '表达式语法正确';
    }
    return '输入搜索表达式，如：密码 & 身份证';
  });

  // 【新增】计算"开始扫描"按钮是否禁用
  const isStartScanDisabled = computed(() => {
    // 如果正在扫描或取消中，禁用
    if (isScanning.value || isCancelling.value) {
      return true;
    }

    // 如果没有选择路径，禁用
    if (appStore.selectedPaths.size === 0) {
      return true;
    }

    // 如果禁用内置规则，必须有有效的表达式
    if (config.value.enableBuiltinRules === false) {
      const expr = searchExpression.value.trim();
      // 表达式为空，禁用
      if (!expr) {
        return true;
      }
      // 表达式有错误，禁用
      if (expressionValidationError.value) {
        return true;
      }
    }

    return false;
  });

  // 【新增】计算"开始扫描"按钮的 title 提示
  const startScanButtonTitle = computed(() => {
    if (isScanning.value) return '正在扫描中...';
    if (isCancelling.value) return '正在取消中...';

    // 如果没有选择路径
    if (appStore.selectedPaths.size === 0) {
      return '请至少选择一个扫描路径';
    }

    // 如果禁用内置规则，检查表达式状态
    if (config.value.enableBuiltinRules === false) {
      const expr = searchExpression.value.trim();
      if (!expr) {
        return '请输入自定义表达式';
      }
      if (expressionValidationError.value) {
        // 截断错误信息，避免 tooltip 过长
        const errorMsg = expressionValidationError.value;
        const truncatedMsg = errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg;
        return `表达式语法错误：${truncatedMsg}`;
      }
    }

    return '开始扫描选中的目录';
  });

  // 预览文件
  const handlePreview = (filePath: string) => {
    // 同时设置，让 watch 立即触发
    previewFilePath.value = filePath;
    showPreview.value = true;
  };

  // 主题切换
  const toggleTheme = () => {
    const themes: ThemeMode[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(currentTheme.value);
    const nextIndex = (currentIndex + 1) % themes.length;
    currentTheme.value = themes[nextIndex];
    applyTheme(currentTheme.value);
  };

  // 获取主题图标

  // 获取主题提示文本
  const getThemeTooltip = () => {
    switch (currentTheme.value) {
      case 'light':
        return '当前：浅色主题，点击切换到深色';
      case 'dark':
        return '当前：深色主题，点击切换到跟随系统';
      case 'system':
        return '当前：跟随系统，点击切换到浅色';
      default:
        return '切换主题';
    }
  };
</script>

<template>
  <div class="app-container">
    <!-- 工具栏 -->
    <div class="toolbar">
      <!-- 左侧：辅助功能区 -->
      <div class="toolbar-section toolbar-left">
        <button
          class="btn btn-icon-only"
          :disabled="scanResults.length === 0"
          :title="scanResults.length === 0 ? '暂无扫描结果，无法导出' : '导出报告'"
          @click="handleExportReport"
        >
          <svg class="btn-icon">
            <use href="#icon-export" />
          </svg>
        </button>
        <button class="btn btn-icon-only" title="打开设置" @click="showSettings = true">
          <svg class="btn-icon">
            <use href="#icon-setting" />
          </svg>
        </button>
        <button class="btn btn-icon-only" title="查看日志" @click="showLogs = true">
          <svg class="btn-icon">
            <use href="#icon-log" />
          </svg>
        </button>
      </div>

      <!-- 中间：搜索/表达式输入区 + 执行按钮 -->
      <div class="toolbar-section toolbar-center">
        <!-- 【新增】自定义敏感词逻辑表达式输入框 -->
        <div class="expression-input-container" :title="expressionValidationStatus">
          <input
            v-model="searchExpression"
            type="text"
            class="expression-input"
            :class="{
              'expression-input-error': expressionValidationError,
              'expression-input-success':
                expressionValidated && !expressionValidationError && searchExpression.trim(),
            }"
            placeholder="关键字搜索，支持表达式（如：密码 & 身份证）"
            @input="onExpressionInput"
          />
        </div>

        <!-- 【优化】扫描操作按钮组（紧邻输入框右侧） -->
        <div class="scan-actions">
          <button
            class="btn btn-primary"
            :disabled="isScanning || isCancelling || isStartScanDisabled"
            :title="startScanButtonTitle"
            @click="handleStartScan"
          >
            <svg class="btn-icon">
              <use href="#icon-play" />
            </svg>
            <span>{{ isScanning ? '扫描中...' : isCancelling ? '取消中...' : '开始扫描' }}</span>
          </button>
          <button
            class="btn btn-danger"
            :disabled="!isScanning || isCancelling"
            title="取消当前扫描任务"
            @click="handleCancelScan"
          >
            <svg class="btn-icon">
              <use href="#icon-pause" />
            </svg>
            <span>{{ isCancelling ? '取消中...' : '取消' }}</span>
          </button>
        </div>
      </div>

      <!-- 右侧：系统功能区 -->
      <div class="toolbar-section toolbar-right">
        <button
          class="btn btn-icon-only theme-toggle"
          :title="getThemeTooltip()"
          @click="toggleTheme"
        >
          <!-- 跟随系统主题 -->
          <svg v-if="currentTheme === 'system'" class="btn-icon">
            <use href="#icon-system-theme" />
          </svg>
          <!-- 浅色/深色主题 -->
          <svg v-else class="btn-icon">
            <use href="#icon-light-dark" />
          </svg>
        </button>
        <button class="btn btn-icon-only" title="关于" @click="showAbout = true">
          <svg class="btn-icon">
            <use href="#icon-about" />
          </svg>
        </button>
        <button
          v-if="isDevMode"
          class="btn btn-icon-only"
          title="打开开发者工具（仅开发环境）"
          @click="handleOpenDevTools"
        >
          <svg class="btn-icon">
            <use href="#icon-dev-tools" />
          </svg>
        </button>

        <!-- 【新增】更多按钮（小屏幕显示） -->
        <div class="more-menu-container">
          <button
            class="btn btn-icon-only more-btn"
            title="更多选项"
            @click="showMoreMenu = !showMoreMenu"
          >
            <svg class="btn-icon">
              <use href="#icon-more" />
            </svg>
          </button>

          <!-- 下拉菜单 -->
          <div v-if="showMoreMenu" class="more-menu-dropdown">
            <button
              class="menu-item"
              :disabled="scanResults.length === 0"
              @click="
                handleExportReport;
                showMoreMenu = false;
              "
            >
              <svg class="menu-icon"><use href="#icon-export" /></svg>
              <span>导出报告</span>
            </button>
            <button
              class="menu-item"
              @click="
                showSettings = true;
                showMoreMenu = false;
              "
            >
              <svg class="menu-icon"><use href="#icon-setting" /></svg>
              <span>设置</span>
            </button>
            <button
              class="menu-item"
              @click="
                showLogs = true;
                showMoreMenu = false;
              "
            >
              <svg class="menu-icon"><use href="#icon-log" /></svg>
              <span>查看日志</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧区域（侧边栏 + 按钮） -->
      <div class="sidebar-area" :class="{ collapsed: isSidebarCollapsed }">
        <!-- 侧边栏 -->
        <div class="sidebar">
          <!-- 目录树 -->
          <DirectoryTree />

          <!-- 文件类型筛选 -->
          <FileTypeFilter />
        </div>

        <!-- 折叠按钮（独立于侧边栏，始终可见） -->
        <div
          class="sidebar-toggle"
          :title="isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="isSidebarCollapsed = !isSidebarCollapsed"
        >
          <svg v-if="isSidebarCollapsed"><use href="#icon-arrow-right" /></svg>
          <svg v-else><use href="#icon-arrow-left" /></svg>
        </div>
      </div>

      <!-- 右侧结果表格 -->
      <div class="results-panel">
        <ResultsTable @preview="handlePreview" />
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
        <span class="status-label">进度：</span>
        <span class="status-value mono-font"
          >{{ formatNumber(scannedCount + filteredCount + skippedCount)
          }}{{ totalCount > 0 ? ' / ' + formatNumber(totalCount) : '' }}</span
        >
      </div>

      <!-- 【条件渲染】启用内置规则时显示敏感文件和敏感信息统计 -->
      <template v-if="config.enableBuiltinRules !== false">
        <div class="status-divider"></div>
        <div class="status-item">
          <span class="status-label">敏感文件：</span>
          <span class="status-value warning mono-font">{{
            formatNumber(sensitiveFilesCount)
          }}</span>
        </div>
        <div class="status-divider"></div>
        <div class="status-item">
          <span class="status-label">敏感信息：</span>
          <span class="status-value danger mono-font"
            >{{ formatNumber(totalSensitiveItems) }} 条</span
          >
        </div>
      </template>

      <!-- 【新增】禁用内置规则时，扫描完成后显示搜索到的文件数量 -->
      <template v-else-if="!isScanning && scanResults.length > 0">
        <div class="status-divider"></div>
        <div class="status-item">
          <span class="status-label">搜索结果：</span>
          <span class="status-value success mono-font"
            >{{ formatNumber(scanResults.length) }} 个文件</span
          >
        </div>
      </template>

      <div class="status-divider"></div>
      <div class="status-item status-elapsed">
        <span class="status-label">耗时：</span>
        <span class="status-value mono-font">{{ scanElapsedTime }}</span>
      </div>
      <!-- 【新增】电源管理状态提示 -->
      <div v-if="isScanning" class="status-divider"></div>
      <div
        v-if="isScanning"
        class="status-item power-save-indicator"
        title="扫描进行中，系统已阻止休眠"
      >
        <svg class="power-icon"><use href="#icon-power" /></svg>
        <span class="power-text">防休眠已开启</span>
      </div>
    </div>

    <!-- 预览弹窗 -->
    <PreviewModal
      :file-path="previewFilePath"
      :visible="showPreview"
      @close="showPreview = false"
    />

    <!-- 设置窗口 -->
    <Transition name="modal">
      <SettingsModal v-if="showSettings" @close="showSettings = false" />
    </Transition>

    <!-- 日志窗口 -->
    <Transition name="modal">
      <LogsModal v-if="showLogs" @close="showLogs = false" />
    </Transition>

    <!-- 关于窗口 -->
    <Transition name="modal">
      <AboutModal v-if="showAbout" @close="showAbout = false" />
    </Transition>

    <!-- 导出窗口 -->
    <Transition name="modal">
      <ExportModal v-if="showExport" :results="scanResults" @close="showExport = false" />
    </Transition>

    <!-- 环境检查窗口 -->
    <EnvironmentCheck />
  </div>
</template>

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
    align-items: center; /* 垂直居中对齐 */
    position: relative; /* 【修复】为下拉菜单提供定位上下文 */
    z-index: 100; /* 【修复】确保工具栏在结果表格之上 */
  }

  /* 【优化】工具栏分区布局 */
  .toolbar-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  /* 左侧：辅助功能区 */
  .toolbar-left {
    flex-shrink: 0; /* 不压缩 */
  }

  /* 中间：搜索/表达式输入区 + 执行按钮 */
  .toolbar-center {
    flex: 1; /* 占据剩余空间 */
    justify-content: center; /* 居中对齐 */
    min-width: 0; /* 允许收缩 */
    gap: var(--spacing-md); /* 输入框和按钮组之间的间距 */
  }

  /* 【新增】扫描操作按钮组 */
  .scan-actions {
    display: flex;
    gap: var(--spacing-sm);
    flex-shrink: 0; /* 按钮不压缩 */
    white-space: nowrap; /* 防止文字换行 */
  }

  /* 右侧：系统功能区 */
  .toolbar-right {
    flex-shrink: 0; /* 不压缩 */
    margin-left: auto; /* 推到最右边 */
  }

  /* 【新增】自定义表达式输入框容器 */
  .expression-input-container {
    display: flex;
    align-items: center;
    gap: 0.25em;
    position: relative;
    width: 100%; /* 占据父容器全部宽度 */
    max-width: 600px; /* 最大宽度限制 */
  }

  /* 【新增】表达式输入框 */
  .expression-input {
    padding: 0.65em 0.75em; /* 6px 12px */
    border: var(--border-width) solid var(--border-color);
    border-radius: var(--radius-sm);
    background-color: var(--bg-color);
    color: var(--text-color);
    font-size: 0.9em;
    width: 100%; /* 占据父容器全部宽度 */
    min-width: 200px; /* 最小宽度 */
    transition: all 0.2s ease;
    outline: none;
  }

  .expression-input:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.1);
  }

  /* 【需求变更】错误状态 - 红色边框 */
  .expression-input-error {
    border-color: var(--error-color) !important;
    background-color: rgba(255, 77, 79, 0.05); /* fallback for older browsers */
    background-color: rgba(from var(--error-color) r g b / 0.05);
  }

  .expression-input-error:focus {
    box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.1) !important; /* fallback */
    box-shadow: 0 0 0 2px rgba(from var(--error-color) r g b / 0.1) !important;
  }

  /* 【需求变更】成功状态 - 绿色边框 */
  .expression-input-success {
    border-color: var(--success-color) !important;
    background-color: rgba(82, 196, 26, 0.05); /* fallback for older browsers */
    background-color: rgba(from var(--success-color) r g b / 0.05);
  }

  .expression-input-success:focus {
    box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.1) !important; /* fallback */
    box-shadow: 0 0 0 2px rgba(from var(--success-color) r g b / 0.1) !important;
  }

  .expression-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.6;
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
    fill: currentColor;
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
    //color: var(--text-color); /* 明确指定使用主题文本颜色 */
    transition: color 0.2s ease;
  }

  /* 【新增】响应式设计：小屏幕优化 */
  @media (max-width: 1024px) {
    .toolbar-center {
      gap: var(--spacing-sm);
    }

    /* 隐藏扫描按钮文字，只显示图标 */
    .scan-actions .btn span {
      display: none;
    }

    /* 【新增】隐藏左侧辅助功能按钮 */
    .toolbar-left {
      display: none;
    }

    /* 【新增】显示更多按钮 */
    .more-btn {
      display: flex !important;
    }
  }

  @media (max-width: 768px) {
    .toolbar {
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }

    /* 调整顺序：输入框在上，其他在下 */
    .toolbar-right {
      order: 2;
      width: auto;
    }

    .toolbar-center {
      order: 1;
      width: 100%;
      min-width: 100%;
    }
  }

  /* 【新增】更多按钮默认隐藏（大屏幕） */
  .more-btn {
    display: none;
  }

  /* 【新增】更多菜单容器 */
  .more-menu-container {
    position: relative;
  }

  /* 【新增】下拉菜单 */
  .more-menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: var(--spacing-xs);
    background-color: var(--bg-color);
    border: var(--border-width) solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    min-width: 160px;
    z-index: 10000; /* 【修复】提高到足够高，确保在所有内容之上 */
    padding: var(--spacing-xs);
  }

  /* 【新增】菜单项 */
  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    width: 100%;
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    background: transparent;
    color: var(--text-color);
    font-size: 0.9em;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background-color 0.2s ease;
    text-align: left;
  }

  .menu-item:hover:not(:disabled) {
    background-color: var(--bg-hover);
  }

  .menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .menu-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
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
    0%,
    100% {
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

  .status-value.success {
    color: var(--success-color);
    font-weight: 600;
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
    background-color: rgba(250, 173, 20, 0.1); /* fallback: 亮色主题 */
    color: var(--success-color);
    background-color: rgb(from var(--success-color) r g b / 0.1); /* 现代浏览器 */
    border-radius: 4px;
  }

  .power-icon {
    width: 16px;
    height: 16px;
    fill: currentColor;
    /* 【优化】闪电图标呼吸效果，类似扫描状态 */
    animation: power-breathe 1.5s ease-in-out infinite;
  }

  .power-text {
    font-weight: 500;
    font-size: 12px;
  }

  /* 【优化】图标呼吸动画 */
  @keyframes power-breathe {
    0%,
    100% {
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
