import { createHash } from 'node:crypto';

import type {
    BrowserSession,
    PageStabilityPort,
    PageStabilitySample,
    PageTransientSignal,
} from '@ai-web-test-engine/core';

import type { PlaywrightPageProvider } from './playwright_page_provider';

const MAX_SEMANTIC_CONTROLS = 80;
const MAX_SEMANTIC_TEXT_LINES = 80;
const MAX_SEMANTIC_TEXT_LENGTH = 160;
const DYNAMIC_TOKEN_PATTERN = /\b(?:\d+(?:[.:/-]\d+)*|[a-f\d]{8,})\b/giu;

interface LightweightPageState {
    busy: boolean;
    controls: string[];
    loadingText: boolean;
    pathname: string;
    progressbar: boolean;
    readyState: string;
    semanticText: string[];
    spinner: boolean;
    title: string;
}

const STABILITY_CAPTURE_SCRIPT = String.raw`function(
    maxControls,
    maxTextLines,
    maxTextLength
) {
    const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
    };
    const semanticName = (element) => (
        element.getAttribute('aria-label')
        || element.getAttribute('placeholder')
        || element.getAttribute('title')
        || element.textContent
        || ''
    ).trim().replace(/\s+/gu, ' ').slice(0, 120);
    const controls = Array.from(document.querySelectorAll([
        'button', 'a[href]', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="textbox"]',
        '[role="checkbox"]', '[role="tab"]', '[role="menuitem"]'
    ].join(','))).filter(visible).slice(0, maxControls).map((element) => [
        element.tagName.toLowerCase(),
        element.getAttribute('role') || '',
        semanticName(element),
        element.getAttribute('aria-disabled') || '',
        element.hasAttribute('disabled') ? 'disabled' : ''
    ].join('|'));
    const bodyText = document.body?.innerText || '';
    const semanticText = bodyText.split(/\n+/gu)
        .map((text) => text.trim().replace(/\s+/gu, ' '))
        .filter(Boolean)
        .slice(0, maxTextLines)
        .map((text) => text.slice(0, maxTextLength));
    return {
        busy: Array.from(document.querySelectorAll('[aria-busy="true"]'))
            .some(visible),
        controls,
        loadingText: /搜索中|加载中|正在加载|请稍候|loading|searching/iu
            .test(bodyText),
        pathname: location.origin + location.pathname,
        progressbar: Array.from(document.querySelectorAll(
            '[role="progressbar"],progress'
        )).some(visible),
        readyState: document.readyState,
        semanticText,
        spinner: Array.from(document.querySelectorAll([
            '[class*="spinner" i]', '[class*="loading" i]',
            '[data-loading="true"]'
        ].join(','))).some(visible),
        title: document.title
    };
}`;

/** 采集不包含完整 visibleText、candidateId 和 geometry 的页面稳定性骨架。 */
export class PlaywrightPageStabilityAdapter implements PageStabilityPort {
    constructor(private readonly pageProvider: PlaywrightPageProvider) {}

    public sample = async (
        session: BrowserSession,
        signal: AbortSignal
    ): Promise<PageStabilitySample> => {
        signal.throwIfAborted();
        const page = this.pageProvider.getPage(session);
        const state = await page.evaluate(
            `(${ STABILITY_CAPTURE_SCRIPT })(${
                MAX_SEMANTIC_CONTROLS
            },${ MAX_SEMANTIC_TEXT_LINES },${ MAX_SEMANTIC_TEXT_LENGTH })`
        ) as LightweightPageState;
        signal.throwIfAborted();
        const transientSignals = transientSignalsFor(state);
        const semanticTextDigest = createHash('sha256')
            .update(JSON.stringify(state.semanticText
                .map(normalizeVolatileTokens)
                .filter(Boolean)))
            .digest('hex');
        const normalized = {
            controls: state.controls.map(normalizeVolatileTokens).sort(),
            loading: state.readyState === 'loading',
            pathname: state.pathname,
            semanticTextDigest,
            title: normalizeVolatileTokens(state.title),
            transientSignals
        };
        return {
            capturedAt: new Date().toISOString(),
            fingerprint: createHash('sha256')
                .update(JSON.stringify(normalized))
                .digest('hex'),
            loading: state.readyState === 'loading',
            transientSignals
        };
    };
}

function normalizeVolatileTokens(value: string): string {
    return value.trim().replace(/\s+/gu, ' ')
        .replace(DYNAMIC_TOKEN_PATTERN, '#')
        .slice(0, 160);
}

function transientSignalsFor(state: LightweightPageState): PageTransientSignal[] {
    return [
        ...state.readyState === 'loading'
            ? [ 'document-loading' as const ]
            : [],
        ...state.busy ? [ 'aria-busy' as const ] : [],
        ...state.progressbar ? [ 'progressbar' as const ] : [],
        ...state.spinner ? [ 'spinner' as const ] : [],
        ...state.loadingText ? [ 'loading-text' as const ] : []
    ];
}
