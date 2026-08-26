export type DebugRunMode = 'ai-explore' | 'structured-replay';

export interface RunEvidence {
    kind: string;
    ref: string;
    mediaType?: string;
}

export interface DebugRunResult {
    schemaVersion: number;
    runId: string;
    lifecycle: 'CANCELLED' | 'COMPLETED' | 'CRASHED';
    result?: 'FAIL' | 'PASS' | 'UNCERTAIN';
    summary: string;
    evidence: RunEvidence[];
    failure?: {
        category: string,
        phase: string,
        summary: string,
        recoverable: boolean
    };
    traceRef: string;
    compiledPlanRef?: string;
    metrics: {
        actionCount: number,
        durationMs: number,
        modelCallCount: number,
        repeatedStateActionCount: number
    };
}

export interface RunDebugRequest {
    action: string;
    mode: DebugRunMode;
    planRef?: string;
    startUrl: string;
    testId: string;
    testName: string;
}

export interface DebugRunEvent {
    schemaVersion: number;
    eventId: string;
    runId: string;
    type: string;
    sequence: number;
    timestamp: string;
    payload: Record<string, unknown>;
}

export type DebugRunSessionStatus =
    | 'CANCELLED'
    | 'CANCELLING'
    | 'COMPLETED'
    | 'CRASHED'
    | 'RUNNING';

export interface DebugRunSession {
    schemaVersion: number;
    sessionId: string;
    status: DebugRunSessionStatus;
    createdAt: string;
    updatedAt: string;
    events: DebugRunEvent[];
    error?: string;
    result?: DebugRunResult;
    runId?: string;
}

export type DebugRunSessionUpdate =
    | {
        kind: 'run-event',
        event: DebugRunEvent
    }
    | {
        kind: 'session',
        session: DebugRunSession
    };

interface DebugRunSubscriptionCallbacks {
    onError: (error: Error) => void;
    onUpdate: (update: DebugRunSessionUpdate) => void;
}

/** 调试接口返回非成功状态或非法响应时使用的前端错误。 */
export class RunDebugRequestError extends Error {
    constructor(
        message: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = 'RunDebugRequestError';
    }
}

/** 调用同步调试入口；浏览器取消信号会直接终止长请求。 */
export async function requestDebugRun(
    request: RunDebugRequest,
    signal: AbortSignal
): Promise<DebugRunResult> {
    const response = await fetch('/api/debug/run', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action: request.action,
            mode: request.mode,
            startUrl: request.startUrl,
            testId: request.testId,
            testName: request.testName,
            ...request.mode === 'structured-replay'
                ? { planRef: request.planRef }
                : {}
        }),
        signal
    });
    const value = await readJson(response);
    if (!response.ok) {
        throw new RunDebugRequestError(
            getErrorMessage(value) ?? `调试请求失败（HTTP ${ response.status }）`,
            response.status
        );
    }
    const result = getObject(value)?.result;
    if (!isDebugRunResult(result)) {
        throw new RunDebugRequestError('调试接口返回了无法识别的运行结果。');
    }
    return result;
}

/** 创建异步运行会话；实际模型与浏览器执行由事件流继续跟踪。 */
export async function startDebugRun(
    request: RunDebugRequest,
    signal: AbortSignal
): Promise<DebugRunSession> {
    const response = await fetch('/api/debug/runs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(toRequestBody(request)),
        signal
    });
    return readSessionResponse(response);
}

/** 获取异步运行的当前快照，用于断线恢复与 SSE 不可用时的轮询。 */
export async function getDebugRunSession(
    sessionId: string,
    signal?: AbortSignal
): Promise<DebugRunSession> {
    const response = await fetch(
        `/api/debug/runs/${ encodeURIComponent(sessionId) }`,
        { signal }
    );
    return readSessionResponse(response);
}

/** 请求服务端终止模型调用、浏览器操作和后续回放。 */
export async function cancelDebugRunSession(
    sessionId: string
): Promise<DebugRunSession> {
    const response = await fetch(
        `/api/debug/runs/${ encodeURIComponent(sessionId) }`,
        { method: 'DELETE' }
    );
    return readSessionResponse(response);
}

/**
 * 订阅运行事件。正常浏览器使用 SSE；无 EventSource 或连接失败时自动轮询，
 * 返回的清理函数只关闭前端订阅，不会暗中终止服务端运行。
 */
