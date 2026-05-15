直接
<template>
  <div class="results-table">
    <div class="table-header">
      <h3>扫描结果</h3>
      <div class="table-actions">
        <button
            v-if="selectedFiles.size > 0"
            class="btn-batch-delete"
            @click="handleBatchDelete"
        >
          一键删除 ({{ selectedFiles.size }})
        </button>
        <input
            type="text"
            v-model="searchKeyword"
            placeholder="搜索文件路径..."
            class="search-input"
        />
      </div>
    </div>

    <div class="table-content" :class="{ resizing: isResizing }">
      <!-- 【虚拟滚动优化】使用 vue-virtual-scroller -->
      <div v-if="filteredResults.length > 0" class="virtual-table-wrapper">
        <!-- 固定表头 - 使用独立的可滚动容器 -->
        <div class="header-scroll-container">
          <div class="table-header-grid" ref="headerRef" :style="gridStyle">
            <div class="cell checkbox-col header-cell center-header frozen-left">
              <input
                  type="checkbox"
                  ref="selectAllCheckbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                  title="全选/取消全选"
              />
            </div>
            <div
                class="cell path-col header-cell sortable frozen-left"
                :class="{ 'sorted-asc': sortField === 'file_path' && sortOrder === 'asc', 'sorted-desc': sortField === 'file_path' && sortOrder === 'desc' }"
                @click="sortBy('file_path')"
                title="点击排序"
            >
              文件名
              <span v-if="sortField === 'file_path'" class="sort-indicator">
                {{ sortOrder === 'asc' ? '↑' : '↓' }}
              </span>
            </div>
            <div
                class="cell size-cell header-cell sortable number-header"
                :class="{ 'sorted-asc': sortField === 'file_size' && sortOrder === 'asc', 'sorted-desc': sortField === 'file_size' && sortOrder === 'desc' }"
                @click="sortBy('file_size')"
                title="点击排序"
            >
              文件大小
              <span v-if="sortField === 'file_size'" class="sort-indicator">
                {{ sortOrder === 'asc' ? '↑' : '↓' }}
              </span>
            </div>
            <div
                class="cell header-cell sortable number-header time-header"
                :class="{ 'sorted-asc': sortField === 'modified_time' && sortOrder === 'asc', 'sorted-desc': sortField === 'modified_time' && sortOrder === 'desc' }"
                @click="sortBy('modified_time')"
                title="点击排序"
            >
              修改时间
              <span v-if="sortField === 'modified_time'" class="sort-indicator">
                {{ sortOrder === 'asc' ? '↑' : '↓' }}
              </span>
            </div>
            <template v-if="config.enableBuiltinRules !== false">
              <div
                  v-for="type in sensitiveTypes"
                  :key="type.id"
                  class="cell header-cell sortable number-header"
                  :class="{ 'sorted-asc': sortField === `counts.${type.id}` && sortOrder === 'asc', 'sorted-desc': sortField === `counts.${type.id}` && sortOrder === 'desc' }"
                  @click="sortBy(`counts.${type.id}`)"
                  title="点击排序"
              >
                {{ type.name }}
                <span v-if="sortField === `counts.${type.id}`" class="sort-indicator">
                  {{ sortOrder === 'asc' ? '↑' : '↓' }}
                </span>
              </div>
              <div
                  class="cell header-cell sortable number-header"
                  :class="{ 'sorted-asc': sortField === 'total' && sortOrder === 'asc', 'sorted-desc': sortField === 'total' && sortOrder === 'desc' }"
                  @click="sortBy('total')"
                  title="点击排序"
              >
                总计
                <span v-if="sortField === 'total'" class="sort-indicator">
                  {{ sortOrder === 'asc' ? '↑' : '↓' }}
                </span>
              </div>
              <!-- 【需求变更】表达式列表头单独放置，支持排序 -->
              <div
                  v-if="hasSearchExpressionColumn"
                  class="cell header-cell sortable center-header"
                  :class="{ 'sorted-asc': sortField === 'expressionMatched' && sortOrder === 'asc', 'sorted-desc': sortField === 'expressionMatched' && sortOrder === 'desc' }"
                  @click="sortBy('expressionMatched')"
                  title="点击排序"
              >
                表达式
                <span v-if="sortField === 'expressionMatched'" class="sort-indicator">
                  {{ sortOrder === 'asc' ? '↑' : '↓' }}
                </span>
              </div>
            </template>
            <div class="cell actions-col header-cell actions-header frozen-right">操作</div>
          </div>
        </div>

        <!-- 虚拟滚动内容 - 支持动态行高 -->
        <DynamicScroller
            ref="scrollerRef"
            class="virtual-scroller"
            :items="filteredResults"
            :min-item-size="40"
            key-field="filePath"
            @scroll="handleScroll"
            v-slot="{ item, index, active }"
        >
          <DynamicScrollerItem
              :item="item"
              :active="active"
              :size-dependencies="[
              item.filePath,
              item.fileSize,
              item.modifiedTime,
              item.total
            ]"
              :data-index="index"
          >
            <div class="row-wrapper">
              <div class="virtual-row" :style="gridStyle">
                <div class="cell checkbox-col frozen-left">
                  <input
                      type="checkbox"
                      :checked="selectedFiles.has(item.filePath)"
                      @change="toggleSelectFile(item.filePath)"
                  />
                </div>
                <div class="cell path-cell frozen-left" :title="item.filePath">{{ getFileName(item.filePath) }}</div>
                <div class="cell size-cell mono-font">{{ formatFileSize(item.fileSize) }}</div>
                <div class="cell mono-font time-cell">{{ formatTime(item.modifiedTime) }}</div>
                <template v-if="config.enableBuiltinRules !== false">
                  <div v-for="type in sensitiveTypes" :key="type.id" class="cell number-cell mono-font"
                       :class="{ 'highlight-count': (item.counts[type.id] || 0) > 0 }">
                    {{ (item.counts[type.id] || 0) > 0 ? Number(item.counts[type.id]).toLocaleString() : '-' }}
                  </div>
                  <div class="cell total-cell mono-font">{{ item.total.toLocaleString() }}</div>
                  <!-- 【需求变更】表达式列单独放置，显示图标 -->
                  <div v-if="hasSearchExpressionColumn" class="cell expression-column-center">
                    <svg v-if="(item.expressionMatched || 0) > 0" class="check-icon-svg">
                      <use href="#icon-check-fill"></use>
                    </svg>
                    <span v-else>-</span>
                  </div>
                </template>
                <div class="cell actions-col frozen-right">
                  <div class="actions-cell">
                    <button class="btn-action" @click="handlePreview(item)" title="预览">
                      <svg class="action-icon">
                        <use href="#icon-preview"></use>
                      </svg>
                    </button>
                    <button class="btn-action" @click="handleOpen(item)" title="打开">
                      <svg class="action-icon">
                        <use href="#icon-openfile"></use>
                      </svg>
                    </button>
                    <button class="btn-action" @click="handleOpenLocation(item)" title="所在目录">
                      <svg class="action-icon">
                        <use href="#icon-directory"></use>
                      </svg>
                    </button>
                    <button class="btn-action btn-delete" @click="handleDelete(item)" title="删除">
                      <svg class="action-icon delete-icon">
                        <use href="#icon-delete"></use>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </DynamicScrollerItem>
        </DynamicScroller>
      </div>

      <div v-else class="empty-state">
        <p>{{ appStore.isScanning ? '扫描中...' : '暂无扫描结果' }}</p>
        <p v-if="!appStore.isScanning" class="hint">点击"开始扫描"按钮开始扫描</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue'
