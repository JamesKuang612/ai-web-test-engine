import assert from 'node:assert/strict';
import type {
    RunEvent,
    RunEventPublisher,
    RunResult,
} from '@ai-web-test-engine/core';
import {
    RunDebugSessionService,
} from '../../../src/services/run_debug_session.service';
import type {
    RunDebugOptions,
} from '../../../src/services/run_debug.service';

const completedResult: RunResult = {
    schemaVersion: 1,
    runId: 'run-session-001',
    lifecycle: 'COMPLETED',
    result: 'PASS',
    summary: '测试通过。',
    evidence: [],
    traceRef: 'run-session-001/trace.jsonl',
    metrics: {
        actionCount: 1,
        durationMs: 50,
        modelCallCount: 1,
        repeatedStateActionCount: 0
    }
};

describe('RunDebugSessionService', () => {
    it('立即返回会话并累积实时运行事件和终态', async () => {
        const runner = new CompletingRunner();
        const service = new RunDebugSessionService(runner);
        const initial = service.start('打开页面', {});
        const updates: string[] = [];
        service.subscribe(initial.sessionId, (update) => {
            updates.push(update.kind);
        });

        const completed = await waitForTerminal(service, initial.sessionId);

        assert.equal(initial.status, 'RUNNING');
        assert.equal(completed.status, 'COMPLETED');
        assert.equal(completed.runId, completedResult.runId);
        assert.equal(completed.events.length, 1);
        assert.equal(
            completed.events[0]?.payload.screenshotRef,
            'run-session-001/artifacts/page.png'
        );
        assert.deepEqual(updates, ['run-event', 'session']);
    });

    it('主动终止会把取消信号传入正在执行的运行', async () => {
        const runner = new AbortableRunner();
        const service = new RunDebugSessionService(runner);
        const initial = service.start('等待页面', {});
        await nextTask();

        const cancelling = service.cancel(initial.sessionId);
        const cancelled = await waitForTerminal(service, initial.sessionId);

        assert.equal(cancelling.status, 'CANCELLING');
        assert.equal(cancelled.status, 'CANCELLED');
        assert.equal(cancelled.error, '运行已由用户终止。');
        assert.equal(runner.signal?.aborted, true);
    });
});

class CompletingRunner {
    public async run(
        _action: string,
        _signal: AbortSignal,
        _options: RunDebugOptions,
        publisher?: RunEventPublisher
    ): Promise<RunResult> {
        await publisher?.publish(createObservationEvent());
        return completedResult;
    }
}

class AbortableRunner {
    public signal?: AbortSignal;

    public run(
        _action: string,
        signal: AbortSignal
    ): Promise<RunResult> {
        this.signal = signal;
        return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                reject(new Error('aborted'));
            }, { once: true });
        });
    }
}

function createObservationEvent(): RunEvent {
    return {
        schemaVersion: 1,
        eventId: 'event-001',
        runId: 'run-session-001',
        type: 'observation.created',
        sequence: 1,
        timestamp: '2026-08-26T00:00:00.000Z',
        payload: {
            observationRef: 'run-session-001/json/page.json',
            screenshotRef: 'run-session-001/artifacts/page.png'
        }
    };
}

async function waitForTerminal(
    service: RunDebugSessionService,
    sessionId: string
) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = service.get(sessionId);
        if (
            snapshot.status === 'CANCELLED'
            || snapshot.status === 'COMPLETED'
            || snapshot.status === 'CRASHED'
        ) {
            return snapshot;
        }
        await nextTask();
    }
    throw new Error('等待运行会话终态超时。');
}

function nextTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
