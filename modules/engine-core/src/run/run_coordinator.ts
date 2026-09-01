import { randomUUID } from 'node:crypto';

import type {
    ActionTraceAdjudication,
    ActionCommand,
    ActionResult,
    CompilationContribution,
    CompiledPlan,
    EvidenceRef,
    EffectVerification,
    FailureCategory,
    GroundingDecision,
    JsonValue,
    PageObservation,
    PagePerception,
    RecoveryAction,
    RecoveryAttemptSummary,
    RunEvent,
    RunLifecycleState,
    RunResult,
    RunSnapshot,
    ResolvedTarget,
    SemanticAction,
    SemanticStep,
    SemanticStepProgress,
    StartRunInput,
    TestIntent,
    TraceEvent,
    VerdictDecision,
} from '../contracts';
import type {
    TargetGrounder,
} from '../grounding';
import {
    DeterministicTargetGrounder,
    GroundedActionBuilder,
} from '../grounding';
import type {
    ActionPlanner,
    PlannerHistoryEntry,
} from '../planning';
import type {
    IntentBuilder,
} from '../intent';
import {
    createPerceptionStability,
    PerceptionService,
} from '../perception';
import type {
    ArtifactStore,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    EnvironmentValueResolver,
    ModelProtocolDiagnostic,
    PageStabilityPort,
    RunEventPublisher,
} from '../ports';
import type {
    ExecutionEngine,
} from './execution_engine';
import type {
    CompilableTraceStep,
    ReplayExecution,
} from '../replay';
import {
    createPlanCompilationSource,
    DeterministicPlanReplayer,
    parseCompiledPlan,
    PlanReplayError,
    selectProductiveActions,
} from '../replay';
import {
    RunLifecycle,
} from './run_lifecycle';
import type {
    CurrentStablePerception,
    RunContext,
} from './run_context';
import type {
    VerdictEvaluator,
} from '../verdict';
import {
    ActionEffectVerifier,
} from './action_effect_verifier';
import {
    DeterministicRecoverySafetyPolicy,
} from './deterministic_recovery_safety_policy';
import type {
    RecoveryPlannerPort,
} from './recovery_ports';
import {
    normalizeRecoveryCommand,
    SemanticStepController,
} from './semantic_step_controller';
import {
    PageSettler,
} from './page_settler';
import type {
    SemanticStepActionExecution,
} from './semantic_step_controller';
import {
    SemanticStepProgressEvaluator,
} from './semantic_step_progress_evaluator';
import {
    SuccessCriteriaEvaluator,
} from './success_criteria_evaluator';
import type {
    SuccessCriteriaEvaluation,
} from './success_criteria_evaluator';

const ANSI_ESCAPE_PATTERN = new RegExp(
    `${ String.fromCharCode(27) }\\[[0-?]*[ -/]*[@-~]`,
    'gu'
);
const EXECUTABLE_PLANNED_ACTIONS = new Set<SemanticAction['type']>([
    'CHECK',
    'CLICK',
    'HOVER',
    'SELECT',
    'TYPE',
    'WAIT'
]);

/** RunCoordinator 启动浏览器时使用的可覆盖参数。 */
export interface RunCoordinatorOptions {
    browserStartOptions: BrowserStartOptions;
}

/** RunCoordinator 使用的规划与独立判定能力。 */
export interface RunCoordinatorDecisionServices {
    actionPlanner: ActionPlanner;
    pageStabilityPort?: PageStabilityPort;
    perceptionService?: PerceptionService;
    recoveryPlanner?: RecoveryPlannerPort;
    stepProgressEvaluator?: SemanticStepProgressEvaluator;
    targetGrounder?: TargetGrounder;
    verdictEvaluator: VerdictEvaluator;
}

/** 一次协调流程内部共享的可变运行状态。 */
interface RunExecutionContext {
    actionCount: number;
    evidence: EvidenceRef[];
    eventSequence: number;
    input: StartRunInput;
    lifecycle: RunLifecycle;
    lastImmediateObservation?: PageObservation;
    lastImmediateObservationReference?: EvidenceRef;
    currentStablePerception?: CurrentStablePerception;
    deterministicSuccess?: SuccessCriteriaEvaluation;
    settlingFailureReason?: string;
    modelCallCount: number;
    groundingSequence: number;
    perceptionSequence: number;
    settlingSequence: number;
    repeatedStateActionCount: number;
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
    beforeObservation: PageObservation;
    beforeObservationReference: EvidenceRef;
    command: ActionCommand;
    result: ActionResult;
}

/** Planner 动作执行及其前后证据。 */
interface PlannedActionExecution {
    afterObservation: PageObservation;
    afterObservationReference: EvidenceRef;
    afterScreenshotReference: EvidenceRef;
    beforeObservation: PageObservation;
    beforeObservationReference: EvidenceRef;
    command: ActionCommand;
    effect: EffectVerification;
    resolvedTarget?: ResolvedTarget;
    result: ActionResult;
    semanticAction: SemanticAction;
    origin?: 'planner' | 'recovery';
    recoveryAction?: RecoveryAction;
    recoveryOutcome?: 'progress' | 'no-progress' | 'wrong-state';
    restorative?: boolean;
    recoveryAttempt?: number;
    semanticStepId?: string;
    compilationContribution?: CompilationContribution;
    semanticStepProgress?: SemanticStepProgress;
    traceSequence: number;
    adjudicationStatus?: 'completed';
}

/** 浏览器阶段完成后交给最终判定的数据。 */
interface BrowserExecution {
    navigation: NavigationExecution;
    plannedActions: PlannedActionExecution[];
    stopCommand: ActionCommand;
}

/** 同时保存结构化观察和对应截图。 */
interface ObservationEvidence {
    observation: PageObservation;
    observationReference: EvidenceRef;
    screenshotReference: EvidenceRef;
}

/** 初始空白页只保存观察，不额外截取无业务价值的截图。 */
interface InitialObservationEvidence {
    observation: PageObservation;
    observationReference: EvidenceRef;
}

/** 回放证据持久化后交给最终业务判定的数据。 */
interface PersistedReplay {
    finalObservation: PageObservation;
    finalObservationReference: EvidenceRef;
    history: PlannerHistoryEntry[];
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
    private readonly actionEffectVerifier = new ActionEffectVerifier();
    private readonly groundedActionBuilder = new GroundedActionBuilder();
    private readonly pageStabilityPort?: PageStabilityPort;
    private readonly perceptionService: PerceptionService;
    private readonly stepProgressEvaluator: SemanticStepProgressEvaluator;
    private readonly targetGrounder: TargetGrounder;
    private readonly successCriteriaEvaluator = new SuccessCriteriaEvaluator();

    /** 注入运行产物存储、事件发布、意图构建和浏览器能力。 */
    constructor(
        private readonly artifactStore: ArtifactStore,
        private readonly eventPublisher: RunEventPublisher,
        private readonly intentBuilder: IntentBuilder,
        private readonly browserAdapter: BrowserAdapter,
        private readonly decisionServices: RunCoordinatorDecisionServices,
        private readonly environmentValueResolver: EnvironmentValueResolver,
        private readonly options: RunCoordinatorOptions = DEFAULT_OPTIONS
    ) {
        this.targetGrounder = decisionServices.targetGrounder
            ?? new DeterministicTargetGrounder();
        this.pageStabilityPort = decisionServices.pageStabilityPort;
        this.perceptionService = decisionServices.perceptionService ??
            new PerceptionService({
                capture: async () => ({
                    accessibility: {
                        nodes: [],
                        source: 'playwright-aria-snapshot',
                        truncated: false
                    },
                    interactionStates: {}
                })
            });
        this.stepProgressEvaluator = decisionServices.stepProgressEvaluator ??
            new SemanticStepProgressEvaluator();
    }

