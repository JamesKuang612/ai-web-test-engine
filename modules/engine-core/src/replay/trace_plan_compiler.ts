import {
    randomUUID,
} from 'node:crypto';
import type {
    ActionCommand,
    ActionResult,
    CompiledActionType,
    CompiledPlan,
    CompiledStep,
    CompiledTarget,
    EffectVerification,
    LocatorHint,
    ObservedElement,
    PageObservation,
    TestIntent,
} from '../contracts';

/** 编译器需要的真实轨迹及其动作前后页面状态。 */
export interface CompilableTraceStep {
    sequence: number;
    command: ActionCommand;
    actionResult: ActionResult;
    effect: EffectVerification;
    beforeObservation: PageObservation;
    afterObservation: PageObservation;
}

export interface CompilePlanInput {
    runId: string;
    testId: string;
    testIntent: TestIntent;
    steps: CompilableTraceStep[];
}

export interface TracePlanCompilerOptions {
    createId?: () => string;
    now?: () => Date;
}

/** 轨迹不满足安全、完整或可复现要求时抛出的显式错误。 */
export class TracePlanCompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TracePlanCompileError';
    }
}

/** 将成功探索轨迹编译为不携带运行时 candidateId 的确定性计划。 */
export class TracePlanCompiler {
    private readonly createId: () => string;
    private readonly now: () => Date;

    constructor(options: TracePlanCompilerOptions = {}) {
        this.createId = options.createId ?? randomUUID;
        this.now = options.now ?? (() => new Date());
    }

    public compile(input: CompilePlanInput): CompiledPlan {
        this.assertTraceShape(input);

        return {
            schemaVersion: 1,
            planId: this.createId(),
            testId: input.testId,
            sourceRunId: input.runId,
            sourceTraceRef: `${ input.runId }/trace.jsonl`,
            createdAt: this.now().toISOString(),
            allowedHosts: [ ...input.testIntent.allowedHosts ],
            testIntent: structuredClone(input.testIntent),
            steps: input.steps.map((step) => this.compileStep(
                step,
                input.testIntent.allowedHosts
            ))
        };
    }

    private assertTraceShape(input: CompilePlanInput): void {
        if (input.steps.length === 0) {
            throw new TracePlanCompileError('成功轨迹不能为空。');
        }
        if (input.steps[0].command.type !== 'NAVIGATE') {
            throw new TracePlanCompileError('成功轨迹必须从 NAVIGATE 开始。');
        }

        input.steps.forEach((step, index) => {
            if (step.sequence !== index + 1) {
                throw new TracePlanCompileError('轨迹序号必须从 1 开始连续递增。');
            }
            if (step.actionResult.status !== 'executed') {
                throw new TracePlanCompileError(
                    `第 ${ step.sequence } 步未成功执行，不能编译。`
                );
            }
            if (step.effect.status !== 'confirmed') {
                throw new TracePlanCompileError(
                    `第 ${ step.sequence } 步效果未经确认，不能编译。`
                );
            }
        });
    }

