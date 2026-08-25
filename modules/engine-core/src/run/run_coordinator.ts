import { randomUUID } from 'node:crypto';

import type {
    ActionCommand,
    ActionResult,
    EvidenceRef,
    EffectVerification,
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
    ActionPlanner,
    PlannerHistoryEntry,
} from '../planning';
import type {
    IntentBuilder,
} from '../intent';
import type {
    ArtifactStore,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    EnvironmentValueResolver,
    RunEventPublisher,
} from '../ports';
import type {
    ExecutionEngine,
} from './execution_engine';
import {
    RunLifecycle,
} from './run_lifecycle';
import type {
    RunContext,
} from './run_context';

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
    afterScreenshotReference: EvidenceRef;
    beforeObservationReference: EvidenceRef;
    command: ActionCommand;
    result: ActionResult;
}

/** Planner 动作执行及其前后证据。 */
interface PlannedActionExecution {
    afterObservation: PageObservation;
    afterObservationReference: EvidenceRef;
    afterScreenshotReference: EvidenceRef;
    beforeObservationReference: EvidenceRef;
    command: ActionCommand;
    effect: EffectVerification;
    result: ActionResult;
}

/** 浏览器阶段完成后交给最终判定的数据。 */
interface BrowserExecution {
    navigation: NavigationExecution;
    plannedAction?: PlannedActionExecution;
    plannerDecision?: ActionCommand;
}

