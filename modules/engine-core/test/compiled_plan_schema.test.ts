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
});

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
