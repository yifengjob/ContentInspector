# useEventListener 优化应用建议

**创建日期**: 2026-05-03  
**状态**: 📋 待评估  

---

## 📊 当前项目事件监听使用情况

### 1. ResultsTable.vue - window resize 监听

**位置**: `frontend/src/components/ResultsTable.vue` (第 250-262, 525-533 行)

**当前实现**:
```typescript
let resizeHandler: (() => void) | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  resizeHandler = () => {
    isResizing.value = true
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      isResizing.value = false
      updatePathMaxWidth()
    }, 300)
  }

  // 使用 passive listener 提升性能
  window.addEventListener('resize', resizeHandler, {passive: true})
})

onUnmounted(() => {
  if (resizeTimer) clearTimeout(resizeTimer)
  if (rafId) cancelAnimationFrame(rafId)

  // 清理 resize 监听器
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  // ... 其他清理
})
```

**问题分析**:
- ✅ 手动管理了生命周期（addEventListener/removeEventListener）
- ✅ 清理了定时器（clearTimeout）
- ⚠️ **代码冗余**：需要手动维护 `resizeHandler` 和 `resizeTimer` 变量
- ⚠️ **容易出错**：如果忘记清理会导致内存泄漏
- ⚠️ **可读性差**：逻辑分散在 onMounted 和 onUnmounted 中

---

### 2. theme.ts - 系统主题变化监听

**位置**: `frontend/src/utils/theme.ts` (第 52-69 行)

**当前实现**:
```typescript
export function watchSystemTheme(callback: (theme: 'light' | 'dark') => void) {
  if (typeof window !== 'undefined') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      callback(e.matches ? 'dark' : 'light')
    }
    
    mediaQuery.addEventListener('change', handleChange)
    
    // 返回清理函数
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }
  
  return () => {}
}
```

**问题分析**:
- ✅ 返回了清理函数（良好的设计）
- ⚠️ **调用方需要手动管理**：需要在组件卸载时调用返回的清理函数
- ⚠️ **无法自动清理**：如果调用方忘记调用清理函数，会导致泄漏

**使用示例**（假设在某个组件中）:
```typescript
let cleanup: (() => void) | null = null

onMounted(() => {
  cleanup = watchSystemTheme((theme) => {
    console.log('Theme changed:', theme)
  })
})

onUnmounted(() => {
  cleanup?.()  // ⚠️ 必须手动调用，容易忘记
})
```

---

### 3. PreviewModal.vue - scroll 事件（模板绑定）

**位置**: `frontend/src/components/PreviewModal.vue` (第 29 行)

**当前实现**:
```vue
<div 
  class="scroll-container"
  @scroll="handleScroll"
>
  <!-- 内容 -->
</div>
```

```typescript
let scrollTimeout: number | null = null
function handleScroll() {
  if (scrollTimeout) return
  
  scrollTimeout = window.setTimeout(() => {
    scrollTimeout = null
    renderVisibleContent()
  }, PREVIEW_CONFIG.SCROLL_DEBOUNCE_MS)
}
```

**问题分析**:
- ✅ Vue 模板事件绑定会自动清理（无需手动 removeEventListener）
- ⚠️ **手动实现防抖**：需要维护 `scrollTimeout` 变量
- ⚠️ **资源泄漏风险**：如果组件在 timeout 期间卸载，定时器仍会执行
- 💡 **这是使用 useEventListener 的最佳场景！**

---

## 🎯 优化建议

### 优先级 P0 - 强烈推荐优化

#### 1. PreviewModal.vue - scroll 事件防抖

**推荐理由**:
- ✅ 当前手动实现防抖，存在资源泄漏风险
- ✅ 使用频率高（滚动事件频繁触发）
- ✅ 优化后代码更简洁、更安全

**优化前**:
```vue
<script setup lang="ts">
let scrollTimeout: number | null = null

function handleScroll() {
  if (scrollTimeout) return
  
  scrollTimeout = window.setTimeout(() => {
    scrollTimeout = null
    renderVisibleContent()
  }, PREVIEW_CONFIG.SCROLL_DEBOUNCE_MS)
}
</script>

<template>
  <div class="scroll-container" @scroll="handleScroll">
    <!-- 内容 -->
  </div>
</template>
```

**优化后**:
```vue
<script setup lang="ts">
import { useEventListener } from '@/composables/useEventListener'
import { ref } from 'vue'

const scrollContainer = ref<HTMLDivElement | null>(null)

const handleScroll = () => {
  renderVisibleContent()
}

// ✅ 自动防抖 + 自动清理，无需手动管理
useEventListener(scrollContainer, 'scroll', {
  handler: handleScroll,
  rateLimit: { type: 'debounce', delay: PREVIEW_CONFIG.SCROLL_DEBOUNCE_MS }
})
</script>

<template>
  <div ref="scrollContainer" class="scroll-container">
    <!-- 内容 -->
  </div>
</template>
```

**优势**:
- ✅ 消除 `scrollTimeout` 变量
- ✅ 自动清理定时器，无泄漏风险
- ✅ 代码更简洁，意图更清晰
- ✅ 如果需要切换 RAF 驱动，只需改一行配置

