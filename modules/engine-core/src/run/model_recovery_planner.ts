import type {
    RecoveryAction,
    RecoveryDecision,
    RecoveryPlannerInput,
    SemanticTarget,
} from '../contracts';
import type {
    ModelAdapter,
    RuntimeSchema,
} from '../ports';
import type {
    RecoveryPlannerPort,
} from './recovery_ports';

export interface ModelRecoveryPlannerOptions {
    maxOutputTokens: number;
    timeoutMs: number;
}

const DEFAULT_OPTIONS: ModelRecoveryPlannerOptions = {
    maxOutputTokens: 800,
    timeoutMs: 30_000
};

/** 只在 deterministic rules 没有答案时提出 semantic recovery。 */
export class ModelRecoveryPlanner implements RecoveryPlannerPort {
    constructor(
        private readonly modelAdapter: ModelAdapter,
        private readonly options: ModelRecoveryPlannerOptions = DEFAULT_OPTIONS
    ) {}

    public async plan(
        input: RecoveryPlannerInput,
        signal: AbortSignal
    ): Promise<RecoveryDecision> {
        const result = await this.modelAdapter.generateStructured({
            systemPrompt: [
                '你是 Web 测试单步恢复规划器，不是主任务规划器。',
                '原始 primaryAction 永远不变；只能提出低风险、可逆、临时状态恢复。',
                '只能使用 allowedCapabilities；不得输出 candidateId、DOM id、Locator、CSS、XPath、坐标、像素、JavaScript 或真实输入值。',
                '不得提出删除、发布、支付、发送、提交、保存、创建额外数据或修改权限。',
                'SCROLL 只能使用 up/down 与 small/medium/page。',
                '如果没有安全恢复，返回 stop。'
            ].join('\n'),
            userPrompt: JSON.stringify(input, null, 2),
            timeoutMs: this.options.timeoutMs,
            maxOutputTokens: this.options.maxOutputTokens
        }, recoveryDecisionSchema, signal);
        return result.value;
    }
}

const recoveryDecisionSchema: RuntimeSchema<RecoveryDecision> = {
    name: 'RecoveryDecision',
    jsonSchema: {
        oneOf: [
            {
                type: 'object',
                additionalProperties: false,
                required: [ 'kind', 'action' ],
                properties: {
                    kind: { const: 'recover' },
                    action: {
                        type: 'object',
                        additionalProperties: false,
                        required: [ 'type', 'reasonSummary' ],
                        properties: {
                            type: {
                                enum: [
                                    'CLEAR', 'CLICK', 'HOVER', 'SCROLL',
                                    'WAIT', 'BACK', 'REOBSERVE'
                                ]
                            },
                            target: {
                                type: 'object',
                                additionalProperties: false,
                                required: [ 'description' ],
                                properties: {
                                    description: { type: 'string' },
                                    scope: { type: 'string' }
                                }
                            },
                            direction: { enum: [ 'up', 'down' ] },
                            amount: { enum: [ 'small', 'medium', 'page' ] },
                            duration: { enum: [ 'short', 'medium' ] },
                            expectedTransientEffect: { type: 'string' },
                            reasonSummary: { type: 'string' }
                        }
                    }
                }
            },
            {
                type: 'object',
                additionalProperties: false,
                required: [ 'kind', 'reason' ],
                properties: {
                    kind: { const: 'stop' },
                    reason: { type: 'string' }
                }
            }
        ]
    },
    parse: parseRecoveryDecision
};

function parseRecoveryDecision(value: unknown): RecoveryDecision {
    const object = requireObject(value, 'RecoveryDecision');
    if (object.kind === 'stop') {
        requireFields(object, [ 'kind', 'reason' ], 'RecoveryDecision');
        return {
            kind: 'stop',
            reason: requireString(object.reason, 'RecoveryDecision.reason')
        };
    }
    if (object.kind !== 'recover') {
        throw new Error('RecoveryDecision.kind 必须是 recover 或 stop。');
    }
    requireFields(object, [ 'kind', 'action' ], 'RecoveryDecision');
    return {
        kind: 'recover',
        action: parseRecoveryAction(object.action)
    };
}

function parseRecoveryAction(value: unknown): RecoveryAction {
    const object = requireObject(value, 'RecoveryDecision.action');
    const type = requireString(object.type, 'RecoveryDecision.action.type');
    const common = {
        ...object.expectedTransientEffect === undefined
            ? {}
            : {
                expectedTransientEffect: requireString(
                    object.expectedTransientEffect,
                    'RecoveryDecision.action.expectedTransientEffect'
                )
            },
        reasonSummary: requireString(
            object.reasonSummary,
            'RecoveryDecision.action.reasonSummary'
        )
    };
    if (type === 'CLEAR' || type === 'CLICK' || type === 'HOVER') {
        requireFields(object, [
            'type', 'target', 'expectedTransientEffect', 'reasonSummary'
        ], 'RecoveryDecision.action', true);
        return { type, target: parseTarget(object.target), ...common };
    }
    if (type === 'SCROLL') {
        requireFields(object, [
            'type', 'direction', 'amount', 'expectedTransientEffect',
            'reasonSummary'
        ], 'RecoveryDecision.action', true);
        return {
            type,
            direction: requireEnum(object.direction, [ 'up', 'down' ]),
            amount: requireEnum(
                object.amount,
                [ 'small', 'medium', 'page' ]
            ),
            ...common
        };
    }
    if (type === 'WAIT') {
        requireFields(object, [
            'type', 'duration', 'expectedTransientEffect', 'reasonSummary'
        ], 'RecoveryDecision.action', true);
        return {
            type,
            duration: requireEnum(object.duration, [ 'short', 'medium' ]),
            ...common
        };
    }
    if (type === 'BACK' || type === 'REOBSERVE') {
        requireFields(object, [
            'type', 'expectedTransientEffect', 'reasonSummary'
        ], 'RecoveryDecision.action', true);
        return { type, ...common };
    }
    throw new Error(`不支持的 RecoveryAction：${ type }`);
}

function parseTarget(value: unknown): SemanticTarget {
    const object = requireObject(value, 'RecoveryDecision.action.target');
    requireFields(object, [ 'description', 'scope' ],
        'RecoveryDecision.action.target', true);
    return {
        description: requireString(
            object.description,
            'RecoveryDecision.action.target.description'
        ),
        ...object.scope === undefined
            ? {}
            : { scope: requireString(object.scope, 'target.scope') }
    };
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${ path } 必须是对象。`);
    }
    return value as Record<string, unknown>;
}

function requireFields(
    object: Record<string, unknown>,
    fields: string[],
    path: string,
    optionalAllowed = false
): void {
    const unexpected = Object.keys(object).find((key) => !fields.includes(key));
    if (unexpected) {
        throw new Error(`${ path }.${ unexpected } 不允许出现。`);
    }
    if (!optionalAllowed) {
        const missing = fields.find((field) => !(field in object));
        if (missing) {
            throw new Error(`${ path }.${ missing } 缺失。`);
        }
    }
}

function requireString(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${ path } 必须是非空字符串。`);
    }
    return value;
}

function requireEnum<T extends string>(value: unknown, allowed: T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new Error(`值不在允许集合中：${ String(value) }`);
    }
    return value as T;
}
