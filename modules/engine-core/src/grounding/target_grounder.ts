import type {
    GroundingDecision,
    PageObservation,
    SemanticAction,
} from '../contracts';

/** 将 Planner 的语义目标绑定到当前页面中的唯一物理目标。 */
export interface TargetGrounder {
    ground: (
        action: SemanticAction,
        observation: PageObservation,
        signal: AbortSignal
    ) => Promise<GroundingDecision>;
}
