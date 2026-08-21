import { randomUUID } from 'node:crypto';

import type {
    ActionCommand,
    ActionResult,
    EvidenceRef,
    FailureCategory,
    JsonValue,
    PageObservation,
    RunEvent,
    RunLifecycleState,
    RunResult,
    RunSnapshot,
    StartRunInput,
    TestIntent,
    TraceEvent,
} from '../contracts';
import type {
    IntentBuilder,
} from '../intent';
import type {
    ArtifactStore,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    RunEventPublisher,
} from '../ports';
import type {
    ExecutionEngine,
} from './execution_engine';
import {
    RunLifecycle,
} from './run_lifecycle';

/** RunCoordinator 启动浏览器时使用的可覆盖参数。 */
export interface RunCoordinatorOptions {
    browserStartOptions: BrowserStartOptions;
}

/** 一次协调流程内部共享的可变运行状态。 */
interface RunExecutionContext {
    actionCount: number;
    evidence: EvidenceRef[];
    eventSequence: number;
    input: StartRunInput;
    lifecycle: RunLifecycle;
    modelCallCount: number;
    runCreated: boolean;
    runId: string;
    signal: AbortSignal;
    snapshot: RunSnapshot;
    startedAt: number;
}

/** 初始导航执行完成后交给收尾阶段的数据。 */
interface NavigationExecution {
    afterObservation: PageObservation;
    afterObservationReference: EvidenceRef;
    beforeObservationReference: EvidenceRef;
    command: ActionCommand;
    result: ActionResult;
}

const DEFAULT_OPTIONS: RunCoordinatorOptions = {
    browserStartOptions: {
        headless: true,
        viewport: {
            width: 1280,
            height: 720
        }
    }
};

/**
 * 一次测试运行的总协调器，负责串联意图构建、浏览器执行、观察和产物存储。
 */
export class RunCoordinator implements ExecutionEngine {
    /** 注入运行产物存储、事件发布、意图构建和浏览器能力。 */
    constructor(
        private readonly artifactStore: ArtifactStore,
        private readonly eventPublisher: RunEventPublisher,
        private readonly intentBuilder: IntentBuilder,
        private readonly browserAdapter: BrowserAdapter,
        private readonly options: RunCoordinatorOptions = DEFAULT_OPTIONS
    ) {}

    /** 创建一次运行，并执行当前阶段支持的起始页导航闭环。 */
    public async start(
        input: StartRunInput,
        signal: AbortSignal
    ): Promise<RunResult> {
        const context = this.createContext(input, signal);

        try {
            await this.initializeRun(context);
            await this.buildAndSaveIntent(context);
            const navigation = await this.executeInitialNavigation(context);
            return await this.completeFoundationRun(context, navigation);
        } catch (error) {
            if (!context.runCreated) {
                throw error;
            }
            return await this.finishAbnormally(context, error);
        }
    }

    /** 创建尚未持久化的初始运行上下文。 */
    private createContext(
        input: StartRunInput,
        signal: AbortSignal
    ): RunExecutionContext {
        const runId = randomUUID();
        const now = new Date().toISOString();

        return {
            actionCount: 0,
            evidence: [],
            eventSequence: 0,
            input,
            lifecycle: new RunLifecycle(),
            modelCallCount: 0,
            runCreated: false,
            runId,
            signal,
            snapshot: {
                schemaVersion: 1,
                runId,
                testId: input.test.id,
                lifecycle: 'QUEUED',
                createdAt: now,
                updatedAt: now,
                summary: '等待开始执行',
                metadata: {
                    environmentId: input.environment.id,
                    mode: input.mode,
                },
            },
            startedAt: Date.now()
        };
    }

