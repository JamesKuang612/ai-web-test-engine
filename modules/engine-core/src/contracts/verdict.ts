import type {
    TestResult,
} from './run';

/** 一条成功或失败条件在最终页面证据中的匹配状态。 */
export type CriterionMatchStatus =
    | 'MATCHED'
    | 'NOT_MATCHED'
    | 'UNKNOWN';

/** Verdict 对单条 TestIntent 条件给出的证据化判断。 */
export interface CriterionAssessment {
    criterionId: string;
    status: CriterionMatchStatus;
    summary: string;
}

/** 独立于动作 Planner 的最终业务判定。 */
export interface VerdictDecision {
    result: TestResult;
    summary: string;
    successCriteria: CriterionAssessment[];
    failureCriteria: CriterionAssessment[];
}
