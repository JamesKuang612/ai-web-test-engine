import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
    RunResult,
    RunSnapshot,
    TraceEvent,
} from '@ai-web-test-engine/core';
import {
    LocalArtifactStore,
} from '../../../../src/adapters/storage/local_artifact_store';

const snapshot: RunSnapshot = {
    schemaVersion: 1,
    runId: 'run-001',
    testId: 'login-jiandaoyun',
    lifecycle: 'QUEUED',
    createdAt: '2026-08-19T08:00:00.000Z',
    updatedAt: '2026-08-19T08:00:00.000Z',
    summary: '等待开始执行',
    metadata: {}
};

const traceEvent: TraceEvent = {
    schemaVersion: 1,
    runId: snapshot.runId,
    sequence: 1,
    command: {
        type: 'CLICK',
        target: {
            candidateId: 'candidate-001',
            description: '登录按钮'
        },
        expectedEffect: '登录表单被提交',
        reasonSummary: '账号和密码已经填写',
        risk: 'side-effect'
    },
    beforeObservationRef: 'observation-001',
    artifacts: []
};

const result: RunResult = {
    schemaVersion: 1,
    runId: snapshot.runId,
    lifecycle: 'COMPLETED',
    result: 'PASS',
    summary: '成功进入简道云工作台',
    evidence: [],
    traceRef: `${ snapshot.runId }/trace.jsonl`,
    metrics: {
        actionCount: 1,
        durationMs: 1000,
        modelCallCount: 1,
        repeatedStateActionCount: 0
    }
};

describe('LocalArtifactStore', () => {
    let temporaryDirectory = '';
    let store: LocalArtifactStore;

    beforeEach(async () => {
        temporaryDirectory = await fs.mkdtemp(path.join(
            os.tmpdir(),
            'ai-web-test-engine-'
        ));
        store = new LocalArtifactStore(path.join(
            temporaryDirectory,
            'runs'
        ));
    });

    afterEach(async () => {
        await fs.rm(temporaryDirectory, {
            force: true,
            recursive: true
        });
    });

    it('创建独立运行目录并写入 run.json', async () => {
        await store.createRun(snapshot);

        const savedSnapshot = await readJson('run.json');
        assert.deepEqual(savedSnapshot, snapshot);
    });

    it('拒绝非法 runId 和重复运行目录', async () => {
        await assert.rejects(
            store.createRun({
                ...snapshot,
                runId: '../escape'
            }),
            /非法的 Run ID/u
        );

        await store.createRun(snapshot);
        await assert.rejects(
            store.createRun(snapshot),
            hasErrorCode('EEXIST')
        );
    });

    it('使用原子替换更新已有 run.json', async () => {
        await store.createRun(snapshot);
        const updatedSnapshot: RunSnapshot = {
            ...snapshot,
            lifecycle: 'OBSERVING',
            summary: '正在观察登录页面',
            updatedAt: '2026-08-19T08:00:01.000Z'
        };

        await store.updateRun(updatedSnapshot);

        assert.deepEqual(await readJson('run.json'), updatedSnapshot);
        assert.deepEqual(await readRunDirectory(), ['run.json']);
    });

    it('按 JSONL 格式依次追加 TraceEvent', async () => {
        await store.createRun(snapshot);

        await store.appendTrace(snapshot.runId, traceEvent);
        await store.appendTrace(snapshot.runId, {
            ...traceEvent,
            sequence: 2
        });

        const content = await fs.readFile(runPath('trace.jsonl'), 'utf8');
        const events = content.trim().split('\n').map((line) =>
            JSON.parse(line) as TraceEvent
        );
        assert.deepEqual(events, [
            traceEvent,
            {
                ...traceEvent,
                sequence: 2
            }
        ]);
    });

    it('拒绝追加属于其他运行的 TraceEvent', async () => {
        await store.createRun(snapshot);

        await assert.rejects(
            store.appendTrace(snapshot.runId, {
                ...traceEvent,
                runId: 'run-002'
            }),
            /Run ID .* 不一致/u
        );
    });

    it('保存二进制证据并返回相对引用', async () => {
        await store.createRun(snapshot);

        const reference = await store.saveArtifact(snapshot.runId, {
            content: new Uint8Array([1, 2, 3]),
            kind: 'screenshot',
            mediaType: 'image/png',
            name: 'page-001.png'
        });

        assert.deepEqual(reference, {
            kind: 'screenshot',
            mediaType: 'image/png',
            ref: 'run-001/artifacts/page-001.png'
        });
        assert.deepEqual(
            await fs.readFile(runPath('artifacts', 'page-001.png')),
            Buffer.from([1, 2, 3])
        );
    });

    it('拒绝可能逃离证据目录的非法文件名', async () => {
        await store.createRun(snapshot);

        await assert.rejects(
            store.saveArtifact(snapshot.runId, {
                content: 'unsafe',
                kind: 'dom',
                mediaType: 'text/html',
                name: '../outside.html'
            }),
            /非法的文件名/u
        );
    });

    it('保存结构化 JSON 和最终运行结果', async () => {
        await store.createRun(snapshot);

        const reference = await store.saveJson(
            snapshot.runId,
            'intent',
            {
                objective: '登录简道云平台'
            }
        );
        await store.saveResult(result);

        assert.deepEqual(reference, {
            kind: 'json',
            mediaType: 'application/json',
            ref: 'run-001/json/intent.json'
        });
        assert.deepEqual(await readJson('json', 'intent.json'), {
            objective: '登录简道云平台'
        });
        assert.deepEqual(await readJson('result.json'), result);
    });

    it('通过安全相对引用读取并解析结构化 JSON', async () => {
        await store.createRun(snapshot);
        const value = {
            planId: 'plan-001'
        };
        const reference = await store.saveJson(
            snapshot.runId,
            'compiled-plan',
            value
        );

        assert.deepEqual(await store.loadJson(reference.ref), value);
    });

    it('拒绝目录穿越、绝对路径和非 JSON 产物引用', async () => {
        await store.createRun(snapshot);

        await assert.rejects(
            store.loadJson('../run-001/json/compiled-plan.json'),
            /非法的 JSON 产物引用/u
        );
        await assert.rejects(
            store.loadJson('run-001/artifacts/page.png'),
            /非法的 JSON 产物引用/u
        );
        await assert.rejects(
            store.loadJson('C:/secret.json'),
            /非法的 JSON 产物引用/u
        );
    });

    function runPath(...segments: string[]): string {
        return path.join(
            temporaryDirectory,
            'runs',
            snapshot.runId,
            ...segments
        );
    }

    async function readJson(...segments: string[]): Promise<unknown> {
        const content = await fs.readFile(runPath(...segments), 'utf8');
        return JSON.parse(content) as unknown;
    }

    async function readRunDirectory(): Promise<string[]> {
        return (await fs.readdir(runPath())).sort();
    }
});

function hasErrorCode(code: string) {
    return (error: unknown) => error instanceof Error &&
        'code' in error &&
        error.code === code;
}