import {useAppStore} from '@/stores/app'
import {storeToRefs} from 'pinia'
import {debounce, formatFileSize, formatTime, promisePool} from '@/utils/format'
import {askDialog, deleteFile, getSensitiveRules, openFile, openFileLocation, showMessage} from '@/utils/electron-api'
// 【虚拟滚动优化】导入 vue-virtual-scroller（支持动态行高）
import {DynamicScroller, DynamicScrollerItem} from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
// 【C2 优化】导入错误处理工具
import {getFriendlyErrorMessage} from '@/utils/error-handler'
// 【D2 优化】导入 UI 配置常量
import {UI_SEARCH_DEBOUNCE_DELAY} from '@/config/ui-config'

const appStore = useAppStore()
const {scanResults, config} = storeToRefs(appStore)

const emit = defineEmits<{
  preview: [filePath: string]
}>()

const searchKeyword = ref('')
const debouncedSearchKeyword = ref('')  // 【P1】防抖后的搜索关键词
const sortField = ref<string>('')
const sortOrder = ref<'asc' | 'desc'>('asc')
const allSensitiveTypes = ref<Array<{ id: string; name: string }>>([])
const selectedFiles = ref<Set<string>>(new Set())
const selectAllCheckbox = ref<HTMLInputElement | null>(null)
const isResizing = ref(false)
const scrollerRef = ref<any>(null)
const headerRef = ref<HTMLDivElement | null>(null)

// 【优化】列宽配置（em 单位）
const COLUMN_WIDTHS = {
  checkbox: 4,
  size: 8,
  time: 12,
  count: 6.15,  // 每个敏感类型列
  total: 7,
  actions: 9,
} as const

