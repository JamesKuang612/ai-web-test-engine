import type {
    ActionType,
    GroundingDecision,
    ObservedElement,
    PageObservation,
    ResolvedElementSnapshot,
    SemanticAction,
    SemanticTarget,
} from '../contracts';
import type {
    TargetGrounder,
} from './target_grounder';

interface RankedCandidate {
    element: ObservedElement;
    primaryMatch: number;
    contextMatch: number;
    evidence: string[];
}

const CLICKABLE_ROLES = new Set([
    'button',
    'checkbox',
    'link',
    'menuitem',
    'option',
    'radio',
    'switch',
    'tab'
]);
const CLICKABLE_TAGS = new Set([
    'a',
    'button',
    'input',
    'option',
    'select',
    'summary'
]);
const TARGET_ACTIONS = new Set<ActionType>([
    'CHECK',
    'CLICK',
    'HOVER',
    'INSPECT',
    'SCROLL',
    'SELECT',
    'TYPE'
]);

/** 只使用当前 PageObservation，保守地完成第一阶段语义目标绑定。 */
export class DeterministicTargetGrounder implements TargetGrounder {
    public async ground(
        action: SemanticAction,
        observation: PageObservation,
        signal: AbortSignal
    ): Promise<GroundingDecision> {
        signal.throwIfAborted();
        if (!TARGET_ACTIONS.has(action.type) || !action.target) {
            return this.notFound('当前语义动作不需要或没有提供页面目标。');
        }

        const semanticMatches = observation.interactiveElements
            .map((element) => this.rankCandidate(action.target!, element))
            .filter((candidate): candidate is RankedCandidate =>
                candidate !== undefined
            );
        if (semanticMatches.length === 0) {
            return this.notFound(
                `当前页面没有与“${ action.target.description }”可靠匹配的元素。`
            );
        }

        const compatible = semanticMatches.filter(({ element }) =>
            this.isCompatible(action.type, element)
        );
        if (compatible.length === 0) {
            const disabled = semanticMatches.filter(({ element }) =>
                element.disabled && action.type !== 'HOVER'
            );
            if (disabled.length > 0) {
                return {
                    status: 'blocked',
                    confidence: 1,
                    evidence: disabled.flatMap(({ evidence }) => evidence),
                    summary: `与“${ action.target.description }”匹配的元素当前处于 disabled 状态。`
                };
            }
            return this.notFound(
                `与“${ action.target.description }”匹配的元素不满足 ${ action.type } 的确定性执行条件。`
            );
        }

        const ranked = compatible.sort(compareCandidates);
        const best = ranked[0];
        const equallyRanked = ranked.filter((candidate) =>
            candidate.primaryMatch === best.primaryMatch
            && candidate.contextMatch === best.contextMatch
        );
        if (equallyRanked.length !== 1) {
            return {
                status: 'ambiguous',
                confidence: 0,
                evidence: equallyRanked.flatMap(({ evidence }) => evidence),
                summary: `当前页面有 ${ equallyRanked.length } 个元素同等匹配“${ action.target.description }”。`
            };
        }

        const confidence = best.primaryMatch === 3
            ? best.contextMatch > 0 ? 0.99 : 0.96
            : best.contextMatch > 0 ? 0.9 : 0.84;
        return {
            status: 'grounded',
            confidence,
            evidence: best.evidence,
            summary: `已将“${ action.target.description }”绑定到当前页面唯一目标。`,
            target: {
                description: action.target.description,
                observationId: observation.observationId,
                candidateId: best.element.candidateId,
                elementSnapshot: createElementSnapshot(best.element),
                strategy: 'candidate-id',
                locatorData: {
                    observationId: observation.observationId,
                    candidateId: best.element.candidateId
                },
                confidence,
                unique: true,
                actionable: true,
                evidence: best.evidence
            }
        };
    }