    /** 创建一次运行，并执行受预算约束的多轮浏览器 Agent 闭环。 */
    public async start(
        input: StartRunInput,
        signal: AbortSignal
    ): Promise<RunResult> {
        const context = this.createContext(input, signal);

        try {
            await this.initializeRun(context);
            if (input.mode === 'structured-replay') {
                return await this.executeStructuredReplayRun(context);
            }
            const testIntent = await this.buildAndSaveIntent(context);
            const execution = await this.executeAgentRun(
                context,
                testIntent
            );
            return await this.completeAgentRun(
                context,
                testIntent,
                execution
            );
        } catch (error) {
            if (!context.runCreated) {
                throw error;
            }
            return await this.finishAbnormally(context, error);
        }
    }

    /** 读取既有计划并直接回放，完全跳过 Intent Builder 和 Planner。 */
    private async executeStructuredReplayRun(
        context: RunExecutionContext
    ): Promise<RunResult> {
        await this.transition(
            context,
            'REPLAY_VALIDATING',
            '正在读取并执行结构化计划'
        );
        const planReference = context.input.test.execution?.planRef;
        if (!planReference) {
            throw new PlanReplayError(
                'structured-replay 模式必须提供 execution.planRef。',
                0
            );
        }
        const plan = parseCompiledPlan(
            await this.artifactStore.loadJson(planReference)
        );
        if (plan.testId !== context.input.test.id) {
            throw new PlanReplayError(
                `结构化计划属于其他测试：${ plan.testId }`,
                0
            );
        }

        this.requireReplayBudget(context, plan);
        const replay = await this.executeDeterministicReplay(context, plan);
        const persistedReplay = await this.persistReplayEvidence(
            context,
            replay,
            true
        );
        const decision = await this.evaluateReplayVerdict(
            context,
            plan.testIntent,
            persistedReplay
        );
        const verdictReference = await this.artifactStore.saveJson(
            context.runId,
            'verdict',
            toVerdictJson(decision)
        );
        context.evidence.push(verdictReference);
        const validationReference = await this.artifactStore.saveJson(
            context.runId,
            'structured-replay-validation',
            this.createReplayValidationJson(plan, replay, decision)
        );
        context.evidence.push(validationReference);
        const result: RunResult = {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle: 'COMPLETED',
            result: decision.result,
            summary: decision.summary,
            evidence: [ ...context.evidence ],
            traceRef: `${ context.runId }/trace.jsonl`,
            compiledPlanRef: planReference,
            metrics: this.createMetrics(context)
        };

        await this.publishVerdict(
            context,
            result,
            persistedReplay.finalObservationReference.ref
        );
        await this.transition(context, 'COMPLETED', result.summary);
        await this.persistStructuredReplayRun(
            context,
            result,
            persistedReplay
        );
        return result;
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
            groundingSequence: 0,
            perceptionSequence: 0,
            settlingSequence: 0,
            repeatedStateActionCount: 0,
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

    /** 完成确定性导航和多轮规划动作，并始终释放浏览器会话。 */
    private async executeAgentRun(
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
            const before =
                await this.observeBeforeNavigation(context, session);
            const navigationResult = await this.navigate(context, session);
            const after = await this.observeAfterNavigation(context, session);
            const navigation: NavigationExecution = {
                ...navigationResult,
                beforeObservation: before.observation,
                beforeObservationReference: before.observationReference,
                afterObservation: after.observation,
                afterObservationReference: after.observationReference,
                afterScreenshotReference: after.screenshotReference
            };
            await this.recordNavigation(context, navigation);

            if (navigation.result.status !== 'executed') {
                return {
                    navigation,
                    plannedActions: [],
                    stopCommand: this.createStopCommand(
                        'FAIL',
                        '测试起始页面导航失败。'
                    )
                };
            }

            const runtime = this.createRunContext(
                context,
                testIntent,
                session,
                navigation
            );
            const initialStable = await this.settleRuntimePage(context, runtime);
            if (!initialStable) {
                return {
                    navigation,
                    plannedActions: [],
                    stopCommand: this.createStopCommand(
                        'UNCERTAIN',
                        context.settlingFailureReason ??
                            '当前页面未形成稳定感知。'
                    )
                };
            }
            const execution = await this.runActionLoop(
                context,
                runtime,
                navigation
            );
            context.currentStablePerception = runtime.stablePerceptionUsable
                ? runtime.currentStablePerception
                : undefined;
            return execution;
        } finally {
            await this.browserAdapter.close(session);
        }
    }

    /** 重复执行 Observe、Plan、Act、Verify，直到终止动作或预算边界。 */
    // eslint-disable-next-line max-lines-per-function
    private async runActionLoop(
        context: RunExecutionContext,
        runtime: RunContext,
        navigation: NavigationExecution
    ): Promise<BrowserExecution> {
        const plannedActions: PlannedActionExecution[] = [];
        let semanticStepSequence = 0;
        while (true) {
            const budgetStop = this.createBudgetStopCommand(context);
            if (budgetStop) {
                return {
                    navigation,
                    plannedActions,
                    stopCommand: budgetStop
                };
            }

            const criteriaStop = this.evaluateStableSuccessCriteria(
                context,
                runtime,
                navigation,
                plannedActions
            );
            if (criteriaStop) {
                return criteriaStop;
            }

            const semanticAction = await this.planNextAction(context, runtime);
            const plannerStop = this.createPlannerStopCommand(
                semanticAction,
                plannedActions.at(-1)?.semanticAction
            );
            if (plannerStop) {
                return {
                    navigation,
                    plannedActions,
                    stopCommand: plannerStop
                };
            }

            const step = this.createRuntimeStep(
                semanticAction,
                ++semanticStepSequence
            );
            const previousFingerprint = runtime.currentStablePerception
                ?.perception.dom.stateFingerprint;
            const controller = this.createSemanticStepController(
                context,
                runtime,
                step
            );
            const stepResult = await controller.execute(
                step,
                runtime.testIntent,
                context.signal
            );
            const records = this.attachStepExecutionMetadata(
                step,
                stepResult.executions
            );
            for (const record of records) {
                await this.recordPlannedAction(context, runtime, record);
            }
            plannedActions.push(...records);
            if (stepResult.recoveryAttempts.length > 0) {
                await this.saveRecoveryHistory(
                    context,
                    step,
                    stepResult.recoveryAttempts
                );
            }
            const last = records.at(-1);
            if (last && semanticAction.type !== 'WAIT') {
                this.updateRepeatedStateCount(
                    context,
                    runtime,
                    previousFingerprint,
                    last.afterObservation.stateFingerprint
                );
                if (
                    context.repeatedStateActionCount >
                    context.input.budgets.maxRepeatedStateActions
                ) {
                    return {
                        navigation,
                        plannedActions,
                        stopCommand: this.createStopCommand(
                            'UNCERTAIN',
                            '连续动作没有产生可观察的页面变化，已停止运行。'
                        )
                    };
                }
            }
            if (stepResult.outcome.status !== 'completed') {
                return {
                    navigation,
                    plannedActions,
                    stopCommand: this.createStopCommand(
                        stepResult.outcome.status === 'failed'
                            ? 'FAIL'
                            : 'UNCERTAIN',
                        stepResult.outcome.reason
                    )
                };
            }
        }
    }

