// composables/useEventListener.ts
import { onMounted, onBeforeUnmount, unref, type Ref, watch } from 'vue';

// ===================== 类型定义 =====================

/** 驱动类型：'timeout' 使用 setTimeout，'raf' 使用 requestAnimationFrame */
export type EventDriver = 'timeout' | 'raf';

/** 防抖配置 */
export interface DebounceConfig {
  type: 'debounce';
  /**
   * 延迟时间（毫秒），仅在 driver = 'timeout' 时有效。
   * 若 driver = 'raf'，该值被忽略，防抖将在下一帧执行。
   * @default 0
   */
  delay?: number;
  /** 驱动类型，默认为 'timeout' */
  driver?: EventDriver;
}

/** 节流配置 */
export interface ThrottleConfig {
  type: 'throttle';
  /**
   * 延迟时间（毫秒），仅在 driver = 'timeout' 时有效。
   * 若 driver = 'raf'，该值被忽略，节流将保证每帧最多执行一次。
   * @default 0
   */
  delay?: number;
  /** 驱动类型，默认为 'timeout' */
  driver?: EventDriver;
}

/** 频率限制配置（防抖或节流） */
export type RateLimitConfig = DebounceConfig | ThrottleConfig;

/** 单个事件的完整配置对象 */
export interface EventConfig {
  /** 事件处理函数 */
  handler: EventListener;
  /** 可选的频率限制配置 */
  rateLimit?: RateLimitConfig;
  /** addEventListener 的 options（例如 { capture, once, passive }） */
  options?: boolean | AddEventListenerOptions;
}

/** 事件映射：事件名 -> 处理函数或完整配置 */
export type EventsMap = Record<string, EventListener | EventConfig>;

/** 全局默认配置 */
export interface GlobalEventListenerConfig {
  /** 默认驱动类型（当防抖/节流未指定 driver 时使用） */
  defaultDriver?: EventDriver;
  /** 默认防抖延迟（毫秒） */
  defaultDebounceDelay?: number;
  /** 默认节流延迟（毫秒） */
  defaultThrottleDelay?: number;
  /** 是否默认启用 RAF 防抖（若为 true，则 defaultDriver 强制为 'raf'） */
  defaultUseRafDebounce?: boolean;
  /** 是否默认启用 RAF 节流（若为 true，则 defaultDriver 强制为 'raf'） */
  defaultUseRafThrottle?: boolean;
}

// ===================== 内部工具函数 =====================

/** 带取消方法的频率限制函数 */
interface RateLimitedFunction extends EventListener {
  cancel?: () => void;
}

/**
 * 防抖实现（支持 timeout 与 raf 两种驱动）
 * @param fn 原始函数
 * @param delay 延迟毫秒（仅 timeout 模式有效）
 * @param driver 驱动类型
 * @returns 包装后的防抖函数（带 cancel 方法）
 */
function debounce(fn: EventListener, delay: number, driver: EventDriver): RateLimitedFunction {
  let timer: number | ReturnType<typeof setTimeout> | null = null;

  const wrapped = ((...args: Parameters<EventListener>) => {
    if (timer !== null) {
      if (driver === 'raf') {
        cancelAnimationFrame(timer as number);
      } else {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      }
    }
    const execute = () => {
      fn(...(args as unknown as [Event]));
      timer = null;
    };
    if (driver === 'raf') {
      timer = requestAnimationFrame(execute);
    } else {
      timer = setTimeout(execute, delay);
    }
  }) as unknown as RateLimitedFunction;

  // 【修复】添加取消方法，防止资源泄漏
  wrapped.cancel = () => {
    if (timer !== null) {
      if (driver === 'raf') {
        cancelAnimationFrame(timer as number);
      } else {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      }
      timer = null;
    }
  };

  return wrapped;
}

/**
 * 节流实现（支持 timeout 与 raf 两种驱动）
 * @param fn 原始函数
 * @param delay 延迟毫秒（仅 timeout 模式有效）
 * @param driver 驱动类型
 * @returns 包装后的节流函数（带 cancel 方法）
 */
