import type {
    ResolvedElementSnapshot,
} from './trace';
import type {
    PerceptionDelta,
} from './perception';
import type {
    SemanticStep,
    SemanticStepProgress,
} from './semantic_step';
import type {
    SemanticTarget,
} from './semantic_action';
import type {
    TestIntent,
} from './intent';

export type RecoveryAction =
    | {
        type: 'CLEAR' | 'CLICK' | 'HOVER',
        target: SemanticTarget,
        expectedTransientEffect?: string,
        reasonSummary: string
    }
    | {
        type: 'SCROLL',
        direction: 'up' | 'down',
        amount: 'small' | 'medium' | 'page',
        expectedTransientEffect?: string,
        reasonSummary: string
    }
    | {
        type: 'WAIT',
        duration: 'short' | 'medium',
        expectedTransientEffect?: string,
        reasonSummary: string
    }
    | {
        type: 'BACK' | 'REOBSERVE',
        expectedTransientEffect?: string,
        reasonSummary: string
    };

export type RecoveryDecision =
    | {
        kind: 'recover',
        action: RecoveryAction
    }
    | {
        kind: 'stop',
        reason: string
    };

/** 提供给模型的元素摘要；类型层没有任何物理定位信息或真实输入值。 */
export interface RecoveryPlanningElementView {
    role?: string;
    name?: string;
    text?: string;
    label?: string;
    placeholder?: string;
    visualDescription?: string;
    valueState?: 'empty' | 'filled' | 'masked' | 'unknown';
    disabled: boolean;
    checked?: boolean;
    visible: boolean;
    inViewport: boolean;
    nearbyText: string[];
}

export interface RecoveryPlanningView {
    page: {
        loading: boolean,
        title: string,
        url: string
    };
    visibleText: string[];
    notices: Array<{
        level: 'error' | 'info' | 'success' | 'warning',
        text: string
    }>;
    elements: RecoveryPlanningElementView[];
    accessibility: Array<{
        role?: string,
        name?: string,
        description?: string,
        disabled?: boolean,
        checked?: boolean | 'mixed',
        expanded?: boolean,
        selected?: boolean
    }>;
    delta?: {
        titleChanged: boolean,
        urlChanged: boolean,
        visibleTextAdded: string[],
        visibleTextRemoved: string[],
        candidateCountChanged: boolean,
        accessibilityChanged: boolean,
        overlayChanged: boolean
    };
    overlayState: 'blocked' | 'clear' | 'unknown';
}

export interface RecoveryAttemptSummary {
    action: RecoveryAction;
    outcome: 'progress' | 'no-progress' | 'wrong-state' | 'unsafe' | 'failed';
    summary: string;
}

/** Recovery 模型可见的 Step 摘要，不包含 primary 输入值。 */
export interface RecoveryPlanningStepView {
    id: string;
    primaryAction: {
        type: string,
        target?: SemanticTarget,
        expectedEffect?: string,
        reasonSummary: string
    };
    expectedEffect?: string;
}

export interface RecoveryPlannerInput {
    step: RecoveryPlanningStepView;
    testIntent: TestIntent;
    failure: {
        grounding?: {
            status: 'grounded' | 'ambiguous' | 'not-found' | 'not-visible' |
                'blocked' | 'not-actionable' | 'unmapped',
            confidence: number,
            summary: string,
            sourcesUsed: Array<'accessibility' | 'dom' | 'hit-test' | 'visual'>
        },
        actionResult?: {
            status: 'executed' | 'failed' | 'rejected' | 'timed-out',
            errorCode?: string,
            browserSignals: {
                dialogOpened: boolean,
                downloadStarted: boolean,
                newTabOpened: boolean,
                urlChanged: boolean
            }
        },
        progress?: Pick<SemanticStepProgress, 'basis' | 'status' | 'summary'>
    };
    view: RecoveryPlanningView;
    recentAttempts: RecoveryAttemptSummary[];
    allowedCapabilities: RecoveryAction['type'][];
}

export interface RecoverySafetyInput {
    action: RecoveryAction;
    step: SemanticStep;
    testIntent: TestIntent;
    recoveryIntent: string;
    resolvedSnapshot?: ResolvedElementSnapshot;
    recoveryCausedNavigation: boolean;
}

export type RecoverySafetyDecision =
    | { allowed: true, reason: string }
    | { allowed: false, reason: string };

/** Recovery 之后是否允许再次触碰原始 primary action。 */
export type PrimaryRetryDecision =
    | { kind: 'execute-after-reground' }
    | { kind: 'reverify' }
    | { kind: 'retry-idempotent' }
    | { kind: 'do-not-retry', reason: string };

/** 低成本 delta 摘要，避免规则实现复制 PagePerception 的比较逻辑。 */
export function hasMeaningfulPerceptionDelta(
    delta: PerceptionDelta | undefined
): boolean {
    return Boolean(delta && (
        delta.titleChanged
        || delta.urlChanged
        || delta.visibleText.added.length > 0
        || delta.visibleText.removed.length > 0
        || delta.candidates.added.length > 0
        || delta.candidates.removed.length > 0
        || delta.accessibility.added.length > 0
        || delta.accessibility.changed.length > 0
        || delta.accessibility.removed.length > 0
        || delta.overlayState.changed
    ));
}
