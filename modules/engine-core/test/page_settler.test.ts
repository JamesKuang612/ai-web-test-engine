import assert from 'node:assert/strict';

import type {
    PagePerception,
    PageStabilitySample,
} from '../src';
import {
    PageSettler,
} from '../src';

describe('PageSettler', () => {
    it('等待连续低成本稳定采样并以一致完整 recapture 收口', async () => {
        const runtime = new FakeSettlerRuntime([
            sample('changing', [ 'loading-text' ]),
            sample('ready'),
            sample('ready')
        ], stablePerception('ready'));
        const result = await new PageSettler(runtime, {
            maxPerceptionRecaptures: 2,
            maxStabilitySamples: 4,
            pollIntervalsMs: [ 0 ],
            requiredConsecutiveStableSamples: 2
        }).settle(unknownPerception('searching'), signal());

        assert.equal(result.status, 'stable');
        assert.equal(runtime.recaptureCount, 1);
        assert.equal(runtime.pauseCount, 2);
    });

    it('bounded window 耗尽时只返回 diagnosticPerception', async () => {
        const initial = unknownPerception('searching');
        const runtime = new FakeSettlerRuntime([
            sample('a'), sample('b'), sample('c')
        ], stablePerception('unused'));
        const result = await new PageSettler(runtime, {
            maxPerceptionRecaptures: 1,
            maxStabilitySamples: 3,
            pollIntervalsMs: [ 0 ],
            requiredConsecutiveStableSamples: 2
        }).settle(initial, signal());

        assert.equal(result.status, 'timed-out');
        if (result.status === 'stable') {
            assert.fail('不稳定结果不得通过 stable narrowing boundary。');
        }
        assert.equal(result.diagnosticPerception, initial);
        assert.equal('perception' in result, false);
    });

    it('legacy unknown 不会被直接当成 stable', async () => {
        const runtime = new FakeSettlerRuntime([], stablePerception('unused'));
        runtime.canContinue = () => false;
        const result = await new PageSettler(runtime)
            .settle(unknownPerception('legacy'), signal());

        assert.equal(result.status, 'budget-exhausted');
        assert.equal(runtime.recaptureCount, 0);
    });
});

class FakeSettlerRuntime {
    public pauseCount = 0;
    public recaptureCount = 0;
    public canContinue = () => true;
    constructor(
        private readonly samples: PageStabilitySample[],
        private readonly recaptured: PagePerception
    ) {}
    public pause = async () => { this.pauseCount += 1; };
    public recapture = async () => {
        this.recaptureCount += 1;
        return this.recaptured;
    };
    public sample = async () => this.samples.shift() ?? sample('changing');
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

function unknownPerception(id: string): PagePerception {
    return perception(id, {
        consistency: 'unknown', state: 'unknown', transientSignals: []
    });
}

function stablePerception(id: string): PagePerception {
    return perception(id, {
        consistency: 'consistent', state: 'stable', transientSignals: []
    });
}

function perception(
    id: string,
    stability: NonNullable<PagePerception['stability']>
): PagePerception {
    return {
        perceptionId: `p-${ id }`,
        capturedAt: '2026-09-01T00:00:00.000Z',
        stability,
        dom: {
            schemaVersion: 1,
            observationId: `o-${ id }`,
            capturedAt: '2026-09-01T00:00:00.000Z',
            page: {
                loading: false,
                title: id,
                url: 'https://example.test/workbench',
                viewport: { width: 1280, height: 720 }
            },
            visibleText: [ id ],
            interactiveElements: [],
            notices: [],
            tabs: [],
            stateFingerprint: id,
            truncated: false
        },
        accessibility: {
            source: 'playwright-aria-snapshot', nodes: [], truncated: false
        },
        interactionStates: {}
    };
}

function signal(): AbortSignal {
    return new AbortController().signal;
}