    private evaluateStableSuccessCriteria(
        context: RunExecutionContext,
        runtime: RunContext,
        navigation: NavigationExecution,
        plannedActions: PlannedActionExecution[]
    ): BrowserExecution | undefined {
        const stable = runtime.stablePerceptionUsable
            ? runtime.currentStablePerception
            : undefined;
        if (!stable) {
            return {
                navigation,
                plannedActions,
                stopCommand: this.createStopCommand(
                    'UNCERTAIN',
                    '当前页面尚未形成稳定感知，停止继续规划。'
                )
            };
        }
        const success = this.successCriteriaEvaluator.evaluate(
            runtime.testIntent,
            stable.perception
        );
        if (success.status !== 'satisfied') {
            return undefined;
        }
        context.deterministicSuccess = success;
        return {
            navigation,
            plannedActions,
            stopCommand: this.createStopCommand(
                'FINISH',
                '稳定页面已满足全部精确文本成功条件。'
            )
        };
    }

    private createRuntimeStep(
        primaryAction: SemanticAction,
        ordinal: number
    ): SemanticStep {
        return {
            id: `runtime-step-${ ordinal }`,
            primaryAction,
            ...primaryAction.expectedEffect
                ? { expectedEffect: primaryAction.expectedEffect }
                : {},
            source: 'runtime-wrapper'
        };
    }

    private attachStepExecutionMetadata(
        step: SemanticStep,
        executions: Array<SemanticStepActionExecution<PlannedActionExecution>>
    ): PlannedActionExecution[] {
        return executions.map(({ record, ...metadata }) => ({
            ...record,
            origin: metadata.origin,
            recoveryAction: metadata.recoveryAction,
            recoveryOutcome: metadata.recoveryOutcome,
            restorative: metadata.restorative,
            recoveryAttempt: metadata.recoveryAttempt,
            semanticStepId: step.id,
            compilationContribution: metadata.compilationContribution,
            semanticStepProgress: metadata.semanticStepProgress
        }));
    }

    /** 保存包含 unsafe/REOBSERVE 在内的恢复决策历史，不伪造 ActionResult。 */
    private async saveRecoveryHistory(
        context: RunExecutionContext,
        step: SemanticStep,
        attempts: RecoveryAttemptSummary[]
    ): Promise<void> {
        const reference = await this.artifactStore.saveJson(
            context.runId,
            `recovery-history-${ step.id }`,
            toJsonValue(attempts)
        );
        context.evidence.push(reference);
    }

    /** 把 Planner 终止建议和当前不支持的动作统一转换成停止命令。 */
    private createPlannerStopCommand(
        action: SemanticAction,
        previousAction: SemanticAction | undefined
    ): ActionCommand | undefined {
        if (this.isTerminalAction(action)) {
            return this.createStopCommand(action.type, action.reasonSummary);
        }
        if (!EXECUTABLE_PLANNED_ACTIONS.has(action.type)) {
            return this.createStopCommand(
                'UNCERTAIN',
                `当前执行阶段不支持 Planner 返回的 ${ action.type } 动作。`
            );
        }
        if (action.type === 'WAIT' && previousAction?.type === 'WAIT') {
            return this.createStopCommand(
                'UNCERTAIN',
                'Planner 连续返回 WAIT，已停止无效等待。'
            );
        }
        return undefined;
    }

    /** 将当前 Planner 动作交给保持原目标不变的 bounded Step Controller。 */
    private async settleRuntimePage(
        context: RunExecutionContext,
        runtime: RunContext
    ): Promise<boolean> {
        if (!runtime.stablePerceptionUsable) {
            const initial = await this.captureRuntimePerception(
                context,
                runtime,
                undefined
            );
            const settler = new PageSettler({
                canContinue: () => this.getRemainingBudgets(context)
                    .maxDurationMs > 0,
                pause: abortableDelay,
                recapture: async (previous, signal) => {
                    const before = await this.samplePageStability(runtime, signal);
                    await this.refreshRuntimeObservation(context, runtime);
                    return await this.captureRuntimePerception(
                        context,
                        runtime,
                        previous,
                        before
                    );
                },
                sample: async (signal) => await this.samplePageStability(
                    runtime,
                    signal
                )
            });
            const result = await settler.settle(initial, context.signal);
            await this.recordPageSettling(context, result);
            if (result.status !== 'stable') {
                context.settlingFailureReason = result.reason;
                return false;
            }
            this.commitStablePerception(runtime, result.perception);
        }
        return true;
    }

    // Runtime adapter wiring stays together so budget/evidence boundaries
    // cannot drift between callbacks.
    // eslint-disable-next-line max-lines-per-function
    private createSemanticStepController(
        context: RunExecutionContext,
        runtime: RunContext,
        step: SemanticStep
    ): SemanticStepController<PlannedActionExecution> {
        const settler = new PageSettler({
            canContinue: () => this.getRemainingBudgets(context)
                .maxDurationMs > 0,
            pause: abortableDelay,
            recapture: async (previous, signal) => {
                const before = await this.samplePageStability(runtime, signal);
                await this.refreshRuntimeObservation(context, runtime);
                return await this.captureRuntimePerception(
                    context,
                    runtime,
                    previous,
                    before
                );
            },
            sample: async (signal) => await this.samplePageStability(
                runtime,
                signal
            )
        });
        return new SemanticStepController<PlannedActionExecution>({
            canExecuteAction: () => {
                const remaining = this.getRemainingBudgets(context);
                return remaining.maxActions > 0 && remaining.maxDurationMs > 0;
            },
            canUseModel: () => this.hasStepModelBudget(context),
            perceive: async (previous, signal) => {
                signal.throwIfAborted();
                if (
                    !previous &&
                    runtime.stablePerceptionUsable &&
                    runtime.currentStablePerception
                ) {
                    return runtime.currentStablePerception.perception;
                }
                if (previous) {
                    const before = await this.samplePageStability(
                        runtime,
                        signal
                    );
                    await this.refreshRuntimeObservation(context, runtime);
                    return await this.captureRuntimePerception(
                        context,
                        runtime,
                        previous,
                        before
                    );
                }
                return await this.captureRuntimePerception(
                    context,
                    runtime,
                    previous ?? runtime.currentStablePerception?.perception
                );
            },
            settle: async (perception, signal) => {
                const result = await settler.settle(perception, signal);
                await this.recordPageSettling(context, result);
                if (result.status === 'stable') {
                    this.commitStablePerception(runtime, result.perception);
                }
                return result;
            },
            ground: async (action, perception, visualAllowed, signal) => {
                return await this.groundWithPerception(
                    context,
                    runtime,
                    action,
                    perception,
                    visualAllowed,
                    signal
                );
            },
            execute: async (input) => {
                const command = input.recoveryAction
                    ? normalizeRecoveryCommand(
                        input.recoveryAction,
                        input.resolvedTarget
                    )
                    : this.groundedActionBuilder.build(
                        input.action,
                        input.resolvedTarget
                    ).command;
                if (!command) {
                    throw new Error('REOBSERVE 不能进入 Browser execute。');
                }
                const beforeReference = runtime.currentStablePerception?.reference;
                if (!beforeReference) {
                    throw new Error('执行 SemanticStep 前缺少页面观察引用。');
                }
                const execution = await this.executePlannedAction(
                    context,
                    runtime,
                    {
                        semanticAction: input.action,
                        command,
                        resolvedTarget: input.resolvedTarget
                    },
                    beforeReference,
                    {
                        semanticStepId: step.id,
                        origin: input.origin,
                        ...input.recoveryAction
                            ? { recoveryAction: input.recoveryAction }
                            : {},
                        ...input.recoveryAttempt
                            ? { recoveryAttempt: input.recoveryAttempt }
                            : {}
                    }
                );
                const after = await this.captureRuntimePerception(
                    context,
                    runtime,
                    input.before
                );
                return {
                    record: execution,
                    origin: input.origin,
                    semanticAction: input.action,
                    ...input.recoveryAction
                        ? { recoveryAction: input.recoveryAction }
                        : {},
                    actionResult: execution.result,
                    effect: execution.effect,
                    before: input.before,
                    after,
                    resolvedTarget: execution.resolvedTarget,
                    restorative: false,
                    compilationContribution: 'non-productive'
                };
            },
            reverifyEffectAfterSettling: async (
                execution,
                settled,
                signal
            ) => {
                signal.throwIfAborted();
                if ([ 'TYPE', 'CHECK', 'SELECT' ].includes(
                    execution.semanticAction.type
                )) {
                    return execution.effect;
                }
                const effect = this.actionEffectVerifier.verify({
                    command: execution.record.command,
                    result: execution.actionResult,
                    before: execution.before.dom,
                    after: settled.dom,
                    evidence: execution.record.effect.evidence
                });
                execution.record.effect = effect;
                return effect;
            },
            recordReobserve: async (perception, attempt, signal) => {
                await this.recordRecoveryReobserve(
                    context,
                    runtime,
                    perception,
                    attempt,
                    signal
                );
            },
            recordRecoveryProtocolDiagnostic: async (
                diagnostic,
                stepId,
                recoveryAttempt,
                signal
            ) => {
                await this.recordRecoveryProtocolDiagnostic(
                    context,
                    diagnostic,
                    stepId,
                    recoveryAttempt,
                    signal
                );
            },
            consumeModelCalls: (count) => {
                context.modelCallCount += count;
                runtime.counters.modelCallCount = context.modelCallCount;
            }
        }, this.stepProgressEvaluator,
        new DeterministicRecoverySafetyPolicy(),
        this.decisionServices.recoveryPlanner);
    }

