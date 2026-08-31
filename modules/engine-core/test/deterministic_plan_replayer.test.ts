import assert from 'node:assert/strict';
import type {
    ActionCommand,
    ActionResult,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    CompiledPlan,
    CompiledTarget,
    EnvironmentDefinition,
    EnvironmentValueResolver,
    ObservedElement,
    PageObservation,
    ResolvedTarget,
} from '../src';
import {
    CompiledTargetResolutionError,
    CompiledTargetResolver,
    DeterministicPlanReplayer,
    PlanReplayError,
} from '../src';

const environment: EnvironmentDefinition = {
    schemaVersion: 1,
    id: 'jiandaoyun-test',
    name: '简道云测试环境',
    baseUrl: 'https://test.jdydevelop.com',
    allowedHosts: [ 'test.jdydevelop.com' ],
    variables: {
        username: {
            source: 'literal',
            value: 'tester@example.com'
        }
    }
};

describe('DeterministicPlanReplayer', () => {
    it('在全新会话中无 Planner 地完成定位、环境值解析和逐步验证', async () => {
        const browser = new FakeReplayBrowser([
            createObservation('blank', 'about:blank', []),
            createObservation('login-1', loginUrl, loginElements('empty')),
            createObservation('login-2', loginUrl, loginElements('empty')),
            createObservation('login-3', loginUrl, loginElements('filled')),
            createObservation('login-4', loginUrl, loginElements('filled')),
            createObservation('workspace', workspaceUrl, [])
        ]);
        const replayer = new DeterministicPlanReplayer(
            browser,
            new FakeValueResolver()
        );

        const execution = await replayer.replay({
            plan: createPlan(),
            environment,
            signal: new AbortController().signal
        });

        assert.equal(browser.startCount, 1);
        assert.equal(browser.closeCount, 1);
        assert.equal(execution.actionCount, 3);
        assert.equal(execution.finalObservation.page.url, workspaceUrl);
        assert.deepEqual(
            browser.commands.map((command) => command.type),
            [ 'NAVIGATE', 'TYPE', 'CLICK' ]
        );
        assert.deepEqual(browser.commands[1].value, {
            source: 'literal',
            value: 'resolved-username'
        });
        assert.deepEqual(execution.steps[1].command.value, {
            source: 'environment',
            key: 'username'
        });
        assert.equal(browser.resolvedTargets[1]?.observationId, 'login-2');
        assert.equal(
            browser.resolvedTargets[1]?.elementSnapshot.label,
            '账号'
        );
        assert.equal(
            JSON.stringify(execution).includes('resolved-username'),
            false
        );
    });
});

describe('DeterministicPlanReplayer literal inputs', () => {
    it('结构化回放直接复用非敏感 TYPE 字面量', async () => {
        const browser = new FakeReplayBrowser([
            createObservation('blank', 'about:blank', []),
            createObservation('form-1', loginUrl, [
                createApplicationNameElement('name-current', 'empty')
            ]),
            createObservation('form-2', loginUrl, [
                createApplicationNameElement('name-current', 'empty')
            ]),
            createObservation('form-3', loginUrl, [
                createApplicationNameElement('name-current', 'filled')
            ])
        ]);
        const plan = createPlan();
        plan.steps = plan.steps.slice(0, 2);
        plan.steps[1] = {
            ...plan.steps[1],
            target: {
                description: '应用名称输入框',
                locatorHints: [{
                    strategy: 'label',
                    value: '名称'
                }],
                identity: {
                    tag: 'input',
                    label: '名称',
                    inputType: 'text'
                }
            },
            value: {
                source: 'literal',
                value: '2026.8.27'
            }
        };
        const replayer = new DeterministicPlanReplayer(
            browser,
            new FakeValueResolver()
        );

        const execution = await replayer.replay({
            plan,
            environment,
            signal: new AbortController().signal
        });

        assert.equal(execution.actionCount, 2);
        assert.deepEqual(browser.commands[1]?.value, {
            source: 'literal',
            value: '2026.8.27'
        });
        assert.deepEqual(execution.steps[1]?.command.value, {
            source: 'literal',
            value: '2026.8.27'
        });
    });
});

