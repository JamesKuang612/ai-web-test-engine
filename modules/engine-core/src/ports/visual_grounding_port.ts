import type {
    PagePerception,
    SemanticTarget,
    VisualRegion,
} from '../contracts';
import type {
    BrowserSession,
} from './browser_adapter';

/** 视觉 Provider 的只读目标发现结果，不代表目标已经可执行。 */
export interface VisualGroundingResult {
    modelCalls: number;
    status: 'located' | 'not-found' | 'unsupported';
    regions: VisualRegion[];
    summary: string;
}

/** Provider-independent 视觉发现边界；Midscene 只是首个实现。 */
export interface VisualGroundingPort {
    locate: (
        session: BrowserSession,
        target: SemanticTarget,
        perception: PagePerception,
        signal: AbortSignal
    ) => Promise<VisualGroundingResult>;
}
