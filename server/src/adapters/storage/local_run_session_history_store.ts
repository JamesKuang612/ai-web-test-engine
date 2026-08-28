import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
    RunEvent,
    RunMode,
    RunResult,
} from '@ai-web-test-engine/core';
import { resolveArtifactRootDirectories } from './artifact_root';

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;
const TEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

export type StoredRunSessionStatus =
    | 'CANCELLED'
    | 'CANCELLING'
    | 'COMPLETED'
    | 'CRASHED'
    | 'RUNNING';

export interface StoredRunSessionSnapshot {
    schemaVersion: 1;
    sessionId: string;
    status: StoredRunSessionStatus;
    createdAt: string;
    updatedAt: string;
    events: RunEvent[];
    error?: string;
    mode?: RunMode;
    result?: RunResult;
    runId?: string;
}

export interface RunSessionHistoryStore {
    loadLatest: (testId: string) => Promise<StoredRunSessionSnapshot | undefined>;
    save: (
        testId: string,
        snapshot: StoredRunSessionSnapshot
    ) => Promise<void>;
}

interface RunFileSnapshot {
    runId: string;
    testId: string;
    lifecycle: string;
    createdAt: string;
    updatedAt: string;
    summary: string;
    mode?: RunMode;
}

/** 持久化运行会话，并兼容从旧版 run.json/result.json 恢复最近结果。 */
export class LocalRunSessionHistoryStore implements RunSessionHistoryStore {
    private readonly rootDirectories: string[];

    constructor(rootDirectory: string) {
        this.rootDirectories = resolveArtifactRootDirectories(rootDirectory);
    }

    public async save(
        testId: string,
        snapshot: StoredRunSessionSnapshot
    ): Promise<void> {
        requireTestId(testId);
        if (!snapshot.runId || !RUN_ID_PATTERN.test(snapshot.runId)) {
            throw new Error('持久化运行会话缺少合法 runId。');
        }
        const runDirectory = await this.requireRunDirectory(snapshot.runId);
        await writeJsonAtomically(path.join(runDirectory, 'session.json'), {
            schemaVersion: 1,
            testId,
            session: snapshot
        });
    }

    public async loadLatest(
        testId: string
    ): Promise<StoredRunSessionSnapshot | undefined> {
        requireTestId(testId);
        const candidates = await this.findRunCandidates(testId);
        for (const candidate of candidates) {
            const stored = parseStoredSessionFile(
                await readJson(path.join(candidate.directory, 'session.json'))
            );
            if (stored?.testId === testId && isTerminal(stored.session.status)) {
                return stored.session;
            }
            const result = parseRunResult(
                await readJson(path.join(candidate.directory, 'result.json'))
            );
            if (result) {
                return synthesizeSession(candidate.snapshot, result);
            }
        }
        return undefined;
    }

    private async findRunCandidates(testId: string): Promise<Array<{
        directory: string,
        snapshot: RunFileSnapshot
    }>> {
        const byRunId = new Map<string, {
            directory: string,
            snapshot: RunFileSnapshot
        }>();
        for (const rootDirectory of this.rootDirectories) {
            let names: string[];
            try {
                names = await fs.readdir(rootDirectory);
            } catch {
                continue;
            }
            for (const name of names) {
                if (!RUN_ID_PATTERN.test(name) || byRunId.has(name)) {
                    continue;
                }
                const directory = path.join(rootDirectory, name);
                const snapshot = parseRunFileSnapshot(
                    await readJson(path.join(directory, 'run.json'))
                );
                if (snapshot?.testId === testId) {
                    byRunId.set(name, { directory, snapshot });
                }
            }
        }
        return [...byRunId.values()].sort((left, right) =>
            right.snapshot.updatedAt.localeCompare(left.snapshot.updatedAt)
        );
    }

    private async requireRunDirectory(runId: string): Promise<string> {
        for (const rootDirectory of this.rootDirectories) {
            const directory = path.join(rootDirectory, runId);
            try {
                await fs.access(path.join(directory, 'run.json'));
                return directory;
            } catch {
                // 继续检查兼容产物根目录。
            }
        }
        throw new Error(`运行产物不存在：${ runId }。`);
    }
}

