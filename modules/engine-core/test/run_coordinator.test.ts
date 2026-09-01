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
    CompiledPlan,
    EvidenceRef,
    EnvironmentValueResolver,
    EnvironmentVariable,
    EvaluateVerdictInput,
    IntentBuilder,
    JsonValue,
    PageObservation,
    PlanActionInput,
    RunEvent,
    RunEventPublisher,
    RunResult,
    RunSnapshot,
    ResolvedTarget,
    SemanticAction,
    StartRunInput,
    TestIntent,
    TraceEvent,
    VerdictDecision,
    VerdictEvaluator,
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
            },
            password: {
                source: 'literal',
                value: 'test-password'
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

const plannedPasswordCommand: ActionCommand = {
    type: 'TYPE',
    target: {
        candidateId: 'e2',
        description: '密码输入框'
    },
    value: {
        source: 'environment',
        key: 'password'
    },
    expectedEffect: '密码输入框变为已填写',
    reasonSummary: '填写登录密码',
    risk: 'reversible'
};

const plannedClickCommand: ActionCommand = {
    type: 'CLICK',
    target: {
        candidateId: 'e3',
        description: '登录按钮'
    },
    expectedEffect: '页面进入简道云工作台',
    reasonSummary: '提交登录表单',
    risk: 'side-effect'
};

const finishCommand: ActionCommand = {
    type: 'FINISH',
    reasonSummary: '页面已经显示简道云工作台',
    risk: 'read-only'
};

const passVerdict: VerdictDecision = {
    result: 'PASS',
    summary: '页面已经进入简道云工作台，登录成功。',
    successCriteria: [{
        criterionId: 'workspace-visible',
        status: 'MATCHED',
        summary: '最终页面显示简道云工作台。'
    }],
    failureCriteria: [{
        criterionId: 'login-error',
        status: 'NOT_MATCHED',
        summary: '页面没有账号或密码错误提示。'
    }]
};

const uncertainVerdict: VerdictDecision = {
    result: 'UNCERTAIN',
    summary: '最终页面证据不足，无法判断是否登录成功。',
    successCriteria: [{
        criterionId: 'workspace-visible',
        status: 'UNKNOWN',
        summary: '没有观察到工作台。'
    }],
    failureCriteria: [{
        criterionId: 'login-error',
        status: 'NOT_MATCHED',
        summary: '页面没有账号或密码错误提示。'
    }]
};

describe('RunCoordinator', () => {
    it('串联完整登录多轮动作并使用独立 Verdict 判定成功', async () => {
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const browserAdapter = new FakeBrowserAdapter();
        const actionPlanner = new FakeActionPlanner([
            plannedTypeCommand,
            plannedPasswordCommand,
            plannedClickCommand,
            finishCommand
        ]);
        const valueResolver = new FakeEnvironmentValueResolver();
        const verdictEvaluator = new FakeVerdictEvaluator(passVerdict);
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            intentBuilder,
            browserAdapter,
            {
                actionPlanner,
                verdictEvaluator
            },
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
            verdictEvaluator,
            valueResolver,
            signal: controller.signal
        });
    });

    it('Planner 返回 UNCERTAIN 后由独立 Verdict 保守结束', async () => {
        const artifactStore = new FakeArtifactStore();
        const browserAdapter = new FakeBrowserAdapter();
        const actionPlanner = new FakeActionPlanner({
            type: 'UNCERTAIN',
            reasonSummary: '当前页面无法确定下一步',
            risk: 'read-only'
        });
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner,
                verdictEvaluator: new FakeVerdictEvaluator(uncertainVerdict)
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED', result.summary);
        assert.equal(result.result, 'UNCERTAIN');
        assert.equal(result.metrics.actionCount, 1);
        assert.equal(result.metrics.modelCallCount, 3);
        assert.equal(browserAdapter.executeCount, 1);
        assert.equal(browserAdapter.observeCount, 2);
        assert.equal(browserAdapter.captureScreenshotCount, 1);
        assert.equal(actionPlanner.callCount, 1);
        assert.equal(artifactStore.traces.length, 1);
        assert.equal(artifactStore.savedJson.some(
            ({ name }) => name === 'observation-after-uncertain-retry-1'
        ), false);
        assert.equal(artifactStore.savedArtifacts.some(
            ({ name }) => name === 'screenshot-after-uncertain-retry-1.png'
        ), false);
        assert.equal(result.summary, uncertainVerdict.summary);
    });

});

