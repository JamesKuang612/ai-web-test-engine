import assert from 'node:assert/strict';
import type {
    ActionCommand,
    ActionResult,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    CompiledPlan,
    EnvironmentDefinition,
    EnvironmentValueResolver,
    ObservedElement,
    PageObservation,
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
        assert.equal(
            JSON.stringify(execution).includes('resolved-username'),
            false
        );
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
});

describe('CompiledTargetResolver', () => {
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

class FakeValueResolver implements EnvironmentValueResolver {
    public resolve: EnvironmentValueResolver['resolve'] = async (
        logicalName
    ) => `resolved-${ logicalName }`;
}

class FakeReplayBrowser implements BrowserAdapter {
    public closeCount = 0;
    public commands: ActionCommand[] = [];
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
        command: ActionCommand
    ): Promise<ActionResult> => {
        this.commands.push(command);
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
