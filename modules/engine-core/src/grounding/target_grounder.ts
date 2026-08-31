import type {
    GroundingDecision,
    PagePerception,
    SemanticAction,
} from '../contracts';
import type {
    BrowserSession,
} from '../ports';

/** 一次多模态 Grounding 所需的当前页面上下文和视觉预算。 */
export interface GroundingRequest {
    action: SemanticAction;
    perception: PagePerception;
    session: BrowserSession;
    visualAllowed: boolean;
}

/** 将 Planner 的语义目标绑定到当前页面中的唯一物理目标。 */
export interface TargetGrounder {
    ground: (
        request: GroundingRequest,
        signal: AbortSignal
    ) => Promise<GroundingDecision>;
}