function throttle(fn: EventListener, delay: number, driver: EventDriver): RateLimitedFunction {
  if (driver === 'raf') {
    let ticking = false;
    let rafId: number | null = null;

    const wrapped = ((...args: Parameters<EventListener>) => {
      if (!ticking) {
        ticking = true;
        rafId = requestAnimationFrame(() => {
          fn(...(args as unknown as [Event]));
          ticking = false;
          rafId = null;
        });
      }
    }) as unknown as RateLimitedFunction;

    // 【修复】添加取消方法，防止资源泄漏
    wrapped.cancel = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        ticking = false;
      }
    };

    return wrapped;
  } else {
    let lastRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const wrapped = ((...args: Parameters<EventListener>) => {
      const now = Date.now();
      const remaining = delay - (now - lastRun);
      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        fn(...(args as unknown as [Event]));
        lastRun = now;
      } else if (!timer) {
        timer = setTimeout(() => {
          fn(...(args as unknown as [Event]));
          lastRun = Date.now();
          timer = null;
        }, remaining);
      }
    }) as unknown as RateLimitedFunction;

    // 【修复】添加取消方法，防止资源泄漏
    wrapped.cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    return wrapped;
  }
}

/**
 * 将原始处理函数用频率限制包装（如果提供了配置）
 * @param handler 原始事件处理函数
 * @param config 频率限制配置
 * @param globalDefaults 全局默认配置（用于补全缺失字段）
 * @returns 包装后的函数（或原函数）
 */
function wrapWithRateLimit(
  handler: EventListener,
  config: RateLimitConfig | undefined,
  globalDefaults: GlobalEventListenerConfig = {}
): EventListener | RateLimitedFunction {
  if (!config) return handler;

  const { type } = config;
  let { delay, driver } = config;

  if (type === 'debounce') {
    if (delay === undefined) delay = globalDefaults.defaultDebounceDelay ?? 0;
    if (driver === undefined) {
      if (globalDefaults.defaultUseRafDebounce) driver = 'raf';
      else driver = globalDefaults.defaultDriver ?? 'timeout';
    }
    return debounce(handler, delay, driver);
  } else {
    if (delay === undefined) delay = globalDefaults.defaultThrottleDelay ?? 0;
    if (driver === undefined) {
      if (globalDefaults.defaultUseRafThrottle) driver = 'raf';
      else driver = globalDefaults.defaultDriver ?? 'timeout';
    }
    return throttle(handler, delay, driver);
  }
}

// ===================== 工厂函数 =====================

/**
 * 创建带有全局默认配置的 useEventListener 函数
 * @param globalConfig 全局配置，影响所有通过该函数注册的事件监听
 * @returns 配置好的 useEventListener 函数
 */
