<script setup lang="ts">
  import { ref, computed } from 'vue';
  import { exportReport, showMessage, showSaveDialog } from '@/utils/electron-api';
  import type { ScanResultItem } from '@/types';

  const props = defineProps<{
    results: ScanResultItem[];
  }>();

  const emit = defineEmits<{
    close: [];
  }>();

  const selectedFormat = ref('xlsx');
  const savePath = ref('');
  const exporting = ref(false);

  const totalSensitiveItems = computed(() => {
    return props.results.reduce((sum, item) => sum + item.total, 0);
  });

  const handleBrowse = async () => {
    try {
      const extensions =
        selectedFormat.value === 'xlsx'
          ? ['xlsx']
          : selectedFormat.value === 'csv'
            ? ['csv']
            : ['json'];

      const path = await showSaveDialog({
        filters: [
          {
            name: selectedFormat.value.toUpperCase(),
            extensions,
          },
        ],
      });

      if (path) {
        savePath.value = path;
      }
    } catch (error) {
      console.error('打开保存对话框失败:', error);
      await showMessage(`无法打开保存对话框: ${error}`, {
        title: '错误',
        type: 'error',
      });
    }
  };

  const handleExport = async () => {
    if (!savePath.value) {
      await showMessage('请选择保存路径', {
        title: '提示',
        type: 'warning',
      });
      return;
    }

    exporting.value = true;

    try {
      // 将前端的格式值转换为后端期望的格式
      const format =
        selectedFormat.value === 'xlsx'
          ? 'excel'
          : (selectedFormat.value as 'csv' | 'json' | 'excel');
      // 将Proxy对象转换为普通对象数组，以便通过IPC传递
      const plainResults = JSON.parse(JSON.stringify(props.results));
      // 传递用户选择的文件路径
      await exportReport(plainResults, format, savePath.value);

      // 导出成功，显示成功信息后关闭
      await showMessage(`文件已保存到：\n${savePath.value}`, {
        title: '导出成功！',
        type: 'info',
      });
      emit('close');
    } catch (error) {
      console.error('导出失败:', error);
      await showMessage(`导出失败: ${error}`, {
        title: '错误',
        type: 'error',
      });
    } finally {
      exporting.value = false;
    }
  };
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-container">
      <div class="modal-header">
        <h3>导出报告</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="modal-body">
        <!-- 无数据提示 -->
        <div v-if="results.length === 0" class="no-data-hint">
          <p>
            <svg class="warning-icon-inline"><use href="#icon-warning" /></svg>
            暂无扫描结果，无法导出报告
          </p>
          <p class="hint-text">请先执行扫描，待发现敏感文件后再导出</p>
        </div>

        <div v-else class="export-options">
          <div class="option-group">
            <label>选择格式：</label>
            <div class="format-options">
              <label class="format-option">
                <input v-model="selectedFormat" type="radio" value="xlsx" />
                <span class="format-info">
                  <strong>Excel (.xlsx)</strong>
                  <span class="format-desc">推荐，支持样式和格式化</span>
                </span>
              </label>

              <label class="format-option">
                <input v-model="selectedFormat" type="radio" value="csv" />
                <span class="format-info">
                  <strong>CSV (.csv)</strong>
                  <span class="format-desc">通用格式，可用 Excel 打开</span>
                </span>
              </label>

              <label class="format-option">
                <input v-model="selectedFormat" type="radio" value="json" />
                <span class="format-info">
                  <strong>JSON (.json)</strong>
                  <span class="format-desc">结构化数据，适合程序处理</span>
                </span>
              </label>
            </div>
          </div>

          <div class="option-group">
            <label>保存路径：</label>
            <div class="path-input">
              <input v-model="savePath" type="text" placeholder="选择保存位置..." readonly />
              <button class="btn-browse" @click="handleBrowse">浏览...</button>
            </div>
          </div>

          <div class="summary">
            <p><strong>扫描结果统计：</strong></p>
            <ul>
              <li>敏感文件数：{{ results.length }} 个</li>
              <li>总敏感项数：{{ totalSensitiveItems }} 个</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn" @click="$emit('close')">关闭</button>
        <button
          v-if="results.length > 0"
          class="btn btn-primary"
          :disabled="!savePath || exporting"
          @click="handleExport"
        >
          {{ exporting ? '导出中...' : '开始导出' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-container {
    background-color: var(--modal-bg);
    color: var(--text-color);
    border-radius: 8px;
    width: min(600px, 90vw);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h3 {
    font-size: 16px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: #999;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-color);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .no-data-hint {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-secondary);
  }

  .no-data-hint p {
    margin: 8px 0;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* 【新增】内联警告图标 */
  .warning-icon-inline {
    width: 20px;
    height: 20px;
    color: #faad14;
    flex-shrink: 0;
  }

  .no-data-hint .hint-text {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .export-options {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option-group > label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  .format-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .format-option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border: 2px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .format-option:hover {
    border-color: var(--primary-color);
    background-color: var(--bg-selected);
  }

  .format-option input[type='radio'] {
    margin-top: 2px;
    cursor: pointer;
  }

  .format-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .format-info strong {
    font-size: 14px;
    color: var(--text-color);
  }

  .format-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .path-input {
    display: flex;
    gap: 8px;
  }

  .path-input input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 13px;
    background-color: var(--input-bg);
    color: var(--text-color);
  }

  .btn-browse {
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-color);
    color: var(--text-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .btn-browse:hover {
    background-color: var(--bg-hover);
  }

  .summary {
    padding: 12px;
    background-color: var(--bg-hover);
    border-radius: 6px;
  }

  .summary p {
    margin: 0 0 8px 0;
    font-size: 14px;
  }

  .summary ul {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .summary li {
    margin: 4px 0;
  }

  .modal-footer {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--border-color);
  }

  .btn {
    padding: 8px 20px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-color);
    color: var(--text-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn:hover:not(:disabled) {
    background-color: var(--bg-hover);
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
  }
</style>
