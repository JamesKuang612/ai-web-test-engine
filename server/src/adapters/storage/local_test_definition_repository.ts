import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
    RunMode,
    TestDefinition,
} from '@ai-web-test-engine/core';
import {
    parseDocument,
    stringify,
} from 'yaml';

const TEST_FILE_SUFFIX = '.test.yaml';
const TEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const RUN_MODES = new Set<RunMode>([
    'ai-explore',
    'auto',
    'structured-replay'
]);

export interface TestDefinitionRecord {
    definition: TestDefinition;
    fileName: string;
    updatedAt: string;
}

export interface TestDefinitionRepository {
    delete: (id: string) => Promise<boolean>;
    list: () => Promise<TestDefinitionRecord[]>;
    load: (id: string) => Promise<TestDefinition | undefined>;
    loadRecord: (id: string) => Promise<TestDefinitionRecord | undefined>;
    save: (definition: TestDefinition) => Promise<TestDefinitionRecord>;
}

/** 在项目 tests 目录中安全读写可纳入 Git 管理的 YAML 用例。 */
export class LocalTestDefinitionRepository
implements TestDefinitionRepository {
    constructor(
        private readonly rootDirectory = resolveDefaultTestRoot()
    ) {}

    public async list(): Promise<TestDefinitionRecord[]> {
        await fsPromises.mkdir(this.rootDirectory, { recursive: true });
        const names = (await fsPromises.readdir(this.rootDirectory))
            .filter((name) => name.endsWith(TEST_FILE_SUFFIX))
            .sort();
        const records = await Promise.all(
            names.map((fileName) => this.loadFile(fileName))
        );
        const ids = new Set<string>();
        for (const record of records) {
            if (ids.has(record.definition.id)) {
                throw new Error(
                    `存在重复的用例 id：${ record.definition.id }。`
                );
            }
            ids.add(record.definition.id);
        }
        return records;
    }

    public async load(id: string): Promise<TestDefinition | undefined> {
        return (await this.loadRecord(id))?.definition;
    }

    public async loadRecord(
        id: string
    ): Promise<TestDefinitionRecord | undefined> {
        requireTestId(id);
        return (await this.list()).find(
            (record) => record.definition.id === id
        );
    }

    public async delete(id: string): Promise<boolean> {
        const record = await this.loadRecord(id);
        if (!record) {
            return false;
        }
        await fsPromises.rm(this.filePath(record.fileName));
        return true;
    }

    public async save(
        definition: TestDefinition
    ): Promise<TestDefinitionRecord> {
        const normalized = parseTestDefinition(definition);
        await fsPromises.mkdir(this.rootDirectory, { recursive: true });
        const records = await this.list();
        const existing = records.find(
            (record) => record.definition.id === normalized.id
        );
        const fileName = createAvailableFileName(
            normalized.name,
            normalized.id,
            records
                .filter((record) => record.definition.id !== normalized.id)
                .map((record) => record.fileName)
        );
        const target = this.filePath(fileName);
        const temporary = path.join(
            this.rootDirectory,
            `.${ fileName }.${ process.pid }.${ randomUUID() }.tmp`
        );
        const content = stringify(normalized, {
            lineWidth: 0
        });
        await fsPromises.writeFile(temporary, content, {
            encoding: 'utf8',
            flag: 'wx'
        });
        try {
            await fsPromises.rename(temporary, target);
            if (existing && existing.fileName !== fileName) {
                try {
                    await fsPromises.rm(this.filePath(existing.fileName));
                } catch (error) {
                    await fsPromises.rm(target, { force: true });
                    throw error;
                }
            }
        } catch (error) {
            await fsPromises.rm(temporary, { force: true });
            throw error;
        }
        const stat = await fsPromises.stat(target);
        return {
            definition: normalized,
            fileName,
            updatedAt: stat.mtime.toISOString()
        };
    }

    private filePath(fileName: string): string {
        if (
            path.basename(fileName) !== fileName
            || !fileName.endsWith(TEST_FILE_SUFFIX)
        ) {
            throw new Error('用例文件名不合法。');
        }
        return path.join(this.rootDirectory, fileName);
    }

    private async loadFile(fileName: string): Promise<TestDefinitionRecord> {
        const target = this.filePath(fileName);
        const content = await fsPromises.readFile(target, 'utf8');
        const document = parseDocument(content, {
            uniqueKeys: true
        });
        if (document.errors.length > 0) {
            throw new Error(
                `用例 ${ fileName } 的 YAML 无法解析：${
                    document.errors[0].message
                }`
            );
        }
        const definition = parseTestDefinition(document.toJS({
            maxAliasCount: 0
        }));
        const stat = await fsPromises.stat(target);
        return {
            definition,
            fileName,
            updatedAt: stat.mtime.toISOString()
        };
    }
}

