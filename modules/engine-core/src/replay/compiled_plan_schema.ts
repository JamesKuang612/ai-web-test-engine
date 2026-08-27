import type {
    CompiledActionType,
    CompiledPlan,
    CompiledStep,
    CompiledTarget,
    CompiledTargetIdentity,
    LocatorHint,
    ValueReference,
} from '../contracts';
import {
    testIntentSchema,
} from '../intent';

const PLAN_FIELDS = [
    'schemaVersion',
    'planId',
    'testId',
    'sourceRunId',
    'sourceTraceRef',
    'createdAt',
    'allowedHosts',
    'testIntent',
    'steps'
];
const STEP_FIELDS = [
    'id',
    'sequence',
    'type',
    'target',
    'value',
    'expectedEffect',
    'risk'
];
const TARGET_FIELDS = [
    'description',
    'locatorHints',
    'identity'
];
const IDENTITY_FIELDS: Array<keyof CompiledTargetIdentity> = [
    'tag',
    'role',
    'name',
    'text',
    'label',
    'placeholder',
    'inputType'
];
const COMPILED_ACTION_TYPES = new Set<CompiledActionType>([
    'CHECK',
    'CLICK',
    'NAVIGATE',
    'SELECT',
    'TYPE',
    'WAIT'
]);
const LOCATOR_STRATEGIES = new Set<LocatorHint['strategy']>([
    'css',
    'label',
    'placeholder',
    'role-name',
    'test-id',
    'text'
]);
const RISKS = new Set<CompiledStep['risk']>([
    'read-only',
    'reversible',
    'side-effect'
]);

/** 表示本地读取的结构化计划不符合可信执行契约。 */
export class CompiledPlanSchemaError extends Error {
    constructor(
        public readonly path: string,
        message: string
    ) {
        super(`${ path }：${ message }`);
        this.name = 'CompiledPlanSchemaError';
    }
}

/** 对存储层读取的未知 JSON 做完整运行时校验。 */
export function parseCompiledPlan(value: unknown): CompiledPlan {
    const object = requireObject(value, 'CompiledPlan');
    requireExactFields(object, PLAN_FIELDS, 'CompiledPlan');
    if (object.schemaVersion !== 1) {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.schemaVersion',
            '必须等于 1'
        );
    }

    const sourceRunId = requireString(
        object.sourceRunId,
        'CompiledPlan.sourceRunId'
    );
    const sourceTraceRef = requireString(
        object.sourceTraceRef,
        'CompiledPlan.sourceTraceRef'
    );
    if (sourceTraceRef !== `${ sourceRunId }/trace.jsonl`) {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.sourceTraceRef',
            '必须引用 sourceRunId 对应的 trace.jsonl'
        );
    }

    const createdAt = requireString(
        object.createdAt,
        'CompiledPlan.createdAt'
    );
    if (Number.isNaN(Date.parse(createdAt))) {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.createdAt',
            '必须是合法时间'
        );
    }
    const allowedHosts = requireHostArray(
        object.allowedHosts,
        'CompiledPlan.allowedHosts'
    );
    const testIntent = testIntentSchema.parse(object.testIntent);
    requireSameHosts(allowedHosts, testIntent.allowedHosts);
    const steps = requireArray(
        object.steps,
        'CompiledPlan.steps'
    ).map((step, index) => parseStep(step, index, allowedHosts));
    if (steps.length === 0) {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.steps',
            '至少需要一个回放步骤'
        );
    }
    if (steps[0].type !== 'NAVIGATE') {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.steps[0].type',
            '第一个步骤必须是 NAVIGATE'
        );
    }
    requireUniqueStepIds(steps);
    requireNoConsecutiveWaits(steps);

    return {
        schemaVersion: 1,
        planId: requireString(object.planId, 'CompiledPlan.planId'),
        testId: requireString(object.testId, 'CompiledPlan.testId'),
        sourceRunId,
        sourceTraceRef,
        createdAt,
        allowedHosts,
        testIntent,
        steps
    };
}

