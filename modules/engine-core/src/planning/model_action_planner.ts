import type {
    JsonValue,
    ObservedElement,
    PageObservation,
    SemanticAction,
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
        private readonly actionSchema: RuntimeSchema<SemanticAction>,
        private readonly options: ModelActionPlannerOptions = DEFAULT_OPTIONS
    ) {}

    /** 组装脱敏决策上下文并返回通过 Schema 校验的动作。 */
    public async plan(
        input: PlanActionInput,
        signal: AbortSignal
    ): Promise<SemanticAction> {
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
        this.requireKnownEnvironmentVariable(result.value, input);
        return result.value;
    }

    /** 定义 Planner 的单步、候选元素和敏感信息规则。 */
    private buildSystemPrompt(): string {
        return [
            '你是 AI Web 测试执行引擎的单步动作规划器。',
            '每次只能返回一个符合 SemanticAction Schema 的动作。',
            '结合 TestIntent、最新 PageObservation 和执行历史决定下一步。',
            '当前可执行的页面动作只有 TYPE、CLICK、HOVER、SELECT、CHECK 和 WAIT；不要返回其他非终止动作。',
            '当控件需要鼠标悬浮后才出现时，先对当前真实存在的父级、卡片或入口候选执行 HOVER；下一轮重新观察后，再点击新出现的真实候选。',
            '视觉增强候选的 visualDescription 是视觉模型根据候选框识别出的外观和用途，可用于理解无文本图标；若它与明确的 DOM 语义冲突，应返回 UNCERTAIN，不要猜测。',
            '登录流程应根据 valueState 依次填写未填写的账号和密码，再点击登录按钮。',
            'SELECT 必须引用真实下拉框候选元素，并用字符串字面量提供页面显示的精确选项文本。',
            'CHECK 必须引用真实复选框候选元素，并用布尔字面量明确期望的勾选状态。',
            'WAIT 只用于页面正在加载或等待明确的异步内容，使用 100～5000 毫秒整数字面量，禁止连续等待。',
            'target 只能描述业务语义目标，Phase 1 仅可用 scope 区分同名元素。',
            '不得输出 relation；空间关系将在后续感知阶段支持。',
            '优先沿用 observation 中可见的准确名称、标签或文本，不要改写成模糊同义词。',
            '不得输出 candidateId、Playwright API、CSS、XPath、坐标或 JavaScript。',
            '只要根据 TestIntent、当前目标和执行历史能够明确下一条业务动作，就必须输出对应 SemanticAction；即使 observation 暂时没有可定位元素，也要把业务目标交给 Grounder 使用 DOM、Accessibility 或视觉定位。',
            '不得仅因为 observation 缺少物理候选或无法定位目标而返回 UNCERTAIN。',
            'UNCERTAIN 只表示下一条业务语义动作本身不明确，或继续操作的业务安全性无法确定；它不表示物理定位失败。',
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

    /** 拒绝模型引用运行环境中不存在的逻辑变量。 */
    private requireKnownEnvironmentVariable(
        command: SemanticAction,
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
        tag: element.tag,
        role: element.role,
        name: element.name,
        text: element.text,
        label: element.label,
        placeholder: element.placeholder,
        discoverySource: element.discoverySource,
        visualDescription: element.visualDescription,
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
        semanticAction: redactActionValue(entry.semanticAction),
        actionResult: entry.actionResult,
        effect: entry.effect,
        beforeObservationRef: entry.beforeObservationRef,
        afterObservationRef: entry.afterObservationRef
    };
}

/** 防止字面量输入值通过历史再次进入模型上下文。 */
function redactActionValue(action: SemanticAction): JsonValue {
    return {
        type: action.type,
        ...(action.target
            ? {
                target: {
                    description: action.target.description,
                    ...action.target.scope
                        ? { scope: action.target.scope }
                        : {}
                }
            }
            : {}),
        ...(action.value
            ? {
                value: {
                    source: action.value.source,
                    ...('key' in action.value
                        ? {
                            key: action.value.key
                        }
                        : {
                            value: '[REDACTED]'
                        })
                }
            }
            : {}),
        expectedEffect: action.expectedEffect ?? '',
        reasonSummary: action.reasonSummary
    };
}
