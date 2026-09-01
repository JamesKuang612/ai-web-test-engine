import assert from 'node:assert/strict';

import type { BrowserSession } from '@ai-web-test-engine/core';
import type { Page } from 'playwright';

import {
    PlaywrightPageStabilityAdapter,
} from '../../../../src/adapters/browser';
import type {
    PlaywrightPageProvider,
} from '../../../../src/adapters/browser';

describe('PlaywrightPageStabilityAdapter', () => {
    it('忽略随机数字变化并保留结构与 transient 信号', async () => {
        const provider = new FakePageProvider([
            state('倒计时 9 秒 / 订单 123456', false),
            state('倒计时 8 秒 / 订单 987654', false),
            state('倒计时 8 秒 / 订单 987654', true)
        ]);
        const adapter = new PlaywrightPageStabilityAdapter(provider);
        const signal = new AbortController().signal;
        const first = await adapter.sample(SESSION, signal);
        const second = await adapter.sample(SESSION, signal);
        const transient = await adapter.sample(SESSION, signal);

        assert.equal(first.fingerprint, second.fingerprint);
        assert.notEqual(second.fingerprint, transient.fingerprint);
        assert.deepEqual(transient.transientSignals, [ 'loading-text' ]);
    });
});

const SESSION = { sessionId: 'session-1' };

class FakePageProvider implements PlaywrightPageProvider {
    private index = 0;
    constructor(private readonly states: unknown[]) {}
    public getPage = () => ({
        evaluate: async () => this.states[this.index++]
    }) as unknown as Page;
    public getCandidateLocator = () => undefined;
    public getCandidateIds = () => [];
    public getAccessibilityRef = () => undefined;
    public isObservationCurrent = () => true;
    public registerTransientCandidate = () => undefined;
    public registerAccessibilityRef = () => undefined;
}

function state(controlName: string, loadingText: boolean) {
    return {
        busy: false,
        controls: [ `button|button|${ controlName }||` ],
        loadingText,
        pathname: 'https://example.test/workbench',
        progressbar: false,
        readyState: 'complete',
        spinner: false,
        title: '工作台'
    };
}
