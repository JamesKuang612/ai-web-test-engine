import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { TestIntent } from '@ai-web-test-engine/core';
import {
    IntentPreviewController,
} from '../../../src/controllers/intent_preview.controller';
import {
    CodexAppServerError,
} from '../../../src/adapters/model';

const testIntent: TestIntent = {
    schemaVersion: 1,
    objective: '登录简道云并进入工作台',
    preconditions: [],
    successCriteria: [],
    failureCriteria: [],
    constraints: [],
    allowedHosts: [
        'test.jdydevelop.com'
    ],
    dataPolicy: {
        generatedValues: {}
    }
};

describe('IntentPreviewController', () => {
    it('通过真实 HTTP 请求接收 action 并返回 TestIntent', async () => {
        let receivedAction = '';
        const controller = new IntentPreviewController({
            preview: async (action) => {
                receivedAction = action;
                return testIntent;
            }
        });
        const app = express();
        app.use(express.json());
        app.post('/api/debug/intent-preview', controller.preview);
        const server = app.listen(0);

        try {
            await new Promise<void>((resolve) => {
                server.once('listening', resolve);
            });
            const address = server.address() as AddressInfo;
            const response = await fetch(
                `http://127.0.0.1:${ address.port }` +
                    '/api/debug/intent-preview',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: '帮我登录'
                    })
                }
            );
            const body = await response.json() as {
                intent: TestIntent;
            };

            assert.equal(response.status, 200);
            assert.equal(receivedAction, '帮我登录');
            assert.deepEqual(body.intent, testIntent);
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

    it('本机没有 Codex CLI 时返回可诊断的 503', async () => {
        const controller = new IntentPreviewController({
            preview: async () => {
                throw new CodexAppServerError(
                    'CLI_NOT_FOUND',
                    '没有找到 Codex CLI。'
                );
            }
        });
        const app = express();
        app.use(express.json());
        app.post('/api/debug/intent-preview', controller.preview);
        const server = app.listen(0);

        try {
            await new Promise<void>((resolve) => {
                server.once('listening', resolve);
            });
            const address = server.address() as AddressInfo;
            const response = await fetch(
                `http://127.0.0.1:${ address.port }` +
                    '/api/debug/intent-preview',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: '帮我登录'
                    })
                }
            );
            const body = await response.json() as {
                code: string;
            };

            assert.equal(response.status, 503);
            assert.equal(body.code, 'CLI_NOT_FOUND');
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