// 【辅助方法】获取基础字体大小（带缓存和错误处理）
const getBaseFontSize = (): number => {
  if (cachedBaseFontSize !== null) {
    return cachedBaseFontSize
  }

  try {
    const bodyStyle = getComputedStyle(document.body)
    const fontSize = parseFloat(bodyStyle.fontSize)
    // 验证字体大小是否有效（10-30px 范围内）
    if (fontSize >= 10 && fontSize <= 30) {
      cachedBaseFontSize = fontSize
    } else {
      console.warn('[getBaseFontSize] 无效的字体大小:', fontSize, '使用默认值 14px')
      cachedBaseFontSize = 14
    }
  } catch (error) {
    console.error('[getBaseFontSize] 获取字体大小失败:', error, '使用默认值 14px')
    cachedBaseFontSize = 14
  }

  return cachedBaseFontSize
}

// 【优化】移除不再需要的手动宽度计算
// Grid 的 minmax(8em, 1fr) 会自动处理路径列宽度

// 监听窗口 resize
let resizeTimer: number | null = null
let scrollSyncSetup = false  // 【修复】标记是否已设置滚动同步
let containerQuerySetup = false  // 【修复】防止重复设置容器查询
let resizeHandler: (() => void) | null = null  // 【修复】保存 resize 处理器引用

onMounted(() => {
  resizeHandler = () => {
    isResizing.value = true
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      isResizing.value = false
      updatePathMaxWidth() // 【新增】窗口 resize 完成后更新路径列 max-width
    }, 300)
  }

  // 使用 passive listener 提升性能
  window.addEventListener('resize', resizeHandler, {passive: true})
})

// 加载敏感类型定义
onMounted(async () => {
  try {
    const rules = await getSensitiveRules()
    // 后端返回的是 [id, name] 元组数组
    allSensitiveTypes.value = rules.map(([id, name]: [string, string]) => ({id, name}))
  } catch (error) {
    console.error('加载敏感类型失败:', error)
  }
})

// 只显示启用且存在于规则中的敏感类型
const sensitiveTypes = computed(() => {
  return allSensitiveTypes.value.filter(type =>
      config.value.enabledSensitiveTypes.includes(type.id)
  )
})

// 【新增】判断是否显示表达式列
// 只要有 expressionMatched 字段就说明用户配置了表达式（即使值为 0）
const hasSearchExpressionColumn = computed(() => {
  return scanResults.value.some(item =>
      item.expressionMatched !== undefined && item.expressionMatched !== null
  )
})

// 【修复】动态计算 Grid 列模板 - 使用 1fr 自动填充
const gridStyle = computed(() => {
  // 【关键】如果禁用内置规则，敏感类型列数为0
  const countCols = config.value.enableBuiltinRules !== false ? sensitiveTypes.value.length : 0
  // 【关键】所有列使用固定宽度，确保完全对齐
  const countColDefs = `${COLUMN_WIDTHS.count}em `.repeat(countCols)

  // 【需求变更】如果有表达式列，添加其宽度
  const expressionColDef = hasSearchExpressionColumn.value ? `${COLUMN_WIDTHS.count}em ` : ''
  
  // 【新增】条件显示总计列和表达式列（仅在启用内置规则时）
  const totalColDef = config.value.enableBuiltinRules !== false ? `${COLUMN_WIDTHS.total}em ` : ''
  const expressionColWithCondition = (config.value.enableBuiltinRules !== false && hasSearchExpressionColumn.value) ? expressionColDef : ''

  return {
    gridTemplateColumns: `
      ${COLUMN_WIDTHS.checkbox}em                 /* checkbox - 固定 */
      minmax(8em, 1fr)                            /* path - 自适应（最少8em，最多占据剩余空间） */
      ${COLUMN_WIDTHS.size}em                     /* size - 固定 */
      ${COLUMN_WIDTHS.time}em                     /* time - 固定 */
      ${countColDefs}                             /* counts - 敏感类型列 */
      ${expressionColWithCondition}               /* expression - 表达式列（条件显示） */
      ${totalColDef}                              /* total - 总计列（条件显示） */
      ${COLUMN_WIDTHS.actions}em                  /* actions - 固定（4个按钮足够） */
    `.trim()
  }
})

