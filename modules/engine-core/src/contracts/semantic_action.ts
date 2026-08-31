import type {
    ActionType,
    ValueReference,
} from './action';

/** Planner 用业务语义描述目标，不包含候选编号或浏览器定位信息。 */
export interface SemanticTarget {
    description: string;
    scope?: string;
    relation?: string;
}

/** Planner 表达想完成的单步交互；风险授权不属于 Planner 职责。 */
export interface SemanticAction {
    type: ActionType;
    target?: SemanticTarget;
    value?: ValueReference;
    expectedEffect?: string;
    reasonSummary: string;
}
