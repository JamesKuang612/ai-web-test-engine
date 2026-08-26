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
