/**
 * PDF.js 浏览器环境 Polyfill
 * 
 * pdf.js 3.x legacy build 在 Node.js 环境中需要浏览器全局对象
 * 此模块提供完整的 polyfill，确保 pdf.js 能正常工作
 */

import {logger} from "../logger/logger";

/**
 * 为 pdf.js 设置浏览器环境 polyfill
 * 必须在加载 pdf.js 之前调用
 * 
 * @param context - 全局对象上下文（默认为 global）
 */
export function setupPdfJsPolyfills(context: any = global): void {
  // 如果已经设置过，跳过
  if (typeof context.window !== 'undefined') {
    return;
  }

  try {
    // 模拟 window 对象
    context.window = context;

    // DOMException（pdf.js 需要）
    if (typeof context.DOMException === 'undefined') {
      context.DOMException = class DOMException extends Error {
        constructor(message?: string, name?: string) {
          super(message);
          this.name = name || 'DOMException';
        }
      };
    }

    // ReadableStream（pdf.js 需要）
    if (typeof context.ReadableStream === 'undefined') {
      try {
        const { ReadableStream } = require('stream/web');
        context.ReadableStream = ReadableStream;
      } catch (e) {
        // 在开发环境下输出警告，帮助诊断问题
        if (process.env.NODE_ENV === 'development') {
          logger.warn('[PDF Polyfill] ReadableStream 不可用，pdf.js 可能无法正常工作');
        }
      }
    }

    // 【关键修复】Path2D polyfill（防止 pdf.js 尝试加载 canvas 模块）
    if (typeof context.Path2D === 'undefined') {
      context.Path2D = class Path2D {
        constructor(path?: any) {
          // 空实现，仅用于避免 pdf.js 报错
        }
        addPath() {}
        arc() {}
        arcTo() {}
        bezierCurveTo() {}
        closePath() {}
        ellipse() {}
        lineTo() {}
        moveTo() {}
        quadraticCurveTo() {}
        rect() {}
      };
    }

    // 模拟 document 对象
    context.document = {
      documentElement: { style: {} },
      createElement: () => ({ style: {}, getContext: () => null }),
      createTextNode: () => ({}),
    };

    // 模拟 navigator 对象
    context.navigator = { userAgent: 'Node.js' };

    // 模拟 HTMLElement 类
    context.HTMLElement = class HTMLElement {};
  } catch (error) {
    logger.error('[PDF Polyfill] 设置失败:', error);
    throw error;
  }
}

/**
 * 初始化 DOMMatrix（用于 PDF 渲染）
 * 
 * @param context - 全局对象上下文（默认为 global）
 */
export function setupDomMatrix(context: any = global): void {
  if (typeof context.DOMMatrix !== 'undefined') {
    return; // 已存在，跳过
  }

  // 【修复】移除 @napi-rs/canvas 依赖，避免 Windows 平台缺少 ffmpeg.dll 的问题
  // pdf.js 有自己的矩阵处理逻辑，不需要额外的 DOMMatrix polyfill
  // 如果确实需要，可以使用轻量级的替代方案
  
  // 简单的 DOMMatrix polyfill（仅支持基础功能）
  context.DOMMatrix = class DOMMatrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;

    constructor(init?: string | number[]) {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;

      if (typeof init === 'string') {
        const values = init.split(/[\s,]+/).map(Number);
        if (values.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = values;
        }
      } else if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }

    multiply(other: DOMMatrix): DOMMatrix {
      return new DOMMatrix([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f,
      ]);
    }

    transformPoint(point: { x: number; y: number }): { x: number; y: number } {
      return {
        x: this.a * point.x + this.c * point.y + this.e,
        y: this.b * point.x + this.d * point.y + this.f,
      };
    }

    inverse(): DOMMatrix {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) {
        throw new Error('Matrix is not invertible');
      }
      return new DOMMatrix([
        this.d / det,
        -this.b / det,
        -this.c / det,
        this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det,
      ]);
    }
  };
}

/**
 * 初始化 Promise.withResolvers polyfill
 * （某些旧版本 Node.js 或库可能需要）
 * 
 * @param context - 全局对象上下文（默认为 global）
 */
export function setupPromiseWithResolvers(context: any = global): void {
  if (typeof (context.Promise as any).withResolvers !== 'undefined') {
    return; // 已存在，跳过
  }

  (context.Promise as any).withResolvers = function() {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

/**
 * 一次性设置所有 PDF 相关的 polyfill
 * 推荐在应用启动时调用
 * 
 * @param context - 全局对象上下文（默认为 global）
 */
export function setupAllPdfPolyfills(context: any = global): void {
  try {
    setupPromiseWithResolvers(context);
    setupDomMatrix(context);
    setupPdfJsPolyfills(context);
  } catch (error) {
    logger.error('[PDF Polyfill] 设置失败:', error);
    throw error;
  }
}