/** 同时保存结构化观察和对应截图。 */
interface ObservationEvidence {
    observation: PageObservation;
    observationReference: EvidenceRef;
    screenshotReference: EvidenceRef;
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
        private readonly actionPlanner: ActionPlanner,
        private readonly environmentValueResolver: EnvironmentValueResolver,
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
            const testIntent = await this.buildAndSaveIntent(context);
            const execution = await this.executeMinimalAiRun(
                context,
                testIntent
            );
            return await this.completeMinimalAiRun(context, execution);
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
    ): Promise<TestIntent> {
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
        return intent;
    }

    /** 完成确定性导航和最多一次 AI 规划动作，并始终释放浏览器会话。 */
    private async executeMinimalAiRun(
        context: RunExecutionContext,
        testIntent: TestIntent
    ): Promise<BrowserExecution> {
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
            const navigationResult = await this.navigate(context, session);
            const after = await this.observeAfterNavigation(context, session);
            const navigation: NavigationExecution = {
                ...navigationResult,
                beforeObservationReference: beforeReference,
                afterObservation: after.observation,
                afterObservationReference: after.observationReference,
                afterScreenshotReference: after.screenshotReference
            };
            await this.recordNavigation(context, navigation);

            if (navigation.result.status !== 'executed') {
                return {
                    navigation
                };
            }

            const runtime = this.createRunContext(
                context,
                testIntent,
                session,
                navigation
            );
            const command = await this.planNextAction(context, runtime);
            if (command.type !== 'TYPE') {
                return {
                    navigation,
                    plannerDecision: command
                };
            }
            const plannedAction = await this.executePlannedAction(
                context,
                runtime,
                command,
                navigation.afterObservationReference
            );
            return {
                navigation,
                plannedAction
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
    ): Promise<ObservationEvidence> {
        await this.transition(
            context,
            'VERIFYING',
            '正在观察导航后的页面状态'
        );
        return await this.captureObservationEvidence(
            context,
            session,
            'observation-after-navigation',
            'screenshot-after-navigation.png'
        );
    }

    /** 记录确定性导航的效果与首条 Trace。 */
    private async recordNavigation(
        context: RunExecutionContext,
        navigation: NavigationExecution
    ): Promise<void> {
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
    }

    /** 对已完成的最小执行闭环给出保守终局判定。 */
    private async completeMinimalAiRun(
        context: RunExecutionContext,
        execution: BrowserExecution
    ): Promise<RunResult> {
        await this.transition(
            context,
            'DECIDING_VERDICT',
            '正在生成阶段性运行结论'
        );
        const result = this.createMinimalAiResult(context, execution);
        await this.publishVerdict(context, result);
        await this.transition(context, 'COMPLETED', result.summary);
        await this.persistCompletedRun(context, execution, result);
        return result;
    }

    /** 将导航后的稳定状态转换为 Planner 使用的正式运行上下文。 */
    private createRunContext(
        context: RunExecutionContext,
        testIntent: TestIntent,
        browserSession: BrowserSession,
        navigation: NavigationExecution
    ): RunContext {
        const historyEntry: PlannerHistoryEntry = {
            command: navigation.command,
            actionResult: navigation.result,
            effect: this.createNavigationEffect(navigation),
            beforeObservationRef: navigation.beforeObservationReference.ref,
            afterObservationRef: navigation.afterObservationReference.ref
        };
        return {
            runId: context.runId,
            input: context.input,
            testIntent,
            browserSession,
            latestObservation: navigation.afterObservation,
            history: [historyEntry],
            budgets: context.input.budgets,
            lifecycle: context.lifecycle.current(),
            counters: {
                actionCount: context.actionCount,
                modelCallCount: context.modelCallCount,
                repeatedStateActionCount: 0
            },
            startedAt: context.startedAt
        };
    }

    /** 使用最新观察调用一次 Planner，并发布不包含输入值的动作摘要。 */
    private async planNextAction(
        context: RunExecutionContext,
        runtime: RunContext
    ): Promise<ActionCommand> {
        await this.transition(
            context,
            'OBSERVING',
            '正在准备导航后的最新页面观察'
        );
        await this.transition(
            context,
            'PLANNING',
            '正在规划一次页面交互'
        );
        const remainingBudgets = this.getRemainingBudgets(context);
        this.requirePlannerBudget(remainingBudgets);
        const observation = runtime.latestObservation;
        if (!observation) {
            throw new Error('Planner 缺少最新页面观察。');
        }
        context.modelCallCount += 1;
        runtime.counters.modelCallCount = context.modelCallCount;
        runtime.lifecycle = context.lifecycle.current();
        const command = await this.actionPlanner.plan(
            {
                testIntent: runtime.testIntent,
                observation,
                history: runtime.history,
                availableEnvironmentVariables: Object.keys(
                    context.input.environment.variables
                ),
                remainingBudgets
            },
            context.signal
        );
        context.signal.throwIfAborted();
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'action.planned', {
                actionType: command.type,
                reasonSummary: command.reasonSummary
            }
        );
        return command;
    }

    /** 计算当前协调流程还允许消费的预算。 */
    private getRemainingBudgets(
        context: RunExecutionContext
    ): RunContext['budgets'] {
        return {
            maxActions: Math.max(
                0,
                context.input.budgets.maxActions - context.actionCount
            ),
            maxDurationMs: Math.max(
                0,
                context.input.budgets.maxDurationMs -
                    (Date.now() - context.startedAt)
            ),
            maxModelCalls: Math.max(
                0,
                context.input.budgets.maxModelCalls - context.modelCallCount
            ),
            maxRepeatedStateActions: Math.max(
                0,
                context.input.budgets.maxRepeatedStateActions
            )
        };
    }

    /** 在模型调用前拒绝已经耗尽的关键预算。 */
    private requirePlannerBudget(budgets: RunContext['budgets']): void {
        if (
            budgets.maxActions < 1 ||
            budgets.maxDurationMs < 1 ||
            budgets.maxModelCalls < 1
        ) {
            throw new Error('执行预算不足，无法继续规划页面动作。');
        }
    }

    /** 执行、验证并记录本阶段唯一的一次 TYPE 动作。 */
    private async executePlannedAction(
        context: RunExecutionContext,
        runtime: RunContext,
        command: ActionCommand,
        beforeObservationReference: EvidenceRef
    ): Promise<PlannedActionExecution> {
        const executableCommand = await this.resolveCommandValue(
            context,
            command
        );
        const result = await this.actPlannedCommand(
            context,
            runtime.browserSession,
            executableCommand
        );
        runtime.counters.actionCount = context.actionCount;
        const after = await this.observeAfterPlannedAction(
            context,
            runtime.browserSession
        );
        const effect = this.createTypeEffect(command, result, after);
        const execution = {
            command,
            result,
            effect,
            beforeObservationReference,
            afterObservation: after.observation,
            afterObservationReference: after.observationReference,
            afterScreenshotReference: after.screenshotReference
        };
        await this.recordPlannedAction(context, runtime, execution);
        return execution;
    }

    /** 只在浏览器调用边界把逻辑环境变量替换为实际字面量。 */
    private async resolveCommandValue(
        context: RunExecutionContext,
        command: ActionCommand
    ): Promise<ActionCommand> {
        await this.transition(
            context,
            'RESOLVING',
            '正在解析输入值并绑定页面候选元素'
        );
        const value = command.value;
        if (!value || value.source === 'literal') {
            return command;
        }
        if (value.source === 'generated') {
            throw new Error('当前最小执行阶段尚不支持生成值。');
        }
        const variable = context.input.environment.variables[value.key];
        if (!variable) {
            throw new Error(`环境定义中不存在变量：${ value.key }`);
        }
        const resolvedValue = await this.environmentValueResolver.resolve(
            value.key,
            variable
        );
        return {
            ...command,
            value: {
                source: 'literal',
                value: resolvedValue
            }
        };
    }

    /** 调用浏览器执行已解析命令并发布动作状态事件。 */
    private async actPlannedCommand(
        context: RunExecutionContext,
        session: BrowserSession,
        executableCommand: ActionCommand
    ): Promise<ActionResult> {
        await this.transition(
            context,
            'ACTING',
            '正在执行一次 AI 规划的输入动作'
        );
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'action.started', {
                actionType: executableCommand.type
            }
        );
        context.actionCount += 1;
        const result = await this.browserAdapter.execute(
            session,
            executableCommand
        );
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            result.status === 'executed'
                ? 'action.completed'
                : 'action.failed', {
                actionType: executableCommand.type,
                status: result.status
            }
        );
        return result;
    }

    /** 保存输入动作完成后的观察与截图。 */
    private async observeAfterPlannedAction(
        context: RunExecutionContext,
        session: BrowserSession
    ): Promise<ObservationEvidence> {
        await this.transition(
            context,
            'VERIFYING',
            '正在验证输入动作后的页面状态'
        );
        return await this.captureObservationEvidence(
            context,
            session,
            'observation-after-planned-action',
            'screenshot-after-planned-action.png'
        );
    }

    /** 根据候选输入框的值状态验证 TYPE 是否产生预期效果。 */
    private createTypeEffect(
        command: ActionCommand,
        result: ActionResult,
        after: ObservationEvidence
    ): EffectVerification {
        const candidateId = command.target?.candidateId;
        const valueState = after.observation.interactiveElements.find(
            (element) => element.candidateId === candidateId
        )?.valueState;
        const confirmed = result.status === 'executed' &&
            (valueState === 'filled' || valueState === 'masked');
        const status = result.status !== 'executed'
            ? 'contradicted' as const
            : confirmed
                ? 'confirmed' as const
                : 'not-observed' as const;
        return {
            status,
            expectedEffect: command.expectedEffect ?? '目标输入框变为已填写',
            evidence: [
                after.observationReference,
                after.screenshotReference
            ],
            summary: confirmed
                ? '目标输入框已显示为填写状态。'
                : result.status === 'executed'
                    ? '输入动作已执行，但页面观察未确认填写状态。'
                    : '浏览器没有成功执行输入动作。'
        };
    }

    /** 追加第二条 Trace，并把安全命令引用加入 Planner 历史。 */
    private async recordPlannedAction(
        context: RunExecutionContext,
        runtime: RunContext,
        execution: PlannedActionExecution
    ): Promise<void> {
        await this.publishEffect(context, execution.effect);
        await this.transition(
            context,
            'RECORDING',
            '正在记录 AI 输入动作轨迹'
        );
        const traceEvent: TraceEvent = {
            schemaVersion: 1,
            runId: context.runId,
            sequence: 2,
            command: execution.command,
            beforeObservationRef: execution.beforeObservationReference.ref,
            afterObservationRef: execution.afterObservationReference.ref,
            actionResult: execution.result,
            effect: execution.effect,
            artifacts: [
                execution.afterObservationReference,
                execution.afterScreenshotReference
            ]
        };
        await this.artifactStore.appendTrace(context.runId, traceEvent);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'trace.appended', {
                traceSequence: traceEvent.sequence
            }
        );
        runtime.latestObservation = execution.afterObservation;
        runtime.history.push({
            command: execution.command,
            actionResult: execution.result,
            effect: execution.effect,
            beforeObservationRef: execution.beforeObservationReference.ref,
            afterObservationRef: execution.afterObservationReference.ref
        });
    }

    /** 保存一对页面观察 JSON 与 PNG 截图，并写入运行证据集合。 */
    private async captureObservationEvidence(
        context: RunExecutionContext,
        session: BrowserSession,
        observationName: string,
        screenshotName: string
    ): Promise<ObservationEvidence> {
        const observation = await this.browserAdapter.observe(session);
        const screenshot = await this.browserAdapter.captureScreenshot(session);
        const screenshotReference = await this.artifactStore.saveArtifact(
            context.runId,
            {
                content: screenshot.content,
                kind: 'screenshot',
                mediaType: screenshot.mediaType,
                name: screenshotName
            }
        );
        const persistedObservation: PageObservation = {
            ...observation,
            screenshotRef: screenshotReference.ref
        };
        const observationReference = await this.saveObservation(
            context.runId,
            observationName,
            persistedObservation
        );
        context.evidence.push(
            observationReference,
            screenshotReference
        );
        await this.publishObservationEvent(
            context,
            observationReference,
            persistedObservation
        );
        return {
            observation: persistedObservation,
            observationReference,
            screenshotReference
        };
    }

    /** 发布一条标准效果验证事件。 */
    private async publishEffect(
        context: RunExecutionContext,
        effect: EffectVerification
    ): Promise<void> {
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'effect.verified', {
                status: effect.status,
                summary: effect.summary
            }
        );
    }

    /** 根据导航结果生成对应的效果验证记录。 */
    private createNavigationEffect(
        navigation: NavigationExecution
    ): EffectVerification {
        const succeeded = navigation.result.status === 'executed';
        return {
            status: succeeded
                ? 'confirmed' as const
                : 'contradicted' as const,
            expectedEffect: navigation.command.expectedEffect ??
                '浏览器加载测试起始页面',
            evidence: [
                navigation.afterObservationReference,
                navigation.afterScreenshotReference
            ],
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
                navigation.afterObservationReference,
                navigation.afterScreenshotReference
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
        execution: BrowserExecution,
        result: RunResult
    ): Promise<void> {
        const latestObservation = execution.plannedAction?.afterObservation ??
            execution.navigation.afterObservation;
        const latestObservationReference =
            execution.plannedAction?.afterObservationReference ??
            execution.navigation.afterObservationReference;
        context.snapshot = {
            ...context.snapshot,
            result: result.result,
            failure: result.failure,
            metadata: {
                ...context.snapshot.metadata,
                observationRef: latestObservationReference.ref,
                stateFingerprint: latestObservation.stateFingerprint,
                ...(execution.plannerDecision
                    ? {
                        plannerDecision: execution.plannerDecision.type
                    }
                    : {})
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

    /** 根据导航和一次 Planner 决策生成不会误报业务成功的阶段性结论。 */
    private createMinimalAiResult(
        context: RunExecutionContext,
        execution: BrowserExecution
    ): RunResult {
        const navigationSucceeded =
            execution.navigation.result.status === 'executed';
        const plannedResult = execution.plannedAction?.result;
        const failedResult = !navigationSucceeded
            ? execution.navigation.result
            : plannedResult?.status !== 'executed'
                ? plannedResult
                : undefined;
        const failureCategory = failedResult
            ? this.getActionFailureCategory(failedResult)
            : undefined;

        return {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle: 'COMPLETED',
            result: failedResult ? 'FAIL' : 'UNCERTAIN',
            summary: this.createMinimalAiSummary(execution, failedResult),
            evidence: context.evidence,
            ...(failedResult && failureCategory
                ? {
                    failure: {
                        category: failureCategory,
                        phase: 'ACTING' as const,
                        summary: failedResult.error?.message ??
                            '浏览器动作执行失败。',
                        recoverable: failedResult.status === 'timed-out',
                        evidence: context.evidence
                    }
                }
                : {}),
            traceRef: `${ context.runId }/trace.jsonl`,
            metrics: this.createMetrics(context)
        };
    }

    /** 为最小闭环返回明确的阶段边界说明。 */
    private createMinimalAiSummary(
        execution: BrowserExecution,
        failedResult: ActionResult | undefined
    ): string {
        if (execution.navigation.result.status !== 'executed') {
            return `测试起始页面导航失败：${
                failedResult?.error?.message ?? failedResult?.status
            }`;
        }
        if (execution.plannedAction) {
            if (failedResult) {
                return `AI 规划的输入动作失败：${
                    failedResult.error?.message ?? failedResult.status
                }`;
            }
            return execution.plannedAction.effect.status === 'confirmed'
                ? '已执行一次 AI 规划的账号输入并确认填写状态；尚未提交登录或判断业务结果。'
                : '已执行一次 AI 规划的账号输入，但页面证据尚未确认填写状态。';
        }
        if (execution.plannerDecision) {
            return `Planner 返回 ${ execution.plannerDecision.type }；` +
                '当前最小阶段未执行 TYPE 之外的页面动作。';
        }
        return '已完成起始页导航；没有可执行的 AI 页面动作。';
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
