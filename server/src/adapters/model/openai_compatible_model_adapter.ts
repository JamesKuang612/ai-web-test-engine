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
    createSafeModelProtocolDiagnostic,
} from './model_protocol_diagnostic';

export type OpenAiCompatibleApiProtocol =
    | 'chat_completions'
    | 'responses';

export interface OpenAiCompatibleModelAdapterOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    protocol?: OpenAiCompatibleApiProtocol;
}

export type OpenAiCompatibleModelAdapterErrorCode =
    | 'API_ERROR'
    | 'INVALID_RESPONSE'
    | 'MISSING_API_KEY'
    | 'NETWORK_ERROR'
    | 'SCHEMA_VALIDATION_FAILED'
    | 'TIMEOUT';

/** OpenAI-compatible provider 调用、响应解析或结构校验失败。 */
export class OpenAiCompatibleModelAdapterError extends Error {
    /** 保存稳定错误分类及可选的上游 HTTP 状态码。 */
    constructor(
        public readonly code: OpenAiCompatibleModelAdapterErrorCode,
        message: string,
        public readonly statusCode?: number
    ) {
        super(message);
        this.name = 'OpenAiCompatibleModelAdapterError';
    }
}

interface ParsedModelContent {
    value: unknown;
}

interface ParsedApiResponse {
    value: unknown;
    model: string;
    requestId?: string;
}

/** 判断未知值是否为普通 JSON 对象。 */
function isRecord(
    value: unknown
): value is Record<string, unknown> {
    return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value);
}

/** 尝试解析 JSON，不向错误信息写入模型原文。 */
function tryParseJson(
    value: string
): { parsed: true, value: unknown } | { parsed: false } {
    try {
        return {
            parsed: true,
            value: JSON.parse(value) as unknown
        };
    } catch {
        return {
            parsed: false
        };
    }
}

/** 提取由单个 Markdown JSON 代码块包裹的内容。 */
function unwrapJsonFence(value: string): string | undefined {
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
    return match?.[1];
}

/** 从解释文字中寻找唯一且括号完整的顶层 JSON 对象。 */
function extractSingleJsonObject(value: string): string | undefined {
    const objects: string[] = [];
    let startIndex = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];

        if (startIndex < 0) {
            if (character === '{') {
                startIndex = index;
                depth = 1;
            }
            continue;
        }

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
            if (depth === 0) {
                objects.push(value.slice(startIndex, index + 1));
                startIndex = -1;
                if (objects.length > 1) {
                    return undefined;
                }
            }
        }
    }

    if (startIndex >= 0 || objects.length !== 1) {
        return undefined;
    }
    return objects[0];
}

/** 只接受能够无歧义恢复的模型 JSON。 */
function parseModelContent(
    content: string
): ParsedModelContent | undefined {
    const normalized = content.replace(/^\uFEFF/u, '').trim();
    const directResult = tryParseJson(normalized);

    if (directResult.parsed) {
        return {
            value: directResult.value
        };
    }

    const fencedContent = unwrapJsonFence(normalized);
    if (fencedContent !== undefined) {
        const fencedResult = tryParseJson(fencedContent.trim());
        if (fencedResult.parsed) {
            return {
                value: fencedResult.value
            };
        }
    }

    const embeddedObject = extractSingleJsonObject(normalized);
    if (embeddedObject !== undefined) {
        const embeddedResult = tryParseJson(embeddedObject);
        if (embeddedResult.parsed) {
            return {
                value: embeddedResult.value
            };
        }
    }

    return undefined;
}

/** 从 OpenAI-compatible provider 错误响应中提取有限长度的安全消息。 */
function getApiErrorMessage(responseBody: string): string {
    try {
        const value = JSON.parse(responseBody) as unknown;
        if (
            isRecord(value) &&
            isRecord(value.error) &&
            typeof value.error.message === 'string'
        ) {
            return value.error.message.slice(0, 500);
        }
    } catch {
        // 非 JSON 响应在下方按普通文本处理。
    }

    return responseBody.trim().slice(0, 500) ||
        '响应中没有错误信息。';
}

/** 通过 OpenAI-compatible provider 的 Responses 或 Chat Completions 协议调用模型。 */
export class OpenAiCompatibleModelAdapter implements ModelAdapter {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly model: string;
    private readonly protocol: OpenAiCompatibleApiProtocol;

