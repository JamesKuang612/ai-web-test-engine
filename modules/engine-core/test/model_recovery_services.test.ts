import assert from 'node:assert/strict';

import type {
    ModelProtocolDiagnostic,
    ModelAdapter,
    ModelRequest,
    ModelResult,
    RecoveryPlannerInput,
    RuntimeSchema,
    StepProgressModelInput,
} from '../src';
import {
    ClassifiedModelFailure,
    ModelRecoveryPlanner,
    ModelStepProgressEvaluator,
} from '../src';

// eslint-disable-next-line max-lines-per-function
describe('Phase 3 model recovery services', () => {
    it('RecoveryPlanner 只接收 typed safe view 并输出 semantic action', async () => {
        const adapter = new FakeModelAdapter({
            kind: 'recover',
            action: {
                type: 'HOVER',
                target: {
                    description: '应用 11 卡片',
                    scope: null
                },
                expectedTransientEffect: null,
                reasonSummary: '显示隐藏收藏按钮'
            },
            reason: null
        });
        const attempt = await new ModelRecoveryPlanner(adapter).plan(
            recoveryInput(),
            new AbortController().signal
        );
        const prompt = adapter.lastRequest?.userPrompt ?? '';

        assert.equal(attempt.status, 'decision');
        assert.equal(
            attempt.status === 'decision' ? attempt.decision.kind : undefined,
            'recover'
        );
        assertStrictObjectSchemas(adapter.lastSchema?.jsonSchema);
        [
            'candidateId', 'domCandidateId', 'locatorHints', 'boundingBox',
            'coordinates', 'attributes', 'secret-value', 'https://'
        ].forEach((field) => assert.equal(prompt.includes(field), false));
    });

    it('RecoveryPlanner 接受 strict schema 的 nullable stop 字段', async () => {
        const adapter = new FakeModelAdapter({
            kind: 'stop',
            action: null,
            reason: '没有安全恢复动作'
        });

        const attempt = await new ModelRecoveryPlanner(adapter).plan(
            recoveryInput(),
            new AbortController().signal
        );

        assert.deepEqual(attempt, {
            status: 'decision',
            decision: {
                kind: 'stop',
                reason: '没有安全恢复动作'
            }
        });
        assertStrictObjectSchemas(adapter.lastSchema?.jsonSchema);
    });

    it('schema invalid 可做一次只修协议结构的 repair', async () => {
        const diagnostic = hoverProtocolDiagnostic();
        const adapter = new FakeModelAdapter([
            new ClassifiedModelFailure(
                'schema-invalid',
                'RecoveryDecision schema invalid',
                diagnostic
            ),
            {
                kind: 'recover',
                action: {
                    type: 'HOVER',
                    target: {
                        description: '应用11卡片',
                        scope: null
                    },
                    expectedTransientEffect: null,
                    reasonSummary: '显示收藏入口'
                },
                reason: null
            }
        ]);
        const planner = new ModelRecoveryPlanner(adapter);

        const initial = await planner.plan(recoveryInput(), signal());
        assert.deepEqual(initial, {
            status: 'protocol-invalid',
            diagnostic
        });
        assert.equal(planner.canRepairProtocol(diagnostic), true);
        assert.equal(planner.repairProtocol !== undefined, true);
        const repaired = await planner.repairProtocol(
            diagnostic,
            signal()
        );

        assert.equal(repaired.status, 'decision');
        assert.deepEqual(
            repaired.status === 'decision' ? repaired.decision : undefined,
            {
                kind: 'recover',
                action: {
                    type: 'HOVER',
                    target: { description: '应用11卡片' },
                    reasonSummary: '显示收藏入口'
                }
            }
        );
        assert.equal(adapter.requests.length, 2);
        assert.equal(adapter.requests[1]?.protocolPhase, 'repair');
        assert.equal(adapter.requests[1]?.modelRole, 'recovery-planner');
        assert.equal(
            adapter.requests[1]?.userPrompt.includes('originalDecision'),
            true
        );
        assert.equal(
            adapter.requests[1]?.userPrompt.includes('visibleText'),
            false
        );
    });

    it('repair 改变已有 Recovery 策略时 deterministic reject', async () => {
        const diagnostic = hoverProtocolDiagnostic();
        const adapter = new FakeModelAdapter({
            kind: 'recover',
            action: {
                type: 'CLICK',
                target: { description: '设置', scope: null },
                expectedTransientEffect: null,
                reasonSummary: '打开设置'
            },
            reason: null
        });
        const planner = new ModelRecoveryPlanner(adapter);

        const repaired = await planner.repairProtocol(diagnostic, signal());

        assert.equal(repaired.status, 'unavailable');
        assert.equal(
            repaired.status === 'unavailable'
                ? repaired.diagnostic.schemaIssues.some(
                    ({ code }) => code === 'semantic-preservation-failed'
                )
                : false,
            true
        );
    });

    it('HOVER scope 缺失时 repair 不得发明非空 scope', async () => {
        const diagnostic = hoverProtocolDiagnostic();
        const planner = new ModelRecoveryPlanner(new FakeModelAdapter({
            kind: 'recover',
            action: {
                type: 'HOVER',
                target: {
                    description: '应用11卡片',
                    scope: '设置区域'
                },
                expectedTransientEffect: null,
                reasonSummary: '显示收藏入口'
            },
            reason: null
        }));

        const repaired = await planner.repairProtocol(diagnostic, signal());

        assert.equal(repaired.status, 'unavailable');
        assert.equal(
            repaired.status === 'unavailable'
                ? repaired.diagnostic.schemaIssues.some(
                    ({ path }) => path === 'target.scope'
                )
                : false,
            true
        );
    });

    it('缺失 expectedTransientEffect 时 repair 只能补 null', async () => {
        const diagnostic = hoverProtocolDiagnostic();
        const planner = new ModelRecoveryPlanner(new FakeModelAdapter({
            kind: 'recover',
            action: {
                type: 'HOVER',
                target: { description: '应用11卡片', scope: null },
                expectedTransientEffect: '打开设置区域',
                reasonSummary: '显示收藏入口'
            },
            reason: null
        }));

        const repaired = await planner.repairProtocol(diagnostic, signal());

        assert.equal(repaired.status, 'unavailable');
        assert.equal(
            repaired.status === 'unavailable'
                ? repaired.diagnostic.schemaIssues.some(
                    ({ path }) => path === 'expectedTransientEffect'
                )
                : false,
            true
        );
    });

    it('SCROLL 缺 direction/amount 时不调用 repair', async () => {
        await assertUnrepairableActionDoesNotCallModel({
            type: 'SCROLL',
            expectedTransientEffect: null,
            reasonSummary: '查找目标'
        });
    });

    it('WAIT 缺 duration 时不调用 repair', async () => {
        await assertUnrepairableActionDoesNotCallModel({
            type: 'WAIT',
            expectedTransientEffect: null,
            reasonSummary: '等待页面'
        });
    });

    it('缺少 Recovery strategy identity 时不调用 repair 模型', async () => {
        const diagnostic = unrepairableProtocolDiagnostic();
        const adapter = new FakeModelAdapter({
            kind: 'stop', action: null, reason: '不应调用'
        });
        const planner = new ModelRecoveryPlanner(adapter);

        assert.equal(planner.canRepairProtocol(diagnostic), false);
        assert.equal(
            (await planner.repairProtocol(diagnostic, signal())).status,
            'unavailable'
        );
        assert.equal(adapter.requests.length, 0);
    });

    it('已分类 provider failure 返回 unavailable 而不是抛内部异常', async () => {
        const diagnostic = protocolDiagnostic('initial', 'provider-unavailable');
        const adapter = new FakeModelAdapter(new ClassifiedModelFailure(
            'provider-unavailable',
            'provider offline',
            diagnostic
        ));

        assert.deepEqual(
            await new ModelRecoveryPlanner(adapter).plan(
                recoveryInput(),
                signal()
            ),
            {
                status: 'unavailable',
                reason: 'provider offline',
                diagnostic
            }
        );
    });

    it('Progress 模型只能返回分类，额外动作字段会被拒绝', async () => {
        const adapter = new FakeModelAdapter({
            status: 'complete',
            summary: '目标已完成',
            action: { type: 'CLICK' }
        });

        await assert.rejects(() => new ModelStepProgressEvaluator(adapter)
            .evaluate(progressInput(), new AbortController().signal));
    });
});

