export interface TestDefinitionDto {
    action: string;
    environmentId: string;
    id: string;
    name: string;
    schemaVersion: 1;
    startUrl?: string;
    execution?: {
        planRef?: string;
        preferredMode?: 'ai-explore' | 'auto' | 'structured-replay';
    };
}

export interface TestDefinitionDraft {
    action: string;
    name: string;
    planRef?: null | string;
    startUrl: string;
}

export interface TestDefinitionRecordDto {
    definition: TestDefinitionDto;
    fileName: string;
    updatedAt: string;
}

export class TestDefinitionRequestError extends Error {
    constructor(
        message: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = 'TestDefinitionRequestError';
    }
}

/** 从项目 tests 目录读取全部真实 YAML 用例。 */
export async function listTestDefinitions(
    signal?: AbortSignal
): Promise<TestDefinitionRecordDto[]> {
    const value = await requestJson('/api/tests', { signal });
    const tests = getObject(value)?.tests;
    if (!Array.isArray(tests)) {
        throw new TestDefinitionRequestError('用例列表响应格式不正确。');
    }
    return tests.map(parseRecord);
}

/** 读取一条真实 YAML 用例。 */
export async function getTestDefinition(
    id: string,
    signal?: AbortSignal
): Promise<TestDefinitionDto> {
    const value = await requestJson(
        `/api/tests/${ encodeURIComponent(id) }`,
        { signal }
    );
    return parseDefinition(getObject(value)?.test);
}

/** 创建新的真实 YAML 用例。 */
export async function createTestDefinition(
    draft: TestDefinitionDraft
): Promise<TestDefinitionRecordDto> {
    const value = await requestJson('/api/tests', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(draft)
    });
    return parseRecord(getObject(value)?.record);
}

/** 更新已有的真实 YAML 用例。 */
export async function updateTestDefinition(
    id: string,
    draft: TestDefinitionDraft
): Promise<TestDefinitionRecordDto> {
    const value = await requestJson(
        `/api/tests/${ encodeURIComponent(id) }`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(draft)
        }
    );
    return parseRecord(getObject(value)?.record);
}

async function requestJson(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<unknown> {
    const response = await fetch(input, init);
    let value: unknown;
    try {
        value = await response.json() as unknown;
    } catch {
        throw new TestDefinitionRequestError(
            `用例接口没有返回 JSON（HTTP ${ response.status }）。`,
            response.status
        );
    }
    if (!response.ok) {
        const message = getObject(value)?.error;
        throw new TestDefinitionRequestError(
            typeof message === 'string'
                ? message
                : `用例接口请求失败（HTTP ${ response.status }）。`,
            response.status
        );
    }
    return value;
}

function parseRecord(value: unknown): TestDefinitionRecordDto {
    const object = getObject(value);
    if (
        typeof object?.fileName !== 'string'
        || typeof object.updatedAt !== 'string'
    ) {
        throw new TestDefinitionRequestError('用例记录响应格式不正确。');
    }
    return {
        definition: parseDefinition(object.definition),
        fileName: object.fileName,
        updatedAt: object.updatedAt
    };
}

function parseDefinition(value: unknown): TestDefinitionDto {
    const object = getObject(value);
    const execution = parseExecution(object?.execution);
    if (
        object?.schemaVersion !== 1
        || typeof object.id !== 'string'
        || typeof object.name !== 'string'
        || typeof object.environmentId !== 'string'
        || typeof object.action !== 'string'
        || object.startUrl !== undefined
            && typeof object.startUrl !== 'string'
    ) {
        throw new TestDefinitionRequestError('用例内容响应格式不正确。');
    }
    return {
        schemaVersion: 1,
        id: object.id,
        name: object.name,
        environmentId: object.environmentId,
        action: object.action,
        ...typeof object.startUrl === 'string'
            ? { startUrl: object.startUrl }
            : {},
        ...execution ? { execution } : {}
    };
}

function parseExecution(
    value: unknown
): TestDefinitionDto['execution'] | undefined {
    if (value === undefined) {
        return undefined;
    }
    const object = getObject(value);
    if (
        !object
        || object.planRef !== undefined && typeof object.planRef !== 'string'
        || object.preferredMode !== undefined
            && object.preferredMode !== 'ai-explore'
            && object.preferredMode !== 'auto'
            && object.preferredMode !== 'structured-replay'
    ) {
        throw new TestDefinitionRequestError('用例执行配置响应格式不正确。');
    }
    return {
        ...typeof object.planRef === 'string'
            ? { planRef: object.planRef }
            : {},
        ...typeof object.preferredMode === 'string'
            ? { preferredMode: object.preferredMode as NonNullable<
                TestDefinitionDto['execution']
            >['preferredMode'] }
            : {}
    };
}

function getObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
