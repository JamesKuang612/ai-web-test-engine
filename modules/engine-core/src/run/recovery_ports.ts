import type {
    RecoveryDecision,
    RecoveryPlannerInput,
    RecoverySafetyDecision,
    RecoverySafetyInput,
} from '../contracts';

export interface RecoveryPlannerPort {
    plan: (
        input: RecoveryPlannerInput,
        signal: AbortSignal
    ) => Promise<RecoveryDecision>;
}

export interface RecoverySafetyPolicy {
    evaluate: (input: RecoverySafetyInput) => RecoverySafetyDecision;
}