    private compileStep(
        step: CompilableTraceStep,
        allowedHosts: string[]
    ): CompiledStep {
        const type = this.toCompiledActionType(step.command.type, step.sequence);
        const expectedEffect = step.command.expectedEffect?.trim()
            || step.effect.expectedEffect.trim();
        if (!expectedEffect) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步缺少可验证的预期效果。`
            );
        }

        const compiled: CompiledStep = {
            id: `step-${ step.sequence }`,
            sequence: step.sequence,
            type,
            expectedEffect,
            risk: step.command.risk
        };

        if (type === 'NAVIGATE') {
            compiled.value = this.compileNavigationValue(step, allowedHosts);

            return compiled;
        }

        if (type === 'WAIT') {
            compiled.value = this.compileWaitValue(step);

            return compiled;
        }

        const target = this.compileTarget(step);
        compiled.target = target;
        if (type === 'TYPE') {
            compiled.value = this.compileTypeValue(step, target);
        }
        if (type === 'SELECT') {
            compiled.value = this.compileSelectValue(step);
        }
        if (type === 'CHECK') {
            compiled.value = this.compileCheckValue(step);
        }

        return compiled;
    }

    private toCompiledActionType(
        type: ActionCommand['type'],
        sequence: number
    ): CompiledActionType {
        if (
            type === 'CHECK'
            || type === 'CLICK'
            || type === 'NAVIGATE'
            || type === 'SELECT'
            || type === 'TYPE'
            || type === 'WAIT'
        ) {
            return type;
        }

        throw new TracePlanCompileError(
            `第 ${ sequence } 步动作 ${ type } 暂不支持确定性回放。`
        );
    }

    private compileNavigationValue(
        step: CompilableTraceStep,
        allowedHosts: string[]
    ): CompiledStep['value'] {
        const value = step.command.value;
        if (value?.source !== 'literal' || typeof value.value !== 'string') {
            throw new TracePlanCompileError('NAVIGATE 必须使用字符串字面量 URL。');
        }

        let host: string;
        try {
            host = new URL(value.value).hostname.toLowerCase();
        } catch {
            throw new TracePlanCompileError('NAVIGATE 包含无效 URL。');
        }
        const normalizedHosts = allowedHosts.map((item) => item.toLowerCase());
        if (!normalizedHosts.includes(host)) {
            throw new TracePlanCompileError(
                `NAVIGATE 目标主机 ${ host } 不在允许列表中。`
            );
        }

        return structuredClone(value);
    }

    private compileTypeValue(
        step: CompilableTraceStep,
        target: CompiledTarget
    ): CompiledStep['value'] {
        const value = step.command.value;
        if (value?.source === 'environment' || value?.source === 'generated') {
            return structuredClone(value);
        }
        if (
            value?.source !== 'literal'
            || typeof value.value !== 'string'
        ) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步 TYPE 必须提供字符串输入值。`
            );
        }
        if (isSensitiveTypeTarget(target)) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步敏感 TYPE 必须使用环境变量或生成值引用。`
            );
        }

        return structuredClone(value);
    }

    private compileSelectValue(
        step: CompilableTraceStep
    ): CompiledStep['value'] {
        const value = step.command.value;
        if (
            !value
            || (
                value.source === 'literal'
                && typeof value.value !== 'string'
            )
        ) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步 SELECT 必须提供字符串选项值。`
            );
        }
        return structuredClone(value);
    }

    private compileCheckValue(
        step: CompilableTraceStep
    ): CompiledStep['value'] {
        const value = step.command.value;
        if (value?.source !== 'literal' || typeof value.value !== 'boolean') {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步 CHECK 必须提供布尔字面量。`
            );
        }
        return structuredClone(value);
    }

    private compileWaitValue(
        step: CompilableTraceStep
    ): CompiledStep['value'] {
        const value = step.command.value;
        if (
            value?.source !== 'literal'
            || typeof value.value !== 'number'
            || !Number.isInteger(value.value)
            || value.value < 100
            || value.value > 5_000
        ) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步 WAIT 必须提供 100～5000 毫秒整数。`
            );
        }
        return structuredClone(value);
    }

    private compileTarget(step: CompilableTraceStep): CompiledTarget {
        const candidateId = step.command.target?.candidateId;
        if (!candidateId) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步缺少候选元素引用。`
            );
        }
        const element = step.beforeObservation.interactiveElements.find(
            (candidate) => candidate.candidateId === candidateId
        );
        if (!element) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步候选元素不在动作前页面观察中。`
            );
        }
        if (!element.visible || element.disabled) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步候选元素不是可操作状态。`
            );
        }

        const locatorHints = this.collectUniqueLocatorHints(
            element,
            step.beforeObservation
        );
        if (locatorHints.length === 0) {
            throw new TracePlanCompileError(
                `第 ${ step.sequence } 步候选元素没有唯一稳定的定位提示。`
            );
        }

        return {
            description: step.command.target?.description ?? element.name
                ?? element.label ?? element.placeholder ?? element.tag,
            locatorHints,
            identity: {
                tag: element.tag,
                ...element.role ? { role: element.role } : {},
                ...element.name ? { name: element.name } : {},
                ...element.text ? { text: element.text } : {},
                ...element.label ? { label: element.label } : {},
                ...element.placeholder ? { placeholder: element.placeholder } : {},
                ...element.attributes.type
                    ? { inputType: element.attributes.type }
                    : {}
            }
        };
    }

    private collectUniqueLocatorHints(
        element: ObservedElement,
        observation: PageObservation
    ): LocatorHint[] {
        const uniqueHints = element.locatorHints.filter((hint, index, hints) => {
            const duplicateIndex = hints.findIndex((candidate) => (
                candidate.strategy === hint.strategy
                && candidate.value === hint.value
            ));
            if (duplicateIndex !== index) {
                return false;
            }

            const matchingElements = observation.interactiveElements.filter(
                (candidate) => candidate.locatorHints.some((candidateHint) => (
                    candidateHint.strategy === hint.strategy
                    && candidateHint.value === hint.value
                ))
            );

            return matchingElements.length === 1;
        });

        return structuredClone(uniqueHints);
    }
}

/** 密码、令牌等敏感字段不得把实际输入值固化进可复用计划。 */
function isSensitiveTypeTarget(target: CompiledTarget): boolean {
    if (target.identity.inputType?.toLowerCase() === 'password') {
        return true;
    }
    return /密码|口令|令牌|token|secret|password/iu.test([
        target.description,
        target.identity.name,
        target.identity.label,
        target.identity.placeholder
    ].filter(Boolean).join(' '));
}
