import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';

export default defineConfig({
  plugins: [
    vue(),
    createSvgIconsPlugin({
      // 指定需要缓存的图标文件夹（支持子目录）
      iconDirs: [path.resolve(__dirname, 'src', 'assets', 'icons')],
      // 指定symbolId格式：统一为 icon-[name]，文件名需唯一
      // 例如：src/assets/icons/info.svg → icon-info
      //       src/assets/delete.svg → icon-delete
      symbolId: 'icon-[name]',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // 【新增】优化依赖，解决 @vue-office 包的入口解析问题
  optimizeDeps: {
    include: [
      '@vue-office/docx',
      '@vue-office/excel',
      '@vue-office/pdf',
      '@vue-office/pptx',
      'vue-demi',
    ],
  },
  base: './', // 使用相对路径，适配 Electron
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false, // 端口被占用时自动尝试下一个
    open: false, // 不自动打开浏览器（Electron 应用不需要）
    cors: true, // 允许跨域（方便调试）
    hmr: {
      overlay: true, // 显示错误覆盖层
    },
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'es2020', // Electron 22 支持 ES2020
    minify: 'esbuild', // 生产环境自动启用，速度快 10-20 倍
    sourcemap: process.env.NODE_ENV !== 'production',
    outDir: path.resolve(__dirname, '..', 'dist', 'renderer'), // 渲染进程输出到 dist/renderer，与主进程区分
    emptyOutDir: true, // 每次构建前清空输出目录
    assetsDir: 'assets',
    assetsInlineLimit: 4096, // 小于 4KB 的资源内联为 base64
    chunkSizeWarningLimit: 1000, // chunk 大小警告阈值（KB）
    rollupOptions: {
      output: {
        manualChunks: {
          // Vue 核心库单独分包
          'vue-vendor': ['vue', 'pinia'],
          // 虚拟滚动单独分包
          'virtual-scroller': ['vue-virtual-scroller'],
        },
      },
    },
  },
});
