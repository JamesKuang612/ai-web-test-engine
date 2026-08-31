import type {
    ActionCommand,
} from './action';
import type {
    EngineSchemaVersion,
    EvidenceRef,
    JsonValue,
} from './common';
import type {
    ObservedElement,
} from './observation';
import type {
    SemanticAction,
} from './semantic_action';

/** Grounder 绑定目标时保存的完整元素证据，不包含瞬时候选编号。 */
export type ResolvedElementSnapshot = Omit<ObservedElement, 'candidateId'>;

/** Phase 1 基于当前 Observation candidate 索引解析出的物理目标。 */
export interface CandidateResolvedTarget {
    description: string;
    observationId: string;
    candidateId: string;
    elementSnapshot: ResolvedElementSnapshot;
    strategy: 'candidate-id';
    locatorData: Record<string, JsonValue>;
    confidence: number;
    confidenceBasis?: 'deterministic' | 'engine-heuristic' | 'provider';
    unique: boolean;
    actionable: boolean;
    evidence: string[];
}

/** 为 Phase 2 的 discriminated union 保留统一物理目标名称。 */
export type ResolvedTarget = CandidateResolvedTarget;

/** 浏览器执行一个动作后返回的状态、时间和页面信号。 */
export interface ActionResult {
    status: 'executed' | 'failed' | 'rejected' | 'timed-out';
    startedAt: string;
    finishedAt: string;
    error?: {
        code: string,
        message: string
    };
    browserSignals: {
        dialogOpened: boolean,
        downloadStarted: boolean,
        newTabOpened: boolean,
        urlChanged: boolean
    };
}

/** 比较动作前后页面，记录预期效果是否真实发生。 */
export interface EffectVerification {
    status: 'confirmed' | 'contradicted' | 'not-observed' | 'uncertain';
    expectedEffect: string;
    evidence: EvidenceRef[];
    summary: string;
}

/** 追加写入 trace.jsonl 的单个真实动作记录。 */
export interface TraceEvent {
    schemaVersion: EngineSchemaVersion;
    runId: string;
    sequence: number;
    semanticAction?: SemanticAction;
    command: ActionCommand;
    resolvedTarget?: ResolvedTarget;
    beforeObservationRef: string;
    afterObservationRef?: string;
    actionResult?: ActionResult;
    effect?: EffectVerification;
    retryOf?: number;
    artifacts: EvidenceRef[];
}
