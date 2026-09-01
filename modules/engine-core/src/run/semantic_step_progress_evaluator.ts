import type {
    PagePerception,
    RecoveryPlanningView,
    SemanticStepProgress,
    SemanticStepProgressInput,
} from '../contracts';
import {
    hasMeaningfulPerceptionDelta,
} from '../contracts';

export interface StepProgressModelInput {
    step: {
        primaryAction: {
            type: string,
            targetDescription?: string,
            targetScope?: string,
            expectedEffect?: string,
            reasonSummary: string
        },
        expectedEffect?: string
    };
    attemptedActionType: string;
    before: RecoveryPlanningView;
    after: RecoveryPlanningView;
    localEffect?: {
        status: string,
        summary: string
    };
}

/** 模型只能给出进度分类，没有动作提议或执行权限。 */
export interface StepProgressModelPort {
    evaluate: (
        input: StepProgressModelInput,
        signal: AbortSignal
    ) => Promise<SemanticStepProgress>;
}

export interface SemanticStepProgressEvaluatorOptions {
    modelFallback?: StepProgressModelPort;
}

/** 先用确定性证据判断；CLICK/HOVER 证据不足时才允许 bounded fallback。 */
export class SemanticStepProgressEvaluator {
    constructor(
        private readonly options: SemanticStepProgressEvaluatorOptions = {}
    ) {}

    public async evaluate(
        input: SemanticStepProgressInput,
        signal: AbortSignal,
        allowModelFallback = false
    ): Promise<SemanticStepProgress> {
        const deterministic = this.evaluateDeterministically(input);
        const modelEligible = input.attemptedAction.type === 'CLICK'
            || input.attemptedAction.type === 'HOVER'
            || input.attemptedAction.type === 'WAIT'
                && Boolean(input.step.expectedEffect);
        if (
            deterministic.status !== 'unknown'
            || !allowModelFallback
            || !this.options.modelFallback
            || !modelEligible
        ) {
            return deterministic;
        }
        signal.throwIfAborted();
        const result = await this.options.modelFallback.evaluate(
            createStepProgressModelInput(input),
            signal
        );
        signal.throwIfAborted();
        return {
            ...result,
            basis: 'model'
        };
    }

    private evaluateDeterministically(
        input: SemanticStepProgressInput
    ): SemanticStepProgress {
        const evidence = input.effect?.evidence ?? [];
        if (input.actionResult && input.actionResult.status !== 'executed') {
            return progress('no-progress', '浏览器没有执行该动作。', evidence);
        }
        if (
            input.effect?.status === 'contradicted'
            || input.actionResult?.browserSignals.urlChanged &&
                input.attemptedAction.type === 'CLICK' &&
                input.before.dom.page.url === input.after.dom.page.url
        ) {
            return progress('wrong-state', '动作结果与预期方向矛盾。', evidence);
        }
        return this.evaluateExecutedAction(input, evidence);
    }

