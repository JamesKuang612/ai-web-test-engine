import assert from 'node:assert/strict';
import type {
    ActionCommand,
    ActionPlanner,
    ActionResult,
    ArtifactInput,
    ArtifactStore,
    BrowserAdapter,
    BrowserSession,
    BuildIntentInput,
    EvidenceRef,
    EnvironmentValueResolver,
    EnvironmentVariable,
    IntentBuilder,
    JsonValue,
    PageObservation,
    PlanActionInput,
    RunEvent,
    RunEventPublisher,
    RunResult,
    RunSnapshot,
    StartRunInput,
    TestIntent,
    TraceEvent,
} from '../src';
import {
    RunCoordinator,
} from '../src';

const startInput: StartRunInput = {
    test: {
        schemaVersion: 1,
        id: 'login-jiandaoyun',
        name: '登录简道云',
        environmentId: 'jiandaoyun-test',
        startUrl: 'https://test.jdydevelop.com/portal/signin',
        action: '帮我登录'
    },
    environment: {
        schemaVersion: 1,
        id: 'jiandaoyun-test',
        name: '简道云测试环境',
        baseUrl: 'https://test.jdydevelop.com',
        allowedHosts: [
            'test.jdydevelop.com'
        ],
        variables: {
            username: {
                source: 'literal',
                value: 'tester@example.com'
            }
        }
    },
    mode: 'ai-explore',
    projectContext: {
        projectId: 'ai-web-test-engine',
        rules: [],
        terms: {}
    },
    budgets: {
        maxActions: 20,
        maxDurationMs: 60_000,
        maxModelCalls: 10,
        maxRepeatedStateActions: 2
    }
};

const testIntent: TestIntent = {
    schemaVersion: 1,
    objective: '登录简道云并进入工作台',
    preconditions: [],
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
        'test.jdydevelop.com'
    ],
    dataPolicy: {
        generatedValues: {}
    }
};

const plannedTypeCommand: ActionCommand = {
    type: 'TYPE',
    target: {
        candidateId: 'e1',
        description: '账号输入框'
    },
    value: {
        source: 'environment',
        key: 'username'
    },
    expectedEffect: '账号输入框变为已填写',
    reasonSummary: '先填写登录账号',
    risk: 'reversible'
};

describe('RunCoordinator', () => {
    it('串联意图、浏览器导航、页面观察和本地产物', async () => {
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const browserAdapter = new FakeBrowserAdapter();
        const actionPlanner = new FakeActionPlanner(plannedTypeCommand);
        const valueResolver = new FakeEnvironmentValueResolver();
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            intentBuilder,
            browserAdapter,
            actionPlanner,
            valueResolver
        );
        const controller = new AbortController();

        const result = await coordinator.start(
            startInput,
            controller.signal
        );

        assertCompletedAiRun({
            result,
            artifactStore,
            eventPublisher,
            intentBuilder,
            browserAdapter,
            actionPlanner,
            valueResolver,
            signal: controller.signal
        });
    });

    it('Planner 未返回 TYPE 时保守结束且不执行额外浏览器动作', async () => {
        const artifactStore = new FakeArtifactStore();
        const browserAdapter = new FakeBrowserAdapter();
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            new FakeActionPlanner({
                type: 'UNCERTAIN',
                reasonSummary: '当前页面无法确定下一步',
                risk: 'read-only'
            }),
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED');
        assert.equal(result.result, 'UNCERTAIN');
        assert.equal(result.metrics.actionCount, 1);
        assert.equal(result.metrics.modelCallCount, 2);
        assert.equal(browserAdapter.executeCount, 1);
        assert.equal(artifactStore.traces.length, 1);
        assert.match(result.summary, /Planner 返回 UNCERTAIN/u);
    });
});

