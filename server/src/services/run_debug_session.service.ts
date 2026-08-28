import { randomUUID } from 'node:crypto';
import type {
    RunEvent,
    RunEventPublisher,
    RunMode,
    RunResult,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import {
    LocalRunSessionHistoryStore,
    type RunSessionHistoryStore,
} from '../adapters/storage/local_run_session_history_store';
import { LoggingRunEventPublisher } from '../adapters/events';
import { config } from '../config';
import {
    RunDebugService,
    type RunDebugOptions,
} from './run_debug.service';

export type RunDebugSessionStatus =
    | 'CANCELLED'
    | 'CANCELLING'
    | 'COMPLETED'
    | 'CRASHED'
    | 'RUNNING';

export interface RunDebugSessionSnapshot {
    schemaVersion: 1;
    sessionId: string;
    status: RunDebugSessionStatus;
    createdAt: string;
    updatedAt: string;
    events: RunEvent[];
    error?: string;
    mode?: RunMode;
    result?: RunResult;
    runId?: string;
}

export type RunDebugSessionUpdate =
    | {
        kind: 'run-event',
        event: RunEvent
    }
    | {
        kind: 'session',
        session: RunDebugSessionSnapshot
    };

interface RunDebugSessionRecord extends RunDebugSessionSnapshot {
    abortController: AbortController;
    listeners: Set<(update: RunDebugSessionUpdate) => void>;
    persistence: Promise<void>;
    testId?: string;
}

/** 表示指定的异步运行会话不存在。 */
export class RunDebugSessionNotFoundError extends Error {
    constructor(sessionId: string) {
        super(`没有找到运行会话：${ sessionId }。`);
        this.name = 'RunDebugSessionNotFoundError';
    }
}

/** 在内存中管理当前本地编辑器启动的异步调试运行。 */
@service()
export class RunDebugSessionService {
    private readonly sessions = new Map<string, RunDebugSessionRecord>();

    constructor(
        private readonly runner: Pick<RunDebugService, 'run'> =
            new RunDebugService(),
        private readonly history: RunSessionHistoryStore =
            new LocalRunSessionHistoryStore(config.storage.artifact_root)
    ) {}

    /** 立即创建会话，实际模型与浏览器工作在后续微任务中执行。 */
    public start(
        action: string,
        options: RunDebugOptions
    ): RunDebugSessionSnapshot {
        const now = new Date().toISOString();
        const record: RunDebugSessionRecord = {
            schemaVersion: 1,
            sessionId: randomUUID(),
            status: 'RUNNING',
            createdAt: now,
            updatedAt: now,
            events: [],
            abortController: new AbortController(),
            listeners: new Set(),
            persistence: Promise.resolve(),
            ...typeof options.testId === 'string'
                ? { testId: options.testId }
                : {},
            mode: options.mode === 'structured-replay'
                ? 'structured-replay'
                : 'ai-explore'
        };
        this.sessions.set(record.sessionId, record);
        this.pruneTerminalSessions();
        queueMicrotask(() => {
            this.execute(record, action, options).catch(() => undefined);
        });
        return this.toSnapshot(record);
    }

    /** 返回同一用例当前会话，或从磁盘恢复最近一次终态运行。 */
    public async latest(testId: string): Promise<
        RunDebugSessionSnapshot | undefined
    > {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(testId)) {
            throw new RunDebugSessionNotFoundError(testId);
        }
        const inMemory = [...this.sessions.values()]
            .filter((record) => record.testId === testId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .at(0);
        return inMemory
            ? this.toSnapshot(inMemory)
            : await this.history.loadLatest(testId);
    }

    /** 返回当前状态和已累积事件，供断线重连或最终状态读取。 */
    public get(sessionId: string): RunDebugSessionSnapshot {
        return this.toSnapshot(this.requireSession(sessionId));
    }

    /** 主动请求终止运行；终态会由执行协程在浏览器清理后写回。 */
    public cancel(sessionId: string): RunDebugSessionSnapshot {
        const record = this.requireSession(sessionId);
        if (isTerminalStatus(record.status)) {
            return this.toSnapshot(record);
        }
        record.status = 'CANCELLING';
        record.updatedAt = new Date().toISOString();
        record.abortController.abort();
        this.emit(record, {
            kind: 'session',
            session: this.toSnapshot(record)
        });
        this.queuePersistence(record).catch(() => undefined);
        return this.toSnapshot(record);
    }

    /** 订阅新增核心事件和会话终态；返回函数用于关闭连接时解绑。 */
    public subscribe(
        sessionId: string,
        listener: (update: RunDebugSessionUpdate) => void
    ): () => void {
        const record = this.requireSession(sessionId);
        record.listeners.add(listener);
        return () => record.listeners.delete(listener);
    }

    private async execute(
        record: RunDebugSessionRecord,
        action: string,
        options: RunDebugOptions
    ): Promise<void> {
        const publisher = new SessionRunEventPublisher(async (event) => {
            record.runId = event.runId;
            record.events.push(event);
            record.updatedAt = event.timestamp;
            this.emit(record, {
                kind: 'run-event',
                event
            });
            await this.queuePersistence(record);
        });
        try {
            const result = await this.runner.run(
                action,
                record.abortController.signal,
                options,
                publisher
            );
            record.result = result;
            record.runId = result.runId;
            record.status = result.lifecycle === 'CANCELLED'
                ? 'CANCELLED'
                : result.lifecycle === 'COMPLETED'
                    ? 'COMPLETED'
                    : 'CRASHED';
        } catch (error) {
            record.status = record.abortController.signal.aborted
                ? 'CANCELLED'
                : 'CRASHED';
            record.error = record.abortController.signal.aborted
                ? '运行已由用户终止。'
                : error instanceof Error
                    ? error.message
                    : '运行发生未知异常。';
        }
        record.updatedAt = new Date().toISOString();
        this.emit(record, {
            kind: 'session',
            session: this.toSnapshot(record)
        });
        await this.queuePersistence(record);
    }

    private requireSession(sessionId: string): RunDebugSessionRecord {
        if (!/^[a-f0-9-]{36}$/u.test(sessionId)) {
            throw new RunDebugSessionNotFoundError(sessionId);
        }
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new RunDebugSessionNotFoundError(sessionId);
        }
        return record;
    }

    private toSnapshot(
        record: RunDebugSessionRecord
    ): RunDebugSessionSnapshot {
        return {
            schemaVersion: 1,
            sessionId: record.sessionId,
            status: record.status,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            events: [...record.events],
            ...record.mode ? { mode: record.mode } : {},
            ...record.runId ? { runId: record.runId } : {},
            ...record.result ? { result: record.result } : {},
            ...record.error ? { error: record.error } : {}
        };
    }

    private queuePersistence(record: RunDebugSessionRecord): Promise<void> {
        if (!record.runId || !record.testId) {
            return record.persistence;
        }
        const snapshot = this.toSnapshot(record);
        record.persistence = record.persistence
            .then(() => this.history.save(record.testId as string, snapshot))
            .catch(() => undefined);
        return record.persistence;
    }

    private emit(
        record: RunDebugSessionRecord,
        update: RunDebugSessionUpdate
    ): void {
        for (const listener of record.listeners) {
            listener(update);
        }
    }

    /** 只保留最近五十个终态会话，避免长时间运行本地服务持续占用内存。 */
    private pruneTerminalSessions(): void {
        const terminalRecords = [...this.sessions.values()]
            .filter((record) => isTerminalStatus(record.status))
            .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
        for (const record of terminalRecords.slice(0, -50)) {
            this.sessions.delete(record.sessionId);
        }
    }
}

class SessionRunEventPublisher implements RunEventPublisher {
    private readonly logger = new LoggingRunEventPublisher();

    constructor(
        private readonly capture: (event: RunEvent) => Promise<void>
    ) {}

    public publish = async (event: RunEvent): Promise<void> => {
        await this.capture(event);
        await this.logger.publish(event);
    };
}

function isTerminalStatus(status: RunDebugSessionStatus): boolean {
    return status === 'CANCELLED'
        || status === 'COMPLETED'
        || status === 'CRASHED';
}
