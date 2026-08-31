import type {
    ResolvedTarget,
} from './trace';
import type {
    VisualRegion,
} from './perception';

/** Grounder 对一次语义目标绑定的确定性结论。 */
export interface GroundingDecision {
    status: 'grounded' | 'ambiguous' | 'not-found' | 'not-visible' |
        'blocked' | 'not-actionable' | 'unmapped';
    target?: ResolvedTarget;
    confidence: number;
    confidenceBasis?: 'deterministic' | 'engine-heuristic' | 'provider';
    evidence: string[];
    summary: string;
    visualEvidence?: {
        mappedCandidateIds: string[],
        regions: VisualRegion[],
        screenshotRef?: string
    };
    usage?: {
        sourcesUsed: Array<
        'accessibility' | 'dom' | 'hit-test' | 'visual'
        >,
        visualModelCalls: number
    };
}
