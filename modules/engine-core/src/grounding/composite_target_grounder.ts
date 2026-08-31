import type {
    AccessibilityNode,
    GroundingDecision,
    ResolvedTarget,
    VisualRegion,
} from '../contracts';
import type {
    CandidateMappingPort,
    CandidateMappingResult,
    VisualGroundingPort,
} from '../ports';
import { AccessibilityTargetGrounder } from './accessibility_target_grounder';
import { DeterministicTargetGrounder } from './deterministic_target_grounder';
import type {
    GroundingRequest,
    TargetGrounder,
} from './target_grounder';

/** 按 DOM → A11y → Visual 顺序保守融合多模态目标证据。 */
export class CompositeTargetGrounder implements TargetGrounder {
    constructor(
        private readonly candidateMapper: CandidateMappingPort,
        private readonly visualGrounding: VisualGroundingPort,
        private readonly domGrounder = new DeterministicTargetGrounder(),
        private readonly accessibilityGrounder =
            new AccessibilityTargetGrounder()
    ) {}

    public async ground(
        request: GroundingRequest,
        signal: AbortSignal
    ): Promise<GroundingDecision> {
        signal.throwIfAborted();
        const rawDomDecision = await this.domGrounder.ground(request, signal);
        const domUsedHitTest = rawDomDecision.target && Boolean(
            request.perception.interactionStates[
                rawDomDecision.target.candidateId
            ]
        );
        const domDecision = validateDomInteraction(rawDomDecision, request);
        if (domDecision.status === 'grounded' && request.action.target) {
            const conflict = await this.findDomAccessibilityConflict(
                request,
                domDecision,
                signal
            );
            if (conflict) {
                return conflict;
            }
        }
        if (
            domDecision.status === 'grounded' ||
            domDecision.status === 'blocked' ||
            domDecision.status === 'not-visible' ||
            domDecision.status === 'not-actionable' ||
            !request.action.target
        ) {
            return withUsage(
                domDecision,
                domUsedHitTest
                    ? [ 'dom', 'hit-test' ]
                    : [ 'dom' ],
                0
            );
        }

        const a11yMatches = this.accessibilityGrounder.findMatches(
            request.action.target,
            request.perception.accessibility.nodes
        );
        let a11yDecision: GroundingDecision | undefined;
        if (a11yMatches.length > 0) {
            const mapping = await this.candidateMapper.map(
                request.session,
                request.perception,
                request.action,
                {
                    nodes: a11yMatches,
                    source: 'accessibility'
                },
                signal
            );
            a11yDecision = fromMapping(
                request,
                mapping,
                'accessibility',
                0.9
            );
            if (a11yDecision.status === 'grounded') {
                return a11yDecision;
            }
        }

        return await this.groundWithVisual(
            request,
            a11yMatches,
            a11yDecision,
            domDecision,
            signal
        );
    }

    private async groundWithVisual(
        request: GroundingRequest,
        a11yMatches: AccessibilityNode[],
        a11yDecision: GroundingDecision | undefined,
        domDecision: GroundingDecision,
        signal: AbortSignal
    ): Promise<GroundingDecision> {
        if (!request.visualAllowed) {
            return a11yDecision ?? withUsage(domDecision, [ 'dom' ], 0);
        }
        const visual = await this.visualGrounding.locate(
            request.session,
            request.action.target!,
            request.perception,
            signal
        );
        if (visual.status !== 'located' || visual.regions.length === 0) {
            return withUsage(
                a11yDecision ?? { ...domDecision, summary: visual.summary },
                [
                    'dom',
                    ...a11yMatches.length > 0
                        ? [ 'accessibility' as const ]
                        : [],
                    'visual'
                ],
                visual.modelCalls
            );
        }
        const mapping = await this.candidateMapper.map(
            request.session,
            request.perception,
            request.action,
            { regions: visual.regions, source: 'visual' },
            signal
        );
        return fromMapping(
            request,
            mapping,
            'visual',
            0.85,
            visual.modelCalls,
            visual.regions
        );
    }

