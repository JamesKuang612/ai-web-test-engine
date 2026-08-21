import type {
    RunEvent,
    RunEventPublisher,
} from '@ai-web-test-engine/core';
import { Logger } from 'nstarter-core';

/** 在 SSE 接入前，将标准运行事件写入本机日志供调试和追踪。 */
export class LoggingRunEventPublisher implements RunEventPublisher {
    /** 输出事件序号、类型和 Run ID，不打印可能较大的完整载荷。 */
    public publish = (event: RunEvent): Promise<void> => {
        Logger.info(
            `[RunEvent] runId=${ event.runId } ` +
            `sequence=${ event.sequence } type=${ event.type }`
        );
        return Promise.resolve();
    };
}
