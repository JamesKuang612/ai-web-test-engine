import type {
    ModelAdapter,
    ModelRequest,
    ModelResult,
    RuntimeSchema,
} from '@ai-web-test-engine/core';
import {
    CodexAppServerError,
    StdioCodexAppServerClient,
} from './codex_app_server_client';
import type {
    CodexAppServerClient,
    CodexReasoningEffort,
} from './codex_app_server_client';

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
            let rawValue: unknown;
            try {
                rawValue = JSON.parse(output.text) as unknown;
            } catch {
                throw new CodexAppServerError(
                    'INVALID_RESPONSE',
                    'Codex App Server 最终输出不是合法 JSON。'
                );
            }

            let value: T;
            try {
                value = schema.parse(rawValue);
            } catch {
                throw new CodexAppServerError(
                    'SCHEMA_VALIDATION_FAILED',
                    `Codex App Server 返回内容不符合 ${ schema.name } Schema。`
                );
            }

            return {
                model: output.model,
                requestId: output.turnId,
                value
            };
        } catch (error) {
            if (signal.aborted) {
                signal.throwIfAborted();
            }
            if (error instanceof CodexAppServerError) {
                throw error;
            }
            if (timeoutController.signal.aborted) {
                throw new CodexAppServerError(
                    'TIMEOUT',
                    'Codex App Server 模型调用超时。'
                );
            }
            throw new CodexAppServerError(
                'PROTOCOL_ERROR',
                `Codex App Server 调用异常：${
                    error instanceof Error
                        ? error.message
                        : '未知错误'
                }`
            );
        } finally {
            clearTimeout(timeoutHandle);
        }
    };
}
