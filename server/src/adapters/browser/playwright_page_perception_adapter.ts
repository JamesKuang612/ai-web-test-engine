import { createHash } from 'node:crypto';

import type {
    AccessibilityAncestor,
    AccessibilityNode,
    BoundingBox,
    BrowserSession,
    CapturedPerceptionSignals,
    PageObservation,
    PagePerceptionPort,
} from '@ai-web-test-engine/core';
import { parseDocument } from 'yaml';

import { captureInteractionState } from './playwright_element_evidence';
import type { PlaywrightPageProvider } from './playwright_page_provider';

const MAX_ACCESSIBILITY_NODES = 200;
const MAX_ACCESSIBILITY_DEPTH = 12;
const MAX_ANCESTORS = 4;
interface ParsedAriaNode extends Omit<AccessibilityNode, 'id'> {
    children: ParsedAriaNode[];
    ref?: string;
}

/** 使用 Playwright AI aria snapshot 采集独立、bounded A11y 表示。 */
export class PlaywrightPagePerceptionAdapter implements PagePerceptionPort {
    constructor(private readonly pageProvider: PlaywrightPageProvider) {}

    public capture = async (
        session: BrowserSession,
        observation: PageObservation,
        signal: AbortSignal
    ): Promise<CapturedPerceptionSignals> => {
        signal.throwIfAborted();
        if (!this.pageProvider.isObservationCurrent(
            session,
            observation.observationId
        )) {
            throw new Error('页面 observation 已过期，无法采集 Perception。');
        }
        const page = this.pageProvider.getPage(session);
        const yaml = await page.ariaSnapshot({
            boxes: true,
            depth: MAX_ACCESSIBILITY_DEPTH,
            mode: 'ai',
            signal,
            timeout: 5_000
        });
        signal.throwIfAborted();
        const parsed = parseAriaSnapshot(yaml);
        const flattened = flattenAriaNodes(parsed).slice(
            0,
            MAX_ACCESSIBILITY_NODES
        );
        const nodes: AccessibilityNode[] = [];
        const identityCounts = new Map<string, number>();
        for (const node of flattened) {
            signal.throwIfAborted();
            const identity = accessibilityIdentity(node);
            const occurrence = (identityCounts.get(identity) ?? 0) + 1;
            identityCounts.set(identity, occurrence);
            const id = createStableAccessibilityId(identity, occurrence);
            if (node.ref) {
                this.pageProvider.registerAccessibilityRef(
                    session,
                    observation.observationId,
                    id,
                    node.ref
                );
            }
            const {
                children: _children,
                ref: _ref,
                ...snapshot
            } = node;
            nodes.push({
                ...snapshot,
                id
            });
        }
        const interactionStates = Object.fromEntries((await Promise.all(
            this.pageProvider.getCandidateIds(
                session,
                observation.observationId
            ).map(async (candidateId) => {
                const locator = this.pageProvider.getCandidateLocator(
                    session,
                    observation.observationId,
                    candidateId
                );
                const state = locator
                    ? await captureInteractionState(locator, candidateId)
                    : undefined;
                return state ? [ candidateId, state ] as const : undefined;
            })
        )).filter((entry): entry is readonly [string, NonNullable<
        typeof entry
        >[1]] => entry !== undefined));
        return {
            accessibility: {
                nodes,
                source: 'playwright-aria-snapshot',
                truncated: flattenAriaNodes(parsed).length >
                    MAX_ACCESSIBILITY_NODES
            },
            interactionStates
        };
    };

}

/** 将 Playwright YAML 解析为不包含临时 ref 的内部树。 */
export function parseAriaSnapshot(yaml: string): ParsedAriaNode[] {
    const document = parseDocument(yaml);
    if (document.errors.length > 0) {
        throw new Error(`Accessibility snapshot 解析失败：${
            document.errors[0].message
        }`);
    }
    return parseAriaValue(document.toJS(), []);
}

function parseAriaValue(
    value: unknown,
    ancestors: AccessibilityAncestor[]
): ParsedAriaNode[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => parseAriaValue(item, ancestors));
    }
    if (typeof value === 'string') {
        const node = parseAriaKey(value, ancestors);
        return node ? [ node ] : [];
    }
    if (!isRecord(value)) {
        return [];
    }
    return Object.entries(value).flatMap(([ key, children ]) => {
        const node = parseAriaKey(key, ancestors);
        if (!node) {
            return parseAriaValue(children, ancestors);
        }
        const nextAncestors = [
            ...ancestors,
            {
                ...node.role ? { role: node.role } : {},
                ...node.name ? { name: node.name } : {}
            }
        ].slice(-MAX_ANCESTORS);
        node.children = parseAriaValue(children, nextAncestors);
        return [ node ];
    });
}

function parseAriaKey(
    key: string,
    ancestors: AccessibilityAncestor[]
): ParsedAriaNode | undefined {
    const match = /^([a-z][\w-]*)(?:\s+"((?:\\.|[^"])*)")?(.*)$/iu.exec(
        key.trim()
    );
    if (!match) {
        return undefined;
    }
    const attributes = match[3];
    const box = parseBoundingBox(attributes);
    const checked = /\[checked=(true|false|mixed)\]/u.exec(attributes)?.[1];
    return {
        ancestors: ancestors.slice(-MAX_ANCESTORS),
        children: [],
        role: match[1],
        ...match[2] ? { name: match[2].replace(/\\"/gu, '"') } : {},
        ...box ? { boundingBox: box } : {},
        .../\[disabled(?:=true)?\]/u.test(attributes)
            ? { disabled: true }
            : {},
        ...checked
            ? {
                checked: checked === 'mixed'
                    ? 'mixed'
                    : checked === 'true'
            }
            : {},
        .../\[expanded=true\]/u.test(attributes) ? { expanded: true } : {},
        .../\[expanded=false\]/u.test(attributes) ? { expanded: false } : {},
        .../\[selected(?:=true)?\]/u.test(attributes)
            ? { selected: true }
            : {},
        ref: /\[ref=([^\]]+)\]/u.exec(attributes)?.[1]
    };
}

function parseBoundingBox(value: string): BoundingBox | undefined {
    const match = /\[box=(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)\]/u.exec(
        value
    );
    if (!match) {
        return undefined;
    }
    const [ x, y, width, height ] = match.slice(1).map(Number);
    return [ x, y, width, height ].every(Number.isFinite) &&
        width > 0 && height > 0
        ? { height, width, x, y }
        : undefined;
}

function flattenAriaNodes(nodes: ParsedAriaNode[]): ParsedAriaNode[] {
    return nodes.flatMap((node) => [
        node,
        ...flattenAriaNodes(node.children)
    ]).filter((node) => Boolean(node.ref || node.name));
}

function accessibilityIdentity(node: ParsedAriaNode): string {
    return JSON.stringify({
        ancestors: node.ancestors,
        name: node.name ?? '',
        role: node.role ?? ''
    });
}

function createStableAccessibilityId(
    identity: string,
    occurrence: number
): string {
    return `axnode-${ createHash('sha256')
        .update(`${ identity }#${ occurrence }`)
        .digest('hex')
        .slice(0, 12) }`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
