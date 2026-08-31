import type {
    ResolvedTarget,
} from './trace';

/** Grounder 对一次语义目标绑定的确定性结论。 */
export interface GroundingDecision {
    status: 'grounded' | 'ambiguous' | 'not-found' | 'blocked';
    target?: ResolvedTarget;
    confidence: number;
    evidence: string[];
    summary: string;
}
