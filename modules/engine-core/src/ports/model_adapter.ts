import type {
    JsonValue,
} from '../contracts';

export type ModelRole =
    | 'action-planner'
    | 'intent-builder'
    | 'recovery-planner'
    | 'step-progress'
    | 'verdict-evaluator';

export type ModelProtocolFailureType =
    | 'invalid-json'
    | 'model-timeout'
    | 'provider-unavailable'
    | 'schema-invalid';

export interface ModelProtocolSchemaIssue {
    path: string;
    code: string;
    message: string;
}

/** 已在 provider 边界脱敏、截断，可安全持久化的模型协议诊断。 */
export interface ModelProtocolDiagnostic {
    schemaVersion: 1;
    modelRole: ModelRole;
    phase: 'initial' | 'repair';
    failureType: ModelProtocolFailureType;
    model?: string;
    requestId?: string;
    rawOutputPreview?: string;
    rawSha256?: string;
    parsedJson?: JsonValue;
    schemaIssues: ModelProtocolSchemaIssue[];
    sanitized: true;
    truncated: boolean;
}

/** 只表示已分类的模型/provider 失败；内部程序错误不得包装成该类型。 */
export class ClassifiedModelFailure extends Error {
    constructor(
        public readonly failureType: ModelProtocolFailureType,
        message: string,
        public readonly diagnostic: ModelProtocolDiagnostic
    ) {
        super(message);
        this.name = 'ClassifiedModelFailure';
    }
}

/** RuntimeSchema 用明确路径报告本地可信边界的校验失败。 */
export class RuntimeSchemaValidationError extends Error {
    constructor(public readonly issues: ModelProtocolSchemaIssue[]) {
        super(issues.map(({ path, message }) =>
            `${ path }: ${ message }`).join('; '));
        this.name = 'RuntimeSchemaValidationError';
    }
}

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
    modelRole?: ModelRole;
    protocolPhase?: 'initial' | 'repair';
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