describe('RunCoordinator 最终观察', () => {
    it('最终 Verdict 使用动作后保存的最新页面观察', async () => {
        const retryObservation = createObservation(
            'https://test.jdydevelop.com/dashboard#/',
            false,
            false,
            true
        );
        retryObservation.visibleText = [ '应用列表', '蒋捷欣' ];
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const browserAdapter = new FakeBrowserAdapter(
            false,
            false,
            [
                undefined,
                undefined,
                undefined,
                retryObservation,
                retryObservation
            ]
        );
        const actionPlanner = new FakeActionPlanner([
            plannedClickCommand,
            {
                type: 'UNCERTAIN',
                reasonSummary: '动作后的页面观察暂时缺少应用列表',
                risk: 'read-only'
            },
            finishCommand
        ]);
        const verdictEvaluator = new FakeVerdictEvaluator(passVerdict);
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner,
                verdictEvaluator
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.result, 'PASS');
        assert.deepEqual(
            verdictEvaluator.lastInput?.observation.visibleText,
            [ '应用列表', '蒋捷欣' ]
        );
        assert.equal(
            artifactStore.updatedSnapshots.at(-1)?.metadata.observationRef,
            `${ result.runId }/json/observation-after-action-2.json`
        );
        assert.equal(
            eventPublisher.events.find(
                (event) => event.type === 'verdict.completed'
            )?.payload.observationRef,
            `${ result.runId }/json/observation-after-action-2.json`
        );
    });
});

describe('RunCoordinator 扩展动作', () => {
    it('允许受限 WAIT 进入成功轨迹并保存计划编译源', async () => {
        const artifactStore = new FakeArtifactStore();
        const verdictEvaluator = new FakeVerdictEvaluator(passVerdict);
        const waitCommand: ActionCommand = {
            type: 'WAIT',
            value: {
                source: 'literal',
                value: 500
            },
            expectedEffect: '等待登录页异步内容稳定',
            reasonSummary: '页面仍在加载提示内容',
            risk: 'read-only'
        };
        const actionPlanner = new FakeActionPlanner([
            waitCommand,
            waitCommand
        ]);
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            new FakeBrowserAdapter(),
            {
                actionPlanner,
                verdictEvaluator
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );
        const compilationSource = artifactStore.savedJson.find(
            ({ name }) => name === 'plan-compilation-source'
        )?.value as unknown as {
            steps: Array<{ command: { type: string } }>
        };

        assert.equal(result.result, 'PASS');
        assert.deepEqual(
            artifactStore.traces.map((trace) => trace.command.type),
            [ 'NAVIGATE', 'WAIT' ]
        );
        assert.deepEqual(
            compilationSource.steps.map((step) => step.command.type),
            [ 'NAVIGATE', 'WAIT' ]
        );
        assert.equal(
            artifactStore.savedJson.some(
                ({ name }) => name === 'compiled-plan'
            ),
            false
        );
        assert.equal(result.metrics.repeatedStateActionCount, 0);
        assert.equal(actionPlanner.callCount, 2);
    });
});

