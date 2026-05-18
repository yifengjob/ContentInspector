/**
 * 可调整大小的窗口 Composable
 *
 * 提供窗口拖拽调整大小的功能
 * 支持 8 个方向的调整：上、下、左、右、四个角
 */

import { ref, onUnmounted, type Ref } from 'vue';

export interface ResizeOptions {
  minWidth: number; // 最小宽度
  minHeight: number; // 最小高度
  maxWidth?: number; // 最大宽度（可选）
  maxHeight?: number; // 最大高度（可选）
}

export interface ResizeState {
  isResizing: boolean;
  direction: string;
}

/**
 * 可调整大小的窗口 Hook
 * @param containerRef 容器元素的引用
 * @param options 调整大小的配置选项
 */
export function useResizable(containerRef: Ref<HTMLElement | null>, options: ResizeOptions) {
  const { minWidth, minHeight, maxWidth, maxHeight } = options;

  // 调整状态
  const isResizing = ref(false);
  const currentDirection = ref('');

  // 【修复】标记是否刚刚结束调整，用于防止遮罩层点击关闭
  let justFinishedResizing = false;

  // 拖拽起始状态
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let startLeft = 0;
  let startTop = 0;

  /**
   * 开始调整大小
   */
  function handleMouseDown(direction: string, event: MouseEvent) {
    if (!containerRef.value) return;

    event.preventDefault();
    event.stopPropagation();

    isResizing.value = true;
    currentDirection.value = direction;
    justFinishedResizing = false;

    // 记录起始状态
    startX = event.clientX;
    startY = event.clientY;
    const rect = containerRef.value.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    startLeft = rect.left;
    startTop = rect.top;

    // 添加全局事件监听
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // 防止文本选中
    document.body.style.userSelect = 'none';
    document.body.style.cursor = getCursorStyle(direction);
  }

  /**
   * 处理鼠标移动
   */
  function handleMouseMove(event: MouseEvent) {
    if (!isResizing.value || !containerRef.value) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    // 计算新尺寸
    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;

    // 水平方向调整
    if (currentDirection.value.includes('e')) {
      // 向右调整
      newWidth = startWidth + deltaX;
    } else if (currentDirection.value.includes('w')) {
      // 向左调整
      newWidth = startWidth - deltaX;
      newLeft = startLeft + deltaX;
    }

    // 垂直方向调整
    if (currentDirection.value.includes('s')) {
      // 向下调整
      newHeight = startHeight + deltaY;
    } else if (currentDirection.value.includes('n')) {
      // 向上调整
      newHeight = startHeight - deltaY;
      newTop = startTop + deltaY;
    }

    // 应用最小/最大限制
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth ?? window.innerWidth * 0.9));
    newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight ?? window.innerHeight * 0.9));

    // 应用新尺寸和位置
    containerRef.value.style.width = `${newWidth}px`;
    containerRef.value.style.height = `${newHeight}px`;

    // 如果是向左或向上调整，需要同时更新位置
    if (currentDirection.value.includes('w') || currentDirection.value.includes('n')) {
      containerRef.value.style.left = `${newLeft}px`;
      containerRef.value.style.top = `${newTop}px`;
    }
  }

  /**
   * 结束调整
   */
  function handleMouseUp() {
    isResizing.value = false;
    justFinishedResizing = true;
    currentDirection.value = '';

    // 移除全局事件监听
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // 恢复默认样式
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    // 【修复】延迟重置标志，给遮罩层点击检查留出时间窗口
    setTimeout(() => {
      justFinishedResizing = false;
    }, 100);
  }

  /**
   * 检查是否正在调整或刚刚结束调整
   */
  function getIsResizing(): boolean {
    return isResizing.value || justFinishedResizing;
  }

  /**
   * 获取光标样式
   */
  function getCursorStyle(direction: string): string {
    const cursorMap: Record<string, string> = {
      n: 'n-resize',
      s: 's-resize',
      e: 'e-resize',
      w: 'w-resize',
      ne: 'ne-resize',
      nw: 'nw-resize',
      se: 'se-resize',
      sw: 'sw-resize',
    };
    return cursorMap[direction] || 'default';
  }

  /**
   * 重置窗口大小为默认值
   */
  function resetSize() {
    if (!containerRef.value) return;

    // 清除内联样式，让 CSS 类控制尺寸
    containerRef.value.style.width = '';
    containerRef.value.style.height = '';
    containerRef.value.style.left = '';
    containerRef.value.style.top = '';
  }

  // 组件卸载时清理事件监听
  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  });

  return {
    isResizing,
    currentDirection,
    handleMouseDown,
    resetSize,
    getIsResizing,
  };
}
