import assert from 'node:assert/strict';
import {
    EventEmitter,
} from 'node:events';
import {
    PassThrough,
} from 'node:stream';
import type {
    ChildProcessWithoutNullStreams,
} from 'node:child_process';
import {
    CodexAppServerError,
    StdioCodexAppServerClient,
} from '../../../../src/adapters/model';

interface CapturedRequest {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
}

describe('StdioCodexAppServerClient', () => {
    it('按协议完成初始化、模型校验、临时线程和结构化回合', async () => {
        const fakeProcess = new FakeCodexProcess([
            'gpt-5.6-sol'
        ]);
        const client = new StdioCodexAppServerClient({
            command: 'custom-codex',
            clientVersion: 'test-version'
        }, (command, args) => {
            assert.equal(command, 'custom-codex');
            assert.deepEqual(args, [
                'app-server',
                '--stdio'
            ]);
            return fakeProcess as unknown as ChildProcessWithoutNullStreams;
        });

        const result = await client.runStructuredTurn({
            model: 'gpt-5.6-sol',
            reasoningEffort: 'high',
            systemPrompt: '提取测试意图。',
            userPrompt: '帮我登录',
            maxOutputTokens: 100,
            outputSchema: {
                type: 'object'
            }
        }, new AbortController().signal);

        assert.deepEqual(result, {
            model: 'gpt-5.6-sol',
            threadId: 'thread-001',
            turnId: 'turn-001',
            text: '{"status":"ok"}'
        });

        const threadRequest = fakeProcess.requests.find(
            (item) => item.method === 'thread/start'
        );
        assert.equal(threadRequest?.params?.model, 'gpt-5.6-sol');
        assert.equal(threadRequest?.params?.approvalPolicy, 'never');
        assert.equal(threadRequest?.params?.sandbox, 'read-only');
        assert.deepEqual(threadRequest?.params?.dynamicTools, []);

        const turnRequest = fakeProcess.requests.find(
            (item) => item.method === 'turn/start'
        );
        assert.equal(turnRequest?.params?.effort, 'high');
        assert.deepEqual(turnRequest?.params?.outputSchema, {
            type: 'object'
        });
        assert.deepEqual(turnRequest?.params?.sandboxPolicy, {
            type: 'readOnly',
            networkAccess: false
        });
        assert.equal(fakeProcess.closedByEof, true);
    });

    it('当前登录不提供目标模型时提前失败', async () => {
        const fakeProcess = new FakeCodexProcess([
            'gpt-5.6-luna'
        ]);
        const client = new StdioCodexAppServerClient({}, () =>
            fakeProcess as unknown as ChildProcessWithoutNullStreams
        );

        await assert.rejects(
            client.runStructuredTurn({
                model: 'gpt-5.6-sol',
                reasoningEffort: 'high',
                systemPrompt: '提取测试意图。',
                userPrompt: '帮我登录',
                maxOutputTokens: 100,
                outputSchema: {
                    type: 'object'
                }
            }, new AbortController().signal),
            (error: unknown) => error instanceof CodexAppServerError &&
                error.code === 'MODEL_NOT_AVAILABLE'
        );
        assert.equal(
            fakeProcess.requests.some(
                (item) => item.method === 'thread/start'
            ),
            false
        );
        assert.equal(fakeProcess.closedByEof, true);
    });
});

/** 模拟行分隔 App Server 协议，并记录客户端发出的所有请求。 */
class FakeCodexProcess extends EventEmitter {
    public readonly stdin = new PassThrough();
    public readonly stdout = new PassThrough();
    public readonly stderr = new PassThrough();
    public readonly requests: CapturedRequest[] = [];
    public closedByEof = false;
    private inputBuffer = '';

    constructor(private readonly models: string[]) {
        super();
        this.stdin.on('data', this.handleInput);
        this.stdin.on('finish', () => {
            this.closedByEof = true;
            this.emit('exit', 0, null);
        });
    }

    /** 模拟强制结束子进程。 */
    public kill(): boolean {
        this.emit('exit', 0, null);
        return true;
    }

    /** 按换行拆分客户端写入的协议消息。 */
    private readonly handleInput = (chunk: Buffer): void => {
        this.inputBuffer += chunk.toString('utf8');
        let newlineIndex = this.inputBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.inputBuffer.slice(0, newlineIndex);
            this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);
            if (line.trim()) {
                this.handleRequest(JSON.parse(line) as CapturedRequest);
            }
            newlineIndex = this.inputBuffer.indexOf('\n');
        }
    };

    /** 为测试涉及的每个 App Server 方法返回最小合法响应。 */
    private handleRequest(request: CapturedRequest): void {
        this.requests.push(request);
        if (request.method === 'initialized') {
            return;
        }
        if (request.method === 'initialize') {
            this.respond(request.id, {
                userAgent: 'fake-codex',
                codexHome: 'C:\\fake',
                platformFamily: 'windows',
                platformOs: 'windows'
            });
            return;
        }
        if (request.method === 'model/list') {
            this.respond(request.id, {
                data: this.models.map((model) => ({
                    id: model,
                    model
                })),
                nextCursor: null
            });
            return;
        }
        if (request.method === 'thread/start') {
            this.respond(request.id, {
                thread: {
                    id: 'thread-001'
                }
            });
            return;
        }
        if (request.method === 'turn/start') {
            this.respond(request.id, {
                turn: {
                    id: 'turn-001'
                }
            });
            this.notify('item/completed', {
                item: {
                    type: 'agentMessage',
                    text: '{"status":"ok"}'
                }
            });
            this.notify('turn/completed', {
                turn: {
                    id: 'turn-001',
                    status: 'completed',
                    error: null,
                    items: []
                }
            });
        }
    }

    /** 写入一条假的请求响应。 */
    private respond(id: number | undefined, result: unknown): void {
        this.stdout.write(`${ JSON.stringify({
            id,
            result
        }) }\n`);
    }

    /** 写入一条假的服务端通知。 */
    private notify(method: string, params: unknown): void {
        this.stdout.write(`${ JSON.stringify({
            method,
            params
        }) }\n`);
    }
}