const filteredResults = computed(() => {
  let results = scanResults.value

  // 【P1】搜索过滤（使用防抖后的关键词）
  if (debouncedSearchKeyword.value) {
    const keyword = debouncedSearchKeyword.value.toLowerCase().trim()
    if (keyword) {
      results = results.filter(item => {
        const path = item.filePath.toLowerCase()
        // 同时支持正斜杠和反斜杠的匹配
        const normalizedPath = path.replace(/\\/g, '/')
        const normalizedKeyword = keyword.replace(/\\/g, '/')
        return path.includes(keyword) || normalizedPath.includes(normalizedKeyword)
      })
    }
  }

  // 排序
  if (sortField.value) {
    results = [...results].sort((a, b) => {
      let aVal: any
      let bVal: any

      // 处理 counts.xxx 字段（敏感类型计数）
      if (sortField.value.startsWith('counts.')) {
        const typeId = sortField.value.replace('counts.', '')
        aVal = a.counts[typeId] || 0
        bVal = b.counts[typeId] || 0
      } else {
        // 普通字段（前后端统一使用驼峰命名）
        aVal = a[sortField.value as keyof typeof a] ?? 0
        bVal = b[sortField.value as keyof typeof b] ?? 0
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }

      if (aVal < bVal) return sortOrder.value === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder.value === 'asc' ? 1 : -1
      return 0
    })
  }

  return results
})

// 【P1】监听搜索关键词，使用防抖
watch(searchKeyword, debounce((val) => {
  debouncedSearchKeyword.value = val
}, UI_SEARCH_DEBOUNCE_DELAY))  // 使用配置的防抖延迟

// 【修复】监听 filteredResults 变化，在数据加载后设置滚动同步
watch(
    () => filteredResults.value.length,
    async (newLength) => {
      if (newLength > 0 && !containerQuerySetup) {
        containerQuerySetup = true
        // 等待 DOM 更新
        await nextTick()
        await nextTick()  // 确保虚拟滚动完全渲染
        setupScrollSync()
      }
    },
    {immediate: true}
)

// 【新增】设置路径列 max-width 监听（使用 ResizeObserver）
let pathMaxWidthObserver: ResizeObserver | null = null
let rafId: number | null = null // 【优化】使用 rAF 代替 setTimeout
let cachedBaseFontSize: number | null = null // 【优化】缓存基础字体大小

const setupPathMaxWidthObserver = () => {
  // 【修复】先清理旧的 Observer，防止重复创建
  if (pathMaxWidthObserver) {
    pathMaxWidthObserver.disconnect()
    pathMaxWidthObserver = null
  }

  const tableElement = document.querySelector('.results-table') as HTMLElement
  if (!tableElement) return

  // 创建 ResizeObserver 监听容器宽度变化
  pathMaxWidthObserver = new ResizeObserver(() => {
    // 【优化】使用 rAF 批量处理，与浏览器渲染同步
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      updatePathMaxWidth(tableElement) // 传入已获取的元素，避免重复查询
      rafId = null
    })
  })

  pathMaxWidthObserver.observe(tableElement)
}

// 【新增】组件挂载时立即设置路径列 max-width
onMounted(() => {
  // 【优化】使用 nextTick 确保 DOM 完全渲染
  nextTick(() => {
    setupScrollSync()
    updatePathMaxWidth() // 初始设置路径列 max-width
    setupPathMaxWidthObserver() // 设置 ResizeObserver 监听
    setupScrollbarObserver() // 【新增】设置滚动条监听
  })
})

// 【新增】更新路径列 max-width（根据容器宽度和固定列总宽度动态计算）
const updatePathMaxWidth = (cachedTableElement?: HTMLElement) => {
  const tableElement = cachedTableElement || document.querySelector('.results-table') as HTMLElement
  if (!tableElement) return

  // 【优化】获取基础字体大小（使用辅助方法）
  const baseFontSize = getBaseFontSize()

  // 【优化】使用响应式计算的固定列总宽度
  const fixedTotalPx = fixedColumnsTotalPx.value

  // 计算路径列 max-width = 容器宽度 - 固定列总宽度
  const containerWidth = tableElement.offsetWidth
  let maxPathWidthPx = containerWidth - fixedTotalPx

  // 【保底】最小宽度 8em，防止宽度过小导致异常
  const minPathWidthPx = 8 * baseFontSize
  if (maxPathWidthPx < minPathWidthPx) {
    maxPathWidthPx = minPathWidthPx
  }

  const maxPathWidthEm = maxPathWidthPx / baseFontSize

  // 设置 CSS 变量
  tableElement.style.setProperty('--path-col-max-width', `${maxPathWidthEm}em`)
}

// 【新增】监听敏感类型变化和窗口 resize，更新 max-width
watch(sensitiveTypes, () => {
  // 【优化】使用 nextTick 等待 DOM 更新
  nextTick(() => updatePathMaxWidth())
})

// 【需求变更】监听表达式列变化，更新 max-width
watch(hasSearchExpressionColumn, () => {
  nextTick(() => updatePathMaxWidth())
})