interface CompletedRunState {
    actionPlanner: FakeActionPlanner;
    artifactStore: FakeArtifactStore;
    browserAdapter: FakeBrowserAdapter;
    eventPublisher: FakeRunEventPublisher;
    intentBuilder: FakeIntentBuilder;
    result: RunResult;
    signal: AbortSignal;
    valueResolver: FakeEnvironmentValueResolver;
}

/** 校验最小 AI 输入闭环的调用次数、证据和敏感值边界。 */
function assertCompletedAiRun(state: CompletedRunState): void {
    const {
        actionPlanner,
        artifactStore,
        browserAdapter,
        eventPublisher,
        intentBuilder,
        result,
        signal,
        valueResolver,
    } = state;
    assert.equal(result.lifecycle, 'COMPLETED');
    assert.equal(result.result, 'UNCERTAIN');
    assert.equal(result.metrics.actionCount, 2);
    assert.equal(result.metrics.modelCallCount, 2);
    assert.equal(intentBuilder.callCount, 1);
    assert.equal(intentBuilder.lastSignal, signal);
    assert.deepEqual(intentBuilder.lastInput, {
        test: startInput.test,
        environment: startInput.environment,
        projectContext: startInput.projectContext
    });
    assert.deepEqual(
        artifactStore.savedJson.map(({ name }) => name),
        [
            'intent',
            'observation-before-navigation',
            'observation-after-navigation',
            'observation-after-planned-action'
        ]
    );
    assert.equal(
        artifactStore.updatedSnapshots.at(-1)?.lifecycle,
        'COMPLETED'
    );
    assert.equal(browserAdapter.startCount, 1);
    assert.equal(browserAdapter.executeCount, 2);
    assert.equal(browserAdapter.observeCount, 3);
    assert.equal(browserAdapter.captureScreenshotCount, 2);
    assert.equal(browserAdapter.closeCount, 1);
    assert.equal(artifactStore.traces.length, 2);
    assert.equal(artifactStore.savedArtifacts.length, 2);
    assert.equal(actionPlanner.callCount, 1);
    assert.deepEqual(
        actionPlanner.lastInput?.availableEnvironmentVariables,
        ['username']
    );
    assert.equal(
        actionPlanner.lastInput?.remainingBudgets.maxActions,
        19
    );
    assert.deepEqual(artifactStore.traces[1]?.command.value, {
        source: 'environment',
        key: 'username'
    });
    assert.deepEqual(browserAdapter.commands[1]?.value, {
        source: 'literal',
        value: 'tester@example.com'
    });
    assert.deepEqual(valueResolver.resolvedNames, ['username']);
    assert.equal(artifactStore.results[0], result);
    assert.deepEqual(
        eventPublisher.events.map((event) => event.sequence),
        eventPublisher.events.map((_event, index) => index + 1)
    );
    assert.equal(eventPublisher.events.at(-1)?.type, 'run.completed');
}

describe('RunCoordinator 终止路径', () => {
    it('运行提前取消时保存取消结果且不调用外部能力', async () => {
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const browserAdapter = new FakeBrowserAdapter();
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            intentBuilder,
            browserAdapter,
            new FakeActionPlanner(plannedTypeCommand),
            new FakeEnvironmentValueResolver()
        );
        const controller = new AbortController();
        controller.abort();

        const result = await coordinator.start(
            startInput,
            controller.signal
        );

        assert.equal(result.lifecycle, 'CANCELLED');
        assert.equal(intentBuilder.callCount, 0);
        assert.equal(browserAdapter.startCount, 0);
        assert.deepEqual(artifactStore.savedJson, []);
        assert.equal(artifactStore.results[0], result);
        assert.deepEqual(
            eventPublisher.events.map((event) => event.type),
            [
                'run.created',
                'run.status.changed',
                'run.cancelled'
            ]
        );
    });

    it('模型异常时保留实际失败阶段和稳定分类', async () => {
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const browserAdapter = new FakeBrowserAdapter();
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            {
                build: () => Promise.reject(
                    new Error('模型暂时不可用')
                )
            },
            browserAdapter,
            new FakeActionPlanner(plannedTypeCommand),
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'CRASHED');
        assert.equal(result.failure?.phase, 'BUILDING_INTENT');
        assert.equal(result.failure?.category, 'MODEL_UNAVAILABLE');
        assert.equal(browserAdapter.startCount, 0);
    });
});

