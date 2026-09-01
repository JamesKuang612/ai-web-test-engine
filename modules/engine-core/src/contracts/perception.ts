import type {
    PageObservation,
} from './observation';

/** 统一使用 CSS viewport 坐标描述页面区域。 */
export interface BoundingBox {
    height: number;
    width: number;
    x: number;
    y: number;
}
/** Accessibility 节点的紧凑祖先语义。 */
export interface AccessibilityAncestor {
    name?: string;
    role?: string;
}

/** 浏览器原生 Accessibility 表示中的 bounded 节点。 */
export interface AccessibilityNode {
    id: string;
    ancestors: AccessibilityAncestor[];
    boundingBox?: BoundingBox;
    checked?: boolean | 'mixed';
    description?: string;
    disabled?: boolean;
    /** 已安全映射并注册到当前 observation 的物理候选。 */
    domCandidateId?: string;
    expanded?: boolean;
    name?: string;
    role?: string;
    selected?: boolean;
}

/** 不保存原始完整树，只保存 Grounding 所需的有限节点。 */
export interface AccessibilitySnapshot {
    nodes: AccessibilityNode[];
    source: 'playwright-aria-snapshot';
    truncated: boolean;
}

/** 页面候选在真实浏览器中的交互状态。 */
export interface ElementInteractionState {
    candidateId: string;
    enabled: boolean;
    hitTest: 'blocked' | 'receives-events' | 'unknown';
    inViewport: boolean;
    visible: boolean;
    blockedBy?: {
        name?: string,
        role?: string,
        tag?: string,
        text?: string
    };
}

/** 视觉模型发现的页面区域；本身不具备执行权限。 */
export interface VisualRegion {
    id: string;
    boundingBox: BoundingBox;
    confidence?: number;
    context: string[];
    description: string;
}

/** 页面中可以低成本识别的异步过渡信号。 */
export type PageTransientSignal =
    | 'aria-busy'
    | 'document-loading'
    | 'loading-text'
    | 'progressbar'
    | 'spinner';

/** 不包含完整页面文本或瞬时物理 id 的低波动稳定性采样。 */
export interface PageStabilitySample {
    capturedAt: string;
    fingerprint: string;
    loading: boolean;
    transientSignals: PageTransientSignal[];
}

/** 一次完整 Perception capture window 的一致性结论。 */
export interface PerceptionStability {
    consistency: 'consistent' | 'inconsistent' | 'unknown';
    state: 'stable' | 'transient' | 'unknown';
    afterFingerprint?: string;
    beforeFingerprint?: string;
    transientSignals: PageTransientSignal[];
}

/** 两次感知之间可确定、低成本计算的状态变化。 */
export interface PerceptionDelta {
    accessibility: {
        added: string[],
        changed: string[],
        removed: string[],
        truncated: boolean
    };
    candidates: {
        added: string[],
        removed: string[],
        truncated: boolean
    };
    overlayState: {
        after: 'blocked' | 'clear' | 'unknown',
        before: 'blocked' | 'clear' | 'unknown',
        changed: boolean
    };
    titleChanged: boolean;
    urlChanged: boolean;
    visibleText: {
        added: string[],
        removed: string[],
        truncated: boolean
    };
}

/** DOM、Accessibility、交互状态和视觉证据的统一感知快照。 */
export interface PagePerception {
    perceptionId: string;
    capturedAt: string;
    accessibility: AccessibilitySnapshot;
    delta?: PerceptionDelta;
    dom: PageObservation;
    interactionStates: Record<string, ElementInteractionState>;
    /** 缺失表示 legacy artifact，读取时必须按 unknown 处理。 */
    stability?: PerceptionStability;
    visual?: {
        regions: VisualRegion[],
        screenshotRef?: string
    };
}
