import { randomUUID } from 'node:crypto';

import type {
    ActionType,
    CandidateMappingPort,
    CandidateMappingResult,
    MappedCandidate,
    ResolvedElementSnapshot,
    VisualRegion,
} from '@ai-web-test-engine/core';

import {
    RUNTIME_CANDIDATE_ATTRIBUTE,
} from './interactive_element_script';
import {
    captureElementSnapshot,
    captureInteractionState,
} from './playwright_element_evidence';
import type {
    PlaywrightPageProvider,
} from './playwright_page_provider';

interface VisualDomMapping {
    candidateId?: string;
    created: boolean;
    status: 'ambiguous' | 'mapped' | 'unmapped';
}

const VISUAL_MAPPING_SCRIPT = String.raw`(input) => {
    const region = input.region;
    const points = [
        [0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]
    ].map(([rx, ry]) => ({
        x: region.x + region.width * rx,
        y: region.y + region.height * ry
    })).filter(({x, y}) =>
        x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
    );
    const hits = points.map(({x, y}) => document.elementFromPoint(x, y))
        .filter(Boolean);
    if (hits.length === 0) return { status: 'unmapped', created: false };
    const existing = new Set(hits.map((hit) =>
        hit.closest('[' + input.attribute + ']')
            ?.getAttribute(input.attribute)
    ).filter(Boolean));
    if (existing.size === 1) {
        return {
            status: 'mapped', created: false,
            candidateId: Array.from(existing)[0]
        };
    }
    if (existing.size > 1) return { status: 'ambiguous', created: false };
    const visible = (element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
    };
    const compatible = (element) => {
        if (!visible(element)) return false;
        if (input.actionType === 'HOVER') return true;
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
            return false;
        }
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role');
        const type = (element.getAttribute('type') || '').toLowerCase();
        if (input.actionType === 'TYPE') {
            return ['input', 'textarea'].includes(tag) || role === 'textbox' ||
                element.getAttribute('contenteditable') === 'true';
        }
        if (input.actionType === 'SELECT') {
            return tag === 'select' || ['combobox', 'listbox'].includes(role);
        }
        if (input.actionType === 'CHECK') {
            return ['checkbox', 'radio'].includes(role) ||
                ['checkbox', 'radio'].includes(type);
        }
        if (input.actionType !== 'CLICK') return true;
        return ['a', 'button', 'input', 'option', 'select', 'summary'].includes(tag) ||
            ['button', 'checkbox', 'link', 'menuitem', 'option', 'radio',
                'switch', 'tab'].includes(role) ||
            element.hasAttribute('onclick') ||
            element.hasAttribute('aria-haspopup') ||
            window.getComputedStyle(element).cursor === 'pointer';
    };
    const candidates = [];
    for (const hit of hits) {
        let current = hit;
        for (let depth = 0; current && depth < 7; depth += 1) {
            if (compatible(current)) {
                candidates.push(current);
                break;
            }
            current = current.parentElement;
        }
    }
    if (candidates.length === 0) {
        return { status: 'unmapped', created: false };
    }
    let selected = candidates[0];
    for (const candidate of candidates.slice(1)) {
        if (candidate === selected || selected.contains(candidate)) continue;
        if (candidate.contains(selected)) {
            selected = candidate;
            continue;
        }
        return { status: 'ambiguous', created: false };
    }
    selected.setAttribute(input.attribute, input.candidateId);
    return {
        status: 'mapped', created: true, candidateId: input.candidateId
    };
}`;