    private hasStepModelBudget(context: RunExecutionContext): boolean {
        const remaining = this.getRemainingBudgets(context);
        return remaining.maxModelCalls > 1 && remaining.maxDurationMs > 0;
    }

    private async recordRecoveryReobserve(
        context: RunExecutionContext,
        runtime: RunContext,
        perception: PagePerception,
        attempt: number,
        signal: AbortSignal
    ): Promise<void> {
        signal.throwIfAborted();
        const reference = await this.artifactStore.saveJson(
            context.runId,
            `recovery-reobserve-${ runtime.history.length }-${ attempt }`,
            toJsonValue({
                attempt,
                perceptionId: perception.perceptionId,
                capturedAt: perception.capturedAt
            })
        );
        context.evidence.push(reference);
    }

    /** 持久化 provider 边界已经脱敏、截断的 Recovery 模型协议诊断。 */
    private async recordRecoveryProtocolDiagnostic(
        context: RunExecutionContext,
        diagnostic: ModelProtocolDiagnostic,
        stepId: string,
        recoveryAttempt: number,
        signal: AbortSignal
    ): Promise<void> {
        signal.throwIfAborted();
        const reference = await this.artifactStore.saveJson(
            context.runId,
            `recovery-protocol-${ stepId }-${ recoveryAttempt }-${
                diagnostic.phase
            }`,
            toJsonValue(diagnostic)
        );
        context.evidence.push(reference);
    }

    /** 捕获并保存当前 Runtime 的统一 PagePerception。 */
    private async captureRuntimePerception(
        context: RunExecutionContext,
        runtime: RunContext,
        previous: PagePerception | undefined,
        beforeStability?: Awaited<ReturnType<PageStabilityPort['sample']>>
    ): Promise<PagePerception> {
        const observation = runtime.lastImmediateObservation;
        if (!observation) {
            throw new Error('Perception 缺少最新页面观察。');
        }
        const perception = await this.perceptionService.capture(
            runtime.browserSession,
            observation,
            previous,
            context.signal
        );
        if (beforeStability) {
            const afterStability = await this.samplePageStability(
                runtime,
                context.signal
            );
            perception.stability = createPerceptionStability({
                before: beforeStability,
                after: afterStability
            });
        }
        const reference = await this.artifactStore.saveJson(
            context.runId,
            `page-perception-${ ++context.perceptionSequence }`,
            toJsonValue(perception)
        );
        context.evidence.push(reference);
        runtime.pendingPerceptionReference = reference;
        return perception;
    }

    /** 只有 Runtime perception boundary 可以推进当前稳定页面事实。 */
    private commitStablePerception(
        runtime: RunContext,
        perception: PagePerception
    ): void {
        const reference = runtime.pendingPerceptionReference;
        if (!reference) {
            return;
        }
        const revision = runtime.perceptionRevision + 1;
        runtime.perceptionRevision = revision;
        runtime.currentStablePerception = {
            revision,
            perception,
            reference
        };
        runtime.stablePerceptionUsable = true;
        runtime.pendingPerceptionReference = undefined;
    }

    private async samplePageStability(
        runtime: RunContext,
        signal: AbortSignal
    ) {
        if (this.pageStabilityPort) {
            return await this.pageStabilityPort.sample(
                runtime.browserSession,
                signal
            );
        }
        signal.throwIfAborted();
        const observation = runtime.lastImmediateObservation;
        return {
            capturedAt: new Date().toISOString(),
            fingerprint: observation?.stateFingerprint ?? 'no-observation',
            loading: observation?.page.loading ?? true,
            transientSignals: observation?.page.loading
                ? [ 'document-loading' as const ]
                : []
        };
    }

    private async recordPageSettling(
        context: RunExecutionContext,
        result: Awaited<ReturnType<PageSettler['settle']>>
    ): Promise<void> {
        if (result.status === 'stable' && result.samples.length === 0) {
            return;
        }
        const perception = result.status === 'stable'
            ? result.perception
            : result.diagnosticPerception;
        const reference = await this.artifactStore.saveJson(
            context.runId,
            `page-settling-${ ++context.settlingSequence }`,
            toJsonValue({
                status: result.status,
                perceptionId: perception.perceptionId,
                samples: result.samples,
                ...result.status === 'stable' ? {} : { reason: result.reason }
            })
        );
        context.evidence.push(reference);
    }

    /** REOBSERVE 只刷新观察和产物，不创建 Browser ActionResult/Trace。 */
    private async refreshRuntimeObservation(
        context: RunExecutionContext,
        runtime: RunContext
    ): Promise<void> {
        const evidence = await this.captureObservationEvidence(
            context,
            runtime.browserSession,
            `observation-reobserve-${ context.perceptionSequence + 1 }`,
            `screenshot-reobserve-${ context.perceptionSequence + 1 }.png`
        );
        runtime.lastImmediateObservation = evidence.observation;
        runtime.lastImmediateObservationReference = evidence.observationReference;
    }

