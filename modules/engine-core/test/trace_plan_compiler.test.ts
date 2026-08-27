import assert from 'node:assert/strict';
import type {
    ActionCommand,
    CompilableTraceStep,
    ObservedElement,
    PageObservation,
    TestIntent,
} from '../src';
import {
    TracePlanCompileError,
    TracePlanCompiler,
} from '../src';

const intent: TestIntent = {
    schemaVersion: 1,
    objective: '登录简道云并进入工作台',
    preconditions: [],
    successCriteria: [{
        id: 'workspace-visible',
        description: '页面显示简道云工作台',
        preferredEvidence: [ 'dom', 'url' ],
        required: true
    }],
    failureCriteria: [],
    constraints: [],
    allowedHosts: [ 'test.jdydevelop.com' ],
    dataPolicy: {
        generatedValues: {}
    }
};

describe('TracePlanCompiler', () => {
    it('把成功登录轨迹编译为不含 candidateId 和敏感值的结构化计划', () => {
        const compiler = new TracePlanCompiler({
            createId: () => 'plan-1',
            now: () => new Date('2026-08-26T06:00:00.000Z')
        });
        const plan = compiler.compile({
            runId: 'run-1',
            testId: 'login-jiandaoyun',
            testIntent: intent,
            steps: createFullTraceSteps()
        });

        assert.equal(plan.planId, 'plan-1');
        assert.equal(plan.sourceTraceRef, 'run-1/trace.jsonl');
        assert.equal(plan.steps[1].value?.source, 'environment');
        assert.deepEqual(plan.steps[1].target?.locatorHints, [{
            strategy: 'label',
            value: '账号'
        }]);
        assert.equal(JSON.stringify(plan).includes('candidateId'), false);
        assert.equal(JSON.stringify(plan).includes('runtime-username'), false);
        assert.equal(plan.steps[3]?.value?.source, 'literal');
        assert.equal(plan.steps[4]?.value?.source, 'literal');
        assert.equal(plan.steps[5]?.type, 'WAIT');
    });

});

describe('TracePlanCompiler 安全约束', () => {
    it('保留非敏感业务字段的 TYPE 字面量值', () => {
        const compiler = new TracePlanCompiler();
        const steps = [
            createStep(1, {
                type: 'NAVIGATE',
                value: {
                    source: 'literal',
                    value: 'https://test.jdydevelop.com/portal/signin'
                },
                expectedEffect: '打开登录页',
                reasonSummary: '进入登录页',
                risk: 'read-only'
            }, []),
            createStep(2, {
                type: 'TYPE',
                target: {
                    candidateId: 'runtime-username',
                    description: '应用名称输入框'
                },
                value: {
                    source: 'literal',
                    value: '2026.8.27'
                },
                expectedEffect: '应用名称输入框变为已填写',
                reasonSummary: '填写应用名称',
                risk: 'reversible'
            }, [ createApplicationNameElement() ])
        ];

        const plan = compiler.compile({
            runId: 'run-1',
            testId: 'create-application',
            testIntent: intent,
            steps
        });

        assert.deepEqual(plan.steps[1]?.value, {
            source: 'literal',
            value: '2026.8.27'
        });
    });

    it('拒绝把密码 TYPE 字面量写入可复用计划', () => {
        const compiler = new TracePlanCompiler();
        const steps = [
            createStep(1, {
                type: 'NAVIGATE',
                value: {
                    source: 'literal',
                    value: 'https://test.jdydevelop.com/portal/signin'
                },
                expectedEffect: '打开登录页',
                reasonSummary: '进入登录页',
                risk: 'read-only'
            }, []),
            createStep(2, {
                type: 'TYPE',
                target: {
                    candidateId: 'runtime-password',
                    description: '密码输入框'
                },
                value: {
                    source: 'literal',
                    value: 'should-not-be-persisted'
                },
                expectedEffect: '密码输入框变为已填写',
                reasonSummary: '填写密码',
                risk: 'reversible'
            }, [ createPasswordElement() ])
        ];

        assert.throws(() => compiler.compile({
            runId: 'run-1',
            testId: 'login-jiandaoyun',
            testIntent: intent,
            steps
        }), /敏感 TYPE 必须使用环境变量/u);
    });

    it('拒绝效果未经确认或缺少唯一定位提示的轨迹', () => {
        const compiler = new TracePlanCompiler();
        const step = createStep(1, {
            type: 'NAVIGATE',
            value: {
                source: 'literal',
                value: 'https://test.jdydevelop.com/portal/signin'
            },
            expectedEffect: '打开登录页',
            reasonSummary: '进入登录页',
            risk: 'read-only'
        }, []);
        step.effect.status = 'uncertain';

        assert.throws(() => compiler.compile({
            runId: 'run-1',
            testId: 'login-jiandaoyun',
            testIntent: intent,
            steps: [ step ]
        }), TracePlanCompileError);
    });
});