---

### 优先级 P1 - 推荐优化

#### 2. ResultsTable.vue - window resize 监听

**推荐理由**:
- ✅ 当前手动管理生命周期，代码冗余
- ✅ 已有防抖逻辑（300ms），可以简化
- ⚠️ 使用了 `{passive: true}` 选项，需要注意保留

**优化前**:
```typescript
let resizeHandler: (() => void) | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  resizeHandler = () => {
    isResizing.value = true
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      isResizing.value = false
      updatePathMaxWidth()
    }, 300)
  }

  window.addEventListener('resize', resizeHandler, {passive: true})
})

onUnmounted(() => {
  if (resizeTimer) clearTimeout(resizeTimer)
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
})
```

**优化后**:
```typescript
import { useEventListener } from '@/composables/useEventListener'

const handleResize = () => {
  isResizing.value = true
  // 使用防抖，300ms 后重置状态并更新宽度
  setTimeout(() => {
    isResizing.value = false
    updatePathMaxWidth()
  }, 300)
}

// ✅ 自动管理生命周期 + 可选的防抖
useEventListener(window, 'resize', {
  handler: handleResize,
  options: { passive: true },  // 保留 passive 选项
  rateLimit: { type: 'debounce', delay: 300 }  // 内置防抖
})

// ❌ 不再需要 onUnmounted 中的清理代码
```

**优势**:
- ✅ 消除 `resizeHandler` 和 `resizeTimer` 变量
- ✅ 自动清理，无需 onUnmounted
- ✅ 代码减少约 15 行
- ✅ 逻辑更集中，易于维护

**注意事项**:
- ⚠️ 当前实现中 `isResizing.value = true` 在每次 resize 时立即执行
- ⚠️ 如果使用防抖，这个标志会在 300ms 后才设置
- ⚠️ **需要确认业务逻辑是否允许延迟**

**替代方案**（保持原有行为）:
```typescript
const handleResize = () => {
  isResizing.value = true
  
  // 不使用防抖，保持原有行为
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    isResizing.value = false
    updatePathMaxWidth()
  }, 300)
}

useEventListener(window, 'resize', {
  handler: handleResize,
  options: { passive: true }
})

// 仍然需要在 unmount 时清理定时器
onUnmounted(() => {
  if (resizeTimer) clearTimeout(resizeTimer)
})
```

**结论**: 由于当前逻辑的特殊性（立即设置标志位），**建议暂时不优化此场景**，或者重构业务逻辑后再优化。

---

### 优先级 P2 - 可选优化

#### 3. theme.ts - 系统主题监听

**推荐理由**:
- ⚠️ 当前已返回清理函数，设计良好
- ⚠️ 但调用方仍需手动管理
- 💡 可以提供一个 Vue composable 版本

**当前实现**（工具函数）:
```typescript
// utils/theme.ts
export function watchSystemTheme(callback: (theme: 'light' | 'dark') => void) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleChange = (e: MediaQueryListEvent) => {
    callback(e.matches ? 'dark' : 'light')
  }
  
  mediaQuery.addEventListener('change', handleChange)
  
  return () => {
    mediaQuery.removeEventListener('change', handleChange)
  }
}
```

**优化方案**（新增 composable）:
```typescript
// composables/useSystemTheme.ts
import { watchEffect } from 'vue'
import { useEventListener } from './useEventListener'
import { getSystemTheme, applyTheme } from '@/utils/theme'

export function useSystemThemeWatcher() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  
  const handleChange = () => {
    const currentMode = localStorage.getItem('theme-mode')
    // 只有在 system 模式下才响应系统主题变化
    if (currentMode === 'system') {
      applyTheme('system')
    }
  }
  
  // ✅ 使用 useEventListener 自动管理生命周期
  useEventListener(mediaQuery, 'change', handleChange)
}
```

**使用方式**:
```vue
<script setup lang="ts">
import { useSystemThemeWatcher } from '@/composables/useSystemTheme'

// ✅ 一行代码，自动管理生命周期
useSystemThemeWatcher()
</script>
```

**优势**:
- ✅ 调用方无需关心清理
- ✅ 更符合 Vue Composition API 风格
- ✅ 可以在多个组件中安全使用

**注意**: 这需要修改 `theme.ts` 或新增文件，**改动较大，可选实施**。

---

## 🎯 核心洞察

**useEventListener 的价值不仅在于防抖/节流，更在于：**

1. ✅ **自动生命周期管理** - 无需手动 addEventListener/removeEventListener
2. ✅ **统一的代码风格** - 所有事件监听用同样的方式
3. ✅ **可选的性能优化** - 需要时才加 rateLimit，不需要就不加
4. ✅ **类型安全** - TypeScript 完整支持

**即使不使用防抖/节流，useEventListener 仍然有价值！**

---

## 🎯 优化决策矩阵（更新版）

