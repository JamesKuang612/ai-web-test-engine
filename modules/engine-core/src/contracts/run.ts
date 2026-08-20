import type {
    EngineSchemaVersion,
    EvidenceRef,
    JsonValue,
} from './common';

/** 一次测试运行从排队到结束所处的细粒度阶段。 */
export type RunLifecycleState =
    | 'ACTING'
    | 'BUILDING_INTENT'
    | 'CANCELLED'
    | 'COMPILING_PLAN'
    | 'COMPLETED'
    | 'CRASHED'
    | 'DECIDING_VERDICT'
    | 'OBSERVING'
    | 'PLANNING'
    | 'QUEUED'
    | 'RECORDING'
    | 'REPLAY_VALIDATING'
    | 'RESOLVING'
    | 'STARTING'
    | 'VERIFYING';

/** 测试业务结论；它与运行是否正常结束是两个独立维度。 */
export type TestResult = 'FAIL' | 'PASS' | 'UNCERTAIN';

/** 对失败原因进行稳定分类，供重试、统计和界面展示使用。 */
export type FailureCategory =
    | 'ACTION_FAILED'
    | 'ACTION_REJECTED'
    | 'BROWSER_CRASHED'
    | 'BUDGET_EXHAUSTED'
    | 'EFFECT_CONTRADICTED'
    | 'EFFECT_NOT_OBSERVED'
    | 'INTENT_INCORRECT'
    | 'LOCAL_STORAGE_ERROR'
    | 'LOOP_DETECTED'
    | 'MODEL_UNAVAILABLE'
    | 'OBSERVATION_MISSING'
    | 'OBSERVATION_TOO_NOISY'
    | 'PAGE_TIMEOUT'
    | 'PLANNER_INVALID_OUTPUT'
    | 'PLANNER_WRONG_ACTION'
    | 'REPLAY_FAILED'
    | 'TARGET_AMBIGUOUS'
    | 'TARGET_NOT_FOUND'
    | 'TARGET_WRONG'
    | 'TRACE_COMPILE_ERROR'
    | 'VERDICT_INSUFFICIENT';

/** 保存一次失败的分类、发生阶段以及相关证据。 */
export interface FailureRecord {
    category: FailureCategory;
    phase: RunLifecycleState;
    summary: string;
    recoverable: boolean;
    lastObservationRef?: string;
    relatedTraceSequence?: number;
    evidence: EvidenceRef[];
}

/** 汇总一次运行的耗时、动作和模型调用等基本指标。 */
export interface RunMetrics {
    actionCount: number;
    durationMs: number;
    modelCallCount: number;
    repeatedStateActionCount: number;
}

/** 用于 API 查询和页面刷新恢复的当前 Run 快照。 */
export interface RunSnapshot {
    schemaVersion: EngineSchemaVersion;
    runId: string;
    testId: string;
    lifecycle: RunLifecycleState;
    createdAt: string;
    updatedAt: string;
    result?: TestResult;
    summary: string;
    failure?: FailureRecord;
    metadata: Record<string, JsonValue>;
}

/** 一次运行的最终输出，生命周期和测试结果相互独立。 */
export interface RunResult {
    schemaVersion: EngineSchemaVersion;
    runId: string;
    lifecycle: 'CANCELLED' | 'COMPLETED' | 'CRASHED';
    result?: TestResult;
    summary: string;
    evidence: EvidenceRef[];
    failure?: FailureRecord;
    traceRef: string;
    compiledPlanRef?: string;
    metrics: RunMetrics;
}
