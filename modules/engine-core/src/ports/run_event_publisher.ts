import type {
    RunEvent,
} from '../contracts';

/** 发布运行事件；V0 的服务器实现可以使用 SSE。 */
export interface RunEventPublisher {
    publish: (event: RunEvent) => Promise<void>;
}
