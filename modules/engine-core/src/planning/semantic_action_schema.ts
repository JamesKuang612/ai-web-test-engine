import type {
    ActionType,
    JsonValue,
    SemanticAction,
    SemanticTarget,
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
const FIELDS = [
    'type',
    'target',
    'value',
    'expectedEffect',
    'reasonSummary'
];

const JSON_SCHEMA: Record<string, JsonValue> = {
    type: 'object',
    additionalProperties: false,
    required: FIELDS,
    properties: {
        type: {
            type: 'string',
            enum: [...ACTION_TYPES]
        },
        target: {
            anyOf: [{
                type: 'object',
                additionalProperties: false,
                required: ['description'],
                properties: {
                    description: { type: 'string', minLength: 1 },
                    scope: { type: 'string', minLength: 1 },
                    relation: { type: 'string', minLength: 1 }
                }
            }, { type: 'null' }]
        },
        value: {
            anyOf: [{
                type: 'object',
                additionalProperties: false,
                required: ['source', 'key'],
                properties: {
                    source: {
                        type: 'string',
                        enum: ['environment', 'generated']
                    },
                    key: { type: 'string', minLength: 1 }
                }
            }, {
                type: 'object',
                additionalProperties: false,
                required: ['source', 'value'],
                properties: {
                    source: { type: 'string', const: 'literal' },
                    value: {
                        type: ['string', 'number', 'boolean', 'null']
                    }
                }
            }, { type: 'null' }]
        },
        expectedEffect: {
            type: ['string', 'null'],
            minLength: 1
        },
        reasonSummary: {
            type: 'string',
            minLength: 1
        }
    }
};

/** 表示模型返回的语义动作不符合职责边界或动作约束。 */
export class SemanticActionSchemaError extends Error {
    constructor(public readonly path: string, message: string) {
        super(`${ path }：${ message }`);
        this.name = 'SemanticActionSchemaError';
    }
}

/** Planner 专用 Schema；其中刻意不存在 candidateId 和 risk。 */
export const semanticActionSchema: RuntimeSchema<SemanticAction> = {
    name: 'SemanticAction',
    jsonSchema: JSON_SCHEMA,
    parse: parseSemanticAction
};

function parseSemanticAction(value: unknown): SemanticAction {
    const object = requireObject(value, 'SemanticAction');
    requireAllowedFields(object, FIELDS, 'SemanticAction');
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
        ...target ? { target } : {},
        ...actionValue ? { value: actionValue } : {},
        ...object.expectedEffect === undefined
            || object.expectedEffect === null
            ? {}
            : {
                expectedEffect: requireNonEmptyString(
                    object.expectedEffect,
                    'SemanticAction.expectedEffect'
                )
            },
        reasonSummary: requireNonEmptyString(
            object.reasonSummary,
            'SemanticAction.reasonSummary'
        )
    };
}

function parseTarget(value: unknown): SemanticTarget {
    const path = 'SemanticAction.target';
    const object = requireObject(value, path);
    requireAllowedFields(object, [
        'description',
        'scope',
        'relation'
    ], path);
    return {
        description: requireNonEmptyString(
            object.description,
            `${ path }.description`
        ),
        ...object.scope === undefined
            ? {}
            : { scope: requireNonEmptyString(object.scope, `${ path }.scope`) },
        ...object.relation === undefined
            ? {}
            : {
                relation: requireNonEmptyString(
                    object.relation,
                    `${ path }.relation`
                )
            }
    };
}

function requireActionFields(
    type: ActionType,
    target: SemanticTarget | undefined,
    value: ValueReference | undefined
): void {
    requireTargetAndValue(type, target, value);
    requireCheckValue(type, value);
    requireWaitValue(type, target, value);
    requireTerminalShape(type, target, value);
}

