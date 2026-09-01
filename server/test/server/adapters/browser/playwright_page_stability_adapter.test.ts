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
    it('忽略倒计时与长随机标识变化并保留 transient 信号', async () => {
        const provider = new FakePageProvider([
            state('倒计时 9 秒 / 请求 123456789012', false),
            state('倒计时 8 秒 / 请求 987654321098', false),
            state('倒计时 8 秒 / 请求 987654321098', true)
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

    it('保留搜索结果数量等普通业务短整数', async () => {
        const provider = new FakePageProvider([
            state('搜索结果 0 条', false),
            state('搜索结果 1 条', false)
        ]);
        const adapter = new PlaywrightPageStabilityAdapter(provider);
        const signal = new AbortController().signal;

        assert.notEqual(
            (await adapter.sample(SESSION, signal)).fingerprint,
            (await adapter.sample(SESSION, signal)).fingerprint
        );
    });

    it('text-only async 业务状态变化必须改变 fingerprint', async () => {
        const provider = new FakePageProvider([
            state('固定按钮', false, [ '搜索中...' ]),
            state('固定按钮', false, [ '没有搜索到相关结果' ])
        ]);
        const adapter = new PlaywrightPageStabilityAdapter(provider);
        const signal = new AbortController().signal;

        assert.notEqual(
            (await adapter.sample(SESSION, signal)).fingerprint,
            (await adapter.sample(SESSION, signal)).fingerprint
        );
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

function state(
    controlName: string,
    loadingText: boolean,
    semanticText: string[] = [ controlName ]
) {
    return {
        busy: false,
        controls: [ `button|button|${ controlName }||` ],
        loadingText,
        pathname: 'https://example.test/workbench',
        progressbar: false,
        readyState: 'complete',
        semanticText,
        spinner: false,
        title: '工作台'
    };
}
