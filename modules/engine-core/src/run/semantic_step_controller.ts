import type {
    ActionCommand,
    ActionResult,
    CompilationContribution,
    EffectVerification,
    GroundingDecision,
    PagePerception,
    RecoveryAction,
    RecoveryAttemptSummary,
    RecoveryDecision,
    RecoveryPlannerInput,
    ResolvedTarget,
    SemanticAction,
    SemanticStep,
    SemanticStepExecutionOutcome,
    SemanticStepProgress,
    TestIntent,
} from '../contracts';
import type {
    SemanticStepProgressEvaluator,
} from './semantic_step_progress_evaluator';
import {
    createRecoveryPlanningView as buildRecoveryPlanningView,
} from './semantic_step_progress_evaluator';
import {
    DeterministicRecoveryPlanner,
} from './deterministic_recovery_planner';
import {
    PrimaryRetryPolicy,
} from './primary_retry_policy';
import type {
    RecoveryPlannerPort,
    RecoverySafetyPolicy,
} from './recovery_ports';

export interface SemanticStepActionExecution<TRecord> {
    record: TRecord;
    origin: 'planner' | 'recovery';
    semanticAction: SemanticAction;
    recoveryAction?: RecoveryAction;
    actionResult: ActionResult;
    effect: EffectVerification;
    before: PagePerception;
    after: PagePerception;
    resolvedTarget?: ResolvedTarget;
    recoveryOutcome?: 'progress' | 'no-progress' | 'wrong-state';
    recoveryAttempt?: number;
    compilationContribution: CompilationContribution;
    semanticStepProgress?: SemanticStepProgress;
    /** 撤销前序错误状态时为 true，即使 runtime progress 也不可编译。 */
    restorative: boolean;
}

export interface SemanticStepRuntimePort<TRecord> {
    canExecuteAction: () => boolean;
    canUseModel: () => boolean;
    perceive: (
        previous: PagePerception | undefined,
        signal: AbortSignal
    ) => Promise<PagePerception>;
    ground: (
        action: SemanticAction,
        perception: PagePerception,
        visualAllowed: boolean,
        signal: AbortSignal
    ) => Promise<GroundingDecision>;
    execute: (input: {
        action: SemanticAction,
        origin: 'planner' | 'recovery',
        recoveryAction?: RecoveryAction,
        resolvedTarget?: ResolvedTarget,
        before: PagePerception,
        signal: AbortSignal
    }) => Promise<SemanticStepActionExecution<TRecord>>;
    recordReobserve: (
        perception: PagePerception,
        attempt: number,
        signal: AbortSignal
    ) => Promise<void>;
    consumeModelCalls: (
        count: number,
        purpose: 'primary-visual' | 'recovery-planner' | 'recovery-visual' |
            'step-progress'
    ) => void;
}

export interface SemanticStepControllerOptions {
    maxRecoveryAttemptsPerStep: number;
    maxRecoveryPlannerCallsPerStep: number;
    maxRecoveryVisualCallsPerStep: number;
    maxStepProgressModelCallsPerStep: number;
    maxSameRecoveryAction: number;
    maxConsecutiveNoProgress: number;
}

export interface SemanticStepControllerResult<TRecord> {
    outcome: SemanticStepExecutionOutcome;
    executions: Array<SemanticStepActionExecution<TRecord>>;
    recoveryAttempts: RecoveryAttemptSummary[];
    latestPerception: PagePerception;
}

const DEFAULT_OPTIONS: SemanticStepControllerOptions = {
    maxRecoveryAttemptsPerStep: 3,
    maxRecoveryPlannerCallsPerStep: 1,
    maxRecoveryVisualCallsPerStep: 1,
    maxStepProgressModelCallsPerStep: 1,
    maxSameRecoveryAction: 1,
    maxConsecutiveNoProgress: 1
};

/** 在单一原始目标不变的前提下执行 bounded recovery。 */
export class SemanticStepController<TRecord> {
    private readonly deterministicPlanner = new DeterministicRecoveryPlanner();
    private readonly retryPolicy = new PrimaryRetryPolicy();

