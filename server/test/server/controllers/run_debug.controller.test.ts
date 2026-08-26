import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RunResult } from '@ai-web-test-engine/core';
import {
    RunDebugController,
} from '../../../src/controllers/run_debug.controller';
import type {
    RunDebugOptions,
} from '../../../src/services/run_debug.service';

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

describe('RunDebugController structured-replay', () => {
    it('把 mode 和 planRef 原样交给服务层校验', async () => {
        let receivedOptions: RunDebugOptions | undefined;
        const controller = new RunDebugController({
            run: async (_action, _signal, options) => {
                receivedOptions = options;
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
                        action: '执行登录计划',
                        mode: 'structured-replay',
                        planRef: 'source-run/json/compiled-plan.json'
                    })
                }
            );

            assert.equal(response.status, 200);
            assert.deepEqual(receivedOptions, {
                mode: 'structured-replay',
                planRef: 'source-run/json/compiled-plan.json',
                startUrl: undefined,
                testId: undefined,
                testName: undefined
            });
        } finally {
            await closeServer(server);
        }
    });
});

describe('RunDebugController generic test context', () => {
    it('把前端用例标识、名称和起始地址传给服务层', async () => {
        let receivedOptions: RunDebugOptions | undefined;
        const controller = new RunDebugController({
            run: async (_action, _signal, options) => {
                receivedOptions = options;
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
            await fetch(`http://127.0.0.1:${ address.port }/api/debug/run`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: '点击我的待办',
                    startUrl: 'https://test.jdydevelop.com/dashboard#/',
                    testId: 'my-todo',
                    testName: '验证我的待办'
                })
            });

            assert.equal(receivedOptions?.testId, 'my-todo');
            assert.equal(receivedOptions?.testName, '验证我的待办');
            assert.equal(
                receivedOptions?.startUrl,
                'https://test.jdydevelop.com/dashboard#/'
            );
        } finally {
            await closeServer(server);
        }
    });
});

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