function createFullTraceSteps(): CompilableTraceStep[] {
    return [
        createStep(1, {
            type: 'NAVIGATE',
            value: {
                source: 'literal',
                value: 'https://test.jdydevelop.com/portal/signin'
            },
            expectedEffect: '打开登录页',
            reasonSummary: '进入登录页',
            risk: 'read-only'
        }, []),
        createStep(2, {
            type: 'TYPE',
            target: {
                candidateId: 'runtime-username',
                description: '账号输入框'
            },
            value: {
                source: 'environment',
                key: 'username'
            },
            expectedEffect: '账号输入框变为已填写',
            reasonSummary: '填写账号',
            risk: 'reversible'
        }, [ createUsernameElement() ]),
        createStep(3, {
            type: 'CLICK',
            target: {
                candidateId: 'runtime-submit',
                description: '登录按钮'
            },
            expectedEffect: '页面进入工作台',
            reasonSummary: '提交登录',
            risk: 'side-effect'
        }, [ createSubmitElement() ]),
        createStep(4, createSelectCommand(), [
            createControlElement('runtime-language', 'select', '语言')
        ]),
        createStep(5, createCheckCommand(), [
            createControlElement('runtime-remember', 'input', '记住我')
        ]),
        createStep(6, {
            type: 'WAIT',
            value: {
                source: 'literal',
                value: 500
            },
            expectedEffect: '等待异步内容渲染',
            reasonSummary: '短暂等待页面',
            risk: 'read-only'
        }, [])
    ];
}

function createSelectCommand(): ActionCommand {
    return {
        type: 'SELECT',
        target: {
            candidateId: 'runtime-language',
            description: '语言下拉框'
        },
        value: {
            source: 'literal',
            value: '简体中文'
        },
        expectedEffect: '语言下拉框显示简体中文',
        reasonSummary: '选择页面语言',
        risk: 'reversible'
    };
}

function createCheckCommand(): ActionCommand {
    return {
        type: 'CHECK',
        target: {
            candidateId: 'runtime-remember',
            description: '记住我复选框'
        },
        value: {
            source: 'literal',
            value: true
        },
        expectedEffect: '记住我复选框已勾选',
        reasonSummary: '勾选记住我',
        risk: 'reversible'
    };
}

function createStep(
    sequence: number,
    command: ActionCommand,
    elements: ObservedElement[]
): CompilableTraceStep {
    return {
        sequence,
        command,
        actionResult: {
            status: 'executed',
            startedAt: '2026-08-26T06:00:00.000Z',
            finishedAt: '2026-08-26T06:00:01.000Z',
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: command.type === 'NAVIGATE'
            }
        },
        effect: {
            status: 'confirmed',
            expectedEffect: command.expectedEffect ?? '',
            evidence: [],
            summary: '动作效果已确认'
        },
        beforeObservation: createObservation(`before-${ sequence }`, elements),
        afterObservation: createObservation(`after-${ sequence }`, elements)
    };
}

function createObservation(
    observationId: string,
    interactiveElements: ObservedElement[]
): PageObservation {
    return {
        schemaVersion: 1,
        observationId,
        capturedAt: '2026-08-26T06:00:00.000Z',
        page: {
            loading: false,
            title: '简道云',
            url: 'https://test.jdydevelop.com/portal/signin',
            viewport: {
                height: 720,
                width: 1280
            }
        },
        visibleText: [],
        interactiveElements,
        notices: [],
        tabs: [],
        stateFingerprint: observationId,
        truncated: false
    };
}

function createUsernameElement(): ObservedElement {
    return {
        candidateId: 'runtime-username',
        tag: 'input',
        label: '账号',
        placeholder: '请输入账号',
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
            value: '账号'
        }]
    };
}

function createApplicationNameElement(): ObservedElement {
    return {
        ...createUsernameElement(),
        candidateId: 'runtime-username',
        label: '名称',
        placeholder: '给应用命名',
        locatorHints: [{
            strategy: 'label',
            value: '名称'
        }]
    };
}

function createPasswordElement(): ObservedElement {
    return {
        ...createUsernameElement(),
        candidateId: 'runtime-password',
        label: '密码',
        placeholder: '请输入密码',
        attributes: {
            type: 'password'
        },
        locatorHints: [{
            strategy: 'label',
            value: '密码'
        }]
    };
}

function createControlElement(
    candidateId: string,
    tag: string,
    label: string
): ObservedElement {
    return {
        candidateId,
        tag,
        label,
        valueState: tag === 'select' ? 'filled' : undefined,
        checked: tag === 'input' ? true : undefined,
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [],
        locatorHints: [{
            strategy: 'label',
            value: label
        }]
    };
}

function createSubmitElement(): ObservedElement {
    return {
        candidateId: 'runtime-submit',
        tag: 'button',
        role: 'button',
        name: '登录',
        text: '登录',
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {
            type: 'submit'
        },
        nearbyText: [],
        locatorHints: [{
            strategy: 'role-name',
            value: 'button::登录'
        }]
    };
}
