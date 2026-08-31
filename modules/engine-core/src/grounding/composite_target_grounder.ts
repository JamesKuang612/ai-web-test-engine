import type {
    GroundingDecision,
    ResolvedTarget,
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
        const domDecision = await this.domGrounder.ground(request, signal);
        if (
            domDecision.status === 'grounded' ||
            domDecision.status === 'blocked' ||
            domDecision.status === 'not-visible' ||
            domDecision.status === 'not-actionable' ||
            !request.action.target
        ) {
            return withUsage(domDecision, [ 'dom' ], 0);
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

        if (!request.visualAllowed) {
            return a11yDecision ?? withUsage(domDecision, [ 'dom' ], 0);
        }

        const visual = await this.visualGrounding.locate(
            request.session,
            request.action.target,
            request.perception,
            signal
        );
        if (visual.status !== 'located' || visual.regions.length === 0) {
            return withUsage(
                a11yDecision ?? {
                    ...domDecision,
                    summary: visual.summary
                },
                [
                    'dom',
                    ...a11yMatches.length > 0
                        ? [ 'accessibility' as const ]
                        : [],
                    'visual'
                ],
                1
            );
        }
        const visualMapping = await this.candidateMapper.map(
            request.session,
            request.perception,
            request.action,
            {
                regions: visual.regions,
                source: 'visual'
            },
            signal
        );
        return fromMapping(request, visualMapping, 'visual', 0.85, 1);
    }
}

function fromMapping(
    request: GroundingRequest,
    mapping: CandidateMappingResult,
    source: 'accessibility' | 'visual',
    confidence: number,
    visualModelCalls = 0
): GroundingDecision {
    const sources = [ 'dom', source ] as const;
    if (mapping.status !== 'mapped' || mapping.candidates.length !== 1) {
        return {
            status: mapping.status === 'ambiguous' ? 'ambiguous' : 'unmapped',
            confidence: 0,
            evidence: mapping.evidence,
            summary: mapping.summary,
            usage: {
                sourcesUsed: [ ...sources ],
                visualModelCalls
            }
        };
    }
    const candidate = mapping.candidates[0];
    const target: ResolvedTarget = {
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
        unique: true,
        actionable: true,
        evidence: candidate.evidence
    };
    return {
        status: 'grounded',
        target,
        confidence,
        evidence: candidate.evidence,
        summary: mapping.summary,
        usage: {
            sourcesUsed: [ ...sources ],
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
