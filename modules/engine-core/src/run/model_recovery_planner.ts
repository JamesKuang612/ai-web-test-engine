import type {
    JsonValue,
    RecoveryAction,
    RecoveryDecision,
    RecoveryPlannerInput,
    SemanticTarget,
} from '../contracts';
import type {
    ModelProtocolDiagnostic,
    ModelAdapter,
    ModelRequest,
    RuntimeSchema,
} from '../ports';
import {
    ClassifiedModelFailure,
    RuntimeSchemaValidationError,
} from '../ports';
import type {
    RecoveryPlannerAttempt,
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
    ): Promise<RecoveryPlannerAttempt> {
        return await this.generate({
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
            maxOutputTokens: this.options.maxOutputTokens,
            modelRole: 'recovery-planner',
            protocolPhase: 'initial'
        }, signal);
    }

    public repairProtocol = async (
        diagnostic: ModelProtocolDiagnostic,
        signal: AbortSignal
    ): Promise<RecoveryPlannerAttempt> => {
        const guard = createSemanticRepairGuard(diagnostic.parsedJson);
        if (!guard) {
            return unavailableRepair(
                diagnostic,
                '原始 Recovery strategy identity 无法确定，禁止协议修复。'
            );
        }
        const repaired = await this.generate({
            systemPrompt: [
                '你只负责修复 RecoveryDecision JSON 的协议结构。',
                '不得重新规划策略，不得改变原动作意图、目标或理由。',
                '仅根据校验错误调整字段、null 和对象结构。',
                '只输出符合给定 JSON Schema 的 JSON。'
            ].join('\n'),
            userPrompt: JSON.stringify({
                originalDecision: diagnostic.parsedJson ??
                    diagnostic.rawOutputPreview,
                schemaIssues: diagnostic.schemaIssues
            }, null, 2),
            timeoutMs: this.options.timeoutMs,
            maxOutputTokens: this.options.maxOutputTokens,
            modelRole: 'recovery-planner',
            protocolPhase: 'repair'
        }, signal);
        if (repaired.status !== 'decision') {
            return repaired;
        }
        const changedPaths = changedSemanticPaths(guard, repaired.decision);
        return changedPaths.length === 0
            ? repaired
            : unavailableSemanticChange(repaired.decision, changedPaths);
    };

    public canRepairProtocol = (
        diagnostic: ModelProtocolDiagnostic
    ): boolean => {
        return createSemanticRepairGuard(diagnostic.parsedJson) !== undefined;
    };

    private async generate(
        request: ModelRequest,
        signal: AbortSignal
    ): Promise<RecoveryPlannerAttempt> {
        try {
            const result = await this.modelAdapter.generateStructured(
                request,
                recoveryDecisionSchema,
                signal
            );
            return { status: 'decision', decision: result.value };
        } catch (error) {
            if (!(error instanceof ClassifiedModelFailure)) {
                throw error;
            }
            if (
                error.failureType === 'invalid-json'
                || error.failureType === 'schema-invalid'
            ) {
                return {
                    status: 'protocol-invalid',
                    diagnostic: error.diagnostic
                };
            }
            return {
                status: 'unavailable',
                reason: error.message,
                diagnostic: error.diagnostic
            };
        }
    }
}

interface SemanticRepairGuard {
    values: Record<string, string>;
    nullOnlyPaths: string[];
}

const RECOVERY_ACTION_TYPES = new Set([
    'BACK', 'CLEAR', 'CLICK', 'HOVER', 'REOBSERVE', 'SCROLL', 'WAIT'
]);

