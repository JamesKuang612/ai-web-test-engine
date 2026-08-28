import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type {
    TestDefinition,
} from '@ai-web-test-engine/core';
import {
    TestDefinitionController,
} from '../../../src/controllers/test_definition.controller';

const definition: TestDefinition = {
    schemaVersion: 1,
    id: 'my-todo',
    name: '验证我的待办',
    environmentId: 'jiandaoyun-test',
    startUrl: 'https://test.jdydevelop.com/dashboard#/',
    action: '点击“我的待办”。'
};

describe('TestDefinitionController', () => {
    it('通过 HTTP 创建并列出项目用例', async () => {
        let deletedId = '';
        const controller = new TestDefinitionController({
            create: async () => ({
                definition,
                fileName: '验证我的待办.test.yaml',
                updatedAt: '2026-08-26T00:00:00.000Z'
            }),
            delete: async (id) => {
                deletedId = id;
            },
            getRecord: async () => ({
                definition,
                fileName: '验证我的待办.test.yaml',
                updatedAt: '2026-08-26T00:00:00.000Z'
            }),
            list: async () => [{
                definition,
                fileName: '验证我的待办.test.yaml',
                updatedAt: '2026-08-26T00:00:00.000Z'
            }],
            update: async () => ({
                definition,
                fileName: '验证我的待办.test.yaml',
                updatedAt: '2026-08-26T00:00:00.000Z'
            })
        });
        const app = express();
        app.use(express.json());
        app.get('/api/tests', controller.list);
        app.post('/api/tests', controller.create);
        app.delete('/api/tests/:testId', controller.delete);
        const server = app.listen(0);

        try {
            await new Promise<void>((resolve) => {
                server.once('listening', resolve);
            });
            const address = server.address() as AddressInfo;
            const baseUrl = `http://127.0.0.1:${ address.port }`;
            const listResponse = await fetch(`${ baseUrl }/api/tests`);
            const createResponse = await fetch(`${ baseUrl }/api/tests`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: definition.name,
                    startUrl: definition.startUrl,
                    action: definition.action
                })
            });
            const deleteResponse = await fetch(
                `${ baseUrl }/api/tests/my-todo`,
                { method: 'DELETE' }
            );

            assert.equal(listResponse.status, 200);
            assert.equal(createResponse.status, 201);
            assert.equal(deleteResponse.status, 204);
            assert.equal(deletedId, 'my-todo');
            assert.deepEqual(
                (await listResponse.json() as {
                    tests: Array<{ definition: TestDefinition }>
                }).tests[0].definition,
                definition
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
