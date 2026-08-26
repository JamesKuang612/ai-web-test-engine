import type {
    ActionCommand,
    ActionResult,
    CompiledPlan,
    CompiledStep,
    EffectVerification,
    EnvironmentDefinition,
    PageObservation,
} from '../contracts';
import type {
    BrowserAdapter,
    BrowserScreenshot,
    BrowserStartOptions,
    EnvironmentValueResolver,
} from '../ports';
import {
    CompiledTargetResolver,
} from './compiled_target_resolver';

export interface ReplayPlanInput {
    plan: CompiledPlan;
    environment: EnvironmentDefinition;
    signal: AbortSignal;
}

/** 回放中一个动作的安全命令、前后观察和验证结果。 */
export interface ReplayStepExecution {
    step: CompiledStep;
    command: ActionCommand;
    result: ActionResult;
    effect: EffectVerification;
    beforeObservation: PageObservation;
    afterObservation: PageObservation;
    afterScreenshot: BrowserScreenshot;
}

/** 不调用 Planner 的完整确定性回放结果。 */
export interface ReplayExecution {
    steps: ReplayStepExecution[];
    finalObservation: PageObservation;
    actionCount: number;
}

/** 计划解析、动作执行或效果验证失败时的回放错误。 */
export class PlanReplayError extends Error {
    public readonly actionCount: number;

    constructor(message: string, actionCount: number) {
        super(message);
        this.name = 'PlanReplayError';
        this.actionCount = actionCount;
    }
}

const DEFAULT_BROWSER_OPTIONS: BrowserStartOptions = {
    headless: true,
    viewport: {
        width: 1280,
        height: 720
    }
};

/** 在全新浏览器会话中逐步解析和执行 CompiledPlan。 */
export class DeterministicPlanReplayer {
    constructor(
        private readonly browserAdapter: BrowserAdapter,
        private readonly environmentValueResolver: EnvironmentValueResolver,
        private readonly targetResolver = new CompiledTargetResolver(),
        private readonly browserOptions = DEFAULT_BROWSER_OPTIONS
    ) {}

    public async replay(input: ReplayPlanInput): Promise<ReplayExecution> {
        this.requireCompatibleEnvironment(input.plan, input.environment);
        const session = await this.browserAdapter.start(this.browserOptions);
        const executions: ReplayStepExecution[] = [];
        let actionCount = 0;

        try {
            for (const step of input.plan.steps) {
                input.signal.throwIfAborted();
                const beforeObservation = await this.browserAdapter.observe(
                    session
                );
                const command = this.createSafeCommand(step, beforeObservation);
                const executableCommand = await this.resolveCommandValue(
                    command,
                    input.environment
                );
                const result = await this.browserAdapter.execute(
                    session,
                    executableCommand
                );
                actionCount += 1;
                const afterObservation = await this.browserAdapter.observe(
                    session
                );
                const afterScreenshot =
                    await this.browserAdapter.captureScreenshot(session);
                const effect = this.verifyEffect(
                    input.plan,
                    command,
                    result,
                    beforeObservation,
                    afterObservation
                );
                if (result.status !== 'executed') {
                    throw new PlanReplayError(
                        `回放第 ${ step.sequence } 步执行失败：${
                            result.error?.message ?? result.status
                        }`,
                        actionCount
                    );
                }
                if (effect.status !== 'confirmed') {
                    throw new PlanReplayError(
                        `回放第 ${ step.sequence } 步效果未确认：${
                            effect.summary
                        }`,
                        actionCount
                    );
                }
                executions.push({
                    step,
                    command,
                    result,
                    effect,
                    beforeObservation,
                    afterObservation,
                    afterScreenshot
                });
            }

            const finalExecution = executions.at(-1);
            if (!finalExecution) {
                throw new PlanReplayError('回放计划不能为空。', actionCount);
            }
            return {
                steps: executions,
                finalObservation: finalExecution.afterObservation,
                actionCount
            };
        } catch (error) {
            if (
                error instanceof PlanReplayError
                || error instanceof DOMException && error.name === 'AbortError'
            ) {
                throw error;
            }
            throw new PlanReplayError(
                error instanceof Error ? error.message : '确定性回放失败。',
                actionCount
            );
        } finally {
            await this.browserAdapter.close(session);
        }
    }