class FakeModelAdapter implements ModelAdapter {
    public lastRequest?: ModelRequest;
    public lastSchema?: RuntimeSchema<unknown>;
    public readonly requests: ModelRequest[] = [];
    private readonly outputs: unknown[];
    constructor(output: unknown | unknown[]) {
        this.outputs = Array.isArray(output) ? [ ...output ] : [ output ];
    }
    public async generateStructured<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>
    ): Promise<ModelResult<T>> {
        this.lastRequest = request;
        this.lastSchema = schema;
        this.requests.push(request);
        const output = this.outputs.shift();
        if (output instanceof Error) {
            throw output;
        }
        return {
            model: 'fake-model',
            value: schema.parse(output)
        };
    }
}

function protocolDiagnostic(
    phase: 'initial' | 'repair',
    failureType: 'provider-unavailable' | 'schema-invalid' = 'schema-invalid'
): ModelProtocolDiagnostic {
    return {
        schemaVersion: 1,
        modelRole: 'recovery-planner',
        phase,
        failureType,
        rawOutputPreview: '{"kind":"stop"}',
        rawSha256: 'abc',
        parsedJson: { kind: 'stop' },
        schemaIssues: [{
            path: 'RecoveryDecision.action',
            code: 'missing-field',
            message: '字段缺失。'
        }],
        sanitized: true,
        truncated: false
    };
}