/** 使用内存数组记录 RunCoordinator 的持久化调用。 */
class FakeArtifactStore implements ArtifactStore {
    public readonly createdSnapshots: RunSnapshot[] = [];
    public readonly updatedSnapshots: RunSnapshot[] = [];
    public readonly traces: TraceEvent[] = [];
    public readonly results: RunResult[] = [];
    public readonly savedArtifacts: ArtifactInput[] = [];
    public readonly savedJson: Array<{
        runId: string,
        name: string,
        value: JsonValue
    }> = [];

    /** 记录初始运行快照。 */
    public createRun = (snapshot: RunSnapshot): Promise<void> => {
        this.createdSnapshots.push(snapshot);
        return Promise.resolve();
    };

    /** 记录每次更新后的运行快照。 */
    public updateRun = (snapshot: RunSnapshot): Promise<void> => {
        this.updatedSnapshots.push(snapshot);
        return Promise.resolve();
    };

    /** 记录协调器追加的动作轨迹。 */
    public appendTrace = (
        _runId: string,
        event: TraceEvent
    ): Promise<void> => {
        this.traces.push(event);
        return Promise.resolve();
    };

    /** 返回一个稳定的模拟证据引用。 */
    public saveArtifact = (
        runId: string,
        artifact: ArtifactInput
    ): Promise<EvidenceRef> => {
        this.savedArtifacts.push(artifact);
        return Promise.resolve({
            kind: artifact.kind,
            mediaType: artifact.mediaType,
            ref: `${ runId }/artifacts/${ artifact.name }`
        });
    };

    /** 记录测试意图并返回它的本地引用。 */
    public saveJson = (
        runId: string,
        name: string,
        value: JsonValue
    ): Promise<EvidenceRef> => {
        this.savedJson.push({
            runId,
            name,
            value
        });
        return Promise.resolve({
            kind: 'json',
            mediaType: 'application/json',
            ref: `${ runId }/json/${ name }.json`
        });
    };

    /** 记录协调器生成的最终运行结果。 */
    public saveResult = (
        result: RunResult
    ): Promise<void> => {
        this.results.push(result);
        return Promise.resolve();
    };
}

/** 使用内存数组记录协调器发布的运行事件。 */
class FakeRunEventPublisher implements RunEventPublisher {
    public readonly events: RunEvent[] = [];

    /** 记录一条运行事件。 */
    public publish = (event: RunEvent): Promise<void> => {
        this.events.push(event);
        return Promise.resolve();
    };
}

/** 返回预设测试意图并记录协调器传入的参数。 */
class FakeIntentBuilder implements IntentBuilder {
    public callCount = 0;
    public lastInput?: BuildIntentInput;
    public lastSignal?: AbortSignal;

    constructor(private readonly intent: TestIntent) {}

    /** 模拟一次成功的测试意图构建。 */
    public build = (
        input: BuildIntentInput,
        signal: AbortSignal
    ): Promise<TestIntent> => {
        signal.throwIfAborted();
        this.callCount += 1;
        this.lastInput = input;
        this.lastSignal = signal;
        return Promise.resolve(this.intent);
    };
}

/** 返回预设单步动作并记录 Planner 输入。 */
class FakeActionPlanner implements ActionPlanner {
    public callCount = 0;
    public lastInput?: PlanActionInput;

    constructor(private readonly command: ActionCommand) {}

    /** 模拟一次受控的单步规划。 */
    public plan = (
        input: PlanActionInput,
        signal: AbortSignal
    ): Promise<ActionCommand> => {
        signal.throwIfAborted();
        this.callCount += 1;
        this.lastInput = input;
        return Promise.resolve(this.command);
    };
}

