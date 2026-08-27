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
const ABSENCE_ONLY_FAILURE_PATTERN =
    /未找到|未发现|未出现|未显示|不存在|缺失|没有观察到|未见/iu;

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
        const exactDecision = this.applyExactTextAssertions(
            result.value,
            input
        );
        const decision = this.applyUncertainStopBoundary(
            exactDecision,
            input
        );
        this.requireCompleteCriteria(decision, input);
        this.requireConsistentResult(decision, input);
        return decision;
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
            '当 Planner 以 UNCERTAIN 停止时，表示执行尚未到达最终验证阶段；仅因最终目标尚未出现而描述的“未找到、未出现、不存在、缺失”等条件必须为 UNKNOWN，不能据此 FAIL。',
            '即使 Planner 以 UNCERTAIN 停止，页面明确显示账号密码错误等正向错误证据时，仍可将对应失败条件判为 MATCHED。',
            '精确文本断言必须逐字匹配，不能把近义词、缩写或扩展文案判为 MATCHED。',
            '输出必须严格符合提供的 JSON Schema。'
        ].join('\n');
    }

    /** 使用 DOM 文本进行程序级精确复核，并覆盖模型可能出现的宽松语义判断。 */
    private applyExactTextAssertions(
        decision: VerdictDecision,
        input: EvaluateVerdictInput
    ): VerdictDecision {
        const assertions = input.testIntent.exactTextAssertions ?? [];
        if (assertions.length === 0) {
            return decision;
        }

        const successCriteria = decision.successCriteria.map(
            (assessment) => ({ ...assessment })
        );
        const failureCriteria = decision.failureCriteria.map(
            (assessment) => ({ ...assessment })
        );
        const failures: string[] = [];
        const deferred: string[] = [];

        assertions.forEach((assertion) => {
            const match = matchExactVisibleText(
                input.observation.visibleText,
                assertion.values,
                assertion.ordered
            );
            const success = successCriteria.find(
                (item) => item.criterionId === assertion.successCriterionId
            );
            const failure = failureCriteria.find(
                (item) => item.criterionId === assertion.failureCriterionId
            );
            if (!success || !failure) {
                return;
            }
            if (match.matched) {
                success.status = 'MATCHED';
                success.summary = assertion.ordered
                    ? 'DOM 证据逐字包含全部目标文本且顺序一致。'
                    : 'DOM 证据逐字包含全部目标文本。';
                failure.status = 'NOT_MATCHED';
                failure.summary = '未发现精确文本缺失或文字差异。';
                return;
            }

            const detail = match.missing.length > 0
                ? `缺失精确文本：${ match.missing.join('、') }`
                : '精确文本的显示顺序不符合要求。';
            if (input.stopCommand.type === 'UNCERTAIN') {
                success.status = 'UNKNOWN';
                success.summary = `执行尚未到达可判定终态；${ detail }`;
                failure.status = 'UNKNOWN';
                failure.summary = `执行尚未到达可判定终态；${ detail }`;
                deferred.push(detail);
                return;
            }
            success.status = 'NOT_MATCHED';
            success.summary = detail;
            failure.status = 'MATCHED';
            failure.summary = detail;
            failures.push(detail);
        });

        const result = calculateResult(
            successCriteria,
            failureCriteria,
            input
        );
        return {
            ...decision,
            result,
            summary: failures.length > 0
                ? `严格文本断言失败：${ failures.join('；') }`
                : deferred.length > 0
                    ? `严格文本断言暂不可判定：${ deferred.join('；') }`
                    : decision.summary,
            successCriteria,
            failureCriteria
        };
    }

    /** 中途证据不足时，阻止“最终结果尚未出现”被误当成业务失败。 */
    private applyUncertainStopBoundary(
        decision: VerdictDecision,
        input: EvaluateVerdictInput
    ): VerdictDecision {
        if (input.stopCommand.type !== 'UNCERTAIN') {
            return decision;
        }
        let deferred = false;
        const successCriteria = decision.successCriteria.map((assessment) => {
            if (assessment.status !== 'NOT_MATCHED') {
                return { ...assessment };
            }
            deferred = true;
            return {
                ...assessment,
                status: 'UNKNOWN' as const,
                summary: `执行尚未到达最终验证阶段；${ assessment.summary }`
            };
        });
        const failureById = new Map(
            input.testIntent.failureCriteria.map((criterion) => [
                criterion.id,
                criterion
            ])
        );
        const failureCriteria = decision.failureCriteria.map((assessment) => {
            const criterion = failureById.get(assessment.criterionId);
            const evidenceText = [
                criterion?.description ?? '',
                assessment.summary
            ].join(' ');
            if (
                assessment.status !== 'MATCHED'
                || !ABSENCE_ONLY_FAILURE_PATTERN.test(evidenceText)
            ) {
                return { ...assessment };
            }
            deferred = true;
            return {
                ...assessment,
                status: 'UNKNOWN' as const,
                summary: `执行尚未到达最终验证阶段；${ assessment.summary }`
            };
        });
        if (!deferred) {
            return decision;
        }
        return {
            ...decision,
            result: calculateResult(
                successCriteria,
                failureCriteria,
                input
            ),
            summary: `执行在证据不足阶段结束，最终业务条件暂不可判定：${
                input.stopCommand.reasonSummary
            }`,
            successCriteria,
            failureCriteria
        };
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
                    value: command.type === 'NAVIGATE' &&
                        typeof command.value.value === 'string'
                        ? command.value.value
                        : '[REDACTED]'
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

/** 按 PageObservation 的 DOM 文本顺序进行完全相等匹配。 */
function matchExactVisibleText(
    visibleText: string[],
    expectedValues: string[],
    ordered: boolean
): {
    matched: boolean,
    missing: string[]
} {
    const remainingText = [...visibleText];
    const missing = expectedValues.filter((expected) => {
        const index = remainingText.findIndex((actual) => actual === expected);
        if (index < 0) {
            return true;
        }
        remainingText.splice(index, 1);
        return false;
    });
    if (missing.length > 0) {
        return {
            matched: false,
            missing
        };
    }
    if (!ordered) {
        return {
            matched: true,
            missing: []
        };
    }

    let cursor = 0;
    const orderedMatch = expectedValues.every((expected) => {
        const relativeIndex = visibleText
            .slice(cursor)
            .findIndex((actual) => actual === expected);
        if (relativeIndex < 0) {
            return false;
        }
        cursor += relativeIndex + 1;
        return true;
    });
    return {
        matched: orderedMatch,
        missing: []
    };
}

/** 在程序覆盖精确断言后重新计算最终业务结果。 */
function calculateResult(
    successCriteria: CriterionAssessment[],
    failureCriteria: CriterionAssessment[],
    input: EvaluateVerdictInput
): VerdictDecision['result'] {
    const successById = new Map(
        successCriteria.map((criterion) => [
            criterion.criterionId,
            criterion.status
        ])
    );
    const requiredMatched = input.testIntent.successCriteria
        .filter((criterion) => criterion.required)
        .every((criterion) => (
            successById.get(criterion.id) === 'MATCHED'
        ));
    if (failureCriteria.some((criterion) => (
        criterion.status === 'MATCHED'
    ))) {
        return 'FAIL';
    }
    if (
        requiredMatched
        && failureCriteria.every((criterion) => (
            criterion.status === 'NOT_MATCHED'
        ))
    ) {
        return 'PASS';
    }
    return 'UNCERTAIN';
}
