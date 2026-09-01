import type {
    ActionResult,
    EffectVerification,
    PageObservation,
    RunBudgets,
    SemanticAction,
    TestIntent,
} from '../contracts';

/** Planner 可以看到的单步历史，不包含输入值明文或浏览器对象。 */
export interface PlannerHistoryEntry {
    semanticAction: SemanticAction;
    actionResult: ActionResult;
    effect?: EffectVerification;
    beforeObservationRef: string;
    afterObservationRef?: string;
}

/** 当前运行剩余的确定性预算。 */
export interface RemainingRunBudgets extends RunBudgets {}

/** 每轮规划所需的脱敏测试意图、稳定页面状态和执行历史。 */
export interface PlanActionInput {
    testIntent: TestIntent;
    observation: PageObservation;
    history: PlannerHistoryEntry[];
    availableEnvironmentVariables: string[];
    remainingBudgets: RemainingRunBudgets;
}

/** 将当前运行状态转换为一个受控的下一步动作。 */
export interface ActionPlanner {
    /** 每次只返回一个不含物理定位信息的 SemanticAction。 */
    plan: (
        input: PlanActionInput,
        signal: AbortSignal
    ) => Promise<SemanticAction>;
}
