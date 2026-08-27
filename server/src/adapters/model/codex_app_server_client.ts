import {
    spawn,
} from 'node:child_process';
import type {
    ChildProcessWithoutNullStreams,
} from 'node:child_process';
import {
    mkdtemp,
    rm,
} from 'node:fs/promises';
import {
    tmpdir,
} from 'node:os';
import {
    join,
} from 'node:path';
import {
    createInterface,
} from 'node:readline';
import type {
    Interface as ReadLineInterface,
} from 'node:readline';
import type {
    JsonValue,
} from '@ai-web-test-engine/core';

export type CodexReasoningEffort =
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | 'ultra';

export type CodexAppServerErrorCode =
    | 'CLI_NOT_FOUND'
    | 'INVALID_RESPONSE'
    | 'MODEL_NOT_AVAILABLE'
    | 'NOT_LOGGED_IN'
    | 'PROCESS_EXITED'
    | 'PROTOCOL_ERROR'
    | 'SCHEMA_VALIDATION_FAILED'
    | 'TIMEOUT'
    | 'TURN_FAILED';

/** Codex CLI、App Server 协议或模型回合执行失败。 */
export class CodexAppServerError extends Error {
    /** 保存可以稳定映射为 HTTP 状态码的错误分类。 */
    constructor(
        public readonly code: CodexAppServerErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'CodexAppServerError';
    }
}

/** 一次不允许调用工具的 Codex 结构化模型回合。 */
export interface CodexStructuredTurnInput {
    model: string;
    reasoningEffort: CodexReasoningEffort;
    serviceTier?: string;
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
    outputSchema: Record<string, JsonValue>;
}

/** App Server 完成结构化回合后返回的模型文本及追踪标识。 */
export interface CodexStructuredTurnOutput {
    model: string;
    threadId: string;
    turnId: string;
    text: string;
}

/** 模型适配器依赖的 Codex App Server 客户端边界。 */
export interface CodexAppServerClient {
    /** 启动一个隔离的临时线程并等待结构化最终答案。 */
    runStructuredTurn: (
        input: CodexStructuredTurnInput,
        signal: AbortSignal
    ) => Promise<CodexStructuredTurnOutput>;
}

export interface StdioCodexAppServerClientOptions {
    command?: string;
    clientVersion?: string;
}

type CodexProcessSpawner = (
    command: string,
    args: string[]
) => ChildProcessWithoutNullStreams;

interface ConfiguredMcpServer {
    name: string;
    enabled: boolean;
}

interface ProtocolMessage {
    id?: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    cleanup: () => void;
}

interface NotificationWaiter {
    method: string;
    predicate: (params: unknown) => boolean;
    resolve: (params: unknown) => void;
    reject: (reason: unknown) => void;
    cleanup: () => void;
}

type NotificationObserver = (
    method: string,
    params: unknown
) => void;

/** 判断未知值是否为普通对象。 */
function isRecord(
    value: unknown
): value is Record<string, unknown> {
    return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value);
}

/** 从 App Server RPC 错误中提取有限长度的安全消息。 */
function getProtocolErrorMessage(value: unknown): string {
    if (isRecord(value) && typeof value.message === 'string') {
        return value.message.slice(0, 500);
    }
    return 'App Server 返回了未说明原因的协议错误。';
}

/** 将认证类协议错误转换为更明确的本机登录提示。 */
function createProtocolError(value: unknown): CodexAppServerError {
    const message = getProtocolErrorMessage(value);
    if (/auth|login|log in|sign in|认证|登录/iu.test(message)) {
        return new CodexAppServerError(
            'NOT_LOGGED_IN',
            `Codex 尚未登录或登录已失效：${ message }`
        );
    }
    return new CodexAppServerError(
        'PROTOCOL_ERROR',
        `Codex App Server 请求失败：${ message }`
    );
}

