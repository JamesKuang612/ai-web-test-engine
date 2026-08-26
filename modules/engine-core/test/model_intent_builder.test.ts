import assert from 'node:assert/strict';
import type {
    ModelAdapter,
    ModelRequest,
    ModelResult,
    RuntimeSchema,
} from '../src/ports';
import type {
    TestIntent,
} from '../src/contracts';
import type {
    BuildIntentInput,
} from '../src/intent/intent_builder';
import {
    ModelIntentBuilder,
} from '../src/intent/model_intent_builder';
import {
    TestIntentSchemaError,
    testIntentSchema,
} from '../src/intent/test_intent_schema';

const buildInput: BuildIntentInput = {
    test: {
        schemaVersion: 1,
        id: 'login-jiandaoyun',
        name: '登录简道云',
        environmentId: 'jiandaoyun-test',
        startUrl: 'https://test.jdydevelop.com/portal/signin',
        action: '使用环境变量中的账号和密码登录简道云。'
    },
    environment: {
        schemaVersion: 1,
        id: 'jiandaoyun-test',
        name: '简道云测试环境',
        baseUrl: 'https://test.jdydevelop.com',
        allowedHosts: [
            'test.jdydevelop.com',
            'test.jdydevelop.com'
        ],
        variables: {
            username: {
                source: 'local',
                key: 'JIANDAOYUN_USERNAME',
                sensitive: false
            },
            password: {
                source: 'local',
                key: 'JIANDAOYUN_PASSWORD',
                sensitive: true
            }
        }
    },
    projectContext: {
        projectId: 'ai-web-test-engine',
        rules: [
            '已经登录时不要重复登录'
        ],
        terms: {
            workspace: '简道云工作台'
        }
    }
};

const modelIntent: TestIntent = {
    schemaVersion: 1,
    objective: '登录简道云并进入工作台',
    preconditions: [
        '能够获取测试账号和密码'
    ],
    successCriteria: [
        {
            id: 'workspace-visible',
            description: '页面显示简道云工作台',
            preferredEvidence: [
                'dom',
                'url'
            ],
            required: true
        }
    ],
    failureCriteria: [
        {
            id: 'login-error',
            description: '页面提示账号或密码错误'
        }
    ],
    constraints: [
        '已经登录时不要重复登录'
    ],
    allowedHosts: [
        'malicious.example.com'
    ],
    dataPolicy: {
        generatedValues: {}
    }
};

describe('ModelIntentBuilder', () => {
    it('调用模型并用环境配置覆盖模型返回的安全字段', async () => {
        const adapter = new FakeModelAdapter(modelIntent);
        const builder = new ModelIntentBuilder(
            adapter,
            testIntentSchema,
            {
                maxOutputTokens: 900,
                timeoutMs: 12_000
            }
        );
        const controller = new AbortController();

        const intent = await builder.build(
            buildInput,
            controller.signal
        );

        assert.equal(intent.schemaVersion, 1);
        assert.deepEqual(intent.allowedHosts, [
            'test.jdydevelop.com'
        ]);
        assert.deepEqual(intent.constraints, [
            '已经登录时不要重复登录'
        ]);
        assert.equal(intent.objective, modelIntent.objective);
        assert.equal(adapter.callCount, 1);
        assert.equal(adapter.lastSignal, controller.signal);
        assert.equal(adapter.lastRequest?.timeoutMs, 12_000);
        assert.equal(adapter.lastRequest?.maxOutputTokens, 900);
    });

    it('提示词只包含变量逻辑名称，不暴露本机变量 Key', async () => {
        const adapter = new FakeModelAdapter(modelIntent);
        const builder = new ModelIntentBuilder(
            adapter,
            testIntentSchema
        );

        await builder.build(
            buildInput,
            new AbortController().signal
        );

        const prompt = adapter.lastRequest?.userPrompt ?? '';
        assert.match(prompt, /"name": "password"/u);
        assert.doesNotMatch(prompt, /JIANDAOYUN_PASSWORD/u);
        assert.doesNotMatch(prompt, /JIANDAOYUN_USERNAME/u);
        assert.match(
            adapter.lastRequest?.systemPrompt ?? '',
            /项目规则.+属于 constraints/u
        );
    });

    it('运行在调用模型之前被取消时不再发起模型请求', async () => {
        const adapter = new FakeModelAdapter(modelIntent);
        const builder = new ModelIntentBuilder(
            adapter,
            testIntentSchema
        );
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            builder.build(buildInput, controller.signal),
            hasErrorName('AbortError')
        );
        assert.equal(adapter.callCount, 0);
    });

    it('拒绝不符合 TestIntent Schema 的模型输出', async () => {
        const adapter = new FakeModelAdapter({
            ...modelIntent,
            objective: 123
        });
        const builder = new ModelIntentBuilder(
            adapter,
            testIntentSchema
        );

        await assert.rejects(
            builder.build(
                buildInput,
                new AbortController().signal
            ),
            TestIntentSchemaError
        );
    });

    it('将模型侧 generatedValues 数组转换为内部 Record', () => {
        const parsed = testIntentSchema.parse({
            ...modelIntent,
            dataPolicy: {
                generatedValues: [
                    {
                        name: 'email',
                        rule: '生成唯一邮箱地址'
                    }
                ]
            }
        });

        assert.deepEqual(parsed.dataPolicy.generatedValues, {
            email: '生成唯一邮箱地址'
        });
    });
});