/** 只提取 initial JSON 中已经存在且领域有效的语义字段。 */
function createSemanticRepairGuard(
    value: unknown
): SemanticRepairGuard | undefined {
    if (!isRecord(value) || (value.kind !== 'recover' && value.kind !== 'stop')) {
        return undefined;
    }
    const values: Record<string, string> = { kind: value.kind };
    const nullOnlyPaths: string[] = [];
    if (value.kind === 'stop') {
        preserveString(values, 'stop.reason', value.reason);
        return { values, nullOnlyPaths };
    }
    if (!isRecord(value.action)) {
        return undefined;
    }
    const action = value.action;
    const actionType = action.type;
    if (
        typeof actionType !== 'string'
        || !RECOVERY_ACTION_TYPES.has(actionType)
    ) {
        return undefined;
    }
    values['action.type'] = actionType;
    if ([ 'CLEAR', 'CLICK', 'HOVER' ].includes(actionType)) {
        if (!isRecord(action.target) || !nonEmptyString(action.target.description)) {
            return undefined;
        }
        values['target.description'] = action.target.description;
        if (!preserveNullableString(
            values,
            nullOnlyPaths,
            'target.scope',
            action.target.scope
        )) {
            return undefined;
        }
    }
    if (actionType === 'SCROLL' && (
        !preserveRequiredEnum(values, 'direction', action.direction, [
            'up', 'down'
        ])
        || !preserveRequiredEnum(values, 'amount', action.amount, [
            'small', 'medium', 'page'
        ])
    )) {
        return undefined;
    }
    if (
        actionType === 'WAIT'
        && !preserveRequiredEnum(
            values,
            'duration',
            action.duration,
            [ 'short', 'medium' ]
        )
    ) {
        return undefined;
    }
    preserveString(values, 'reasonSummary', action.reasonSummary);
    if (!preserveNullableString(
        values,
        nullOnlyPaths,
        'expectedTransientEffect',
        action.expectedTransientEffect
    )) {
        return undefined;
    }
    return { values, nullOnlyPaths };
}

function changedSemanticPaths(
    guard: SemanticRepairGuard,
    repaired: RecoveryDecision
): string[] {
    const repairedGuard = createSemanticRepairGuard(repaired);
    if (!repairedGuard) {
        return [ 'strategy.identity' ];
    }
    const changedValues = Object.entries(guard.values)
        .filter(([ path, value ]) => repairedGuard.values[path] !== value)
        .map(([ path ]) => path);
    const inventedValues = guard.nullOnlyPaths.filter(
        (path) => repairedGuard.values[path] !== undefined
    );
    return [ ...new Set([ ...changedValues, ...inventedValues ]) ];
}

function unavailableRepair(
    diagnostic: ModelProtocolDiagnostic,
    reason: string
): RecoveryPlannerAttempt {
    return {
        status: 'unavailable',
        reason,
        diagnostic
    };
}

function unavailableSemanticChange(
    decision: RecoveryDecision,
    changedPaths: string[]
): RecoveryPlannerAttempt {
    return {
        status: 'unavailable',
        reason: `协议修复改变了 Recovery 语义：${ changedPaths.join(', ') }。`,
        diagnostic: {
            schemaVersion: 1,
            modelRole: 'recovery-planner',
            phase: 'repair',
            failureType: 'schema-invalid',
            parsedJson: decision as unknown as JsonValue,
            schemaIssues: changedPaths.map((path) => ({
                path,
                code: 'semantic-preservation-failed',
                message: 'repair 不得改变 initial JSON 中已有的语义值。'
            })),
            sanitized: true,
            truncated: false
        }
    };
}

function preserveString(
    output: Record<string, string>,
    path: string,
    value: unknown
): void {
    if (nonEmptyString(value)) {
        output[path] = value;
    }
}

function preserveRequiredEnum(
    output: Record<string, string>,
    path: string,
    value: unknown,
    allowed: string[]
): boolean {
    if (typeof value === 'string' && allowed.includes(value)) {
        output[path] = value;
        return true;
    }
    return false;
}

function preserveNullableString(
    output: Record<string, string>,
    nullOnlyPaths: string[],
    path: string,
    value: unknown
): boolean {
    if (value === undefined || value === null) {
        nullOnlyPaths.push(path);
        return true;
    }
    if (!nonEmptyString(value)) {
        return false;
    }
    output[path] = value;
    return true;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const recoveryDecisionSchema: RuntimeSchema<RecoveryDecision> = {
    name: 'RecoveryDecision',
    jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: [ 'kind', 'action', 'reason' ],
        properties: {
            kind: {
                type: 'string',
                enum: [ 'recover', 'stop' ]
            },
            action: {
                anyOf: [
                    targetedRecoveryActionSchema(),
                    scrollRecoveryActionSchema(),
                    waitRecoveryActionSchema(),
                    targetlessRecoveryActionSchema(),
                    { type: 'null' }
                ]
            },
            reason: { type: [ 'string', 'null' ] }
        }
    },
    parse: parseRecoveryDecision
};

function targetedRecoveryActionSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'type', 'target', 'expectedTransientEffect', 'reasonSummary'
        ],
        properties: {
            type: {
                type: 'string',
                enum: [ 'CLEAR', 'CLICK', 'HOVER' ]
            },
            target: {
                type: 'object',
                additionalProperties: false,
                required: [ 'description', 'scope' ],
                properties: {
                    description: { type: 'string', minLength: 1 },
                    scope: { type: [ 'string', 'null' ], minLength: 1 }
                }
            },
            expectedTransientEffect: {
                type: [ 'string', 'null' ], minLength: 1
            },
            reasonSummary: { type: 'string', minLength: 1 }
        }
    };
}

function scrollRecoveryActionSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'type', 'direction', 'amount', 'expectedTransientEffect',
            'reasonSummary'
        ],
        properties: {
            type: { type: 'string', const: 'SCROLL' },
            direction: { type: 'string', enum: [ 'up', 'down' ] },
            amount: {
                type: 'string',
                enum: [ 'small', 'medium', 'page' ]
            },
            expectedTransientEffect: {
                type: [ 'string', 'null' ], minLength: 1
            },
            reasonSummary: { type: 'string', minLength: 1 }
        }
    };
}

function waitRecoveryActionSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'type', 'duration', 'expectedTransientEffect', 'reasonSummary'
        ],
        properties: {
            type: { type: 'string', const: 'WAIT' },
            duration: {
                type: 'string',
                enum: [ 'short', 'medium' ]
            },
            expectedTransientEffect: {
                type: [ 'string', 'null' ], minLength: 1
            },
            reasonSummary: { type: 'string', minLength: 1 }
        }
    };
}

function targetlessRecoveryActionSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: [ 'type', 'expectedTransientEffect', 'reasonSummary' ],
        properties: {
            type: {
                type: 'string',
                enum: [ 'BACK', 'REOBSERVE' ]
            },
            expectedTransientEffect: {
                type: [ 'string', 'null' ], minLength: 1
            },
            reasonSummary: { type: 'string', minLength: 1 }
        }
    };
}

function parseRecoveryDecision(value: unknown): RecoveryDecision {
    const object = requireObject(value, 'RecoveryDecision');
    if (object.kind === 'stop') {
        requireFields(
            object,
            [ 'kind', 'action', 'reason' ],
            'RecoveryDecision'
        );
        if (object.action !== null) {
            invalid(
                'RecoveryDecision.action',
                'invalid-stop-action',
                'stop.action 必须为 null。'
            );
        }
        return {
            kind: 'stop',
            reason: requireString(object.reason, 'RecoveryDecision.reason')
        };
    }
    if (object.kind !== 'recover') {
        invalid(
            'RecoveryDecision.kind',
            'invalid-kind',
            '必须是 recover 或 stop。'
        );
    }
    requireFields(
        object,
        [ 'kind', 'action', 'reason' ],
        'RecoveryDecision'
    );
    if (object.reason !== null) {
        invalid(
            'RecoveryDecision.reason',
            'invalid-recover-reason',
            'recover.reason 必须为 null。'
        );
    }
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
            || object.expectedTransientEffect === null
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
            direction: requireEnum(
                object.direction,
                [ 'up', 'down' ],
                'RecoveryDecision.action.direction'
            ),
            amount: requireEnum(
                object.amount,
                [ 'small', 'medium', 'page' ],
                'RecoveryDecision.action.amount'
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
            duration: requireEnum(
                object.duration,
                [ 'short', 'medium' ],
                'RecoveryDecision.action.duration'
            ),
            ...common
        };
    }
    if (type === 'BACK' || type === 'REOBSERVE') {
        requireFields(object, [
            'type', 'expectedTransientEffect', 'reasonSummary'
        ], 'RecoveryDecision.action', true);
        return { type, ...common };
    }
    invalid(
        'RecoveryDecision.action.type',
        'unsupported-action',
        `不支持的 RecoveryAction：${ type }`
    );
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
        ...object.scope === undefined || object.scope === null
            ? {}
            : { scope: requireString(object.scope, 'target.scope') }
    };
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid(path, 'expected-object', '必须是对象。');
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
        invalid(
            `${ path }.${ unexpected }`,
            'unexpected-field',
            '字段不允许出现。'
        );
    }
    if (!optionalAllowed) {
        const missing = fields.find((field) => !(field in object));
        if (missing) {
            invalid(
                `${ path }.${ missing }`,
                'missing-field',
                '字段缺失。'
            );
        }
    }
}

function requireString(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        invalid(path, 'expected-non-empty-string', '必须是非空字符串。');
    }
    return value;
}

function requireEnum<T extends string>(
    value: unknown,
    allowed: T[],
    path: string
): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        invalid(
            path,
            'invalid-enum',
            `值不在允许集合中：${ String(value) }`
        );
    }
    return value as T;
}

function invalid(path: string, code: string, message: string): never {
    throw new RuntimeSchemaValidationError([{ path, code, message }]);
}
