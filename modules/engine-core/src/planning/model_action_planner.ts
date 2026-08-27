import type {
    ActionCommand,
    JsonValue,
    ObservedElement,
    PageObservation,
} from '../contracts';
import type {
    ModelAdapter,
    RuntimeSchema,
} from '../ports';
import type {
    ActionPlanner,
    PlanActionInput,
    PlannerHistoryEntry,
} from './action_planner';

export interface ModelActionPlannerOptions {
    maxOutputTokens: number;
    timeoutMs: number;
}

const DEFAULT_OPTIONS: ModelActionPlannerOptions = {
    maxOutputTokens: 1_200,
    timeoutMs: 30_000
};

/** 使用结构化模型调用，根据当前页面生成唯一下一步动作。 */
export class ModelActionPlanner implements ActionPlanner {
    /** 注入模型边界、动作 Schema 和调用预算。 */
    constructor(
        private readonly modelAdapter: ModelAdapter,
        private readonly actionSchema: RuntimeSchema<ActionCommand>,
        private readonly options: ModelActionPlannerOptions = DEFAULT_OPTIONS
    ) {}

    /** 组装脱敏决策上下文并返回通过 Schema 校验的动作。 */
    public async plan(
        input: PlanActionInput,
        signal: AbortSignal
    ): Promise<ActionCommand> {
        signal.throwIfAborted();
        const result = await this.modelAdapter.generateStructured(
            {
                systemPrompt: this.buildSystemPrompt(),
                userPrompt: this.buildUserPrompt(input),
                timeoutMs: this.options.timeoutMs,
                maxOutputTokens: this.options.maxOutputTokens
            },
            this.actionSchema,
            signal
        );
        signal.throwIfAborted();
        this.requireKnownCandidate(result.value, input.observation);
        this.requireKnownEnvironmentVariable(result.value, input);
        return result.value;
    }

    /** 定义 Planner 的单步、候选元素和敏感信息规则。 */
    private buildSystemPrompt(): string {
        return [
            '你是 AI Web 测试执行引擎的单步动作规划器。',
            '每次只能返回一个符合 ActionCommand Schema 的动作。',
            '结合 TestIntent、最新 PageObservation 和执行历史决定下一步。',
            '当前可执行的页面动作只有 TYPE、CLICK、SELECT、CHECK 和 WAIT；不要返回其他非终止动作。',
            '登录流程应根据 valueState 依次填写未填写的账号和密码，再点击登录按钮。',
            'SELECT 必须引用真实下拉框候选元素，并用字符串字面量提供页面显示的精确选项文本。',
            'CHECK 必须引用真实复选框候选元素，并用布尔字面量明确期望的勾选状态。',
            'WAIT 只用于页面正在加载或等待明确的异步内容，使用 100～5000 毫秒整数字面量，禁止连续等待。',
            '操作页面元素时只能引用 observation 中真实存在的 candidateId。',
            '不得输出 Playwright API、CSS、XPath 或 JavaScript。',
            '无法唯一确定目标时返回 UNCERTAIN，禁止猜测 candidateId。',
            '环境变量只能引用 availableEnvironmentVariables 中的逻辑名称。',
            '不得输出账号、密码、令牌等敏感值。',
            '页面已经满足目标时返回 FINISH；出现明确失败证据时返回 FAIL；证据不足且无法继续时返回 UNCERTAIN。',
            'FINISH 只表示建议结束，不代表最终测试结果为 PASS。'
        ].join('\n');
    }

    /** 将领域状态压缩为不包含本机密钥和值的模型输入。 */
    private buildUserPrompt(input: PlanActionInput): string {
        const safeInput = {
            testIntent: input.testIntent,
            observation: toSafeObservation(input.observation),
            history: input.history.map(toSafeHistoryEntry),
            availableEnvironmentVariables:
                [...input.availableEnvironmentVariables],
            remainingBudgets: input.remainingBudgets
        };
        return [
            '请生成当前页面的下一条动作：',
            JSON.stringify(safeInput, null, 2)
        ].join('\n');
    }

    /** 拒绝模型虚构或引用过期的候选元素。 */
    private requireKnownCandidate(
        command: ActionCommand,
        observation: PageObservation
    ): void {
        const candidateId = command.target?.candidateId;
        if (
            candidateId &&
            !observation.interactiveElements.some(
                (element) => element.candidateId === candidateId
            )
        ) {
            throw new Error(`Planner 返回了未知 candidateId：${ candidateId }`);
        }
    }

    /** 拒绝模型引用运行环境中不存在的逻辑变量。 */
    private requireKnownEnvironmentVariable(
        command: ActionCommand,
        input: PlanActionInput
    ): void {
        if (
            command.value?.source === 'environment' &&
            !input.availableEnvironmentVariables.includes(command.value.key)
        ) {
            throw new Error(
                `Planner 返回了未知环境变量：${ command.value.key }`
            );
        }
    }
}

/** 只向模型暴露语义化元素信息，不暴露底层 Locator 或原始属性。 */
function toSafeObservation(observation: PageObservation) {
    return {
        observationId: observation.observationId,
        page: observation.page,
        visibleText: observation.visibleText,
        interactiveElements:
            observation.interactiveElements.map(toSafeElement),
        notices: observation.notices,
        tabs: observation.tabs,
        stateFingerprint: observation.stateFingerprint,
        truncated: observation.truncated
    };
}

/** 压缩一个候选元素，避免将定位实现细节发送给模型。 */
function toSafeElement(element: ObservedElement) {
    return {
        candidateId: element.candidateId,
        tag: element.tag,
        role: element.role,
        name: element.name,
        text: element.text,
        label: element.label,
        placeholder: element.placeholder,
        valueState: element.valueState,
        disabled: element.disabled,
        checked: element.checked,
        visible: element.visible,
        inViewport: element.inViewport,
        nearbyText: element.nearbyText,
        boundingBox: element.boundingBox
    };
}

/** 历史只保留动作摘要、状态和证据引用。 */
function toSafeHistoryEntry(entry: PlannerHistoryEntry) {
    return {
        command: redactCommandValue(entry.command),
        actionResult: entry.actionResult,
        effect: entry.effect,
        beforeObservationRef: entry.beforeObservationRef,
        afterObservationRef: entry.afterObservationRef
    };
}

/** 防止字面量输入值通过历史再次进入模型上下文。 */
function redactCommandValue(command: ActionCommand): JsonValue {
    return {
        type: command.type,
        ...(command.target
            ? {
                target: {
                    candidateId: command.target.candidateId ?? '',
                    description: command.target.description
                }
            }
            : {}),
        ...(command.value
            ? {
                value: {
                    source: command.value.source,
                    ...('key' in command.value
                        ? {
                            key: command.value.key
                        }
                        : {
                            value: '[REDACTED]'
                        })
                }
            }
            : {}),
        expectedEffect: command.expectedEffect ?? '',
        reasonSummary: command.reasonSummary,
        risk: command.risk
    };
}
