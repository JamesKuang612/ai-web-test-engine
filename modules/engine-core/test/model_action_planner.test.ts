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
    actionCommandSchema,
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
    it('生成引用当前候选元素的单步动作', async () => {
        const adapter = new FakeModelAdapter({
            type: 'TYPE',
            target: {
                candidateId: 'element-1',
                description: '手机号或邮箱输入框'
            },
            value: {
                source: 'environment',
                key: 'username'
            },
            expectedEffect: '账号输入框变为已填写',
            reasonSummary: '填写登录账号',
            risk: 'reversible'
        });
        const planner = new ModelActionPlanner(
            adapter,
            actionCommandSchema
        );

        const command = await planner.plan(
            planInput,
            new AbortController().signal
        );

        assert.equal(command.target?.candidateId, 'element-1');
        assert.match(adapter.lastRequest?.userPrompt ?? '', /element-1/u);
        assert.doesNotMatch(
            adapter.lastRequest?.userPrompt ?? '',
            /JIANDAOYUN_USERNAME/u
        );
        assert.doesNotMatch(
            adapter.lastRequest?.userPrompt ?? '',
            /locatorHints/u
        );
    });

    it('拒绝模型虚构 candidateId', async () => {
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
                reasonSummary: '填写登录账号',
                risk: 'reversible'
            }),
            actionCommandSchema
        );

        await assert.rejects(
            planner.plan(planInput, new AbortController().signal),
            /未知 candidateId/u
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