// 【新增】监听内置规则开关变化，更新 max-width
watch(() => config.value.enableBuiltinRules, () => {
  // 【修复】等待 Grid 布局更新后再计算
  nextTick(() => {
    nextTick(() => {  // 双重 nextTick 确保虚拟滚动完全渲染
      updatePathMaxWidth()
      // 【关键】强制触发重排，确保 sticky 定位正确
      const tableElement = document.querySelector('.results-table') as HTMLElement
      if (tableElement) {
        // 强制浏览器重新计算布局
        void tableElement.offsetHeight
      }
    })
  })
})

// 【优化】响应式计算固定列总宽度（基于 Grid 模板配置）
const fixedColumnsTotalPx = computed(() => {
  // 【关键】如果禁用内置规则，敏感类型列数为0
  const countCols = config.value.enableBuiltinRules !== false ? sensitiveTypes.value.length : 0
  // 【优化】获取基础字体大小（使用辅助方法）
  const baseFontSize = getBaseFontSize()

  // 【需求变更】如果有表达式列，添加其宽度
  const expressionColWidth = hasSearchExpressionColumn.value ? COLUMN_WIDTHS.count * baseFontSize : 0
  
  // 【新增】条件显示总计列和表达式列（仅在启用内置规则时）
  const totalColWidth = config.value.enableBuiltinRules !== false ? COLUMN_WIDTHS.total * baseFontSize : 0
  const expressionColWithCondition = (config.value.enableBuiltinRules !== false && hasSearchExpressionColumn.value) ? expressionColWidth : 0

  return (
      COLUMN_WIDTHS.checkbox * baseFontSize +   // checkbox
      COLUMN_WIDTHS.size * baseFontSize +       // size
      COLUMN_WIDTHS.time * baseFontSize +       // time
      (COLUMN_WIDTHS.count * baseFontSize * countCols) +  // counts
      expressionColWithCondition +              // expression（条件显示）
      totalColWidth +                           // total（条件显示）
      COLUMN_WIDTHS.actions * baseFontSize      // actions
  )
})

// 【新增】获取浏览器滚动条宽度（带缓存）
let cachedScrollbarWidth: number | null = null

const getScrollbarWidth = (): number => {
  // 如果已缓存，直接返回
  if (cachedScrollbarWidth !== null) {
    return cachedScrollbarWidth
  }

  const outer = document.createElement('div')
  outer.style.visibility = 'hidden'
  outer.style.overflow = 'scroll'
  outer.style.width = '100px'
  outer.style.height = '100px'
  document.body.appendChild(outer)

  const inner = document.createElement('div')
  inner.style.width = '100%'
  inner.style.height = '100px'
  outer.appendChild(inner)

  const scrollbarWidth = outer.offsetWidth - inner.offsetWidth
  document.body.removeChild(outer)

  // 缓存结果
  cachedScrollbarWidth = scrollbarWidth || 8
  return cachedScrollbarWidth
}

// 【新增】监听数据行滚动条，同步表头容器 padding
let scrollbarObserver: ResizeObserver | null = null

const setupScrollbarObserver = () => {
  const scroller = document.querySelector('.virtual-scroller') as HTMLElement
  if (!scroller) return

  const headerContainer = document.querySelector('.header-scroll-container') as HTMLElement
  if (!headerContainer) return

  // 初始检查
  const checkScrollbar = () => {
    const hasScrollbar = scroller.scrollHeight > scroller.clientHeight
    if (hasScrollbar) {
      const width = getScrollbarWidth()
      headerContainer.style.paddingRight = `${width}px`
    } else {
      headerContainer.style.paddingRight = '0'
    }
  }

  // 初始执行
  checkScrollbar()

  // 监听 scroller 尺寸变化
  scrollbarObserver = new ResizeObserver(() => {
    checkScrollbar()
  })

  scrollbarObserver.observe(scroller)
}

onUnmounted(() => {
  if (resizeTimer) clearTimeout(resizeTimer)
  if (rafId) cancelAnimationFrame(rafId) // 【优化】清理 rAF

  // 清理 resize 监听器
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }

  // 清理 ResizeObserver（路径列 max-width）
  if (pathMaxWidthObserver) {
    pathMaxWidthObserver.disconnect()
    pathMaxWidthObserver = null
  }

  // 【新增】清理滚动条监听器
  if (scrollbarObserver) {
    scrollbarObserver.disconnect()
    scrollbarObserver = null
  }

  // 【修复】重置缓存和标记，防止内存泄漏
  cachedBaseFontSize = null
  cachedScrollbarWidth = null  // 【新增】清理滚动条宽度缓存
  scrollSyncSetup = false
  containerQuerySetup = false
})

// 设置滚动同步
const setupScrollSync = () => {
  if (scrollSyncSetup) return

  if (!scrollerRef.value || !headerRef.value) {
    return
  }

  // 获取 DynamicScroller 内部的滚动容器
  const scrollerElement = scrollerRef.value.$el
  if (!scrollerElement) {
    return
  }

  scrollSyncSetup = true
}

