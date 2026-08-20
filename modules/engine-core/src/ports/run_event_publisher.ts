import type {
    RunEvent,
} from '../contracts';

/** 发布运行事件；V0 的服务器实现可以使用 SSE。 */
export interface RunEventPublisher {
    /** 将一条标准运行事件发送给当前实现对应的订阅方。 */
    publish: (event: RunEvent) => Promise<void>;
}
