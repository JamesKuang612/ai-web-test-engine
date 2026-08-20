import type {
    EvidenceType,
    FailureCriterion,
    JsonValue,
    SuccessCriterion,
    TestIntent,
} from '../contracts';
import type {
    RuntimeSchema,
} from '../ports';

const EVIDENCE_TYPES = new Set<EvidenceType>([
    'dom',
    'network',
    'screenshot',
    'url'
]);

const TEST_INTENT_FIELDS = [
    'schemaVersion',
    'objective',
    'preconditions',
    'successCriteria',
    'failureCriteria',
    'constraints',
    'allowedHosts',
    'dataPolicy'
];

const TEST_INTENT_JSON_SCHEMA: Record<string, JsonValue> = {
    type: 'object',
    additionalProperties: false,
    required: TEST_INTENT_FIELDS,
    properties: {
        schemaVersion: {
            type: 'integer',
            const: 1
        },
        objective: {
            type: 'string',
            minLength: 1
        },
        preconditions: {
            type: 'array',
            items: {
                type: 'string',
                minLength: 1
            }
        },
        successCriteria: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'id',
                    'description',
                    'preferredEvidence',
                    'required'
                ],
                properties: {
                    id: {
                        type: 'string',
                        minLength: 1
                    },
                    description: {
                        type: 'string',
                        minLength: 1
                    },
                    preferredEvidence: {
                        type: 'array',
                        items: {
                            type: 'string',
                            enum: [
                                'dom',
                                'network',
                                'screenshot',
                                'url'
                            ]
                        }
                    },
                    required: {
                        type: 'boolean'
                    }
                }
            }
        },
        failureCriteria: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'id',
                    'description'
                ],
                properties: {
                    id: {
                        type: 'string',
                        minLength: 1
                    },
                    description: {
                        type: 'string',
                        minLength: 1
                    }
                }
            }
        },
        constraints: {
            type: 'array',
            items: {
                type: 'string',
                minLength: 1
            }
        },
        allowedHosts: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'string',
                minLength: 1
            }
        },
        dataPolicy: {
            type: 'object',
            additionalProperties: false,
            required: [
                'generatedValues'
            ],
            properties: {
                generatedValues: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                            'name',
                            'rule'
                        ],
                        properties: {
                            name: {
                                type: 'string',
                                minLength: 1
                            },
                            rule: {
                                type: 'string',
                                minLength: 1
                            }
                        }
                    }
                }
            }
        }
    }
};

/** 表示模型返回的测试意图不符合运行时 Schema。 */
export class TestIntentSchemaError extends Error {
    /** 记录发生错误的字段路径，方便定位模型输出问题。 */
    constructor(
        public readonly path: string,
        message: string
    ) {
        super(`${ path }：${ message }`);
        this.name = 'TestIntentSchemaError';
    }
}

/** 在运行时校验模型输出，并将合法数据转换成 TestIntent。 */
export const testIntentSchema: RuntimeSchema<TestIntent> = {
    name: 'TestIntent',
    jsonSchema: TEST_INTENT_JSON_SCHEMA,
    parse: parseTestIntent
};

/** 严格解析模型返回的未知数据，不信任 TypeScript 类型断言。 */
function parseTestIntent(value: unknown): TestIntent {
    const object = requireObject(value, 'TestIntent');

    requireExactFields(
        object,
        TEST_INTENT_FIELDS,
        'TestIntent'
    );

    if (object.schemaVersion !== 1) {
        throw new TestIntentSchemaError(
            'TestIntent.schemaVersion',
            '必须等于 1'
        );
    }

    const successCriteria = requireArray(
        object.successCriteria,
        'TestIntent.successCriteria'
    ).map(parseSuccessCriterion);

    const failureCriteria = requireArray(
        object.failureCriteria,
        'TestIntent.failureCriteria'
    ).map(parseFailureCriterion);

    requireUniqueCriterionIds(
        successCriteria,
        failureCriteria
    );

    const allowedHosts = requireStringArray(
        object.allowedHosts,
        'TestIntent.allowedHosts'
    );

    if (allowedHosts.length === 0) {
        throw new TestIntentSchemaError(
            'TestIntent.allowedHosts',
            '至少需要一个允许访问的 Host'
        );
    }

    return {
        schemaVersion: 1,
        objective: requireNonEmptyString(
            object.objective,
            'TestIntent.objective'
        ),
        preconditions: requireStringArray(
            object.preconditions,
            'TestIntent.preconditions'
        ),
        successCriteria,
        failureCriteria,
        constraints: requireStringArray(
            object.constraints,
            'TestIntent.constraints'
        ),
        allowedHosts: [...new Set(allowedHosts)],
        dataPolicy: parseDataPolicy(object.dataPolicy)
    };
}

/** 解析一条测试成功条件。 */
function parseSuccessCriterion(
    value: unknown,
    index: number
): SuccessCriterion {
    const path = `TestIntent.successCriteria[${ index }]`;
    const object = requireObject(value, path);

    requireExactFields(
        object,
        [
            'id',
            'description',
            'preferredEvidence',
            'required'
        ],
        path
    );

    const preferredEvidence = requireArray(
        object.preferredEvidence,
        `${ path }.preferredEvidence`
    ).map((evidence, evidenceIndex) => requireEvidenceType(
        evidence,
        `${ path }.preferredEvidence[${ evidenceIndex }]`
    ));

    return {
        id: requireNonEmptyString(
            object.id,
            `${ path }.id`
        ),
        description: requireNonEmptyString(
            object.description,
            `${ path }.description`
        ),
        preferredEvidence,
        required: requireBoolean(
            object.required,
            `${ path }.required`
        )
    };
}

