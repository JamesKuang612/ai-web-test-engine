import type {
    JsonValue,
} from './common';

/** 执行引擎允许规划器选择的有限动作集合。 */
export type ActionType =
    | 'BACK'
    | 'CHECK'
    | 'CLICK'
    | 'FAIL'
    | 'FINISH'
    | 'HOVER'
    | 'INSPECT'
    | 'NAVIGATE'
    | 'SCROLL'
    | 'SELECT'
    | 'TYPE'
    | 'UNCERTAIN'
    | 'WAIT';

/** 动作参数的数据来源，敏感值可以只保存引用而不进入用例文件。 */
export type ValueReference =
    | {
        key: string,
        source: 'environment'
    }
    | {
        key: string,
        source: 'generated'
    }
    | {
        source: 'literal',
        value: JsonValue
    };

/** 规划器对目标元素的语义描述，以及可选的候选元素提示。 */
export interface TargetDescription {
    candidateId?: string;
    description: string;
}

/** Planner 每轮只能返回的一个受控动作或终止建议。 */
export interface ActionCommand {
    type: ActionType;
    target?: TargetDescription;
    value?: ValueReference;
    expectedEffect?: string;
    reasonSummary: string;
    risk: 'read-only' | 'reversible' | 'side-effect';
}
