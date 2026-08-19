import type {
    EngineSchemaVersion,
} from './common';

export type EvidenceType =
    | 'dom'
    | 'network'
    | 'screenshot'
    | 'url';

export interface SuccessCriterion {
    id: string;
    description: string;
    preferredEvidence: EvidenceType[];
    required: boolean;
}

export interface FailureCriterion {
    id: string;
    description: string;
}

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
