import assert from 'node:assert/strict';
import type {
    CandidateMappingEvidence,
    CandidateMappingPort,
    CandidateMappingResult,
    GroundingRequest,
    ObservedElement,
    PageObservation,
    SemanticAction,
    VisualGroundingPort,
    VisualGroundingResult,
} from '../src';
import {
    CompositeTargetGrounder,
} from '../src';

describe('CompositeTargetGrounder 多模态顺序', () => {
    it('DOM 唯一命中时不调用 A11y mapping 或视觉模型', async () => {
        const mapper = new FakeCandidateMapper();
        const visual = new FakeVisualGrounder();
        const grounder = new CompositeTargetGrounder(mapper, visual);
        const decision = await grounder.ground(createRequest(
            [ createElement('e1', '新建应用') ],
            createAction('新建应用')
        ), signal());

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'e1');
        assert.equal(mapper.calls.length, 0);
        assert.equal(visual.callCount, 0);
        assert.deepEqual(decision.usage?.sourcesUsed, [ 'dom' ]);
    });

    it('DOM 目标被可靠遮挡时返回 blocked，不调用视觉或浏览器坐标', async () => {
        const mapper = new FakeCandidateMapper();
        const visual = new FakeVisualGrounder();
        const grounder = new CompositeTargetGrounder(mapper, visual);
        const request = createRequest(
            [ createElement('e1', '新建应用') ],
            createAction('新建应用')
        );
        request.perception.interactionStates.e1 = {
            candidateId: 'e1',
            enabled: true,
            hitTest: 'blocked',
            inViewport: true,
            visible: true,
            blockedBy: { tag: 'div', text: '遮罩层' }
        };

        const decision = await grounder.ground(request, signal());

        assert.equal(decision.status, 'blocked');
        assert.equal(mapper.calls.length, 0);
        assert.equal(visual.callCount, 0);
    });

    it('DOM 不足时使用 bounded A11y 证据映射到 live candidate', async () => {
        const mapper = new FakeCandidateMapper('ax-1');
        const visual = new FakeVisualGrounder();
        const grounder = new CompositeTargetGrounder(mapper, visual);
        const request = createRequest([], createAction('收藏'));
        request.perception.accessibility.nodes.push({
            id: 'ax-node-1',
            ancestors: [{ name: '应用 11', role: 'group' }],
            name: '收藏',
            role: 'button'
        });

        const decision = await grounder.ground(request, signal());

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'ax-1');
        assert.equal(mapper.calls[0]?.source, 'accessibility');
        assert.equal(visual.callCount, 0);
    });

    it('DOM/A11y 不足时由视觉发现区域，再经 mapping 落到 candidate', async () => {
        const mapper = new FakeCandidateMapper('visual-1');
        const visual = new FakeVisualGrounder({
            modelCalls: 1,
            status: 'located',
            regions: [{
                id: 'vr-1',
                boundingBox: { x: 10, y: 20, width: 24, height: 24 },
                context: [ '应用 11' ],
                description: '收藏星标'
            }],
            summary: '视觉发现目标区域。'
        });
        const grounder = new CompositeTargetGrounder(mapper, visual);

        const decision = await grounder.ground(
            createRequest([], createAction('收藏星标')),
            signal()
        );

        assert.equal(decision.status, 'grounded');
        assert.equal(decision.target?.candidateId, 'visual-1');
        assert.equal(mapper.calls[0]?.source, 'visual');
        assert.equal(decision.usage?.visualModelCalls, 1);
    });

    it('视觉区域无法安全映射时返回 unmapped，不生成坐标目标', async () => {
        const mapper = new FakeCandidateMapper(undefined, 'unmapped');
        const visual = new FakeVisualGrounder({
            modelCalls: 1,
            status: 'located',
            regions: [{
                id: 'vr-1',
                boundingBox: { x: 10, y: 20, width: 24, height: 24 },
                context: [],
                description: '收藏星标'
            }],
            summary: '视觉发现目标区域。'
        });
        const grounder = new CompositeTargetGrounder(mapper, visual);

        const decision = await grounder.ground(
            createRequest([], createAction('收藏星标')),
            signal()
        );

        assert.equal(decision.status, 'unmapped');
        assert.equal(decision.target, undefined);
        assert.equal(decision.usage?.visualModelCalls, 1);
    });

});

