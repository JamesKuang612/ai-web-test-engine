import assert from 'node:assert/strict';
import type {
    PagePerception,
    SemanticAction,
    VisualRegion,
} from '@ai-web-test-engine/core';
import {
    CompositeTargetGrounder,
    PerceptionService,
} from '@ai-web-test-engine/core';
import {
    captureInteractionState,
    PlaywrightBrowserAdapter,
    PlaywrightCandidateMappingAdapter,
    PlaywrightPagePerceptionAdapter,
} from '../../../../src/adapters/browser';
import {
    DisabledVisualGroundingAdapter,
} from '../../../../src/adapters/visual';

const START_OPTIONS = {
    headless: true,
    viewport: { width: 800, height: 600 }
};

describe('PlaywrightCandidateMappingAdapter', () => {
    it('把 DOM candidate 外的视觉星标注册为 visual-* candidate 后执行', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        try {
            const page = browser.getPage(session);
            await page.setContent([
                '<style>.star{display:block;width:48px;height:48px;',
                'font-size:32px}</style>',
                '<details class="card">应用 11<summary class="star">',
                '☆</summary></details>',
                '<script>document.querySelector(".star").addEventListener(',
                '"click",()=>document.body.dataset.favorite="true")</script>'
            ].join(''));
            const observation = await browser.observe(session);
            assert.equal(observation.interactiveElements.some(
                ({ attributes }) => attributes.class === 'star'
            ), false);
            const box = await page.locator('.star').boundingBox();
            assert.ok(box);
            const mapper = new PlaywrightCandidateMappingAdapter(browser);
            const result = await mapper.map(
                session,
                createPerception(observation),
                createClickAction(),
                { source: 'visual', regions: [ createRegion(box) ] },
                new AbortController().signal
            );

            assert.equal(result.status, 'mapped', result.summary);
            const candidate = result.candidates[0];
            assert.match(candidate.candidateId, /^visual-/u);
            assert.equal(candidate.actionCompatible, true);
            assert.equal(candidate.interactionState.hitTest, 'receives-events');
            const execution = await browser.execute(
                session,
                {
                    type: 'CLICK',
                    target: {
                        candidateId: candidate.candidateId,
                        description: '应用 11 的收藏星标'
                    },
                    expectedEffect: '应用 11 被收藏',
                    reasonSummary: '执行已完成物理绑定的语义动作'
                },
                {
                    description: '应用 11 的收藏星标',
                    observationId: observation.observationId,
                    candidateId: candidate.candidateId,
                    elementSnapshot: candidate.elementSnapshot,
                    strategy: 'candidate-id',
                    locatorData: {},
                    confidence: 0.85,
                    unique: true,
                    actionable: true,
                    evidence: candidate.evidence
                }
            );
            assert.equal(execution.status, 'executed');
            assert.equal(await page.locator('body').getAttribute(
                'data-favorite'
            ), 'true');
        } finally {
            await browser.close(session);
        }
    }).timeout(15_000);

    it('scope 已由视觉 bbox 区分时只映射应用 11，不混淆重复星标', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        try {
            const page = browser.getPage(session);
            await page.setContent([
                '<style>.star{display:block;width:40px;height:40px}</style>',
                '<details id="app11">应用 11<summary class="star">',
                '☆</summary></details>',
                '<details id="app12">应用 12<summary class="star">',
                '☆</summary></details>'
            ].join(''));
            const observation = await browser.observe(session);
            const box = await page.locator('#app11 .star').boundingBox();
            assert.ok(box);
            const result = await new PlaywrightCandidateMappingAdapter(
                browser
            ).map(
                session,
                createPerception(observation),
                createClickAction(),
                { source: 'visual', regions: [ createRegion(box) ] },
                new AbortController().signal
            );

            assert.equal(result.status, 'mapped', result.summary);
            assert.equal(
                await page.locator('#app11 .star').getAttribute(
                    'data-ai-web-test-candidate'
                ),
                result.candidates[0].candidateId
            );
            assert.equal(
                await page.locator('#app12 .star').getAttribute(
                    'data-ai-web-test-candidate'
                ),
                null
            );
        } finally {
            await browser.close(session);
        }
    }).timeout(15_000);

    it('已有 app-card candidate 时仍绑定内部收藏 star，不劫持父卡片', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        try {
            const page = browser.getPage(session);
            await page.setContent([
                '<div id="card" role="button" aria-label="应用 11 卡片" ',
                'style="width:200px;height:100px">应用 11',
                '<details><summary id="star" style="display:block;',
                'width:40px;height:40px">☆</summary></details></div>'
            ].join(''));
            const observation = await browser.observe(session);
            const cardId = observation.interactiveElements.find(
                ({ attributes }) => attributes.id === 'card'
            )?.candidateId;
            const box = await page.locator('#star').boundingBox();
            assert.ok(cardId);
            assert.ok(box);

            const result = await new PlaywrightCandidateMappingAdapter(
                browser
            ).map(
                session,
                createPerception(observation),
                createClickAction(),
                { source: 'visual', regions: [ createRegion(box) ] },
                new AbortController().signal
            );

            assert.equal(result.status, 'mapped', result.summary);
            assert.match(result.candidates[0].candidateId, /^visual-/u);
            assert.notEqual(result.candidates[0].candidateId, cardId);
            assert.equal(await page.locator('#star').getAttribute(
                'data-ai-web-test-candidate'
            ), result.candidates[0].candidateId);
        } finally {
            await browser.close(session);
        }
    }).timeout(15_000);

    it('真实 ariaSnapshot 经 ax-* transient target 完成浏览器执行', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        try {
            const page = browser.getPage(session);
            await page.setContent([
                '<x-star></x-star><script>',
                'customElements.define("x-star",class extends HTMLElement{',
                'connectedCallback(){const root=this.attachShadow({mode:"open"});',
                'root.innerHTML="<button aria-label=\\"收藏星标\\">★</button>";',
                'root.querySelector("button").onclick=()=>',
                'document.body.dataset.favorite="true"}})</script>'
            ].join(''));
            const observation = await browser.observe(session);
            assert.equal(observation.interactiveElements.length, 0);
            const perception = await new PerceptionService(
                new PlaywrightPagePerceptionAdapter(browser)
            ).capture(session, observation, undefined, signal());
            assert.equal(perception.accessibility.nodes.some(
                ({ name }) => name === '收藏星标'
            ), true);
            const action: SemanticAction = {
                ...createClickAction(),
                target: { description: '收藏星标' }
            };
            const decision = await new CompositeTargetGrounder(
                new PlaywrightCandidateMappingAdapter(browser),
                new DisabledVisualGroundingAdapter()
            ).ground({
                action,
                perception,
                session,
                visualAllowed: false
            }, signal());

            assert.equal(decision.status, 'grounded', decision.summary);
            assert.match(decision.target!.candidateId, /^ax-/u);
            const result = await browser.execute(
                session,
                {
                    type: 'CLICK',
                    target: {
                        candidateId: decision.target!.candidateId,
                        description: '收藏星标'
                    },
                    expectedEffect: '应用被收藏',
                    reasonSummary: '执行 A11y transient candidate'
                },
                decision.target!
            );
            assert.equal(result.status, 'executed');
            assert.equal(await page.locator('body').getAttribute(
                'data-favorite'
            ), 'true');
        } finally {
            await browser.close(session);
        }
    }).timeout(15_000);

    it('视觉区域没有动作兼容元素时返回 unmapped，不创建坐标目标', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        try {
            const page = browser.getPage(session);
            await page.setContent('<span id="plain">仅展示文本</span>');
            const observation = await browser.observe(session);
            const box = await page.locator('#plain').boundingBox();
            assert.ok(box);
            const result = await new PlaywrightCandidateMappingAdapter(
                browser
            ).map(
                session,
                createPerception(observation),
                createClickAction(),
                { source: 'visual', regions: [ createRegion(box) ] },
                new AbortController().signal
            );

            assert.equal(result.status, 'unmapped');
            assert.deepEqual(result.candidates, []);
            assert.equal(await page.locator('#plain').getAttribute(
                'data-ai-web-test-candidate'
            ), null);
        } finally {
            await browser.close(session);
        }
    }).timeout(15_000);

    it('多点 hit-test：部分采样点可接收则可执行，全部遮挡才 blocked', async () => {
        const browser = new PlaywrightBrowserAdapter();
        const session = await browser.start(START_OPTIONS);
        try {
            const page = browser.getPage(session);
            await page.setContent([
                '<button id="target" style="position:fixed;left:20px;',
                'top:20px;width:100px;height:100px">目标</button>',
                '<div id="overlay" style="position:fixed;left:60px;',
                'top:60px;width:20px;height:20px;z-index:2"></div>'
            ].join(''));
            const observation = await browser.observe(session);
            const candidateId = observation.interactiveElements.find(
                ({ attributes }) => attributes.id === 'target'
            )?.candidateId;
            assert.ok(candidateId);

            const locator = browser.getCandidateLocator(
                session,
                observation.observationId,
                candidateId
            );
            assert.ok(locator);
            const partial = await captureInteractionState(
                locator,
                candidateId
            );
            assert.equal(partial?.hitTest, 'receives-events');

            await page.evaluate(String.raw`document.querySelector('#overlay')
                .setAttribute('style', 'position:fixed;left:20px;top:20px;' +
                    'width:100px;height:100px;z-index:2')`);
            const covered = await captureInteractionState(
                locator,
                candidateId
            );
            assert.equal(covered?.hitTest, 'blocked');
            assert.equal(covered?.blockedBy?.tag, 'div');
        } finally {
            await browser.close(session);
        }
    }).timeout(15_000);
});

function createClickAction(): SemanticAction {
    return {
        type: 'CLICK',
        target: {
            description: '收藏星标',
            scope: '应用 11'
        },
        expectedEffect: '应用 11 被收藏',
        reasonSummary: '下一语义动作明确'
    };
}

function createPerception(
    dom: PagePerception['dom']
): PagePerception {
    return {
        perceptionId: 'perception-1',
        capturedAt: dom.capturedAt,
        accessibility: {
            nodes: [],
            source: 'playwright-aria-snapshot',
            truncated: false
        },
        dom,
        interactionStates: {}
    };
}

function createRegion(
    boundingBox: VisualRegion['boundingBox']
): VisualRegion {
    return {
        id: 'visual-region-1',
        boundingBox,
        context: [ '应用 11' ],
        description: '收藏星标'
    };
}

function signal(): AbortSignal {
    return new AbortController().signal;
}