    private async findDomAccessibilityConflict(
        request: GroundingRequest,
        domDecision: GroundingDecision,
        signal: AbortSignal
    ): Promise<GroundingDecision | undefined> {
        const exactMatches = this.accessibilityGrounder.findExactMatches(
            request.action.target!,
            request.perception.accessibility.nodes
        );
        if (exactMatches.length === 0) {
            return undefined;
        }
        const mapping = await this.candidateMapper.map(
            request.session,
            request.perception,
            request.action,
            { nodes: exactMatches, source: 'accessibility' },
            signal
        );
        if (mapping.status === 'unmapped') {
            return undefined;
        }
        const candidate = mapping.candidates.length === 1
            ? mapping.candidates[0]
            : undefined;
        if (mapping.status === 'mapped') {
            if (!candidate?.actionCompatible) {
                return undefined;
            }
            if (candidate.candidateId === domDecision.target?.candidateId) {
                return undefined;
            }
        }
        const sourcesUsed = [
            'dom',
            'accessibility',
            ...(mapping.candidates.length > 0 ? [ 'hit-test' as const ] : [])
        ] as const;
        return {
            status: 'ambiguous',
            confidence: 0,
            confidenceBasis: 'deterministic',
            evidence: [
                ...domDecision.evidence,
                ...mapping.evidence,
                `DOM candidate=${ domDecision.target?.candidateId }`,
                ...candidate
                    ? [ `A11y candidate=${ candidate.candidateId }` ]
                    : [ `A11y mapping=${ mapping.status }` ]
            ],
            summary: mapping.status === 'ambiguous'
                ? '强 exact accessibility 证据映射到多个目标。'
                : 'DOM 与强 exact accessibility 证据指向不同目标。',
            usage: {
                sourcesUsed: [ ...sourcesUsed ],
                visualModelCalls: 0
            }
        };
    }
}

function validateDomInteraction(
    decision: GroundingDecision,
    request: GroundingRequest
): GroundingDecision {
    if (decision.status !== 'grounded' || !decision.target) {
        return decision;
    }
    const state = request.perception.interactionStates[
        decision.target.candidateId
    ];
    if (!state) {
        return decision;
    }
    if (!state.visible || !state.inViewport) {
        return {
            status: 'not-visible',
            confidence: 1,
            confidenceBasis: 'deterministic',
            evidence: decision.evidence,
            summary: 'DOM 目标存在，但当前不可见或不在视口内。'
        };
    }
    if (!state.enabled && request.action.type !== 'HOVER') {
        return {
            status: 'not-actionable',
            confidence: 1,
            confidenceBasis: 'deterministic',
            evidence: decision.evidence,
            summary: 'DOM 目标存在，但当前不可执行。'
        };
    }
    return state.hitTest === 'blocked'
        ? {
            status: 'blocked',
            confidence: 1,
            confidenceBasis: 'deterministic',
            evidence: [
                ...decision.evidence,
                '所有有效 hit-test 采样点均被无关元素阻挡'
            ],
            summary: 'DOM 目标存在，但当前被其他元素阻挡。'
        }
        : decision;
}