function requireNoConsecutiveWaits(steps: CompiledStep[]): void {
    const consecutiveWaitIndex = steps.findIndex((step, index) => (
        step.type === 'WAIT' && steps[index - 1]?.type === 'WAIT'
    ));
    if (consecutiveWaitIndex >= 0) {
        throw new CompiledPlanSchemaError(
            `CompiledPlan.steps[${ consecutiveWaitIndex }]`,
            '不能包含连续 WAIT 步骤'
        );
    }
}

/** 解析并执行动作类型相关的目标和值约束。 */
function parseStep(
    value: unknown,
    index: number,
    allowedHosts: string[]
): CompiledStep {
    const path = `CompiledPlan.steps[${ index }]`;
    const object = requireObject(value, path);
    requireAllowedFields(object, STEP_FIELDS, path);
    const sequence = requirePositiveInteger(
        object.sequence,
        `${ path }.sequence`
    );
    if (sequence !== index + 1) {
        throw new CompiledPlanSchemaError(
            `${ path }.sequence`,
            '必须从 1 开始连续递增'
        );
    }
    const type = requireActionType(object.type, `${ path }.type`);
    const target = object.target === undefined
        ? undefined
        : parseTarget(object.target, `${ path }.target`);
    const actionValue = object.value === undefined
        ? undefined
        : parseValue(object.value, `${ path }.value`);
    requireStepShape(type, target, actionValue, path, allowedHosts);

    return {
        id: requireString(object.id, `${ path }.id`),
        sequence,
        type,
        ...target ? { target } : {},
        ...actionValue ? { value: actionValue } : {},
        expectedEffect: requireString(
            object.expectedEffect,
            `${ path }.expectedEffect`
        ),
        risk: requireRisk(object.risk, `${ path }.risk`)
    };
}

/** 解析不允许携带 candidateId 的稳定元素目标。 */
function parseTarget(value: unknown, path: string): CompiledTarget {
    const object = requireObject(value, path);
    requireExactFields(object, TARGET_FIELDS, path);
    const locatorHints = requireArray(
        object.locatorHints,
        `${ path }.locatorHints`
    ).map((hint, index) => parseLocatorHint(
        hint,
        `${ path }.locatorHints[${ index }]`
    ));
    if (locatorHints.length === 0) {
        throw new CompiledPlanSchemaError(
            `${ path }.locatorHints`,
            '至少需要一个稳定定位提示'
        );
    }
    const hintKeys = locatorHints.map(
        (hint) => `${ hint.strategy }\u0000${ hint.value }`
    );
    if (new Set(hintKeys).size !== hintKeys.length) {
        throw new CompiledPlanSchemaError(
            `${ path }.locatorHints`,
            '不能包含重复定位提示'
        );
    }

    return {
        description: requireString(
            object.description,
            `${ path }.description`
        ),
        locatorHints,
        identity: parseIdentity(object.identity, `${ path }.identity`)
    };
}

/** 解析元素的语义身份字段。 */
function parseIdentity(
    value: unknown,
    path: string
): CompiledTargetIdentity {
    const object = requireObject(value, path);
    requireAllowedFields(object, IDENTITY_FIELDS, path);
    const identity: CompiledTargetIdentity = {
        tag: requireString(object.tag, `${ path }.tag`)
    };

    IDENTITY_FIELDS.filter((field) => field !== 'tag').forEach((field) => {
        const item = object[field];
        if (item !== undefined) {
            identity[field] = requireString(item, `${ path }.${ field }`);
        }
    });
    return identity;
}

/** 解析单个受控定位提示。 */
function parseLocatorHint(value: unknown, path: string): LocatorHint {
    const object = requireObject(value, path);
    requireExactFields(object, [ 'strategy', 'value' ], path);
    const strategy = requireString(object.strategy, `${ path }.strategy`);
    if (!LOCATOR_STRATEGIES.has(strategy as LocatorHint['strategy'])) {
        throw new CompiledPlanSchemaError(
            `${ path }.strategy`,
            `不支持的定位策略：${ strategy }`
        );
    }

    return {
        strategy: strategy as LocatorHint['strategy'],
        value: requireString(object.value, `${ path }.value`)
    };
}