describe('RunCoordinator Planner UNCERTAIN 语义', () => {
    it('下一语义动作不明确时终止，不再触发浏览器侧视觉重试', async () => {
        const unresolvedCommand: ActionCommand = {
            type: 'UNCERTAIN',
            target: {
                description: '当前页面内能够返回工作台的控件'
            },
            expectedEffect: '返回工作台并显示应用列表',
            reasonSummary: '当前观察缺少返回工作台的候选元素',
            risk: 'read-only'
        };
        const browserAdapter = new FakeBrowserAdapter();
        const actionPlanner = new FakeActionPlanner([ unresolvedCommand ]);
        const artifactStore = new FakeArtifactStore();
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner,
                verdictEvaluator: new FakeVerdictEvaluator(uncertainVerdict)
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED', result.summary);
        assert.equal(result.result, 'UNCERTAIN');
        assert.equal(result.metrics.modelCallCount, 3);
        assert.equal(actionPlanner.callCount, 1);
        assert.equal(browserAdapter.executeCount, 1);
        assert.equal(artifactStore.traces.length, 1);
    });
});

describe('RunCoordinator Grounding 边界', () => {
    it('目标无法唯一绑定时不调用浏览器执行该业务动作', async () => {
        const artifactStore = new FakeArtifactStore();
        const browserAdapter = new FakeBrowserAdapter();
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner: new FakeActionPlanner({
                    type: 'CLICK',
                    target: {
                        description: '页面中不存在的操作按钮'
                    },
                    expectedEffect: '页面产生变化',
                    reasonSummary: '尝试执行目标动作'
                }),
                verdictEvaluator: new FakeVerdictEvaluator(uncertainVerdict)
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED', result.summary);
        assert.equal(result.result, 'UNCERTAIN');
        assert.equal(browserAdapter.executeCount, 1);
        assert.equal(artifactStore.traces.length, 1);
        assert.equal(artifactStore.savedJson.some(
            ({ name }) => name === 'grounding-decision-1'
        ), true);
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
    verdictEvaluator: FakeVerdictEvaluator;
}

/** 校验多轮登录闭环的调用次数、证据和敏感值边界。 */
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
        verdictEvaluator,
    } = state;
    assert.equal(result.lifecycle, 'COMPLETED', result.summary);
    assert.equal(result.result, 'PASS');
    assert.equal(result.summary, passVerdict.summary);
    assert.equal(result.metrics.actionCount, 4);
    assert.equal(result.metrics.modelCallCount, 6);
    assert.equal(result.compiledPlanRef, undefined);
    assert.equal(intentBuilder.callCount, 1);
    assert.equal(intentBuilder.lastSignal, signal);
    assert.deepEqual(intentBuilder.lastInput, {
        test: startInput.test,
        environment: startInput.environment,
        projectContext: startInput.projectContext
    });
    assertCompletedArtifactNames(artifactStore);
    assert.equal(artifactStore.updatedSnapshots.at(-1)?.lifecycle, 'COMPLETED');
    assert.equal(browserAdapter.startCount, 1);
    assert.equal(browserAdapter.executeCount, 4);
    assert.equal(browserAdapter.observeCount, 9);
    assert.equal(browserAdapter.captureScreenshotCount, 8);
    assert.equal(browserAdapter.closeCount, 1);
    assert.equal(artifactStore.traces.length, 4);
    assert.equal(artifactStore.savedArtifacts.length, 8);
    assertObservationEventsIncludeScreenshot(eventPublisher.events);
    assert.equal(actionPlanner.callCount, 4);
    assert.deepEqual(
        actionPlanner.lastInput?.availableEnvironmentVariables,
        [
            'username',
            'password'
        ]
    );
    assert.equal(
        actionPlanner.lastInput?.remainingBudgets.maxActions,
        16
    );
    assert.deepEqual(artifactStore.traces[1]?.command.value, {
        source: 'environment',
        key: 'username'
    });
    assert.deepEqual(browserAdapter.commands[1]?.value, {
        source: 'literal',
        value: 'tester@example.com'
    });
    assert.deepEqual(browserAdapter.commands[2]?.value, {
        source: 'literal',
        value: 'test-password'
    });
    assert.equal(browserAdapter.commands[3]?.type, 'CLICK');
    assert.equal(browserAdapter.resolvedTargets[1]?.candidateId, 'e1');
    assert.equal(browserAdapter.resolvedTargets[2]?.candidateId, 'e2');
    assert.equal(browserAdapter.resolvedTargets[3]?.candidateId, 'e3');
    assertGroundingEvidencePersisted(artifactStore);
    assert.deepEqual(valueResolver.resolvedNames, [
        'username',
        'password'
    ]);
    assert.equal(verdictEvaluator.callCount, 1);
    assert.equal(verdictEvaluator.lastInput?.stopCommand.type, 'FINISH');
    assert.equal(artifactStore.results[0], result);
    assertCompilationSourceIsSafe(artifactStore);
    assert.deepEqual(
        eventPublisher.events.map((event) => event.sequence),
        eventPublisher.events.map((_event, index) => index + 1)
    );
    assert.equal(eventPublisher.events.at(-1)?.type, 'run.completed');
}

function assertCompletedArtifactNames(artifactStore: FakeArtifactStore): void {
    assert.deepEqual(artifactStore.savedJson.map(({ name }) => name), [
        'intent',
        'observation-before-navigation',
        'observation-after-navigation',
        'page-perception-1',
        'observation-reobserve-2',
        'page-perception-2',
        'page-settling-1',
        'grounding-decision-1',
        'observation-after-action-2',
        'page-perception-3',
        'observation-reobserve-4',
        'page-perception-4',
        'page-settling-2',
        'grounding-decision-2',
        'observation-after-action-3',
        'page-perception-5',
        'observation-reobserve-6',
        'page-perception-6',
        'page-settling-3',
        'grounding-decision-3',
        'observation-after-action-4',
        'page-perception-7',
        'observation-reobserve-8',
        'page-perception-8',
        'page-settling-4',
        'grounding-decision-4',
        'verdict',
        'plan-compilation-source'
    ]);
}

function assertGroundingEvidencePersisted(
    artifactStore: FakeArtifactStore
): void {
    const groundedTrace = artifactStore.traces[1];
    assert.equal(groundedTrace?.origin, 'planner');
    assert.equal(groundedTrace?.semanticStepId, 'runtime-step-1');
    assert.equal(groundedTrace?.compilationContribution, 'productive');
    assert.equal(groundedTrace?.semanticStepProgress?.status, 'complete');
    assert.equal(
        groundedTrace?.semanticAction?.target?.description,
        '账号输入框'
    );
    assert.equal(groundedTrace?.resolvedTarget?.elementSnapshot.name, '账号');
    assert.equal(
        'candidateId' in (groundedTrace?.resolvedTarget?.elementSnapshot ?? {}),
        false
    );
}

function assertObservationEventsIncludeScreenshot(events: RunEvent[]): void {
    assert.equal(events.some((event) => (
        event.type === 'observation.created'
        && typeof event.payload.screenshotRef === 'string'
        && event.payload.screenshotRef.endsWith('.png')
    )), true);
}

/** 校验编译源保留候选定位，但不泄露已解析的密码值。 */
function assertCompilationSourceIsSafe(artifactStore: FakeArtifactStore): void {
    const compilationSource = artifactStore.savedJson.find(
        ({ name }) => name === 'plan-compilation-source'
    )?.value;
    assert.equal(
        JSON.stringify(compilationSource).includes('candidateId'),
        true
    );
    assert.equal(
        JSON.stringify(compilationSource).includes('test-password'),
        false
    );
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
            {
                actionPlanner: new FakeActionPlanner(plannedTypeCommand),
                verdictEvaluator: new FakeVerdictEvaluator(passVerdict)
            },
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
            {
                actionPlanner: new FakeActionPlanner(plannedTypeCommand),
                verdictEvaluator: new FakeVerdictEvaluator(passVerdict)
            },
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

describe('RunCoordinator 稳定性保护', () => {
    it('持久化异常前移除 ANSI 终端样式码', async () => {
        const escape = String.fromCharCode(27);
        const coordinator = new RunCoordinator(
            new FakeArtifactStore(),
            new FakeRunEventPublisher(),
            {
                build: () => Promise.reject(new Error(
                    `page.screenshot: ${ escape }[2mTimeout${ escape }[22m`
                ))
            },
            new FakeBrowserAdapter(),
            {
                actionPlanner: new FakeActionPlanner(plannedTypeCommand),
                verdictEvaluator: new FakeVerdictEvaluator(passVerdict)
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(
            result.summary,
            '测试运行异常：page.screenshot: Timeout'
        );
        assert.equal(result.summary.includes(escape), false);
    });

    it('最终页面未渲染时不误判为业务成功', async () => {
        const browserAdapter = new FakeBrowserAdapter(false, true);
        const verdictEvaluator = new FakeVerdictEvaluator(passVerdict);
        const coordinator = new RunCoordinator(
            new FakeArtifactStore(),
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner: new FakeActionPlanner([
                    plannedTypeCommand,
                    plannedPasswordCommand,
                    plannedClickCommand,
                    finishCommand
                ]),
                verdictEvaluator
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED');
        assert.equal(result.result, 'UNCERTAIN');
        assert.equal(result.failure?.category, 'VERDICT_INSUFFICIENT');
        assert.equal(verdictEvaluator.callCount, 0);
        assert.equal(browserAdapter.startCount, 1);
        assert.match(result.summary, /未渲染出可验证内容/u);
    });
});

describe('RunCoordinator 探索与计划生成分离', () => {
    it('首次探索通过后不自动打开第二个浏览器', async () => {
        const artifactStore = new FakeArtifactStore();
        const browserAdapter = new FakeBrowserAdapter(true);
        const verdictEvaluator = new FakeVerdictEvaluator(passVerdict);
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner: new FakeActionPlanner([
                    plannedTypeCommand,
                    plannedPasswordCommand,
                    plannedClickCommand,
                    finishCommand
                ]),
                verdictEvaluator
            },
            new FakeEnvironmentValueResolver()
        );

        const result = await coordinator.start(
            startInput,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED');
        assert.equal(result.result, 'PASS');
        assert.equal(result.failure, undefined);
        assert.equal(result.metrics.actionCount, 4);
        assert.equal(verdictEvaluator.callCount, 1);
        assert.equal(browserAdapter.startCount, 1);
        assert.equal(browserAdapter.closeCount, 1);
        assert.equal(
            artifactStore.savedJson.some(
                ({ name }) => name === 'plan-compilation-source'
            ),
            true
        );
        assert.equal(
            artifactStore.savedJson.some(({ name }) => name === 'compiled-plan'),
            false
        );
    });
});

describe('RunCoordinator structured-replay', () => {
    it('读取计划后跳过 Intent Builder 和 Planner 完成独立运行', async () => {
        const artifactStore = new FakeArtifactStore();
        const planRef = 'source-run/json/compiled-plan.json';
        artifactStore.readableJson.set(planRef, createStructuredReplayPlan());
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const actionPlanner = new FakeActionPlanner(plannedTypeCommand);
        const browserAdapter = new FakeBrowserAdapter();
        const valueResolver = new FakeEnvironmentValueResolver();
        const verdictEvaluator = new FakeVerdictEvaluator(passVerdict);
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            intentBuilder,
            browserAdapter,
            {
                actionPlanner,
                verdictEvaluator
            },
            valueResolver
        );

        const result = await coordinator.start(
            createStructuredReplayInput(planRef),
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'COMPLETED');
        assert.equal(result.result, 'PASS');
        assert.equal(result.compiledPlanRef, planRef);
        assert.equal(result.metrics.actionCount, 4);
        assert.equal(result.metrics.modelCallCount, 1);
        assert.equal(intentBuilder.callCount, 0);
        assert.equal(actionPlanner.callCount, 0);
        assert.equal(verdictEvaluator.callCount, 1);
        assert.equal(browserAdapter.startCount, 1);
        assert.equal(browserAdapter.executeCount, 4);
        assert.equal(artifactStore.traces.length, 4);
        assert.equal(
            artifactStore.savedJson.some(({ name }) => name === 'intent'),
            false
        );
        assert.deepEqual(valueResolver.resolvedNames, [
            'username',
            'password'
        ]);
    });

    it('缺少 planRef 时在启动浏览器前安全失败', async () => {
        const artifactStore = new FakeArtifactStore();
        const browserAdapter = new FakeBrowserAdapter();
        const coordinator = new RunCoordinator(
            artifactStore,
            new FakeRunEventPublisher(),
            new FakeIntentBuilder(testIntent),
            browserAdapter,
            {
                actionPlanner: new FakeActionPlanner(plannedTypeCommand),
                verdictEvaluator: new FakeVerdictEvaluator(passVerdict)
            },
            new FakeEnvironmentValueResolver()
        );
        const input = createStructuredReplayInput('');

        const result = await coordinator.start(
            input,
            new AbortController().signal
        );

        assert.equal(result.lifecycle, 'CRASHED');
        assert.equal(result.failure?.category, 'REPLAY_FAILED');
        assert.equal(result.failure?.phase, 'REPLAY_VALIDATING');
        assert.equal(browserAdapter.startCount, 0);
    });
});

function createStructuredReplayInput(planRef: string): StartRunInput {
    return {
        ...structuredClone(startInput),
        mode: 'structured-replay',
        test: {
            ...structuredClone(startInput.test),
            execution: {
                planRef,
                preferredMode: 'structured-replay'
            }
        },
        budgets: {
            ...startInput.budgets,
            maxModelCalls: 1
        }
    };
}

function createStructuredReplayPlan(): CompiledPlan {
    return {
        schemaVersion: 1,
        planId: 'compiled-login-plan',
        testId: startInput.test.id,
        sourceRunId: 'source-run',
        sourceTraceRef: 'source-run/trace.jsonl',
        createdAt: '2026-08-26T06:00:00.000Z',
        allowedHosts: [ 'test.jdydevelop.com' ],
        testIntent: structuredClone(testIntent),
        steps: [{
            id: 'step-1',
            sequence: 1,
            type: 'NAVIGATE',
            value: {
                source: 'literal',
                value: startInput.test.startUrl ?? ''
            },
            expectedEffect: '浏览器加载测试起始页面',
            risk: 'read-only'
        }, createCompiledTypeStep(
            2,
            'username',
            '账号',
            'textbox::账号',
            'text'
        ), createCompiledTypeStep(
            3,
            'password',
            '密码',
            'textbox::密码',
            'password'
        ), {
            id: 'step-4',
            sequence: 4,
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
            expectedEffect: '页面进入简道云工作台',
            risk: 'side-effect'
        }]
    };
}

function createCompiledTypeStep(
    sequence: number,
    key: string,
    name: string,
    locatorValue: string,
    inputType: string
): CompiledPlan['steps'][number] {
    return {
        id: `step-${ sequence }`,
        sequence,
        type: 'TYPE',
        target: {
            description: `${ name }输入框`,
            locatorHints: [{
                strategy: 'role-name',
                value: locatorValue
            }],
            identity: {
                tag: 'input',
                role: 'textbox',
                name,
                inputType
            }
        },
        value: {
            source: 'environment',
            key
        },
        expectedEffect: `${ name }输入框变为已填写`,
        risk: 'reversible'
    };
}

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
    public readonly readableJson = new Map<string, unknown>();

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

    /** 返回测试预先注册的 JSON。 */
    public loadJson = (reference: string): Promise<unknown> => {
        if (!this.readableJson.has(reference)) {
            return Promise.reject(
                new Error(`FakeArtifactStore 没有预设 JSON：${ reference }`)
            );
        }
        return Promise.resolve(this.readableJson.get(reference));
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
    public readonly inputs: PlanActionInput[] = [];

    private readonly actions: SemanticAction[];

    constructor(
        command: ActionCommand | SemanticAction |
        Array<ActionCommand | SemanticAction>
    ) {
        this.actions = (Array.isArray(command) ? command : [command])
            .map(toSemanticActionFixture);
    }

    /** 模拟一次受控的单步规划。 */
    public plan = (
        input: PlanActionInput,
        signal: AbortSignal
    ): Promise<SemanticAction> => {
        signal.throwIfAborted();
        this.callCount += 1;
        this.lastInput = input;
        this.inputs.push(input);
        const action = this.actions[this.callCount - 1] ??
            this.actions.at(-1);
        if (!action) {
            return Promise.reject(new Error('Fake Planner 没有预设动作。'));
        }
        return Promise.resolve(action);
    };
}

function toSemanticActionFixture(
    command: ActionCommand | SemanticAction
): SemanticAction {
    return {
        type: command.type,
        ...command.target
            ? {
                target: {
                    description: command.target.description,
                    ...'scope' in command.target && command.target.scope
                        ? { scope: command.target.scope }
                        : {},
                    ...'relation' in command.target && command.target.relation
                        ? { relation: command.target.relation }
                        : {}
                }
            }
            : {},
        ...command.value ? { value: structuredClone(command.value) } : {},
        ...command.expectedEffect
            ? { expectedEffect: command.expectedEffect }
            : {},
        reasonSummary: command.reasonSummary
    };
}

/** 返回固定独立判定并记录最终页面上下文。 */
class FakeVerdictEvaluator implements VerdictEvaluator {
    public callCount = 0;
    public lastInput?: EvaluateVerdictInput;

    constructor(private readonly decision: VerdictDecision) {}

    /** 模拟一次独立 Verdict 调用。 */
    public evaluate = (
        input: EvaluateVerdictInput,
        signal: AbortSignal
    ): Promise<VerdictDecision> => {
        signal.throwIfAborted();
        this.callCount += 1;
        this.lastInput = input;
        return Promise.resolve(this.decision);
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
    public readonly resolvedTargets: Array<ResolvedTarget | undefined> = [];
    private readonly sessionCommands = new Map<string, ActionCommand[]>();

    constructor(
        private readonly failReplay = false,
        private readonly unreadyAfterLogin = false,
        private readonly observationOverrides: Array<
            PageObservation | undefined
        > = []
    ) {}

    /** 返回一段固定的浏览器会话。 */
    public start = (): Promise<BrowserSession> => {
        this.startCount += 1;
        const sessionId = `browser-session-${ this.startCount }`;
        this.sessionCommands.set(sessionId, []);
        return Promise.resolve({
            sessionId
        });
    };

    /** 依次返回空白页、登录表单各输入状态和工作台。 */
    public observe = (session: BrowserSession): Promise<PageObservation> => {
        this.observeCount += 1;
        const commands = this.sessionCommands.get(session.sessionId);
        if (!commands) {
            return Promise.reject(new Error('测试浏览器会话不存在。'));
        }
        if (commands.length === 0) {
            return Promise.resolve(
                structuredClone(
                    this.observationOverrides[this.observeCount - 1] ??
                    createObservation('about:blank')
                )
            );
        }
        const loginSubmitted = commands.some(
            (command) => command.type === 'CLICK'
        );
        const observation = createObservation(
            loginSubmitted
                ? 'https://test.jdydevelop.com/dashboard#/'
                : startInput.test.startUrl ?? '',
            commands.some(
                (command) => command.value?.source === 'literal' &&
                    command.value.value === 'tester@example.com'
            ),
            commands.some(
                (command) => command.value?.source === 'literal' &&
                    command.value.value === 'test-password'
            ),
            loginSubmitted
        );
        const resolvedObservation = loginSubmitted && this.unreadyAfterLogin
                ? {
                    ...observation,
                    page: {
                        ...observation.page,
                        loading: true
                    },
                    visibleText: [],
                    interactiveElements: [],
                    notices: [{
                        level: 'warning',
                        text: '页面仍未渲染。'
                    }]
                }
                : observation;
        return Promise.resolve(
            structuredClone(
                this.observationOverrides[this.observeCount - 1] ??
                resolvedObservation
            )
        );
    };

    /** 模拟一次成功的起始页导航。 */
    public execute = (
        session: BrowserSession,
        command: ActionCommand,
        target?: ResolvedTarget
    ): Promise<ActionResult> => {
        this.executeCount += 1;
        this.commands.push(command);
        this.resolvedTargets.push(target);
        const commands = this.sessionCommands.get(session.sessionId);
        if (!commands) {
            return Promise.reject(new Error('测试浏览器会话不存在。'));
        }
        commands.push(command);
        const shouldFail = this.failReplay
            && session.sessionId === 'browser-session-2';
        return Promise.resolve({
            status: shouldFail ? 'failed' : 'executed',
            startedAt: '2026-08-21T00:00:00.000Z',
            finishedAt: '2026-08-21T00:00:01.000Z',
            ...shouldFail
                ? {
                    error: {
                        code: 'REPLAY_TEST_FAILURE',
                        message: '模拟回放失败'
                    }
                }
                : {},
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: command.type === 'NAVIGATE' ||
                    command.type === 'CLICK'
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
    public close = (session: BrowserSession): Promise<void> => {
        this.closeCount += 1;
        this.sessionCommands.delete(session.sessionId);
        return Promise.resolve();
    };
}

/** 创建供协调器持久化的最小页面观察。 */
function createObservation(
    url: string,
    usernameFilled = false,
    passwordFilled = false,
    workspaceVisible = false
): PageObservation {
    return {
        schemaVersion: 1,
        observationId: `observation-${ url }`,
        capturedAt: '2026-08-21T00:00:00.000Z',
        page: {
            loading: false,
            title: url === 'about:blank'
                ? ''
                : workspaceVisible
                    ? '简道云工作台'
                    : '简道云登录',
            url,
            viewport: {
                width: 1280,
                height: 720
            }
        },
        visibleText: url === 'about:blank'
            ? []
            : workspaceVisible
                ? ['简道云工作台']
                : ['登录'],
        interactiveElements: url === 'about:blank' || workspaceVisible
            ? []
            : createLoginElements(usernameFilled, passwordFilled),
        notices: [],
        tabs: [{
            active: true,
            title: '',
            url
        }],
        stateFingerprint: [
            'fingerprint',
            url,
            usernameFilled,
            passwordFilled,
            workspaceVisible
        ].join('-'),
        truncated: false
    };
}

/** 创建登录页的三个确定性候选元素。 */
function createLoginElements(
    usernameFilled: boolean,
    passwordFilled: boolean
): PageObservation['interactiveElements'] {
    return [
        {
            candidateId: 'e1',
            tag: 'input',
            role: 'textbox',
            name: '账号',
            valueState: usernameFilled ? 'filled' : 'empty',
            disabled: false,
            visible: true,
            inViewport: true,
            boundingBox: { x: 10, y: 10, width: 200, height: 32 },
            attributes: {},
            nearbyText: [],
            locatorHints: [{
                strategy: 'role-name',
                value: 'textbox::账号'
            }]
        },
        {
            candidateId: 'e2',
            tag: 'input',
            role: 'textbox',
            name: '密码',
            valueState: passwordFilled ? 'masked' : 'empty',
            disabled: false,
            visible: true,
            inViewport: true,
            boundingBox: { x: 10, y: 52, width: 200, height: 32 },
            attributes: { type: 'password' },
            nearbyText: [],
            locatorHints: [{
                strategy: 'role-name',
                value: 'textbox::密码'
            }]
        },
        {
            candidateId: 'e3',
            tag: 'button',
            role: 'button',
            name: '登录',
            disabled: false,
            visible: true,
            inViewport: true,
            boundingBox: { x: 10, y: 94, width: 100, height: 32 },
            attributes: {},
            nearbyText: [],
            locatorHints: [{
                strategy: 'role-name',
                value: 'button::登录'
            }]
        }
    ];
}