function fromMapping(
    request: GroundingRequest,
    mapping: CandidateMappingResult,
    source: 'accessibility' | 'visual',
    confidence: number,
    visualModelCalls = 0,
    visualRegions: VisualRegion[] = []
): GroundingDecision {
    const sources = [
        'dom',
        source,
        ...(mapping.candidates.length > 0 ? [ 'hit-test' as const ] : [])
    ] as const;
    const visualEvidence = createVisualEvidence(
        request,
        mapping,
        source,
        visualRegions
    );
    if (mapping.status !== 'mapped' || mapping.candidates.length !== 1) {
        return {
            status: mapping.status === 'ambiguous' ? 'ambiguous' : 'unmapped',
            confidence: 0,
            confidenceBasis: 'deterministic',
            evidence: mapping.evidence,
            summary: mapping.summary,
            ...visualEvidence ? { visualEvidence } : {},
            usage: {
                sourcesUsed: [ ...sources ],
                visualModelCalls
            }
        };
    }
    const candidate = mapping.candidates[0];
    if (
        !candidate.interactionState.visible ||
        !candidate.interactionState.inViewport ||
        !candidate.elementSnapshot.boundingBox
    ) {
        return mappingFailure(
            mapping,
            sources,
            visualModelCalls,
            'not-visible',
            '目标已经映射，但当前不可见或没有有效 geometry。',
            visualEvidence
        );
    }
    if (
        !candidate.actionCompatible ||
        (!candidate.interactionState.enabled && request.action.type !== 'HOVER')
    ) {
        return mappingFailure(
            mapping,
            sources,
            visualModelCalls,
            'not-actionable',
            '目标已经映射，但不满足当前动作的执行条件。',
            visualEvidence
        );
    }
    if (candidate.interactionState.hitTest === 'blocked') {
        return mappingFailure(
            mapping,
            sources,
            visualModelCalls,
            'blocked',
            '目标的所有有效采样点均被无关元素阻挡。',
            visualEvidence
        );
    }
    const target = createMappedTarget(request, candidate, source, confidence);
    return {
        status: 'grounded',
        target,
        confidence,
        confidenceBasis: 'engine-heuristic',
        evidence: candidate.evidence,
        summary: mapping.summary,
        ...visualEvidence ? { visualEvidence } : {},
        usage: {
            sourcesUsed: [ ...sources ],
            visualModelCalls
        }
    };
}

function createMappedTarget(
    request: GroundingRequest,
    candidate: CandidateMappingResult['candidates'][number],
    source: 'accessibility' | 'visual',
    confidence: number
): ResolvedTarget {
    return {
        description: request.action.target!.description,
        observationId: request.perception.dom.observationId,
        candidateId: candidate.candidateId,
        elementSnapshot: candidate.elementSnapshot,
        strategy: 'candidate-id',
        locatorData: {
            observationId: request.perception.dom.observationId,
            candidateId: candidate.candidateId,
            source
        },
        confidence,
        confidenceBasis: 'engine-heuristic',
        unique: true,
        actionable: true,
        evidence: candidate.evidence
    };
}

function createVisualEvidence(
    request: GroundingRequest,
    mapping: CandidateMappingResult,
    source: 'accessibility' | 'visual',
    regions: VisualRegion[]
): GroundingDecision['visualEvidence'] | undefined {
    return source === 'visual'
        ? {
            mappedCandidateIds: mapping.candidates.map(
                ({ candidateId }) => candidateId
            ),
            regions,
            ...request.perception.visual?.screenshotRef
                ? { screenshotRef: request.perception.visual.screenshotRef }
                : {}
        }
        : undefined;
}

function mappingFailure(
    mapping: CandidateMappingResult,
    sourcesUsed: readonly NonNullable<
    GroundingDecision['usage']
    >['sourcesUsed'][number][],
    visualModelCalls: number,
    status: Extract<GroundingDecision['status'],
    'blocked' | 'not-actionable' | 'not-visible'>,
    summary: string,
    visualEvidence?: GroundingDecision['visualEvidence']
): GroundingDecision {
    return {
        status,
        confidence: 1,
        confidenceBasis: 'deterministic',
        evidence: mapping.evidence,
        summary,
        ...visualEvidence ? { visualEvidence } : {},
        usage: {
            sourcesUsed: [ ...sourcesUsed ],
            visualModelCalls
        }
    };
}

function withUsage(
    decision: GroundingDecision,
    sourcesUsed: NonNullable<GroundingDecision['usage']>['sourcesUsed'],
    visualModelCalls: number
): GroundingDecision {
    return {
        ...decision,
        usage: {
            sourcesUsed,
            visualModelCalls
        }
    };
}
