import assert from 'node:assert/strict';

import type {
    PageObservation,
    PagePerception,
    SemanticStepProgressInput,
} from '../src';
import {
    createRecoveryPlanningView,
    SemanticStepProgressEvaluator,
} from '../src';

describe('SemanticStepProgressEvaluator', () => {
    it('不会把 CLICK 的局部 effect confirmed 直接视为 step complete', async () => {
        const before = createPerception('before');
        const after = createPerception('after', before);
        const input: SemanticStepProgressInput = {
            step: {
                id: 'step-1',
                primaryAction: {
                    type: 'CLICK',
                    target: { description: '收藏星标' },
                    reasonSummary: '收藏应用'
                },
                source: 'runtime-wrapper'
            },
            attemptedAction: {
                type: 'CLICK',
                target: { description: '收藏星标' },
                reasonSummary: '收藏应用'
            },
            before,
            after,
            actionResult: executedResult(),
            effect: {
                status: 'confirmed',
                expectedEffect: '页面状态发生变化',
                evidence: [],
                summary: '观察到局部变化'
            }
        };

        const progress = await new SemanticStepProgressEvaluator().evaluate(
            input,
            new AbortController().signal
        );

        assert.equal(progress.status, 'unknown');
    });

    it('TYPE 的确定控件状态可以直接判定 complete', async () => {
        const before = createPerception('before');
        const after = createPerception('after', before);
        const progress = await new SemanticStepProgressEvaluator().evaluate({
            step: {
                id: 'step-1',
                primaryAction: {
                    type: 'TYPE',
                    target: { description: '搜索框' },
                    value: { source: 'literal', value: '应用 11' },
                    reasonSummary: '输入搜索条件'
                },
                source: 'runtime-wrapper'
            },
            attemptedAction: {
                type: 'TYPE',
                target: { description: '搜索框' },
                value: { source: 'literal', value: '应用 11' },
                reasonSummary: '输入搜索条件'
            },
            before,
            after,
            actionResult: executedResult(),
            effect: {
                status: 'confirmed',
                expectedEffect: '搜索框已填写',
                evidence: [],
                summary: '已填写'
            }
        }, new AbortController().signal);

        assert.equal(progress.status, 'complete');
    });
});

describe('SemanticStepProgressEvaluator correctness', () => {
    it('CLICK 错跳 settings 时不能复用跳转前已有目标文本', async () => {
        const before = createPerception('before');
        const after = createPerception('after', before);
        before.dom.visibleText = [ '工作台', '新建应用' ];
        after.dom.page.url = 'https://example.test/settings';
        after.dom.visibleText = [ '工作台', '新建应用' ];
        after.delta!.urlChanged = true;
        after.delta!.visibleText.added = [];
        let modelCalls = 0;
        const evaluator = new SemanticStepProgressEvaluator({
            modelFallback: {
                evaluate: async () => {
                    modelCalls += 1;
                    return {
                        status: 'unknown',
                        basis: 'model',
                        summary: '没有目标页面匹配证据。',
                        evidence: []
                    };
                }
            }
        });
        const progress = await evaluator.evaluate({
            step: {
                id: 'step-1',
                primaryAction: {
                    type: 'CLICK',
                    target: { description: '新建应用' },
                    expectedEffect: '进入新建应用页面',
                    reasonSummary: '创建应用'
                },
                expectedEffect: '进入新建应用页面',
                source: 'runtime-wrapper'
            },
            attemptedAction: {
                type: 'CLICK',
                target: { description: '新建应用' },
                expectedEffect: '进入新建应用页面',
                reasonSummary: '创建应用'
            },
            before,
            after,
            actionResult: {
                ...executedResult(),
                browserSignals: {
                    ...executedResult().browserSignals,
                    urlChanged: true
                }
            },
            effect: {
                status: 'confirmed',
                expectedEffect: '进入新建应用页面',
                evidence: [],
                summary: '页面地址发生变化。'
            }
        }, new AbortController().signal, true);

        assert.notEqual(progress.status, 'complete');
        assert.equal(progress.status, 'unknown');
        assert.equal(modelCalls, 1);
    });

    it('模型安全视图不包含物理定位和输入真实值', () => {
        const perception = createPerception('after');
        const serialized = JSON.stringify(createRecoveryPlanningView(perception));

        [
            'candidateId',
            'domCandidateId',
            'locatorHints',
            'attributes',
            'boundingBox',
            'coordinates',
            'secret-value',
            'https://'
        ].forEach((forbidden) => assert.equal(
            serialized.includes(forbidden),
            false,
            forbidden
        ));
    });
});

function createPerception(
    id: string,
    previous?: PagePerception
): PagePerception {
    const dom = createObservation(id);
    return {
        perceptionId: `perception-${ id }`,
        capturedAt: '2026-08-31T00:00:00.000Z',
        dom,
        accessibility: {
            source: 'playwright-aria-snapshot',
            truncated: false,
            nodes: [{
                id: 'ax-secret',
                domCandidateId: 'candidate-secret',
                ancestors: [],
                role: 'textbox',
                name: '搜索'
            }]
        },
        interactionStates: {
            'candidate-secret': {
                candidateId: 'candidate-secret',
                enabled: true,
                hitTest: 'receives-events',
                inViewport: true,
                visible: true
            }
        },
        ...previous
            ? {
                delta: {
                    accessibility: {
                        added: [], changed: [], removed: [], truncated: false
                    },
                    candidates: {
                        added: [], removed: [], truncated: false
                    },
                    overlayState: {
                        before: 'clear', after: 'clear', changed: false
                    },
                    titleChanged: false,
                    urlChanged: false,
                    visibleText: {
                        added: [ '结果' ], removed: [], truncated: false
                    }
                }
            }
            : {}
    };
}

function createObservation(id: string): PageObservation {
    return {
        schemaVersion: 1,
        observationId: id,
        capturedAt: '2026-08-31T00:00:00.000Z',
        page: {
            loading: false,
            title: '工作台',
            url: 'https://example.test/workbench',
            viewport: { width: 1280, height: 720 }
        },
        visibleText: [ '工作台' ],
        interactiveElements: [{
            candidateId: 'candidate-secret',
            tag: 'input',
            role: 'textbox',
            name: '搜索',
            valueState: 'filled',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: { value: 'secret-value' },
            nearbyText: [],
            boundingBox: { x: 1, y: 2, width: 3, height: 4 },
            locatorHints: [{ strategy: 'css', value: '#secret' }]
        }],
        notices: [],
        tabs: [],
        stateFingerprint: id,
        truncated: false
    };
}

function executedResult() {
    return {
        status: 'executed' as const,
        startedAt: '2026-08-31T00:00:00.000Z',
        finishedAt: '2026-08-31T00:00:01.000Z',
        browserSignals: {
            dialogOpened: false,
            downloadStarted: false,
            newTabOpened: false,
            urlChanged: false
        }
    };
}