/** 解析步骤值引用，实际值仍不会在此处展开。 */
function parseValue(value: unknown, path: string): ValueReference {
    const object = requireObject(value, path);
    const source = requireString(object.source, `${ path }.source`);
    if (source === 'literal') {
        requireExactFields(object, [ 'source', 'value' ], path);
        if (
            typeof object.value !== 'string'
            && typeof object.value !== 'number'
            && typeof object.value !== 'boolean'
        ) {
            throw new CompiledPlanSchemaError(
                `${ path }.value`,
                '计划中的字面量只允许字符串、数字或布尔值'
            );
        }
        return {
            source: 'literal',
            value: object.value
        };
    }
    if (source !== 'environment' && source !== 'generated') {
        throw new CompiledPlanSchemaError(
            `${ path }.source`,
            `不支持的值来源：${ source }`
        );
    }
    requireExactFields(object, [ 'source', 'key' ], path);
    return {
        source,
        key: requireString(object.key, `${ path }.key`)
    };
}

/** 校验不同动作类型只能携带对应字段。 */
function requireStepShape(
    type: CompiledActionType,
    target: CompiledTarget | undefined,
    value: ValueReference | undefined,
    path: string,
    allowedHosts: string[]
): void {
    if (type === 'NAVIGATE') {
        if (
            target
            || value?.source !== 'literal'
            || typeof value.value !== 'string'
        ) {
            throw new CompiledPlanSchemaError(
                path,
                'NAVIGATE 只能携带字符串 URL 字面量'
            );
        }
        requireAllowedUrl(value.value, allowedHosts, `${ path }.value.value`);
        return;
    }
    if (type === 'WAIT') {
        if (
            target
            || value?.source !== 'literal'
            || typeof value.value !== 'number'
            || !Number.isInteger(value.value)
            || value.value < 100
            || value.value > 5_000
        ) {
            throw new CompiledPlanSchemaError(
                path,
                'WAIT 只能携带 100～5000 毫秒的整数字面量'
            );
        }
        return;
    }
    if (!target) {
        throw new CompiledPlanSchemaError(
            `${ path }.target`,
            `${ type } 必须提供稳定元素目标`
        );
    }
    requireClickShape(type, value, path);
    requireTypeShape(type, value, path);
    requireSelectShape(type, value, path);
    requireCheckShape(type, value, path);
}

function requireClickShape(
    type: CompiledActionType,
    value: ValueReference | undefined,
    path: string
): void {
    if (type === 'CLICK' && value) {
        throw new CompiledPlanSchemaError(path, 'CLICK 不能携带输入值');
    }
}

function requireTypeShape(
    type: CompiledActionType,
    value: ValueReference | undefined,
    path: string
): void {
    if (
        type === 'TYPE'
        && value?.source !== 'environment'
        && value?.source !== 'generated'
    ) {
        throw new CompiledPlanSchemaError(
            `${ path }.value`,
            'TYPE 必须保留环境变量或生成值引用'
        );
    }
}

function requireSelectShape(
    type: CompiledActionType,
    value: ValueReference | undefined,
    path: string
): void {
    if (
        type === 'SELECT'
        && !(
            value?.source === 'environment'
            || value?.source === 'generated'
            || (
                value?.source === 'literal'
                && typeof value.value === 'string'
            )
        )
    ) {
        throw new CompiledPlanSchemaError(
            `${ path }.value`,
            'SELECT 必须提供字符串选项值引用'
        );
    }
}

function requireCheckShape(
    type: CompiledActionType,
    value: ValueReference | undefined,
    path: string
): void {
    if (
        type === 'CHECK'
        && (
            value?.source !== 'literal'
            || typeof value.value !== 'boolean'
        )
    ) {
        throw new CompiledPlanSchemaError(
            `${ path }.value`,
            'CHECK 必须提供布尔字面量'
        );
    }
}

