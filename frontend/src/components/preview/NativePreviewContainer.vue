<script setup lang="ts">
  import { ref, computed, watch, onUnmounted } from 'vue';
  import DocxPreview from './components/DocxPreview.vue';
  import ExcelPreview from './components/ExcelPreview.vue';
  import PdfPreview from './components/PdfPreview.vue';
  import PptxPreview from './components/PptxPreview.vue';

  const props = defineProps<{
    filePath: string;
  }>();

  const emit = defineEmits<{
    rendered: [];
    error: [message: string];
  }>();

  // 获取文件扩展名
  const fileType = computed(() => {
    return props.filePath.split('.').pop()?.toLowerCase() || '';
  });

  // 预览组件引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previewComponent = ref<any>(null);

  // 加载状态
  const loading = computed(() => {
    return previewComponent.value?.loading ?? true;
  });

  // 错误信息
  const error = computed(() => {
    return previewComponent.value?.error ?? null;
  });

  /**
   * 渲染完成处理
   */
  function handleRendered() {
    emit('rendered');
  }

  /**
   * 错误处理
   */
  function handleError(message: string) {
    emit('error', message);
  }

  /**
   * 销毁组件，释放资源
   */
  function destroy() {
    if (previewComponent.value?.destroy) {
      previewComponent.value.destroy();
    }
  }

  // 监听 filePath 变化，重新加载
  watch(
    () => props.filePath,
    (newPath) => {
      if (previewComponent.value?.loadDocument) {
        previewComponent.value.loadDocument(newPath);
      }
    },
    { immediate: false }
  );

  // 组件卸载时清理
  onUnmounted(() => {
    destroy();
  });

  // 暴露接口给父组件
  defineExpose({
    loading,
    error,
    destroy,
  });
</script>

<template>
  <div class="native-preview-container">
    <!-- Word 文档预览 -->
    <DocxPreview
      v-if="fileType === 'docx'"
      ref="previewComponent"
      :file-path="filePath"
      @rendered="handleRendered"
      @error="handleError"
    />

    <!-- Excel 表格预览 -->
    <ExcelPreview
      v-else-if="fileType === 'xlsx' || fileType === 'xls'"
      ref="previewComponent"
      :file-path="filePath"
      @rendered="handleRendered"
      @error="handleError"
    />

    <!-- PDF 文档预览 -->
    <PdfPreview
      v-else-if="fileType === 'pdf'"
      ref="previewComponent"
      :file-path="filePath"
      @rendered="handleRendered"
      @error="handleError"
    />

    <!-- PowerPoint 演示文稿预览 -->
    <PptxPreview
      v-else-if="fileType === 'pptx'"
      ref="previewComponent"
      :file-path="filePath"
      @rendered="handleRendered"
      @error="handleError"
    />

    <!-- 不支持的格式 -->
    <div v-else class="unsupported-format">
      <svg class="unsupported-icon">
        <use href="#icon-warning" />
      </svg>
      <p>该文件格式不支持原生预览</p>
      <p class="hint">请使用文本预览模式查看</p>
    </div>
  </div>
</template>

<style scoped>
  .native-preview-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: #f5f5f5;
  }

  .unsupported-format {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
  }

  .unsupported-icon {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    fill: #999;
  }

  .unsupported-format p {
    margin: 8px 0;
    font-size: 14px;
  }

  .hint {
    font-size: 12px;
    color: #999;
  }
</style>
