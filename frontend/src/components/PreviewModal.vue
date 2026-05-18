<template>
  <div class="modal-overlay" @click.self="handleOverlayClick" :class="{ visible: visible }">
    <div class="modal-container" ref="modalContainerRef">
      <!-- 【新增】8个拖拽手柄 -->
      <div class="resize-handle resize-n" @mousedown="handleResizeMouseDown('n', $event)"></div>
      <div class="resize-handle resize-s" @mousedown="handleResizeMouseDown('s', $event)"></div>
      <div class="resize-handle resize-e" @mousedown="handleResizeMouseDown('e', $event)"></div>
      <div class="resize-handle resize-w" @mousedown="handleResizeMouseDown('w', $event)"></div>
      <div class="resize-handle resize-ne" @mousedown="handleResizeMouseDown('ne', $event)"></div>
      <div class="resize-handle resize-nw" @mousedown="handleResizeMouseDown('nw', $event)"></div>
      <div class="resize-handle resize-se" @mousedown="handleResizeMouseDown('se', $event)"></div>
      <div class="resize-handle resize-sw" @mousedown="handleResizeMouseDown('sw', $event)"></div>
      
      <div class="modal-header">
        <h3>文件预览</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>
      
      <div class="modal-body">
        <!-- 【新增】原生预览模式 -->
        <NativePreviewContainer
          v-if="useNativePreview && !nativePreviewError"
          :key="filePath"  
          ref="nativePreviewRef"
          :file-path="filePath"
          @rendered="handleNativePreviewRendered"
          @error="handleNativePreviewError"
        />
        
        <!-- 【现有】文本预览模式 -->
        <template v-else>
          <div v-if="loading" class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">加载中...</div>
            <div class="loading-hint">正在读取文件内容，请稍候</div>
          </div>
          <div v-else-if="error" class="error" :class="errorSeverity">
            <svg class="error-icon-svg">
              <use :href="errorIconId"/>
            </svg>
            <div class="error-title">{{ errorTitle }}</div>
            <div class="error-text">{{ errorSuggestion }}</div>
            <!-- 【方案 C】文件过大时显示“打开文件”按钮 -->
            <button v-if="isFileSizeError" class="btn btn-primary" @click="handleOpenFile" style="margin-top: 16px;">
              用外部应用打开
            </button>
          </div>
          <div v-else class="preview-content">
            <!-- 【方案 D3】虚拟滚动容器 -->
            <div 
              class="virtual-scroll-container"
              ref="scrollContainer"
            >
              <div class="virtual-spacer" :style="{ height: scroller.getTotalHeight() + 'px' }">
                <div 
                  class="virtual-content"
                  :style="{ transform: `translateY(${scroller.getOffsetTop()}px)` }"
                  v-html="visibleContent"
                >
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
      
      <div class="modal-footer">
        <!-- 左侧提示信息 -->
        <div class="footer-hint">
          <svg class="hint-icon">
            <use href="#icon-info"/>
          </svg>
          <span class="hint-text">预览内容仅供参考，请打开原文件以确保准确性</span>
        </div>
        
        <!-- 右侧按钮组 -->
        <div class="footer-actions">
          <!-- 【新增】模式切换按钮（仅当支持原生预览时显示） -->
          <button 
            v-if="shouldUseNativePreview"
            class="btn btn-toggle" 
            :class="{ active: useNativePreview }"
            @click="togglePreviewMode"
            title="切换预览模式"
          >
            {{ useNativePreview ? '查看高亮版本' : '查看原始格式' }}
          </button>
          
          <button class="btn" :disabled="loading" @click="handleOpenFile">打开文件</button>
          <button class="btn" :disabled="loading || !allLines.length" @click="handleCopyContent">复制内容</button>
          <button class="btn btn-primary" @click="handleClose">{{ loading ? '取消' : '关闭' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { previewFileStream, openFile, cancelPreview, showMessage, onPreviewChunk } from '@/utils/electron-api'
import { getFriendlyErrorMessage, getErrorSeverity } from '@/utils/error-handler'
import { PreviewVirtualScroller, GlobalHighlight, LineHighlight } from '@/utils/preview-virtual-scroller'
import { useEventListener } from '@/composables/useEventListener'
// 【新增】导入可调整大小 composable
import { useResizable } from '@/composables/useResizable'
// 【新增】导入原生预览容器
import NativePreviewContainer from './preview/NativePreviewContainer.vue'

// 【配置常量】UI 渲染参数（与后端独立管理）
const PREVIEW_CONFIG = {
  LINE_HEIGHT: 20,        // 行高（像素）
  BUFFER_LINES: 10,       // 缓冲行数
  SCROLL_DEBOUNCE_MS: 50  // 滚动防抖时间（毫秒）
} as const

const props = defineProps<{
  filePath: string
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const loading = ref(false)
const error = ref('')
const content = ref('')
const highlights = ref<Array<{start: number, end: number, type_id: string, type_name: string}>>([])
const currentTaskId = ref<number | null>(null)  // 当前任务 ID
const errorSeverity = ref<'info' | 'warning' | 'error'>('error')  // 【C2优化】错误严重程度

// 【新增】原生预览相关
const useNativePreview = ref(false)  // 是否使用原生预览
const nativePreviewError = ref<string | null>(null)  // 原生预览错误
const nativePreviewRef = ref<any>(null)  // 原生预览组件引用

// 【新增】窗口调整大小
const modalContainerRef = ref<HTMLElement | null>(null)
const { handleMouseDown: handleResizeMouseDown, resetSize, getIsResizing } = useResizable(modalContainerRef, {
  minWidth: 900,
  minHeight: 600,
  maxWidth: window.innerWidth * 0.95,
  maxHeight: window.innerHeight * 0.95
})

/**
 * 【新增】处理遮罩层点击
 * 如果正在调整大小或刚刚结束调整，不关闭窗口
 */
function handleOverlayClick() {
  if (getIsResizing()) {
    // 正在调整大小时，忽略遮罩层点击
    return
  }
  emit('close')
}

// 【方案 D3】流式接收状态
interface PreviewChunk {
  chunkIndex: number
  lines: string[]
  highlights: Array<{start: number, end: number, typeId: string, typeName: string}>
  startLine: number
  totalLines: number
}

const streamState = ref({
  receivedChunks: [] as PreviewChunk[],
  isRendering: false,
  totalChunks: 0,
  receivedChunksCount: 0
})

// 【关键修复】使用非响应式数组存储海量数据，避免 Vue 响应式开销
const allLines: string[] = []
const allHighlights: GlobalHighlight[] = []

// 【方案 D3】虚拟滚动器
const scroller = new PreviewVirtualScroller(PREVIEW_CONFIG.LINE_HEIGHT, PREVIEW_CONFIG.BUFFER_LINES)

// 【方案 D3】渲染相关
const scrollContainer = ref<HTMLElement | null>(null)
const visibleContent = ref('')  // 可见区域的 HTML
let renderScheduled = false

// 【C2优化】错误图标 ID
const errorIconId = computed(() => {
  switch (errorSeverity.value) {
    case 'info': return '#icon-info'      // ℹ️
    case 'warning': return '#icon-warning'  // ⚠️
    case 'error': return '#icon-error'      // ❌
    default: return '#icon-warning'         // ⚠️
  }
})

// 【C2优化】错误标题
const errorTitle = computed(() => {
  if (!error.value) return ''
  const lines = error.value.split('\n\n')
  return lines[0] || '未知错误'
})

// 【C2优化】错误建议
const errorSuggestion = computed(() => {
  if (!error.value) return ''
  const lines = error.value.split('\n\n')
  return lines[1] || ''
})

// 【方案 C】判断是否是文件大小错误
const isFileSizeError = computed(() => {
  return error.value.includes('文件过大') || error.value.includes('无法预览')
})

// 【新增】判断是否支持原生预览
const supportedNativeFormats = ['docx', 'xlsx', 'xls', 'pdf', 'pptx']

const shouldUseNativePreview = computed(() => {
  const ext = props.filePath.split('.').pop()?.toLowerCase() || ''
  return supportedNativeFormats.includes(ext)
})

// 【新增】处理原生预览错误，自动降级到文本预览
function handleNativePreviewError(errorMessage: string) {
  nativePreviewError.value = errorMessage
  useNativePreview.value = false
  
  // 触发文本预览加载
  loadFile(props.filePath)
}

// 【新增】处理原生预览渲染完成
function handleNativePreviewRendered() {
  loading.value = false
  error.value = ''
}

// 【新增】切换预览模式
function togglePreviewMode() {
  // 清理当前预览
  if (nativePreviewRef.value?.destroy) {
    nativePreviewRef.value.destroy()
  }
  
  // 切换模式
  useNativePreview.value = !useNativePreview.value
  nativePreviewError.value = null
  
  // 重置状态
  loading.value = true
  error.value = ''
  
  // 根据新模式加载内容
  if (useNativePreview.value) {
    // 切换到原生预览，不需要额外操作，组件会自动加载
    loading.value = false
  } else {
    // 切换到文本预览
    loadFile(props.filePath)
  }
}

// 【方案 D3】渲染调度器
function scheduleRender() {
  if (renderScheduled) return
  
  renderScheduled = true
  // 【修复】使用 setTimeout 替代 rAF，确保在当前宏任务结束后再执行，避开 Vue 响应式同步追踪
  setTimeout(() => {
    renderScheduled = false
    performBatchRender()
  }, 0)
}

async function performBatchRender() {
  if (streamState.value.isRendering) return
  
  streamState.value.isRendering = true
  
  try {
    const chunksToRender = [...streamState.value.receivedChunks]
    streamState.value.receivedChunks = []
    
    if (chunksToRender.length === 0) {
      streamState.value.isRendering = false
      return
    }
    
    if (!props.visible) {
      streamState.value.isRendering = false
      return
    }
    
    chunksToRender.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    // 【关键修复】直接操作非响应式数组，零开销
    for (const chunk of chunksToRender) {
      allLines.push(...chunk.lines)
      allHighlights.push(...chunk.highlights)
    }
    
    // 更新虚拟滚动器（传入非响应式数组）
    scroller.updateData(allLines)
    
    if (streamState.value.receivedChunksCount <= chunksToRender.length) {
      loading.value = false
    }
    
    if (!props.visible) {
      streamState.value.isRendering = false
      return
    }
    
    await nextTick()
    renderVisibleContent()
    
  } catch (e) {
    console.error('Render error:', e)
  } finally {
    streamState.value.isRendering = false
    
    if (streamState.value.receivedChunks.length > 0 && props.visible) {
      setTimeout(scheduleRender, 0)
    }
  }
}

// 渲染可见区域
function renderVisibleContent() {
  if (!scrollContainer.value) return
  
  const viewportHeight = scrollContainer.value.clientHeight
  const scrollTop = scrollContainer.value.scrollTop
  
  scroller.calculateVisibleRange(scrollTop, viewportHeight)
  const { lines, startIndex } = scroller.getVisibleLines()
  
  if (lines.length === 0) {
    visibleContent.value = ''
    return
  }
  
  // 【修复】直接从非响应式数组获取偏移量
  const visibleStartOffset = scroller.getLineOffset(startIndex)
  const visibleEndOffset = scroller.getLineOffset(startIndex + lines.length)
  
  // 【修复】从非响应式数组过滤高亮
  const visibleHighlights = allHighlights.filter(h => {
    return h.start < visibleEndOffset && h.end > visibleStartOffset
  })
  
  const lineHighlightsMap = scroller.convertHighlights(visibleHighlights)
  
  let html = ''
  for (let i = 0; i < lines.length; i++) {
    const lineIndex = startIndex + i
    const lineText = lines[i]
    const lineHighlights = lineHighlightsMap.get(lineIndex) || []
    
    const highlightedLine = highlightLine(lineText, lineHighlights)
    html += `<div class="code-line" data-line="${lineIndex}">${highlightedLine}</div>`
  }
  
  visibleContent.value = html
}

// 高亮单行
function highlightLine(text: string, highlights: LineHighlight[]): string {
  if (highlights.length === 0) {
    return escapeHtml(text)
  }
  
  const sorted = [...highlights].sort((a, b) => a.localStart - b.localStart)
  
  let result = ''
  let lastIndex = 0
  
  for (const highlight of sorted) {
    result += escapeHtml(text.substring(lastIndex, highlight.localStart))
    
    const highlightedText = escapeHtml(text.substring(highlight.localStart, highlight.localEnd))
    const colorClass = getColorClass(highlight.typeId)
    const safeTypeName = escapeHtml(highlight.typeName)  // 【P1修复】转义 typeName，防止 XSS
    result += `<mark class="${colorClass}" title="${safeTypeName}">${highlightedText}</mark>`
    
    lastIndex = highlight.localEnd
  }
  
  if (lastIndex < text.length) {
    result += escapeHtml(text.substring(lastIndex))
  }
  
  return result
}

// HTML 转义
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// 获取颜色类
function getColorClass(typeId: string): string {
  const typeMap: Record<string, string> = {
    'phone': 'highlight-phone',
    'id_card': 'highlight-id-card',
    'bank_card': 'highlight-bank-card',
    'email': 'highlight-email',
    'ip_address': 'highlight-ip',
    'url': 'highlight-url'
  }
  return typeMap[typeId] || 'highlight-default'
}

// 监听 visible 和 filePath 的组合变化
watch([() => props.visible, () => props.filePath], async ([isVisible, newPath]) => {
  if (isVisible && newPath) {
    // 窗口打开且有文件路径时，立即加载
    // 使用 requestAnimationFrame 确保在下一帧才设置 loading，让窗口先显示
    requestAnimationFrame(() => {
      loading.value = true
      error.value = ''
      content.value = ''
      highlights.value = []
      nativePreviewError.value = null
      
      // 【新增】每次打开时重置窗口大小为默认值
      resetSize()
      
      // 判断是否使用原生预览
      if (shouldUseNativePreview.value) {
        useNativePreview.value = true
      } else {
        useNativePreview.value = false
        loadFile(newPath)
      }
    })
  } else if (!isVisible) {
    // 窗口关闭时，取消当前任务并清空状态
    // 【方案 B】取消正在进行的预览任务（传入 taskId）
    if (currentTaskId.value !== null) {
      try {
        await cancelPreview(currentTaskId.value)  // ✅ 传入 taskId
      } catch (err) {
        // 忽略错误
      }
      currentTaskId.value = null
    }
    
    // 【新增】清理原生预览组件
    if (nativePreviewRef.value?.destroy) {
      nativePreviewRef.value.destroy()
    }
    
    // 【关键修复】重置原生预览状态，确保下次打开时能正确加载
    useNativePreview.value = false
    nativePreviewError.value = null
    
    // 【优化】如果 handleClose 已经异步清空了数据，这里不需要再清空
    // 只重置 loading 和 error 状态即可
    loading.value = false
    error.value = ''
  }
}, { immediate: true })

async function loadFile(filePath: string) {
  const taskId = Date.now()
  currentTaskId.value = taskId
  
  // 【修复】重置非响应式数组
  allLines.length = 0
  allHighlights.length = 0
  streamState.value.receivedChunks = []
  streamState.value.isRendering = false
  streamState.value.totalChunks = 0
  streamState.value.receivedChunksCount = 0
  scroller.reset()
  visibleContent.value = ''
  
  let unsubscribe: (() => void) | null = null
  
  try {
    // 【方案 D3】监听数据块
    unsubscribe = await onPreviewChunk((chunk: PreviewChunk) => {
      if (currentTaskId.value !== taskId) return  // 已取消
      
      streamState.value.receivedChunks.push(chunk)
      streamState.value.receivedChunksCount++
      
      // 如果是第一块，记录总行数
      if (chunk.chunkIndex === 0) {
        streamState.value.totalChunks = Math.ceil(chunk.totalLines / chunk.lines.length)
      }
      
      // 触发渲染
      scheduleRender()
    })
    
    // 【方案 D3】启动流式预览
    const result = await previewFileStream(filePath)
    
    // 检查是否被取消
    if (currentTaskId.value !== taskId) {
      unsubscribe?.()
      return
    }
    
    // 检查错误
    if (!result.success) {
      error.value = getFriendlyErrorMessage('预览失败')
      errorSeverity.value = 'error'
      unsubscribe?.()
      return
    }
    
    // 【优化】不需要等待，数据已经通过事件接收
    unsubscribe?.()
    
  } catch (err) {
    // 确保取消订阅，防止内存泄漏
    unsubscribe?.()
    
    // 如果是取消错误，不显示错误信息
    if (String(err).includes('已取消')) {
      return
    }
    error.value = getFriendlyErrorMessage(err)
    errorSeverity.value = getErrorSeverity(err)
  } finally {
    loading.value = false
    if (currentTaskId.value === taskId) {
      currentTaskId.value = null
    }
  }
}

const handleOpenFile = async () => {
  if (props.filePath) {
    try {
      await openFile(props.filePath)
    } catch (err) {
      await showMessage(getFriendlyErrorMessage(err), { type: 'error' })
    }
  }
}

const handleCopyContent = async () => {
  try {
    // 【修复】从非响应式数组获取内容
    const fullText = allLines.join('\n')
    
    if (!fullText) {
      await showMessage('暂无内容可复制', { type: 'warning' })
      return
    }
    
    await navigator.clipboard.writeText(fullText)
    await showMessage('已复制到剪贴板', { type: 'info' })
  } catch (err) {
    await showMessage(getFriendlyErrorMessage(err), { type: 'error' })
  }
}

// 【方案 B】处理关闭/取消
const handleClose = () => {
  if (loading.value && currentTaskId.value !== null) {
    // 正在加载时，点击“取消”按钮
    // 立即关闭对话框，后台继续取消任务
    emit('close')
    // 不等待取消完成，避免阻塞 UI
    cancelPreview(currentTaskId.value).catch(() => {})
  } else {
    // 【优化】正常关闭前，先停止渲染调度，防止竞态条件
    renderScheduled = false
    
    // 【优化】异步清空大数据
    setTimeout(() => {
      allLines.length = 0
      allHighlights.length = 0
      streamState.value.receivedChunks = []
      streamState.value.isRendering = false
      streamState.value.totalChunks = 0
      streamState.value.receivedChunksCount = 0
      
      scroller.reset()
      visibleContent.value = ''
    }, 0)
    
    // 立即关闭，让 UI 先响应
    emit('close')
  }
}

// 【优化】使用 useEventListener 自动管理 scroll 事件和防抖
useEventListener(scrollContainer, 'scroll', {
  handler: renderVisibleContent,
  rateLimit: { type: 'debounce', delay: PREVIEW_CONFIG.SCROLL_DEBOUNCE_MS }
})
</script>

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
  /* 默认隐藏 */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
}

.modal-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}

.modal-container {
  background-color: var(--modal-bg);
  color: var(--text-color);
  border-radius: 8px;
  width: min(90%, 1024px);
  height: min(90%, 768px);
  min-width: 900px;
  min-height: 600px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  /* 动画效果 */
  transform: scale(0.95) translateY(10px);
  opacity: 0;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), 
              opacity 0.2s ease-out;
  /* 【新增】支持定位，用于调整大小时更新位置 */
  position: relative;
}