/** 校验导航协议和目标 Host。 */
function requireAllowedUrl(
    rawUrl: string,
    allowedHosts: string[],
    path: string
): void {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new CompiledPlanSchemaError(path, '必须是合法 URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new CompiledPlanSchemaError(path, '只允许 HTTP 或 HTTPS');
    }
    if (!allowedHosts.includes(url.hostname.toLowerCase())) {
        throw new CompiledPlanSchemaError(path, '目标 Host 不在计划允许列表中');
    }
}

/** 校验计划与内嵌测试意图使用完全相同的 Host 边界。 */
function requireSameHosts(left: string[], right: string[]): void {
    const normalizedRight = [...new Set(
        right.map((host) => host.toLowerCase())
    )].sort();
    if (
        left.length !== normalizedRight.length
        || left.some((host, index) => host !== normalizedRight[index])
    ) {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.allowedHosts',
            '必须与 testIntent.allowedHosts 一致'
        );
    }
}

/** 解析、规范化并去重 Host 列表。 */
function requireHostArray(value: unknown, path: string): string[] {
    const hosts = requireArray(value, path).map((host, index) => {
        const normalized = requireString(host, `${ path }[${ index }]`)
            .toLowerCase();
        if (normalized.includes('/') || normalized.includes(':')) {
            throw new CompiledPlanSchemaError(
                `${ path }[${ index }]`,
                '必须是纯 Host，不能包含协议、端口或路径'
            );
        }
        return normalized;
    });
    const uniqueHosts = [...new Set(hosts)].sort();
    if (uniqueHosts.length === 0 || uniqueHosts.length !== hosts.length) {
        throw new CompiledPlanSchemaError(path, '不能为空或包含重复 Host');
    }
    return uniqueHosts;
}

/** 校验步骤 ID 在同一计划中不重复。 */
function requireUniqueStepIds(steps: CompiledStep[]): void {
    const ids = steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) {
        throw new CompiledPlanSchemaError(
            'CompiledPlan.steps',
            '步骤 ID 不能重复'
        );
    }
}

function requireActionType(value: unknown, path: string): CompiledActionType {
    const type = requireString(value, path);
    if (!COMPILED_ACTION_TYPES.has(type as CompiledActionType)) {
        throw new CompiledPlanSchemaError(path, `不支持的动作：${ type }`);
    }
    return type as CompiledActionType;
}

function requireRisk(value: unknown, path: string): CompiledStep['risk'] {
    const risk = requireString(value, path);
    if (!RISKS.has(risk as CompiledStep['risk'])) {
        throw new CompiledPlanSchemaError(path, `不支持的风险等级：${ risk }`);
    }
    return risk as CompiledStep['risk'];
}

function requirePositiveInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || (value as number) < 1) {
        throw new CompiledPlanSchemaError(path, '必须是正整数');
    }
    return value as number;
}

function requireString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new CompiledPlanSchemaError(path, '必须是非空字符串');
    }
    return value;
}

function requireArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new CompiledPlanSchemaError(path, '必须是数组');
    }
    return value;
}

function requireObject(
    value: unknown,
    path: string
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new CompiledPlanSchemaError(path, '必须是对象');
    }
    return value as Record<string, unknown>;
}

function requireExactFields(
    object: Record<string, unknown>,
    fields: readonly string[],
    path: string
): void {
    requireAllowedFields(object, fields, path);
    const missing = fields.find((field) => !(field in object));
    if (missing) {
        throw new CompiledPlanSchemaError(`${ path }.${ missing }`, '字段缺失');
    }
}

function requireAllowedFields(
    object: Record<string, unknown>,
    fields: readonly string[],
    path: string
): void {
    const unexpected = Object.keys(object).find(
        (field) => !fields.includes(field)
    );
    if (unexpected) {
        throw new CompiledPlanSchemaError(
            `${ path }.${ unexpected }`,
            '不允许额外字段'
        );
    }
}