    private evaluateExecutedAction(
        input: SemanticStepProgressInput,
        evidence: SemanticStepProgress['evidence']
    ): SemanticStepProgress {
        if (isDeterministicControlAction(input.attemptedAction.type)) {
            return input.effect?.status === 'confirmed'
                ? progress('complete', '目标控件状态已确定达到要求。', evidence)
                : progress('no-progress', '目标控件状态未达到要求。', evidence);
        }
        const groundingImproved = isGroundingImproved(input);
        const changed = hasMeaningfulPerceptionDelta(input.after.delta);
        if (input.attemptedAction.type === 'WAIT') {
            if (!input.step.expectedEffect) {
                return input.effect?.status === 'confirmed'
                    ? progress('complete', '纯时间等待已经完成。', evidence)
                    : progress('no-progress', '浏览器没有完成等待动作。', evidence);
            }
            if (isTransientPerception(input.after)) {
                return progress(
                    'no-progress',
                    '等待后页面仍处于加载或搜索中的过渡状态。',
                    evidence
                );
            }
            if (hasBusinessWaitEvidence(input.step.expectedEffect, input.after)) {
                return progress(
                    'complete',
                    '等待后的稳定页面已出现 expectedEffect 对应业务状态。',
                    evidence
                );
            }
            return changed || groundingImproved
                ? progress('progress', '等待后页面出现了有意义变化。', evidence)
                : progress('unknown', '等待已完成，但业务终态证据不足。', evidence);
        }
        if (
            input.attemptedAction.type === 'CLICK'
            || input.attemptedAction.type === 'HOVER'
        ) {
            if (!input.step.expectedEffect) {
                return progress(
                    'unknown',
                    '缺少明确 expectedEffect，无法仅凭页面变化判定语义完成。',
                    evidence
                );
            }
            if (groundingImproved) {
                return progress('progress', '原始目标的定位状态已经改善。', evidence);
            }
            if (
                input.attemptedAction.type === 'CLICK'
                && input.after.delta?.urlChanged
                && hasExplicitTargetPageEvidence(
                    input.step.expectedEffect,
                    input.before,
                    input.after
                )
            ) {
                return progress(
                    'complete',
                    '页面内容明确匹配 expectedEffect 指定的目标页面。',
                    evidence
                );
            }
            return progress(
                'unknown',
                changed
                    ? '观察到局部变化，但不足以证明语义目标已经完成。'
                    : '未获得足够的语义效果证据。',
                evidence
            );
        }
        return progress(
            changed ? 'progress' : 'no-progress',
            changed ? '页面出现了有意义变化。' : '页面没有有意义变化。',
            evidence
        );
    }
}

function isTransientPerception(perception: PagePerception): boolean {
    return perception.dom.page.loading
        || perception.stability?.consistency !== 'consistent'
        || perception.stability.state !== 'stable'
        || perception.dom.visibleText.some((text) => (
            /搜索中|加载中|正在加载|请稍候|loading|searching/iu.test(text)
        ));
}

