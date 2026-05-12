<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-container">
      <div class="modal-header">
        <h3>扫描日志</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>
      
      <div class="modal-body" ref="logsContainer">
        <div v-if="logs.length === 0" class="empty-logs">
          <p>暂无日志信息</p>
        </div>
        <div v-else class="logs-content">
          <div 
            v-for="(log, index) in logs" 
            :key="index" 
            class="log-item"
            :class="getLogLevelClass(log)"
          >
            {{ log }}
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn" @click="handleClearLogs">清空日志</button>
        <button class="btn btn-primary" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from 'vue'
import { useAppStore } from '@/stores/app'
import { storeToRefs } from 'pinia'
import { getLogs } from '@/utils/electron-api'

const appStore = useAppStore()
const { logs } = storeToRefs(appStore)

const logsContainer = ref<HTMLDivElement | null>(null)

// 保存上一次的日志长度，用于比较
const previousLength = ref(0)

defineEmits<{
  close: []
}>()

// 滚动到底部
const scrollToBottom = async () => {
  await nextTick()
  if (logsContainer.value) {
    logsContainer.value.scrollTop = logsContainer.value.scrollHeight
  }
}

// 监听日志变化，自动滚动到底部
watch(
  () => logs.value,
  (newLogs) => {
    const currentLength = newLogs.length
    
    // 只要有新日志就滚动
    if (currentLength > previousLength.value) {
      // 延迟一点执行，确保 DOM 完全渲染
      setTimeout(() => {
        scrollToBottom()
      }, 50)
    }
    
    // 更新上一次的长度
    previousLength.value = currentLength
  },
  { 
    deep: true,
    flush: 'post'
  }
)

// 组件挂载时从后端获取日志
onMounted(async () => {
  try {
    // 只在 logs 为空时才从后端加载
    if (logs.value.length === 0) {
      const backendLogs = await getLogs()
      if (backendLogs.length > 0) {
        logs.value.push(...backendLogs)
      }
    }
    
    // 初始化 previousLength
    previousLength.value = logs.value.length
    
    // 初始加载后滚动到底部
    await scrollToBottom()
  } catch (error) {
    console.error('获取日志失败:', error)
  }
})

// 根据日志内容获取对应的级别 class
const getLogLevelClass = (log: string): string => {
  if (log.includes('[ERROR]')) return 'error'
  if (log.includes('[WARN]')) return 'warn'
  if (log.includes('[INFO]')) return 'info'
  if (log.includes('[DEBUG]')) return 'debug'
  return ''
}

const handleClearLogs = () => {
  logs.value.splice(0, logs.value.length)
}
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
}

.modal-container {
  background-color: var(--modal-bg);
  color: var(--text-color);
  border-radius: 8px;
  width: min(700px, 90vw);
  height: min(60vh, 500px);
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
  padding: 20px;
}

.empty-logs {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.logs-content {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.8;
}

.log-item {
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color);
  word-break: break-all;
  color: var(--text-color);
}

.log-item.error {
  color: var(--error-color);
  background-color: rgba(255, 77, 79, 0.05);
}

.log-item.warn {
  color: var(--warning-color);
  background-color: rgba(250, 173, 20, 0.05);
}

.log-item.info {
  color: var(--text-color);
}

.log-item.debug {
  color: var(--text-secondary);
  font-style: italic;
}

.modal-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
}

.btn {
  padding: 6px 16px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn:hover {
  background-color: var(--bg-hover);
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.btn-primary:hover {
  background-color: #40a9ff;
}
</style>