    /** 创建本地 Run，并推进到启动阶段。 */
    private async initializeRun(
        context: RunExecutionContext
    ): Promise<void> {
        await this.artifactStore.createRun(context.snapshot);
        context.runCreated = true;
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'run.created', {
                testId: context.input.test.id,
            }
        );
        context.signal.throwIfAborted();
        await this.transition(context, 'STARTING', '正在启动测试');
    }

    /** 调用模型构建 TestIntent，并将结构化结果保存到本地。 */
    private async buildAndSaveIntent(
        context: RunExecutionContext
    ): Promise<void> {
        context.signal.throwIfAborted();
        await this.transition(
            context,
            'BUILDING_INTENT',
            '正在构建测试意图'
        );
        context.modelCallCount += 1;
        const intent = await this.intentBuilder.build(
            {
                test: context.input.test,
                environment: context.input.environment,
                projectContext: context.input.projectContext
            },
            context.signal
        );
        context.signal.throwIfAborted();

        const reference = await this.artifactStore.saveJson(
            context.runId,
            'intent',
            toTestIntentJson(intent)
        );
        context.snapshot = {
            ...context.snapshot,
            updatedAt: new Date().toISOString(),
            summary: '测试意图构建完成',
            metadata: {
                ...context.snapshot.metadata,
                intentRef: reference.ref
            }
        };
        await this.artifactStore.updateRun(context.snapshot);
    }

    /** 启动浏览器，并保证导航流程结束后释放对应会话。 */
    private async executeInitialNavigation(
        context: RunExecutionContext
    ): Promise<NavigationExecution> {
        const session = await this.browserAdapter.start(
            this.options.browserStartOptions
        );
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'browser.started', {
                sessionId: session.sessionId
            }
        );

        try {
            const beforeReference =
                await this.observeBeforeNavigation(context, session);
            const navigation = await this.navigate(context, session);
            const after = await this.observeAfterNavigation(context, session);
            return {
                ...navigation,
                beforeObservationReference: beforeReference,
                afterObservation: after.observation,
                afterObservationReference: after.reference
            };
        } finally {
            await this.browserAdapter.close(session);
        }
    }

    /** 记录浏览器执行导航前的空白页状态。 */
    private async observeBeforeNavigation(
        context: RunExecutionContext,
        session: BrowserSession
    ): Promise<EvidenceRef> {
        await this.transition(
            context,
            'OBSERVING',
            '正在观察浏览器初始状态'
        );
        const observation = await this.browserAdapter.observe(session);
        const reference = await this.saveObservation(
            context.runId,
            'observation-before-navigation',
            observation
        );
        await this.publishObservationEvent(
            context,
            reference,
            observation
        );
        context.signal.throwIfAborted();
        return reference;
    }

    /** 生成并执行当前地基版本唯一支持的起始页导航动作。 */
    private async navigate(
        context: RunExecutionContext,
        session: BrowserSession
    ): Promise<{
        command: ActionCommand,
        result: ActionResult
    }> {
        await this.transition(
            context,
            'PLANNING',
            '正在规划起始页面导航'
        );
        const command = this.createNavigationCommand(context.input);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'action.planned', {
                actionType: command.type,
                reasonSummary: command.reasonSummary
            }
        );
        await this.transition(
            context,
            'RESOLVING',
            '正在校验起始页面地址'
        );
        this.requireAllowedNavigation(context.input, command);
        await this.transition(
            context,
            'ACTING',
            '正在打开测试起始页面'
        );
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'action.started', {
                actionType: command.type
            }
        );
        context.actionCount += 1;
        const result = await this.browserAdapter.execute(session, command);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            result.status === 'executed'
                ? 'action.completed'
                : 'action.failed', {
                actionType: command.type,
                status: result.status
            }
        );
        return {
            command,
            result
        };
    }

    /** 采集并保存导航动作完成后的页面状态。 */
    private async observeAfterNavigation(
        context: RunExecutionContext,
        session: BrowserSession
    ): Promise<{
        observation: PageObservation,
        reference: EvidenceRef
    }> {
        await this.transition(
            context,
            'VERIFYING',
            '正在观察导航后的页面状态'
        );
        const observation = await this.browserAdapter.observe(session);
        const reference = await this.saveObservation(
            context.runId,
            'observation-after-navigation',
            observation
        );
        context.evidence = [reference];
        await this.publishObservationEvent(
            context,
            reference,
            observation
        );
        return {
            observation,
            reference
        };
    }

    /** 记录导航 Trace，生成阶段性结论并保存最终结果。 */
    private async completeFoundationRun(
        context: RunExecutionContext,
        navigation: NavigationExecution
    ): Promise<RunResult> {
        const effect = this.createNavigationEffect(navigation);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'effect.verified', {
                status: effect.status,
                summary: effect.summary
            }
        );
        await this.transition(
            context,
            'RECORDING',
            '正在记录基础导航轨迹'
        );
        const traceEvent = this.createTraceEvent(context, navigation, effect);
        await this.artifactStore.appendTrace(context.runId, traceEvent);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'trace.appended', {
                traceSequence: traceEvent.sequence
            }
        );
        await this.transition(
            context,
            'DECIDING_VERDICT',
            '正在生成阶段性运行结论'
        );
        const result = this.createFoundationResult(context, navigation.result);
        await this.publishVerdict(context, result);
        await this.transition(context, 'COMPLETED', result.summary);
        await this.persistCompletedRun(context, navigation, result);
        return result;
    }

    /** 根据导航结果生成对应的效果验证记录。 */
    private createNavigationEffect(navigation: NavigationExecution) {
        const succeeded = navigation.result.status === 'executed';
        return {
            status: succeeded
                ? 'confirmed' as const
                : 'contradicted' as const,
            expectedEffect: navigation.command.expectedEffect ??
                '浏览器加载测试起始页面',
            evidence: [navigation.afterObservationReference],
            summary: succeeded
                ? '浏览器已经打开并观察到测试起始页面。'
                : '浏览器没有成功打开测试起始页面。'
        };
    }

    /** 创建包含导航前后观察及动作结果的首条 Trace。 */
    private createTraceEvent(
        context: RunExecutionContext,
        navigation: NavigationExecution,
        effect: ReturnType<RunCoordinator['createNavigationEffect']>
    ): TraceEvent {
        return {
            schemaVersion: 1,
            runId: context.runId,
            sequence: 1,
            command: navigation.command,
            beforeObservationRef: navigation.beforeObservationReference.ref,
            afterObservationRef: navigation.afterObservationReference.ref,
            actionResult: navigation.result,
            effect,
            artifacts: [
                navigation.beforeObservationReference,
                navigation.afterObservationReference
            ]
        };
    }

    /** 发布阶段性判定事件，便于调试接口展示执行终点。 */
    private async publishVerdict(
        context: RunExecutionContext,
        result: RunResult
    ): Promise<void> {
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'verdict.completed', {
                result: result.result ?? 'UNCERTAIN',
                summary: result.summary
            }
        );
    }

    /** 保存完成状态、最终结果并发布 run.completed。 */
    private async persistCompletedRun(
        context: RunExecutionContext,
        navigation: NavigationExecution,
        result: RunResult
    ): Promise<void> {
        context.snapshot = {
            ...context.snapshot,
            result: result.result,
            failure: result.failure,
            metadata: {
                ...context.snapshot.metadata,
                observationRef: navigation.afterObservationReference.ref,
                stateFingerprint:
                    navigation.afterObservation.stateFingerprint
            }
        };
        await this.artifactStore.updateRun(context.snapshot);
        await this.artifactStore.saveResult(result);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'run.completed', {
                result: result.result ?? 'UNCERTAIN',
                summary: result.summary
            }
        );
    }

    /** 将页面观察保存为 JSON，并返回可写入 Trace 的稳定引用。 */
    private saveObservation(
        runId: string,
        name: string,
        observation: PageObservation
    ): Promise<EvidenceRef> {
        return this.artifactStore.saveJson(
            runId,
            name,
            toJsonValue(observation)
        );
    }

    /** 发布一条只包含安全摘要字段的页面观察事件。 */
    private async publishObservationEvent(
        context: RunExecutionContext,
        reference: EvidenceRef,
        observation: PageObservation
    ): Promise<void> {
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'observation.created', {
                observationRef: reference.ref,
                stateFingerprint: observation.stateFingerprint,
                url: observation.page.url
            }
        );
    }

    /** 根据用例起始地址创建地基闭环当前唯一的确定性导航动作。 */
    private createNavigationCommand(input: StartRunInput): ActionCommand {
        return {
            type: 'NAVIGATE',
            value: {
                source: 'literal',
                value: input.test.startUrl ?? input.environment.baseUrl
            },
            expectedEffect: '浏览器加载测试起始页面',
            reasonSummary: '进入用例指定的测试起始页面',
            risk: 'read-only'
        };
    }

    /** 在浏览器执行前校验协议和环境允许访问的域名。 */
    private requireAllowedNavigation(
        input: StartRunInput,
        command: ActionCommand
    ): void {
        const rawUrl = command.value?.source === 'literal'
            ? command.value.value
            : undefined;
        if (typeof rawUrl !== 'string') {
            throw new Error('测试起始地址必须是字符串。');
        }

        const url = new URL(rawUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('测试起始地址必须使用 HTTP 或 HTTPS。');
        }
        if (!input.environment.allowedHosts.includes(url.hostname)) {
            throw new Error(
                `测试起始地址不在 allowedHosts 中：${ url.hostname }`
            );
        }
    }

    /** 根据初始导航结果生成不会误报业务成功的阶段性结论。 */
    private createFoundationResult(
        context: RunExecutionContext,
        actionResult: ActionResult
    ): RunResult {
        const succeeded = actionResult.status === 'executed';
        const failureCategory = this.getActionFailureCategory(actionResult);

        return {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle: 'COMPLETED',
            result: succeeded
                ? 'UNCERTAIN'
                : 'FAIL',
            summary: succeeded
                ? '基础执行链路已跑通；尚未执行交互动作或业务断言。'
                : `测试起始页面导航失败：${
                    actionResult.error?.message ?? actionResult.status
                }`,
            evidence: context.evidence,
            ...(!succeeded && failureCategory
                ? {
                    failure: {
                        category: failureCategory,
                        phase: 'ACTING' as const,
                        summary: actionResult.error?.message ??
                            '测试起始页面导航失败。',
                        recoverable: actionResult.status === 'timed-out',
                        evidence: context.evidence
                    }
                }
                : {}),
            traceRef: `${ context.runId }/trace.jsonl`,
            metrics: this.createMetrics(context)
        };
    }

    /** 将浏览器动作状态映射成稳定的失败分类。 */
    private getActionFailureCategory(
        actionResult: ActionResult
    ): FailureCategory | undefined {
        if (actionResult.status === 'rejected') {
            return 'ACTION_REJECTED';
        }
        if (actionResult.status === 'timed-out') {
            return 'PAGE_TIMEOUT';
        }
        if (actionResult.status === 'failed') {
            return 'ACTION_FAILED';
        }
        return undefined;
    }

    /** 将取消或异常转换为可持久化的终态结果。 */
    private async finishAbnormally(
        context: RunExecutionContext,
        error: unknown
    ): Promise<RunResult> {
        if (context.lifecycle.isTerminal()) {
            throw error;
        }
        const cancelled = context.signal.aborted ||
            error instanceof Error && error.name === 'AbortError';
        const terminalState = cancelled
            ? 'CANCELLED' as const
            : 'CRASHED' as const;
        const summary = cancelled
            ? '测试运行已取消。'
            : `测试运行异常：${
                error instanceof Error
                    ? error.message
                    : '未知错误'
            }`;
        const failedPhase = context.snapshot.lifecycle;

        await this.transition(context, terminalState, summary);
        const result = this.createAbnormalResult(
            context,
            terminalState,
            summary,
            cancelled,
            failedPhase
        );
        context.snapshot = {
            ...context.snapshot,
            failure: result.failure
        };
        await this.artifactStore.updateRun(context.snapshot);
        await this.artifactStore.saveResult(result);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            cancelled
                ? 'run.cancelled'
                : 'run.crashed', {
                summary
            }
        );
        return result;
    }

    /** 创建取消或崩溃时的最终结果。 */
    private createAbnormalResult(
        context: RunExecutionContext,
        lifecycle: 'CANCELLED' | 'CRASHED',
        summary: string,
        cancelled: boolean,
        failedPhase: RunLifecycleState
    ): RunResult {
        return {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle,
            summary,
            evidence: context.evidence,
            ...(!cancelled
                ? {
                    failure: {
                        category: this.getCrashCategory(
                            failedPhase
                        ),
                        phase: failedPhase,
                        summary,
                        recoverable: true,
                        evidence: context.evidence
                    }
                }
                : {}),
            traceRef: `${ context.runId }/trace.jsonl`,
            metrics: this.createMetrics(context)
        };
    }

    /** 汇总当前运行已经消耗的时间和外部调用次数。 */
    private createMetrics(context: RunExecutionContext) {
        return {
            actionCount: context.actionCount,
            durationMs: Date.now() - context.startedAt,
            modelCallCount: context.modelCallCount,
            repeatedStateActionCount: 0
        };
    }

    /** 按异常发生阶段推断对调试最有帮助的失败分类。 */
    private getCrashCategory(
        lifecycle: RunLifecycleState
    ): FailureCategory {
        if (lifecycle === 'BUILDING_INTENT') {
            return 'MODEL_UNAVAILABLE';
        }
        if (
            lifecycle === 'STARTING' ||
            lifecycle === 'OBSERVING'
        ) {
            return 'BROWSER_CRASHED';
        }
        return 'ACTION_FAILED';
    }

    /** 推进生命周期并更新共享快照。 */
    private async transition(
        context: RunExecutionContext,
        next: RunLifecycleState,
        summary: string
    ): Promise<void> {
        context.snapshot = await this.changeState(
            context.snapshot,
            context.lifecycle,
            next,
            summary,
            this.nextSequence(context)
        );
    }

    /** 返回并推进当前 Run 的事件序号。 */
    private nextSequence(context: RunExecutionContext): number {
        context.eventSequence += 1;
        return context.eventSequence;
    }

    /** 校验并切换生命周期，同时持久化最新快照并广播状态变化。 */
    private async changeState(
        snapshot: RunSnapshot,
        lifecycle: RunLifecycle,
        next: RunLifecycleState,
        summary: string,
        eventSequence: number
    ): Promise<RunSnapshot> {
        lifecycle.transition(next);

        const updatedSnapshot: RunSnapshot = {
            ...snapshot,
            lifecycle: lifecycle.current(),
            updatedAt: new Date().toISOString(),
            summary,
        };

        await this.artifactStore.updateRun(updatedSnapshot);

        await this.publishEvent(
            snapshot.runId,
            eventSequence,
            'run.status.changed', {
                lifecycle: updatedSnapshot.lifecycle,
                summary,
            }
        );

        return updatedSnapshot;
    }

    /** 将领域内发生的运行事件包装成统一格式后交给发布器。 */
    private async publishEvent(
        runId: string,
        sequence: number,
        type: RunEvent['type'],
        payload: RunEvent['payload']
    ): Promise<void> {
        await this.eventPublisher.publish({
            schemaVersion: 1,
            eventId: randomUUID(),
            runId,
            type,
            sequence,
            timestamp: new Date().toISOString(),
            payload,
        });
    }
}