describe('CompositeTargetGrounder 视觉预算', () => {
    it('Provider 未启用时不消耗模型预算', async () => {
        const mapper = new FakeCandidateMapper();
        const visual = new FakeVisualGrounder({
            modelCalls: 0,
            status: 'unsupported',
            regions: [],
            summary: '当前环境已关闭视觉定位。'
        });
        const decision = await new CompositeTargetGrounder(
            mapper,
            visual
        ).ground(createRequest([], createAction('收藏星标')), signal());

        assert.equal(decision.status, 'not-found');
        assert.equal(decision.usage?.visualModelCalls, 0);
    });
});

class FakeCandidateMapper implements CandidateMappingPort {
    public readonly calls: CandidateMappingEvidence[] = [];

    constructor(
        private readonly candidateId?: string,
        private readonly status: CandidateMappingResult['status'] = 'mapped'
    ) {}

    public map: CandidateMappingPort['map'] = (
        _session,
        _perception,
        _action,
        evidence
    ) => {
        this.calls.push(evidence);
        return Promise.resolve({
            status: this.candidateId ? this.status : 'unmapped',
            candidates: this.candidateId ? [{
                actionCompatible: true,
                candidateId: this.candidateId,
                elementSnapshot: {
                    tag: 'button',
                    role: 'button',
                    name: '收藏',
                    disabled: false,
                    visible: true,
                    inViewport: true,
                    attributes: {},
                    nearbyText: [ '应用 11' ],
                    boundingBox: {
                        x: 10,
                        y: 10,
                        width: 24,
                        height: 24
                    },
                    locatorHints: []
                },
                evidence: [ `mapped:${ this.candidateId }` ],
                interactionState: {
                    candidateId: this.candidateId,
                    enabled: true,
                    hitTest: 'receives-events',
                    inViewport: true,
                    visible: true
                }
            }] : [],
            evidence: [ 'mapping-result' ],
            summary: this.candidateId ? '唯一映射成功。' : '无法安全映射。'
        });
    };
}

class FakeVisualGrounder implements VisualGroundingPort {
    public callCount = 0;

    constructor(private readonly result: VisualGroundingResult = {
        modelCalls: 0,
        status: 'not-found',
        regions: [],
        summary: '未调用视觉。'
    }) {}

    public locate: VisualGroundingPort['locate'] = () => {
        this.callCount += 1;
        return Promise.resolve(this.result);
    };
}

function createAction(description: string): SemanticAction {
    return {
        type: 'CLICK',
        target: { description, scope: '应用 11' },
        expectedEffect: '目标状态发生变化',
        reasonSummary: '执行明确的下一语义动作'
    };
}

function createRequest(
    elements: ObservedElement[],
    action: SemanticAction
): GroundingRequest {
    const dom = createObservation(elements);
    return {
        action,
        perception: {
            perceptionId: 'perception-1',
            capturedAt: dom.capturedAt,
            dom,
            accessibility: {
                nodes: [],
                source: 'playwright-aria-snapshot',
                truncated: false
            },
            interactionStates: {}
        },
        session: { sessionId: 'session-1' },
        visualAllowed: true
    };
}

function createObservation(elements: ObservedElement[]): PageObservation {
    return {
        schemaVersion: 1,
        observationId: 'observation-1',
        capturedAt: '2026-08-31T00:00:00.000Z',
        page: {
            loading: false,
            title: '工作台',
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

function createElement(candidateId: string, name: string): ObservedElement {
    return {
        candidateId,
        tag: 'button',
        role: 'button',
        name,
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [ '应用 11' ],
        boundingBox: { x: 10, y: 10, width: 100, height: 30 },
        locatorHints: []
    };
}

function signal(): AbortSignal {
    return new AbortController().signal;
}