    constructor(
        private readonly runtime: SemanticStepRuntimePort<TRecord>,
        private readonly progressEvaluator: SemanticStepProgressEvaluator,
        private readonly safetyPolicy: RecoverySafetyPolicy,
        private readonly modelRecoveryPlanner?: RecoveryPlannerPort,
        private readonly options: SemanticStepControllerOptions = DEFAULT_OPTIONS
    ) {}

    public async execute(
        step: SemanticStep,
        testIntent: TestIntent,
        signal: AbortSignal
    ): Promise<SemanticStepControllerResult<TRecord>> {
        const state = await this.createState(signal);
        state.primaryGrounding = await this.ground(
            step.primaryAction,
            state.perception,
            state,
            false,
            signal
        );
        if (state.primaryGrounding.status === 'grounded') {
            const completed = await this.tryPrimary(
                step,
                state,
                signal
            );
            if (completed) {
                return this.result(state, completed);
            }
        }
        return await this.recover(step, testIntent, state, signal);
    }

    // Recovery loop keeps its bounded state transitions together for auditability.
    // eslint-disable-next-line max-lines-per-function
    private async recover(
        step: SemanticStep,
        testIntent: TestIntent,
        state: ControllerState<TRecord>,
        signal: AbortSignal
    ): Promise<SemanticStepControllerResult<TRecord>> {
        for (
            let attempt = 1;
            attempt <= this.options.maxRecoveryAttemptsPerStep;
            attempt += 1
        ) {
            const decision = await this.planRecovery(
                step,
                testIntent,
                state,
                signal
            );
            if (decision.kind === 'stop') {
                return this.result(state, {
                    status: 'exhausted',
                    reason: decision.reason,
                    ...state.latestProgress
                        ? { progress: state.latestProgress }
                        : {}
                });
            }
            const cycle = this.detectCycle(state, decision.action);
            if (cycle) {
                return this.result(state, {
                    status: 'cycle',
                    reason: cycle
                });
            }
            const beforeGrounding = state.primaryGrounding;
            const recovery = await this.executeRecovery(
                step,
                testIntent,
                decision.action,
                attempt,
                state,
                signal
            );
            if ('outcome' in recovery) {
                return this.result(state, recovery.outcome);
            }
            state.perception = recovery.after;
            state.primaryGrounding = await this.ground(
                step.primaryAction,
                state.perception,
                state,
                true,
                signal
            );
            if (recovery.execution) {
                recovery.execution.restorative = state.wrongStateActive;
            }
            const recoveryOutcome = classifyRecoveryProgress(
                beforeGrounding,
                state.primaryGrounding,
                recovery.after,
                recovery.execution
            );
            if (recovery.execution) {
                recovery.execution.recoveryOutcome = recoveryOutcome;
                recovery.execution.compilationContribution =
                    contributionForRecovery(recovery.execution, recoveryOutcome);
                state.executions.push(recovery.execution);
            }
            state.attempts.push({
                action: decision.action,
                outcome: recoveryOutcome,
                summary: recovery.execution?.effect.summary ??
                    '重新观察了当前页面。'
            });
            state.lastRecoveryNavigation = recoveryOutcome === 'wrong-state'
                ? recoveryNavigationFrom(recovery.execution)
                : undefined;
            state.wrongStateActive = recoveryOutcome === 'wrong-state';
            state.consecutiveNoProgress = recoveryOutcome === 'no-progress'
                ? state.consecutiveNoProgress + 1
                : 0;
            if (
                state.consecutiveNoProgress >
                this.options.maxConsecutiveNoProgress
            ) {
                return this.result(state, {
                    status: 'exhausted',
                    reason: 'Recovery 连续没有改善原始目标。'
                });
            }
            if (state.primaryGrounding.status === 'grounded') {
                const reverified = await this.reverifyPrimary(
                    step,
                    state,
                    signal
                );
                if (reverified) {
                    return this.result(state, reverified);
                }
                const completed = await this.tryPrimary(step, state, signal);
                if (completed) {
                    return this.result(state, completed);
                }
            }
        }
        return this.result(state, {
            status: 'exhausted',
            reason: '已达到单步 Recovery 尝试上限。',
            ...state.latestProgress ? { progress: state.latestProgress } : {}
        });
    }

