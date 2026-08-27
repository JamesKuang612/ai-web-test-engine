import type {
    ValueReference,
} from './action';
import type {
    EngineSchemaVersion,
} from './common';
import type {
    TestIntent,
} from './intent';
import type {
    LocatorHint,
} from './observation';

/** 可由确定性回放器执行的动作集合。 */
export type CompiledActionType =
    | 'CHECK'
    | 'CLICK'
    | 'NAVIGATE'
    | 'SELECT'
    | 'TYPE'
    | 'WAIT';

/** 不依赖单次页面采集 candidateId 的元素语义身份。 */
export interface CompiledTargetIdentity {
    tag: string;
    role?: string;
    name?: string;
    text?: string;
    label?: string;
    placeholder?: string;
    inputType?: string;
}

/** 编译后保存的稳定元素目标，回放时会重新解析为当前页面 candidateId。 */
export interface CompiledTarget {
    description: string;
    locatorHints: LocatorHint[];
    identity: CompiledTargetIdentity;
}

/** 成功探索轨迹中可以被确定性重放的单个步骤。 */
export interface CompiledStep {
    id: string;
    sequence: number;
    type: CompiledActionType;
    target?: CompiledTarget;
    value?: ValueReference;
    expectedEffect: string;
    risk: 'read-only' | 'reversible' | 'side-effect';
}

/** 经全新浏览器上下文回放验证后才可作为候选计划保存的结构化用例。 */
export interface CompiledPlan {
    schemaVersion: EngineSchemaVersion;
    planId: string;
    testId: string;
    sourceRunId: string;
    sourceTraceRef: string;
    createdAt: string;
    allowedHosts: string[];
    testIntent: TestIntent;
    steps: CompiledStep[];
}