/** 从 AbortSignal 中取得标准取消原因。 */
function getAbortReason(signal: AbortSignal): unknown {
    try {
        signal.throwIfAborted();
    } catch (error) {
        return error;
    }
    return new DOMException('操作已取消。', 'AbortError');
}

/** 校验 `codex mcp list --json` 输出并提取当前启用的服务名。 */
function readEnabledMcpServerNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new CodexAppServerError(
            'PROTOCOL_ERROR',
            'Codex MCP 配置列表格式无效。'
        );
    }

    const servers = value.map((item): ConfiguredMcpServer => {
        if (
            !isRecord(item) ||
            typeof item.name !== 'string' ||
            typeof item.enabled !== 'boolean'
        ) {
            throw new CodexAppServerError(
                'PROTOCOL_ERROR',
                'Codex MCP 配置项格式无效。'
            );
        }
        return {
            name: item.name,
            enabled: item.enabled
        };
    });

    return [
        ...new Set(
            servers
                .filter((server) => server.enabled)
                .map((server) => server.name)
        )
    ];
}

/** 读取 Codex 的有效 MCP 配置；该命令只解析配置，不启动 MCP 服务。 */
function listEnabledMcpServerNames(
    command: string,
    processSpawner: CodexProcessSpawner,
    signal: AbortSignal
): Promise<string[]> {
    signal.throwIfAborted();
    const child = processSpawner(command, [
        'mcp',
        'list',
        '--json'
    ]);

    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let settled = false;

        const cleanup = () => {
            signal.removeEventListener('abort', abortProcess);
            child.removeListener('error', handleProcessError);
            child.removeListener('exit', handleProcessExit);
        };
        const finish = (
            callback: () => void
        ) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            callback();
        };
        const abortProcess = () => {
            finish(() => reject(getAbortReason(signal)));
            child.kill();
        };
        const handleProcessError = (
            error: Error & { code?: string }
        ) => {
            const codexError = error.code === 'ENOENT'
                ? new CodexAppServerError(
                    'CLI_NOT_FOUND',
                    '没有找到 Codex CLI，请先安装 Codex 并完成登录。'
                )
                : new CodexAppServerError(
                    'PROCESS_EXITED',
                    `Codex MCP 配置读取进程无法启动：${ error.message }`
                );
            finish(() => reject(codexError));
        };
        const handleProcessExit = (code: number | null) => {
            if (code !== 0) {
                const suffix = stderr.trim()
                    ? `：${ stderr.trim().slice(0, 500) }`
                    : '';
                finish(() => reject(new CodexAppServerError(
                    'PROCESS_EXITED',
                    `Codex MCP 配置读取失败（code=${
                        code ?? 'null'
                    }）${ suffix }`
                )));
                return;
            }

            finish(() => {
                try {
                    resolve(readEnabledMcpServerNames(
                        JSON.parse(stdout) as unknown
                    ));
                } catch (error) {
                    reject(error instanceof CodexAppServerError
                        ? error
                        : new CodexAppServerError(
                            'PROTOCOL_ERROR',
                            'Codex MCP 配置列表不是合法 JSON。'
                        ));
                }
            });
        };

        child.stdout.on('data', (chunk: Buffer) => {
            stdout = `${ stdout }${ chunk.toString('utf8') }`;
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = `${ stderr }${ chunk.toString('utf8') }`.slice(-1_000);
        });
        child.stdin.on('error', () => {
            // 读取配置的子命令不消费 stdin，提前退出时忽略管道关闭错误。
        });
        child.once('error', handleProcessError);
        child.once('exit', handleProcessExit);
        signal.addEventListener('abort', abortProcess, {
            once: true
        });
        child.stdin.end();
    });
}

/** 为可安全表达为 TOML 裸键的 MCP 名称生成禁用覆盖。 */
function createMcpDisableArguments(serverNames: string[]): string[] {
    return serverNames
        .filter((serverName) => /^[a-zA-Z0-9_-]+$/u.test(serverName))
        .flatMap((serverName) => [
            '-c',
            `mcp_servers.${ serverName }.enabled=false`
        ]);
}