    /** Grounder 是 semantic target 到物理 target 的唯一绑定边界。 */
    private async groundWithPerception(
        context: RunExecutionContext,
        runtime: RunContext,
        action: SemanticAction,
        perception: PagePerception,
        visualAllowed: boolean,
        signal: AbortSignal
    ): Promise<GroundingDecision> {
        if (!action.target) {
            return {
                status: 'grounded',
                confidence: 1,
                confidenceBasis: 'deterministic',
                evidence: [],
                summary: '该动作不需要物理目标。',
                usage: {
                    sourcesUsed: [],
                    visualModelCalls: 0
                }
            };
        }
        if (context.lifecycle.current() === 'RECORDING') {
            await this.transition(
                context,
                'OBSERVING',
                '正在观察动作后的页面状态'
            );
        }
        if (context.lifecycle.current() !== 'RESOLVING') {
            await this.transition(
                context,
                'RESOLVING',
                '正在把语义目标绑定到当前页面元素'
            );
        }
        const decision = await this.targetGrounder.ground({
            action,
            perception,
            session: runtime.browserSession,
            visualAllowed
        }, signal);
        signal.throwIfAborted();
        const reference = await this.artifactStore.saveJson(
            context.runId,
            `grounding-decision-${ ++context.groundingSequence }`,
            toJsonValue(decision)
        );
        context.evidence.push(reference);
        return decision;
    }

