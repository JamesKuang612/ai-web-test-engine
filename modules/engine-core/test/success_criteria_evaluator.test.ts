import assert from 'node:assert/strict';

import type {
    PagePerception,
    TestIntent,
} from '../src';
import {
    SuccessCriteriaEvaluator,
} from '../src';

describe('SuccessCriteriaEvaluator', () => {
    it('完整 exact-text 证据覆盖整个 TestIntent 时才 satisfied', () => {
        const intent = createExactIntent([ '我的待办', '我发起的' ]);
        const result = new SuccessCriteriaEvaluator().evaluate(
            intent,
            createPerception([ '我的待办', '我发起的' ])
        );

        assert.equal(result.status, 'satisfied');
        assert.deepEqual(
            result.successCriteria.map(({ status }) => status),
            [ 'MATCHED' ]
        );
        assert.deepEqual(
            result.failureCriteria.map(({ status }) => status),
            [ 'NOT_MATCHED' ]
        );
    });

    it('required exact text 存在拼写差异时绝不 satisfied', () => {
        const result = new SuccessCriteriaEvaluator().evaluate(
            createExactIntent([ '管理后台E' ]),
            createPerception([ '管理后台' ])
        );

        assert.equal(result.status, 'incomplete');
        assert.equal(result.successCriteria[0]?.status, 'NOT_MATCHED');
        assert.equal(result.failureCriteria[0]?.status, 'MATCHED');
    });

    it('存在未被 exact-text 覆盖的 required success criterion 时不 satisfied', () => {
        const intent = createExactIntent([ '我的待办' ]);
        intent.successCriteria.push({
            id: 'business-state',
            description: '待办数据已经完成业务加载',
            preferredEvidence: [ 'dom' ],
            required: true
        });
        const result = new SuccessCriteriaEvaluator().evaluate(
            intent,
            createPerception([ '我的待办' ])
        );

        assert.equal(result.status, 'incomplete');
        assert.equal(
            result.successCriteria.find(
                ({ criterionId }) => criterionId === 'business-state'
            )?.status,
            'UNKNOWN'
        );
    });

    it('存在无法由 exact-text 排除的独立 failure criterion 时不 satisfied', () => {
        const intent = createExactIntent([ '我的待办' ]);
        intent.failureCriteria.push({
            id: 'independent-error',
            description: '页面出现服务端业务错误'
        });
        const result = new SuccessCriteriaEvaluator().evaluate(
            intent,
            createPerception([ '我的待办' ])
        );

        assert.equal(result.status, 'incomplete');
        assert.equal(
            result.failureCriteria.find(
                ({ criterionId }) => criterionId === 'independent-error'
            )?.status,
            'UNKNOWN'
        );
    });

    it('ordered assertion 文本齐全但顺序错误时不 satisfied', () => {
        const intent = createExactIntent([ '我的待办', '我发起的' ]);
        if (intent.exactTextAssertions?.[0]) {
            intent.exactTextAssertions[0].ordered = true;
        }
        const result = new SuccessCriteriaEvaluator().evaluate(
            intent,
            createPerception([ '我发起的', '我的待办' ])
        );

        assert.equal(result.status, 'incomplete');
        assert.equal(result.successCriteria[0]?.status, 'NOT_MATCHED');
    });

    it('未覆盖的 optional success criterion 保持 UNKNOWN 而非 blanket MATCHED', () => {
        const intent = createExactIntent([ '我的待办' ]);
        intent.successCriteria.push({
            id: 'optional-polish',
            description: '页面具有推荐视觉样式',
            preferredEvidence: [ 'screenshot' ],
            required: false
        });
        const result = new SuccessCriteriaEvaluator().evaluate(
            intent,
            createPerception([ '我的待办' ])
        );

        assert.equal(result.status, 'satisfied');
        assert.equal(
            result.successCriteria.find(
                ({ criterionId }) => criterionId === 'optional-polish'
            )?.status,
            'UNKNOWN'
        );
    });
});

function createExactIntent(values: string[]): TestIntent {
    return {
        schemaVersion: 1,
        objective: '验证页面精确文本',
        preconditions: [],
        successCriteria: [{
            id: 'exact-success',
            description: '页面逐字显示全部目标文本',
            preferredEvidence: [ 'dom' ],
            required: true
        }],
        failureCriteria: [{
            id: 'exact-failure',
            description: '任一目标文本缺失、文字不同或顺序不符'
        }],
        constraints: [],
        allowedHosts: [ 'example.test' ],
        dataPolicy: { generatedValues: {} },
        exactTextAssertions: [{
            successCriterionId: 'exact-success',
            failureCriterionId: 'exact-failure',
            ordered: false,
            values
        }]
    };
}

function createPerception(visibleText: string[]): PagePerception {
    return {
        perceptionId: 'perception-1',
        capturedAt: '2026-09-01T00:00:00.000Z',
        accessibility: {
            nodes: [],
            source: 'playwright-aria-snapshot',
            truncated: false
        },
        dom: {
            schemaVersion: 1,
            observationId: 'observation-1',
            capturedAt: '2026-09-01T00:00:00.000Z',
            page: {
                loading: false,
                title: '工作台',
                url: 'https://example.test/dashboard',
                viewport: { width: 1280, height: 720 }
            },
            visibleText,
            interactiveElements: [],
            notices: [],
            tabs: [{
                active: true,
                title: '工作台',
                url: 'https://example.test/dashboard'
            }],
            stateFingerprint: 'stable-workbench',
            truncated: false
        },
        interactionStates: {},
        stability: {
            consistency: 'consistent',
            state: 'stable',
            transientSignals: []
        }
    };
}
