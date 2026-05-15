<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-container">
      <div class="modal-header">
        <h3>设置</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>
      
      <div class="modal-body">
        <div class="settings-section">
          <h4>外观设置</h4>
          
          <div class="setting-item">
            <label>主题模式</label>
            <select v-model="config.theme" class="theme-select">
              <option value="light">浅色主题</option>
              <option value="dark">深色主题</option>
              <option value="system">跟随系统</option>
            </select>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>扫描配置</h4>
          
          <div class="setting-item">
            <label>最大文件大小 (MB)</label>
            <input 
              type="number" 
              v-model.number="config.maxFileSizeMb"
              min="1"
              max="500"
            />
          </div>
          
          <div class="setting-item">
            <label>PDF 最大大小 (MB)</label>
            <input 
              type="number" 
              v-model.number="config.maxPdfSizeMb"
              min="1"
              max="1000"
            />
          </div>
          
          <div class="setting-item">
            <label>扫描并发数</label>
            <input 
              type="number" 
              v-model.number="config.scanConcurrency"
              min="1"
              max="16"
            />
          </div>
        </div>
        
        <div class="settings-section">
          <h4>敏感词规则</h4>
          
          <div class="setting-item">
            <label>
              <input 
                type="checkbox" 
                v-model="config.enableBuiltinRules"
              />
              <span>启用内置敏感词扫描规则</span>
            </label>
            <p class="setting-hint">
              启用后将检测身份证号、手机号、邮箱、银行卡号等敏感信息。<br/>
              取消勾选则仅使用关键字搜索功能。
            </p>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>文件操作</h4>
          
          <div class="setting-item">
            <label>删除文件时移入回收站</label>
            <input 
              type="checkbox" 
              v-model="config.deleteToTrash"
            />
            <span class="hint">（取消勾选则永久删除）</span>
          </div>
          
          <div class="setting-item" v-if="isWindows">
            <label>忽略其他磁盘的系统目录</label>
            <input 
              type="checkbox" 
              v-model="config.ignoreOtherDrivesSystemDirs"
            />
            <span class="hint">（启用后将忽略 D-Z 盘的 Windows、Program Files 等系统目录）</span>
          </div>
          
          <div class="setting-item">
            <button class="btn-clear-cache" @click="handleClearCache">
              <svg class="btn-icon"><use href="#icon-delete"/></svg>
              清理应用缓存
            </button>
            <span class="hint">（清理 Chromium 缓存和临时文件）</span>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>敏感类型管理</h4>
          <div class="sensitive-types">
            <label v-for="type in sensitiveTypes" :key="type.id" class="type-item">
              <input 
                type="checkbox"
                :checked="config.enabledSensitiveTypes.includes(type.id)"
                @change="toggleSensitiveType(type.id, $event)"
              />
              {{ type.name }}
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>忽略目录名（任意位置）</h4>
          <p class="section-hint">这些名称的目录在任何位置都会被忽略，如 node_modules、.git 等</p>
          <div class="ignore-dirs">
            <div v-for="(dir, index) in config.ignoreDirNames" :key="index" class="dir-item">
              <span>{{ dir }}</span>
              <button class="btn-remove" @click="removeIgnoreDir(index)">×</button>
            </div>
            <div class="add-dir">
              <input 
                type="text" 
                v-model="newIgnoreDir"
                placeholder="输入目录名"
                @keyup.enter="addIgnoreDir"
              />
              <button class="btn-small" @click="addIgnoreDir">添加</button>
            </div>
          </div>
        </div>
        
        <div class="settings-section">
          <h4>系统目录路径（特定位置）</h4>
          <p class="section-hint">只有匹配这些完整路径的目录才会被忽略，如 C:\Windows、/usr 等</p>
          <div class="ignore-dirs">
            <div v-for="(dir, index) in config.systemDirs" :key="index" class="dir-item">
              <span>{{ dir }}</span>
              <button class="btn-remove" @click="removeSystemDir(index)">×</button>
            </div>
            <div class="add-dir">
              <input 
                type="text" 
                v-model="newSystemDir"
                placeholder="输入完整路径"
                @keyup.enter="addSystemDir"
              />
              <button class="btn-small" @click="addSystemDir">添加</button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" @click="handleSave">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import {useAppStore} from '@/stores/app'
