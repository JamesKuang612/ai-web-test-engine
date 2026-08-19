import type {
    EvidenceRef,
    JsonValue,
    RunResult,
    RunSnapshot,
    TraceEvent,
} from '../contracts';

export interface ArtifactInput {
    content: string | Uint8Array;
    kind: EvidenceRef['kind'];
    mediaType: string;
    name: string;
}

/** 持久化 Run、追加式 Trace 和证据，不参与业务结果判定。 */
export interface ArtifactStore {
    createRun: (snapshot: RunSnapshot) => Promise<void>;
    updateRun: (snapshot: RunSnapshot) => Promise<void>;
    appendTrace: (runId: string, event: TraceEvent) => Promise<void>;
    saveArtifact: (runId: string, artifact: ArtifactInput) => Promise<EvidenceRef>;
    saveJson: (
        runId: string,
        name: string,
        value: JsonValue
    ) => Promise<EvidenceRef>;
    saveResult: (result: RunResult) => Promise<void>;
}