/** Windows 子进程短暂占用 cwd 时，避免清理错误覆盖成功模型结果。 */
function isTransientCleanupError(error: unknown): boolean {
    return isRecord(error) &&
        (error.code === 'EBUSY' || error.code === 'EPERM');
}

/** 尽力删除隔离目录；仅忽略 Windows 已知的短暂占用错误。 */
async function removeIsolatedDirectory(directory: string): Promise<void> {
    try {
        await rm(directory, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100
        });
    } catch (error) {
        if (!isTransientCleanupError(error)) {
            throw error;
        }
    }
}

/** 管理单个 Codex App Server 子进程上的行分隔 JSON-RPC 会话。 */
class StdioProtocolConnection {
    private nextRequestId = 1;
    private readonly pendingRequests = new Map<
        number | string,
        PendingRequest
    >();
    private readonly notificationWaiters = new Set<NotificationWaiter>();
    private readonly notificationObservers = new Set<NotificationObserver>();
    private readonly reader: ReadLineInterface;
    private stderrSummary = '';
    private closing = false;
    private exited = false;
    private readonly exitPromise: Promise<void>;

    /** 监听子进程输出并建立请求、响应和通知的分发关系。 */
    constructor(private readonly child: ChildProcessWithoutNullStreams) {
        this.reader = createInterface({
            input: child.stdout
        });
        this.reader.on('line', this.handleLine);
        child.stderr.on('data', this.handleStderr);
        child.stdin.on('error', this.handleStdinError);
        child.on('error', this.handleProcessError);
        this.exitPromise = new Promise((resolve) => {
            child.once('exit', (code) => {
                this.exited = true;
                resolve();
                if (!this.closing) {
                    const suffix = this.stderrSummary
                        ? `：${ this.stderrSummary }`
                        : '';
                    this.failAll(new CodexAppServerError(
                        'PROCESS_EXITED',
                        `Codex App Server 意外退出（code=${
                            code ?? 'null'
                        }）${ suffix }`
                    ));
                }
            });
        });
    }

    /** 发送一个有响应的 App Server 请求。 */
    public request(
        method: string,
        params: unknown,
        signal?: AbortSignal
    ): Promise<unknown> {
        signal?.throwIfAborted();
        const id = this.nextRequestId;
        this.nextRequestId += 1;

        return new Promise((resolve, reject) => {
            const abortRequest = () => {
                this.pendingRequests.delete(id);
                cleanup();
                reject(getAbortReason(signal as AbortSignal));
            };
            const cleanup = () => {
                signal?.removeEventListener('abort', abortRequest);
            };

            this.pendingRequests.set(id, {
                resolve,
                reject,
                cleanup
            });
            signal?.addEventListener('abort', abortRequest, {
                once: true
            });

            try {
                this.writeMessage({
                    id,
                    method,
                    params
                });
            } catch (error) {
                this.pendingRequests.delete(id);
                cleanup();
                reject(error);
            }
        });
    }

    /** 发送无需响应的 App Server 通知。 */
    public notify(method: string): void {
        this.writeMessage({
            method
        });
    }

    /** 在请求发出前订阅一次目标通知，避免极快回合造成事件丢失。 */
    public waitForNotification(
        method: string,
        predicate: (params: unknown) => boolean,
        signal: AbortSignal
    ): Promise<unknown> {
        signal.throwIfAborted();

        return new Promise((resolve, reject) => {
            const abortWait = () => {
                this.notificationWaiters.delete(waiter);
                cleanup();
                reject(getAbortReason(signal));
            };
            const cleanup = () => {
                signal.removeEventListener('abort', abortWait);
            };
            const waiter: NotificationWaiter = {
                method,
                predicate,
                resolve,
                reject,
                cleanup
            };
            this.notificationWaiters.add(waiter);
            signal.addEventListener('abort', abortWait, {
                once: true
            });
        });
    }