/** 将 TestIntent 显式转换为可以安全持久化的 JSON 数据。 */
function toTestIntentJson(intent: TestIntent): JsonValue {
    return {
        schemaVersion: intent.schemaVersion,
        objective: intent.objective,
        preconditions: [...intent.preconditions],
        successCriteria: intent.successCriteria.map((criterion) => ({
            id: criterion.id,
            description: criterion.description,
            preferredEvidence: [...criterion.preferredEvidence],
            required: criterion.required
        })),
        failureCriteria: intent.failureCriteria.map((criterion) => ({
            id: criterion.id,
            description: criterion.description
        })),
        constraints: [...intent.constraints],
        allowedHosts: [...intent.allowedHosts],
        dataPolicy: {
            generatedValues: {
                ...intent.dataPolicy.generatedValues
            }
        }
    };
}

/** 将领域对象转换成可安全持久化的 JSON 值，并忽略 undefined 字段。 */
function toJsonValue(value: unknown): JsonValue {
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string'
    ) {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error('JSON 数值必须是有限数字。');
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }
    if (typeof value === 'object') {
        const result: Record<string, JsonValue> = {};
        Object.entries(value).forEach(([key, item]) => {
            if (item !== undefined) {
                result[key] = toJsonValue(item);
            }
        });
        return result;
    }
    throw new Error(`无法转换为 JSON 的值类型：${ typeof value }`);
}
