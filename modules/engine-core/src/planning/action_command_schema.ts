import type {
    ActionCommand,
    ActionType,
    JsonValue,
    TargetDescription,
    ValueReference,
} from '../contracts';
import type {
    RuntimeSchema,
} from '../ports';

const ACTION_TYPES = new Set<ActionType>([
    'BACK',
    'CHECK',
    'CLICK',
    'FAIL',
    'FINISH',
    'HOVER',
    'INSPECT',
    'NAVIGATE',
    'SCROLL',
    'SELECT',
    'TYPE',
    'UNCERTAIN',
    'WAIT'
]);
const TARGET_ACTIONS = new Set<ActionType>([
    'CHECK',
    'CLICK',
    'HOVER',
    'INSPECT',
    'SCROLL',
    'SELECT',
    'TYPE'
]);
const VALUE_ACTIONS = new Set<ActionType>([
    'CHECK',
    'SELECT',
    'TYPE'
]);

const ACTION_COMMAND_FIELDS = [
    'type',
    'target',
    'value',
    'expectedEffect',
    'reasonSummary',
    'risk'
];

const ACTION_COMMAND_JSON_SCHEMA: Record<string, JsonValue> = {
    type: 'object',
    additionalProperties: false,
    required: ACTION_COMMAND_FIELDS,
    properties: {
        type: {
            type: 'string',
            enum: [...ACTION_TYPES]
        },
        target: {
            anyOf: [
                {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'candidateId',
                        'description'
                    ],
                    properties: {
                        candidateId: {
                            type: [
                                'string',
                                'null'
                            ],
                            minLength: 1
                        },
                        description: {
                            type: 'string',
                            minLength: 1
                        }
                    }
                },
                {
                    type: 'null'
                }
            ]
        },
        value: {
            anyOf: [
                {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'source',
                        'key'
                    ],
                    properties: {
                        source: {
                            type: 'string',
                            enum: [
                                'environment',
                                'generated'
                            ]
                        },
                        key: {
                            type: 'string',
                            minLength: 1
                        }
                    }
                },
                {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'source',
                        'value'
                    ],
                    properties: {
                        source: {
                            type: 'string',
                            const: 'literal'
                        },
                        value: {
                            type: [
                                'string',
                                'number',
                                'boolean',
                                'null'
                            ]
                        }
                    }
                },
                {
                    type: 'null'
                }
            ]
        },
        expectedEffect: {
            type: [
                'string',
                'null'
            ],
            minLength: 1
        },
        reasonSummary: {
            type: 'string',
            minLength: 1
        },
        risk: {
            type: 'string',
            enum: [
                'read-only',
                'reversible',
                'side-effect'
            ]
        }
    }
};

/** 表示模型返回的单步动作不符合运行时契约。 */
export class ActionCommandSchemaError extends Error {
    /** 记录错误字段路径，便于定位 Planner 输出问题。 */
    constructor(
        public readonly path: string,
        message: string
    ) {
        super(`${ path }：${ message }`);
        this.name = 'ActionCommandSchemaError';
    }
}

/** 约束并解析 Planner 每轮返回的唯一动作。 */
export const actionCommandSchema: RuntimeSchema<ActionCommand> = {
    name: 'ActionCommand',
    jsonSchema: ACTION_COMMAND_JSON_SCHEMA,
    parse: parseActionCommand
};

/** 严格解析模型输出，并执行动作类型相关的交叉字段校验。 */
function parseActionCommand(value: unknown): ActionCommand {
    const object = requireObject(value, 'ActionCommand');
    requireAllowedFields(object, ACTION_COMMAND_FIELDS, 'ActionCommand');

    const type = requireActionType(object.type);
    const target = object.target === undefined || object.target === null
        ? undefined
        : parseTarget(object.target);
    const actionValue = object.value === undefined || object.value === null
        ? undefined
        : parseValueReference(object.value);

    requireActionFields(type, target, actionValue);

    return {
        type,
        ...(target
            ? {
                target
            }
            : {}),
        ...(actionValue
            ? {
                value: actionValue
            }
            : {}),
        ...(
            object.expectedEffect === undefined ||
            object.expectedEffect === null
            ? {}
            : {
                expectedEffect: requireNonEmptyString(
                    object.expectedEffect,
                    'ActionCommand.expectedEffect'
                )
            }),
        reasonSummary: requireNonEmptyString(
            object.reasonSummary,
            'ActionCommand.reasonSummary'
        ),
        risk: requireRisk(object.risk)
    };
}

/** 校验需要目标或输入值的动作没有缺少必要字段。 */
function requireActionFields(
    type: ActionType,
    target: TargetDescription | undefined,
    value: ValueReference | undefined
): void {
    if (TARGET_ACTIONS.has(type) && !target?.candidateId) {
        throw new ActionCommandSchemaError(
            'ActionCommand.target.candidateId',
            `${ type } 必须引用 PageObservation 中的 candidateId`
        );
    }
    if (VALUE_ACTIONS.has(type) && !value) {
        throw new ActionCommandSchemaError(
            'ActionCommand.value',
            `${ type } 必须提供输入值引用`
        );
    }
    requireCheckValue(type, value);
    requireWaitShape(type, target, value);
    if ((type === 'FINISH' || type === 'FAIL') && (target || value)) {
        throw new ActionCommandSchemaError(
            'ActionCommand',
            `${ type } 不能携带 target 或 value`
        );
    }
    if (type === 'UNCERTAIN' && (target?.candidateId || value)) {
        throw new ActionCommandSchemaError(
            'ActionCommand',
            'UNCERTAIN 只能携带不含 candidateId 的语义目标，且不能携带 value'
        );
    }
}

