import {Lifecycle, ServiceDescriptor, ServiceOptions, Token} from "./types";

/**
 * 轻量级依赖注入容器 (Lightweight DI Container)
 *
 * @description
 * 适用于中大型 TypeScript 项目，无需重型框架（如 NestJS/Angular）。
 * 支持单例/瞬态生命周期、显式依赖注入、工厂模式以及循环依赖检测。
 *
 * @features
 * - **Zero Dependencies**: 纯 TypeScript 实现，无第三方库依赖。
 * - **Type Safe**: 充分利用 TypeScript 泛型，提供完整的类型推断。
 * - **Lifecycle Management**: 支持 Singleton (单例) 和 Transient (瞬态) 生命周期。
 * - **Circular Dependency Detection**: 运行时检测并防止无限递归的循环依赖。
 * - **Lazy Injection**: 提供 `lazyGet` 机制，通过 Getter 函数解决复杂的循环依赖场景。
 *
 * @example
 * ```typescript
 * import { container, Lifecycle, DIContainer } from './di-container';
 *
 * // 1. 定义服务
 * class Logger {
 *   log(msg: string) { console.log(`[LOG] ${msg}`); }
 * }
 *
 * class Database {
 *   constructor(private logger: Logger) {}
 *   query(sql: string) {
 *     this.logger.log(`Executing: ${sql}`);
 *     return [];
 *   }
 * }
 *
 * class UserService {
 *   constructor(private db: Database) {}
 *   getUsers() {
 *     return this.db.query('SELECT * FROM users');
 *   }
 * }
 *
 * // 2. 注册服务 (通常在应用入口一次性完成)
 * container.register(Logger, Logger);
 * container.register(Database, Database, { deps: [Logger] });
 * container.register(UserService, UserService, { deps: [Database] });
 *
 * // 3. 获取并使用服务
 * const userService = container.get(UserService);
 * userService.getUsers();
 * ```
 */

export class DIContainer {
    private services = new Map<Token, ServiceDescriptor>();
    private isResolving = new Set<Token>(); // 用于检测循环依赖的解析栈

    /**
     * 内部日志方法
     * 默认使用 console，但允许被覆盖
     */
    private static logWarn = (message: string) => console.warn(message);

    /**
     * 允许用户自定义警告日志的处理方式
     * 例如：在生产环境中将其指向空函数以静音，或指向特定的日志系统
     *
     * @example
     * DIContainer.setLogger((msg) => myCustomLogger.warn(msg));
     */
    public static setLogger(loggerFn: (message: string) => void): void {
        DIContainer.logWarn = loggerFn;
    }

    /**
     * 注册服务到容器
     *
     * @param token - 服务令牌，用于后续通过 `get()` 获取服务
     * @param provider - 服务提供者。可以是：
     *   1. **类构造函数**: 容器将自动处理实例化和依赖注入。
     *   2. **工厂函数**: 一个返回服务实例的无参函数 `() => T`。适用于复杂初始化逻辑或接口解耦。
     * @param options - 配置选项，包括生命周期 (`lifecycle`) 和显式依赖 (`deps`)
     *
     * @throws Error 如果 provider 既不是类构造函数也不是函数
     *
     * @example
     * ```typescript
     * // 注册简单类 (默认单例)
     * container.register(Logger, Logger);
     *
     * // 注册带依赖的类
     * container.register(UserService, UserService, { deps: [Logger, Database] });
     *
     * // 注册瞬态服务
     * container.register(RequestContext, RequestContext, { lifecycle: Lifecycle.Transient });
     *
     * // 注册工厂函数 (例如用于第三方库或接口实现)
     * container.register('IConfig', () => {
     *   return { apiKey: process.env.API_KEY };
     * }, { lifecycle: Lifecycle.Singleton });
     * ```
     */
    register<T>(
        token: Token<T>,
        provider: new (...args: any[]) => T | (() => T),
        options: ServiceOptions = {}
    ): void {
        if (this.services.has(token)) {
            DIContainer.logWarn(`[DI] Service '${this.getTokenName(token)}' is already registered. Overwriting.`);
        }

        const lifecycle = options.lifecycle ?? Lifecycle.Singleton;

        // 判断是类构造函数还是工厂函数
        // 类通常有 prototype 属性，且 prototype.constructor 指向自身
        // 箭头函数没有 prototype
        const isClassConstructor = typeof provider === 'function' &&
            (provider as any).prototype &&
            (provider as any).prototype.constructor === provider;

        let factory: () => any;

        if (isClassConstructor) {
            // 如果是类，包装一个工厂函数来处理依赖注入逻辑
            const ClassConstructor = provider as new (...args: any[]) => T;
            factory = () => this.instantiateClass(ClassConstructor, options.deps);
        } else {
            // 如果是工厂函数，确保它是可调用的
            if (typeof provider !== 'function') {
                throw new Error(`[DI] Provider for token '${this.getTokenName(token)}' must be a class constructor or a factory function.`);
            }
            // 直接使用工厂函数
            // 使用 unknown 中转以消除 TypeScript 联合类型转换的警告
            factory = provider as unknown as () => T;
        }

        this.services.set(token, {
            token,
            factory,
            lifecycle,
        });
    }