/* 【新增】拖拽手柄基础样式 */
.resize-handle {
  position: absolute;
  z-index: 100;
  /* 完全透明，不显示任何视觉反馈 */
  background-color: transparent;
}

/* 四个边 */
.resize-n {
  top: -5px;
  left: 20px;
  right: 20px;
  height: 10px;
  cursor: n-resize;
}

.resize-s {
  bottom: -5px;
  left: 20px;
  right: 20px;
  height: 10px;
  cursor: s-resize;
}

.resize-e {
  right: -5px;
  top: 20px;
  bottom: 20px;
  width: 10px;
  cursor: e-resize;
}

.resize-w {
  left: -5px;
  top: 20px;
  bottom: 20px;
  width: 10px;
  cursor: w-resize;
}

/* 四个角 */
.resize-ne {
  top: -5px;
  right: -5px;
  width: 20px;
  height: 20px;
  cursor: ne-resize;
}

.resize-nw {
  top: -5px;
  left: -5px;
  width: 20px;
  height: 20px;
  cursor: nw-resize;
}

.resize-se {
  bottom: -5px;
  right: -5px;
  width: 20px;
  height: 20px;
  cursor: se-resize;
}

.resize-sw {
  bottom: -5px;
  left: -5px;
  width: 20px;
  height: 20px;
  cursor: sw-resize;
}

