import type {
    ActionCommand,
    PageObservation,
    TestIntent,
    VerdictDecision,
} from '../contracts';
import type {
    PlannerHistoryEntry,
} from '../planning';

/** 最终判定器可以看到的脱敏运行上下文。 */
export interface EvaluateVerdictInput {
    testIntent: TestIntent;
    observation: PageObservation;
    history: PlannerHistoryEntry[];
    stopCommand: ActionCommand;
}

/** 独立检查最终页面是否满足 TestIntent，而不信任 Planner 的结束建议。 */
export interface VerdictEvaluator {
    evaluate: (
        input: EvaluateVerdictInput,
        signal: AbortSignal
    ) => Promise<VerdictDecision>;
}