function hoverProtocolDiagnostic(): ModelProtocolDiagnostic {
    return {
        schemaVersion: 1,
        modelRole: 'recovery-planner',
        phase: 'initial',
        failureType: 'schema-invalid',
        rawSha256: 'hover-sha',
        parsedJson: {
            kind: 'recover',
            action: {
                type: 'HOVER',
                target: { description: '应用11卡片' },
                expectedTransientEffect: null,
                reasonSummary: '显示收藏入口'
            },
            reason: null
        },
        schemaIssues: [{
            path: 'RecoveryDecision.action.target.scope',
            code: 'missing-field',
            message: '字段缺失。'
        }],
        sanitized: true,
        truncated: false
    };
}

function unrepairableProtocolDiagnostic(): ModelProtocolDiagnostic {
    return {
        schemaVersion: 1,
        modelRole: 'recovery-planner',
        phase: 'initial',
        failureType: 'invalid-json',
        rawOutputPreview: '{broken',
        rawSha256: 'broken-sha',
        schemaIssues: [{
            path: '$',
            code: 'invalid-json',
            message: '无法解析。'
        }],
        sanitized: true,
        truncated: false
    };
}

async function assertUnrepairableActionDoesNotCallModel(
    action: Record<string, unknown>
): Promise<void> {
    const diagnostic: ModelProtocolDiagnostic = {
        schemaVersion: 1,
        modelRole: 'recovery-planner',
        phase: 'initial',
        failureType: 'schema-invalid',
        parsedJson: { kind: 'recover', action, reason: null },
        schemaIssues: [{
            path: 'RecoveryDecision.action',
            code: 'missing-field',
            message: '执行策略参数缺失。'
        }],
        sanitized: true,
        truncated: false
    };
    const adapter = new FakeModelAdapter({
        kind: 'stop', action: null, reason: '不应调用'
    });
    const planner = new ModelRecoveryPlanner(adapter);

    assert.equal(planner.canRepairProtocol(diagnostic), false);
    assert.equal(
        (await planner.repairProtocol(diagnostic, signal())).status,
        'unavailable'
    );
    assert.equal(adapter.requests.length, 0);
}

function signal(): AbortSignal {
    return new AbortController().signal;
}

function assertStrictObjectSchemas(value: unknown, path = 'schema'): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertStrictObjectSchemas(
            item,
            `${ path }[${ index }]`
        ));
        return;
    }
    if (typeof value !== 'object' || value === null) {
        return;
    }
    const record = value as Record<string, unknown>;
    if (
        record.type === 'object'
        && typeof record.properties === 'object'
        && record.properties !== null
    ) {
        const properties = Object.keys(
            record.properties as Record<string, unknown>
        ).sort();
        assert.deepEqual(
            Array.isArray(record.required) ? [ ...record.required ].sort() : [],
            properties,
            `${ path }.required 必须包含 properties 的全部字段`
        );
    }
    Object.entries(record).forEach(([ key, item ]) => {
        assertStrictObjectSchemas(item, `${ path }.${ key }`);
    });
}

function recoveryInput(): RecoveryPlannerInput {
    return {
        step: {
            id: 'step-1',
            primaryAction: {
                type: 'CLICK',
                target: { description: '收藏星标', scope: '应用 11' },
                reasonSummary: '收藏应用'
            }
        },
        testIntent: {
            schemaVersion: 1,
            objective: '收藏应用 11',
            preconditions: [],
            successCriteria: [],
            failureCriteria: [],
            constraints: [],
            allowedHosts: [ 'example.test' ],
            dataPolicy: { generatedValues: {} }
        },
        failure: {
            grounding: {
                status: 'not-found',
                confidence: 0,
                summary: 'not found',
                sourcesUsed: [ 'dom' ]
            }
        },
        view: {
            page: {
                loading: false,
                title: '工作台',
                urlChanged: false
            },
            visibleText: [ '应用 11' ],
            notices: [],
            elements: [{
                role: 'article',
                name: '应用 11',
                disabled: false,
                visible: true,
                inViewport: true,
                nearbyText: []
            }],
            accessibility: [],
            overlayState: 'clear'
        },
        recentAttempts: [],
        allowedCapabilities: [ 'HOVER', 'REOBSERVE' ]
    };
}

function progressInput(): StepProgressModelInput {
    const view = recoveryInput().view;
    return {
        step: {
            primaryAction: {
                type: 'CLICK',
                targetDescription: '收藏星标',
                reasonSummary: '收藏应用'
            }
        },
        attemptedActionType: 'CLICK',
        before: view,
        after: view
    };
}
