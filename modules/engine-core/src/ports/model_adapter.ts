import type {
    JsonValue,
} from '../contracts';

/** 同时提供 JSON Schema 和运行时解析器，约束模型输出。 */
export interface RuntimeSchema<T> {
    name: string;
    jsonSchema: Record<string, JsonValue>;
    /** 校验模型原始输出，并将其转换为可信的领域对象。 */
    parse: (value: unknown) => T;
}

/** 一次模型调用所需的提示词、超时和输出预算。 */
export interface ModelRequest {
    systemPrompt: string;
    userPrompt: string;
    timeoutMs: number;
    maxOutputTokens: number;
}

/** 已通过结构化校验的模型结果及其调用标识。 */
export interface ModelResult<T> {
    model: string;
    requestId?: string;
    value: T;
}

/** 领域层唯一允许使用的结构化模型调用边界。 */
export interface ModelAdapter {
    /** 请求模型生成符合指定运行时 Schema 的结构化结果。 */
    generateStructured: <T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ) => Promise<ModelResult<T>>;
}
