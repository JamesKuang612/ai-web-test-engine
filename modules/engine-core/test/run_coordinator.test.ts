import assert from 'node:assert/strict';
import type {
    ArtifactInput,
    ArtifactStore,
    BuildIntentInput,
    EvidenceRef,
    IntentBuilder,
    JsonValue,
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
        variables: {}
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

describe('RunCoordinator', () => {
    it('进入意图构建阶段并保存生成的 TestIntent', async () => {
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            intentBuilder
        );
        const controller = new AbortController();

        await assert.rejects(
            coordinator.start(startInput, controller.signal),
            /核心执行流程尚未实现/u
        );

        assert.equal(intentBuilder.callCount, 1);
        assert.equal(intentBuilder.lastSignal, controller.signal);
        assert.deepEqual(intentBuilder.lastInput, {
            test: startInput.test,
            environment: startInput.environment,
            projectContext: startInput.projectContext
        });
        assert.deepEqual(artifactStore.savedJson, {
            runId: artifactStore.createdSnapshots[0].runId,
            name: 'intent',
            value: testIntent
        });
        assert.deepEqual(
            artifactStore.updatedSnapshots.map(
                (snapshot) => snapshot.lifecycle
            ),
            [
                'STARTING',
                'BUILDING_INTENT',
                'BUILDING_INTENT'
            ]
        );
        assert.equal(
            artifactStore.updatedSnapshots.at(-1)?.metadata.intentRef,
            `${ artifactStore.createdSnapshots[0].runId }/json/intent.json`
        );
        assert.deepEqual(
            eventPublisher.events.map((event) => event.sequence),
            [
                1,
                2,
                3
            ]
        );
    });

    it('运行提前取消时不调用 IntentBuilder', async () => {
        const artifactStore = new FakeArtifactStore();
        const eventPublisher = new FakeRunEventPublisher();
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const coordinator = new RunCoordinator(
            artifactStore,
            eventPublisher,
            intentBuilder
        );
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            coordinator.start(startInput, controller.signal),
            hasErrorName('AbortError')
        );

        assert.equal(intentBuilder.callCount, 0);
        assert.equal(artifactStore.savedJson, undefined);
        assert.deepEqual(
            eventPublisher.events.map((event) => event.sequence),
            [
                1
            ]
        );
    });
});

/** 使用内存数组记录 RunCoordinator 的持久化调用。 */
class FakeArtifactStore implements ArtifactStore {
    public readonly createdSnapshots: RunSnapshot[] = [];
    public readonly updatedSnapshots: RunSnapshot[] = [];
    public savedJson?: {
        runId: string,
        name: string,
        value: JsonValue
    };

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

    /** 当前测试不需要持久化动作轨迹。 */
    public appendTrace = (
        _runId: string,
        _event: TraceEvent
    ): Promise<void> => Promise.resolve();

    /** 返回一个稳定的模拟证据引用。 */
    public saveArtifact = (
        runId: string,
        artifact: ArtifactInput
    ): Promise<EvidenceRef> => Promise.resolve({
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        ref: `${ runId }/artifacts/${ artifact.name }`
    });

    /** 记录测试意图并返回它的本地引用。 */
    public saveJson = (
        runId: string,
        name: string,
        value: JsonValue
    ): Promise<EvidenceRef> => {
        this.savedJson = {
            runId,
            name,
            value
        };
        return Promise.resolve({
            kind: 'json',
            mediaType: 'application/json',
            ref: `${ runId }/json/${ name }.json`
        });
    };

    /** 当前测试尚未执行到最终结果保存阶段。 */
    public saveResult = (
        _result: RunResult
    ): Promise<void> => Promise.resolve();
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

/** 为 assert.rejects 匹配指定名称的 Error。 */
function hasErrorName(name: string) {
    return (error: unknown) => error instanceof Error &&
        error.name === name;
}