    private async tryPrimary(
        step: SemanticStep,
        state: ControllerState<TRecord>,
        signal: AbortSignal
    ): Promise<SemanticStepExecutionOutcome | undefined> {
        const target = state.primaryGrounding.target;
        if (step.primaryAction.target && !target) {
            return undefined;
        }
        const retry = this.retryPolicy.decide({
            action: step.primaryAction,
            browserExecuted: state.primaryExecuted,
            effect: state.primaryEffect
        });
        if (retry.kind === 'reverify') {
            return undefined;
        }
        if (retry.kind === 'do-not-retry') {
            return {
                status: 'exhausted',
                reason: retry.reason,
                ...state.latestProgress ? { progress: state.latestProgress } : {}
            };
        }
        if (!this.runtime.canExecuteAction()) {
            return {
                status: 'budget-exhausted',
                reason: '单步执行前全局动作或时间预算已经耗尽。'
            };
        }
        const execution = await this.runtime.execute({
            action: step.primaryAction,
            origin: 'planner',
            ...target ? { resolvedTarget: target } : {},
            before: state.perception,
            signal
        });
        state.executions.push(execution);
        state.primaryExecuted = execution.actionResult.status === 'executed';
        state.primaryEffect = execution.effect;
        state.primaryActionResult = execution.actionResult;
        state.primaryBefore = execution.before;
        state.perception = execution.after;
        const groundingAfter = shouldRegroundAfterPrimary(step.primaryAction)
            ? await this.ground(
                step.primaryAction,
                state.perception,
                state,
                false,
                signal
            )
            : state.primaryGrounding;
        const allowModel = state.progressModelCalls <
            this.options.maxStepProgressModelCallsPerStep
            && this.runtime.canUseModel();
        const progress = await this.progressEvaluator.evaluate({
            step,
            attemptedAction: step.primaryAction,
            before: execution.before,
            after: execution.after,
            actionResult: execution.actionResult,
            effect: execution.effect,
            primaryGroundingBefore: state.primaryGrounding,
            primaryGroundingAfter: groundingAfter
        }, signal, allowModel);
        if (progress.basis === 'model') {
            state.progressModelCalls += 1;
            this.runtime.consumeModelCalls(1, 'step-progress');
        }
        state.latestProgress = progress;
        state.primaryGrounding = groundingAfter;
        execution.semanticStepProgress = progress;
        execution.compilationContribution = progress.status === 'complete'
            ? 'productive'
            : execution.actionResult.status === 'executed'
                ? 'non-productive'
                : 'failed';
        return progress.status === 'complete'
            ? { status: 'completed', progress }
            : undefined;
    }

    private async reverifyPrimary(
        step: SemanticStep,
        state: ControllerState<TRecord>,
        signal: AbortSignal
    ): Promise<SemanticStepExecutionOutcome | undefined> {
        if (
            !state.primaryExecuted
            || !state.primaryBefore
            || !state.primaryActionResult
            || !state.primaryEffect
        ) {
            return undefined;
        }
        const allowModel = state.progressModelCalls <
            this.options.maxStepProgressModelCallsPerStep
            && this.runtime.canUseModel();
        const progress = await this.progressEvaluator.evaluate({
            step,
            attemptedAction: step.primaryAction,
            before: state.primaryBefore,
            after: state.perception,
            actionResult: state.primaryActionResult,
            effect: state.primaryEffect,
            primaryGroundingAfter: state.primaryGrounding
        }, signal, allowModel);
        if (progress.basis === 'model') {
            state.progressModelCalls += 1;
            this.runtime.consumeModelCalls(1, 'step-progress');
        }
        state.latestProgress = progress;
        const primaryExecution = state.executions.findLast(
            (execution) => execution.origin === 'planner'
        );
        if (primaryExecution) {
            primaryExecution.semanticStepProgress = progress;
            if (progress.status === 'complete') {
                primaryExecution.compilationContribution = 'productive';
            }
        }
        return progress.status === 'complete'
            ? { status: 'completed', progress }
            : undefined;
    }

