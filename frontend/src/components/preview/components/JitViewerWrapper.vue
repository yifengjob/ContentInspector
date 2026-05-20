<script setup lang="ts">
  import { onMounted, onUnmounted, ref, watch } from 'vue';
  import { createViewer, type ViewerInstance } from 'jit-viewer';
  import 'jit-viewer/style.css';
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
  const viewerContainer = ref<HTMLDivElement | null>(null);
  let viewerInstance: ViewerInstance | null = null;

  /**
   * 初始化 Viewer
   */
  async function initViewer(filePath: string): Promise<void> {
    try {
      loading.value = true;
      error.value = null;

      // 如果已存在实例，先销毁
      if (viewerInstance) {
        viewerInstance.destroy();
        viewerInstance = null;
      }

      // 读取文件为 Blob
      const result = await readFileAsBlob(filePath);
      if (!result.success || !result.data) {
        throw new Error(result.error || '读取文件失败');
      }

      // 将 ArrayBuffer 转换为 Blob
      const fileBlob = new Blob([result.data]);

      // 获取容器元素
      if (!viewerContainer.value) {
        throw new Error('Viewer 容器未就绪');
      }

      // 创建 Viewer 实例
      viewerInstance = createViewer({
        target: viewerContainer.value,
        file: fileBlob,
        theme: 'light', // 可根据应用主题动态切换
        locale: 'zh-CN', // 中文界面
        toolbar: true, // 启用内置工具栏
        width: '100%',
        height: '100%',
      });

      // 挂载 Viewer
      viewerInstance.mount();

      // jit-viewer 不提供 onLoad 回调，需要手动检测加载状态
      // 策略：等待一段时间后隐藏 loading（因为 mount() 是同步的）
      // 对于大文件，jit-viewer 内部会显示自己的 loading 指示器
      setTimeout(() => {
        loading.value = false;
        emit('rendered');
      }, 500); // 500ms 延迟，确保渲染开始
    } catch (_err) {
      const errorMessage = _err instanceof Error ? _err.message : '未知错误';
      loading.value = false;
      error.value = `初始化失败: ${errorMessage}`;
      emit('error', error.value);
    }
  }

  /**
   * 加载文档（对外暴露的接口）
   */
  async function loadDocument(filePath: string): Promise<void> {
    await initViewer(filePath);
  }

  /**
   * 销毁组件，释放资源
   */
  function destroy() {
    if (viewerInstance) {
      viewerInstance.destroy();
      viewerInstance = null;
    }
    loading.value = false;
    error.value = null;
  }

  // 监听 filePath 变化，重新加载
  watch(
    () => props.filePath,
    (newPath) => {
      if (newPath) {
        loadDocument(newPath);
      }
    }
  );

  // 组件卸载时清理
  onUnmounted(() => {
    destroy();
  });

  // 组件挂载后初始化
  onMounted(() => {
    if (props.filePath) {
      loadDocument(props.filePath);
    }
  });

  // 暴露接口给父组件
  defineExpose({
    loadDocument,
    destroy,
    loading,
    error,
  });
</script>

<template>
  <div class="jit-viewer-wrapper">
    <!-- Viewer 容器 -->
    <div ref="viewerContainer" class="viewer-container"></div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在加载文档...</p>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <svg class="error-icon">
        <use href="#icon-warning" />
      </svg>
      <p>{{ error }}</p>
      <p class="hint">请尝试切换到文本预览模式</p>
    </div>
  </div>
</template>

<style scoped>
  .jit-viewer-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .viewer-container {
    width: 100%;
    height: 100%;
  }

  .loading-state,
  .error-state {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, 0.95);
    color: #666;
    z-index: 10;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
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

  .error-icon {
    width: 48px;
    height: 48px;
    margin-bottom: 16px;
    fill: #f56c6c;
  }

  .error-state p {
    margin: 8px 0;
    font-size: 14px;
  }

  .error-state {
    color: #f56c6c;
  }

  .hint {
    font-size: 12px;
    color: #999;
  }
</style>
