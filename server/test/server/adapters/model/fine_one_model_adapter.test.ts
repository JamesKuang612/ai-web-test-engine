import assert from 'node:assert/strict';
import type {
    ModelRequest,
    RuntimeSchema,
} from '@ai-web-test-engine/core';
import {
    FineOneApiProtocol,
    FineOneModelAdapter,
    FineOneModelAdapterError,
} from '../../../../src/adapters/model';

interface StatusResult {
    status: string;
}

const request: ModelRequest = {
    systemPrompt: '只返回 JSON。',
    userPrompt: '{"task":"test"}',
    timeoutMs: 1_000,
    maxOutputTokens: 100
};

const statusSchema: RuntimeSchema<StatusResult> = {
    name: 'StatusResult',
    jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: [
            'status'
        ],
        properties: {
            status: {
                type: 'string'
            }
        }
    },
    parse(value: unknown): StatusResult {
        if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value) ||
            !('status' in value) ||
            typeof value.status !== 'string'
        ) {
            throw new Error('status 必须是字符串。');
        }
        return {
            status: value.status
        };
    }
};

/** 创建一份符合 Chat Completions 结构的成功响应。 */
function createApiResponse(content: unknown): Response {
    return new Response(JSON.stringify({
        id: 'request-001',
        model: 'gpt-5.6-sol',
        choices: [
            {
                finish_reason: 'stop',
                message: {
                    content
                }
            }
        ]
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

/** 创建一份符合 Responses API 结构的成功响应。 */
function createResponsesApiResponse(content: string): Response {
    return new Response(JSON.stringify({
        id: 'response-001',
        model: 'gpt-5.6-sol',
        status: 'completed',
        output: [
            {
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text: content
                    }
                ]
            }
        ]
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

/** 使用测试 Key 和指定 fetch 创建 FineOne 适配器。 */
function createAdapter(
    fetcher: typeof fetch,
    apiKey = 'test-api-key',
    protocol: FineOneApiProtocol = 'chat_completions'
): FineOneModelAdapter {
    return new FineOneModelAdapter({
        baseUrl: 'https://fineone.example.com/v1/',
        apiKey,
        model: 'gpt-5.6-sol',
        protocol
    }, fetcher);
}

describe('FineOneModelAdapter', () => {
    it('调用 gpt-5.6-sol 并使用 RuntimeSchema 解析严格 JSON', async () => {
        let requestedUrl = '';
        let requestedInit: RequestInit | undefined;
        const fetcher = (async (
            input: URL | RequestInfo,
            init?: RequestInit
        ) => {
            requestedUrl = String(input);
            requestedInit = init;
            return createApiResponse('{"status":"ok"}');
        }) as typeof fetch;
        const adapter = createAdapter(fetcher);
        const controller = new AbortController();

        const result = await adapter.generateStructured(
            request,
            statusSchema,
            controller.signal
        );

        assert.deepEqual(result, {
            value: {
                status: 'ok'
            },
            model: 'gpt-5.6-sol',
            requestId: 'request-001'
        });
        assert.equal(
            requestedUrl,
            'https://fineone.example.com/v1/chat/completions'
        );

        const body = JSON.parse(
            String(requestedInit?.body)
        ) as Record<string, unknown>;
        assert.equal(body.model, 'gpt-5.6-sol');
        assert.equal(body.max_tokens, 100);
        assert.deepEqual(body.response_format, {
            type: 'json_object'
        });

        const headers = new Headers(requestedInit?.headers);
        assert.equal(
            headers.get('Authorization'),
            'Bearer test-api-key'
        );
        assert.match(
            JSON.stringify(body.messages),
            /StatusResult/u
        );
    });

    it('使用 Responses API 的 JSON Schema 获取结构化结果', async () => {
        let requestedUrl = '';
        let requestedInit: RequestInit | undefined;
        const fetcher = (async (
            input: URL | RequestInfo,
            init?: RequestInit
        ) => {
            requestedUrl = String(input);
            requestedInit = init;
            return createResponsesApiResponse('{"status":"ok"}');
        }) as typeof fetch;

        const result = await createAdapter(
            fetcher,
            'test-api-key',
            'responses'
        ).generateStructured(
            request,
            statusSchema,
            new AbortController().signal
        );

        assert.deepEqual(result, {
            value: {
                status: 'ok'
            },
            model: 'gpt-5.6-sol',
            requestId: 'response-001'
        });
        assert.equal(
            requestedUrl,
            'https://fineone.example.com/v1/responses'
        );

        const body = JSON.parse(
            String(requestedInit?.body)
        ) as Record<string, any>;
        assert.equal(body.model, 'gpt-5.6-sol');
        assert.equal(body.instructions, request.systemPrompt);
        assert.equal(body.input, request.userPrompt);
        assert.equal(body.max_output_tokens, 100);
        assert.equal(body.reasoning.effort, 'high');
        assert.equal(body.store, false);
        assert.deepEqual(body.text.format, {
            type: 'json_schema',
            name: 'StatusResult',
            strict: true,
            schema: statusSchema.jsonSchema
        });
    });

    it('兼容模型返回的单个 Markdown JSON 代码块', async () => {
        const fetcher = (async () => createApiResponse(
            '```json\n{"status":"ok"}\n```'
        )) as typeof fetch;

        const result = await createAdapter(fetcher).generateStructured(
            request,
            statusSchema,
            new AbortController().signal
        );

        assert.deepEqual(result.value, {
            status: 'ok'
        });
    });

    it('模型 JSON 不符合 RuntimeSchema 时返回稳定错误分类', async () => {
        const fetcher = (async () => createApiResponse(
            '{"status":123}'
        )) as typeof fetch;

        await assert.rejects(
            createAdapter(fetcher).generateStructured(
                request,
                statusSchema,
                new AbortController().signal
            ),
            hasFineOneErrorCode('SCHEMA_VALIDATION_FAILED')
        );
    });

    it('API Key 留空时不发送网络请求', async () => {
        let fetchCalled = false;
        const fetcher = (async () => {
            fetchCalled = true;
            return createApiResponse('{"status":"ok"}');
        }) as typeof fetch;

        await assert.rejects(
            createAdapter(fetcher, '').generateStructured(
                request,
                statusSchema,
                new AbortController().signal
            ),
            hasFineOneErrorCode('MISSING_API_KEY')
        );
        assert.equal(fetchCalled, false);
    });

    it('外部 AbortSignal 取消时保留 AbortError', async () => {
        const fetcher = (async (
            _input: URL | RequestInfo,
            init?: RequestInit
        ) => new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => {
                reject(signal.reason);
            }, {
                once: true
            });
        })) as typeof fetch;
        const adapter = createAdapter(fetcher);
        const controller = new AbortController();
        const pendingRequest = adapter.generateStructured(
            request,
            statusSchema,
            controller.signal
        );

        controller.abort();

        await assert.rejects(
            pendingRequest,
            hasErrorName('AbortError')
        );
    });
});

/** 为 assert.rejects 匹配 FineOne 的稳定错误分类。 */
function hasFineOneErrorCode(
    code: FineOneModelAdapterError['code']
) {
    return (error: unknown) =>
        error instanceof FineOneModelAdapterError &&
        error.code === code;
}

/** 为 assert.rejects 匹配指定名称的 Error。 */
function hasErrorName(name: string) {
    return (error: unknown) => error instanceof Error &&
        error.name === name;
}