// 【关键】处理滚动事件，同步表头
const handleScroll = (event: Event) => {
  if (headerRef.value && event.target) {
    const target = event.target as HTMLElement
    const scrollLeft = target.scrollLeft

    // 【冻结列优化】使用 transform 移动整个表头 Grid
    headerRef.value.style.transform = `translateX(${-scrollLeft}px)`

    // 【关键】设置 CSS 变量，让冻结列反向移动来保持固定
    headerRef.value.style.setProperty('--scroll-offset', `${scrollLeft}px`)
  }
}

const sortBy = (field: string) => {
  if (sortField.value === field) {
    // 同一列：升序 -> 降序 -> 默认（取消排序）
    if (sortOrder.value === 'asc') {
      sortOrder.value = 'desc'
    } else if (sortOrder.value === 'desc') {
      sortField.value = ''
      sortOrder.value = 'asc'
    }
  } else {
    // 不同列：设置为升序
    sortField.value = field
    sortOrder.value = 'asc'
  }
}

// 从完整路径中提取文件名
const getFileName = (filePath: string) => {
  // 处理 Windows 和 Unix 路径
  const separators = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(separators)
  return parts[parts.length - 1] || filePath
}

const handlePreview = (item: any) => {
  emit('preview', item.filePath)
}

const handleOpen = async (item: any) => {
  try {
    await openFile(item.filePath)
  } catch (error) {
    console.error('打开文件失败:', error)
    // 【P1】使用 Electron 对话框替代 alert
    await showMessage(getFriendlyErrorMessage(error), {
      title: '错误',
      type: 'error'
    })
  }
}

const handleOpenLocation = async (item: any) => {
  try {
    await openFileLocation(item.filePath)
  } catch (error) {
    console.error('打开目录失败:', error)
    // 【P1】使用 Electron 对话框替代 alert
    await showMessage(getFriendlyErrorMessage(error), {
      title: '错误',
      type: 'error'
    })
  }
}

const handleDelete = async (item: any) => {
  const deleteMode = config.value.deleteToTrash ? '移入回收站' : '永久删除'
  // 【P1】使用 Electron 对话框替代 confirm
  const confirmed = await askDialog(`确定要${deleteMode}此文件吗？\n${item.filePath}`, {
    title: '确认删除',
    type: 'warning',
    okLabel: '删除',
    cancelLabel: '取消'
  })

  if (!confirmed) {
    return
  }

  try {
    await deleteFile(item.filePath, config.value.deleteToTrash)
    appStore.removeResult(item.filePath)
    // 【修复】从选中集合中移除，更新一键删除按钮计数
    selectedFiles.value.delete(item.filePath)
  } catch (error) {
    console.error('删除文件失败:', error)
    // 【P1】使用 Electron 对话框替代 alert
    await showMessage(getFriendlyErrorMessage(error), {
      title: '错误',
      type: 'error'
    })
  }
}

// 计算是否全选
const isAllSelected = computed(() => {
  return filteredResults.value.length > 0 &&
      filteredResults.value.every(item => selectedFiles.value.has(item.filePath))
})

// 计算是否半选
const isIndeterminate = computed(() => {
  const selectedCount = filteredResults.value.filter(item =>
      selectedFiles.value.has(item.filePath)
  ).length
  return selectedCount > 0 && selectedCount < filteredResults.value.length
})

// 监听 indeterminate 状态变化
watch(isIndeterminate, (newValue) => {
  if (selectAllCheckbox.value) {
    selectAllCheckbox.value.indeterminate = newValue
  }
}, {immediate: true})

// 切换单个文件选择
const toggleSelectFile = (filePath: string) => {
  if (selectedFiles.value.has(filePath)) {
    selectedFiles.value.delete(filePath)
  } else {
    selectedFiles.value.add(filePath)
  }
}

// 切换全选
const toggleSelectAll = () => {
  if (isAllSelected.value) {
    // 取消全选
    filteredResults.value.forEach(item => {
      selectedFiles.value.delete(item.filePath)
    })
  } else {
    // 全选
    filteredResults.value.forEach(item => {
      selectedFiles.value.add(item.filePath)
    })
  }
}