export function subscribeDebugRunSession(
    sessionId: string,
    callbacks: DebugRunSubscriptionCallbacks
): () => void {
    let closed = false;
    let pollingTimer: number | undefined;
    let source: EventSource | undefined;
    const close = () => {
        closed = true;
        source?.close();
        if (pollingTimer !== undefined) {
            window.clearTimeout(pollingTimer);
        }
    };
    const poll = async (): Promise<void> => {
        try {
            const session = await getDebugRunSession(sessionId);
            if (closed) {
                return;
            }
            callbacks.onUpdate({ kind: 'session', session });
            if (isTerminalSessionStatus(session.status)) {
                close();
                return;
            }
            pollingTimer = window.setTimeout(() => {
                poll().catch(() => undefined);
            }, 750);
        } catch (error) {
            if (!closed) {
                callbacks.onError(toError(error));
            }
        }
    };

    if (typeof EventSource === 'undefined') {
        poll().catch(() => undefined);
        return close;
    }

    source = new EventSource(
        `/api/debug/runs/${ encodeURIComponent(sessionId) }/events`
    );
    source.onmessage = (message) => {
        try {
            const update = parseSessionUpdate(JSON.parse(message.data));
            callbacks.onUpdate(update);
            if (
                update.kind === 'session'
                && isTerminalSessionStatus(update.session.status)
            ) {
                close();
            }
        } catch (error) {
            callbacks.onError(toError(error));
        }
    };
    source.onerror = () => {
        source?.close();
        source = undefined;
        if (!closed) {
            poll().catch(() => undefined);
        }
    };
    return close;
}

/** 将受控产物引用转换成同源截图地址。 */
export function getDebugScreenshotUrl(ref: string): string {
    return `/api/debug/artifact?ref=${ encodeURIComponent(ref) }`;
}

/** 响应体不是 JSON 时提供稳定错误，不向页面抛出解析细节。 */
async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json() as unknown;
    } catch {
        throw new RunDebugRequestError(
            `调试接口没有返回 JSON（HTTP ${ response.status }）。`,
            response.status
        );
    }
}

function getErrorMessage(value: unknown): string | undefined {
    const object = getObject(value);
    return typeof object?.error === 'string'
        ? object.error
        : undefined;
}

function toRequestBody(request: RunDebugRequest): Record<string, unknown> {
    return {
        action: request.action,
        mode: request.mode,
        startUrl: request.startUrl,
        testId: request.testId,
        testName: request.testName,
        ...request.mode === 'structured-replay'
            ? { planRef: request.planRef }
            : {}
    };
}

async function readSessionResponse(
    response: Response
): Promise<DebugRunSession> {
    const value = await readJson(response);
    if (!response.ok) {
        throw new RunDebugRequestError(
            getErrorMessage(value) ?? `调试请求失败（HTTP ${ response.status }）`,
            response.status
        );
    }
    const session = getObject(value)?.session;
    if (!isDebugRunSession(session)) {
        throw new RunDebugRequestError('调试接口返回了无法识别的运行会话。');
    }
    return session;
}

function parseSessionUpdate(value: unknown): DebugRunSessionUpdate {
    const object = getObject(value);
    if (object?.kind === 'run-event' && isDebugRunEvent(object.event)) {
        return {
            kind: 'run-event',
            event: object.event
        };
    }
    if (object?.kind === 'session' && isDebugRunSession(object.session)) {
        return {
            kind: 'session',
            session: object.session
        };
    }
    throw new RunDebugRequestError('运行事件流返回了无法识别的数据。');
}

function isDebugRunSession(value: unknown): value is DebugRunSession {
    const object = getObject(value);
    return typeof object?.schemaVersion === 'number'
        && typeof object.sessionId === 'string'
        && typeof object.status === 'string'
        && typeof object.createdAt === 'string'
        && typeof object.updatedAt === 'string'
        && Array.isArray(object.events)
        && object.events.every(isDebugRunEvent)
        && (object.result === undefined || isDebugRunResult(object.result));
}

function isDebugRunEvent(value: unknown): value is DebugRunEvent {
    const object = getObject(value);
    return typeof object?.schemaVersion === 'number'
        && typeof object.eventId === 'string'
        && typeof object.runId === 'string'
        && typeof object.type === 'string'
        && typeof object.sequence === 'number'
        && typeof object.timestamp === 'string'
        && getObject(object.payload) !== undefined;
}

function isTerminalSessionStatus(status: DebugRunSessionStatus): boolean {
    return status === 'CANCELLED'
        || status === 'COMPLETED'
        || status === 'CRASHED';
}

function toError(error: unknown): Error {
    return error instanceof Error
        ? error
        : new RunDebugRequestError('运行事件流发生未知错误。');
}

function isDebugRunResult(value: unknown): value is DebugRunResult {
    const object = getObject(value);
    const metrics = getObject(object?.metrics);
    return typeof object?.runId === 'string'
        && typeof object.lifecycle === 'string'
        && typeof object.summary === 'string'
        && Array.isArray(object.evidence)
        && typeof object.traceRef === 'string'
        && typeof metrics?.actionCount === 'number'
        && typeof metrics.durationMs === 'number'
        && typeof metrics.modelCallCount === 'number';
}

function getObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