    private async executeRecovery(
        step: SemanticStep,
        testIntent: TestIntent,
        action: RecoveryAction,
        attempt: number,
        state: ControllerState<TRecord>,
        signal: AbortSignal
    ): Promise<{
        after: PagePerception,
        execution?: SemanticStepActionExecution<TRecord>
    } | {outcome: SemanticStepExecutionOutcome}> {
        if (action.type === 'REOBSERVE') {
            const perception = await this.runtime.perceive(
                state.perception,
                signal
            );
            await this.runtime.recordReobserve(perception, attempt, signal);
            return { after: perception };
        }
        const semanticAction = toRecoverySemanticAction(action);
        let target: ResolvedTarget | undefined;
        if ('target' in action) {
            const grounding = await this.ground(
                semanticAction,
                state.perception,
                state,
                true,
                signal
            );
            if (grounding.status !== 'grounded' || !grounding.target) {
                return {
                    outcome: {
                        status: 'failed',
                        reason: `Recovery 目标无法安全定位：${ grounding.summary }`
                    }
                };
            }
            target = grounding.target;
        }
        const safety = this.safetyPolicy.evaluate({
            action,
            step,
            testIntent,
            recoveryIntent: action.reasonSummary,
            ...target ? { resolvedSnapshot: target.elementSnapshot } : {},
            ...state.lastRecoveryNavigation
                ? { recoveryNavigation: state.lastRecoveryNavigation }
                : {}
        });
        if (!safety.allowed) {
            state.attempts.push({
                action,
                outcome: 'unsafe',
                summary: safety.reason
            });
            return {
                outcome: {
                    status: 'unsafe',
                    reason: safety.reason
                }
            };
        }
        if (!this.runtime.canExecuteAction()) {
            return {
                outcome: {
                    status: 'budget-exhausted',
                    reason: 'Recovery 执行前全局动作或时间预算已经耗尽。'
                }
            };
        }
        const execution = await this.runtime.execute({
            action: semanticAction,
            origin: 'recovery',
            recoveryAction: action,
            ...target ? { resolvedTarget: target } : {},
            before: state.perception,
            signal
        });
        execution.recoveryAttempt = attempt;
        return { after: execution.after, execution };
    }

    private async planRecovery(
        step: SemanticStep,
        testIntent: TestIntent,
        state: ControllerState<TRecord>,
        signal: AbortSignal
    ): Promise<RecoveryDecision> {
        const input: RecoveryPlannerInput = {
            step: createRecoveryPlanningStepView(step),
            testIntent,
            failure: {
                grounding: toSafeGrounding(state.primaryGrounding),
                ...state.primaryActionResult
                    ? { actionResult: toSafeActionResult(state.primaryActionResult) }
                    : {},
                ...state.latestProgress
                    ? {
                        progress: {
                            status: state.latestProgress.status,
                            basis: state.latestProgress.basis,
                            summary: state.latestProgress.summary
                        }
                    }
                    : {}
            },
            view: buildRecoveryPlanningView(state.perception),
            recentAttempts: state.attempts,
            allowedCapabilities: [
                'CLEAR', 'CLICK', 'HOVER', 'SCROLL', 'WAIT', 'BACK',
                'REOBSERVE'
            ]
        };
        const deterministic = await this.deterministicPlanner.plan(input);
        if (deterministic.kind === 'recover') {
            return deterministic;
        }
        if (
            !this.modelRecoveryPlanner
            || state.recoveryPlannerCalls >=
                this.options.maxRecoveryPlannerCallsPerStep
            || !this.runtime.canUseModel()
        ) {
            return deterministic;
        }
        state.recoveryPlannerCalls += 1;
        this.runtime.consumeModelCalls(1, 'recovery-planner');
        return await this.modelRecoveryPlanner.plan(input, signal);
    }

    private async ground(
        action: SemanticAction,
        perception: PagePerception,
        state: ControllerState<TRecord>,
        recovery: boolean,
        signal: AbortSignal
    ): Promise<GroundingDecision> {
        const visualAllowed = this.runtime.canUseModel() && (
            !recovery || state.recoveryVisualCalls <
                this.options.maxRecoveryVisualCallsPerStep
        );
        const decision = await this.runtime.ground(
            action,
            perception,
            visualAllowed,
            signal
        );
        const calls = decision.usage?.visualModelCalls ?? 0;
        if (calls > 0) {
            if (recovery) {
                state.recoveryVisualCalls += calls;
            }
            this.runtime.consumeModelCalls(
                calls,
                recovery ? 'recovery-visual' : 'primary-visual'
            );
        }
        return decision;
    }

