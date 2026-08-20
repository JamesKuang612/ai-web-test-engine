export {};

declare global {
    namespace Express {
        /** NStarter 请求 ID 中间件写入的追踪字段。 */
        interface Request {
            requestId: string;
        }
    }
}
