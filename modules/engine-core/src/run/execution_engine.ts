import type {
    RunResult,
    StartRunInput,
} from '../contracts';

/** 本地应用服务、CLI 和未来 MCP 共同调用的核心入口。 */
export interface ExecutionEngine {
    /** 根据用例、环境和预算启动一次测试，并返回最终运行结果。 */
    start: (
        input: StartRunInput,
        signal: AbortSignal
    ) => Promise<RunResult>;
}