function requireTargetAndValue(
    type: ActionType,
    target: SemanticTarget | undefined,
    value: ValueReference | undefined
): void {
    if (TARGET_ACTIONS.has(type) && !target) {
        throw new SemanticActionSchemaError(
            'SemanticAction.target',
            `${ type } 必须提供语义目标`
        );
    }
    if (VALUE_ACTIONS.has(type) && !value) {
        throw new SemanticActionSchemaError(
            'SemanticAction.value',
            `${ type } 必须提供输入值引用`
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
        throw new SemanticActionSchemaError(
            'SemanticAction.value',
            'CHECK 必须提供布尔字面量'
        );
    }
}

function requireWaitValue(
    type: ActionType,
    target: SemanticTarget | undefined,
    value: ValueReference | undefined
): void {
    if (type === 'WAIT') {
        const duration = value?.source === 'literal' ? value.value : undefined;
        if (
            target
            || typeof duration !== 'number'
            || !Number.isInteger(duration)
            || duration < 100
            || duration > 5_000
        ) {
            throw new SemanticActionSchemaError(
                'SemanticAction.value',
                'WAIT 必须提供 100～5000 毫秒整数且不能携带目标'
            );
        }
    }
}

function requireTerminalShape(
    type: ActionType,
    target: SemanticTarget | undefined,
    value: ValueReference | undefined
): void {
    if (
        (type === 'FINISH' || type === 'FAIL')
        && (target || value)
    ) {
        throw new SemanticActionSchemaError(
            'SemanticAction',
            `${ type } 不能携带 target 或 value`
        );
    }
    if (type === 'UNCERTAIN' && value) {
        throw new SemanticActionSchemaError(
            'SemanticAction.value',
            'UNCERTAIN 不能携带 value'
        );
    }
}

function parseValueReference(value: unknown): ValueReference {
    const path = 'SemanticAction.value';
    const object = requireObject(value, path);
    const source = requireNonEmptyString(object.source, `${ path }.source`);
    if (source === 'literal') {
        requireAllowedFields(object, ['source', 'value'], path);
        if (!('value' in object)) {
            throw new SemanticActionSchemaError(`${ path }.value`, '缺少必填字段');
        }
        return {
            source,
            value: requireJsonValue(object.value, `${ path }.value`)
        };
    }
    if (source === 'environment' || source === 'generated') {
        requireAllowedFields(object, ['source', 'key'], path);
        return {
            source,
            key: requireNonEmptyString(object.key, `${ path }.key`)
        };
    }
    throw new SemanticActionSchemaError(
        `${ path }.source`,
        `不支持的数据来源：${ source }`
    );
}

function requireActionType(value: unknown): ActionType {
    const result = requireNonEmptyString(value, 'SemanticAction.type');
    if (!ACTION_TYPES.has(result as ActionType)) {
        throw new SemanticActionSchemaError(
            'SemanticAction.type',
            `不支持的动作类型：${ result }`
        );
    }
    return result as ActionType;
}

function requireObject(
    value: unknown,
    path: string
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new SemanticActionSchemaError(path, '必须是对象');
    }
    return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new SemanticActionSchemaError(path, '必须是非空字符串');
    }
    return value;
}

function requireJsonValue(value: unknown, path: string): JsonValue {
    if (
        value === null
        || typeof value === 'boolean'
        || typeof value === 'string'
    ) {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) =>
            requireJsonValue(item, `${ path }[${ index }]`)
        );
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            requireJsonValue(item, `${ path }.${ key }`)
        ]));
    }
    throw new SemanticActionSchemaError(path, '必须是合法 JSON 值');
}

function requireAllowedFields(
    value: Record<string, unknown>,
    allowedFields: string[],
    path: string
): void {
    const allowed = new Set(allowedFields);
    Object.keys(value).forEach((field) => {
        if (!allowed.has(field)) {
            throw new SemanticActionSchemaError(
                `${ path }.${ field }`,
                '不允许出现该字段'
            );
        }
    });
}
