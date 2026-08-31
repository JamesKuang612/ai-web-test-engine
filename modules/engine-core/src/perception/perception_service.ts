import { randomUUID } from 'node:crypto';

import type {
    AccessibilityNode,
    PageObservation,
    PagePerception,
    PerceptionDelta,
} from '../contracts';
import type {
    BrowserSession,
    PagePerceptionPort,
} from '../ports';

const MAX_DELTA_ITEMS = 100;

/** 组合已有 DOM Observation 与浏览器独立感知信号。 */
export class PerceptionService {
    constructor(private readonly perceptionPort: PagePerceptionPort) {}

    public async capture(
        session: BrowserSession,
        observation: PageObservation,
        previous: PagePerception | undefined,
        signal: AbortSignal
    ): Promise<PagePerception> {
        signal.throwIfAborted();
        const signals = await this.perceptionPort.capture(
            session,
            observation,
            signal
        );
        signal.throwIfAborted();
        const perception: PagePerception = {
            perceptionId: randomUUID(),
            capturedAt: new Date().toISOString(),
            accessibility: signals.accessibility,
            dom: observation,
            interactionStates: signals.interactionStates,
            visual: {
                regions: [],
                ...observation.screenshotRef
                    ? { screenshotRef: observation.screenshotRef }
                    : {}
            }
        };
        return previous
            ? {
                ...perception,
                delta: createPerceptionDelta(previous, perception)
            }
            : perception;
    }
}
/** 只比较已采集的紧凑数据，不调用模型或浏览器。 */
export function createPerceptionDelta(
    before: PagePerception,
    after: PagePerception
): PerceptionDelta {
    const candidateDelta = diffSets(
        before.dom.interactiveElements.map(({ candidateId }) => candidateId),
        after.dom.interactiveElements.map(({ candidateId }) => candidateId)
    );
    const textDelta = diffSets(
        before.dom.visibleText,
        after.dom.visibleText
    );
    const accessibilityDelta = diffAccessibility(
        before.accessibility.nodes,
        after.accessibility.nodes
    );
    const beforeOverlay = getOverlayState(before);
    const afterOverlay = getOverlayState(after);
    return {
        accessibility: accessibilityDelta,
        candidates: candidateDelta,
        overlayState: {
            after: afterOverlay,
            before: beforeOverlay,
            changed: beforeOverlay !== afterOverlay
        },
        titleChanged: before.dom.page.title !== after.dom.page.title,
        urlChanged: before.dom.page.url !== after.dom.page.url,
        visibleText: textDelta
    };
}

function diffAccessibility(
    before: AccessibilityNode[],
    after: AccessibilityNode[]
): PerceptionDelta['accessibility'] {
    const beforeById = new Map(before.map((node) => [ node.id, node ]));
    const afterById = new Map(after.map((node) => [ node.id, node ]));
    const added = after
        .filter(({ id }) => !beforeById.has(id))
        .map(({ id }) => id);
    const removed = before
        .filter(({ id }) => !afterById.has(id))
        .map(({ id }) => id);
    const changed = after.flatMap((node) => {
        const previous = beforeById.get(node.id);
        return previous && accessibilitySignature(previous) !==
            accessibilitySignature(node)
            ? [ node.id ]
            : [];
    });
    return boundDelta({ added, changed, removed });
}

function accessibilitySignature(node: AccessibilityNode): string {
    return JSON.stringify({
        role: node.role,
        name: node.name,
        description: node.description,
        disabled: node.disabled,
        checked: node.checked,
        expanded: node.expanded,
        selected: node.selected,
        candidateId: node.domCandidateId
    });
}

function diffSets(
    before: string[],
    after: string[]
): {
    added: string[],
    removed: string[],
    truncated: boolean
} {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return boundDelta({
        added: after.filter((value) => !beforeSet.has(value)),
        removed: before.filter((value) => !afterSet.has(value))
    });
}

function boundDelta<T extends Record<string, string[]>>(
    delta: T
): T & { truncated: boolean } {
    let remaining = MAX_DELTA_ITEMS;
    let truncated = false;
    const bounded = Object.fromEntries(Object.entries(delta).map(
        ([ key, values ]) => {
            const selected = values.slice(0, remaining);
            remaining -= selected.length;
            truncated ||= selected.length < values.length;
            return [ key, selected ];
        }
    )) as T;
    return {
        ...bounded,
        truncated
    };
}

function getOverlayState(
    perception: PagePerception
): PerceptionDelta['overlayState']['before'] {
    const states = Object.values(perception.interactionStates);
    if (states.some(({ hitTest }) => hitTest === 'blocked')) {
        return 'blocked';
    }
    return states.length > 0 && states.every(
        ({ hitTest }) => hitTest === 'receives-events'
    )
        ? 'clear'
        : 'unknown';
}