/** 根据用例名称生成可在 Windows/macOS/Linux 使用的中文 YAML 文件名。 */
export function createAvailableFileName(
    name: string,
    id: string,
    occupiedFileNames: string[]
): string {
    const normalized = name
        .normalize('NFKC')
        .replace(/[\u0000-\u001f<>:"/\\|?*]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .replace(/[. ]+$/gu, '')
        .trim();
    const truncated = Array.from(normalized).slice(0, 80).join('');
    const fallback = `测试用例-${ id }`;
    const safeBase = isWindowsReservedName(truncated)
        ? `${ truncated }-用例`
        : truncated || fallback;
    const occupied = new Set(
        occupiedFileNames.map((fileName) => fileName.toLocaleLowerCase())
    );
    for (let suffix = 1; suffix <= 100; suffix += 1) {
        const candidate = suffix === 1
            ? `${ safeBase }${ TEST_FILE_SUFFIX }`
            : `${ safeBase }（${ suffix }）${ TEST_FILE_SUFFIX }`;
        if (!occupied.has(candidate.toLocaleLowerCase())) {
            return candidate;
        }
    }
    throw new Error(`无法为用例“${ name }”生成不重复的文件名。`);
}

function isWindowsReservedName(value: string): boolean {
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value);
}

/** 对本地 YAML 内容进行白名单字段和类型校验。 */
export function parseTestDefinition(value: unknown): TestDefinition {
    const object = requireObject(value, 'TestDefinition');
    requireAllowedFields(object, [
        'schemaVersion',
        'id',
        'name',
        'environmentId',
        'startUrl',
        'action',
        'execution'
    ], 'TestDefinition');
    if (object.schemaVersion !== 1) {
        throw new Error('TestDefinition.schemaVersion 必须等于 1。');
    }
    const id = requireString(object.id, 'TestDefinition.id');
    requireTestId(id);
    const startUrl = object.startUrl === undefined
        ? undefined
        : requireString(object.startUrl, 'TestDefinition.startUrl');
    const execution = object.execution === undefined
        ? undefined
        : parseExecution(object.execution);
    return {
        schemaVersion: 1,
        id,
        name: requireString(object.name, 'TestDefinition.name'),
        environmentId: requireString(
            object.environmentId,
            'TestDefinition.environmentId'
        ),
        ...startUrl ? { startUrl } : {},
        action: requireAction(object.action),
        ...execution ? { execution } : {}
    };
}

/** 测试刚创建时允许没有步骤；运行入口仍会拒绝空 action。 */
function requireAction(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('TestDefinition.action 必须是字符串。');
    }
    return value.trim();
}

function parseExecution(value: unknown): TestDefinition['execution'] {
    const object = requireObject(value, 'TestDefinition.execution');
    requireAllowedFields(object, [
        'planRef',
        'preferredMode',
        'setupModules'
    ], 'TestDefinition.execution');
    const planRef = object.planRef === undefined
        ? undefined
        : requireString(object.planRef, 'TestDefinition.execution.planRef');
    const preferredMode = object.preferredMode === undefined
        ? undefined
        : requireRunMode(object.preferredMode);
    const setupModules = object.setupModules === undefined
        ? undefined
        : requireSetupModules(object.setupModules);
    return {
        ...planRef ? { planRef } : {},
        ...preferredMode ? { preferredMode } : {},
        ...setupModules ? { setupModules } : {}
    };
}

function requireSetupModules(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error('TestDefinition.execution.setupModules 必须是数组。');
    }
    const modules = value.map((item) => requireString(
        item,
        'TestDefinition.execution.setupModules[]'
    ));
    if (
        modules.some((item) => item !== 'jiandaoyun-login')
        || new Set(modules).size !== modules.length
    ) {
        throw new Error(
            'TestDefinition.execution.setupModules 包含不支持或重复的模块。'
        );
    }
    return modules;
}

function resolveDefaultTestRoot(): string {
    let current = path.resolve(process.cwd());
    while (true) {
        const manifestPath = path.join(current, 'package.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(
                    fs.readFileSync(manifestPath, 'utf8')
                ) as { name?: string, workspaces?: unknown };
                if (
                    manifest.name === 'ai-web-test-engine'
                    && Array.isArray(manifest.workspaces)
                ) {
                    return path.join(current, 'tests');
                }
            } catch {
                // 继续向父级查找可信工作区根目录。
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(process.cwd(), 'tests');
        }
        current = parent;
    }
}

function requireTestId(value: string): void {
    if (!TEST_ID_PATTERN.test(value)) {
        throw new Error('用例 id 只能包含小写字母、数字和连字符。');
    }
}

function requireRunMode(value: unknown): RunMode {
    const mode = requireString(value, 'TestDefinition.execution.preferredMode');
    if (!RUN_MODES.has(mode as RunMode)) {
        throw new Error(`不支持的运行模式：${ mode }。`);
    }
    return mode as RunMode;
}

function requireObject(
    value: unknown,
    pathLabel: string
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${ pathLabel } 必须是对象。`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, pathLabel: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${ pathLabel } 必须是非空字符串。`);
    }
    return value.trim();
}

function requireAllowedFields(
    object: Record<string, unknown>,
    fields: string[],
    pathLabel: string
): void {
    const unexpected = Object.keys(object).find(
        (field) => !fields.includes(field)
    );
    if (unexpected) {
        throw new Error(`${ pathLabel }.${ unexpected } 不允许出现。`);
    }
}
