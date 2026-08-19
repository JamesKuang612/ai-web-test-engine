import type {
    RunResult,
    StartRunInput,
} from '../contracts';

/** 本地应用服务、CLI 和未来 MCP 共同调用的核心入口。 */
export interface ExecutionEngine {
    start: (
        input: StartRunInput,
        signal: AbortSignal
    ) => Promise<RunResult>;
}
