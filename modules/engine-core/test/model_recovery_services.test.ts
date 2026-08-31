import assert from 'node:assert/strict';

import type {
    ModelAdapter,
    ModelRequest,
    ModelResult,
    RecoveryPlannerInput,
    RuntimeSchema,
    StepProgressModelInput,
} from '../src';
import {
    ModelRecoveryPlanner,
    ModelStepProgressEvaluator,
} from '../src';

describe('Phase 3 model recovery services', () => {
    it('RecoveryPlanner 只接收 typed safe view 并输出 semantic action', async () => {
        const adapter = new FakeModelAdapter({
            kind: 'recover',
            action: {
                type: 'HOVER',
                target: { description: '应用 11 卡片' },
                reasonSummary: '显示隐藏收藏按钮'
            }
        });
        const decision = await new ModelRecoveryPlanner(adapter).plan(
            recoveryInput(),
            new AbortController().signal
        );
        const prompt = adapter.lastRequest?.userPrompt ?? '';

        assert.equal(decision.kind, 'recover');
        [
            'candidateId', 'domCandidateId', 'locatorHints', 'boundingBox',
            'coordinates', 'attributes', 'secret-value', 'https://'
        ].forEach((field) => assert.equal(prompt.includes(field), false));
    });

    it('Progress 模型只能返回分类，额外动作字段会被拒绝', async () => {
        const adapter = new FakeModelAdapter({
            status: 'complete',
            summary: '目标已完成',
            action: { type: 'CLICK' }
        });

        await assert.rejects(() => new ModelStepProgressEvaluator(adapter)
            .evaluate(progressInput(), new AbortController().signal));
    });
});

class FakeModelAdapter implements ModelAdapter {
    public lastRequest?: ModelRequest;
    constructor(private readonly output: unknown) {}
    public generateStructured<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>
    ): Promise<ModelResult<T>> {
        this.lastRequest = request;
        return Promise.resolve({
            model: 'fake-model',
            value: schema.parse(this.output)
        });
    }
}

function recoveryInput(): RecoveryPlannerInput {
    return {
        step: {
            id: 'step-1',
            primaryAction: {
                type: 'CLICK',
                target: { description: '收藏星标', scope: '应用 11' },
                reasonSummary: '收藏应用'
            }
        },
        testIntent: {
            schemaVersion: 1,
            objective: '收藏应用 11',
            preconditions: [],
            successCriteria: [],
            failureCriteria: [],
            constraints: [],
            allowedHosts: [ 'example.test' ],
            dataPolicy: { generatedValues: {} }
        },
        failure: {
            grounding: {
                status: 'not-found',
                confidence: 0,
                summary: 'not found',
                sourcesUsed: [ 'dom' ]
            }
        },
        view: {
            page: {
                loading: false,
                title: '工作台',
                urlChanged: false
            },
            visibleText: [ '应用 11' ],
            notices: [],
            elements: [{
                role: 'article',
                name: '应用 11',
                disabled: false,
                visible: true,
                inViewport: true,
                nearbyText: []
            }],
            accessibility: [],
            overlayState: 'clear'
        },
        recentAttempts: [],
        allowedCapabilities: [ 'HOVER', 'REOBSERVE' ]
    };
}

function progressInput(): StepProgressModelInput {
    const view = recoveryInput().view;
    return {
        step: {
            primaryAction: {
                type: 'CLICK',
                targetDescription: '收藏星标',
                reasonSummary: '收藏应用'
            }
        },
        attemptedActionType: 'CLICK',
        before: view,
        after: view
    };
}