    private detectCycle(
        state: ControllerState<TRecord>,
        action: RecoveryAction
    ): string | undefined {
        const fingerprint = JSON.stringify({
            state: state.perception.dom.stateFingerprint,
            action
        });
        const count = (state.recoveryFingerprints.get(fingerprint) ?? 0) + 1;
        state.recoveryFingerprints.set(fingerprint, count);
        return count > this.options.maxSameRecoveryAction
            ? '检测到相同页面状态和 RecoveryAction 的循环。'
            : undefined;
    }

    private async createState(
        signal: AbortSignal
    ): Promise<ControllerState<TRecord>> {
        return {
            perception: await this.runtime.perceive(undefined, signal),
            primaryGrounding: notFoundGrounding(),
            primaryExecuted: false,
            executions: [],
            attempts: [],
            recoveryFingerprints: new Map(),
            recoveryPlannerCalls: 0,
            recoveryVisualCalls: 0,
            progressModelCalls: 0,
            consecutiveNoProgress: 0,
            wrongStateActive: false
        };
    }

    private result(
        state: ControllerState<TRecord>,
        outcome: SemanticStepExecutionOutcome
    ): SemanticStepControllerResult<TRecord> {
        return {
            outcome,
            executions: state.executions,
            recoveryAttempts: state.attempts,
            latestPerception: state.perception
        };
    }
}

interface ControllerState<TRecord> {
    perception: PagePerception;
    primaryGrounding: GroundingDecision;
    primaryExecuted: boolean;
    primaryEffect?: EffectVerification;
    primaryActionResult?: ActionResult;
    primaryBefore?: PagePerception;
    latestProgress?: SemanticStepProgress;
    executions: Array<SemanticStepActionExecution<TRecord>>;
    attempts: RecoveryAttemptSummary[];
    recoveryFingerprints: Map<string, number>;
    recoveryPlannerCalls: number;
    recoveryVisualCalls: number;
    progressModelCalls: number;
    consecutiveNoProgress: number;
    wrongStateActive: boolean;
    lastRecoveryNavigation?: {
        fromUrl: string,
        toUrl: string
    };
}

function toRecoverySemanticAction(action: RecoveryAction): SemanticAction {
    if (action.type === 'CLEAR') {
        return {
            type: 'TYPE',
            target: action.target,
            value: { source: 'literal', value: '' },
            expectedEffect: action.expectedTransientEffect,
            reasonSummary: action.reasonSummary
        };
    }
    if (action.type === 'WAIT') {
        return {
            type: 'WAIT',
            value: {
                source: 'literal',
                value: action.duration === 'short' ? 500 : 1_500
            },
            expectedEffect: action.expectedTransientEffect,
            reasonSummary: action.reasonSummary
        };
    }
    if (action.type === 'SCROLL') {
        return {
            type: 'SCROLL',
            value: {
                source: 'literal',
                value: {
                    direction: action.direction,
                    amount: action.amount
                }
            },
            expectedEffect: action.expectedTransientEffect,
            reasonSummary: action.reasonSummary
        };
    }
    if (action.type === 'REOBSERVE') {
        throw new Error('REOBSERVE 不会转换为浏览器 SemanticAction。');
    }
    return {
        type: action.type,
        ...'target' in action ? { target: action.target } : {},
        expectedEffect: action.expectedTransientEffect,
        reasonSummary: action.reasonSummary
    };
}

function classifyRecoveryProgress<TRecord>(
    before: GroundingDecision,
    after: GroundingDecision,
    afterPerception: PagePerception,
    execution: SemanticStepActionExecution<TRecord> | undefined
): 'progress' | 'no-progress' | 'wrong-state' {
    if (
        execution?.effect.status === 'contradicted' && !execution.restorative
        || execution?.actionResult.browserSignals.urlChanged &&
            !execution.restorative &&
            execution.recoveryAction?.type !== 'BACK'
    ) {
        return 'wrong-state';
    }
    if (
        afterPerception.delta?.overlayState.before === 'clear'
        && afterPerception.delta.overlayState.after === 'blocked'
        && !execution?.restorative
    ) {
        return 'wrong-state';
    }
    if (
        execution?.restorative
        && execution.effect.status === 'confirmed'
    ) {
        return 'progress';
    }
    if (after.status === 'grounded' && before.status !== 'grounded') {
        return 'progress';
    }
    if (groundingActionabilityImproved(before, after)) {
        return 'progress';
    }
    if (overlayImproved(afterPerception.delta)) {
        return 'progress';
    }
    return 'no-progress';
}

