// SVG 模块类型声明
declare module '*.svg' {
  const content: string;
  export default content;
}

// Electron API 类型由 src/preload.ts 提供
