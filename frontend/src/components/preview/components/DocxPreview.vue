<template>
  <div class="docx-preview-container" :style="{ transform: `scale(${scale})`, transformOrigin: 'top center' }">
    <VueOfficeDocx
      v-if="docxBlob"
      :src="docxBlob"
      :options="docxOptions"
      @rendered="handleRendered"
      @error="handleError"
    />
    <div v-else-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在加载文档...</p>
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

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import VueOfficeDocx from '@vue-office/docx'
import '@vue-office/docx/lib/index.css'
import { readFileAsBlob } from '../utils/file-reader'

const props = defineProps<{
  filePath: string
}>()

const emit = defineEmits<{
  rendered: []
  error: [message: string]
}>()

// 状态管理
const loading = ref(true)
const error = ref<string | null>(null)
const docxBlob = ref<Blob | null>(null)
const scale = ref(1.0)
const progress = ref(0)

// Docx 配置选项
const docxOptions = {
  inWrapper: true,        // 在包装器中渲染
  ignoreWidth: false,     // 不忽略宽度
  ignoreHeight: false,    // 不忽略高度
  ignoreFonts: false,     // 不忽略字体
  breakPages: true,       // 分页显示
  debug: false,           // 关闭调试模式
  experimentalCacheTables: true  // 启用表格缓存
}

/**
 * 加载文档
 */
async function loadDocument(filePath: string): Promise<void> {
  console.log('[DocxPreview] 开始加载文档:', filePath)
  try {
    loading.value = true
    error.value = null
    progress.value = 0
    
    const result = await readFileAsBlob(filePath)
    console.log('[DocxPreview] 文件读取结果:', result.success ? '成功' : '失败', result.error || '')
    
    if (!result.success || !result.data) {
      throw new Error(result.error || '读取文件失败')
    }
    
    // 将 ArrayBuffer 转换为 Blob
    const blob = new Blob([result.data], { 
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
    })
    docxBlob.value = blob
    console.log('[DocxPreview] Blob 创建成功，大小:', blob.size, 'bytes')
    
  } catch (err: any) {
    error.value = `加载失败: ${err.message}`
    emit('error', error.value)
    console.error('[DocxPreview] 加载错误:', err)
  } finally {
    loading.value = false
  }
}

/**
 * 渲染完成处理
 */
function handleRendered() {
  loading.value = false
  progress.value = 100
  emit('rendered')
}

/**
 * 错误处理
 */
function handleError(e: any) {
  loading.value = false
  error.value = '文档渲染失败，请尝试切换到文本预览模式'
  emit('error', error.value)
  console.error('[DocxPreview] Render error:', e)
}

/**
 * 销毁组件，释放资源
 */
function destroy() {
  // 释放 Blob URL
  if (docxBlob.value) {
    URL.revokeObjectURL(URL.createObjectURL(docxBlob.value))
    docxBlob.value = null
  }
  
  // 重置状态
  loading.value = false
  error.value = null
  scale.value = 1.0
  progress.value = 0
}

// 组件卸载时清理资源
onUnmounted(() => {
  destroy()
})

// 初始加载
loadDocument(props.filePath)

// 暴露接口给父组件
defineExpose({
  loadDocument,
  destroy,
  loading,
  error,
  scale
})
</script>

<style scoped>
.docx-preview-container {
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: #f5f5f5;
  transition: transform 0.2s ease;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
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
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.progress-bar {
  width: 200px;
  height: 4px;
  background-color: #e0e0e0;
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
