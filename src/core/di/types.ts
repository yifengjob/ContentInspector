/**
 * 依赖令牌 (Token)
 * 用于在容器中唯一标识一个服务。
 *
 * @typeParam T - 服务实例的类型
 *
 * @remarks
 * - **Class Constructor**: 推荐用于类服务。具备天然的唯一性，且能保留类型信息，便于 IDE 自动补全。
 * - **string**: 适用于接口解耦、第三方库对象或无法使用类构造函数的场景。
 * - **symbol**: 适用于需要绝对唯一性且避免命名冲突的场景。
 */
export type Token<T = any> = string | symbol | (new (...args: any[]) => T);

/**
 * 服务生命周期枚举
 */
export enum Lifecycle {
    /**
     * 单例模式 (默认)
     * 整个容器生命周期内只创建一次实例，后续所有 `get()` 调用均返回同一实例。
     * 适用于无状态服务、数据库连接池、配置管理器、日志服务等。
     */
    Singleton = 'SINGLETON',

    /**
     * 瞬态模式
     * 每次调用 `get()` 都会创建并返回一个新的实例。
     * 适用于有状态、非线程安全、需要隔离上下文或轻量级的临时对象。
     */
    Transient = 'TRANSIENT',
}

/**
 * 服务注册配置选项
 */
export interface ServiceOptions {
    /**
     * 服务生命周期
     * @default Lifecycle.Singleton
     */
    lifecycle?: Lifecycle;

    /**
     * 显式依赖项列表
     *
     * @remarks
     * 由于原生 TypeScript 不支持运行时反射参数类型（除非使用 `reflect-metadata`），
     * 当注册一个带有构造函数参数的类时，必须在此显式指定依赖项。
     *
     * ⚠️ **重要**: 数组中的 Token 顺序必须与类构造函数参数的声明顺序严格一致。
     *
     * @example
     * ```typescript
     * class ServiceA { constructor(private b: ServiceB, private c: ServiceC) {} }
     * container.register(ServiceA, ServiceA, { deps: [ServiceB, ServiceC] });
     * ```
     */
    deps?: Token[];
}

/**
 * 内部服务描述符
 * 用于在容器内部存储服务的元数据、工厂函数及缓存实例
 * @internal
 */
export interface ServiceDescriptor {
    token: Token;
    factory: () => any;
    lifecycle: Lifecycle;
    instance?: any; // 仅当 lifecycle 为 Singleton 时使用，用于缓存实例
}
