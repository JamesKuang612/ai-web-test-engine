import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RunResult } from '@ai-web-test-engine/core';
import {
    RunDebugController,
} from '../../../src/controllers/run_debug.controller';

const runResult: RunResult = {
    schemaVersion: 1,
    runId: 'run-debug-001',
    lifecycle: 'COMPLETED',
    result: 'UNCERTAIN',
    summary: '基础执行链路已跑通；尚未执行交互动作或业务断言。',
    evidence: [],
    traceRef: 'run-debug-001/trace.jsonl',
    metrics: {
        actionCount: 1,
        durationMs: 100,
        modelCallCount: 1,
        repeatedStateActionCount: 0
    }
};

describe('RunDebugController', () => {
    it('通过真实 HTTP 请求接收 action 并返回 RunResult', async () => {
        let receivedAction = '';
        const controller = new RunDebugController({
            run: async (action) => {
                receivedAction = action;
                return runResult;
            }
        });
        const app = express();
        app.use(express.json());
        app.post('/api/debug/run', controller.run);
        const server = app.listen(0);

        try {
            await new Promise<void>((resolve) => {
                server.once('listening', resolve);
            });
            const address = server.address() as AddressInfo;
            const response = await fetch(
                `http://127.0.0.1:${ address.port }/api/debug/run`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: '打开简道云登录页'
                    })
                }
            );
            const body = await response.json() as {
                result: RunResult;
            };

            assert.equal(response.status, 200);
            assert.equal(receivedAction, '打开简道云登录页');
            assert.deepEqual(body.result, runResult);
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        }
    });
});
