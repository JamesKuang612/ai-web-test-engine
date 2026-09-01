import assert from 'node:assert/strict';

import type {
    PageObservation,
    PagePerceptionPort,
    PageStabilitySample,
} from '../src';
import {
    PerceptionService,
} from '../src';

describe('PerceptionService', () => {
    it('组合 bounded 感知信号并复用已有 screenshotRef', async () => {
        const service = new PerceptionService(new FakePerceptionPort());
        const perception = await service.capture(
            { sessionId: 'session-1' },
            createObservation('observation-1'),
            undefined,
            new AbortController().signal
        );

        assert.equal(perception.dom.observationId, 'observation-1');
        assert.equal(perception.accessibility.nodes[0].name, '创建应用');
        assert.equal(perception.visual?.screenshotRef, 'artifact://screen-1');
        assert.deepEqual(perception.visual?.regions, []);
        assert.deepEqual(perception.stability, {
            consistency: 'unknown',
            state: 'unknown',
            transientSignals: []
        });
    });

    it('使用 capture window 标记 consistent、inconsistent 与 transient', async () => {
        const service = new PerceptionService(new FakePerceptionPort());
        const stable = await service.capture(
            { sessionId: 'session-1' },
            createObservation('stable'),
            undefined,
            new AbortController().signal,
            window(sample('same'), sample('same'))
        );
        const changing = await service.capture(
            { sessionId: 'session-1' },
            createObservation('changing'),
            stable,
            new AbortController().signal,
            window(sample('before'), sample('after', [ 'loading-text' ]))
        );

        assert.equal(stable.stability?.consistency, 'consistent');
        assert.equal(stable.stability?.state, 'stable');
        assert.equal(changing.stability?.consistency, 'inconsistent');
        assert.equal(changing.stability?.state, 'transient');
        assert.deepEqual(changing.stability?.transientSignals, [
            'loading-text'
        ]);
    });

    it('计算 URL、标题、候选、文本、A11y 和 overlay 的低成本差异', async () => {
        const service = new PerceptionService(new FakePerceptionPort());
        const first = await service.capture(
            { sessionId: 'session-1' },
            createObservation('observation-1'),
            undefined,
            new AbortController().signal
        );
        const nextObservation = createObservation('observation-2');
        nextObservation.page.url = 'https://example.test/workbench';
        nextObservation.page.title = '工作台';
        nextObservation.visibleText = [ '工作台' ];
        nextObservation.interactiveElements[0].candidateId = 'e2';
        const second = await service.capture(
            { sessionId: 'session-1' },
            nextObservation,
            first,
            new AbortController().signal
        );

        assert.equal(second.delta?.urlChanged, true);
        assert.equal(second.delta?.titleChanged, true);
        assert.deepEqual(second.delta?.candidates.added, [ 'e2' ]);
        assert.deepEqual(second.delta?.candidates.removed, [ 'e1' ]);
        assert.deepEqual(second.delta?.visibleText.added, [ '工作台' ]);
        assert.equal(second.delta?.overlayState.changed, false);
    });
});

class FakePerceptionPort implements PagePerceptionPort {
    public capture: PagePerceptionPort['capture'] = async () => ({
        accessibility: {
            nodes: [{
                id: 'ax-create',
                ancestors: [],
                domCandidateId: 'e1',
                name: '创建应用',
                role: 'button'
            }],
            source: 'playwright-aria-snapshot',
            truncated: false
        },
        interactionStates: {}
    });
}

function sample(
    fingerprint: string,
    transientSignals: PageStabilitySample['transientSignals'] = []
): PageStabilitySample {
    return {
        capturedAt: '2026-09-01T00:00:00.000Z',
        fingerprint,
        loading: false,
        transientSignals
    };
}

function window(before: PageStabilitySample, after: PageStabilitySample) {
    return { before, after };
}
function createObservation(observationId: string): PageObservation {
    return {
        schemaVersion: 1,
        observationId,
        capturedAt: '2026-08-31T00:00:00.000Z',
        page: {
            loading: false,
            title: '首页',
            url: 'https://example.test/',
            viewport: {
                height: 720,
                width: 1280
            }
        },
        visibleText: [ '首页' ],
        interactiveElements: [{
            candidateId: 'e1',
            tag: 'button',
            role: 'button',
            name: '创建应用',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: {},
            nearbyText: [],
            locatorHints: []
        }],
        notices: [],
        screenshotRef: 'artifact://screen-1',
        stateFingerprint: observationId,
        tabs: [],
        truncated: false
    };
}