// 批量删除
const handleBatchDelete = async () => {
  if (selectedFiles.value.size === 0) {
    return
  }

  const count = selectedFiles.value.size
  const deleteMode = config.value.deleteToTrash ? '移入回收站' : '永久删除'
  const warningText = config.value.deleteToTrash
      ? `确定要${deleteMode}选中的 ${count} 个文件吗？`
      : `确定要${deleteMode}选中的 ${count} 个文件吗？\n\n此操作不可恢复！`

  const confirmed = await askDialog(warningText, {
    title: '确认批量删除',
    type: 'warning',
    okLabel: '删除',
    cancelLabel: '取消'
  })

  if (!confirmed) {
    return
  }

  // 【P0】并行删除文件，提升性能（带并发控制）
  const filesToDelete = Array.from(selectedFiles.value)

  // 创建任务队列（每个任务返回 Promise<void>）
  const tasks = filesToDelete.map(filePath => async () => {
    await deleteFile(filePath, config.value.deleteToTrash)
    appStore.removeResult(filePath)
  })

  // 执行并发删除（限制并发数为 10）
  const results = await promisePool(
      tasks,
      10  // 最大并发数：平衡性能和资源占用
  )

  // 统计成功和失败数量
  let successCount = 0
  let failCount = 0

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successCount++
    } else {
      console.error(`删除文件失败: ${filesToDelete[index]}`, result.reason)
      failCount++
    }
  })

  // 清空选中状态
  selectedFiles.value.clear()

  // 【C2 优化 + P1】显示友好的结果提示（使用 Electron 对话框）
  if (failCount > 0) {
    const message = `删除完成\n成功: ${successCount} 个\n失败: ${failCount} 个`
    await showMessage(message, {
      title: '删除结果',
      type: 'warning'
    })
  } else {
    // 全部成功，不显示提示（静默成功）
  }
}
</script>

<style scoped>
.results-table {
  display: flex;
  flex-direction: column;
  height: 100%;

  /* 【新增】路径列 max-width 配置（由 JS 动态计算） */
  --path-col-max-width: 10em; /* 默认值 */

  /* 【冻结列】表头滚动偏移量（由 JS 动态设置） */
  --scroll-offset: 0px;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5em 1em; /* 8px 16px - 表头内边距 */
  background-color: var(--toolbar-bg);
  border-bottom: var(--border-width) solid var(--border-color);
}

.table-header h3 {
  font-size: 0.95em; /* 接近基础字体 */
  font-weight: 600;
}

.table-actions {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.btn-batch-delete {
  padding: 0.25em 0.75em; /* 4px 12px - 紧凑按钮 */
  background-color: var(--error-color);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.9em; /* 略小但可读 */
  font-weight: 500;
  transition: all 0.2s;
}

.btn-batch-delete:hover {
  background-color: #cf1322;
  box-shadow: 0 1px 3px rgba(245, 34, 45, 0.2);
}

.search-input {
  padding: 0.55em 0.625em; /* 4px 10px - 搜索框 */
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 0.9em; /* 略小但可读 */
  width: 15rem; /* ← 固定宽度，避免 clamp 在 resize 时重新计算 */
  background-color: var(--input-bg);
  color: var(--text-color);
}

.table-content {
  flex: 1;
  overflow: auto; /* 允许水平滚动 */
  will-change: scroll-position; /* ← 优化滚动性能 */
  contain: layout style paint; /* ← 限制重排范围 */
}

/* resize 时禁用 sticky 提升性能 */
.table-content.resizing .table-header-grid,
.table-content.resizing .checkbox-col,
.table-content.resizing .path-cell,
.table-content.resizing .actions-col,
.table-content.resizing .frozen-left,
.table-content.resizing .frozen-right,
.table-content.resizing .header-cell.frozen-left,
.table-content.resizing .header-cell.frozen-right {
  position: static !important;
  box-shadow: none !important;
  z-index: auto !important;
}

.sort-indicator {
  display: inline-block;
  margin-left: var(--spacing-xs);
  font-size: 0.9em; /* 相对于表头字体 */
  opacity: 0.8;
}

/* 【C4 优化】虚拟滚动优化 - vue-virtual-scroller */
.virtual-table-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%; /* 【关键】父容器必须有固定高度 */
  overflow: hidden; /* 不处理滚动，交给子元素 */
}

/* 【冻结列】表头滚动容器 */
.header-scroll-container {
  overflow: hidden; /* 【关键】不处理滚动，由 JS 控制 */
  flex-shrink: 0;
}

.table-header-grid {
  display: grid;
  align-items: center;
  background-color: var(--bg-hover);
  border-bottom: var(--border-width-thick) solid var(--border-color);
  flex-shrink: 0; /* 【关键】表头不收缩 */
  width: max-content; /* 【关键】根据列宽总和自动计算 */
  min-width: 100%; /* 至少占满容器 */
  z-index: 10;
}