/** 将 A11y/Visual evidence 安全映射到当前 observation 的 live DOM。 */
export class PlaywrightCandidateMappingAdapter
implements CandidateMappingPort {
    constructor(private readonly pageProvider: PlaywrightPageProvider) {}

    public map: CandidateMappingPort['map'] = async (
        session,
        perception,
        action,
        evidence,
        signal
    ): Promise<CandidateMappingResult> => {
        signal.throwIfAborted();
        const observationId = perception.dom.observationId;
        if (!this.pageProvider.isObservationCurrent(session, observationId)) {
            return unmapped('页面 observation 已过期，拒绝映射物理目标。');
        }
        if (!action.target) {
            return unmapped('语义动作没有页面目标。');
        }
        if (evidence.source === 'accessibility') {
            const ids = unique(evidence.nodes.flatMap((node) =>
                node.domCandidateId ? [ node.domCandidateId ] : []
            ));
            return await this.mapCandidateIds(
                session,
                observationId,
                action.type,
                ids,
                [ 'bounded accessibility 节点已映射到 live DOM' ]
            );
        }

        const mappings: VisualDomMapping[] = [];
        for (const region of evidence.regions) {
            signal.throwIfAborted();
            mappings.push(await this.mapVisualRegion(
                session,
                observationId,
                action.type,
                region
            ));
        }
        if (mappings.some(({ status }) => status === 'ambiguous')) {
            return {
                status: 'ambiguous',
                candidates: [],
                evidence: [ '视觉区域命中了多个无关的可执行元素' ],
                summary: '视觉区域无法唯一映射到 live DOM 元素。'
            };
        }
        const ids = unique(mappings.flatMap(({ candidateId, status }) =>
            status === 'mapped' && candidateId ? [ candidateId ] : []
        ));
        return await this.mapCandidateIds(
            session,
            observationId,
            action.type,
            ids,
            [
                '视觉 bbox 已通过 elementsFromPoint 映射到 live DOM',
                ...mappings.some(({ created }) => created)
                    ? [ '已注册 observation 生命周期 visual-* candidate' ]
                    : []
            ]
        );
    };

    private async mapVisualRegion(
        session: Parameters<CandidateMappingPort['map']>[0],
        observationId: string,
        actionType: ActionType,
        region: VisualRegion
    ): Promise<VisualDomMapping> {
        if (region.mappedCandidateId) {
            return {
                candidateId: region.mappedCandidateId,
                created: false,
                status: 'mapped'
            };
        }
        const page = this.pageProvider.getPage(session);
        const candidateId = `visual-${ randomUUID().slice(0, 12) }`;
        const result = await page.evaluate(`(${ VISUAL_MAPPING_SCRIPT })(${
            JSON.stringify({
                actionType,
                attribute: RUNTIME_CANDIDATE_ATTRIBUTE,
                candidateId,
                region: region.boundingBox
            })
        })`) as VisualDomMapping;
        if (result.status === 'mapped' && result.candidateId && result.created) {
            this.pageProvider.registerTransientCandidate(
                session,
                observationId,
                result.candidateId,
                page.locator(
                    `[${ RUNTIME_CANDIDATE_ATTRIBUTE }="${
                        result.candidateId
                    }"]`
                )
            );
        }
        return result;
    }

    private async mapCandidateIds(
        session: Parameters<CandidateMappingPort['map']>[0],
        observationId: string,
        actionType: ActionType,
        candidateIds: string[],
        evidence: string[]
    ): Promise<CandidateMappingResult> {
        if (candidateIds.length === 0) {
            return unmapped('感知证据无法映射到安全的 live DOM 元素。');
        }
        if (candidateIds.length > 1) {
            return {
                status: 'ambiguous',
                candidates: [],
                evidence,
                summary: `感知证据映射到 ${ candidateIds.length } 个不同元素。`
            };
        }
        const page = this.pageProvider.getPage(session);
        const candidates = (await Promise.all(candidateIds.map(
            async (candidateId): Promise<MappedCandidate | undefined> => {
                if (!this.pageProvider.getCandidateLocator(
                    session,
                    observationId,
                    candidateId
                )) {
                    return undefined;
                }
                const [ elementSnapshot, interactionState ] =
                    await Promise.all([
                        captureElementSnapshot(page, candidateId),
                        captureInteractionState(page, candidateId)
                    ]);
                if (!elementSnapshot || !interactionState) {
                    return undefined;
                }
                return {
                    actionCompatible: isActionCompatible(
                        actionType,
                        elementSnapshot
                    ),
                    candidateId,
                    elementSnapshot,
                    evidence: [ ...evidence, `candidate=${ candidateId }` ],
                    interactionState
                };
            }
        ))).filter((candidate): candidate is MappedCandidate =>
            candidate !== undefined
        );
        return candidates.length === 1
            ? {
                status: 'mapped',
                candidates,
                evidence: candidates[0].evidence,
                summary: '感知证据已唯一映射到当前页面元素。'
            }
            : unmapped('映射后的 live DOM 元素已经失效。');
    }
}

function isActionCompatible(
    actionType: ActionType,
    element: ResolvedElementSnapshot
): boolean {
    if (actionType === 'HOVER') {
        return element.visible && Boolean(element.boundingBox);
    }
    if (actionType === 'TYPE') {
        return element.role === 'textbox' ||
            [ 'input', 'textarea' ].includes(element.tag) ||
            element.attributes.contenteditable === 'true';
    }
    if (actionType === 'SELECT') {
        return element.tag === 'select' ||
            [ 'combobox', 'listbox' ].includes(element.role ?? '');
    }
    if (actionType === 'CHECK') {
        return [ 'checkbox', 'radio' ].includes(element.role ?? '') ||
            [ 'checkbox', 'radio' ].includes(element.attributes.type ?? '');
    }
    if (actionType === 'CLICK') {
        return [ 'a', 'button', 'input', 'option', 'select', 'summary' ]
            .includes(element.tag) || [
                'button', 'checkbox', 'link', 'menuitem', 'option',
                'radio', 'switch', 'tab'
            ].includes(element.role ?? '') ||
            element.attributes['aria-haspopup'] !== undefined;
    }
    return true;
}

function unique(values: string[]): string[] {
    return [ ...new Set(values) ];
}

function unmapped(summary: string): CandidateMappingResult {
    return {
        status: 'unmapped',
        candidates: [],
        evidence: [],
        summary
    };
}
