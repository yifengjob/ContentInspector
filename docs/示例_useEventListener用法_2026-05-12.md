# useEventListener 使用示例

**创建日期**: 2026-05-03  
**状态**: ✅ 已修复，可安全使用  

---

## 📖 基础用法

### 1. 简单事件监听（无防抖/节流）

```vue
<script setup lang="ts">
import { useEventListener } from '@/composables/useEventListener'

const handleClick = (e: MouseEvent) => {
  console.log('Clicked:', e.target)
}

// ✅ 自动清理，组件卸载时移除监听器
useEventListener(window, 'click', handleClick)
</script>
```

---

### 2. 防抖事件监听

```vue
<script setup lang="ts">
import { useEventListener } from '@/composables/useEventListener'

const handleSearch = (e: KeyboardEvent) => {
  const input = e.target as HTMLInputElement
  console.log('Searching:', input.value)
}

// ✅ 防抖 300ms，组件卸载时自动清理定时器
useEventListener(document.getElementById('search')!, 'input', {
  handler: handleSearch,
  rateLimit: { 
    type: 'debounce', 
    delay: 300 
  }
})
</script>
```

---

### 3. 节流事件监听（RAF 驱动）

```vue
<script setup lang="ts">
import { useEventListener } from '@/composables/useEventListener'

const handleScroll = () => {
  console.log('Scrolled to:', window.scrollY)
}

// ✅ RAF 节流，每帧最多执行一次，组件卸载时自动清理
useEventListener(window, 'scroll', {
  handler: handleScroll,
  rateLimit: { 
    type: 'throttle', 
    driver: 'raf'  // 使用 requestAnimationFrame
  }
})
</script>
```

---

### 4. 批量事件监听

```vue
<script setup lang="ts">
import { useEventListener } from '@/composables/useEventListener'

const handleResize = () => {
  console.log('Window resized:', window.innerWidth, window.innerHeight)
}

const handleKeyDown = (e: KeyboardEvent) => {
  console.log('Key pressed:', e.key)
}

// ✅ 一次性注册多个事件，全部自动清理
useEventListener(window, {
  resize: { 
    handler: handleResize, 
    rateLimit: { type: 'throttle', delay: 100 } 
  },
  keydown: handleKeyDown
})
</script>
```

---

### 5. 使用 Ref 作为目标

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useEventListener } from '@/composables/useEventListener'

const scrollContainer = ref<HTMLDivElement | null>(null)

const handleContainerScroll = () => {
  if (scrollContainer.value) {
    console.log('Container scrolled:', scrollContainer.value.scrollTop)
  }
}

// ✅ 支持 Vue ref，target 变化时自动重新绑定
useEventListener(scrollContainer, 'scroll', {
  handler: handleContainerScroll,
  rateLimit: { type: 'debounce', delay: 200 }
})

onMounted(() => {
  // 稍后赋值 ref，监听器会自动绑定
  setTimeout(() => {
    scrollContainer.value = document.getElementById('container')
  }, 1000)
})
</script>

<template>
  <div ref="scrollContainer" style="height: 400px; overflow: auto;">
    <!-- 内容 -->
  </div>
</template>
```

---

## 🎯 高级用法

### 6. 使用预置的 RAF 版本

```vue
<script setup lang="ts">
import { useRafEventListener } from '@/composables/useEventListener'

const handleMouseMove = (e: MouseEvent) => {
  console.log('Mouse position:', e.clientX, e.clientY)
}

// ✅ 所有未指定 driver 的防抖/节流都默认使用 RAF
useRafEventListener(window, 'mousemove', {
  handler: handleMouseMove,
  rateLimit: { type: 'throttle' }  // 自动使用 RAF
})
</script>
```

---

### 7. 自定义全局配置

```typescript
// composables/customEventListener.ts
import { createUseEventListener } from '@/composables/useEventListener'

// 创建自定义版本，所有防抖默认使用 RAF
export const useCustomEventListener = createUseEventListener({
  defaultUseRafDebounce: true,
  defaultDebounceDelay: 250,
  defaultThrottleDelay: 100
})
```

```vue
<script setup lang="ts">
import { useCustomEventListener } from '@/composables/customEventListener'

const handleInput = (e: Event) => {
  console.log('Input changed')
}

// ✅ 自动应用全局配置：RAF + 250ms 防抖
useCustomEventListener(inputElement, 'input', {
  handler: handleInput,
  rateLimit: { type: 'debounce' }  // 无需指定 delay 和 driver
})
</script>
```

---

### 8. 带选项的事件监听

```vue
<script setup lang="ts">
import { useEventListener } from '@/composables/useEventListener'

const handlePassiveScroll = () => {
  console.log('Passive scroll')
}

// ✅ 传递 addEventListener 选项
useEventListener(window, 'scroll', {
  handler: handlePassiveScroll,
  rateLimit: { type: 'throttle', delay: 100 },
  options: { passive: true }  // 提升滚动性能
})
</script>
```

---

## 🔍 实际应用场景

### 场景 1：搜索框防抖

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@/composables/useEventListener'

const searchQuery = ref('')
const searchResults = ref([])

const performSearch = async (e: Event) => {
  const input = e.target as HTMLInputElement
  searchQuery.value = input.value
  
  if (searchQuery.value.length > 2) {
    const response = await fetch(`/api/search?q=${searchQuery.value}`)
    searchResults.value = await response.json()
  }
}

// ✅ 用户停止输入 300ms 后才执行搜索，减少 API 调用
useEventListener('#search-input', 'input', {
  handler: performSearch,
  rateLimit: { type: 'debounce', delay: 300 }
})
</script>
```

