import assert from 'node:assert/strict';
import type {
    ActionType,
    GroundingRequest,
    ObservedElement,
    PageObservation,
    SemanticAction,
} from '../src';
import {
    DeterministicTargetGrounder,
} from '../src';

describe('DeterministicTargetGrounder 物理绑定', () => {
    const grounder = new DeterministicTargetGrounder();

    it('将唯一语义目标绑定为包含完整元素快照的 ResolvedTarget', async () => {
        const element = createElement('e1', {
            name: '新建应用',
            text: '新建应用',
            role: 'button',
            nearbyText: ['我的应用']
        });
        const decision = await grounder.ground(
            createRequest(
                createAction('CLICK', '新建应用', '我的应用'),
                createObservation([element])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'e1');
        assert.equal(decision.target?.observationId, 'observation-1');
        assert.deepEqual(decision.target?.elementSnapshot.locatorHints, [
            { strategy: 'role-name', value: 'button|新建应用' }
        ]);
        assert.deepEqual(decision.target?.elementSnapshot.boundingBox, {
            x: 10,
            y: 10,
            width: 100,
            height: 30
        });
        assert.equal(
            'candidateId' in (decision.target?.elementSnapshot ?? {}),
            false
        );
    });

    it('允许普通可见容器作为 HOVER 目标', async () => {
        const decision = await grounder.ground(
            createRequest(
                createAction('HOVER', '应用 11 卡片'),
                createObservation([createElement('e1', {
                    tag: 'div',
                    role: undefined,
                    name: '应用 11 卡片'
                })])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'e1');
    });

    it('不把没有有效 geometry 的 HOVER 目标判为可执行', async () => {
        const element = createElement('e1', {
            tag: 'div',
            role: undefined,
            name: '应用 11 卡片',
            boundingBox: undefined
        });
        const decision = await grounder.ground(
            createRequest(
                createAction('HOVER', '应用 11 卡片'),
                createObservation([element])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'not-visible');
    });

});

describe('DeterministicTargetGrounder 消歧与可执行性', () => {
    const grounder = new DeterministicTargetGrounder();

    it('使用 scope 区分多个同名元素', async () => {
        const decision = await grounder.ground(
            createRequest(
                createAction('CLICK', '收藏', '应用 11'),
                createObservation([
                    createElement('e1', {
                        name: '收藏',
                        nearbyText: ['应用 10']
                    }),
                    createElement('e2', {
                        name: '收藏',
                        nearbyText: ['应用 11']
                    })
                ])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'e2');
    });

    it('忽略历史对象中的 relation 前向兼容元数据', async () => {
        const action: SemanticAction = {
            ...createAction('CLICK', '收藏', '应用 11'),
            target: {
                description: '收藏',
                scope: '应用 11',
                relation: '应用名称左侧'
            }
        };
        const decision = await grounder.ground(
            createRequest(
                action,
                createObservation([
                    createElement('e1', {
                        name: '收藏',
                        nearbyText: ['应用 11']
                    })
                ])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'e1');
    });

    it('同等级重复目标在没有 scope 时返回 ambiguous', async () => {
        const decision = await grounder.ground(
            createRequest(
                createAction('CLICK', '收藏'),
                createObservation([
                    createElement('e1', { name: '收藏' }),
                    createElement('e2', { name: '收藏' })
                ])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'ambiguous');
        assert.equal(decision.target, undefined);
    });

    it('把 disabled 状态分类为 not-actionable', async () => {
        const decision = await grounder.ground(
            createRequest(
                createAction('CLICK', '提交'),
                createObservation([createElement('e1', {
                    name: '提交',
                    disabled: true
                })])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'not-actionable');
        assert.match(decision.summary, /CLICK/u);
    });

    it('把动作类型不兼容分类为 not-actionable', async () => {
        const decision = await grounder.ground(
            createRequest(
                createAction('TYPE', '提交'),
                createObservation([createElement('e1', {
                    name: '提交'
                })])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'not-actionable');
    });

    it('把视口外目标分类为 not-visible', async () => {
        const decision = await grounder.ground(
            createRequest(
                createAction('CLICK', '提交'),
                createObservation([createElement('e1', {
                    name: '提交',
                    inViewport: false
                })])
            ),
            new AbortController().signal
        );

        assert.equal(decision.status, 'not-visible');
    });
});

function createAction(
    type: ActionType,
    description: string,
    scope?: string
): SemanticAction {
    return {
        type,
        target: {
            description,
            ...scope ? { scope } : {}
        },
        expectedEffect: '页面产生预期变化',
        reasonSummary: '执行测试动作'
    };
}

function createRequest(
    action: SemanticAction,
    observation: PageObservation
): GroundingRequest {
    return {
        action,
        perception: {
            perceptionId: 'perception-1',
            capturedAt: observation.capturedAt,
            accessibility: {
                nodes: [],
                source: 'playwright-aria-snapshot',
                truncated: false
            },
            dom: observation,
            interactionStates: {}
        },
        session: { sessionId: 'session-1' },
        visualAllowed: false
    };
}

function createObservation(elements: ObservedElement[]): PageObservation {
    return {
        schemaVersion: 1,
        observationId: 'observation-1',
        capturedAt: '2026-08-31T00:00:00.000Z',
        page: {
            loading: false,
            title: '测试页面',
            url: 'https://example.com/',
            viewport: { width: 1280, height: 720 }
        },
        visibleText: [],
        interactiveElements: elements,
        notices: [],
        tabs: [],
        stateFingerprint: 'fingerprint-1',
        truncated: false
    };
}

function createElement(
    candidateId: string,
    overrides: Partial<ObservedElement> = {}
): ObservedElement {
    return {
        candidateId,
        tag: 'button',
        role: 'button',
        name: '收藏',
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [],
        boundingBox: {
            x: 10,
            y: 10,
            width: 100,
            height: 30
        },
        locatorHints: [{
            strategy: 'role-name',
            value: 'button|新建应用'
        }],
        ...overrides
    };
}