/** 从测试环境定义中解析字面量并记录逻辑名称。 */
class FakeEnvironmentValueResolver implements EnvironmentValueResolver {
    public readonly resolvedNames: string[] = [];

    /** 测试环境只提供安全字面量。 */
    public resolve = (
        logicalName: string,
        variable: EnvironmentVariable
    ): Promise<JsonValue> => {
        this.resolvedNames.push(logicalName);
        if (variable.source !== 'literal') {
            return Promise.reject(new Error('测试变量必须是字面量。'));
        }
        return Promise.resolve(variable.value);
    };
}

/** 用固定页面状态模拟核心层依赖的浏览器端口。 */
class FakeBrowserAdapter implements BrowserAdapter {
    public startCount = 0;
    public observeCount = 0;
    public executeCount = 0;
    public closeCount = 0;
    public captureScreenshotCount = 0;
    public readonly commands: ActionCommand[] = [];

    /** 返回一段固定的浏览器会话。 */
    public start = (): Promise<BrowserSession> => {
        this.startCount += 1;
        return Promise.resolve({
            sessionId: 'browser-session-001'
        });
    };

    /** 第一次返回空白页，后续返回登录页及输入状态。 */
    public observe = (): Promise<PageObservation> => {
        this.observeCount += 1;
        return Promise.resolve(createObservation(
            this.observeCount === 1
                ? 'about:blank'
                : startInput.test.startUrl ?? '',
            this.executeCount > 1
        ));
    };

    /** 模拟一次成功的起始页导航。 */
    public execute = (
        _session: BrowserSession,
        command: ActionCommand
    ): Promise<ActionResult> => {
        this.executeCount += 1;
        this.commands.push(command);
        return Promise.resolve({
            status: 'executed',
            startedAt: '2026-08-21T00:00:00.000Z',
            finishedAt: '2026-08-21T00:00:01.000Z',
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: command.type === 'NAVIGATE'
            }
        });
    };

    /** 返回固定 PNG 头部，供协调器截图能力测试使用。 */
    public captureScreenshot = (): Promise<{
        content: Uint8Array,
        mediaType: 'image/png'
    }> => {
        this.captureScreenshotCount += 1;
        return Promise.resolve({
            content: new Uint8Array([
                137,
                80,
                78,
                71
            ]),
            mediaType: 'image/png'
        });
    };

    /** 当前地基测试不需要重置浏览器。 */
    public reset = (_session: BrowserSession): Promise<void> =>
        Promise.resolve();

    /** 记录浏览器会话已经释放。 */
    public close = (_session: BrowserSession): Promise<void> => {
        this.closeCount += 1;
        return Promise.resolve();
    };
}

/** 创建供协调器持久化的最小页面观察。 */
function createObservation(
    url: string,
    usernameFilled = false
): PageObservation {
    return {
        schemaVersion: 1,
        observationId: `observation-${ url }`,
        capturedAt: '2026-08-21T00:00:00.000Z',
        page: {
            loading: false,
            title: url === 'about:blank'
                ? ''
                : '简道云登录',
            url,
            viewport: {
                width: 1280,
                height: 720
            }
        },
        visibleText: url === 'about:blank'
            ? []
            : ['登录'],
        interactiveElements: url === 'about:blank'
            ? []
            : [{
                candidateId: 'e1',
                tag: 'input',
                role: 'textbox',
                name: '账号',
                valueState: usernameFilled ? 'filled' : 'empty',
                disabled: false,
                visible: true,
                inViewport: true,
                attributes: {},
                nearbyText: [],
                locatorHints: []
            }],
        notices: [],
        tabs: [{
            active: true,
            title: '',
            url
        }],
        stateFingerprint: `fingerprint-${ url }`,
        truncated: false
    };
}
