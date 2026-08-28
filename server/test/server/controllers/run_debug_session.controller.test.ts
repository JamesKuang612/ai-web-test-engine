import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type {
    RunEventPublisher,
    RunResult,
} from '@ai-web-test-engine/core';
import express from 'express';
import {
    RunDebugSessionController,
} from '../../../src/controllers/run_debug_session.controller';
import {
    RunDebugSessionService,
} from '../../../src/services/run_debug_session.service';
import type {
    RunDebugOptions,
} from '../../../src/services/run_debug.service';

describe('RunDebugSessionController', () => {
    it('通过 SSE 返回运行时间线并开放截图预览', async () => {
        const sessions = new RunDebugSessionService(new CompletingRunner());
        const controller = new RunDebugSessionController(sessions, {
            readScreenshot: () => Promise.resolve(
                Buffer.from([137, 80, 78, 71])
            )
        });
        const app = express();
        app.use(express.json());
        app.post('/api/debug/runs', controller.start);
        app.get('/api/debug/tests/:testId/latest-run', controller.latest);
        app.get('/api/debug/runs/:sessionId/events', controller.events);
        app.get('/api/debug/runs/:sessionId', controller.status);
        app.get('/api/debug/artifact', controller.screenshot);
        const server = app.listen(0);

        try {
            await new Promise<void>((resolve) => {
                server.once('listening', resolve);
            });
            const origin = createOrigin(server.address() as AddressInfo);
            const startResponse = await fetch(`${ origin }/api/debug/runs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: '打开页面',
                    testId: 'saved-test'
                })
            });
            const startBody = await startResponse.json() as {
                session: { sessionId: string }
            };
            const eventResponse = await fetch(
                `${ origin }/api/debug/runs/${
                    startBody.session.sessionId
                }/events`
            );
            const eventStream = await eventResponse.text();
            const statusResponse = await fetch(
                `${ origin }/api/debug/runs/${ startBody.session.sessionId }`
            );
            const statusBody = await statusResponse.json() as {
                session: { status: string }
            };
            const latestResponse = await fetch(
                `${ origin }/api/debug/tests/saved-test/latest-run`
            );
            const latestBody = await latestResponse.json() as {
                session: { result?: { result?: string } }
            };
            const screenshotResponse = await fetch(
                `${ origin }/api/debug/artifact?ref=${
                    encodeURIComponent('run-http-001/artifacts/page.png')
                }`
            );

            assert.equal(startResponse.status, 202);
            assert.equal(eventResponse.status, 200);
            assert.match(eventStream, /"kind":"run-event"/u);
            assert.match(eventStream, /run-http-001\/artifacts\/page\.png/u);
            assert.match(eventStream, /"status":"COMPLETED"/u);
            assert.equal(statusBody.session.status, 'COMPLETED');
            assert.equal(latestBody.session.result?.result, 'PASS');
            assert.equal(screenshotResponse.headers.get('content-type'), 'image/png');
            assert.deepEqual(
                [...new Uint8Array(await screenshotResponse.arrayBuffer())],
                [137, 80, 78, 71]
            );
        } finally {
            await closeServer(server);
        }
    });
});

class CompletingRunner {
    public async run(
        _action: string,
        _signal: AbortSignal,
        _options: RunDebugOptions,
        publisher?: RunEventPublisher
    ): Promise<RunResult> {
        await publisher?.publish({
            schemaVersion: 1,
            eventId: 'event-http-001',
            runId: 'run-http-001',
            type: 'observation.created',
            sequence: 1,
            timestamp: '2026-08-26T00:00:00.000Z',
            payload: {
                screenshotRef: 'run-http-001/artifacts/page.png'
            }
        });
        return {
            schemaVersion: 1,
            runId: 'run-http-001',
            lifecycle: 'COMPLETED',
            result: 'PASS',
            summary: '测试通过。',
            evidence: [],
            traceRef: 'run-http-001/trace.jsonl',
            metrics: {
                actionCount: 1,
                durationMs: 50,
                modelCallCount: 1,
                repeatedStateActionCount: 0
            }
        };
    }
}

function createOrigin(address: AddressInfo): string {
    return `http://127.0.0.1:${ address.port }`;
}

function closeServer(server: ReturnType<typeof express.application.listen>) {
    return new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
