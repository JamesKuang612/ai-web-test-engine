import assert from 'node:assert/strict';
import type {
    PagePerception,
    SemanticTarget,
} from '@ai-web-test-engine/core';
import {
    buildVisualLocatePrompt,
} from '../../../../src/adapters/visual';

describe('MidsceneVisualGroundingAdapter', () => {
    it('视觉定位 Prompt 使用 description/scope，但忽略 relation', () => {
        const target: SemanticTarget = {
            description: '收藏星标',
            scope: '应用 11',
            relation: '应用名称左上角'
        };
        const prompt = buildVisualLocatePrompt(target, createPerception());

        assert.match(prompt, /收藏星标/u);
        assert.match(prompt, /应用 11/u);
        assert.doesNotMatch(prompt, /左上角/u);
        assert.match(prompt, /不要点击、悬浮、滚动/u);
    });
});

function createPerception(): PagePerception {
    return {
        perceptionId: 'perception-1',
        capturedAt: '2026-08-31T00:00:00.000Z',
        accessibility: {
            nodes: [],
            source: 'playwright-aria-snapshot',
            truncated: false
        },
        dom: {
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
            interactiveElements: [],
            notices: [],
            tabs: [],
            stateFingerprint: 'fingerprint-1',
            truncated: false
        },
        interactionStates: {}
    };
}