    /** 订阅所有通知，用于收集回合中的最终 agentMessage。 */
    public observeNotifications(observer: NotificationObserver): () => void {
        this.notificationObservers.add(observer);
        return () => this.notificationObservers.delete(observer);
    }

    /** 结束标准输入，让 App Server 通过 EOF 正常退出。 */
    public async close(): Promise<void> {
        if (this.closing) {
            return;
        }
        this.closing = true;
        this.reader.off('line', this.handleLine);

        if (!this.exited) {
            this.child.stdin.end();
            const closeTimeout = new Promise<void>((resolve) => {
                const timeout = setTimeout(resolve, 2_000);
                timeout.unref();
            });
            await Promise.race([
                this.exitPromise,
                closeTimeout
            ]);
        }

        if (!this.exited) {
            this.child.kill();
            const killTimeout = new Promise<void>((resolve) => {
                const timeout = setTimeout(resolve, 2_000);
                timeout.unref();
            });
            await Promise.race([
                this.exitPromise,
                killTimeout
            ]);
        }
        this.reader.close();
        this.failAll(new CodexAppServerError(
            'PROCESS_EXITED',
            'Codex App Server 会话已经关闭。'
        ));
    }

    /** 将一条 JSON 消息写入 App Server 标准输入。 */
    private writeMessage(message: ProtocolMessage): void {
        if (this.closing || this.exited) {
            throw new CodexAppServerError(
                'PROCESS_EXITED',
                'Codex App Server 进程已经退出。'
            );
        }
        this.child.stdin.write(`${ JSON.stringify(message) }\n`);
    }

    /** 解析一行 App Server 输出并分发给请求或通知监听器。 */
    private readonly handleLine = (line: string): void => {
        let message: ProtocolMessage;
        try {
            message = JSON.parse(line) as ProtocolMessage;
        } catch {
            this.failAll(new CodexAppServerError(
                'PROTOCOL_ERROR',
                'Codex App Server 输出了无法解析的协议消息。'
            ));
            return;
        }

        if (message.id !== undefined && message.method === undefined) {
            this.resolveRequest(message);
            return;
        }
        if (message.id !== undefined && message.method !== undefined) {
            // 当前模型用途不支持审批、工具调用或凭证刷新等反向请求。
            this.writeMessage({
                id: message.id,
                error: {
                    code: -32601,
                    message: 'AI Web Test Engine 不支持该 App Server 反向请求。'
                }
            });
            return;
        }
        if (typeof message.method === 'string') {
            this.dispatchNotification(message.method, message.params);
        }
    };

    /** 保存有限长度的 stderr，仅在子进程异常退出时辅助诊断。 */
    private readonly handleStderr = (chunk: Buffer): void => {
        if (this.stderrSummary.length >= 1_000) {
            return;
        }
        this.stderrSummary = `${ this.stderrSummary }${
            chunk.toString('utf8')
        }`.trim().slice(0, 1_000);
    };

    /** 将进程提前退出造成的 stdin 管道错误交给当前会话处理。 */
    private readonly handleStdinError = (error: Error): void => {
        if (!this.closing) {
            this.failAll(new CodexAppServerError(
                'PROCESS_EXITED',
                `Codex App Server 输入管道异常：${ error.message }`
            ));
        }
    };

    /** 将无法启动 Codex CLI 的错误转换成稳定分类。 */
    private readonly handleProcessError = (
        error: Error & { code?: string }
    ): void => {
        const codexError = error.code === 'ENOENT'
            ? new CodexAppServerError(
                'CLI_NOT_FOUND',
                '没有找到 Codex CLI，请先安装 Codex 并完成登录。'
            )
            : new CodexAppServerError(
                'PROCESS_EXITED',
                `Codex App Server 无法启动：${ error.message }`
            );
        this.failAll(codexError);
    };

