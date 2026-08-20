/** NStarter 装饰器和依赖注入工具使用的通用构造器类型。 */
interface Constructor<T = any> {
    new(...args: any[]): T;
}

/** NStarter 异步工具兼容的 Node.js 风格回调类型。 */
interface Callback<T = any, E = Error> {
    (err?: E | null, result?: T): void;
}
