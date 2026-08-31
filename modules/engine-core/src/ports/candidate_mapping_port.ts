import type {
    AccessibilityNode,
    PagePerception,
    ResolvedElementSnapshot,
    SemanticAction,
    VisualRegion,
} from '../contracts';
import type {
    BrowserSession,
} from './browser_adapter';

/** 需要安全绑定到 live DOM 的 A11y 或视觉证据。 */
export type CandidateMappingEvidence = {
    nodes: AccessibilityNode[],
    source: 'accessibility'
} | {
    regions: VisualRegion[],
    source: 'visual'
};

/** 映射端口证明可执行的 observation 生命周期 candidate。 */
export interface MappedCandidate {
    candidateId: string;
    elementSnapshot: ResolvedElementSnapshot;
    evidence: string[];
}

export interface CandidateMappingResult {
    status: 'ambiguous' | 'mapped' | 'unmapped';
    candidates: MappedCandidate[];
    evidence: string[];
    summary: string;
}

/** 感知证据到 live DOM/transient candidate 的唯一物理绑定边界。 */
export interface CandidateMappingPort {
    map: (
        session: BrowserSession,
        perception: PagePerception,
        action: SemanticAction,
        evidence: CandidateMappingEvidence,
        signal: AbortSignal
    ) => Promise<CandidateMappingResult>;
}
