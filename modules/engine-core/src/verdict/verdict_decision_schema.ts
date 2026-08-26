import type {
    CriterionAssessment,
    CriterionMatchStatus,
    JsonValue,
    TestResult,
    VerdictDecision,
} from '../contracts';
import type {
    RuntimeSchema,
} from '../ports';

const RESULTS = new Set<TestResult>([
    'PASS',
    'FAIL',
    'UNCERTAIN'
]);
const MATCH_STATUSES = new Set<CriterionMatchStatus>([
    'MATCHED',
    'NOT_MATCHED',
    'UNKNOWN'
]);
const VERDICT_FIELDS = [
    'result',
    'summary',
    'successCriteria',
    'failureCriteria'
];
const ASSESSMENT_FIELDS = [
    'criterionId',
    'status',
    'summary'
];

const ASSESSMENT_SCHEMA: Record<string, JsonValue> = {
    type: 'object',
    additionalProperties: false,
    required: ASSESSMENT_FIELDS,
    properties: {
        criterionId: {
            type: 'string',
            minLength: 1
        },
        status: {
            type: 'string',
            enum: [...MATCH_STATUSES]
        },
        summary: {
            type: 'string',
            minLength: 1
        }
    }
};

const VERDICT_DECISION_JSON_SCHEMA: Record<string, JsonValue> = {
    type: 'object',
    additionalProperties: false,
    required: VERDICT_FIELDS,
    properties: {
        result: {
            type: 'string',
            enum: [...RESULTS]
        },
        summary: {
            type: 'string',
            minLength: 1
        },
        successCriteria: {
            type: 'array',
            items: ASSESSMENT_SCHEMA
        },
        failureCriteria: {
            type: 'array',
            items: ASSESSMENT_SCHEMA
        }
    }
};

/** 表示模型给出的 Verdict 不符合运行时契约。 */
export class VerdictDecisionSchemaError extends Error {
    /** 保存错误路径，方便定位结构化输出问题。 */
    constructor(
        public readonly path: string,
        message: string
    ) {
        super(`${ path }：${ message }`);
        this.name = 'VerdictDecisionSchemaError';
    }
}

/** 严格约束独立判定器返回的业务结果。 */
export const verdictDecisionSchema: RuntimeSchema<VerdictDecision> = {
    name: 'VerdictDecision',
    jsonSchema: VERDICT_DECISION_JSON_SCHEMA,
    parse: parseVerdictDecision
};

/** 将未知结构解析为可信 VerdictDecision。 */
function parseVerdictDecision(value: unknown): VerdictDecision {
    const object = requireObject(value, 'VerdictDecision');
    requireExactFields(object, VERDICT_FIELDS, 'VerdictDecision');

    return {
        result: requireResult(object.result),
        summary: requireString(object.summary, 'VerdictDecision.summary'),
        successCriteria: requireArray(
            object.successCriteria,
            'VerdictDecision.successCriteria'
        ).map((item, index) => parseAssessment(
            item,
            `VerdictDecision.successCriteria[${ index }]`
        )),
        failureCriteria: requireArray(
            object.failureCriteria,
            'VerdictDecision.failureCriteria'
        ).map((item, index) => parseAssessment(
            item,
            `VerdictDecision.failureCriteria[${ index }]`
        ))
    };
}

/** 解析一条条件判断。 */
function parseAssessment(
    value: unknown,
    path: string
): CriterionAssessment {
    const object = requireObject(value, path);
    requireExactFields(object, ASSESSMENT_FIELDS, path);
    return {
        criterionId: requireString(
            object.criterionId,
            `${ path }.criterionId`
        ),
        status: requireMatchStatus(object.status, `${ path }.status`),
        summary: requireString(object.summary, `${ path }.summary`)
    };
}

/** 校验结果枚举。 */
function requireResult(value: unknown): TestResult {
    const result = requireString(value, 'VerdictDecision.result');
    if (!RESULTS.has(result as TestResult)) {
        throw new VerdictDecisionSchemaError(
            'VerdictDecision.result',
            `不支持的结果：${ result }`
        );
    }
    return result as TestResult;
}

/** 校验条件匹配状态。 */
function requireMatchStatus(
    value: unknown,
    path: string
): CriterionMatchStatus {
    const status = requireString(value, path);
    if (!MATCH_STATUSES.has(status as CriterionMatchStatus)) {
        throw new VerdictDecisionSchemaError(
            path,
            `不支持的匹配状态：${ status }`
        );
    }
    return status as CriterionMatchStatus;
}

/** 校验普通对象。 */
function requireObject(
    value: unknown,
    path: string
): Record<string, unknown> {
    if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
    ) {
        throw new VerdictDecisionSchemaError(path, '必须是对象');
    }
    return value as Record<string, unknown>;
}

/** 校验数组。 */
function requireArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new VerdictDecisionSchemaError(path, '必须是数组');
    }
    return value;
}

/** 校验非空字符串。 */
function requireString(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new VerdictDecisionSchemaError(path, '必须是非空字符串');
    }
    return value;
}

/** 拒绝缺失字段和额外字段。 */
function requireExactFields(
    object: Record<string, unknown>,
    fields: string[],
    path: string
): void {
    const expected = new Set(fields);
    fields.forEach((field) => {
        if (!(field in object)) {
            throw new VerdictDecisionSchemaError(
                `${ path }.${ field }`,
                '缺少必填字段'
            );
        }
    });
    Object.keys(object).forEach((field) => {
        if (!expected.has(field)) {
            throw new VerdictDecisionSchemaError(
                `${ path }.${ field }`,
                '不允许出现该字段'
            );
        }
    });
}
