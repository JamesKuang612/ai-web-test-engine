import type {
    RecoveryDecision,
    RecoveryPlannerInput,
    RecoverySafetyDecision,
    RecoverySafetyInput,
} from '../contracts';
import type {
    ModelProtocolDiagnostic,
} from '../ports';

export type RecoveryPlannerAttempt =
    | {
        status: 'decision',
        decision: RecoveryDecision
    }
    | {
        status: 'protocol-invalid',
        diagnostic: ModelProtocolDiagnostic
    }
    | {
        status: 'unavailable',
        reason: string,
        diagnostic: ModelProtocolDiagnostic
    };

export interface RecoveryPlannerPort {
    plan: (
        input: RecoveryPlannerInput,
        signal: AbortSignal
    ) => Promise<RecoveryPlannerAttempt>;
    /** 只修复原 decision 的协议结构，不得重新读取页面上下文或规划策略。 */
    repairProtocol?: (
        diagnostic: ModelProtocolDiagnostic,
        signal: AbortSignal
    ) => Promise<RecoveryPlannerAttempt>;
    /** 在计入 repair 模型调用前确认原始策略身份仍可确定。 */
    canRepairProtocol?: (
        diagnostic: ModelProtocolDiagnostic
    ) => boolean;
}

export interface RecoverySafetyPolicy {
    evaluate: (input: RecoverySafetyInput) => RecoverySafetyDecision;
}