import {storeToRefs} from 'pinia'
import {clearCache, getRecommendedConcurrency, getSensitiveRules, saveConfig} from '@/utils/electron-api'
import {applyTheme} from '@/utils/theme'
// 【C2 优化】导入错误处理工具
import {getFriendlyErrorMessage} from '@/utils/error-handler'

const emit = defineEmits<{
  close: []
}>()

const appStore = useAppStore()
const { config } = storeToRefs(appStore)

const newIgnoreDir = ref('')
const newSystemDir = ref('')
const sensitiveTypes = ref<Array<{id: string, name: string}>>([])

// 检测是否为 Windows 系统
const isWindows = computed(() => {
  return navigator.userAgent.toLowerCase().includes('win')
})

onMounted(async () => {
  try {
    const rules = await getSensitiveRules()
    // 后端返回的是 [id, name] 元组数组
    sensitiveTypes.value = rules.map(([id, name]: [string, string]) => ({ id, name }))
    
    // 如果配置中的并发数为 0，则使用系统推荐的值
    if (config.value.scanConcurrency === 0) {
      config.value.scanConcurrency = await getRecommendedConcurrency()
    }
  } catch (error) {
    console.error('获取敏感规则失败:', error)
  }
})

const toggleSensitiveType = (typeId: string, event: Event) => {
  const checked = (event.target as HTMLInputElement).checked
  
  if (checked) {
    if (!config.value.enabledSensitiveTypes.includes(typeId)) {
      config.value.enabledSensitiveTypes.push(typeId)
    }
  } else {
    config.value.enabledSensitiveTypes = config.value.enabledSensitiveTypes.filter(
      id => id !== typeId
    )
  }
}

const addIgnoreDir = () => {
  if (newIgnoreDir.value.trim()) {
    config.value.ignoreDirNames.push(newIgnoreDir.value.trim())
    newIgnoreDir.value = ''
  }
}

const removeIgnoreDir = (index: number) => {
  config.value.ignoreDirNames.splice(index, 1)
}

const addSystemDir = () => {
  if (newSystemDir.value.trim()) {
    config.value.systemDirs.push(newSystemDir.value.trim())
    newSystemDir.value = ''
  }
}

const removeSystemDir = (index: number) => {
  config.value.systemDirs.splice(index, 1)
}

const handleSave = async () => {
  try {
    // 将Proxy对象转换为普通对象，以便通过IPC传递
    const plainConfig = JSON.parse(JSON.stringify(config.value))
    await saveConfig(plainConfig)
    // 应用主题设置
    applyTheme(config.value.theme as any)
    // 【C2 优化】静默成功，不显示提示
    emit('close')
  } catch (error) {
    console.error('保存配置失败:', error)
    alert(getFriendlyErrorMessage(error))
  }
}

const handleClearCache = async () => {
  if (!confirm('确定要清理应用缓存吗？\n这将删除 Chromium 缓存和临时文件。')) {
    return
  }
  
  try {
    const result = await clearCache()
    const sizeMB = Math.round((result.cleanedSize || 0) / 1024 / 1024)
    // 【C2 优化】友好的成功提示
    alert(`缓存清理完成！\n\n释放空间: ${sizeMB} MB`)
  } catch (error) {
    console.error('清理缓存失败:', error)
    alert(getFriendlyErrorMessage(error))
  }
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
  color: #333;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section h4 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.section-hint {
  font-size: 12px;
  color: #999;
  margin-top: -8px;
  margin-bottom: 12px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.setting-item label {
  font-size: 13px;
}

.setting-item input[type="number"] {
  width: 100px;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--input-bg);
  color: var(--text-color);
}

.theme-select {
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--input-bg);
  color: var(--text-color);
  cursor: pointer;
}

.setting-item input[type="checkbox"] {
  cursor: pointer;
}

.hint {
  font-size: 12px;
  color: #999;
  margin-left: 8px;
}

.sensitive-types {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.type-item {
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ignore-dirs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dir-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background-color: var(--bg-hover);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-color);
}

.btn-remove {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
}

.btn-remove:hover {
  color: var(--error-color);
}

.add-dir {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.add-dir input {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 13px;
  background-color: var(--input-bg);
  color: var(--text-color);
}

.btn-small {
  padding: 5px 12px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-small:hover {
  background-color: var(--bg-hover);
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

.btn-clear-cache {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* 【新增】按钮内 SVG 图标 */
.btn-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.btn-clear-cache:hover {
  background-color: var(--bg-hover);
  border-color: var(--primary-color);
}
</style>
