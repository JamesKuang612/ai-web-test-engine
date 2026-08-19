import type {
    JsonValue,
} from '../contracts';

export interface RuntimeSchema<T> {
    name: string;
    jsonSchema: Record<string, JsonValue>;
    parse: (value: unknown) => T;
}

export interface ModelRequest {
    systemPrompt: string;
    userPrompt: string;
    timeoutMs: number;
    maxOutputTokens: number;
}

export interface ModelResult<T> {
    model: string;
    requestId?: string;
    value: T;
}

/** 领域层唯一允许使用的结构化模型调用边界。 */
export interface ModelAdapter {
    generateStructured: <T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>
    ) => Promise<ModelResult<T>>;
}