export function createUseEventListener(globalConfig: GlobalEventListenerConfig = {}) {
  function useEventListenerImpl(
    target: EventTarget | Ref<EventTarget | null | undefined>,
    eventOrMap: string | EventsMap,
    handlerOrConfig?: EventListener | EventConfig,
    maybeOptions?: boolean | AddEventListenerOptions
  ): void {
    // 归一化参数为 { event, handler, options } 数组
    interface NormalizedEvent {
      event: string;
      handler: EventListener | RateLimitedFunction;
      options?: boolean | AddEventListenerOptions;
    }

    let normalizedEvents: NormalizedEvent[] = [];

    if (typeof eventOrMap === 'string') {
      const eventName = eventOrMap;
      let handler: EventListener;
      let rateLimit: RateLimitConfig | undefined;
      let options: boolean | AddEventListenerOptions | undefined;

      if (typeof handlerOrConfig === 'function') {
        handler = handlerOrConfig;
        options = maybeOptions;
      } else if (handlerOrConfig && typeof handlerOrConfig === 'object') {
        handler = handlerOrConfig.handler;
        // 【修复】边界条件检查
        if (!handler) {
          console.warn('[useEventListener] handler is required in config object');
          return;
        }
        rateLimit = handlerOrConfig.rateLimit;
        options = handlerOrConfig.options ?? maybeOptions;
      } else {
        console.warn('[useEventListener] invalid handler or config');
        return;
      }

      const finalHandler = wrapWithRateLimit(handler, rateLimit, globalConfig);
      normalizedEvents = [{ event: eventName, handler: finalHandler, options }];
    } else {
      const eventsMap: EventsMap = eventOrMap;
      for (const [eventName, entry] of Object.entries(eventsMap)) {
        let handler: EventListener;
        let rateLimit: RateLimitConfig | undefined;
        let options: boolean | AddEventListenerOptions | undefined;

        if (typeof entry === 'function') {
          handler = entry;
        } else {
          handler = entry.handler;
          // 【修复】边界条件检查
          if (!handler) {
            console.warn(`[useEventListener] handler is required for event "${eventName}"`);
            continue;
          }
          rateLimit = entry.rateLimit;
          options = entry.options;
        }

        const finalHandler = wrapWithRateLimit(handler, rateLimit, globalConfig);
        normalizedEvents.push({ event: eventName, handler: finalHandler, options });
      }
    }

    const cleanups: Array<() => void> = [];

    const addAllListeners = () => {
      const el = unref(target);
      if (!el) return;

      // 【修复】防止重复添加，先清理再添加
      if (cleanups.length > 0) {
        removeAllListeners();
      }

      for (const { event, handler, options } of normalizedEvents) {
        el.addEventListener(event, handler, options);
        cleanups.push(() => el.removeEventListener(event, handler, options));
      }
    };

    const removeAllListeners = () => {
      // 【修复】清理所有 rate-limited 函数的定时器，防止资源泄漏
      for (const { handler } of normalizedEvents) {
        if (handler && typeof handler === 'function' && 'cancel' in handler) {
          (handler as RateLimitedFunction).cancel?.();
        }
      }

      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
    };

    onMounted(addAllListeners);
    onBeforeUnmount(removeAllListeners);

    if (typeof target === 'object' && target !== null && 'value' in target) {
      watch(
        () => unref(target),
        (newTarget, oldTarget) => {
          if (oldTarget) removeAllListeners();
          if (newTarget) addAllListeners();
        }
      );
    }
  }

  return useEventListenerImpl;
}

// ===================== 重载接口定义（用于 IDE 完美提示） =====================

/**
 * useEventListener 函数的重载及文档接口
 */
export interface UseEventListener {
  /**
   * 监听单个事件（handler + options 模式）
   * @param target 事件目标（window/document/Element 或 Vue ref）
   * @param event 事件名称
   * @param handler 事件处理函数
   * @param options 原生 addEventListener 选项
   */
  (
    target: EventTarget | Ref<EventTarget | null | undefined>,
    event: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void;

  /**
   * 监听单个事件（配置对象模式）
   * @param target 事件目标
   * @param event 事件名称
   * @param config 配置对象 { handler, rateLimit?, options? }
   */
  (
    target: EventTarget | Ref<EventTarget | null | undefined>,
    event: string,
    config: EventConfig
  ): void;

  /**
   * 监听多个事件（事件映射模式）
   * @param target 事件目标
   * @param eventsMap 事件名到处理函数或配置对象的映射
   */
  (target: EventTarget | Ref<EventTarget | null | undefined>, eventsMap: EventsMap): void;
}

// ===================== 导出预置函数 =====================

/**
 * 默认版本（无全局默认配置，完全按传入参数行为）
 */
export const useEventListener: UseEventListener = createUseEventListener() as UseEventListener;

/**
 * 使用 RAF 作为默认驱动的版本（所有未指定 driver 的防抖/节流均使用 requestAnimationFrame）
 */
export const useRafEventListener: UseEventListener = createUseEventListener({
  defaultDriver: 'raf',
}) as UseEventListener;

/**
 * 默认所有节流都使用 RAF 模式（每帧最多一次），防抖仍使用 timeout（可通过传入配置覆盖）
 */
export const useRafThrottleEventListener: UseEventListener = createUseEventListener({
  defaultUseRafThrottle: true,
  defaultThrottleDelay: 0,
}) as UseEventListener;

/**
 * 默认所有防抖都使用 RAF 模式（下一帧执行），节流仍使用 timeout（可通过传入配置覆盖）
 */
export const useRafDebounceEventListener: UseEventListener = createUseEventListener({
  defaultUseRafDebounce: true,
  defaultDebounceDelay: 0,
}) as UseEventListener;
