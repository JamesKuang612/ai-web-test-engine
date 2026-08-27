import assert from 'node:assert/strict';
import type { ArtifactStore, JsonValue } from '@ai-web-test-engine/core';
import {
    PlanGenerationService,
} from '../../../src/services/plan_generation.service';

describe('PlanGenerationService', () => {
    it('从成功探索轨迹生成并保存结构化计划', async () => {
        const store = new FakeArtifactStore(createSource());
        const service = new PlanGenerationService(store);

        const result = await service.generate('run-001');

        assert.equal(result.status, 'SUCCEEDED');
        assert.equal(result.compiledPlanRef, 'run-001/json/compiled-plan.json');
        assert.deepEqual(store.saved.map(({ name }) => name), [
            'compiled-plan',
            'plan-generation'
        ]);
        assert.equal(store.saved[0]?.value && typeof store.saved[0].value, 'object');
    });

    it('编译失败时返回可重试的失败结果并保存错误产物', async () => {
        const store = new FakeArtifactStore({
            ...createSource(),
            steps: []
        });
        const service = new PlanGenerationService(store);

        const result = await service.generate('run-001');

        assert.equal(result.status, 'FAILED');
        assert.equal(result.failure?.recoverable, true);
        assert.match(result.summary, /成功轨迹不能为空/u);
        assert.equal(store.saved.at(-1)?.name, 'plan-generation');
    });
});

class FakeArtifactStore implements Pick<ArtifactStore, 'loadJson' | 'saveJson'> {
    public readonly saved: Array<{ name: string, value: JsonValue }> = [];

    constructor(private readonly source: unknown) {}

    public loadJson = async (_reference: string): Promise<unknown> => (
        this.source
    );

    public saveJson = async (
        runId: string,
        name: string,
        value: JsonValue
    ) => {
        this.saved.push({ name, value });
        return {
            kind: 'json' as const,
            mediaType: 'application/json',
            ref: `${ runId }/json/${ name }.json`
        };
    };
}

function createSource(): JsonValue {
    const observation = {
        schemaVersion: 1,
        observationId: 'observation-001',
        capturedAt: '2026-08-27T00:00:00.000Z',
        page: {
            loading: false,
            title: 'Test',
            url: 'https://test.jdydevelop.com/',
            viewport: { width: 1280, height: 720 }
        },
        visibleText: [],
        interactiveElements: [],
        notices: [],
        tabs: [],
        stateFingerprint: 'state-001',
        truncated: false
    };
    return {
        schemaVersion: 1,
        runId: 'run-001',
        testId: 'test-001',
        testIntent: {
            schemaVersion: 1,
            objective: '打开测试页面',
            preconditions: [],
            successCriteria: [{
                id: 'page-open',
                description: '测试页面已打开',
                preferredEvidence: ['url'],
                required: true
            }],
            failureCriteria: [],
            constraints: [],
            allowedHosts: ['test.jdydevelop.com'],
            dataPolicy: { generatedValues: [] }
        },
        steps: [{
            sequence: 1,
            command: {
                type: 'NAVIGATE',
                value: {
                    source: 'literal',
                    value: 'https://test.jdydevelop.com/'
                },
                expectedEffect: '打开测试页面',
                reasonSummary: '进入测试页面',
                risk: 'read-only'
            },
            actionResult: {
                status: 'executed',
                startedAt: '2026-08-27T00:00:00.000Z',
                finishedAt: '2026-08-27T00:00:01.000Z',
                browserSignals: {
                    dialogOpened: false,
                    downloadStarted: false,
                    newTabOpened: false,
                    urlChanged: true
                }
            },
            effect: {
                status: 'confirmed',
                expectedEffect: '打开测试页面',
                evidence: [],
                summary: '页面已打开'
            },
            beforeObservation: observation,
            afterObservation: observation
        }]
    };
}
