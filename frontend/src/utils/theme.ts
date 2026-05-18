// 主题类型
export type ThemeMode = 'light' | 'dark' | 'system';

// 主题配置接口
export interface ThemeConfig {
  mode: ThemeMode;
}

// 获取系统主题偏好
export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

// 应用主题到 DOM
export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;

  // 【C6 优化】添加过渡类，实现平滑切换
  root.classList.add('theme-transitioning');

  if (mode === 'system') {
    const systemTheme = getSystemTheme();
    root.setAttribute('data-theme', systemTheme);
  } else {
    root.setAttribute('data-theme', mode);
  }

  // 保存到 localStorage
  localStorage.setItem('theme-mode', mode);

  // 【C6 优化】延迟移除过渡类，确保动画完成
  setTimeout(() => {
    root.classList.remove('theme-transitioning');
  }, 300);
}

// 从 localStorage 加载主题
export function loadTheme(): ThemeMode {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme-mode');
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      return saved as ThemeMode;
    }
  }
  return 'system'; // 默认跟随系统
}

// 监听系统主题变化
export function watchSystemTheme(callback: (theme: 'light' | 'dark') => void) {
  if (typeof window !== 'undefined') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      callback(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);

    // 返回清理函数
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }

  return () => {};
}