describe('ModelIntentBuilder exact text assertions', () => {
    it('从明确验证语句提取程序级逐字文本断言', async () => {
        const adapter = new FakeModelAdapter(modelIntent);
        const builder = new ModelIntentBuilder(
            adapter,
            testIntentSchema
        );

        const intent = await builder.build({
            ...buildInput,
            test: {
                ...buildInput.test,
                action: [
                    '点击“用户头像”；',
                    '从上到下逐字验证菜单显示“个人设置”、“退出”。'
                ].join('')
            }
        }, new AbortController().signal);

        assert.deepEqual(intent.exactTextAssertions, [{
            successCriterionId: 'engine-exact-text-1',
            failureCriterionId: 'engine-exact-text-1-mismatch',
            ordered: true,
            values: [
                '个人设置',
                '退出'
            ]
        }]);
        assert.equal(
            intent.successCriteria.at(-1)?.id,
            'engine-exact-text-1'
        );
        assert.equal(
            intent.failureCriteria.at(-1)?.id,
            'engine-exact-text-1-mismatch'
        );
    });

    it('把确认显示语句中的引号内容视为逐字断言', async () => {
        const builder = new ModelIntentBuilder(
            new FakeModelAdapter(modelIntent),
            testIntentSchema
        );

        const intent = await builder.build({
            ...buildInput,
            test: {
                ...buildInput.test,
                action: '打开页面，确认显示“我的待办”。'
            }
        }, new AbortController().signal);

        assert.deepEqual(intent.exactTextAssertions?.[0]?.values, [
            '我的待办'
        ]);
    });
});

/** 使用预设输出代替真实模型，供意图构建单元测试使用。 */
class FakeModelAdapter implements ModelAdapter {
    public callCount = 0;
    public lastRequest?: ModelRequest;
    public lastSignal?: AbortSignal;

    constructor(private readonly output: unknown) {}

    /** 记录模型调用参数，并通过真实 Schema 解析预设输出。 */
    public async generateStructured<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        signal: AbortSignal
    ): Promise<ModelResult<T>> {
        signal.throwIfAborted();

        this.callCount += 1;
        this.lastRequest = request;
        this.lastSignal = signal;

        return {
            model: 'fake-model',
            requestId: 'fake-request',
            value: schema.parse(this.output)
        };
    }
}

/** 为 assert.rejects 匹配指定名称的 Error。 */
function hasErrorName(name: string) {
    return (error: unknown) => error instanceof Error &&
        error.name === name;
}