---

### 场景 2：滚动加载（节流）

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@/composables/useEventListener'

const isLoading = ref(false)
const hasMore = ref(true)

const checkScroll = () => {
  if (isLoading.value || !hasMore.value) return
  
  const scrollTop = window.scrollY
  const windowHeight = window.innerHeight
  const documentHeight = document.documentElement.scrollHeight
  
  // 距离底部 200px 时加载更多
  if (scrollTop + windowHeight >= documentHeight - 200) {
    loadMoreItems()
  }
}

const loadMoreItems = async () => {
  isLoading.value = true
  try {
    const response = await fetch('/api/items?page=2')
    // 处理数据...
  } finally {
    isLoading.value = false
  }
}

// ✅ RAF 节流，确保流畅滚动体验
useEventListener(window, 'scroll', {
  handler: checkScroll,
  rateLimit: { type: 'throttle', driver: 'raf' }
})
</script>
```

---

### 场景 3：窗口大小调整（防抖）

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@/composables/useEventListener'

const layout = ref<'mobile' | 'tablet' | 'desktop'>('desktop')

const updateLayout = () => {
  const width = window.innerWidth
  
  if (width < 768) {
    layout.value = 'mobile'
  } else if (width < 1024) {
    layout.value = 'tablet'
  } else {
    layout.value = 'desktop'
  }
  
  console.log('Layout updated:', layout.value)
}

// ✅ 窗口调整完成后才更新布局，避免频繁计算
useEventListener(window, 'resize', {
  handler: updateLayout,
  rateLimit: { type: 'debounce', delay: 200 }
})
</script>
```

---

### 场景 4：鼠标轨迹绘制（RAF 节流）

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useEventListener } from '@/composables/useEventListener'

const canvas = ref<HTMLCanvasElement | null>(null)
const ctx = ref<CanvasRenderingContext2D | null>(null)
const lastPoint = ref<{ x: number; y: number } | null>(null)

const drawLine = (e: MouseEvent) => {
  if (!ctx.value || !canvas.value) return
  
  const currentPoint = { x: e.clientX, y: e.clientY }
  
  if (lastPoint.value) {
    ctx.value.beginPath()
    ctx.value.moveTo(lastPoint.value.x, lastPoint.value.y)
    ctx.value.lineTo(currentPoint.x, currentPoint.y)
    ctx.value.stroke()
  }
  
  lastPoint.value = currentPoint
}

onMounted(() => {
  if (canvas.value) {
    ctx.value = canvas.value.getContext('2d')
    if (ctx.value) {
      ctx.value.strokeStyle = '#1890ff'
      ctx.value.lineWidth = 2
    }
  }
})

// ✅ RAF 节流，与浏览器刷新率同步，绘制更流畅
useEventListener(window, 'mousemove', {
  handler: drawLine,
  rateLimit: { type: 'throttle', driver: 'raf' }
})
</script>

<template>
  <canvas ref="canvas" width="800" height="600"></canvas>
</template>
```

---

## ⚠️ 注意事项

### ✅ 推荐做法

```typescript
// 1. 优先使用配置对象模式
useEventListener(window, 'scroll', {
  handler: handleScroll,
  rateLimit: { type: 'throttle', delay: 100 }
})

// 2. 对于高频事件，使用 RAF 驱动
useEventListener(window, 'mousemove', {
  handler: handleMouseMove,
  rateLimit: { type: 'throttle', driver: 'raf' }
})

// 3. 批量注册相关事件
useEventListener(window, {
  resize: handleResize,
  scroll: { handler: handleScroll, rateLimit: { type: 'throttle', delay: 100 } }
})
```

---

### ❌ 避免的做法

```typescript
// 1. 不要手动管理生命周期（已由 composable 自动处理）
// ❌ 不需要这样做
const cleanup = useEventListener(...)
onBeforeUnmount(cleanup)

// 2. 不要在循环中注册监听器
// ❌ 错误示例
items.forEach(item => {
  useEventListener(item.el, 'click', handleClick)
})

// ✅ 正确做法：使用事件委托
useEventListener(parentEl, 'click', (e) => {
  const target = e.target as HTMLElement
  if (target.matches('.item')) {
    handleClick(e)
  }
})

// 3. 不要忘记 handler 是必需的
// ❌ 错误示例
useEventListener(window, 'resize', {
  rateLimit: { type: 'debounce', delay: 200 }
  // 缺少 handler!
})

// ✅ 正确示例
useEventListener(window, 'resize', {
  handler: handleResize,  // ✅ 必需
  rateLimit: { type: 'debounce', delay: 200 }
})
```

---

## 🎉 总结

**useEventListener 的核心优势**：

1. ✅ **自动清理** - 组件卸载时自动移除监听器和清理定时器
2. ✅ **类型安全** - 完整的 TypeScript 支持
3. ✅ **灵活配置** - 支持防抖、节流、RAF 等多种模式
4. ✅ **易于使用** - 简洁的 API，多种调用方式
5. ✅ **性能优化** - 内置防抖/节流，减少不必要的执行

**现在可以放心地在项目中使用！** 🚀

---

**文档版本**: 1.0.0  
**最后更新**: 2026-05-03
