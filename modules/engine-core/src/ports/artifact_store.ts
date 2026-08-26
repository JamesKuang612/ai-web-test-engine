import type {
    EvidenceRef,
    JsonValue,
    RunResult,
    RunSnapshot,
    TraceEvent,
} from '../contracts';

/** 待保存证据的内容、类型和建议文件名。 */
export interface ArtifactInput {
    content: string | Uint8Array;
    kind: EvidenceRef['kind'];
    mediaType: string;
    name: string;
}

/** 持久化 Run、追加式 Trace 和证据，不参与业务结果判定。 */
export interface ArtifactStore {
    /** 为一次新运行创建独立的存储空间并写入初始快照。 */
    createRun: (snapshot: RunSnapshot) => Promise<void>;
    /** 覆盖保存运行的最新状态快照。 */
    updateRun: (snapshot: RunSnapshot) => Promise<void>;
    /** 以追加方式记录一条不可变的动作轨迹。 */
    appendTrace: (runId: string, event: TraceEvent) => Promise<void>;
    /** 保存截图、DOM 等二进制或文本证据并返回稳定引用。 */
    saveArtifact: (runId: string, artifact: ArtifactInput) => Promise<EvidenceRef>;
    /** 保存结构化的中间数据并返回稳定引用。 */
    saveJson: (
        runId: string,
        name: string,
        value: JsonValue
    ) => Promise<EvidenceRef>;
    /** 通过存储层生成的相对引用读取不可信 JSON，调用方仍需做领域校验。 */
    loadJson: (reference: string) => Promise<unknown>;
    /** 保存一次运行的最终判定结果。 */
    saveResult: (result: RunResult) => Promise<void>;
}