function hasBusinessWaitEvidence(
    expectedEffect: string,
    perception: PagePerception
): boolean {
    if (/稳定|加载完成|渲染完成/iu.test(expectedEffect)) {
        return true;
    }
    const visible = perception.dom.visibleText.join(' ');
    if (
        /搜索结果|无结果|搜索完成/iu.test(expectedEffect)
        && /搜索结果|没有.*结果|未找到|暂无.*(?:数据|内容)|共\s*\d+\s*条/iu
            .test(visible)
    ) {
        return true;
    }
    const quoted = [ ...expectedEffect.matchAll(/[“"]([^”"]+)[”"]/gu) ]
        .map((match) => match[1].trim())
        .filter((text) => text.length >= 2);
    return quoted.length > 0 && quoted.every((text) => visible.includes(text));
}

function hasExplicitTargetPageEvidence(
    expectedEffect: string | undefined,
    before: PagePerception,
    after: PagePerception
): boolean {
    if (!expectedEffect) {
        return false;
    }
    const title = after.dom.page.title.trim();
    const changedTitleMatches = before.dom.page.title !== after.dom.page.title
        && title.length >= 3
        && expectedEffect.includes(title);
    const addedTextMatches = (after.delta?.visibleText.added ?? [])
        .some((text) => {
            const normalized = text.trim();
            return normalized.length >= 3 && expectedEffect.includes(normalized);
        });
    return changedTitleMatches || addedTextMatches;
}

function isDeterministicControlAction(type: string): boolean {
    return type === 'TYPE' || type === 'CHECK' || type === 'SELECT';
}

/** 构建模型安全视图，刻意删除物理 id、locator、属性、bbox 与输入值。 */
export function createRecoveryPlanningView(
    perception: PagePerception
): RecoveryPlanningView {
    const blocked = Object.values(perception.interactionStates)
        .some((state) => state.hitTest === 'blocked');
    const known = Object.keys(perception.interactionStates).length > 0;
    return {
        page: {
            loading: perception.dom.page.loading,
            title: perception.dom.page.title,
            urlChanged: perception.delta?.urlChanged ?? false
        },
        visibleText: [ ...perception.dom.visibleText ],
        notices: structuredClone(perception.dom.notices),
        elements: perception.dom.interactiveElements.map((element) => ({
            ...element.role ? { role: element.role } : {},
            ...element.name ? { name: element.name } : {},
            ...element.text ? { text: element.text } : {},
            ...element.label ? { label: element.label } : {},
            ...element.placeholder ? { placeholder: element.placeholder } : {},
            ...element.visualDescription
                ? { visualDescription: element.visualDescription }
                : {},
            ...element.valueState ? { valueState: element.valueState } : {},
            disabled: element.disabled,
            ...element.checked === undefined ? {} : { checked: element.checked },
            visible: element.visible,
            inViewport: element.inViewport,
            nearbyText: [ ...element.nearbyText ]
        })),
        accessibility: perception.accessibility.nodes.map((node) => ({
            ...node.role ? { role: node.role } : {},
            ...node.name ? { name: node.name } : {},
            ...node.description ? { description: node.description } : {},
            ...node.disabled === undefined ? {} : { disabled: node.disabled },
            ...node.checked === undefined ? {} : { checked: node.checked },
            ...node.expanded === undefined ? {} : { expanded: node.expanded },
            ...node.selected === undefined ? {} : { selected: node.selected }
        })),
        ...perception.delta ? { delta: safeDelta(perception.delta) } : {},
        overlayState: blocked ? 'blocked' : known ? 'clear' : 'unknown'
    };
}

function createStepProgressModelInput(
    input: SemanticStepProgressInput
): StepProgressModelInput {
    return {
        step: {
            primaryAction: {
                type: input.step.primaryAction.type,
                ...input.step.primaryAction.target
                    ? {
                        targetDescription:
                            input.step.primaryAction.target.description,
                        ...input.step.primaryAction.target.scope
                            ? { targetScope: input.step.primaryAction.target.scope }
                            : {}
                    }
                    : {},
                ...input.step.primaryAction.expectedEffect
                    ? { expectedEffect: input.step.primaryAction.expectedEffect }
                    : {},
                reasonSummary: input.step.primaryAction.reasonSummary
            },
            ...input.step.expectedEffect
                ? { expectedEffect: input.step.expectedEffect }
                : {}
        },
        attemptedActionType: input.attemptedAction.type,
        before: createRecoveryPlanningView(input.before),
        after: createRecoveryPlanningView(input.after),
        ...input.effect
            ? {
                localEffect: {
                    status: input.effect.status,
                    summary: input.effect.summary
                }
            }
            : {}
    };
}

function safeDelta(delta: NonNullable<PagePerception['delta']>) {
    return {
        titleChanged: delta.titleChanged,
        urlChanged: delta.urlChanged,
        visibleTextAdded: [ ...delta.visibleText.added ],
        visibleTextRemoved: [ ...delta.visibleText.removed ],
        candidateCountChanged:
            delta.candidates.added.length !== delta.candidates.removed.length,
        accessibilityChanged:
            delta.accessibility.added.length > 0
            || delta.accessibility.changed.length > 0
            || delta.accessibility.removed.length > 0,
        overlayChanged: delta.overlayState.changed
    };
}

function isGroundingImproved(input: SemanticStepProgressInput): boolean {
    const before = input.primaryGroundingBefore?.status;
    const after = input.primaryGroundingAfter?.status;
    return after === 'grounded' && before !== 'grounded';
}

function progress(
    status: SemanticStepProgress['status'],
    summary: string,
    evidence: SemanticStepProgress['evidence']
): SemanticStepProgress {
    return {
        status,
        basis: 'deterministic',
        summary,
        evidence
    };
}