    /** 完成对应的 RPC Promise，并清理取消监听器。 */
    private resolveRequest(message: ProtocolMessage): void {
        const pending = this.pendingRequests.get(message.id as number | string);
        if (!pending) {
            return;
        }
        this.pendingRequests.delete(message.id as number | string);
        pending.cleanup();

        if (message.error !== undefined) {
            pending.reject(createProtocolError(message.error));
            return;
        }
        pending.resolve(message.result);
    }

    /** 将通知交给观察者，并完成第一个匹配的单次等待器。 */
    private dispatchNotification(method: string, params: unknown): void {
        this.notificationObservers.forEach((observer) => {
            observer(method, params);
        });

        for (const waiter of this.notificationWaiters) {
            if (waiter.method === method && waiter.predicate(params)) {
                this.notificationWaiters.delete(waiter);
                waiter.cleanup();
                waiter.resolve(params);
                break;
            }
        }
    }

    /** 让当前会话中尚未完成的所有 Promise 以同一原因失败。 */
    private failAll(error: CodexAppServerError): void {
        this.pendingRequests.forEach((pending) => {
            pending.cleanup();
            pending.reject(error);
        });
        this.pendingRequests.clear();
        this.notificationWaiters.forEach((waiter) => {
            waiter.cleanup();
            waiter.reject(error);
        });
        this.notificationWaiters.clear();
    }
}

/** 通过本机 `codex app-server --stdio` 执行隔离的结构化模型回合。 */
export class StdioCodexAppServerClient implements CodexAppServerClient {
    private readonly command: string;
    private readonly clientVersion: string;

    /** 保存 Codex 命令路径，并允许测试注入假的子进程。 */
    constructor(
        options: StdioCodexAppServerClientOptions = {},
        private readonly processSpawner: CodexProcessSpawner = (
            command,
            args
        ) => spawn(command, args)
    ) {
        this.command = options.command?.trim() || 'codex';
        this.clientVersion = options.clientVersion?.trim() || '0.1.0';
    }

    /** 完成初始化、模型校验、临时线程和结构化回合的完整协议流程。 */
    public runStructuredTurn = async (
        input: CodexStructuredTurnInput,
        signal: AbortSignal
    ): Promise<CodexStructuredTurnOutput> => {
        signal.throwIfAborted();
        const enabledMcpServerNames = await listEnabledMcpServerNames(
            this.command,
            this.processSpawner,
            signal
        );
        const isolatedDirectoryPrefix = join(
            tmpdir(),
            'ai-web-test-engine-codex-'
        );
        const isolatedDirectory = await mkdtemp(isolatedDirectoryPrefix);
        let connection: StdioProtocolConnection | undefined;

        try {
            const child = this.processSpawner(this.command, [
                ...createMcpDisableArguments(enabledMcpServerNames),
                'app-server',
                '--stdio'
            ]);
            connection = new StdioProtocolConnection(child);
            return await this.executeStructuredTurn(
                connection,
                input,
                isolatedDirectory,
                signal
            );
        } finally {
            await connection?.close();
            // 只删除本次由 mkdtemp 创建、且仍位于预期前缀下的临时目录。
            if (isolatedDirectory.startsWith(isolatedDirectoryPrefix)) {
                await removeIsolatedDirectory(isolatedDirectory);
            }
        }
    };

    /** 在已经建立的协议连接上完成初始化、建线程和执行回合。 */
    private async executeStructuredTurn(
        connection: StdioProtocolConnection,
        input: CodexStructuredTurnInput,
        isolatedDirectory: string,
        signal: AbortSignal
    ): Promise<CodexStructuredTurnOutput> {
        await this.initialize(connection, signal);
        await this.requireModel(connection, input.model, signal);
        const threadId = await this.startIsolatedThread(
            connection,
            input,
            isolatedDirectory,
            signal
        );
        return await this.startAndWaitForTurn(
            connection,
            input,
            threadId,
            signal
        );
    }