    /**
     * 获取服务实例
     *
     * @param token - 服务令牌
     * @returns 解析后的服务实例
     *
     * @throws Error
     * - 如果服务未注册
     * - 如果检测到循环依赖
     *
     * @remarks
     * - 对于 **Singleton** 服务，首次调用会创建实例并缓存，后续调用直接返回缓存。
     * - 对于 **Transient** 服务，每次调用都会执行工厂函数创建新实例。
     *
     * @example
     * ```typescript
     * const logger = container.get(Logger);
     * const config = container.get<IConfig>('IConfig'); // 使用字符串 Token 时需显式指定泛型
     * ```
     */
    get<T>(token: Token<T>): T {
        const descriptor = this.services.get(token);

        if (!descriptor) {
            throw new Error(`[DI] No service registered for token '${this.getTokenName(token)}'`);
        }

        // 1. 处理单例缓存命中
        if (descriptor.lifecycle === Lifecycle.Singleton && descriptor.instance !== undefined) {
            return descriptor.instance;
        }

        // 2. 循环依赖检测
        // 如果当前 Token 已经在解析栈中，说明出现了 A -> B -> A 的闭环
        if (this.isResolving.has(token)) {
            const chain = Array.from(this.isResolving).map(t => this.getTokenName(t)).join(' -> ');
            throw new Error(
                `[DI] Circular dependency detected: ${chain} -> ${this.getTokenName(token)}.\n` +
                `Solution: Refactor code to break the cycle, or use container.lazyGet() for lazy injection.`
            );
        }

        try {
            // 加入解析栈
            this.isResolving.add(token);

            // 3. 执行工厂函数创建实例
            const instance = descriptor.factory();

            // 4. 缓存单例实例
            if (descriptor.lifecycle === Lifecycle.Singleton) {
                descriptor.instance = instance;
            }

            return instance;
        } finally {
            // 无论成功与否，都要从解析栈中移除，保证状态清洁
            this.isResolving.delete(token);
        }
    }

    /**
     * 获取一个懒加载的 Getter 函数
     *
     * @description
     * 返回一个无参函数 `() => T`，调用该函数时才会真正去容器中解析依赖。
     *
     * @param token - 服务令牌
     * @returns 一个返回服务实例的函数
     *
     * @remarks
     * **主要用途**: 解决循环依赖问题。
     * 当 ServiceA 依赖 ServiceB，而 ServiceB 又依赖 ServiceA 时，直接在构造函数中注入会导致死锁。
     * 此时可以让 ServiceA 依赖 `() => ServiceB`，在真正需要使用时再调用 getter。
     *
     * @example
     * ```typescript
     * class ServiceA {
     *   private getServiceB: () => ServiceB;
     *
     *   // 注入的是 Getter 函数，而不是 ServiceB 实例
     *   constructor(getServiceB: () => ServiceB) {
     *     this.getServiceB = getServiceB;
     *   }
     *
     *   doWork() {
     *     // 只有在这里才真正获取 ServiceB 实例，此时 ServiceB 可能已经初始化完毕
     *     this.getServiceB().help();
     *   }
     * }
     *
     * // 注册时需要配合工厂函数手动注入 lazyGet
     * container.register(ServiceB, ServiceB, { deps: [ServiceA] });
     * container.register(ServiceA, () => new ServiceA(container.lazyGet(ServiceB)));
     * ```
     */
    lazyGet<T>(token: Token<T>): () => T {
        return () => this.get(token);
    }

    /**
     * 检查服务是否已注册
     *
     * @param token - 服务令牌
     * @returns boolean
     */
    has<T>(token: Token<T>): boolean {
        return this.services.has(token);
    }

    /**
     * 重置容器中的所有单例实例
     *
     * @description
     * 不会移除服务的注册信息（Factory 和 Token 映射保留），仅清除缓存的 Singleton 实例。
     * 下次 `get()` 时会重新创建实例。
     *
     * @remarks
     * 主要用于单元测试，确保每个测试用例从干净的状态开始，避免测试间的数据污染。
     */
    reset(): void {
        this.services.forEach((desc) => {
            desc.instance = undefined;
        });
        this.isResolving.clear();
    }

    /**
     * 清空容器
     *
     * @description
     * 移除所有注册的服务、工厂函数以及缓存实例。
     * 容器恢复到初始空状态。
     *
     * @warning 慎用：通常仅在应用关闭、热重载或极端测试场景下使用。
     */
    clear(): void {
        this.services.clear();
        this.isResolving.clear();
    }

    // --- 私有辅助方法 ---

    /**
     * 实例化类并注入依赖
     * @internal
     */
    private instantiateClass<T>(ClassConstructor: new (...args: any[]) => T, explicitDeps?: Token[]): T {
        // 如果显式指定了依赖，按顺序解析并注入
        if (explicitDeps) {
            const dependencies = explicitDeps.map((dep) => this.get(dep));
            return new ClassConstructor(...dependencies);
        }

        // 否则，检查构造函数是否有参数
        // 注意：原生 TS 不支持运行时反射参数类型。
        // 如果构造函数有参数但未提供 deps，我们无法知道需要注入什么，因此报错。
        const paramLength = ClassConstructor.length;
        if (paramLength > 0) {
            throw new Error(
                `[DI] Cannot auto-resolve dependencies for '${this.getTokenName(ClassConstructor)}'. ` +
                `Native TypeScript does not support runtime reflection for constructor parameters. ` +
                `Please provide 'deps' in registration options, e.g.: { deps: [Dep1, Dep2] }`
            );
        }

        // 无参构造函数，直接实例化
        return new ClassConstructor();
    }

    /**
     * 获取 Token 的可读名称，用于错误日志和警告信息
     * @internal
     */
    private getTokenName(token: Token): string {
        if (typeof token === 'string' || typeof token === 'symbol') {
            return token.toString();
        }
        // 对于类构造函数，返回类名
        return token.name || 'AnonymousClass';
    }
}

// 导出全局单例容器实例
// 对于大多数中小型应用，建议直接导入并使用此实例。
// 对于大型应用或需要隔离上下文的场景，建议在应用入口 `new DIContainer()` 并手动传递。
export const container = new DIContainer();