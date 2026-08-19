/** 当前核心领域数据契约的版本。 */
export type EngineSchemaVersion = 1;

/** 可以安全写入 JSON、JSONL 和运行事件的数据。 */
export type JsonValue =
    | boolean
    | JsonValue[]
    | null
    | number
    | string
    | { [key: string]: JsonValue };

/** 一个本地运行证据的稳定引用，不暴露绝对文件路径。 */
export interface EvidenceRef {
    kind: 'dom' | 'model' | 'network' | 'screenshot' | 'trace';
    ref: string;
    summary?: string;
}
