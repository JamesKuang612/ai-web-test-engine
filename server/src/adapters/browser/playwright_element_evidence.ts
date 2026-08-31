import type {
    ElementInteractionState,
    ResolvedElementSnapshot,
} from '@ai-web-test-engine/core';
import type {
    Locator,
} from 'playwright';
import vm from 'node:vm';

const SNAPSHOT_SCRIPT = String.raw`(element) => {
    const clean = (value, limit = 200) => {
        const normalized = value && String(value).replace(/\s+/gu, ' ').trim();
        return normalized ? normalized.slice(0, limit) : undefined;
    };
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    const role = element.getAttribute('role') || (
        tag === 'button' ? 'button' :
        tag === 'a' ? 'link' :
        tag === 'select' ? 'combobox' :
        tag === 'textarea' ? 'textbox' :
        tag === 'input' && ['checkbox', 'radio'].includes(type) ? type :
        tag === 'input' ? 'textbox' : undefined
    );
    const label = 'labels' in element && element.labels
        ? clean(Array.from(element.labels).map((item) => item.innerText).join(' '))
        : undefined;
    const text = clean(element.innerText || element.textContent);
    const name = clean(
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        label || text
    );
    const id = clean(element.getAttribute('id'), 100);
    const testId = clean(element.getAttribute('data-testid'), 100);
    const placeholder = clean(element.getAttribute('placeholder'));
    const attributes = {};
    for (const key of [
        'id', 'class', 'type', 'name', 'href', 'title', 'aria-label',
        'aria-haspopup', 'aria-controls', 'data-testid', 'contenteditable'
    ]) {
        const value = clean(element.getAttribute(key), 200);
        if (value) attributes[key] = value;
    }
    const locatorHints = [{ strategy: 'css', value: tag }];
    if (id) locatorHints.unshift({ strategy: 'css', value: '#' + CSS.escape(id) });
    if (testId) locatorHints.unshift({ strategy: 'test-id', value: testId });
    if (placeholder) locatorHints.unshift({
        strategy: 'placeholder', value: placeholder
    });
    if (role && name) locatorHints.unshift({
        strategy: 'role-name', value: role + '|' + name
    });
    const parentText = clean(element.parentElement?.innerText);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
    const inViewport = box.right > 0 && box.bottom > 0 &&
        box.left < window.innerWidth && box.top < window.innerHeight;
    return {
        tag,
        role,
        name,
        text,
        label,
        placeholder,
        disabled: Boolean(element.disabled) ||
            element.getAttribute('aria-disabled') === 'true',
        checked: 'checked' in element ? Boolean(element.checked) : undefined,
        visible,
        inViewport,
        attributes,
        nearbyText: parentText && parentText !== text ? [parentText] : [],
        boundingBox: box.width > 0 && box.height > 0 ? {
            x: box.x, y: box.y, width: box.width, height: box.height
        } : undefined,
        locatorHints: locatorHints.slice(0, 5)
    };
}`;

const INTERACTION_SCRIPT = String.raw`(element, input) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
    const inViewport = box.right > 0 && box.bottom > 0 &&
        box.left < window.innerWidth && box.top < window.innerHeight;
    const enabled = !Boolean(element.disabled) &&
        element.getAttribute('aria-disabled') !== 'true';
    const points = [
        [0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]
    ].map(([rx, ry]) => ({
        x: box.left + box.width * rx,
        y: box.top + box.height * ry
    })).filter(({x, y}) =>
        x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
    );
    let receives = 0;
    let blocked = 0;
    let unknown = 0;
    let blocker;
    const deepElementFromPoint = (x, y) => {
        let hit = document.elementFromPoint(x, y);
        while (hit?.shadowRoot) {
            const nested = hit.shadowRoot.elementFromPoint(x, y);
            if (!nested || nested === hit) break;
            hit = nested;
        }
        return hit;
    };
    for (const point of points) {
        const hit = deepElementFromPoint(point.x, point.y);
        if (!hit) {
            unknown += 1;
            continue;
        }
        if (hit === element || element.contains(hit)) {
            receives += 1;
            continue;
        }
        blocked += 1;
        if (!blocker) {
            blocker = {
                tag: hit.tagName.toLowerCase(),
                role: hit.getAttribute('role') || undefined,
                name: hit.getAttribute('aria-label') ||
                    hit.getAttribute('title') || undefined,
                text: (hit.innerText || hit.textContent || '')
                    .replace(/\s+/gu, ' ').trim().slice(0, 120) || undefined
            };
        }
    }
    const hitTest = receives > 0
        ? 'receives-events'
        : points.length > 0 && blocked === points.length
            ? 'blocked'
            : 'unknown';
    return {
        candidateId: input.candidateId,
        enabled,
        hitTest,
        inViewport,
        visible,
        blockedBy: hitTest === 'blocked' ? blocker : undefined,
        samples: { receives, blocked, unknown, total: points.length }
    };
}`;

const snapshotEvaluator = vm.runInThisContext(
    `(${ SNAPSHOT_SCRIPT })`
) as (element: unknown) => ResolvedElementSnapshot;
const interactionEvaluator = vm.runInThisContext(
    `(${ INTERACTION_SCRIPT })`
) as (
    element: unknown,
    input: { candidateId: string }
) => ElementInteractionState & {
    samples: {
        blocked: number,
        receives: number,
        total: number,
        unknown: number
    }
};

export async function captureElementSnapshot(
    locator: Locator
): Promise<ResolvedElementSnapshot | undefined> {
    return await locator.count() === 1
        ? await locator.evaluate(snapshotEvaluator)
        : undefined;
}

export async function captureInteractionState(
    locator: Locator,
    candidateId: string
): Promise<ElementInteractionState | undefined> {
    if (await locator.count() !== 1) {
        return undefined;
    }
    const result = await locator.evaluate(
        interactionEvaluator,
        { candidateId }
    );
    if (!result) {
        return undefined;
    }
    const { samples: _samples, ...state } = result;
    return state;
}
