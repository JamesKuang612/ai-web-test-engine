import type {
    ModelAdapter,
    ModelProtocolSchemaIssue,
    ModelRequest,
    ModelResult,
    RuntimeSchema,
} from '@ai-web-test-engine/core';
import {
    ClassifiedModelFailure,
    RuntimeSchemaValidationError,
} from '@ai-web-test-engine/core';
import {
    CodexAppServerError,
    StdioCodexAppServerClient,
} from './codex_app_server_client';
import type {
    CodexAppServerClient,
    CodexReasoningEffort,
    CodexStructuredTurnOutput,
} from './codex_app_server_client';
import {
    createSafeModelProtocolDiagnostic,
} from './model_protocol_diagnostic';

export interface CodexAppServerModelAdapterOptions {
    model: string;
    reasoningEffort?: CodexReasoningEffort;
    serviceTier?: string;
    command?: string;
}

/** 使用当前用户的 Codex 登录完成结构化模型调用。 */
export class CodexAppServerModelAdapter implements ModelAdapter {
    private readonly model: string;
    private readonly reasoningEffort: CodexReasoningEffort;
    private readonly serviceTier?: string;
    private readonly client: CodexAppServerClient;

    /** 校验模型配置，并允许单元测试注入假的 App Server 客户端。 */
    constructor(
        options: CodexAppServerModelAdapterOptions,
        client?: CodexAppServerClient
    ) {
        this.model = options.model.trim();
        this.reasoningEffort = options.reasoningEffort ?? 'high';
        this.serviceTier = options.serviceTier?.trim() || undefined;
        this.client = client ?? new StdioCodexAppServerClient({
            command: options.command
        });

        if (!this.model) {
            throw new CodexAppServerError(
                'MODEL_NOT_AVAILABLE',
                'Codex App Server model 不能为空。'
            );
        }
    }

    /** 调用本机 App Server，并用领域层 RuntimeSchema 二次校验结果。 */
    public generateStructured = async <T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ): Promise<ModelResult<T>> => {
        signal.throwIfAborted();
        const timeoutController = new AbortController();
        const timeoutHandle = setTimeout(
            () => timeoutController.abort(),
            request.timeoutMs
        );
        const requestSignal = AbortSignal.any([
            signal,
            timeoutController.signal
        ]);

        try {
            const output = await this.client.runStructuredTurn({
                model: this.model,
                reasoningEffort: this.reasoningEffort,
                serviceTier: this.serviceTier,
                systemPrompt: request.systemPrompt,
                userPrompt: request.userPrompt,
                maxOutputTokens: request.maxOutputTokens,
                outputSchema: schema.jsonSchema
            }, requestSignal);
            return parseCodexOutput(output, request, schema);
        } catch (error) {
            if (signal.aborted) {
                signal.throwIfAborted();
            }
            if (error instanceof ClassifiedModelFailure) {
                throw error;
            }
            if (timeoutController.signal.aborted) {
                throw classifiedUnavailable(
                    request,
                    'model-timeout',
                    'Codex App Server 模型调用超时。'
                );
            }
            if (error instanceof CodexAppServerError) {
                if (error.code === 'TIMEOUT') {
                    throw classifiedUnavailable(
                        request,
                        'model-timeout',
                        error.message
                    );
                }
                throw classifiedUnavailable(
                    request,
                    'provider-unavailable',
                    error.message
                );
            }
            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
    };
}

function parseCodexOutput<T>(
    output: CodexStructuredTurnOutput,
    request: ModelRequest,
    schema: RuntimeSchema<T>
): ModelResult<T> {
    let rawValue: unknown;
    try {
        rawValue = JSON.parse(output.text) as unknown;
    } catch {
        throw new ClassifiedModelFailure(
            'invalid-json',
            'Codex App Server 最终输出不是合法 JSON。',
            createSafeModelProtocolDiagnostic({
                modelRole: request.modelRole ?? 'action-planner',
                phase: request.protocolPhase ?? 'initial',
                failureType: 'invalid-json',
                model: output.model,
                requestId: output.turnId,
                rawOutput: output.text,
                schemaIssues: [{
                    path: '$',
                    code: 'invalid-json',
                    message: '模型最终输出无法解析为 JSON。'
                }]
            })
        );
    }
    let value: T;
    try {
        value = schema.parse(rawValue);
    } catch (error) {
        throw new ClassifiedModelFailure(
            'schema-invalid',
            `Codex App Server 返回内容不符合 ${ schema.name } Schema。`,
            createSafeModelProtocolDiagnostic({
                modelRole: request.modelRole ?? 'action-planner',
                phase: request.protocolPhase ?? 'initial',
                failureType: 'schema-invalid',
                model: output.model,
                requestId: output.turnId,
                rawOutput: output.text,
                parsedJson: rawValue,
                schemaIssues: schemaIssues(error)
            })
        );
    }
    return {
        model: output.model,
        requestId: output.turnId,
        value
    };
}

function schemaIssues(error: unknown): ModelProtocolSchemaIssue[] {
    if (error instanceof RuntimeSchemaValidationError) {
        return error.issues;
    }
    return [{
        path: '$',
        code: 'schema-parse-failed',
        message: error instanceof Error
            ? error.message
            : 'RuntimeSchema parser 未提供失败详情。'
    }];
}

function classifiedUnavailable(
    request: ModelRequest,
    failureType: 'model-timeout' | 'provider-unavailable',
    message: string
): ClassifiedModelFailure {
    return new ClassifiedModelFailure(
        failureType,
        message,
        createSafeModelProtocolDiagnostic({
            modelRole: request.modelRole ?? 'action-planner',
            phase: request.protocolPhase ?? 'initial',
            failureType,
            schemaIssues: [{
                path: '$provider',
                code: failureType,
                message
            }]
        })
    );
}
