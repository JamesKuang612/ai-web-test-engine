import type {
    ActionResult,
    EffectVerification,
} from './trace';
import type {
    EvidenceRef,
} from './common';
import type {
    GroundingDecision,
} from './grounding';
import type {
    PagePerception,
} from './perception';
import type {
    SemanticAction,
} from './semantic_action';

/** Phase 3 由 Runtime 临时包装；Phase 4 可直接由 SemanticPlan 提供。 */
export interface SemanticStep {
    id: string;
    primaryAction: SemanticAction;
    /** 只能来自明确上游语义，不由 Runtime 猜测或补写。 */
    expectedEffect?: string;
    source: 'runtime-wrapper' | 'semantic-plan';
}

/** 单步语义目标的进展，刻意不承载循环终止原因。 */
export interface SemanticStepProgress {
    status: 'complete' | 'progress' | 'no-progress' | 'wrong-state' | 'unknown';
    basis: 'deterministic' | 'model';
    summary: string;
    evidence: EvidenceRef[];
}

/** ProgressEvaluator 所需的完整确定性证据。 */
export interface SemanticStepProgressInput {
    step: SemanticStep;
    attemptedAction: SemanticAction;
    before: PagePerception;
    after: PagePerception;
    actionResult?: ActionResult;
    effect?: EffectVerification;
    primaryGroundingBefore?: GroundingDecision;
    primaryGroundingAfter?: GroundingDecision;
    recoveryIntent?: string;
}

/** Runtime 的终止结果，与页面是否产生语义进展严格分离。 */
export type SemanticStepExecutionOutcome =
    | {
        status: 'completed',
        progress: SemanticStepProgress
    }
    | {
        status: 'failed' | 'unsafe' | 'exhausted' | 'cycle' |
            'budget-exhausted',
        reason: string,
        progress?: SemanticStepProgress
    };

