<template>
  <div class="directory-tree">
    <div class="tree-header">
      <h3>扫描路径</h3>
      <div class="tree-actions">
        <button 
          class="btn-small" 
          @click="handleToggleSelectAll"
        >
          {{ isAllSelected ? '全不选' : '全选' }}
        </button>
        
        <button 
          class="btn-small" 
          @click="handleToggleExpand"
        >
          {{ isAllExpanded ? '折叠' : '展开' }}
        </button>
        
        <button 
          class="btn-small" 
          @click="handleRefresh"
          :disabled="loading"
        >
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>
    
    <div class="tree-content">
      <!-- 【C1 优化】加载中状态 -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">正在加载目录...</div>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="rootNodes.length === 0" class="empty-state">
        <p>暂无可扫描的目录</p>
      </div>
      
      <!-- 目录树 -->
      <TreeNode
        v-else
        v-for="node in rootNodes"
        :key="node.path"
        :node="node"
        :level="0"
        :all-nodes-map="allNodesMap"
        @toggle="handleToggleNode"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {onMounted, ref, watch} from 'vue'
import {useAppStore} from '@/stores/app'
import TreeNode from '@/components/TreeNode.vue'
import type {DirectoryNode} from '@/types'
import {getDirectoryTree} from '@/utils/electron-api'

const appStore = useAppStore()
const rootNodes = ref<DirectoryNode[]>([])
const allNodesMap = ref<Map<string, DirectoryNode>>(new Map())
// 【C1 优化】加载状态
const loading = ref(false)
// 【新增】全选状态
const isAllSelected = ref(true)
// 【新增】展开状态
const isAllExpanded = ref(false)

// 加载根目录
onMounted(async () => {
  // 【C1 优化】设置加载状态
  loading.value = true
  
  try {
    // 检测操作系统
    const isWindows = navigator.userAgent.toLowerCase().includes('win')
    
    if (isWindows) {
      // Windows: 获取所有磁盘驱动器
      // 常见的驱动器列表，按字母顺序
      const possibleDrives = [
        'A:', 'B:', 'C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:',
        'K:', 'L:', 'M:', 'N:', 'O:', 'P:', 'Q:', 'R:', 'S:', 'T:',
        'U:', 'V:', 'W:', 'X:', 'Y:', 'Z:'
      ]
      
      const allNodes: DirectoryNode[] = []
      
      // 并行检查所有可能的驱动器
      const drivePromises = possibleDrives.map(async (drive) => {
        try {
          const nodes = await getDirectoryTree(drive + '\\')
          if (nodes.length > 0) {
            // 为每个驱动器创建一个父节点
            return {
              path: drive + '\\',
              name: drive,
              isDir: true,
              isHidden: false,
              hasChildren: true,
              children: nodes
            } as DirectoryNode
          }
        } catch (error) {
          // 驱动器不存在或无权限，跳过
        }
        return null
      })
      
      // 等待所有检查结果
      const results = await Promise.all(drivePromises)
      
      // 收集有效的驱动器节点
      results.forEach(result => {
        if (result) {
          allNodes.push(result)
        }
      })
      
      rootNodes.value = allNodes
    } else {
      // macOS/Linux: 使用根目录 /
      rootNodes.value = await getDirectoryTree('/')
    }
    
    // 构建所有节点的映射表
    buildNodesMap(rootNodes.value)
    
    // 默认全选
    appStore.selectAllDirectories(rootNodes.value)
  } catch (error) {
    console.error('加载目录树失败:', error)
  } finally {
    // 【C1 优化】清除加载状态
    loading.value = false
  }
})

// 递归构建节点映射表
function buildNodesMap(nodes: DirectoryNode[]) {
  nodes.forEach(node => {
    allNodesMap.value.set(node.path, node)
    if (node.children && node.children.length > 0) {
      buildNodesMap(node.children)
    }
  })
}

// 【辅助方法】计算总路径数
const countTotalPaths = (nodes: DirectoryNode[]): number => {
  let count = 0
  nodes.forEach(node => {
    count++
    if (node.children && node.children.length > 0) {
      count += countTotalPaths(node.children)
    }
  })
  return count
}

// 【新增】切换全选/全不选
const handleToggleSelectAll = () => {
  if (isAllSelected.value) {
    // 当前是全选状态，执行全不选
    appStore.deselectAllDirectories()
  } else {
    // 当前是全不选状态，执行全选
    // 【修复】使用 allNodesMap 而不是 rootNodes，确保包含懒加载的子节点
    const allNodes = Array.from(allNodesMap.value.values())
    appStore.selectAllDirectories(allNodes)
  }
}

// 【修改】监听 store 中的选中状态变化
watch(
  () => appStore.selectedPaths.size,
  (newSize) => {
    // 【修复】使用 allNodesMap 的大小，而不是 rootNodes 的递归计数
    // 确保与 handleToggleSelectAll 中的逻辑一致
    const totalPaths = allNodesMap.value.size
    // 只有当选中数量等于总数时才是全选状态
    isAllSelected.value = newSize === totalPaths && totalPaths > 0
  },
  { immediate: true }
)