| 场景 | 当前问题 | 是否需防抖 | 优化收益 | 实施难度 | 推荐优先级 |
|------|---------|-----------|---------|---------|------------|
| **PreviewModal scroll** | 手动防抖，有泄漏风险 | ✅ 是 | ⭐⭐⭐⭐⭐ | ⭐ | **P0 - 立即优化** |
| **ResultsTable resize** | 代码冗余，手动管理 | ❌ 否（业务逻辑特殊） | ⭐⭐ | ⭐⭐ | **P1 - 不建议优化** |
| **theme.ts 系统主题** | 调用方需手动清理 | ❌ 否 | ⭐⭐ | ⭐⭐⭐ | **P2 - 可选优化** |

---

## 🎯 推荐行动方案

### 阶段 1：立即优化（P0）

**目标**: PreviewModal.vue scroll 事件

**步骤**:
1. ✅ 导入 `useEventListener`
2. ✅ 将 `@scroll` 改为 ref 绑定
3. ✅ 使用防抖配置
4. ✅ 删除 `scrollTimeout` 变量和相关清理代码
5. ✅ 测试滚动性能和功能

**预期收益**:
- 代码减少 ~10 行
- 消除资源泄漏风险
- 提高代码可维护性

---

### 阶段 2：评估后优化（P1）

**目标**: ResultsTable.vue resize 事件

**步骤**:
1. ⚠️ 先确认 `isResizing` 标志位的业务用途
2. ⚠️ 评估是否可以接受防抖带来的延迟
3. ⚠️ 如果可以，按上述方案优化
4. ⚠️ 如果不能，保持现状或寻找其他优化方案

**预期收益**:
- 代码减少 ~15 行
- 简化生命周期管理

---

### 阶段 3：长期优化（P2）

**目标**: theme.ts 系统主题监听

**步骤**:
1. 💡 评估是否需要 Vue composable 版本
2. 💡 如果项目中多处使用，考虑重构
3. 💡 如果只是单次使用，保持现状即可

**预期收益**:
- 更好的 DX（开发者体验）
- 更符合 Vue 生态习惯

---

## ⚠️ 注意事项

### 1. 性能考虑

**useEventListener 的性能开销**:
- ✅ 非常小，只是简单的函数包装
- ✅ 防抖/节流逻辑与手动实现相同
- ✅ 额外开销仅在组件挂载/卸载时（可忽略）

**对比**:
```typescript
// 手动实现
window.addEventListener('scroll', debouncedHandler)
onUnmounted(() => {
  window.removeEventListener('scroll', debouncedHandler)
  debouncedHandler.cancel()  // 如果有的话
})

// useEventListener
useEventListener(window, 'scroll', {
  handler: handleScroll,
  rateLimit: { type: 'debounce', delay: 300 }
})
// 自动清理，性能相同甚至更好（因为确保了清理）
```

---

### 2. 兼容性考虑

**当前项目环境**:
- ✅ Vue 3 Composition API
- ✅ TypeScript
- ✅ 现代浏览器（Electron 内置 Chromium）

**useEventListener 完全兼容**，无需担心。

---

### 3. 渐进式采用

**不必一次性替换所有事件监听**：

1. ✅ 新代码优先使用 `useEventListener`
2. ✅ 遇到 bug 或需要重构时再替换旧代码
3. ✅ 对于简单的一次性监听，原生 API 也完全可以

**原则**: 不要为了优化而优化，要在合适的场景使用合适的工具。

---

## 📝 总结

### ✅ 推荐立即优化的场景

**PreviewModal.vue - scroll 事件**
- 理由：手动防抖有泄漏风险，优化收益高
- 是否需防抖：✅ 是
- 难度：低
- 收益：高

### ❌ 不建议优化的场景

**ResultsTable.vue - resize 事件**
- 理由：业务逻辑特殊（立即设置标志位），防抖不合适；不带防抖则收益有限
- 是否需防抖：❌ 否
- 难度：中
- 收益：低

### 💡 可选优化的场景

**theme.ts - 系统主题监听**
- 理由：当前设计已足够好，改动收益不大
- 是否需防抖：❌ 否
- 难度：中高
- 收益：低

---

## 🎯 最终建议

**可以优化，但要分场景：**

1. **优先优化 PreviewModal.vue**
   - ✅ 这是最合适的场景
   - ✅ 需要防抖，正好匹配 useEventListener 的优势
   - ✅ 风险最低，收益最高
   - ✅ 可以立即实施

2. **不优化 ResultsTable.vue**
   - ❌ 业务逻辑特殊，不需要防抖
   - ❌ 如果不用防抖，useEventListener 的收益有限
   - ❌ 保持现状更好

3. **theme.ts 暂时不动**
   - 💡 当前设计已经很好
   - 💡 改动收益不大
   - 💡 除非项目中多处使用

---

**核心原则**: 
- ✅ **需要防抖/节流时** → 强烈推荐使用 useEventListener
- ✅ **不需要防抖但想简化代码** → 可以使用，但收益有限
- ❌ **业务逻辑复杂且不需要防抖** → 保持现状可能更好

**建议**: 先从 **PreviewModal.vue** 开始优化，验证效果后再决定是否推广到其他场景。

---

**文档版本**: 1.0.0  
**最后更新**: 2026-05-03
