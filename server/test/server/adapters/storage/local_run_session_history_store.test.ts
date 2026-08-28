import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
    RunEvent,
    RunResult,
} from '@ai-web-test-engine/core';
import {
    LocalRunSessionHistoryStore,
} from '../../../../src/adapters/storage/local_run_session_history_store';

describe('LocalRunSessionHistoryStore', () => {
    let temporaryDirectory = '';
    let runDirectory = '';
    let store: LocalRunSessionHistoryStore;

    beforeEach(async () => {
        temporaryDirectory = await fs.mkdtemp(path.join(
            os.tmpdir(),
            'ai-web-run-history-'
        ));
        runDirectory = path.join(temporaryDirectory, 'run-history-001');
        await fs.mkdir(runDirectory);
        await fs.writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({
            schemaVersion: 1,
            runId: 'run-history-001',
            testId: 'my-test',
            lifecycle: 'COMPLETED',
            createdAt: '2026-08-28T00:00:00.000Z',
            updatedAt: '2026-08-28T00:01:00.000Z',
            summary: '测试通过。',
            metadata: { mode: 'ai-explore' }
        }));
        store = new LocalRunSessionHistoryStore(temporaryDirectory);
    });

    afterEach(async () => {
        await fs.rm(temporaryDirectory, { force: true, recursive: true });
    });

    it('从旧版结果和截图证据重建最近运行', async () => {
        await fs.writeFile(
            path.join(runDirectory, 'result.json'),
            JSON.stringify(createResult())
        );

        const session = await store.loadLatest('my-test');

        assert.equal(session?.status, 'COMPLETED');
        assert.equal(session?.mode, 'ai-explore');
        assert.equal(session?.result?.result, 'PASS');
        assert.equal(
            session?.events.some((event) =>
                event.payload.screenshotRef ===
                'run-history-001/artifacts/final.png'
            ),
            true
        );
    });

    it('保存并优先恢复完整事件会话', async () => {
        const event: RunEvent = {
            schemaVersion: 1,
            eventId: 'event-history-001',
            runId: 'run-history-001',
            type: 'observation.created',
            sequence: 1,
            timestamp: '2026-08-28T00:00:30.000Z',
            payload: { summary: '真实历史事件' }
        };
        await store.save('my-test', {
            schemaVersion: 1,
            sessionId: 'session-history-001',
            status: 'COMPLETED',
            createdAt: '2026-08-28T00:00:00.000Z',
            updatedAt: '2026-08-28T00:01:00.000Z',
            events: [event],
            mode: 'ai-explore',
            result: createResult(),
            runId: 'run-history-001'
        });

        const session = await store.loadLatest('my-test');

        assert.equal(session?.sessionId, 'session-history-001');
        assert.deepEqual(session?.events, [event]);
    });
});

function createResult(): RunResult {
    return {
        schemaVersion: 1,
        runId: 'run-history-001',
        lifecycle: 'COMPLETED',
        result: 'PASS',
        summary: '测试通过。',
        evidence: [{
            kind: 'screenshot',
            mediaType: 'image/png',
            ref: 'run-history-001/artifacts/final.png'
        }],
        traceRef: 'run-history-001/trace.jsonl',
        metrics: {
            actionCount: 1,
            durationMs: 60_000,
            modelCallCount: 2,
            repeatedStateActionCount: 0
        }
    };
}
