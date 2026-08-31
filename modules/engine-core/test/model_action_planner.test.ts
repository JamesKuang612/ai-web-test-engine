import assert from 'node:assert/strict';
import type {
    ModelAdapter,
    ModelRequest,
    ModelResult,
    PlanActionInput,
    RuntimeSchema,
} from '../src';
import {
    ModelActionPlanner,
    semanticActionSchema,
} from '../src';

const planInput: PlanActionInput = {
    testIntent: {
        schemaVersion: 1,
        objective: '登录简道云并进入工作台',
        preconditions: [],
        successCriteria: [],
        failureCriteria: [],
        constraints: [],
        allowedHosts: [
            'test.jdydevelop.com'
        ],
        dataPolicy: {
            generatedValues: {}
        }
    },
    observation: {
        schemaVersion: 1,
        observationId: 'observation-1',
        capturedAt: '2026-08-25T00:00:00.000Z',
        page: {
            loading: false,
            title: '登录',
            url: 'https://test.jdydevelop.com/portal/signin',
            viewport: {
                width: 1280,
                height: 720
            }
        },
        visibleText: [
            '登录'
        ],
        interactiveElements: [{
            candidateId: 'element-1',
            tag: 'input',
            role: 'textbox',
            name: '手机号或邮箱',
            placeholder: '手机号 / 邮箱',
            valueState: 'empty',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: {
                type: 'text'
            },
            nearbyText: [],
            locatorHints: [{
                strategy: 'label',
                value: '手机号或邮箱'
            }]
        }],
        notices: [],
        tabs: [],
        stateFingerprint: 'fingerprint-1',
        truncated: false
    },
    history: [],
    availableEnvironmentVariables: [
        'username',
        'password'
    ],
    remainingBudgets: {
        maxActions: 1,
        maxDurationMs: 60_000,
        maxModelCalls: 1,
        maxRepeatedStateActions: 0
    }
};

describe('ModelActionPlanner', () => {
    it('生成不包含物理候选编号的语义动作', async () => {
        const adapter = new FakeModelAdapter({
            type: 'TYPE',
            target: {
                description: '手机号或邮箱'
            },
            value: {
                source: 'environment',
                key: 'username'
            },
            expectedEffect: '账号输入框变为已填写',
            reasonSummary: '填写登录账号'
        });
        const planner = new ModelActionPlanner(
            adapter,
            semanticActionSchema
        );

        const action = await planner.plan(
            planInput,
            new AbortController().signal
        );

        assert.deepEqual(action.target, {
            description: '手机号或邮箱'
        });
        assert.doesNotMatch(adapter.lastRequest?.userPrompt ?? '', /element-1/u);
        assert.doesNotMatch(adapter.lastRequest?.userPrompt ?? '', /candidateId/u);
        assert.doesNotMatch(
            adapter.lastRequest?.userPrompt ?? '',
            /JIANDAOYUN_USERNAME/u
        );
        assert.doesNotMatch(
            adapter.lastRequest?.userPrompt ?? '',
            /locatorHints/u
        );
        assert.match(
            adapter.lastRequest?.systemPrompt ?? '',
            /TYPE、CLICK、HOVER、SELECT、CHECK 和 WAIT/u
        );
        assert.match(
            adapter.lastRequest?.systemPrompt ?? '',
            /先对当前真实存在的父级、卡片或入口候选执行 HOVER/u
        );
    });

    it('通过语义 Schema 拒绝模型输出 candidateId', async () => {
        const planner = new ModelActionPlanner(
            new FakeModelAdapter({
                type: 'TYPE',
                target: {
                    candidateId: 'element-404',
                    description: '不存在的输入框'
                },
                value: {
                    source: 'environment',
                    key: 'username'
                },
                expectedEffect: '输入框变为已填写',
                reasonSummary: '填写登录账号'
            }),
            semanticActionSchema
        );

        await assert.rejects(
            planner.plan(planInput, new AbortController().signal),
            /candidateId/u
        );
    });

    it('提示模型在无法定位时保留业务语义目标供视觉恢复', async () => {
        const adapter = new FakeModelAdapter({
            type: 'UNCERTAIN',
            target: {
                description: '当前页面内能够返回工作台的控件'
            },
            value: null,
            expectedEffect: '返回工作台',
            reasonSummary: '没有对应的 DOM 候选元素'
        });
        const planner = new ModelActionPlanner(adapter, semanticActionSchema);

        const command = await planner.plan(
            planInput,
            new AbortController().signal
        );

        assert.equal(
            command.target?.description,
            '当前页面内能够返回工作台的控件'
        );
        assert.match(
            adapter.lastRequest?.systemPrompt ?? '',
            /业务语义目标/u
        );
        assert.match(
            adapter.lastRequest?.systemPrompt ?? '',
            /不得猜测目标的外观、位置/u
        );
    });
});

describe('ModelActionPlanner Phase 1 relation 边界', () => {
    it('通过 Prompt 和 Schema 同时禁止 Planner 输出 relation', async () => {
        const adapter = new FakeModelAdapter({
            type: 'CLICK',
            target: { description: '收藏星标' },
            value: null,
            expectedEffect: '应用变为已收藏',
            reasonSummary: '点击收藏'
        });
        const planner = new ModelActionPlanner(adapter, semanticActionSchema);

        await planner.plan(planInput, new AbortController().signal);

        assert.match(
            adapter.lastRequest?.systemPrompt ?? '',
            /不得输出 relation/u
        );
        assert.equal(
            JSON.stringify(semanticActionSchema.jsonSchema)
                .includes('relation'),
            false
        );
    });
});

/** 用固定输出模拟结构化模型调用。 */
class FakeModelAdapter implements ModelAdapter {
    public lastRequest?: ModelRequest;

    constructor(private readonly output: unknown) {}

    /** 记录请求并通过真实运行时 Schema 解析预设结果。 */
    public generateStructured<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        _signal: AbortSignal
    ): Promise<ModelResult<T>> {
        this.lastRequest = request;
        return Promise.resolve({
            model: 'fake-model',
            value: schema.parse(this.output)
        });
    }
}