    private rankCandidate(
        target: SemanticTarget,
        element: ObservedElement
    ): RankedCandidate | undefined {
        const primary = [
            ['name', element.name],
            ['label', element.label],
            ['placeholder', element.placeholder],
            ['text', element.text],
            ['visualDescription', element.visualDescription]
        ] as const;
        const primaryMatches = primary.flatMap(([field, value]) => {
            const level = getTextMatchLevel(target.description, value);
            return level > 0 ? [{ field, level, value: value! }] : [];
        });
        const primaryMatch = Math.max(
            0,
            ...primaryMatches.map(({ level }) => level)
        );
        if (primaryMatch < 2) {
            return undefined;
        }

        // relation 是 Phase 2 的前向兼容元数据；当前没有空间感知能力，
        // 因此不能把无法解释的 relation 当成目标不存在的证据。
        const contextRequirements = [ target.scope ]
            .filter((value): value is string => Boolean(value));
        const contextValues = [
            element.name,
            element.label,
            element.text,
            element.visualDescription,
            ...element.nearbyText
        ];
        const contextMatches = contextRequirements.map((requirement) =>
            Math.max(
                0,
                ...contextValues.map((value) =>
                    getTextMatchLevel(requirement, value)
                )
            )
        );
        if (contextMatches.some((level) => level < 2)) {
            return undefined;
        }

        return {
            element,
            primaryMatch,
            contextMatch: contextMatches.reduce(
                (total, level) => total + level,
                0
            ),
            evidence: [
                ...primaryMatches
                    .filter(({ level }) => level === primaryMatch)
                    .map(({ field, value }) =>
                        `${ field } 匹配“${ value }”`
                    ),
                ...contextRequirements.map((requirement) =>
                    `上下文匹配“${ requirement }”`
                )
            ]
        };
    }

    private isCompatible(type: ActionType, element: ObservedElement): boolean {
        if (!element.visible || !hasValidGeometry(element)) {
            return false;
        }
        if (type === 'HOVER') {
            return true;
        }
        if (element.disabled) {
            return false;
        }
        if (type === 'TYPE') {
            return element.role === 'textbox'
                || element.tag === 'input'
                || element.tag === 'textarea'
                || element.attributes.contenteditable === 'true';
        }
        if (type === 'SELECT') {
            return element.tag === 'select'
                || element.role === 'combobox'
                || element.role === 'listbox';
        }
        if (type === 'CHECK') {
            return element.role === 'checkbox'
                || element.role === 'radio'
                || element.attributes.type === 'checkbox'
                || element.attributes.type === 'radio';
        }
        if (type === 'CLICK') {
            return CLICKABLE_TAGS.has(element.tag)
                || Boolean(element.role && CLICKABLE_ROLES.has(element.role))
                || element.attributes['aria-haspopup'] !== undefined;
        }
        return true;
    }

    private notFound(summary: string): GroundingDecision {
        return {
            status: 'not-found',
            confidence: 0,
            evidence: [],
            summary
        };
    }
}

function compareCandidates(
    left: RankedCandidate,
    right: RankedCandidate
): number {
    return right.primaryMatch - left.primaryMatch
        || right.contextMatch - left.contextMatch;
}

function getTextMatchLevel(
    expected: string,
    actual: string | undefined
): number {
    const normalizedExpected = normalizeText(expected);
    const normalizedActual = normalizeText(actual);
    if (!normalizedExpected || !normalizedActual) {
        return 0;
    }
    if (normalizedExpected === normalizedActual) {
        return 3;
    }
    const shorter = normalizedExpected.length <= normalizedActual.length
        ? normalizedExpected
        : normalizedActual;
    if (
        isMeaningfulSubstring(shorter)
        && (
            normalizedExpected.includes(normalizedActual)
            || normalizedActual.includes(normalizedExpected)
        )
    ) {
        return 2;
    }
    return 0;
}

function normalizeText(value: string | undefined): string {
    return value
        ?.normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .trim() ?? '';
}

function isMeaningfulSubstring(value: string): boolean {
    return value.length >= 2 && /[\p{L}\p{Script=Han}]/u.test(value);
}

function hasValidGeometry(element: ObservedElement): boolean {
    const box = element.boundingBox;
    return Boolean(
        box
        && Number.isFinite(box.x)
        && Number.isFinite(box.y)
        && Number.isFinite(box.width)
        && Number.isFinite(box.height)
        && box.width > 0
        && box.height > 0
    );
}

function createElementSnapshot(
    element: ObservedElement
): ResolvedElementSnapshot {
    const {
        candidateId: _candidateId,
        ...snapshot
    } = structuredClone(element);
    return snapshot;
}