    /** 创建无工具、只读且不持久化的临时 Codex 线程。 */
    private async startIsolatedThread(
        connection: StdioProtocolConnection,
        input: CodexStructuredTurnInput,
        isolatedDirectory: string,
        signal: AbortSignal
    ): Promise<string> {
        const thread = await connection.request('thread/start', {
            model: input.model,
            serviceTier: input.serviceTier,
            allowProviderModelFallback: false,
            cwd: isolatedDirectory,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            baseInstructions: [
                '你是 AI Web Test Engine 的结构化数据转换器。',
                '不得调用任何工具、读取文件、访问网络或修改环境。',
                '最终答案只能是符合调用方 JSON Schema 的 JSON，不要输出 Markdown。'
            ].join('\n'),
            developerInstructions: input.systemPrompt,
            ephemeral: true,
            environments: [],
            dynamicTools: []
        }, signal);
        return this.readThreadStart(thread).threadId;
    }

    /** 启动一个带 JSON Schema 的模型回合并等待最终 agentMessage。 */
    private async startAndWaitForTurn(
        connection: StdioProtocolConnection,
        input: CodexStructuredTurnInput,
        threadId: string,
        signal: AbortSignal
    ): Promise<CodexStructuredTurnOutput> {
        let finalText: string | undefined;
        let turnId: string | undefined;
        const stopObserving = connection.observeNotifications(
            (method, params) => {
                const item = this.readCompletedAgentMessage(
                    method,
                    params
                );
                if (item !== undefined) {
                    finalText = item;
                }
            }
        );
        const completionController = new AbortController();
        const completionPromise = connection.waitForNotification(
            'turn/completed',
            (params) => this.isTurnCompletion(params),
            AbortSignal.any([
                signal,
                completionController.signal
            ])
        );
        let completionConsumed = false;

        try {
            const turn = await connection.request('turn/start', {
                threadId,
                input: [
                    {
                        type: 'text',
                        text: [
                            input.userPrompt,
                            '',
                            `最终 JSON 请控制在约 ${
                                input.maxOutputTokens
                            } 个输出 token 以内。`
                        ].join('\n'),
                        text_elements: []
                    }
                ],
                model: input.model,
                effort: input.reasoningEffort,
                serviceTier: input.serviceTier,
                approvalPolicy: 'never',
                sandboxPolicy: {
                    type: 'readOnly',
                    networkAccess: false
                },
                environments: [],
                outputSchema: input.outputSchema
            }, signal);
            turnId = this.readTurnStart(turn);
            const completion = await completionPromise;
            completionConsumed = true;
            const completedTurn = this.readTurnCompletion(
                completion,
                turnId
            );
            finalText ??= completedTurn.finalText;

            if (!finalText) {
                throw new CodexAppServerError(
                    'INVALID_RESPONSE',
                    'Codex 回合已完成，但没有返回最终结构化文本。'
                );
            }

            return {
                model: input.model,
                threadId,
                turnId,
                text: finalText
            };
        } catch (error) {
            if (signal.aborted && turnId) {
                await this.tryInterruptTurn(
                    connection,
                    threadId,
                    turnId
                );
            }
            throw error;
        } finally {
            if (!completionConsumed) {
                completionController.abort();
                try {
                    await completionPromise;
                } catch {
                    // 原始请求错误或取消会继续向调用方抛出。
                }
            }
            stopObserving();
        }
    }

    /** 执行 App Server 初始化握手并声明结构化协议能力。 */
    private async initialize(
        connection: StdioProtocolConnection,
        signal: AbortSignal
    ): Promise<void> {
        await connection.request('initialize', {
            clientInfo: {
                name: 'ai-web-test-engine',
                title: 'AI Web Test Engine',
                version: this.clientVersion
            },
            capabilities: {
                experimentalApi: true,
                requestAttestation: false
            }
        }, signal);
        connection.notify('initialized');
    }