describe('DeterministicPlanReplayer failures and advanced actions', () => {
    it('非导航点击意外改变 URL 时不把动作效果误判为成功', async () => {
        const browser = new FakeReplayBrowser([
            createObservation('blank', 'about:blank', []),
            createObservation('dashboard-1', workspaceUrl, favoriteElements()),
            createObservation('dashboard-2', workspaceUrl, favoriteElements()),
            createObservation('inside-app', `${ workspaceUrl }app/11`, [])
        ]);
        const plan = createPlan();
        plan.steps = [
            plan.steps[0],
            {
                id: 'step-2',
                sequence: 2,
                type: 'CLICK',
                target: {
                    description: '11应用的收藏图标',
                    locatorHints: [{
                        strategy: 'role-name',
                        value: 'link::11'
                    }],
                    identity: {
                        tag: 'a',
                        role: 'link',
                        name: '11'
                    }
                },
                expectedEffect: '将11应用添加至我的收藏',
                risk: 'side-effect'
            }
        ];
        const replayer = new DeterministicPlanReplayer(
            browser,
            new FakeValueResolver()
        );

        await assert.rejects(() => replayer.replay({
            plan,
            environment,
            signal: new AbortController().signal
        }), /意外改变了页面地址/u);
    });

    it('动作效果没有确认时中止回放并仍然关闭会话', async () => {
        const browser = new FakeReplayBrowser([
            createObservation('blank', 'about:blank', []),
            createObservation('login-1', loginUrl, loginElements('empty')),
            createObservation('login-2', loginUrl, loginElements('empty')),
            createObservation('login-unchanged', loginUrl, loginElements('empty'))
        ]);
        const replayer = new DeterministicPlanReplayer(
            browser,
            new FakeValueResolver()
        );

        await assert.rejects(() => replayer.replay({
            plan: createPlan(),
            environment,
            signal: new AbortController().signal
        }), (error: unknown) => (
            error instanceof PlanReplayError
            && error.actionCount === 2
        ));
        assert.equal(browser.closeCount, 1);
    });

    it('确定性回放 HOVER、SELECT、CHECK 和 WAIT 计划步骤', async () => {
        const browser = new FakeReplayBrowser([
            createObservation('blank', 'about:blank', []),
            createObservation('form-1', loginUrl, formElements('empty', false)),
            createObservation('form-2', loginUrl, formElements('empty', false)),
            createObservation('form-3', loginUrl, formElements('filled', false)),
            createObservation('form-4', loginUrl, formElements('filled', false)),
            createObservation('form-5', loginUrl, formElements('filled', true)),
            createObservation('form-6', loginUrl, formElements('filled', true)),
            createObservation('form-7', loginUrl, formElements('filled', true)),
            createObservation('form-8', loginUrl, formElements('filled', true)),
            createObservation('form-9', loginUrl, formElements('filled', true))
        ]);
        const replayer = new DeterministicPlanReplayer(
            browser,
            new FakeValueResolver()
        );

        const execution = await replayer.replay({
            plan: createAdvancedPlan(),
            environment,
            signal: new AbortController().signal
        });

        assert.deepEqual(
            browser.commands.map((command) => command.type),
            [ 'NAVIGATE', 'SELECT', 'CHECK', 'WAIT', 'HOVER' ]
        );
        assert.equal(execution.actionCount, 5);
        assert.equal(execution.steps.every(
            (step) => step.effect.status === 'confirmed'
        ), true);
    });
});

describe('CompiledTargetResolver', () => {
    it('用稳定语义提示重新绑定非标准头像控件', () => {
        const resolver = new CompiledTargetResolver();
        const target: CompiledTarget = {
            description: '页面右上角用户头像',
            locatorHints: [
                {
                    strategy: 'css',
                    value: '.topbar-user-avatar'
                },
                {
                    strategy: 'role-name',
                    value: 'button|topbar user avatar'
                }
            ],
            identity: {
                tag: 'div',
                role: 'button',
                name: 'topbar user avatar'
            }
        };
        const avatar: ObservedElement = {
            candidateId: 'avatar-from-fresh-dom',
            tag: 'div',
            role: 'button',
            name: 'topbar user avatar',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: {
                class: 'topbar-user-avatar',
                'aria-haspopup': 'menu'
            },
            nearbyText: [],
            locatorHints: [
                {
                    strategy: 'css',
                    value: 'div'
                },
                {
                    strategy: 'css',
                    value: '.topbar-user-avatar'
                },
                {
                    strategy: 'role-name',
                    value: 'button|topbar user avatar'
                }
            ]
        };

        const resolved = resolver.resolve(
            target,
            createObservation('workspace-avatar', workspaceUrl, [ avatar ])
        );

        assert.equal(resolved.candidateId, 'avatar-from-fresh-dom');
    });

    it('拒绝多个同分候选元素，避免回放时误操作', () => {
        const resolver = new CompiledTargetResolver();
        const duplicate = createUsernameElement('username-2', 'empty');
        const observation = createObservation(
            'duplicated',
            loginUrl,
            [ ...loginElements('empty'), duplicate ]
        );

        assert.throws(() => resolver.resolve(
            createPlan().steps[1].target!,
            observation
        ), CompiledTargetResolutionError);
    });
});

const loginUrl = 'https://test.jdydevelop.com/portal/signin';
const workspaceUrl = 'https://test.jdydevelop.com/dashboard#/';

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
                value: loginUrl
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
                    label: '账号',
                    inputType: 'text'
                }
            },
            value: {
                source: 'environment',
                key: 'username'
            },
            expectedEffect: '账号输入框变为已填写',
            risk: 'reversible'
        }, {
            id: 'step-3',
            sequence: 3,
            type: 'CLICK',
            target: {
                description: '登录按钮',
                locatorHints: [{
                    strategy: 'role-name',
                    value: 'button::登录'
                }],
                identity: {
                    tag: 'button',
                    role: 'button',
                    name: '登录'
                }
            },
            expectedEffect: '页面进入工作台',
            risk: 'side-effect'
        }]
    };
}