function groundingActionabilityImproved(
    before: GroundingDecision,
    after: GroundingDecision
): boolean {
    return before.status === 'blocked' && after.status !== 'blocked'
        || before.status === 'not-visible' &&
            after.status !== 'not-visible' && after.status !== 'not-found'
        || before.status === 'not-actionable' &&
            after.target?.actionable === true
        || before.target?.actionable === false && after.target?.actionable === true;
}

function overlayImproved(
    delta: PagePerception['delta'] | undefined
): boolean {
    return delta?.overlayState.before === 'blocked'
        && delta.overlayState.after === 'clear';
}

function recoveryNavigationFrom<TRecord>(
    execution: SemanticStepActionExecution<TRecord> | undefined
): {fromUrl: string, toUrl: string} | undefined {
    if (
        !execution?.actionResult.browserSignals.urlChanged
        || execution.before.dom.page.url === execution.after.dom.page.url
    ) {
        return undefined;
    }
    return {
        fromUrl: execution.before.dom.page.url,
        toUrl: execution.after.dom.page.url
    };
}

function contributionForRecovery<TRecord>(
    execution: SemanticStepActionExecution<TRecord>,
    outcome: 'progress' | 'no-progress' | 'wrong-state'
): CompilationContribution {
    if (execution.actionResult.status !== 'executed') {
        return 'failed';
    }
    if (outcome === 'wrong-state') {
        return 'wrong-state';
    }
    if (outcome === 'progress' && !execution.restorative) {
        return 'productive';
    }
    return 'non-productive';
}

function notFoundGrounding(): GroundingDecision {
    return {
        status: 'not-found',
        confidence: 0,
        evidence: [],
        summary: '尚未定位原始目标。'
    };
}

function createRecoveryPlanningStepView(step: SemanticStep) {
    return {
        id: step.id,
        primaryAction: {
            type: step.primaryAction.type,
            ...step.primaryAction.target
                ? { target: structuredClone(step.primaryAction.target) }
                : {},
            ...step.primaryAction.expectedEffect
                ? { expectedEffect: step.primaryAction.expectedEffect }
                : {},
            reasonSummary: step.primaryAction.reasonSummary
        },
        ...step.expectedEffect ? { expectedEffect: step.expectedEffect } : {}
    };
}

function toSafeGrounding(decision: GroundingDecision) {
    return {
        status: decision.status,
        confidence: decision.confidence,
        summary: decision.summary,
        sourcesUsed: [ ...(decision.usage?.sourcesUsed ?? []) ]
    };
}

function toSafeActionResult(result: ActionResult) {
    return {
        status: result.status,
        ...result.error ? { errorCode: result.error.code } : {},
        browserSignals: structuredClone(result.browserSignals)
    };
}

function shouldRegroundAfterPrimary(action: SemanticAction): boolean {
    return action.type === 'CLICK' || action.type === 'HOVER';
}

/** Recovery-only 动作在进入 Browser 前仍会被标准化成现有物理命令。 */
export function normalizeRecoveryCommand(
    action: RecoveryAction,
    resolvedTarget?: ResolvedTarget
): ActionCommand | undefined {
    if (action.type === 'REOBSERVE') {
        return undefined;
    }
    const semantic = toRecoverySemanticAction(action);
    return {
        type: semantic.type,
        ...semantic.target
            ? {
                target: {
                    description: semantic.target.description,
                    ...resolvedTarget
                        ? { candidateId: resolvedTarget.candidateId }
                        : {}
                }
            }
            : {},
        ...semantic.value ? { value: semantic.value } : {},
        ...semantic.expectedEffect
            ? { expectedEffect: semantic.expectedEffect }
            : {},
        reasonSummary: semantic.reasonSummary,
        risk: 'reversible'
    };
}