const handleToggleNode = (path: string) => {
  appStore.smartToggleNode(path, allNodesMap.value)
}

// 【新增】切换展开/折叠全部
const handleToggleExpand = () => {
  if (isAllExpanded.value) {
    // 当前是展开状态，执行折叠
    collapseAllNodes()
    isAllExpanded.value = false
  } else {
    // 当前是折叠状态，执行展开
    expandAllNodes()
    isAllExpanded.value = true
  }
}

// 【修复】递归展开所有节点
const expandAllNodes = (nodes?: DirectoryNode[]) => {
  const targetNodes = nodes || rootNodes.value
  targetNodes.forEach(node => {
    if (node.isDir && node.hasChildren) {
      // 找到对应的 DOM 元素并触发点击
      const nodeElement = findNodeElement(node.path)
      if (nodeElement) {
        const expandIcon = nodeElement.querySelector('.expand-icon') as HTMLElement
        if (expandIcon) {
          expandIcon.click()
        }
      }
      // 递归展开子节点（需要先加载）
      if (node.children && node.children.length > 0) {
        expandAllNodes(node.children)
      }
    }
  })
}

// 【修复】递归折叠所有节点
const collapseAllNodes = (nodes?: DirectoryNode[]) => {
  const targetNodes = nodes || rootNodes.value
  // 先递归折叠子节点
  targetNodes.forEach(node => {
    if (node.isDir && node.hasChildren && node.children && node.children.length > 0) {
      collapseAllNodes(node.children)
    }
  })
  
  // 再折叠当前层级
  targetNodes.forEach(node => {
    if (node.isDir && node.hasChildren) {
      const nodeElement = findNodeElement(node.path)
      if (nodeElement) {
        const expandIcon = nodeElement.querySelector('.expand-icon') as HTMLElement
        if (expandIcon && expandIcon.querySelector('svg use')?.getAttribute('href') === '#icon-arrow-down') {
          expandIcon.click()
        }
      }
    }
  })
}

// 【新增】根据路径查找节点 DOM 元素
const findNodeElement = (path: string): HTMLElement | null => {
  // 通过 data-path 属性查找（需要在 TreeNode 中添加）
  const allNodes = document.querySelectorAll('.tree-node')
  for (const nodeElement of Array.from(allNodes)) {
    const content = nodeElement.querySelector('.node-content') as HTMLElement
    if (content && content.getAttribute('data-path') === path) {
      return nodeElement as HTMLElement
    }
  }
  return null
}

// 【新增】刷新目录树
const handleRefresh = async () => {
  if (loading.value) return
  
  loading.value = true
  
  try {
    // 检测操作系统
    const isWindows = navigator.userAgent.toLowerCase().includes('win')
    
    if (isWindows) {
      // Windows: 获取所有磁盘驱动器
      const possibleDrives = [
        'A:', 'B:', 'C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:',
        'K:', 'L:', 'M:', 'N:', 'O:', 'P:', 'Q:', 'R:', 'S:', 'T:',
        'U:', 'V:', 'W:', 'X:', 'Y:', 'Z:'
      ]
      
      const allNodes: DirectoryNode[] = []
      
      // 并行检查所有可能的驱动器
      const drivePromises = possibleDrives.map(async (drive) => {
        try {
          const nodes = await getDirectoryTree(drive + '\\')
          if (nodes.length > 0) {
            return {
              path: drive + '\\',
              name: drive,
              isDir: true,
              isHidden: false,
              hasChildren: true,
              children: nodes
            } as DirectoryNode
          }
        } catch (error) {
          // 驱动器不存在或无权限，跳过
        }
        return null
      })
      
      // 等待所有检查结果
      const results = await Promise.all(drivePromises)
      
      // 收集有效的驱动器节点
      results.forEach(result => {
        if (result) {
          allNodes.push(result)
        }
      })
      
      rootNodes.value = allNodes
    } else {
      // macOS/Linux: 使用根目录 /
      rootNodes.value = await getDirectoryTree('/')
    }
    
    // 重新构建所有节点的映射表
    allNodesMap.value.clear()
    buildNodesMap(rootNodes.value)
    
    // 默认全选
    appStore.selectAllDirectories(rootNodes.value)
    isAllSelected.value = true
    
    // 重置展开状态
    isAllExpanded.value = false
  } catch (error) {
    console.error('刷新目录树失败:', error)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.directory-tree {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-color);
  overflow: hidden;
}

.tree-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background-color: var(--toolbar-bg);
  border-bottom: 1px solid var(--border-color);
}

.tree-header h3 {
  font-size: 14px;
  font-weight: 600;
}

.tree-actions {
  display: flex;
  gap: 5px;
}

.btn-small {
  padding: 3px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-small:hover:not(:disabled) {
  background-color: var(--bg-hover);
  border-color: var(--primary-color);
}

.btn-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tree-content {
  flex: 1;
  overflow: auto;  /* 同时支持水平和垂直滚动 */
  padding: 8px;
}

/* 【C1 优化】加载状态样式 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  font-size: 14px;
  color: var(--text-secondary);
}

/* 空状态样式 */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