    /** 校验固定连接参数，并允许测试注入假的 fetch。 */
    constructor(
        options: OpenAiCompatibleModelAdapterOptions,
        private readonly fetcher: typeof fetch = global.fetch
    ) {
        this.baseUrl = options.baseUrl.trim().replace(/\/+$/u, '');
        this.apiKey = options.apiKey.trim();
        this.model = options.model.trim();
        this.protocol = options.protocol ?? 'chat_completions';

        if (!this.baseUrl) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider baseUrl 不能为空。'
            );
        }
        if (!this.model) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider model 不能为空。'
            );
        }
    }

    /** 请求 OpenAI-compatible provider，并使用调用方 Schema 校验模型输出。 */
    public generateStructured = async <T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ): Promise<ModelResult<T>> => {
        signal.throwIfAborted();

        if (!this.apiKey) {
            throw classifiedProviderFailure(
                request,
                'provider-unavailable',
                'OpenAI-compatible provider API Key 尚未配置。'
            );
        }

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
            const parsedResponse = await this.callApi(
                request,
                schema,
                requestSignal
            );
            let value: T;
            try {
                value = schema.parse(parsedResponse.value);
            } catch (error) {
                throw new ClassifiedModelFailure(
                    'schema-invalid',
                    `OpenAI-compatible provider 返回内容不符合 ${ schema.name } Schema。`,
                    createSafeModelProtocolDiagnostic({
                        modelRole: request.modelRole ?? 'action-planner',
                        phase: request.protocolPhase ?? 'initial',
                        failureType: 'schema-invalid',
                        model: parsedResponse.model,
                        requestId: parsedResponse.requestId,
                        parsedJson: parsedResponse.value,
                        schemaIssues: providerSchemaIssues(error)
                    })
                );
            }

            return {
                value,
                model: parsedResponse.model,
                requestId: parsedResponse.requestId
            };
        } catch (error) {
            if (signal.aborted) {
                signal.throwIfAborted();
            }
            if (error instanceof ClassifiedModelFailure) {
                throw error;
            }
            if (timeoutController.signal.aborted) {
                throw classifiedProviderFailure(
                    request,
                    'model-timeout',
                    'OpenAI-compatible provider 请求超时。'
                );
            }
            if (error instanceof OpenAiCompatibleModelAdapterError) {
                throw classifiedProviderFailure(
                    request,
                    error.code === 'TIMEOUT'
                        ? 'model-timeout'
                        : error.code === 'INVALID_RESPONSE'
                            ? 'invalid-json'
                            : 'provider-unavailable',
                    error.message
                );
            }
            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
    };

    /** 按配置选择 Responses 或旧 Chat Completions 协议。 */
    private async callApi<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ): Promise<ParsedApiResponse> {
        if (this.protocol === 'responses') {
            return await this.callResponsesApi(
                request,
                schema,
                signal
            );
        }

        return await this.callChatCompletionsApi(
            request,
            schema,
            signal
        );
    }

    /** 使用 Responses API 和 JSON Schema 请求结构化结果。 */
    private async callResponsesApi<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ): Promise<ParsedApiResponse> {
        const responseBody = await this.sendRequest(
            '/responses',
            {
                model: this.model,
                instructions: request.systemPrompt,
                input: request.userPrompt,
                text: {
                    format: {
                        type: 'json_schema',
                        name: schema.name,
                        strict: true,
                        schema: schema.jsonSchema
                    }
                },
                max_output_tokens: request.maxOutputTokens,
                reasoning: {
                    effort: 'high'
                },
                store: false,
                stream: false
            },
            signal
        );

        return this.parseResponsesResponse(responseBody);
    }

    /** 兼容旧模型使用的 Chat Completions JSON 模式。 */
    private async callChatCompletionsApi<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ): Promise<ParsedApiResponse> {
        const responseBody = await this.sendRequest(
            '/chat/completions',
            {
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: this.createSystemPrompt(request, schema)
                    },
                    {
                        role: 'user',
                        content: request.userPrompt
                    }
                ],
                response_format: {
                    type: 'json_object'
                },
                max_tokens: request.maxOutputTokens,
                stream: false
            },
            signal
        );

        return this.parseChatCompletionsResponse(responseBody);
    }

    /** 统一发送带鉴权的 OpenAI-compatible JSON 请求并处理 HTTP 错误。 */
    private async sendRequest(
        path: string,
        body: Record<string, unknown>,
        signal: AbortSignal
    ): Promise<string> {
        const response = await this.fetcher(
            `${ this.baseUrl }${ path }`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${ this.apiKey }`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal
            }
        );
        const responseBody = await response.text();

        if (!response.ok) {
            throw new OpenAiCompatibleModelAdapterError(
                'API_ERROR',
                `OpenAI-compatible provider 请求失败（HTTP ${ response.status }）：${
                    getApiErrorMessage(responseBody)
                }`,
                response.status
            );
        }

        return responseBody;
    }

    /** 将 JSON Schema 追加到系统提示词中。 */
    private createSystemPrompt<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>
    ): string {
        return [
            request.systemPrompt,
            '',
            `JSON Schema 名称：${ schema.name }`,
            '只返回一个符合以下 JSON Schema 的 JSON 对象：',
            JSON.stringify(schema.jsonSchema)
        ].join('\n');
    }

    /** 解析 Chat Completions 响应中的模型输出。 */
    private parseChatCompletionsResponse(
        responseBody: string
    ): ParsedApiResponse {
        let payload: unknown;
        try {
            payload = JSON.parse(responseBody) as unknown;
        } catch {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider 返回的响应不是合法 JSON。'
            );
        }

        if (!isRecord(payload) || !Array.isArray(payload.choices)) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider 响应中缺少 choices。'
            );
        }

        const firstChoice = payload.choices[0];
        if (
            !isRecord(firstChoice) ||
            !isRecord(firstChoice.message) ||
            typeof firstChoice.message.content !== 'string'
        ) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider 响应中缺少模型输出内容。'
            );
        }

        const parsedContent = parseModelContent(
            firstChoice.message.content
        );
        if (!parsedContent) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider 模型输出不是无歧义的合法 JSON。'
            );
        }

        return {
            value: parsedContent.value,
            model: typeof payload.model === 'string'
                ? payload.model
                : this.model,
            requestId: typeof payload.id === 'string'
                ? payload.id
                : undefined
        };
    }

    /** 解析 Responses API 的嵌套 output_text 内容。 */
    private parseResponsesResponse(
        responseBody: string
    ): ParsedApiResponse {
        const payload = this.parseResponseEnvelope(responseBody);
        if (
            typeof payload.status === 'string' &&
            payload.status !== 'completed'
        ) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                `OpenAI-compatible provider Responses 状态不是 completed：${
                    payload.status
                }。`
            );
        }

        const outputText = this.findResponsesOutputText(payload);
        const parsedContent = outputText
            ? parseModelContent(outputText)
            : undefined;
        if (!parsedContent) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider Responses 中缺少合法的结构化输出。'
            );
        }

        return {
            value: parsedContent.value,
            model: typeof payload.model === 'string'
                ? payload.model
                : this.model,
            requestId: typeof payload.id === 'string'
                ? payload.id
                : undefined
        };
    }

    /** 将 Responses HTTP 正文解析为普通 JSON 对象。 */
    private parseResponseEnvelope(
        responseBody: string
    ): Record<string, unknown> {
        let payload: unknown;
        try {
            payload = JSON.parse(responseBody) as unknown;
        } catch {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider 返回的响应不是合法 JSON。'
            );
        }
        if (!isRecord(payload)) {
            throw new OpenAiCompatibleModelAdapterError(
                'INVALID_RESPONSE',
                'OpenAI-compatible provider Responses 响应不是 JSON 对象。'
            );
        }
        return payload;
    }

    /** 从 Responses 的 message/content 层级中提取所有输出文本。 */
    private findResponsesOutputText(
        payload: Record<string, unknown>
    ): string | undefined {
        if (typeof payload.output_text === 'string') {
            return payload.output_text;
        }
        if (!Array.isArray(payload.output)) {
            return undefined;
        }

        const outputTexts: string[] = [];
        payload.output.forEach((item) => {
            if (!isRecord(item) || !Array.isArray(item.content)) {
                return;
            }
            item.content.forEach((content) => {
                if (
                    isRecord(content) &&
                    content.type === 'output_text' &&
                    typeof content.text === 'string'
                ) {
                    outputTexts.push(content.text);
                }
            });
        });

        return outputTexts.length > 0
            ? outputTexts.join('')
            : undefined;
    }
}

function providerSchemaIssues(error: unknown): ModelProtocolSchemaIssue[] {
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

function classifiedProviderFailure(
    request: ModelRequest,
    failureType: 'invalid-json' | 'model-timeout' | 'provider-unavailable',
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