    private requireCompatibleEnvironment(
        plan: CompiledPlan,
        environment: EnvironmentDefinition
    ): void {
        const environmentHosts = new Set(
            environment.allowedHosts.map((host) => host.toLowerCase())
        );
        const incompatibleHost = plan.allowedHosts.find(
            (host) => !environmentHosts.has(host.toLowerCase())
        );
        if (incompatibleHost) {
            throw new PlanReplayError(
                `回放环境不允许访问计划主机：${ incompatibleHost }`,
                0
            );
        }
    }

    private createSafeCommand(
        step: CompiledStep,
        observation: PageObservation
    ): ActionCommand {
        const target = step.target
            ? this.targetResolver.resolve(step.target, observation)
            : undefined;

        return {
            type: step.type,
            ...target && step.target
                ? {
                    target: {
                        candidateId: target.candidateId,
                        description: step.target.description
                    }
                }
                : {},
            ...step.value ? { value: structuredClone(step.value) } : {},
            expectedEffect: step.expectedEffect,
            reasonSummary: `确定性回放已编译步骤 ${ step.sequence }`,
            risk: step.risk
        };
    }

    private async resolveCommandValue(
        command: ActionCommand,
        environment: EnvironmentDefinition
    ): Promise<ActionCommand> {
        const value = command.value;
        if (!value || value.source === 'literal') {
            return command;
        }
        if (value.source === 'generated') {
            throw new Error('确定性回放暂不支持生成值。');
        }
        const variable = environment.variables[value.key];
        if (!variable) {
            throw new Error(`回放环境中不存在变量：${ value.key }`);
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

    private verifyEffect(
        plan: CompiledPlan,
        command: ActionCommand,
        result: ActionResult,
        before: PageObservation,
        after: PageObservation
    ): EffectVerification {
        if (command.type === 'NAVIGATE') {
            return this.verifyNavigationEffect(plan, command, result, after);
        }
        if (command.type === 'TYPE') {
            return this.verifyTypeEffect(command, result, after);
        }

        const changed = result.browserSignals.urlChanged
            || before.stateFingerprint !== after.stateFingerprint;
        const confirmed = result.status === 'executed' && changed;
        return this.createEffect(
            command,
            confirmed,
            result.status,
            confirmed
                ? '点击后页面状态发生了变化。'
                : '点击后页面状态没有产生可观察变化。'
        );
    }

    private verifyNavigationEffect(
        plan: CompiledPlan,
        command: ActionCommand,
        result: ActionResult,
        after: PageObservation
    ): EffectVerification {
        let hostAllowed = false;
        try {
            const host = new URL(after.page.url).hostname.toLowerCase();
            hostAllowed = plan.allowedHosts.some(
                (allowedHost) => allowedHost.toLowerCase() === host
            );
        } catch {
            hostAllowed = false;
        }
        const confirmed = result.status === 'executed' && hostAllowed;

        return this.createEffect(
            command,
            confirmed,
            result.status,
            confirmed
                ? '浏览器已进入计划允许的目标站点。'
                : '导航后页面不在计划允许的目标站点。'
        );
    }

    private verifyTypeEffect(
        command: ActionCommand,
        result: ActionResult,
        after: PageObservation
    ): EffectVerification {
        const valueState = after.interactiveElements.find(
            (element) => element.candidateId === command.target?.candidateId
        )?.valueState;
        const confirmed = result.status === 'executed'
            && (valueState === 'filled' || valueState === 'masked');

        return this.createEffect(
            command,
            confirmed,
            result.status,
            confirmed
                ? '目标输入框已显示为填写状态。'
                : '输入后没有确认目标输入框的填写状态。'
        );
    }

    private createEffect(
        command: ActionCommand,
        confirmed: boolean,
        actionStatus: ActionResult['status'],
        summary: string
    ): EffectVerification {
        return {
            status: actionStatus !== 'executed'
                ? 'contradicted'
                : confirmed
                    ? 'confirmed'
                    : 'not-observed',
            expectedEffect: command.expectedEffect ?? '动作产生预期效果',
            evidence: [],
            summary
        };
    }
}