.modal-overlay.visible .modal-container {
  transform: scale(1) translateY(0);
  opacity: 1;
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
  transition: all 0.2s ease;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: var(--text-color);
  background-color: var(--bg-hover);
  transform: rotate(90deg);
}

.modal-body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.error {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top: 4px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  font-size: 16px;
  color: var(--text-color);
  font-weight: 500;
}

.loading-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
}

/* 【C2优化】不同严重程度的错误样式 */
.error.info {
  color: var(--primary-color);
}

.error.warning {
  color: #faad14;
}

.error.error {
  color: var(--error-color);
}

.error-icon-svg {
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
}

.error-title {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

.error-text {
  font-size: 14px;
  text-align: center;
  max-width: 80%;
  white-space: pre-line;
  line-height: 1.6;
}

.preview-content {
  height: 100%;
}

.preview-content pre {
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 【方案 D3】虚拟滚动容器 */
.virtual-scroll-container {
  height: 100%;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}

.virtual-spacer {
  position: relative;
  width: 100%;
}

.virtual-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.code-line {
  height: 20px;
  line-height: 20px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  white-space: pre;
  padding: 0 10px;
  color: var(--text-color);
}

/* 高亮样式 */
.highlight-phone { background-color: #ffe58f; }
.highlight-id-card { background-color: #ffd6e7; }
.highlight-bank-card { background-color: #d9f7be; }
.highlight-email { background-color: #bae0ff; }
.highlight-ip { background-color: #ffd591; }
.highlight-url { background-color: #b7eb8f; }
.highlight-default { background-color: #fff566; }

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;  /* 【优化】左右分布 */
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
}

/* 【新增】左侧提示信息样式 */
.footer-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;  /* 占据剩余空间 */
  min-width: 0;  /* 允许文本截断 */
}

.hint-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.hint-text {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 【新增】右侧按钮组 */
.footer-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;  /* 按钮不被压缩 */
}

.btn {
  padding: 6px 16px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}

.btn:hover {
  background-color: var(--bg-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.btn:active {
  transform: translateY(0);
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background-color: #40a9ff;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
}

.btn-primary:active {
  transform: translateY(0);
}

/* 【方案 B】禁用状态的按钮样式 */
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.btn:disabled:hover {
  background-color: var(--bg-color);
  transform: none;
  box-shadow: none;
}

/* 【新增】模式切换按钮样式 */
.btn-toggle {
  background-color: #f0f0f0;
  border-color: #d9d9d9;
  color: #666;
  font-weight: 500;
}

.btn-toggle:hover {
  background-color: #e6e6e6;
  border-color: #40a9ff;
  color: #40a9ff;
}

.btn-toggle.active {
  background-color: #40a9ff;
  border-color: #40a9ff;
  color: white;
}

.btn-toggle.active:hover {
  background-color: #1890ff;
  border-color: #1890ff;
}
</style>
