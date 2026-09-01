import assert from 'node:assert/strict';

import type {
    BrowserSession,
    PagePerception,
} from '@ai-web-test-engine/core';
import {
    createPerceptionStability,
    DeterministicTargetGrounder,
    GroundedActionBuilder,
    PageSettler,
    PerceptionService,
} from '@ai-web-test-engine/core';

import {
    PlaywrightBrowserAdapter,
    PlaywrightPagePerceptionAdapter,
    PlaywrightPageStabilityAdapter,
} from '../../../../src/adapters/browser';

const START_OPTIONS = {
    headless: true,
    viewport: { width: 800, height: 600 }
};
const SIGNAL = new AbortController().signal;

describe('Playwright async stability acceptance', () => {
    it('CLEAR 后 settle 到稳定状态，再 Ground 并执行原始 New App', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        const stability = new PlaywrightPageStabilityAdapter(browser);
        const perceptions = new PerceptionService(
            new PlaywrightPagePerceptionAdapter(browser)
        );
        const browserActions: string[] = [];
        try {
            await browser.getPage(session).setContent(ASYNC_SEARCH_FIXTURE);
            const initial = await captureFull(
                browser, stability, perceptions, session, undefined
            );
            const search = initial.dom.interactiveElements.find(
                ({ name }) => name === '搜索应用'
            );
            assert.ok(search);

            browserActions.push('TYPE');
            const clear = await browser.execute(session, {
                type: 'TYPE',
                target: {
                    candidateId: search.candidateId,
                    description: '搜索输入框'
                },
                value: { source: 'literal', value: '' },
                expectedEffect: '搜索输入框被清空',
                reasonSummary: '清除搜索条件'
            });
            assert.equal(clear.status, 'executed');
            const transient = await captureFull(
                browser, stability, perceptions, session, initial
            );
            assert.equal(
                transient.stability?.state === 'transient'
                || transient.stability?.consistency === 'inconsistent',
                true
            );

            const settled = await createSettler(
                browser, stability, perceptions, session
            ).settle(transient, SIGNAL);
            assert.equal(settled.status, 'stable');
            if (settled.status !== 'stable') {
                assert.fail(settled.reason);
            }
            const primaryAction = {
                type: 'CLICK' as const,
                target: { description: '新建应用' },
                expectedEffect: '进入新建应用页面',
                reasonSummary: '执行原始新建应用动作'
            };
            const grounding = await new DeterministicTargetGrounder().ground({
                action: primaryAction,
                perception: settled.perception,
                session,
                visualAllowed: false
            }, SIGNAL);
            assert.equal(grounding.status, 'grounded', grounding.summary);
            assert.ok(grounding.target);

            const grounded = new GroundedActionBuilder().build(
                primaryAction,
                grounding.target
            );
            browserActions.push(grounded.command.type);
            const click = await browser.execute(
                session,
                grounded.command,
                grounded.resolvedTarget
            );
            assert.equal(click.status, 'executed');
            assert.equal(
                await browser.getPage(session).locator('body')
                    .getAttribute('data-new-app-clicked'),
                'true'
            );
            assert.deepEqual(browserActions, [ 'TYPE', 'CLICK' ]);
            assert.equal(settled.samples.length > 0, true);
        } finally {
            await browser.close(session);
        }
    }).timeout(20_000);
});

function createSettler(
    browser: PlaywrightBrowserAdapter,
    stability: PlaywrightPageStabilityAdapter,
    perceptions: PerceptionService,
    session: BrowserSession
): PageSettler {
    return new PageSettler({
        canContinue: () => true,
        pause: async (milliseconds, signal) => {
            signal.throwIfAborted();
            await new Promise((resolve) => setTimeout(resolve, milliseconds));
            signal.throwIfAborted();
        },
        recapture: async (previous) => await captureFull(
            browser, stability, perceptions, session, previous
        ),
        sample: async (signal) => await stability.sample(session, signal)
    }, {
        maxPerceptionRecaptures: 2,
        maxStabilitySamples: 20,
        pollIntervalsMs: [ 100 ],
        requiredConsecutiveStableSamples: 2
    });
}

async function captureFull(
    browser: PlaywrightBrowserAdapter,
    stability: PlaywrightPageStabilityAdapter,
    perceptions: PerceptionService,
    session: BrowserSession,
    previous: PagePerception | undefined
): Promise<PagePerception> {
    const before = await stability.sample(session, SIGNAL);
    const observation = await browser.observe(session);
    await browser.captureScreenshot(session);
    const perception = await perceptions.capture(
        session,
        { ...observation, screenshotRef: 'artifact://acceptance-screenshot' },
        previous,
        SIGNAL
    );
    const after = await stability.sample(session, SIGNAL);
    perception.stability = createPerceptionStability({ before, after });
    return perception;
}

const ASYNC_SEARCH_FIXTURE = [
    '<main>',
    '<label>搜索应用<input aria-label="搜索应用" value="jdy"></label>',
    '<p id="status">当前显示筛选结果</p>',
    '<button id="new-app" hidden>新建应用</button>',
    '</main>',
    '<script>',
    'const input=document.querySelector("input");',
    'const status=document.querySelector("#status");',
    'const button=document.querySelector("#new-app");',
    'input.addEventListener("input",()=>{',
    'status.textContent="搜索中...";',
    'status.setAttribute("aria-busy","true");',
    'button.hidden=true;',
    'setTimeout(()=>{',
    'status.textContent="没有搜索到相关结果";',
    'status.removeAttribute("aria-busy");',
    'button.hidden=false;',
    '},800);',
    '});',
    'button.addEventListener("click",()=>{',
    'document.body.dataset.newAppClicked="true";',
    '});',
    '</script>'
].join('');
