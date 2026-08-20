import type {
    EngineSchemaVersion,
    JsonValue,
} from './common';

/** 决定本次运行使用 AI 探索、自动选择还是结构化回放。 */
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

/** 环境变量既可以直接给出非敏感值，也可以引用只存在本机的值。 */
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

/** 限制单次运行可消耗的时间、动作和模型调用，防止失控循环。 */
export interface RunBudgets {
    maxActions: number;
    maxDurationMs: number;
    maxModelCalls: number;
    maxRepeatedStateActions: number;
}

/** 启动执行引擎时所需的完整输入。 */
export interface StartRunInput {
    test: TestDefinition;
    environment: EnvironmentDefinition;
    mode: RunMode;
    projectContext: ProjectContext;
    budgets: RunBudgets;
}
