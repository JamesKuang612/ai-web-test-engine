import type {
    EnvironmentDefinition,
    ProjectContext,
    TestDefinition,
    TestIntent,
} from '../contracts';

export interface BuildIntentInput {
    test: TestDefinition;
    environment: EnvironmentDefinition;
    projectContext: ProjectContext;
}

/** 将用户编写的自然语言用例整理为执行引擎内部的测试意图。 */
export interface IntentBuilder {
    build: (
        input: BuildIntentInput,
        signal: AbortSignal
    ) => Promise<TestIntent>;
}
