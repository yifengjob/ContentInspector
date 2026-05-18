/**
 * Config 模块 - 配置管理
 */

// 常量配置
export * from './constants';

// 配置管理器
export {
  loadConfig,
  saveConfig,
  calculateRecommendedConcurrency,
  calculateActualConcurrency,
  calculateMaxLargeFilesConcurrent,
  getConfigSync,
} from './manager';
