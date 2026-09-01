import assert from 'node:assert/strict';
import type {
    ModelRequest,
    RuntimeSchema,
} from '@ai-web-test-engine/core';
import {
    ClassifiedModelFailure,
} from '@ai-web-test-engine/core';
import {
    CodexAppServerModelAdapter,
} from '../../../../src/adapters/model';
import type {
    CodexAppServerClient,
    CodexStructuredTurnInput,
    CodexStructuredTurnOutput,
} from '../../../../src/adapters/model';

interface StatusResult {
    status: string;
}

const request: ModelRequest = {
    systemPrompt: '只返回 JSON。',
    userPrompt: '检查状态',
    timeoutMs: 1_000,
    maxOutputTokens: 100,
    modelRole: 'recovery-planner',
    protocolPhase: 'initial'
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

describe('CodexAppServerModelAdapter', () => {
    it('通过 Codex 客户端调用 Sol，并二次校验结构化结果', async () => {
        const client = new FakeCodexClient({
            model: 'gpt-5.6-sol',
            threadId: 'thread-001',
            turnId: 'turn-001',
            text: '{"status":"ok"}'
        });
        const adapter = createAdapter(client);

        const result = await adapter.generateStructured(
            request,
            statusSchema,
            new AbortController().signal
        );

        assert.deepEqual(result, {
            model: 'gpt-5.6-sol',
            requestId: 'turn-001',
            value: {
                status: 'ok'
            }
        });
        assert.equal(client.lastInput?.reasoningEffort, 'high');
        assert.equal(client.lastInput?.serviceTier, 'priority');
        assert.equal(client.lastInput?.systemPrompt, request.systemPrompt);
        assert.equal(client.lastInput?.userPrompt, request.userPrompt);
        assert.deepEqual(
            client.lastInput?.outputSchema,
            statusSchema.jsonSchema
        );
    });

    it('最终输出不是 JSON 时返回稳定错误分类', async () => {
        const client = new FakeCodexClient({
            model: 'gpt-5.6-sol',
            threadId: 'thread-001',
            turnId: 'turn-001',
            text: [
                'Authorization: Bearer bearer-secret-value',
                'Cookie: session=cookie-secret; theme=dark',
                'password="multi word password"',
                "token='multi word token'",
                'credential = "multi word credential"',
                'password: my secret password',
                'token=alpha beta gamma',
                'credential: foo bar baz',
                'https://example.test/path?q=query-secret#fragment-secret',
                'not-json'
            ].join('\n')
        });

        await assert.rejects(
            createAdapter(client).generateStructured(
                request,
                statusSchema,
                new AbortController().signal
            ),
            hasClassifiedFailure('invalid-json', (error) => {
                assert.equal(error.diagnostic.modelRole, 'recovery-planner');
                assert.equal(error.diagnostic.phase, 'initial');
                [
                    'bearer-secret-value',
                    'cookie-secret',
                    'multi word password',
                    'multi word token',
                    'multi word credential',
                    'my secret password',
                    'alpha beta gamma',
                    'foo bar baz',
                    'query-secret',
                    'fragment-secret'
                ].forEach((secret) => assert.equal(
                    error.diagnostic.rawOutputPreview?.includes(secret),
                    false,
                    secret
                ));
                assert.equal(
                    error.diagnostic.rawOutputPreview?.includes('?q='),
                    false
                );
                assert.equal(error.diagnostic.rawSha256?.length, 64);
            })
        );
    });

    it('JSON 不符合 RuntimeSchema 时返回稳定错误分类', async () => {
        const client = new FakeCodexClient({
            model: 'gpt-5.6-sol',
            threadId: 'thread-001',
            turnId: 'turn-001',
            text: '{"status":123}'
        });

        await assert.rejects(
            createAdapter(client).generateStructured(
                request,
                statusSchema,
                new AbortController().signal
            ),
            hasClassifiedFailure('schema-invalid', (error) => {
                assert.deepEqual(error.diagnostic.parsedJson, { status: 123 });
                assert.equal(error.diagnostic.schemaIssues[0]?.path, '$');
                assert.equal(error.diagnostic.rawOutputPreview, undefined);
                assert.equal(error.diagnostic.rawSha256?.length, 64);
            })
        );
    });

    it('超过调用时限时返回 TIMEOUT', async () => {
        const client = new PendingCodexClient();
        const adapter = createAdapter(client);

        await assert.rejects(
            adapter.generateStructured(
                {
                    ...request,
                    timeoutMs: 10
                },
                statusSchema,
                new AbortController().signal
            ),
            hasClassifiedFailure('model-timeout')
        );
    });

    it('外部 AbortSignal 取消时保留 AbortError', async () => {
        const client = new PendingCodexClient();
        const adapter = createAdapter(client);
        const controller = new AbortController();
        const pendingRequest = adapter.generateStructured(
            request,
            statusSchema,
            controller.signal
        );

        controller.abort();

        await assert.rejects(
            pendingRequest,
            (error: unknown) => error instanceof Error &&
                error.name === 'AbortError'
        );
    });
});

/** 使用指定假的客户端创建 Codex 模型适配器。 */
function createAdapter(
    client: CodexAppServerClient
): CodexAppServerModelAdapter {
    return new CodexAppServerModelAdapter({
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        serviceTier: 'priority',
        command: 'codex'
    }, client);
}

/** 为 assert.rejects 匹配 provider-neutral 的稳定模型错误分类。 */
function hasClassifiedFailure(
    failureType: ClassifiedModelFailure['failureType'],
    inspect?: (error: ClassifiedModelFailure) => void
) {
    return (error: unknown) => {
        if (
            !(error instanceof ClassifiedModelFailure)
            || error.failureType !== failureType
        ) {
            return false;
        }
        inspect?.(error);
        return true;
    };
}

/** 返回固定 App Server 回合，并记录适配器传入的参数。 */
class FakeCodexClient implements CodexAppServerClient {
    public lastInput?: CodexStructuredTurnInput;

    constructor(private readonly output: CodexStructuredTurnOutput) {}

    /** 模拟一次立即完成的 App Server 结构化回合。 */
    public runStructuredTurn = (
        input: CodexStructuredTurnInput,
        _signal: AbortSignal
    ): Promise<CodexStructuredTurnOutput> => {
        this.lastInput = input;
        return Promise.resolve(this.output);
    };
}

/** 保持请求挂起，直到模型适配器传入的信号被取消。 */
class PendingCodexClient implements CodexAppServerClient {
    /** 模拟一个只会由超时或外部信号结束的模型回合。 */
    public runStructuredTurn = (
        _input: CodexStructuredTurnInput,
        signal: AbortSignal
    ): Promise<CodexStructuredTurnOutput> => new Promise((
        _resolve,
        reject
    ) => {
        signal.addEventListener('abort', () => {
            reject(signal.reason);
        }, {
            once: true
        });
    });
}