    /** 记录浏览器执行导航前的空白页状态。 */
    private async observeBeforeNavigation(
        context: RunExecutionContext,
        session: BrowserSession
    ): Promise<InitialObservationEvidence> {
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
        return {
            observation,
            observationReference: reference
        };
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

    /** 对多轮执行结果进行独立业务判定并持久化终态。 */
    private async completeAgentRun(
        context: RunExecutionContext,
        testIntent: TestIntent,
        execution: BrowserExecution
    ): Promise<RunResult> {
        await this.transition(
            context,
            'DECIDING_VERDICT',
            '正在根据最终页面证据生成运行结论'
        );
        const failedAction = this.findFailedAction(execution);
        let result = failedAction
            ? this.createFailedActionResult(context, failedAction)
            : await this.evaluateFinalVerdict(
                context,
                testIntent,
                execution
            );
        if (result.result === 'PASS') {
            const sourceReference = await this.artifactStore.saveJson(
                context.runId,
                'plan-compilation-source',
                toJsonValue(createPlanCompilationSource({
                    runId: context.runId,
                    testId: context.input.test.id,
                    testIntent,
                    steps: this.createCompilableTrace(execution)
                }))
            );
            context.evidence.push(sourceReference);
            result = {
                ...result,
                evidence: [ ...context.evidence ]
            };
        }
        await this.publishVerdict(context, result);
        await this.transition(context, 'COMPLETED', result.summary);
        await this.persistCompletedRun(context, execution, result);
        return result;
    }

    /** 把内存中的真实执行记录转换为稍后手动编译所需的连续轨迹。 */
    private createCompilableTrace(
        execution: BrowserExecution
    ): CompilableTraceStep[] {
        const productiveActions = selectProductiveActions(
            execution.plannedActions
        );
        return [{
            sequence: 1,
            semanticAction: this.groundedActionBuilder.fromLegacyCommand(
                execution.navigation.command
            ),
            command: execution.navigation.command,
            actionResult: execution.navigation.result,
            effect: this.createNavigationEffect(execution.navigation),
            beforeObservation: execution.navigation.beforeObservation,
            afterObservation: execution.navigation.afterObservation
        }, ...productiveActions.map((action, index) => ({
            sequence: index + 2,
            semanticAction: action.semanticAction,
            command: action.command,
            resolvedTarget: action.resolvedTarget,
            actionResult: action.result,
            effect: action.effect,
            semanticStepProgress: action.semanticStepProgress,
            beforeObservation: action.beforeObservation,
            afterObservation: action.afterObservation
        }))];
    }

    /** 在进入回放前一次性确认剩余动作、模型和时间预算。 */
    private requireReplayBudget(
        context: RunExecutionContext,
        plan: CompiledPlan
    ): void {
        const remaining = this.getRemainingBudgets(context);
        if (remaining.maxActions < plan.steps.length) {
            throw new PlanReplayError('剩余动作预算不足，无法验证编译计划。', 0);
        }
        if (remaining.maxModelCalls < 1) {
            throw new PlanReplayError('剩余模型预算不足，无法判定回放结果。', 0);
        }
        if (remaining.maxDurationMs < 1) {
            throw new PlanReplayError('剩余时间预算不足，无法验证编译计划。', 0);
        }
    }

    /** 执行不调用 Planner 的回放，并准确累计回放动作数量。 */
    private async executeDeterministicReplay(
        context: RunExecutionContext,
        plan: CompiledPlan
    ): Promise<ReplayExecution> {
        const replayer = new DeterministicPlanReplayer(
            this.browserAdapter,
            this.environmentValueResolver,
            undefined,
            this.options.browserStartOptions
        );
        try {
            const replay = await replayer.replay({
                plan,
                environment: context.input.environment,
                signal: context.signal
            });
            context.actionCount += replay.actionCount;
            return replay;
        } catch (error) {
            if (error instanceof PlanReplayError) {
                context.actionCount += error.actionCount;
            }
            throw error;
        }
    }

    /** 保存每一步回放前后观察和截图，并构建最终判定历史。 */
    private async persistReplayEvidence(
        context: RunExecutionContext,
        replay: ReplayExecution,
        appendTrace = false
    ): Promise<PersistedReplay> {
        const history: PlannerHistoryEntry[] = [];
        let finalObservation: PageObservation | undefined;
        let finalObservationReference: EvidenceRef | undefined;

        for (const execution of replay.steps) {
            const sequence = execution.step.sequence;
            const beforeReference = await this.saveObservation(
                context.runId,
                `replay-observation-before-${ sequence }`,
                execution.beforeObservation
            );
            const screenshotReference = await this.artifactStore.saveArtifact(
                context.runId,
                {
                    content: execution.afterScreenshot.content,
                    kind: 'screenshot',
                    mediaType: execution.afterScreenshot.mediaType,
                    name: `replay-screenshot-after-${ sequence }.png`
                }
            );
            const persistedAfter: PageObservation = {
                ...execution.afterObservation,
                screenshotRef: screenshotReference.ref
            };
            const afterReference = await this.saveObservation(
                context.runId,
                `replay-observation-after-${ sequence }`,
                persistedAfter
            );
            context.evidence.push(
                beforeReference,
                afterReference,
                screenshotReference
            );
            const effect: EffectVerification = {
                ...execution.effect,
                evidence: [ afterReference, screenshotReference ]
            };
            history.push({
                semanticAction: this.groundedActionBuilder.fromLegacyCommand(
                    execution.command
                ),
                actionResult: execution.result,
                effect,
                beforeObservationRef: beforeReference.ref,
                afterObservationRef: afterReference.ref
            });
            if (appendTrace) {
                const traceEvent: TraceEvent = {
                    schemaVersion: 1,
                    runId: context.runId,
                    sequence,
                    semanticAction:
                        this.groundedActionBuilder.fromLegacyCommand(
                            execution.command
                        ),
                    command: execution.command,
                    resolvedTarget: execution.resolvedTarget,
                    beforeObservationRef: beforeReference.ref,
                    afterObservationRef: afterReference.ref,
                    actionResult: execution.result,
                    effect,
                    artifacts: [
                        beforeReference,
                        afterReference,
                        screenshotReference
                    ]
                };
                await this.artifactStore.appendTrace(
                    context.runId,
                    traceEvent
                );
                await this.publishEvent(
                    context.runId,
                    this.nextSequence(context),
                    'trace.appended', {
                        traceSequence: traceEvent.sequence
                    }
                );
            }
            finalObservation = persistedAfter;
            finalObservationReference = afterReference;
        }

        if (!finalObservation || !finalObservationReference) {
            throw new PlanReplayError('确定性回放没有生成最终页面证据。', 0);
        }
        return {
            finalObservation,
            finalObservationReference,
            history
        };
    }

    /** 保存 structured-replay 的终态快照、结果和完成事件。 */
    private async persistStructuredReplayRun(
        context: RunExecutionContext,
        result: RunResult,
        replay: PersistedReplay
    ): Promise<void> {
        context.snapshot = {
            ...context.snapshot,
            result: result.result,
            failure: result.failure,
            metadata: {
                ...context.snapshot.metadata,
                observationRef: replay.finalObservationReference.ref,
                stateFingerprint: replay.finalObservation.stateFingerprint,
                compiledPlanRef: result.compiledPlanRef ?? ''
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

    /** 使用独立 Verdict 对回放终点再次做业务结果判定。 */
    private async evaluateReplayVerdict(
        context: RunExecutionContext,
        testIntent: TestIntent,
        replay: PersistedReplay
    ): Promise<VerdictDecision> {
        context.modelCallCount += 1;
        const decision = await this.decisionServices.verdictEvaluator.evaluate(
            {
                testIntent,
                observation: replay.finalObservation,
                history: replay.history,
                stopCommand: this.createStopCommand(
                    'FINISH',
                    '结构化计划已经完成全部回放步骤。'
                )
            },
            context.signal
        );
        context.signal.throwIfAborted();
        return decision;
    }

    /** 生成不包含实际输入值和截图字节的回放验证摘要。 */
    private createReplayValidationJson(
        plan: CompiledPlan,
        replay: ReplayExecution,
        verdict: VerdictDecision
    ): JsonValue {
        return {
            schemaVersion: 1,
            planId: plan.planId,
            sourceRunId: plan.sourceRunId,
            status: 'passed',
            actionCount: replay.actionCount,
            finalObservationId: replay.finalObservation.observationId,
            verdict: {
                result: verdict.result,
                summary: verdict.summary
            },
            steps: replay.steps.map((execution) => ({
                sequence: execution.step.sequence,
                type: execution.step.type,
                status: execution.result.status,
                effectStatus: execution.effect.status
            }))
        };
    }

    /** 将导航后的稳定状态转换为 Planner 使用的正式运行上下文。 */
    private createRunContext(
        context: RunExecutionContext,
        testIntent: TestIntent,
        browserSession: BrowserSession,
        navigation: NavigationExecution
    ): RunContext {
        const historyEntry: PlannerHistoryEntry = {
            semanticAction: this.groundedActionBuilder.fromLegacyCommand(
                navigation.command
            ),
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
            lastImmediateObservation: navigation.afterObservation,
            lastImmediateObservationReference: navigation.afterObservationReference,
            stablePerceptionUsable: false,
            perceptionRevision: 0,
            history: [historyEntry],
            budgets: context.input.budgets,
            lifecycle: context.lifecycle.current(),
            counters: {
                actionCount: context.actionCount,
                modelCallCount: context.modelCallCount,
                repeatedStateActionCount: context.repeatedStateActionCount
            },
            startedAt: context.startedAt
        };
    }

    /** 使用最新观察调用一次 Planner，并发布不包含输入值的动作摘要。 */
    private async planNextAction(
        context: RunExecutionContext,
        runtime: RunContext
    ): Promise<SemanticAction> {
        if (context.lifecycle.current() !== 'OBSERVING') {
            await this.transition(
                context,
                'OBSERVING',
                '正在准备导航后的最新页面观察'
            );
        }
        await this.transition(
            context,
            'PLANNING',
            '正在规划一次页面交互'
        );
        const remainingBudgets = this.getRemainingBudgets(context);
        this.requirePlannerBudget(remainingBudgets);
        const stable = runtime.currentStablePerception;
        if (!stable) {
            throw new Error('Planner 缺少稳定页面感知。');
        }
        context.modelCallCount += 1;
        runtime.counters.modelCallCount = context.modelCallCount;
        runtime.lifecycle = context.lifecycle.current();
        const action = await this.decisionServices.actionPlanner.plan(
            {
                testIntent: runtime.testIntent,
                observation: stable.perception.dom,
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
                actionType: action.type,
                reasonSummary: action.reasonSummary
            }
        );
        return action;
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
                context.input.budgets.maxRepeatedStateActions -
                    context.repeatedStateActionCount
            )
        };
    }

    /** 在循环继续前保留一次模型调用给独立 Verdict。 */
    private createBudgetStopCommand(
        context: RunExecutionContext
    ): ActionCommand | undefined {
        const budgets = this.getRemainingBudgets(context);
        if (budgets.maxDurationMs < 1) {
            return this.createStopCommand(
                'UNCERTAIN',
                '运行时间预算已耗尽。'
            );
        }
        if (budgets.maxActions < 1) {
            return this.createStopCommand(
                'UNCERTAIN',
                '浏览器动作预算已耗尽。'
            );
        }
        if (budgets.maxModelCalls <= 1) {
            return this.createStopCommand(
                'UNCERTAIN',
                '已停止继续规划，并保留最后一次模型调用用于独立判定。'
            );
        }
        return undefined;
    }

    /** 判断 Planner 是否建议停止页面执行。 */
    private isTerminalAction(action: SemanticAction): action is SemanticAction & {
        type: 'FAIL' | 'FINISH' | 'UNCERTAIN'
    } {
        return action.type === 'FINISH' ||
            action.type === 'FAIL' ||
            action.type === 'UNCERTAIN';
    }

    /** 创建不引用页面元素的内部终止命令。 */
    private createStopCommand(
        type: 'FAIL' | 'FINISH' | 'UNCERTAIN',
        reasonSummary: string
    ): ActionCommand {
        return {
            type,
            reasonSummary,
            risk: 'read-only'
        };
    }

    /** 根据动作前后指纹维护连续无变化计数。 */
    private updateRepeatedStateCount(
        context: RunExecutionContext,
        runtime: RunContext,
        beforeFingerprint: string | undefined,
        afterFingerprint: string
    ): void {
        context.repeatedStateActionCount =
            beforeFingerprint === afterFingerprint
                ? context.repeatedStateActionCount + 1
                : 0;
        runtime.counters.repeatedStateActionCount =
            context.repeatedStateActionCount;
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

    /** 执行、验证并记录一轮受控页面动作。 */
    private async executePlannedAction(
        context: RunExecutionContext,
        runtime: RunContext,
        grounded: ReturnType<GroundedActionBuilder['build']>,
        beforeObservationReference: EvidenceRef,
        metadata: {
            semanticStepId: string,
            origin: 'planner' | 'recovery',
            recoveryAction?: RecoveryAction,
            recoveryAttempt?: number
        }
    ): Promise<PlannedActionExecution> {
        const beforeObservation = runtime.currentStablePerception?.perception.dom;
        if (!beforeObservation) {
            throw new Error('执行页面动作前缺少最新页面观察。');
        }
        const executableCommand = await this.resolveCommandValue(
            context,
            grounded.command
        );
        runtime.stablePerceptionUsable = false;
        const result = await this.actPlannedCommand(
            context,
            runtime.browserSession,
            executableCommand,
            grounded.resolvedTarget
        );
        const traceSequence = context.actionCount;
        await this.appendActionExecutionFact(
            context,
            grounded,
            beforeObservationReference,
            result,
            traceSequence,
            metadata
        );
        runtime.counters.actionCount = context.actionCount;
        const after = await this.observeAfterPlannedAction(
            context,
            runtime.browserSession
        );
        const effect = this.actionEffectVerifier.verify({
            command: grounded.command,
            result,
            before: beforeObservation,
            after: after.observation,
            evidence: [
                after.observationReference,
                after.screenshotReference
            ]
        });
        const execution = {
            command: grounded.command,
            result,
            effect,
            resolvedTarget: grounded.resolvedTarget,
            semanticAction: grounded.semanticAction,
            beforeObservation,
            beforeObservationReference,
            afterObservation: after.observation,
            afterObservationReference: after.observationReference,
            afterScreenshotReference: after.screenshotReference,
            traceSequence
        };
        runtime.lastImmediateObservation = execution.afterObservation;
        runtime.lastImmediateObservationReference = execution.afterObservationReference;
        return execution;
    }

    /** Browser 返回结果后立即持久化不可变执行事实。 */
    private async appendActionExecutionFact(
        context: RunExecutionContext,
        grounded: ReturnType<GroundedActionBuilder['build']>,
        beforeObservationReference: EvidenceRef,
        result: ActionResult,
        traceSequence: number,
        metadata: {
            semanticStepId: string,
            origin: 'planner' | 'recovery',
            recoveryAction?: RecoveryAction,
            recoveryAttempt?: number
        }
    ): Promise<void> {
        const traceEvent: TraceEvent = {
            schemaVersion: 1,
            runId: context.runId,
            sequence: traceSequence,
            semanticAction: grounded.semanticAction,
            semanticStepId: metadata.semanticStepId,
            origin: metadata.origin,
            ...metadata.recoveryAction
                ? {
                    recoveryAction: metadata.recoveryAction,
                    recoveryIntent: metadata.recoveryAction.reasonSummary
                }
                : {},
            ...metadata.recoveryAttempt
                ? { recoveryAttempt: metadata.recoveryAttempt }
                : {},
            command: grounded.command,
            resolvedTarget: grounded.resolvedTarget,
            beforeObservationRef: beforeObservationReference.ref,
            actionResult: result,
            artifacts: [ beforeObservationReference ]
        };
        await this.artifactStore.appendTrace(context.runId, traceEvent);
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'trace.appended', {
                traceSequence,
                fact: 'execution'
            }
        );
    }

    /** 只在浏览器调用边界把逻辑环境变量替换为实际字面量。 */
    private async resolveCommandValue(
        context: RunExecutionContext,
        command: ActionCommand
    ): Promise<ActionCommand> {
        if (context.lifecycle.current() !== 'RESOLVING') {
            await this.transition(
                context,
                'RESOLVING',
                '正在解析动作输入值'
            );
        }
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
        executableCommand: ActionCommand,
        resolvedTarget?: ResolvedTarget
    ): Promise<ActionResult> {
        await this.transition(
            context,
            'ACTING',
            `正在执行 AI 规划的 ${ executableCommand.type } 动作`
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
            executableCommand,
            resolvedTarget
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

    /** 保存本轮页面动作完成后的观察与截图。 */
    private async observeAfterPlannedAction(
        context: RunExecutionContext,
        session: BrowserSession
    ): Promise<ObservationEvidence> {
        await this.transition(
            context,
            'VERIFYING',
            '正在验证页面动作后的状态'
        );
        const traceSequence = context.actionCount;
        return await this.captureObservationEvidence(
            context,
            session,
            `observation-after-action-${ traceSequence }`,
            `screenshot-after-action-${ traceSequence }.png`
        );
    }

    /** 为已持久化执行事实追加独立判定，并更新 Planner 历史。 */
    private async recordPlannedAction(
        context: RunExecutionContext,
        runtime: RunContext,
        execution: PlannedActionExecution
    ): Promise<void> {
        if (execution.adjudicationStatus === 'completed') {
            throw new Error(
                `Trace ${ execution.traceSequence } 已完成判定，禁止重复记录。`
            );
        }
        await this.publishEffect(context, execution.effect);
        if (context.lifecycle.current() !== 'RECORDING') {
            await this.transition(
                context,
                'RECORDING',
                '正在记录 AI 页面动作轨迹'
            );
        }
        const adjudication: ActionTraceAdjudication = {
            schemaVersion: 1,
            runId: context.runId,
            traceSequence: execution.traceSequence,
            status: 'completed',
            origin: execution.origin ?? 'planner',
            ...execution.semanticStepId
                ? { semanticStepId: execution.semanticStepId }
                : {},
            ...execution.recoveryOutcome
                ? { recoveryOutcome: execution.recoveryOutcome }
                : {},
            ...execution.semanticStepProgress
                ? { semanticStepProgress: execution.semanticStepProgress }
                : {},
            compilationContribution:
                execution.compilationContribution ?? 'failed',
            afterObservationRef: execution.afterObservationReference.ref,
            effect: execution.effect,
            artifacts: [
                execution.afterObservationReference,
                execution.afterScreenshotReference
            ]
        };
        const adjudicationReference = await this.artifactStore.saveJson(
            context.runId,
            `trace-adjudication-${ execution.traceSequence }`,
            toJsonValue(adjudication)
        );
        context.evidence.push(adjudicationReference);
        execution.adjudicationStatus = 'completed';
        runtime.history.push({
            semanticAction: execution.semanticAction,
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
        return await this.persistObservationEvidence(
            context,
            session,
            observation,
            observationName,
            screenshotName
        );
    }

    /** 持久化已经由普通观察或视觉增强生成的页面状态及其当前截图。 */
    private async persistObservationEvidence(
        context: RunExecutionContext,
        session: BrowserSession,
        observation: PageObservation,
        observationName: string,
        screenshotName: string
    ): Promise<ObservationEvidence> {
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
            semanticAction: this.groundedActionBuilder.fromLegacyCommand(
                navigation.command
            ),
            origin: 'setup',
            compilationContribution: 'productive',
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
        result: RunResult,
        observationRef = context.currentStablePerception?.reference.ref
    ): Promise<void> {
        await this.publishEvent(
            context.runId,
            this.nextSequence(context),
            'verdict.completed', {
                result: result.result ?? 'UNCERTAIN',
                summary: result.summary,
                ...observationRef
                    ? { observationRef }
                    : {}
            }
        );
    }

    /** 保存完成状态、最终结果并发布 run.completed。 */
    private async persistCompletedRun(
        context: RunExecutionContext,
        execution: BrowserExecution,
        result: RunResult,
        replay?: PersistedReplay
    ): Promise<void> {
        const latestAction = execution.plannedActions.at(-1);
        const latestStable = context.currentStablePerception;
        const latestObservation = replay?.finalObservation ??
            latestStable?.perception.dom ?? latestAction?.afterObservation ??
            execution.navigation.afterObservation;
        const latestObservationReference =
            replay?.finalObservationReference ??
            latestStable?.reference ??
            latestAction?.afterObservationReference ??
            execution.navigation.afterObservationReference;
        context.snapshot = {
            ...context.snapshot,
            result: result.result,
            failure: result.failure,
            metadata: {
                ...context.snapshot.metadata,
                observationRef: latestObservationReference.ref,
                stateFingerprint: latestObservation.stateFingerprint,
                plannerDecision: execution.stopCommand.type,
                ...result.compiledPlanRef
                    ? { compiledPlanRef: result.compiledPlanRef }
                    : {}
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
                url: observation.page.url,
                ...observation.screenshotRef
                    ? { screenshotRef: observation.screenshotRef }
                    : {}
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

    /** 返回浏览器阶段首个失败动作，供技术失败快速收尾。 */
    private findFailedAction(
        execution: BrowserExecution
    ): ActionResult | undefined {
        if (execution.navigation.result.status !== 'executed') {
            return execution.navigation.result;
        }
        return execution.plannedActions.find(
            (action) => action.result.status !== 'executed'
        )?.result;
    }

    /** 将浏览器动作失败转换为稳定的测试失败结果。 */
    private createFailedActionResult(
        context: RunExecutionContext,
        failedResult: ActionResult
    ): RunResult {
        const failureCategory = this.getActionFailureCategory(failedResult) ??
            'ACTION_FAILED';
        const summary = `浏览器动作执行失败：${
            failedResult.error?.message ?? failedResult.status
        }`;

        return {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle: 'COMPLETED',
            result: 'FAIL',
            summary,
            evidence: context.evidence,
            failure: {
                category: failureCategory,
                phase: 'ACTING',
                summary,
                recoverable: failedResult.status === 'timed-out',
                evidence: context.evidence
            },
            traceRef: `${ context.runId }/trace.jsonl`,
            metrics: this.createMetrics(context)
        };
    }

    /** 调用独立 Verdict，并把结构化判定加入运行证据。 */
    private async evaluateFinalVerdict(
        context: RunExecutionContext,
        testIntent: TestIntent,
        execution: BrowserExecution
    ): Promise<RunResult> {
        const deterministicSuccess = context.deterministicSuccess;
        if (deterministicSuccess) {
            const decision: VerdictDecision = {
                result: 'PASS',
                summary: '稳定页面已满足全部精确文本成功条件。',
                successCriteria: deterministicSuccess.successCriteria,
                failureCriteria: deterministicSuccess.failureCriteria
            };
            const verdictReference = await this.artifactStore.saveJson(
                context.runId,
                'verdict',
                toVerdictJson(decision)
            );
            context.evidence.push(verdictReference);
            return {
                schemaVersion: 1,
                runId: context.runId,
                lifecycle: 'COMPLETED',
                result: 'PASS',
                summary: decision.summary,
                evidence: context.evidence,
                traceRef: `${ context.runId }/trace.jsonl`,
                metrics: this.createMetrics(context)
            };
        }
        const latestObservation = context.currentStablePerception?.perception.dom;
        if (!latestObservation) {
            return this.createInsufficientVerdictResult(
                context,
                '最终页面没有稳定感知证据，不能判定业务成功。'
            );
        }
        const history = this.createExecutionHistory(execution);
        if (!this.isObservationReady(latestObservation)) {
            return this.createInsufficientVerdictResult(
                context,
                '最终页面仍在加载或未渲染出可验证内容，不能判定业务成功。'
            );
        }
        const remainingBudgets = this.getRemainingBudgets(context);
        if (
            remainingBudgets.maxDurationMs < 1 ||
            remainingBudgets.maxModelCalls < 1
        ) {
            return this.createInsufficientVerdictResult(
                context,
                '运行预算不足，无法执行独立最终判定。'
            );
        }

        context.modelCallCount += 1;
        const decision = await this.decisionServices.verdictEvaluator.evaluate(
            {
                testIntent,
                observation: latestObservation,
                history,
                stopCommand: execution.stopCommand
            },
            context.signal
        );
        context.signal.throwIfAborted();
        const verdictReference = await this.artifactStore.saveJson(
            context.runId,
            'verdict',
            toVerdictJson(decision)
        );
        context.evidence.push(verdictReference);
        return {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle: 'COMPLETED',
            result: decision.result,
            summary: decision.summary,
            evidence: context.evidence,
            traceRef: `${ context.runId }/trace.jsonl`,
            metrics: this.createMetrics(context)
        };
    }

    /** 汇总导航和所有页面动作，供独立判定器参考。 */
    private createExecutionHistory(
        execution: BrowserExecution
    ): PlannerHistoryEntry[] {
        return [
            {
                semanticAction: this.groundedActionBuilder.fromLegacyCommand(
                    execution.navigation.command
                ),
                actionResult: execution.navigation.result,
                effect: this.createNavigationEffect(execution.navigation),
                beforeObservationRef:
                    execution.navigation.beforeObservationReference.ref,
                afterObservationRef:
                    execution.navigation.afterObservationReference.ref
            },
            ...execution.plannedActions.map((action) => ({
                semanticAction: action.semanticAction,
                actionResult: action.result,
                effect: action.effect,
                beforeObservationRef: action.beforeObservationReference.ref,
                afterObservationRef: action.afterObservationReference.ref
            }))
        ];
    }

    /** 当 Verdict 预算不足时返回不会误报业务成功的结果。 */
    private createInsufficientVerdictResult(
        context: RunExecutionContext,
        summary: string
    ): RunResult {
        return {
            schemaVersion: 1,
            runId: context.runId,
            lifecycle: 'COMPLETED',
            result: 'UNCERTAIN',
            summary,
            evidence: context.evidence,
            failure: {
                category: 'VERDICT_INSUFFICIENT',
                phase: 'DECIDING_VERDICT',
                summary,
                recoverable: true,
                evidence: context.evidence
            },
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
                    ? this.sanitizeErrorMessage(error.message)
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

    /** 判断最终页面是否有足够的可见证据支持业务结论。 */
    private isObservationReady(observation: PageObservation): boolean {
        return !observation.page.loading;
    }

    /** 去除 Playwright 等库面向终端的 ANSI 样式码，避免泄漏到 API 和前端。 */
    private sanitizeErrorMessage(message: string): string {
        return message.replace(ANSI_ESCAPE_PATTERN, '').trim();
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
            repeatedStateActionCount: context.repeatedStateActionCount
        };
    }

    /** 按异常发生阶段推断对调试最有帮助的失败分类。 */
    private getCrashCategory(
        lifecycle: RunLifecycleState
    ): FailureCategory {
        if (lifecycle === 'COMPILING_PLAN') {
            return 'TRACE_COMPILE_ERROR';
        }
        if (lifecycle === 'REPLAY_VALIDATING') {
            return 'REPLAY_FAILED';
        }
        if (lifecycle === 'BUILDING_INTENT') {
            return 'MODEL_UNAVAILABLE';
        }
        if (
            lifecycle === 'PLANNING' ||
            lifecycle === 'DECIDING_VERDICT'
        ) {
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

/** 将独立 Verdict 显式转换为可持久化 JSON。 */
function toVerdictJson(decision: VerdictDecision): JsonValue {
    return {
        result: decision.result,
        summary: decision.summary,
        successCriteria: decision.successCriteria.map((criterion) => ({
            criterionId: criterion.criterionId,
            status: criterion.status,
            summary: criterion.summary
        })),
        failureCriteria: decision.failureCriteria.map((criterion) => ({
            criterionId: criterion.criterionId,
            status: criterion.status,
            summary: criterion.summary
        }))
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

function abortableDelay(
    milliseconds: number,
    signal: AbortSignal
): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