    /** 确认当前 Codex 登录实际提供了配置中的模型。 */
    private async requireModel(
        connection: StdioProtocolConnection,
        model: string,
        signal: AbortSignal
    ): Promise<void> {
        const response = await connection.request('model/list', {
            limit: 100,
            includeHidden: true
        }, signal);
        if (!isRecord(response) || !Array.isArray(response.data)) {
            throw new CodexAppServerError(
                'PROTOCOL_ERROR',
                'Codex App Server 的 model/list 响应格式无效。'
            );
        }

        const available = response.data.some((item) =>
            isRecord(item) &&
            (item.id === model || item.model === model)
        );
        if (!available) {
            throw new CodexAppServerError(
                'MODEL_NOT_AVAILABLE',
                `当前 Codex 登录不支持模型 ${ model }。`
            );
        }
    }

    /** 从 thread/start 响应中读取线程标识。 */
    private readThreadStart(value: unknown): {
        threadId: string
    } {
        if (
            !isRecord(value) ||
            !isRecord(value.thread) ||
            typeof value.thread.id !== 'string'
        ) {
            throw new CodexAppServerError(
                'PROTOCOL_ERROR',
                'Codex App Server 的 thread/start 响应格式无效。'
            );
        }
        return {
            threadId: value.thread.id
        };
    }

    /** 从 turn/start 响应中读取回合标识。 */
    private readTurnStart(value: unknown): string {
        if (
            !isRecord(value) ||
            !isRecord(value.turn) ||
            typeof value.turn.id !== 'string'
        ) {
            throw new CodexAppServerError(
                'PROTOCOL_ERROR',
                'Codex App Server 的 turn/start 响应格式无效。'
            );
        }
        return value.turn.id;
    }

    /** 当前连接只运行一个回合，接受包含 turn 的标准完成通知。 */
    private isTurnCompletion(params: unknown): boolean {
        return isRecord(params) && isRecord(params.turn);
    }

    /** 从 item/completed 通知中收集最终的 agentMessage。 */
    private readCompletedAgentMessage(
        method: string,
        params: unknown
    ): string | undefined {
        if (
            method !== 'item/completed' ||
            !isRecord(params) ||
            !isRecord(params.item) ||
            params.item.type !== 'agentMessage' ||
            typeof params.item.text !== 'string'
        ) {
            return undefined;
        }
        return params.item.text;
    }

    /** 校验 turn/completed 状态，并从完整回合中兜底提取最终文本。 */
    private readTurnCompletion(
        value: unknown,
        turnId: string
    ): {
        finalText?: string
    } {
        if (
            !isRecord(value) ||
            !isRecord(value.turn) ||
            value.turn.id !== turnId
        ) {
            throw new CodexAppServerError(
                'PROTOCOL_ERROR',
                'Codex App Server 的 turn/completed 通知格式无效。'
            );
        }
        if (value.turn.status !== 'completed') {
            const errorMessage = isRecord(value.turn.error) &&
                typeof value.turn.error.message === 'string'
                ? value.turn.error.message.slice(0, 500)
                : `status=${ String(value.turn.status) }`;
            throw new CodexAppServerError(
                'TURN_FAILED',
                `Codex 模型回合未成功完成：${ errorMessage }`
            );
        }

        if (!Array.isArray(value.turn.items)) {
            return {};
        }
        const finalItem = value.turn.items.filter((item) =>
            isRecord(item) &&
            item.type === 'agentMessage' &&
            typeof item.text === 'string'
        ).at(-1);

        return {
            finalText: isRecord(finalItem) && typeof finalItem.text === 'string'
                ? finalItem.text
                : undefined
        };
    }

    /** 在外部取消时尽力通知 App Server 中断正在运行的回合。 */
    private async tryInterruptTurn(
        connection: StdioProtocolConnection,
        threadId: string,
        turnId: string
    ): Promise<void> {
        try {
            await connection.request('turn/interrupt', {
                threadId,
                turnId
            }, AbortSignal.timeout(500));
        } catch {
            // 会话随后会被关闭，中断失败不覆盖原始取消原因。
        }
    }
}
