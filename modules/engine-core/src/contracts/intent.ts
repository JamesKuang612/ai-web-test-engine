import type {
    EngineSchemaVersion,
} from './common';

/** 判断条件可依赖的页面证据类型。 */
export type EvidenceType =
    | 'dom'
    | 'network'
    | 'screenshot'
    | 'url';

/** 描述测试通过时必须或建议满足的单项条件。 */
export interface SuccessCriterion {
    id: string;
    description: string;
    preferredEvidence: EvidenceType[];
    required: boolean;
}

/** 描述出现后即可判定测试失败的单项条件。 */
export interface FailureCriterion {
    id: string;
    description: string;
}

/** 记录测试执行期间需要动态生成的数据规则。 */
export interface DataPolicy {
    generatedValues: Record<string, string>;
}

/** 从自然语言用例提取出的内部测试意图。 */
export interface TestIntent {
    schemaVersion: EngineSchemaVersion;
    objective: string;
    preconditions: string[];
    successCriteria: SuccessCriterion[];
    failureCriteria: FailureCriterion[];
    constraints: string[];
    allowedHosts: string[];
    dataPolicy: DataPolicy;
}