function requireCheckValue(
    type: ActionType,
    value: ValueReference | undefined
): void {
    if (
        type === 'CHECK'
        && (value?.source !== 'literal' || typeof value.value !== 'boolean')
    ) {
        throw new ActionCommandSchemaError(
            'ActionCommand.value',
            'CHECK 必须提供布尔字面量表示期望勾选状态'
        );
    }
}

function requireWaitShape(
    type: ActionType,
    target: TargetDescription | undefined,
    value: ValueReference | undefined
): void {
    if (type !== 'WAIT') {
        return;
    }
    const durationMs = value?.source === 'literal'
        ? value.value
        : undefined;
    if (
        target
        || typeof durationMs !== 'number'
        || !Number.isInteger(durationMs)
        || durationMs < 100
        || durationMs > 5_000
    ) {
        throw new ActionCommandSchemaError(
            'ActionCommand.value',
            'WAIT 必须提供 100～5000 毫秒的整数字面量且不能携带目标'
        );
    }
}

/** 解析模型选择的候选元素引用。 */
function parseTarget(value: unknown): TargetDescription {
    const path = 'ActionCommand.target';
    const object = requireObject(value, path);
    requireAllowedFields(object, [
        'candidateId',
        'description'
    ], path);

    return {
        ...(
            object.candidateId === undefined ||
            object.candidateId === null
            ? {}
            : {
                candidateId: requireNonEmptyString(
                    object.candidateId,
                    `${ path }.candidateId`
                )
            }),
        description: requireNonEmptyString(
            object.description,
            `${ path }.description`
        )
    };
}

/** 解析环境变量、生成值或安全字面量引用。 */
function parseValueReference(value: unknown): ValueReference {
    const path = 'ActionCommand.value';
    const object = requireObject(value, path);
    const source = requireNonEmptyString(object.source, `${ path }.source`);

    if (source === 'literal') {
        requireAllowedFields(object, [
            'source',
            'value'
        ], path);
        if (!('value' in object)) {
            throw new ActionCommandSchemaError(
                `${ path }.value`,
                '缺少必填字段'
            );
        }
        return {
            source,
            value: requireJsonValue(object.value, `${ path }.value`)
        };
    }
    if (source === 'environment' || source === 'generated') {
        requireAllowedFields(object, [
            'source',
            'key'
        ], path);
        return {
            source,
            key: requireNonEmptyString(object.key, `${ path }.key`)
        };
    }
    throw new ActionCommandSchemaError(
        `${ path }.source`,
        `不支持的数据来源：${ source }`
    );
}

/** 将未知值校验为领域允许的动作类型。 */
function requireActionType(value: unknown): ActionType {
    const type = requireNonEmptyString(value, 'ActionCommand.type');
    if (!ACTION_TYPES.has(type as ActionType)) {
        throw new ActionCommandSchemaError(
            'ActionCommand.type',
            `不支持的动作类型：${ type }`
        );
    }
    return type as ActionType;
}

/** 将未知值校验为动作风险等级。 */
function requireRisk(value: unknown): ActionCommand['risk'] {
    const risk = requireNonEmptyString(value, 'ActionCommand.risk');
    if (
        risk !== 'read-only' &&
        risk !== 'reversible' &&
        risk !== 'side-effect'
    ) {
        throw new ActionCommandSchemaError(
            'ActionCommand.risk',
            `不支持的风险等级：${ risk }`
        );
    }
    return risk;
}

/** 将未知值校验为普通对象。 */
function requireObject(
    value: unknown,
    path: string
): Record<string, unknown> {
    if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
    ) {
        throw new ActionCommandSchemaError(path, '必须是对象');
    }
    return value as Record<string, unknown>;
}

/** 将未知值校验为非空字符串。 */
function requireNonEmptyString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ActionCommandSchemaError(path, '必须是非空字符串');
    }
    return value;
}

/** 递归校验模型给出的字面量可以安全序列化为 JSON。 */
function requireJsonValue(value: unknown, path: string): JsonValue {
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string'
    ) {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => requireJsonValue(
            item,
            `${ path }[${ index }]`
        ));
    }
    if (typeof value === 'object') {
        const result: Record<string, JsonValue> = {};
        Object.entries(value).forEach(([key, item]) => {
            result[key] = requireJsonValue(item, `${ path }.${ key }`);
        });
        return result;
    }
    throw new ActionCommandSchemaError(path, '必须是合法 JSON 值');
}

/** 拒绝契约外字段，避免模型悄悄扩展动作语义。 */
function requireAllowedFields(
    value: Record<string, unknown>,
    allowedFields: string[],
    path: string
): void {
    const allowed = new Set(allowedFields);
    Object.keys(value).forEach((field) => {
        if (!allowed.has(field)) {
            throw new ActionCommandSchemaError(
                `${ path }.${ field }`,
                '不允许出现该字段'
            );
        }
    });
}
