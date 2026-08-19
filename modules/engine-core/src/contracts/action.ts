import type {
    JsonValue,
} from './common';

export type ActionType =
    | 'BACK'
    | 'CHECK'
    | 'CLICK'
    | 'FAIL'
    | 'FINISH'
    | 'INSPECT'
    | 'NAVIGATE'
    | 'SCROLL'
    | 'SELECT'
    | 'TYPE'
    | 'UNCERTAIN'
    | 'WAIT';

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