function synthesizeSession(
    snapshot: RunFileSnapshot,
    result: RunResult
): StoredRunSessionSnapshot {
    let sequence = 0;
    const nextEvent = (
        type: RunEvent['type'],
        payload: RunEvent['payload']
    ): RunEvent => {
        sequence += 1;
        return {
            schemaVersion: 1,
            eventId: `${ snapshot.runId }-history-${ sequence }`,
            runId: snapshot.runId,
            type,
            sequence,
            timestamp: snapshot.updatedAt,
            payload
        };
    };
    const events: RunEvent[] = [nextEvent('run.created', {
        testId: snapshot.testId,
        summary: '已恢复历史运行'
    })];
    let previousJsonRef = '';
    for (const evidence of result.evidence) {
        if (evidence.kind === 'json') {
            previousJsonRef = evidence.ref;
            continue;
        }
        if (evidence.kind === 'screenshot') {
            events.push(nextEvent('observation.created', {
                screenshotRef: evidence.ref,
                ...previousJsonRef ? { observationRef: previousJsonRef } : {},
                summary: '历史运行页面截图'
            }));
        }
    }
    events.push(nextEvent(
        result.lifecycle === 'COMPLETED'
            ? 'run.completed'
            : result.lifecycle === 'CANCELLED'
                ? 'run.cancelled'
                : 'run.crashed',
        {
            summary: result.summary,
            ...result.result ? { status: result.result } : {}
        }
    ));
    return {
        schemaVersion: 1,
        sessionId: snapshot.runId,
        status: result.lifecycle,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        events,
        mode: snapshot.mode,
        result,
        runId: snapshot.runId
    };
}

function parseRunFileSnapshot(value: unknown): RunFileSnapshot | undefined {
    const object = getObject(value);
    const metadata = getObject(object?.metadata);
    if (
        typeof object?.runId !== 'string'
        || typeof object.testId !== 'string'
        || typeof object.lifecycle !== 'string'
        || typeof object.createdAt !== 'string'
        || typeof object.updatedAt !== 'string'
        || typeof object.summary !== 'string'
    ) {
        return undefined;
    }
    const mode = metadata?.mode === 'ai-explore'
        || metadata?.mode === 'structured-replay'
        || metadata?.mode === 'auto'
        ? metadata.mode
        : undefined;
    return {
        runId: object.runId,
        testId: object.testId,
        lifecycle: object.lifecycle,
        createdAt: object.createdAt,
        updatedAt: object.updatedAt,
        summary: object.summary,
        ...mode ? { mode } : {}
    };
}

function parseStoredSessionFile(value: unknown): {
    testId: string,
    session: StoredRunSessionSnapshot
} | undefined {
    const object = getObject(value);
    const session = getObject(object?.session);
    if (
        object?.schemaVersion !== 1
        || typeof object.testId !== 'string'
        || !session
        || session.schemaVersion !== 1
        || typeof session.sessionId !== 'string'
        || typeof session.status !== 'string'
        || typeof session.createdAt !== 'string'
        || typeof session.updatedAt !== 'string'
        || !Array.isArray(session.events)
        || !session.events.every(isRunEvent)
    ) {
        return undefined;
    }
    const result = session.result === undefined
        ? undefined
        : parseRunResult(session.result);
    if (session.result !== undefined && !result) {
        return undefined;
    }
    return {
        testId: object.testId,
        session: session as unknown as StoredRunSessionSnapshot
    };
}

function parseRunResult(value: unknown): RunResult | undefined {
    const object = getObject(value);
    const metrics = getObject(object?.metrics);
    if (
        object?.schemaVersion !== 1
        || typeof object.runId !== 'string'
        || object.lifecycle !== 'CANCELLED'
            && object.lifecycle !== 'COMPLETED'
            && object.lifecycle !== 'CRASHED'
        || typeof object.summary !== 'string'
        || !Array.isArray(object.evidence)
        || typeof object.traceRef !== 'string'
        || typeof metrics?.actionCount !== 'number'
        || typeof metrics.durationMs !== 'number'
        || typeof metrics.modelCallCount !== 'number'
        || typeof metrics.repeatedStateActionCount !== 'number'
    ) {
        return undefined;
    }
    return object as unknown as RunResult;
}

function isRunEvent(value: unknown): value is RunEvent {
    const object = getObject(value);
    return object?.schemaVersion === 1
        && typeof object.eventId === 'string'
        && typeof object.runId === 'string'
        && typeof object.type === 'string'
        && typeof object.sequence === 'number'
        && typeof object.timestamp === 'string'
        && getObject(object.payload) !== undefined;
}

function isTerminal(status: StoredRunSessionStatus): boolean {
    return status === 'CANCELLED'
        || status === 'COMPLETED'
        || status === 'CRASHED';
}

function requireTestId(testId: string): void {
    if (!TEST_ID_PATTERN.test(testId)) {
        throw new Error('测试用例 id 不合法。');
    }
}

async function readJson(filePath: string): Promise<unknown> {
    try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile() || stats.size > MAX_JSON_BYTES) {
            return undefined;
        }
        return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    } catch {
        return undefined;
    }
}

async function writeJsonAtomically(
    filePath: string,
    value: unknown
): Promise<void> {
    const temporary = path.join(
        path.dirname(filePath),
        `.${ path.basename(filePath) }.${ randomUUID() }.tmp`
    );
    try {
        await fs.writeFile(temporary, `${ JSON.stringify(value, null, 4) }\n`, {
            encoding: 'utf8',
            flag: 'wx'
        });
        await fs.rename(temporary, filePath);
    } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
    }
}

function getObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
