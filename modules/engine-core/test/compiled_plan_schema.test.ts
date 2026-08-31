import assert from 'node:assert/strict';
import type {
    CompiledPlan,
} from '../src';
import {
    CompiledPlanSchemaError,
    parseCompiledPlan,
} from '../src';

describe('CompiledPlan Schema', () => {
    it('解析持久化的结构化导航和环境变量输入步骤', () => {
        const plan = createPlan();

        assert.deepEqual(parseCompiledPlan(plan), plan);
    });

    it('拒绝元素目标重新混入运行时 candidateId', () => {
        const plan = createPlan() as unknown as Record<string, unknown>;
        const steps = plan.steps as Array<Record<string, unknown>>;
        const target = steps[1].target as Record<string, unknown>;
        target.candidateId = 'e1';

        assert.throws(
            () => parseCompiledPlan(plan),
            CompiledPlanSchemaError
        );
    });

    it('解析可回放的 HOVER、SELECT、CHECK 和 WAIT 步骤', () => {
        const plan = createPlan();
        plan.steps.push({
            id: 'step-3',
            sequence: 3,
            type: 'SELECT',
            target: createTarget('语言', 'select'),
            value: {
                source: 'literal',
                value: '简体中文'
            },
            expectedEffect: '语言下拉框显示简体中文',
            risk: 'reversible'
        }, {
            id: 'step-4',
            sequence: 4,
            type: 'CHECK',
            target: createTarget('记住我', 'input'),
            value: {
                source: 'literal',
                value: true
            },
            expectedEffect: '记住我复选框已勾选',
            risk: 'reversible'
        }, {
            id: 'step-5',
            sequence: 5,
            type: 'WAIT',
            value: {
                source: 'literal',
                value: 500
            },
            expectedEffect: '等待异步内容渲染',
            risk: 'read-only'
        }, {
            id: 'step-6',
            sequence: 6,
            type: 'SCROLL',
            value: {
                source: 'literal',
                value: {
                    direction: 'down',
                    amount: 'medium'
                }
            },
            expectedEffect: '显示下方内容',
            risk: 'reversible'
        }, {
            id: 'step-7',
            sequence: 7,
            type: 'HOVER',
            target: createTarget('11应用卡片', 'a'),
            expectedEffect: '显示添加收藏按钮',
            risk: 'read-only'
        });

        assert.deepEqual(parseCompiledPlan(plan), plan);
    });

    it('解析非敏感业务字段的 TYPE 字面量', () => {
        const plan = createPlan();
        plan.steps[1] = {
            ...plan.steps[1],
            target: createTarget('应用名称', 'input'),
            value: {
                source: 'literal',
                value: '2026.8.27'
            }
        };

        assert.deepEqual(parseCompiledPlan(plan), plan);
    });
});

describe('CompiledPlan Schema 安全边界', () => {
    it('拒绝越过 allowedHosts 的导航地址', () => {
        const plan = createPlan();
        const value = plan.steps[0].value;
        if (value?.source === 'literal') {
            value.value = 'https://example.com/signin';
        }

        assert.throws(
            () => parseCompiledPlan(plan),
            /目标 Host 不在计划允许列表/u
        );
    });

    it('拒绝计划和测试意图使用不同 Host 边界', () => {
        const plan = createPlan();
        plan.testIntent.allowedHosts = [ 'other.jdydevelop.com' ];

        assert.throws(
            () => parseCompiledPlan(plan),
            /必须与 testIntent.allowedHosts 一致/u
        );
    });

    it('拒绝连续 WAIT 造成无效长时间阻塞', () => {
        const plan = createPlan();
        plan.steps.push(createWaitStep(3), createWaitStep(4));

        assert.throws(
            () => parseCompiledPlan(plan),
            /不能包含连续 WAIT/u
        );
    });

    it('拒绝密码字段使用 TYPE 字面量', () => {
        const plan = createPlan();
        plan.steps[1] = {
            ...plan.steps[1],
            target: {
                ...createTarget('密码', 'input'),
                identity: {
                    tag: 'input',
                    label: '密码',
                    inputType: 'password'
                }
            },
            value: {
                source: 'literal',
                value: 'should-not-be-persisted'
            }
        };

        assert.throws(
            () => parseCompiledPlan(plan),
            /敏感 TYPE 必须使用环境变量/u
        );
    });
});

function createTarget(label: string, tag: string) {
    return {
        description: label,
        locatorHints: [{
            strategy: 'label' as const,
            value: label
        }],
        identity: {
            tag,
            label
        }
    };
}

function createWaitStep(sequence: number): CompiledPlan['steps'][number] {
    return {
        id: `step-${ sequence }`,
        sequence,
        type: 'WAIT',
        value: {
            source: 'literal',
            value: 500
        },
        expectedEffect: '等待异步内容稳定',
        risk: 'read-only'
    };
}

function createPlan(): CompiledPlan {
    return {
        schemaVersion: 1,
        planId: 'plan-1',
        testId: 'login-jiandaoyun',
        sourceRunId: 'run-1',
        sourceTraceRef: 'run-1/trace.jsonl',
        createdAt: '2026-08-26T06:00:00.000Z',
        allowedHosts: [ 'test.jdydevelop.com' ],
        testIntent: {
            schemaVersion: 1,
            objective: '登录简道云并进入工作台',
            preconditions: [],
            successCriteria: [],
            failureCriteria: [],
            constraints: [],
            allowedHosts: [ 'test.jdydevelop.com' ],
            dataPolicy: {
                generatedValues: {}
            }
        },
        steps: [{
            id: 'step-1',
            sequence: 1,
            type: 'NAVIGATE',
            value: {
                source: 'literal',
                value: 'https://test.jdydevelop.com/portal/signin'
            },
            expectedEffect: '打开登录页',
            risk: 'read-only'
        }, {
            id: 'step-2',
            sequence: 2,
            type: 'TYPE',
            target: {
                description: '账号输入框',
                locatorHints: [{
                    strategy: 'label',
                    value: '账号'
                }],
                identity: {
                    tag: 'input',
                    label: '账号'
                }
            },
            value: {
                source: 'environment',
                key: 'username'
            },
            expectedEffect: '账号输入框变为已填写',
            risk: 'reversible'
        }]
    };
}