.header-cell {
  padding: 0.5em 0.75em; /* 8px 12px - VS Code 风格 */
  font-weight: 600;
  user-select: none;
  font-size: 0.9em; /* VS Code 表头略小 */
  white-space: nowrap; /* 防止表头换行 */
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 【冻结列】表头冻结单元格的 z-index */
.header-cell.frozen-left,
.header-cell.frozen-right {
  z-index: 11; /* 比表头容器更高 */
}

.virtual-scroller {
  width: max-content; /* 【关键】根据内容自动扩展 */
  min-width: 100%; /* 至少占满容器 */
  height: 100%; /* 占满高度 */
  overflow: auto !important; /* 【关键】DynamicScroller自己处理所有滚动 */
}

/* 【关键】强制内部容器撑开外层 */
.virtual-scroller :deep(.vue-recycle-scroller__item-wrapper) {
  width: max-content !important;
  min-width: 100% !important;
  overflow: visible !important; /* 【关键】覆盖overflow:hidden */
}

/* 【关键】包裹层，强制撑开宽度 */
.row-wrapper {
  width: max-content;
  min-width: 100%;
}

/* 【修复】虚拟滚动中的每行使用 Grid 布局 */
.virtual-row {
  display: grid;
  align-items: center;
  border-bottom: var(--border-width) solid var(--border-color);
  background-color: var(--bg-color);
  min-height: 40px;
  width: max-content; /* 【关键】根据列宽总和自动计算 */
  min-width: 100%; /* 至少占满容器 */
  transition: grid-template-columns 0.2s ease-out; /* 【新增】Grid 列宽变化平滑过渡 */
}

.virtual-row:hover {
  background-color: var(--bg-hover);
}

.cell {
  padding: 0.4375em 0.75em; /* 7px 12px - VS Code 风格 */
  color: var(--text-color);
  font-size: 0.9em; /* 与表头一致 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.checkbox-col {
  text-align: center;
}

/* 【冻结列】左侧冻结列 */
.frozen-left {
  position: sticky;
  left: 0;
  z-index: 5;
  background-color: inherit; /* 继承父元素背景色 */
}

/* 复选框列固定在左侧 */
.checkbox-col.frozen-left {
  z-index: 6; /* 比路径列更高 */
}

/* 路径列在复选框列右侧 */
.path-col.frozen-left,
.path-cell.frozen-left {
  left: 4em; /* 复选框列宽度 */
}

/* 【冻结列】右侧冻结列 */
.frozen-right {
  position: sticky;
  right: 0;
  z-index: 5;
  background-color: inherit;
}

/* 【关键】当表头使用 transform 时，冻结列需要反向 transform 来保持固定 */
.table-header-grid .frozen-left,
.table-header-grid .frozen-right {
  /* 不使用 position: relative，保持 Grid 布局 */
  transform: translateX(var(--scroll-offset, 0)); /* 动态抵消父元素的 transform */
}

.path-col {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: var(--path-col-max-width); /* 【新增】动态 max-width */
}

.time-cell {
  text-align: center;
}

.path-cell {
  /* 【简化】只有文件名列显示省略号 */
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: var(--path-col-max-width); /* 【新增】动态 max-width */
}

/* 【修复】数字列完全显示，不截断 */
.size-cell, .number-cell, .total-cell {
  text-align: right;
  overflow: visible; /* 数字列完整显示 */
  text-overflow: clip; /* 不显示省略号 */
  white-space: nowrap;
  min-width: 5em; /* 80px - 确保数字有足够空间 */
}

.number-header {
  text-align: right;
}

.time-header {
  text-align: center;
}

.center-header {
  text-align: center;
}

.actions-header {
  text-align: center;
}

.total-cell {
  font-weight: 600;
  color: var(--primary-color);
}

.highlight-count {
  color: var(--error-color);
  font-weight: 600;
}

/* 【需求变更】表达式列居中显示 */
.expression-column-center {
  text-align: center !important;
}

/* 【需求变更】表达式列的对勾图标样式 */
.check-icon-svg {
  width: 16px;
  height: 16px;
  color: var(--success-color);
}

.actions-cell {
  white-space: nowrap;
  display: flex;
  gap: 0.25em; /* 4px - 按钮间距 */
  justify-content: center; /* 居中对齐 */
}

.btn-action {
  padding: 0.25em; /* 4px - 内边距 */
  border: none;
  background-color: transparent;
  color: var(--text-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2em; /* 32px - 舒适的点击区域 */
  min-height: 2em;
}

.btn-action:hover {
  background-color: var(--bg-hover);
}

.btn-action:active {
  transform: translateY(0);
}

.action-icon {
  width: 1.5em; /* 24px - 更大的图标 */
  height: 1.5em;
  fill: currentColor;
}

.delete-icon {
  color: var(--error-color);
}

.btn-delete:hover {
  background-color: rgb(from var(--error-color) r g b / 10%);
}

.btn-delete:active {
  transform: translateY(0);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
}

.empty-state p {
  margin: 8px 0;
}

.hint {
  font-size: 13px;
  color: #999;
}
</style>
