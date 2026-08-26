import { randomUUID } from 'node:crypto';
import type {
    TestDefinition,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import {
    LocalTestDefinitionRepository,
    type TestDefinitionRecord,
    type TestDefinitionRepository,
} from '../adapters/storage/local_test_definition_repository';
import {
    JIANDAOYUN_ALLOWED_HOSTS,
} from './debug_test_context';

export interface TestDefinitionDraft {
    action?: unknown;
    name?: unknown;
    planRef?: unknown;
    startUrl?: unknown;
}

const PLAN_REF_PATTERN =
    /^[a-zA-Z0-9_-]+\/json\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/u;

/** 表示用例仓库接口收到的字段不合法。 */
export class TestDefinitionInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TestDefinitionInputError';
    }
}

/** 表示请求的真实 YAML 用例不存在。 */
export class TestDefinitionNotFoundError extends Error {
    constructor(id: string) {
        super(`没有找到测试用例：${ id }。`);
        this.name = 'TestDefinitionNotFoundError';
    }
}

/** 管理项目 tests 目录中的真实 TestDefinition 文件。 */
@service()
export class TestDefinitionService {
    constructor(
        private readonly repository: TestDefinitionRepository =
            new LocalTestDefinitionRepository()
    ) {}

    public list(): Promise<TestDefinitionRecord[]> {
        return this.repository.list();
    }

    public async get(id: string): Promise<TestDefinition> {
        const normalizedId = this.normalizeId(id);
        const definition = await this.repository.load(normalizedId);
        if (!definition) {
            throw new TestDefinitionNotFoundError(normalizedId);
        }
        return definition;
    }

    public async create(
        draft: TestDefinitionDraft
    ): Promise<TestDefinitionRecord> {
        const fields = this.normalizeDraft(draft);
        const id = await this.createAvailableId(fields.name);
        return await this.repository.save({
            schemaVersion: 1,
            id,
            name: fields.name,
            environmentId: 'jiandaoyun-test',
            startUrl: fields.startUrl,
            action: fields.action,
            ...fields.planRef
                ? {
                    execution: {
                        planRef: fields.planRef,
                        preferredMode: 'structured-replay' as const
                    }
                }
                : {}
        });
    }

    public async update(
        id: string,
        draft: TestDefinitionDraft
    ): Promise<TestDefinitionRecord> {
        const normalizedId = this.normalizeId(id);
        const existing = await this.repository.load(normalizedId);
        if (!existing) {
            throw new TestDefinitionNotFoundError(normalizedId);
        }
        const fields = this.normalizeDraft(draft);
        const execution = fields.planRef === undefined
            ? existing.execution
            : fields.planRef === null
                ? undefined
                : {
                    planRef: fields.planRef,
                    preferredMode: 'structured-replay' as const
                };
        return await this.repository.save({
            schemaVersion: 1,
            id: normalizedId,
            name: fields.name,
            environmentId: 'jiandaoyun-test',
            startUrl: fields.startUrl,
            action: fields.action,
            ...execution ? { execution } : {}
        });
    }

    private normalizeDraft(draft: TestDefinitionDraft): {
        action: string,
        name: string,
        planRef: null | string | undefined,
        startUrl: string
    } {
        return {
            action: this.normalizeString(
                draft.action,
                'action',
                10_000
            ),
            name: this.normalizeString(
                draft.name,
                'name',
                120
            ),
            planRef: this.normalizePlanRef(draft.planRef),
            startUrl: this.normalizeStartUrl(draft.startUrl)
        };
    }

    private normalizePlanRef(value: unknown): null | string | undefined {
        if (value === undefined || value === null) {
            return value;
        }
        if (typeof value !== 'string' || !PLAN_REF_PATTERN.test(value)) {
            throw new TestDefinitionInputError(
                'planRef 必须是合法的运行产物 JSON 引用。'
            );
        }
        return value;
    }

    private normalizeStartUrl(value: unknown): string {
        const rawUrl = this.normalizeString(value, 'startUrl', 2_048);
        let url: URL;
        try {
            url = new URL(rawUrl);
        } catch {
            throw new TestDefinitionInputError('startUrl 必须是合法 URL。');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new TestDefinitionInputError(
                'startUrl 只允许 HTTP 或 HTTPS。'
            );
        }
        if (url.username || url.password) {
            throw new TestDefinitionInputError(
                'startUrl 不得包含账号或密码。'
            );
        }
        if (!JIANDAOYUN_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
            throw new TestDefinitionInputError(
                `startUrl 只允许以下 Host：${
                    JIANDAOYUN_ALLOWED_HOSTS.join('、')
                }。`
            );
        }
        return url.toString();
    }

    private normalizeString(
        value: unknown,
        field: string,
        maxLength: number
    ): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new TestDefinitionInputError(
                `${ field } 必须是非空字符串。`
            );
        }
        const normalized = value.trim();
        if (normalized.length > maxLength) {
            throw new TestDefinitionInputError(
                `${ field } 长度不能超过 ${ maxLength } 个字符。`
            );
        }
        return normalized;
    }

    private normalizeId(value: string): string {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) {
            throw new TestDefinitionInputError(
                '测试用例 id 只能包含小写字母、数字和连字符。'
            );
        }
        return value;
    }

    private async createAvailableId(name: string): Promise<string> {
        const slug = name
            .normalize('NFKD')
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, '-')
            .replace(/^-+|-+$/gu, '')
            .slice(0, 48);
        const base = slug || `test-${ randomUUID().slice(0, 8) }`;
        if (!await this.repository.load(base)) {
            return base;
        }
        for (let suffix = 2; suffix <= 100; suffix += 1) {
            const candidate = `${ base.slice(0, 60) }-${ suffix }`;
            if (!await this.repository.load(candidate)) {
                return candidate;
            }
        }
        throw new TestDefinitionInputError('无法生成可用的测试用例 id。');
    }
}
