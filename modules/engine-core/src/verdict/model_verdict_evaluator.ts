import type {
    ActionCommand,
    CriterionAssessment,
    JsonValue,
    VerdictDecision,
} from '../contracts';
import type {
    ModelAdapter,
    RuntimeSchema,
} from '../ports';
import type {
    PlannerHistoryEntry,
} from '../planning';
import type {
    EvaluateVerdictInput,
    VerdictEvaluator,
} from './verdict_evaluator';

/** 独立模型判定的调用参数。 */
export interface ModelVerdictEvaluatorOptions {
    maxOutputTokens: number;
    timeoutMs: number;
}

const DEFAULT_OPTIONS: ModelVerdictEvaluatorOptions = {
    maxOutputTokens: 1_500,
    timeoutMs: 30_000
};

/** 根据最终页面证据独立判断业务结果，不接受 Planner 直接指定 PASS。 */
export class ModelVerdictEvaluator implements VerdictEvaluator {
    /** 注入模型边界、严格 Schema 和调用预算。 */
    constructor(
        private readonly modelAdapter: ModelAdapter,
        private readonly verdictSchema: RuntimeSchema<VerdictDecision>,
        private readonly options: ModelVerdictEvaluatorOptions =
            DEFAULT_OPTIONS
    ) {}

    /** 对最终页面和 TestIntent 的每条条件逐项判定。 */
    public async evaluate(
        input: EvaluateVerdictInput,
        signal: AbortSignal
    ): Promise<VerdictDecision> {
        signal.throwIfAborted();
        const result = await this.modelAdapter.generateStructured(
            {
                systemPrompt: this.buildSystemPrompt(),
                userPrompt: this.buildUserPrompt(input),
                timeoutMs: this.options.timeoutMs,
                maxOutputTokens: this.options.maxOutputTokens
            },
            this.verdictSchema,
            signal
        );
        signal.throwIfAborted();
        this.requireCompleteCriteria(result.value, input);
        this.requireConsistentResult(result.value, input);
        return result.value;
    }

    /** 明确 PASS、FAIL 与证据不足之间的边界。 */
    private buildSystemPrompt(): string {
        return [
            '你是 AI Web 测试执行引擎的独立最终判定器。',
            '你不能规划或执行动作，也不能直接信任 Planner 的结束建议。',
            '只能根据 TestIntent 与最终 PageObservation 中真实出现的证据判断。',
            '逐条返回全部成功条件和失败条件，不能增加、删除或改写 criterionId。',
            'MATCHED 表示条件被当前证据明确满足，NOT_MATCHED 表示证据明确不满足，UNKNOWN 表示证据不足。',
            '只有所有 required 成功条件均 MATCHED，且失败条件均 NOT_MATCHED 时才能 PASS。',
            '只有至少一条失败条件 MATCHED 时才能 FAIL；其他情况必须 UNCERTAIN。',
            'Planner 的 FINISH、FAIL 或 UNCERTAIN 只作为停止原因，不决定最终结果。',
            '输出必须严格符合提供的 JSON Schema。'
        ].join('\n');
    }

    /** 只发送脱敏观察、动作摘要和条件，不发送环境变量实际值。 */
    private buildUserPrompt(input: EvaluateVerdictInput): string {
        const safeInput = {
            testIntent: input.testIntent,
            finalObservation: {
                page: input.observation.page,
                visibleText: input.observation.visibleText,
                interactiveElements: input.observation.interactiveElements.map(
                    (element) => ({
                        candidateId: element.candidateId,
                        tag: element.tag,
                        role: element.role,
                        name: element.name,
                        text: element.text,
                        label: element.label,
                        placeholder: element.placeholder,
                        valueState: element.valueState,
                        disabled: element.disabled,
                        visible: element.visible
                    })
                ),
                notices: input.observation.notices,
                stateFingerprint: input.observation.stateFingerprint,
                truncated: input.observation.truncated
            },
            history: input.history.map(toSafeHistoryEntry),
            stopCommand: toSafeCommand(input.stopCommand)
        };
        return [
            '请根据以下最终运行证据生成 VerdictDecision：',
            JSON.stringify(safeInput, null, 2)
        ].join('\n');
    }

    /** 要求判定器逐条覆盖 TestIntent 中的原始条件。 */
    private requireCompleteCriteria(
        decision: VerdictDecision,
        input: EvaluateVerdictInput
    ): void {
        requireSameCriterionIds(
            decision.successCriteria,
            input.testIntent.successCriteria.map((criterion) => criterion.id),
            '成功条件'
        );
        requireSameCriterionIds(
            decision.failureCriteria,
            input.testIntent.failureCriteria.map((criterion) => criterion.id),
            '失败条件'
        );
    }

    /** 阻止模型在条件判断与最终结果之间自相矛盾。 */
    private requireConsistentResult(
        decision: VerdictDecision,
        input: EvaluateVerdictInput
    ): void {
        const successById = new Map(
            decision.successCriteria.map((criterion) => [
                criterion.criterionId,
                criterion.status
            ])
        );
        const requiredSuccessMatched = input.testIntent.successCriteria
            .filter((criterion) => criterion.required)
            .every(
                (criterion) => successById.get(criterion.id) === 'MATCHED'
            );
        const failureMatched = decision.failureCriteria.some(
            (criterion) => criterion.status === 'MATCHED'
        );
        const everyFailureNotMatched = decision.failureCriteria.every(
            (criterion) => criterion.status === 'NOT_MATCHED'
        );

        if (
            decision.result === 'PASS' &&
            (!requiredSuccessMatched || !everyFailureNotMatched)
        ) {
            throw new Error('Verdict PASS 与条件判断不一致。');
        }
        if (decision.result === 'FAIL' && !failureMatched) {
            throw new Error('Verdict FAIL 缺少已匹配的失败条件。');
        }
        if (
            decision.result === 'UNCERTAIN' &&
            (failureMatched || requiredSuccessMatched && everyFailureNotMatched)
        ) {
            throw new Error('Verdict UNCERTAIN 与明确证据不一致。');
        }
    }
}

/** 历史动作只保留逻辑值引用和页面结果。 */
function toSafeHistoryEntry(entry: PlannerHistoryEntry) {
    return {
        command: toSafeCommand(entry.command),
        actionResult: entry.actionResult,
        effect: entry.effect,
        beforeObservationRef: entry.beforeObservationRef,
        afterObservationRef: entry.afterObservationRef
    };
}

/** 删除可能携带敏感字面量的动作值。 */
function toSafeCommand(command: ActionCommand): JsonValue {
    return {
        type: command.type,
        target: command.target
            ? {
                candidateId: command.target.candidateId ?? '',
                description: command.target.description
            }
            : null,
        value: command.value
            ? command.value.source === 'literal'
                ? {
                    source: 'literal',
                    value: '[REDACTED]'
                }
                : {
                    source: command.value.source,
                    key: command.value.key
                }
            : null,
        expectedEffect: command.expectedEffect ?? null,
        reasonSummary: command.reasonSummary,
        risk: command.risk
    };
}

/** 校验条件集合没有遗漏、重复或额外 ID。 */
function requireSameCriterionIds(
    assessments: CriterionAssessment[],
    expectedIds: string[],
    label: string
): void {
    const actualIds = assessments.map((assessment) => assessment.criterionId);
    if (
        new Set(actualIds).size !== actualIds.length ||
        actualIds.length !== expectedIds.length ||
        expectedIds.some((id) => !actualIds.includes(id))
    ) {
        throw new Error(`${ label }判断没有完整覆盖 TestIntent。`);
    }
}
