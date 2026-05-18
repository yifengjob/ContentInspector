// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// 格式化数字为千分位
export function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

// 格式化时间
export function formatTime(isoString: string): string {
  if (!isoString || isoString === '未知') return '未知';

  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return isoString;
  }
}

// ==================== 工具函数 ====================

// 【新增】防抖函数
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>) {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

// 【新增】节流函数
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;

  return function (...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastTime >= wait) {
      lastTime = now;
      func(...args);
    }
  };
}

// 【新增】并发限制执行（Promise Pool）
export async function promisePool<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 10
): Promise<Array<{ status: 'fulfilled'; value?: T } | { status: 'rejected'; reason: any }>> {
  const results: Array<{ status: 'fulfilled'; value?: T } | { status: 'rejected'; reason: any }> =
    [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++;
      const task = tasks[currentIndex];
      try {
        const result = await task();
        results[currentIndex] = { status: 'fulfilled', value: result };
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error };
      }
    }
  }

  // 创建并发 workers
  const workers = Array(Math.min(concurrency, tasks.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}
