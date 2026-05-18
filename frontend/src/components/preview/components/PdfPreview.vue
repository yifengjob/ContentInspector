<script setup lang="ts">
  import { onMounted, onUnmounted, ref } from 'vue';
  import VueOfficePdf from '@vue-office/pdf';
  import { readFileAsBlob } from '../utils/file-reader';

  const props = defineProps<{
    filePath: string;
  }>();

  const emit = defineEmits<{
    rendered: [];
    error: [message: string];
  }>();

  // 状态管理
  const loading = ref(true);
  const error = ref<string | null>(null);
  const pdfSrc = ref<string | ArrayBuffer | null>(null);
  const scale = ref(1.0);
  const progress = ref(0);

  /**
   * 加载文档
   */
  async function loadDocument(filePath: string): Promise<void> {
    try {
      loading.value = true;
      error.value = null;
      progress.value = 0;

      const result = await readFileAsBlob(filePath);

      if (!result.success || !result.data) {
        throw new Error(result.error || '读取文件失败');
      }

      // PDF 组件可以直接使用 ArrayBuffer（支持流式加载）
      pdfSrc.value = result.data;
    } catch (_err) {
      const errorMessage = _err instanceof Error ? _err.message : '加载失败';
      error.value = `加载失败: ${errorMessage}`;
      emit('error', error.value);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 渲染完成处理
   */
  function handleRendered() {
    loading.value = false;
    progress.value = 100;
    emit('rendered');
  }

  /**
   * 错误处理
   */
  function handleError(_e: unknown) {
    loading.value = false;
    error.value = 'PDF 渲染失败，请尝试切换到文本预览模式';
    emit('error', error.value);
  }

  /**
   * 销毁组件，释放资源
   */
  function destroy() {
    // 重置状态
    pdfSrc.value = null;
    loading.value = false;
    error.value = null;
    scale.value = 1.0;
    progress.value = 0;
  }

  // 组件卸载时清理资源
  onUnmounted(() => {
    destroy();
  });

  // 组件挂载后加载文档（确保容器有正确的尺寸）
  onMounted(() => {
    loadDocument(props.filePath);
  });

  // 暴露接口给父组件
  defineExpose({
    loadDocument,
    destroy,
    loading,
    error,
    scale,
  });
</script>

<template>
  <div
    class="pdf-preview-container"
    :style="{ transform: `scale(${scale})`, transformOrigin: 'top center' }"
  >
    <VueOfficePdf v-if="pdfSrc" :src="pdfSrc" @rendered="handleRendered" @error="handleError" />
    <div v-else-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在加载 PDF...</p>
      <div v-if="progress > 0" class="progress-bar">
        <div class="progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <p v-if="progress > 0">{{ progress.toFixed(0) }}%</p>
    </div>
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
  .pdf-preview-container {
    width: 100%;
    height: 100%;
    overflow: auto;
    background-color: #525659;
    transition: transform 0.2s ease;
  }

  .loading-state,
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #fff;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-top: 4px solid #409eff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .progress-bar {
    width: 200px;
    height: 4px;
    background-color: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
    margin-top: 12px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background-color: #409eff;
    transition: width 0.3s ease;
  }

  .error-state {
    color: #f56c6c;
  }
</style>
