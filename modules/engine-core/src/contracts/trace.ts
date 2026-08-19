import type {
    ActionCommand,
} from './action';
import type {
    EngineSchemaVersion,
    EvidenceRef,
    JsonValue,
} from './common';

export interface ResolvedTarget {
    description: string;
    strategy: 'css' | 'label' | 'placeholder' | 'role-name' | 'test-id' | 'text' | 'vision';
    locatorData: Record<string, JsonValue>;
    confidence: number;
    unique: boolean;
    actionable: boolean;
    evidence: string[];
}

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
    command: ActionCommand;
    resolvedTarget?: ResolvedTarget;
    beforeObservationRef: string;
    afterObservationRef?: string;
    actionResult?: ActionResult;
    effect?: EffectVerification;
    retryOf?: number;
    artifacts: EvidenceRef[];
}
