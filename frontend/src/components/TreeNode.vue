<template>
  <div class="tree-node">
    <div 
      class="node-content" 
      :style="{ paddingLeft: (level * 16 + 8) + 'px' }"
      :class="{ selected: checkState === 'checked', hidden: node.isHidden }"
      :data-path="node.path"
    >
      <span 
        v-if="node.isDir && node.hasChildren" 
        class="expand-icon"
        @click="handleExpand"
      >
        <svg v-if="isExpanded"><use href="#icon-arrow-down"/></svg>
        <svg v-else><use href="#icon-arrow-right"/></svg>
      </span>
      <span v-else class="expand-icon-placeholder"></span>
      
      <input 
        ref="checkboxRef"
        type="checkbox" 
        :checked="checkState === 'checked'"
        @change="handleCheck"
        class="node-checkbox"
      />
      
      <span class="node-name">{{ node.name }}</span>
    </div>
    
    <div v-if="isExpanded && children.length > 0" class="node-children">
      <TreeNode
        v-for="child in children"
        :key="child.path"
        :node="child"
        :level="level + 1"
        :all-nodes-map="props.allNodesMap"
        @toggle="(path: string) => $emit('toggle', path)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import type { DirectoryNode } from '@/types'
import { getDirectoryTree } from '@/utils/electron-api'

const props = defineProps<{
  node: DirectoryNode
  level: number
  allNodesMap: Map<string, DirectoryNode>
}>()

const emit = defineEmits<{
  toggle: [path: string]
}>()

const appStore = useAppStore()
const isExpanded = ref(false)
const children = ref<DirectoryNode[]>([])
const checkboxRef = ref<HTMLInputElement | null>(null)

// 计算节点的选中状态
const checkState = computed(() => {
  return appStore.getNodeCheckState(props.node.path, props.allNodesMap)
})

// 监听 checkState 变化，更新 indeterminate 属性
watch(checkState, (newState) => {
  if (checkboxRef.value) {
    checkboxRef.value.indeterminate = newState === 'indeterminate'
  }
}, { immediate: true })

// 加载子节点时构建映射表
const loadChildren = async () => {
  if (!props.node.isDir || !props.node.hasChildren) return
  
  if (children.value.length === 0) {
    try {
      // 【修复】在加载子节点之前，先保存父节点的选中状态
      const parentWasChecked = appStore.selectedPaths.has(props.node.path)
      
      children.value = await getDirectoryTree(props.node.path)
      // 将子节点添加到父组件的映射表
      children.value.forEach(child => {
        props.allNodesMap.set(child.path, child)
      })
      
      // 【修复】如果父节点之前是选中状态，自动选中所有新加载的子节点
      if (parentWasChecked) {
        children.value.forEach(child => {
          appStore.selectedPaths.add(child.path)
          // 递归选中子节点的子孙节点（如果有的话）
          if (child.children && child.children.length > 0) {
            const selectDescendants = (node: DirectoryNode) => {
              appStore.selectedPaths.add(node.path)
              if (node.children) {
                node.children.forEach(selectDescendants)
              }
            }
            selectDescendants(child)
          }
        })
      }
    } catch (error) {
      console.error('加载子目录失败:', error)
    }
  }
}

const handleExpand = async () => {
  if (!props.node.isDir || !props.node.hasChildren) return
  
  isExpanded.value = !isExpanded.value
  
  if (isExpanded.value) {
    await loadChildren()
  }
}

const handleCheck = () => {
  emit('toggle', props.node.path)
}
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.node-content {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 3px;
  min-width: max-content;  /* 确保内容不被压缩 */
}

.node-content:hover {
  background-color: var(--bg-hover);
}

.node-content.selected {
  background-color: var(--bg-selected);
}

.node-content.hidden {
  color: var(--text-secondary);
  font-style: italic;
}

.expand-icon {
  width: 16px;
  text-align: center;
  cursor: pointer;
  margin-right: 4px;
}

.expand-icon svg {
  width: 12px;
  height: 12px;
  color: var(--text-secondary);
}

.expand-icon:hover svg {
  color: var(--primary-color);
}

.expand-icon-placeholder {
  width: 16px;
  margin-right: 4px;
}

.node-checkbox {
  margin-right: 6px;
  cursor: pointer;
}

.node-checkbox:indeterminate {
  accent-color: var(--primary-color);
}

.node-name {
  flex: 1;
  font-size: 13px;
  /* 移除文本截断，允许水平滚动 */
}

.node-children {
  margin-left: 0;
}
</style>