/** 解析一条明确的测试失败条件。 */
function parseFailureCriterion(
    value: unknown,
    index: number
): FailureCriterion {
    const path = `TestIntent.failureCriteria[${ index }]`;
    const object = requireObject(value, path);

    requireExactFields(
        object,
        [
            'id',
            'description'
        ],
        path
    );

    return {
        id: requireNonEmptyString(
            object.id,
            `${ path }.id`
        ),
        description: requireNonEmptyString(
            object.description,
            `${ path }.description`
        )
    };
}

/** 解析测试执行过程中需要动态生成的数据规则。 */
function parseDataPolicy(
    value: unknown
): TestIntent['dataPolicy'] {
    const path = 'TestIntent.dataPolicy';
    const object = requireObject(value, path);

    requireExactFields(
        object,
        [
            'generatedValues'
        ],
        path
    );

    if (Array.isArray(object.generatedValues)) {
        return {
            generatedValues: parseGeneratedValueRules(
                object.generatedValues,
                `${ path }.generatedValues`
            )
        };
    }

    // 兼容已经持久化的旧版 Record 结构，模型侧只使用新版数组 Schema。
    const generatedValuesObject = requireObject(
        object.generatedValues,
        `${ path }.generatedValues`
    );
    const generatedValues: Record<string, string> = {};

    Object.entries(generatedValuesObject).forEach(
        ([key, generatedValue]) => {
            if (key.trim().length === 0) {
                throw new TestIntentSchemaError(
                    `${ path }.generatedValues`,
                    '数据名称不能为空'
                );
            }

            generatedValues[key] = requireNonEmptyString(
                generatedValue,
                `${ path }.generatedValues.${ key }`
            );
        }
    );

    return {
        generatedValues
    };
}

/** 将模型生成的 name/rule 数组转换为引擎内部使用的 Record。 */
function parseGeneratedValueRules(
    values: unknown[],
    path: string
): Record<string, string> {
    const generatedValues: Record<string, string> = {};

    values.forEach((value, index) => {
        const itemPath = `${ path }[${ index }]`;
        const item = requireObject(value, itemPath);
        requireExactFields(item, [
            'name',
            'rule'
        ], itemPath);

        const name = requireNonEmptyString(
            item.name,
            `${ itemPath }.name`
        );
        if (name in generatedValues) {
            throw new TestIntentSchemaError(
                `${ itemPath }.name`,
                `数据名称重复：${ name }`
            );
        }
        generatedValues[name] = requireNonEmptyString(
            item.rule,
            `${ itemPath }.rule`
        );
    });

    return generatedValues;
}

/** 确保成功条件和失败条件不会使用重复 ID。 */
function requireUniqueCriterionIds(
    successCriteria: SuccessCriterion[],
    failureCriteria: FailureCriterion[]
): void {
    const criterionIds = [
        ...successCriteria.map((criterion) => criterion.id),
        ...failureCriteria.map((criterion) => criterion.id)
    ];

    if (new Set(criterionIds).size !== criterionIds.length) {
        throw new TestIntentSchemaError(
            'TestIntent',
            '成功条件和失败条件的 ID 不能重复'
        );
    }
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
        throw new TestIntentSchemaError(
            path,
            '必须是对象'
        );
    }

    return value as Record<string, unknown>;
}

/** 将未知值校验为数组。 */
function requireArray(
    value: unknown,
    path: string
): unknown[] {
    if (!Array.isArray(value)) {
        throw new TestIntentSchemaError(
            path,
            '必须是数组'
        );
    }

    return value;
}

/** 将未知值校验为非空字符串。 */
function requireNonEmptyString(
    value: unknown,
    path: string
): string {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0
    ) {
        throw new TestIntentSchemaError(
            path,
            '必须是非空字符串'
        );
    }

    return value;
}

/** 将未知值校验为字符串数组。 */
function requireStringArray(
    value: unknown,
    path: string
): string[] {
    return requireArray(value, path).map(
        (item, index) => requireNonEmptyString(
            item,
            `${ path }[${ index }]`
        )
    );
}

/** 将未知值校验为布尔值。 */
function requireBoolean(
    value: unknown,
    path: string
): boolean {
    if (typeof value !== 'boolean') {
        throw new TestIntentSchemaError(
            path,
            '必须是布尔值'
        );
    }

    return value;
}

/** 将模型给出的字符串校验为允许使用的证据类型。 */
function requireEvidenceType(
    value: unknown,
    path: string
): EvidenceType {
    const evidence = requireNonEmptyString(value, path);

    if (!EVIDENCE_TYPES.has(evidence as EvidenceType)) {
        throw new TestIntentSchemaError(
            path,
            `不支持的证据类型：${ evidence }`
        );
    }

    return evidence as EvidenceType;
}

/** 拒绝模型额外生成契约中不存在的字段。 */
function requireExactFields(
    value: Record<string, unknown>,
    allowedFields: string[],
    path: string
): void {
    const allowedFieldSet = new Set(allowedFields);

    Object.keys(value).forEach((field) => {
        if (!allowedFieldSet.has(field)) {
            throw new TestIntentSchemaError(
                `${ path }.${ field }`,
                '不允许出现该字段'
            );
        }
    });

    allowedFields.forEach((field) => {
        if (!(field in value)) {
            throw new TestIntentSchemaError(
                `${ path }.${ field }`,
                '缺少必填字段'
            );
        }
    });
}
