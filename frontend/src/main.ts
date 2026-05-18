import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/App.vue';
import '@/style.css';
import { applyTheme, loadTheme } from '@/utils/theme';
// 导入 SVG Sprite 虚拟模块（自动生成）
import 'virtual:svg-icons-register';

// 初始化主题
const initialTheme = loadTheme();
applyTheme(initialTheme);

// 检测平台并添加对应的类名
const getPlatform = (): 'macos' | 'windows' | 'linux' | 'unknown' => {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';

  return 'unknown';
};

const platform = getPlatform();
if (platform === 'macos') {
  document.body.classList.add('platform-macos');
} else if (platform === 'windows') {
  document.body.classList.add('platform-windows');
} else if (platform === 'linux') {
  document.body.classList.add('platform-linux');
}

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.mount('#app');