function createAdvancedPlan(): CompiledPlan {
    const plan = createPlan();
    return {
        ...plan,
        steps: [{
            ...plan.steps[0]
        }, {
            id: 'step-2',
            sequence: 2,
            type: 'SELECT',
            target: createCompiledControl('语言', 'select'),
            value: {
                source: 'literal',
                value: '简体中文'
            },
            expectedEffect: '语言下拉框显示简体中文',
            risk: 'reversible'
        }, {
            id: 'step-3',
            sequence: 3,
            type: 'CHECK',
            target: createCompiledControl('接收通知', 'input'),
            value: {
                source: 'literal',
                value: true
            },
            expectedEffect: '接收通知复选框已勾选',
            risk: 'reversible'
        }, {
            id: 'step-4',
            sequence: 4,
            type: 'WAIT',
            value: {
                source: 'literal',
                value: 500
            },
            expectedEffect: '等待异步内容稳定',
            risk: 'read-only'
        }, {
            id: 'step-5',
            sequence: 5,
            type: 'HOVER',
            target: createCompiledControl('语言', 'select'),
            expectedEffect: '悬浮后显示附加信息',
            risk: 'read-only'
        }]
    };
}

function createCompiledControl(label: string, tag: string): CompiledTarget {
    return {
        description: label,
        locatorHints: [{
            strategy: 'label',
            value: label
        }],
        identity: {
            tag,
            label
        }
    };
}

function createObservation(
    observationId: string,
    url: string,
    interactiveElements: ObservedElement[]
): PageObservation {
    return {
        schemaVersion: 1,
        observationId,
        capturedAt: '2026-08-26T06:00:00.000Z',
        page: {
            loading: false,
            title: '简道云',
            url,
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

function loginElements(
    valueState: ObservedElement['valueState']
): ObservedElement[] {
    return [
        createUsernameElement('username-current', valueState),
        {
            candidateId: 'submit-current',
            tag: 'button',
            role: 'button',
            name: '登录',
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
        }
    ];
}

function formElements(
    selectState: ObservedElement['valueState'],
    checked: boolean
): ObservedElement[] {
    return [{
        candidateId: 'language-current',
        tag: 'select',
        label: '语言',
        valueState: selectState,
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [],
        locatorHints: [{
            strategy: 'label',
            value: '语言'
        }]
    }, {
        candidateId: 'notification-current',
        tag: 'input',
        label: '接收通知',
        checked,
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {
            type: 'checkbox'
        },
        nearbyText: [],
        locatorHints: [{
            strategy: 'label',
            value: '接收通知'
        }]
    }];
}

function favoriteElements(): ObservedElement[] {
    return [{
        candidateId: 'application-11',
        tag: 'a',
        role: 'link',
        name: '11',
        text: '11',
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [],
        locatorHints: [{
            strategy: 'role-name',
            value: 'link::11'
        }]
    }];
}

function createUsernameElement(
    candidateId: string,
    valueState: ObservedElement['valueState']
): ObservedElement {
    return {
        candidateId,
        tag: 'input',
        label: '账号',
        valueState,
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

function createApplicationNameElement(
    candidateId: string,
    valueState: ObservedElement['valueState']
): ObservedElement {
    return {
        candidateId,
        tag: 'input',
        label: '名称',
        valueState,
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {
            type: 'text'
        },
        nearbyText: [],
        locatorHints: [{
            strategy: 'label',
            value: '名称'
        }]
    };
}

class FakeValueResolver implements EnvironmentValueResolver {
    public resolve: EnvironmentValueResolver['resolve'] = async (
        logicalName
    ) => `resolved-${ logicalName }`;
}

class FakeReplayBrowser implements BrowserAdapter {
    public closeCount = 0;
    public commands: ActionCommand[] = [];
    public resolvedTargets: Array<ResolvedTarget | undefined> = [];
    public startCount = 0;
    private observationIndex = 0;

    constructor(private readonly observations: PageObservation[]) {}

    public start = async (
        _options: BrowserStartOptions
    ): Promise<BrowserSession> => {
        this.startCount += 1;
        return {
            sessionId: `session-${ this.startCount }`
        };
    };

    public observe = async (): Promise<PageObservation> => {
        const observation = this.observations[this.observationIndex];
        this.observationIndex += 1;
        if (!observation) {
            throw new Error('没有更多页面观察。');
        }
        return observation;
    };

    public execute = async (
        _session: BrowserSession,
        command: ActionCommand,
        target?: ResolvedTarget
    ): Promise<ActionResult> => {
        this.commands.push(command);
        this.resolvedTargets.push(target);
        const timestamp = '2026-08-26T06:00:00.000Z';
        return {
            status: 'executed',
            startedAt: timestamp,
            finishedAt: timestamp,
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: command.type !== 'TYPE'
            }
        };
    };

    public captureScreenshot: BrowserAdapter['captureScreenshot'] = async () => ({
        content: new Uint8Array([ 1, 2, 3 ]),
        mediaType: 'image/png'
    });

    public reset = async (): Promise<void> => undefined;

    public close = async (): Promise<void> => {
        this.closeCount += 1;
    };
}
