import type {
    EngineSchemaVersion,
    JsonValue,
} from './common';

export type RunMode =
    | 'ai-explore'
    | 'auto'
    | 'structured-replay';

/** 用户通过 Git 维护的一条自然语言测试用例。 */
export interface TestDefinition {
    schemaVersion: EngineSchemaVersion;
    id: string;
    name: string;
    environmentId: string;
    startUrl?: string;
    action: string;
    execution?: {
        planRef?: string,
        preferredMode?: RunMode
    };
}

export type EnvironmentVariable =
    | {
        source: 'literal',
        value: JsonValue
    }
    | {
        key: string,
        sensitive: boolean,
        source: 'local'
    };

/** 可提交 Git 的非敏感环境定义及本机变量引用。 */
export interface EnvironmentDefinition {
    schemaVersion: EngineSchemaVersion;
    id: string;
    name: string;
    baseUrl: string;
    allowedHosts: string[];
    variables: Record<string, EnvironmentVariable>;
}

/** 项目规则、业务术语和执行保护组成的运行上下文。 */
export interface ProjectContext {
    projectId: string;
    rules: string[];
    terms: Record<string, string>;
}

export interface RunBudgets {
    maxActions: number;
    maxDurationMs: number;
    maxModelCalls: number;
    maxRepeatedStateActions: number;
}

export interface StartRunInput {
    test: TestDefinition;
    environment: EnvironmentDefinition;
    mode: RunMode;
    projectContext: ProjectContext;
    budgets: RunBudgets;
}
