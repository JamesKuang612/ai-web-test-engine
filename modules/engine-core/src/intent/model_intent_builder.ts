import type {
    TestIntent,
} from '../contracts';
import type {
    ModelAdapter,
    RuntimeSchema,
} from '../ports';
import type {
    BuildIntentInput,
    IntentBuilder,
} from './intent_builder';
import {
    extractExactTextAssertions,
} from './exact_text_assertion';

export interface ModelIntentBuilderOptions {
    maxOutputTokens: number;
    timeoutMs: number;
}

const DEFAULT_OPTIONS: ModelIntentBuilderOptions = {
    maxOutputTokens: 1200,
    timeoutMs: 30_000
};

/**
 * 通过结构化模型调用，将用户编写的自然语言用例转换为测试意图。
 */
export class ModelIntentBuilder implements IntentBuilder {
    /** 注入模型适配器、运行时 Schema 和模型调用参数。 */
    constructor(
        private readonly modelAdapter: ModelAdapter,
        private readonly intentSchema: RuntimeSchema<TestIntent>,
        private readonly options: ModelIntentBuilderOptions = DEFAULT_OPTIONS
    ) {}

    /** 拼装提示词、调用模型并返回通过 Schema 校验的 TestIntent。 */
    public async build(
        input: BuildIntentInput,
        signal: AbortSignal
    ): Promise<TestIntent> {
        signal.throwIfAborted();

        const result = await this.modelAdapter.generateStructured(
            {
                systemPrompt: this.buildSystemPrompt(),
                userPrompt: this.buildUserPrompt(input),
                timeoutMs: this.options.timeoutMs,
                maxOutputTokens: this.options.maxOutputTokens
            },
            this.intentSchema,
            signal
        );

        signal.throwIfAborted();

        const exactText = extractExactTextAssertions(
            input.test.action,
            result.value.successCriteria,
            result.value.failureCriteria
        );

        return {
            ...result.value,

            // 这两个安全字段由程序决定，不信任模型返回的内容。
            schemaVersion: 1,
            allowedHosts: [
                ...new Set(input.environment.allowedHosts)
            ],
            // 项目规则属于执行约束，不参与模型推导业务成功或失败条件。
            constraints: [
                ...new Set([
                    ...result.value.constraints,
                    ...input.projectContext.rules
                ])
            ],
            successCriteria: [
                ...result.value.successCriteria,
                ...exactText.successCriteria
            ],
            failureCriteria: [
                ...result.value.failureCriteria,
                ...exactText.failureCriteria
            ],
            ...exactText.assertions.length > 0
                ? {
                    exactTextAssertions: exactText.assertions
                }
                : {}
        };
    }

    /** 定义模型在意图提取阶段必须遵守的固定规则。 */
    private buildSystemPrompt(): string {
        return [
            '你是 AI Web 测试执行引擎的测试意图提取器。',
            '你的任务是把自然语言用例整理为结构化 TestIntent。',
            '只提取目标、前置条件、成功条件、失败条件和执行约束。',
            '成功条件和失败条件只描述用户 action 明确要求验证的业务结果。',
            '项目规则、允许域名、敏感数据保护和避免重复操作属于 constraints，不得转写为成功条件或失败条件，除非用户 action 明确要求测试这些规则本身。',
            '不要生成浏览器动作、CSS 选择器或 JavaScript 脚本。',
            '不要猜测或输出账号、密码、令牌等敏感信息。',
            '环境变量只能按给出的逻辑名称进行引用。',
            '不得扩展允许访问的域名。',
            '用户在验证、断言或校验语句中用引号标出的界面文本是逐字断言，不得使用同义词替换。',
            '输出必须严格符合提供的 JSON Schema。'
        ].join('\n');
    }

    /** 将用例和项目上下文转换成不包含敏感变量值的模型输入。 */
    private buildUserPrompt(
        input: BuildIntentInput
    ): string {
        const safeInput = {
            test: {
                id: input.test.id,
                name: input.test.name,
                startUrl: input.test.startUrl,
                action: input.test.action
            },
            environment: {
                id: input.environment.id,
                name: input.environment.name,
                baseUrl: input.environment.baseUrl,
                allowedHosts: input.environment.allowedHosts,
                variables: Object.entries(
                    input.environment.variables
                ).map(([name, variable]) => ({
                    name,
                    source: variable.source,
                    sensitive: variable.source === 'local'
                        ? variable.sensitive
                        : false
                }))
            },
            projectContext: {
                projectId: input.projectContext.projectId,
                terms: input.projectContext.terms
            }
        };

        return [
            '请根据以下业务数据生成测试意图：',
            JSON.stringify(safeInput, null, 2)
        ].join('\n');
    }
}
