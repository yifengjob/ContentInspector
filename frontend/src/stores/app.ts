import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {ScanResultItem, AppConfig, DirectoryNode} from '@/types'
// 【D2 优化】导入 UI 配置常量
import {MAX_FRONTEND_LOGS, UI_BATCH_UPDATE_INTERVAL, UI_LOG_BATCH_INTERVAL} from '@/config/ui-config'

export const useAppStore = defineStore('app', () => {
  // 扫描结果
  const scanResults = ref<ScanResultItem[]>([])
  
  // 扫描状态
  const isScanning = ref(false)
  const scannedCount = ref(0)
  const totalCount = ref(0)      // ← 新增：遍历的文件总数
  const filteredCount = ref(0)   // 【新增】用户主动过滤的文件数
  const skippedCount = ref(0)    // 【修改】系统跳过的文件数（原 errorCount）
  const currentFile = ref('')
  const logs = ref<string[]>([])
  const scanStartTime = ref<number | null>(null)  // 【UI优化】扫描开始时间
  
  // 配置
  const config = ref<AppConfig>({
    selectedPaths: [],
    selectedExtensions: [
      'txt', 'log', 'md', 'ini', 'conf', 'cfg', 'env',
      'js', 'ts', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'php', 'rb', 'swift',
      'csv', 'json', 'xml', 'yaml', 'yml', 'properties', 'toml',
      'pdf',
    ],
    enabledSensitiveTypes: [
      'person_id', 'phone', 'email', 'bank_card', 
      'address', 'ip_address', 'password'
    ],
    ignoreDirNames: ['node_modules', '.git', 'System Volume Information'],
    systemDirs: [], // 会在加载配置时从后端获取
    maxFileSizeMb: 25, // 与后端 DEFAULT_MAX_FILE_SIZE_MB 保持一致
    maxPdfSizeMb: 50,  // 与后端 DEFAULT_MAX_PDF_SIZE_MB 保持一致
    scanConcurrency: 4, // 默认并发数，后端会根据硬件智能调整
    theme: 'system',
    language: 'zh-CN',
    enableExperimentalParsers: false,
    enableOfficeParsers: true,
    deleteToTrash: false, // 默认永久删除
    ignoreOtherDrivesSystemDirs: false, // 默认不忽略其他磁盘的系统目录（即会扫描）
  })
  
  // 目录树选中状态
  const selectedPaths = ref<Set<string>>(new Set())
  
  // 计算属性
  const sensitiveFilesCount = computed(() => scanResults.value.length)
  const totalSensitiveItems = computed(() => 
    scanResults.value.reduce((sum, item) => sum + item.total, 0)
  )
  
  // 【UI优化】计算扫描耗时
  const scanElapsedTime = ref('00:00:00')
  let elapsedTimeTimer: number | null = null
  
  // 启动耗时更新定时器
  function startElapsedTimeTimer() {
    if (elapsedTimeTimer) return // 避免重复启动
    
    elapsedTimeTimer = window.setInterval(() => {
      if (!scanStartTime.value) {
        scanElapsedTime.value = '00:00:00'
        return
      }
      
      const elapsed = Date.now() - scanStartTime.value
      const hours = Math.floor(elapsed / 3600000)
      const minutes = Math.floor((elapsed % 3600000) / 60000)
      const seconds = Math.floor((elapsed % 60000) / 1000)
      
      scanElapsedTime.value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }, 1000) // 每秒更新一次
  }
  
  // 停止耗时更新定时器
  function stopElapsedTimeTimer() {
    if (elapsedTimeTimer) {
      clearInterval(elapsedTimeTimer)
      elapsedTimeTimer = null
    }
  }
  
  // 获取节点的选择状态：'checked' | 'unchecked' | 'indeterminate'
  function getNodeCheckState(nodePath: string, allNodes: Map<string, DirectoryNode>): 'checked' | 'unchecked' | 'indeterminate' {
    // 根据路径格式自动判断分隔符
    const separator = nodePath.includes('\\') ? '\\' : '/'
    
    // 查找所有直接子节点（只找一层）
    const directChildren = Array.from(allNodes.values()).filter(n => {
      // 必须是子节点（路径以 nodePath + separator 开头）
      if (!n.path.startsWith(nodePath + separator)) return false
      
      // 排除更深层的子孙节点（路径中只能有一个额外的 separator）
      const relativePath = n.path.substring(nodePath.length + 1)
      return !relativePath.includes(separator)
    })
    
    if (directChildren.length === 0) {
      // 叶子节点，直接返回自身状态
      return selectedPaths.value.has(nodePath) ? 'checked' : 'unchecked'
    }
    
    // 递归检查每个直接子节点的状态
    let checkedCount = 0
    let uncheckedCount = 0
    
    for (const child of directChildren) {
      const childState = getNodeCheckState(child.path, allNodes)
      if (childState === 'checked') {
        checkedCount++
      } else if (childState === 'unchecked') {
        uncheckedCount++
      } else {
        // 有子节点是半选，父节点也应该是半选
        return 'indeterminate'
      }
    }
    
    // 根据直接子节点的状态决定
    if (checkedCount === 0) {
      return 'unchecked'
    } else if (checkedCount === directChildren.length) {
      return 'checked'
    } else {
      return 'indeterminate'
    }
  }
  
  // 【优化】使用批量更新，避免频繁触发 UI 重渲染
  const pendingResults: ScanResultItem[] = []
  let batchTimer: number | null = null
    
  // 【优化】日志也使用批量更新
  const pendingLogs: string[] = []
  let logBatchTimer: number | null = null
  
  // 【新增】日志版本号，用于触发 watch
  const logVersion = ref(0)

  function addScanResult(item: ScanResultItem) {
    pendingResults.push(item)
    
    // 如果还没有定时器，设置一个批处理定时器
    if (batchTimer === null) {
      batchTimer = window.setTimeout(() => {
        // 批量添加所有待处理的结果
        if (pendingResults.length > 0) {
          scanResults.value.push(...pendingResults)
          pendingResults.length = 0  // 清空数组
        }
        batchTimer = null
      }, UI_BATCH_UPDATE_INTERVAL)  // 使用配置的批量更新间隔
    }
  }
  
  function addLog(log: string) {
    pendingLogs.push(log)
    
    // 如果还没有定时器，设置一个批处理定时器
    if (logBatchTimer === null) {
      logBatchTimer = window.setTimeout(() => {
        if (pendingLogs.length > 0) {
          logs.value.push(...pendingLogs)
          
          // 限制前端日志长度，防止内存泄漏
          if (logs.value.length > MAX_FRONTEND_LOGS) {
            const removeCount = logs.value.length - MAX_FRONTEND_LOGS + 100
            logs.value.splice(0, removeCount)
          }
          
          pendingLogs.length = 0
          
          // 递增版本号，触发 watch
          logVersion.value++
        }
        logBatchTimer = null
      }, UI_LOG_BATCH_INTERVAL)
    }
  }
  
  function clearScanResults() {
    // 【修复】使用 splice 清空数组，保持响应式
    scanResults.value.splice(0, scanResults.value.length)
    scannedCount.value = 0
    totalCount.value = 0      // ← 重置总数
    filteredCount.value = 0   // 【新增】重置过滤计数
    skippedCount.value = 0    // 【修改】重置跳过计数
    logs.value.splice(0, logs.value.length)  // 清空日志
    logVersion.value = 0  // 【新增】重置版本号
    scanStartTime.value = null  // 【UI优化】重置扫描开始时间
    stopElapsedTimeTimer()  // 【UI优化】停止耗时更新定时器
    scanElapsedTime.value = '00:00:00'  // 【UI优化】重置耗时显示
  }
  
  function removeResult(filePath: string) {
    const index = scanResults.value.findIndex(r => r.filePath === filePath)
    if (index !== -1) {
      scanResults.value.splice(index, 1)
    }
  }
  
  function togglePath(path: string) {
    if (selectedPaths.value.has(path)) {
      selectedPaths.value.delete(path)
    } else {
      selectedPaths.value.add(path)
    }
  }
  
  // 智能切换节点（考虑父子关系）
  function smartToggleNode(nodePath: string, allNodes: Map<string, DirectoryNode>) {
    const currentState = getNodeCheckState(nodePath, allNodes)
    
    // 根据路径格式自动判断分隔符
    const separator = nodePath.includes('\\') ? '\\' : '/'
    
    if (currentState === 'checked' || currentState === 'indeterminate') {
      // ===== 取消选中：删除自己和所有子孙节点 =====
      selectedPaths.value.delete(nodePath)
      
      // 删除所有子孙节点（包括已加载和通过路径推断的）
      Array.from(selectedPaths.value).forEach(path => {
        if (path.startsWith(nodePath + separator)) {
          selectedPaths.value.delete(path)
        }
      })
    } else {
      // ===== 选中：添加自己和所有已加载的子孙节点 =====
      selectedPaths.value.add(nodePath)
      
      // 添加所有已加载的子孙节点（用于 UI 显示）
      Array.from(allNodes.values()).forEach(n => {
        if (n.path.startsWith(nodePath + separator)) {
          selectedPaths.value.add(n.path)
        }
      })
    }
  }
  
  function selectAllPaths(paths: string[]) {
    paths.forEach(p => selectedPaths.value.add(p))
  }
  
  function deselectAllPaths() {
    selectedPaths.value.clear()
  }
  
  // 全选所有目录
  function selectAllDirectories(allNodes: DirectoryNode[]) {
    // 【修复】选择所有节点（包括文件和目录）
    const selectNode = (node: DirectoryNode) => {
      selectedPaths.value.add(node.path)
      if (node.children && node.children.length > 0) {
        node.children.forEach(selectNode)
      }
    }
    allNodes.forEach(selectNode)
  }
  
  // 全不选
  function deselectAllDirectories() {
    selectedPaths.value.clear()
  }
  
  // 获取有效的扫描路径（只保留叶子节点，避免重复扫描）
  // 例如：如果 C:\Users 和 C:\Users\John 都选中了，只返回 C:\Users\John
  function getEffectiveScanPaths(): string[] {
    const paths = Array.from(selectedPaths.value)
    
    // 按路径长度排序（短的在前）
    paths.sort((a, b) => a.length - b.length)
    
    const effectivePaths: string[] = []
    
    for (const path of paths) {
      // 检查这个路径是否是其他已选路径的祖先
      // 根据路径格式自动判断分隔符
      const separator = path.includes('\\') ? '\\' : '/'
      const hasDescendantSelected = paths.some(otherPath => 
        otherPath !== path && otherPath.startsWith(path + separator)
      )
      
      // 如果没有子孙节点被选中，则这是一个有效的扫描路径
      if (!hasDescendantSelected) {
        effectivePaths.push(path)
      }
    }
    
    return effectivePaths
  }
  
  return {
    scanResults,
    isScanning,
    scannedCount,
    totalCount,      // ← 导出总数
    filteredCount,   // 【新增】导出过滤计数
    skippedCount,    // 【修改】导出跳过计数（原 errorCount）
    currentFile,
    logs,
    logVersion,      // 【新增】导出日志版本号
    config,
    selectedPaths,
    sensitiveFilesCount,
    totalSensitiveItems,
    scanStartTime,   // 【UI优化】导出扫描开始时间
    scanElapsedTime, // 【UI优化】导出扫描耗时
    startElapsedTimeTimer,  // 【UI优化】导出启动定时器函数
    stopElapsedTimeTimer,   // 【UI优化】导出停止定时器函数
    addScanResult,
    addLog,  // 【新增】批量添加日志
    clearScanResults,
    removeResult,
    togglePath,
    smartToggleNode,
    getNodeCheckState,
    selectAllPaths,
    deselectAllPaths,
    selectAllDirectories,
    deselectAllDirectories,
    getEffectiveScanPaths,
  }
})
