import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
    ActionCommand,
    ActionResult,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    CompiledTarget,
    JsonValue,
    PageObservation,
    ResolvedTarget,
    VisualGroundingResult,
} from '@ai-web-test-engine/core';
import {
    CompiledTargetResolver,
} from '@ai-web-test-engine/core';

const LOGIN_MODULE_ID = 'jiandaoyun-login';
const CACHE_TTL_MS = 8 * 60 * 60 * 1_000;
const CACHE_KEY_PATTERN = /^[a-z0-9._-]+$/u;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;

const USERNAME_TARGET: CompiledTarget = {
    description: '简道云登录账号输入框',
    locatorHints: [
        { strategy: 'placeholder', value: '手机号/邮箱' },
        { strategy: 'role-name', value: 'textbox|手机号/邮箱' }
    ],
    identity: {
        tag: 'input',
        role: 'textbox',
        name: '手机号/邮箱',
        placeholder: '手机号/邮箱',
        inputType: 'text'
    }
};

const PASSWORD_TARGET: CompiledTarget = {
    description: '简道云登录密码输入框',
    locatorHints: [
        { strategy: 'placeholder', value: '密码' },
        { strategy: 'role-name', value: 'textbox|密码' }
    ],
    identity: {
        tag: 'input',
        role: 'textbox',
        name: '密码',
        placeholder: '密码',
        inputType: 'password'
    }
};

const LOGIN_BUTTON_TARGET: CompiledTarget = {
    description: '简道云登录按钮',
    locatorHints: [
        { strategy: 'css', value: 'button' },
        { strategy: 'role-name', value: 'button|登录' },
        { strategy: 'text', value: '登录' }
    ],
    identity: {
        tag: 'button',
        role: 'button',
        name: '登录',
        text: '登录'
    }
};

interface SessionLoginState {
    cacheLoaded: boolean;
    ensured: boolean;
}

interface CachedStorageState {
    expiresAt: number;
    state: JsonValue;
}

export interface JiandaoyunLoginBrowserAdapterOptions {
    cacheRoot: string;
    password?: string;
    startUrl: string;
    username?: string;
}

/**
 * 在业务导航和 AI 探索之间插入可复用的简道云登录模块。
 * 登录态仅写入本机私有缓存，结构化步骤只使用环境变量的内存值。
 */
export class JiandaoyunLoginBrowserAdapter implements BrowserAdapter {
    private readonly cache: LocalStorageStateCache;
    private readonly cacheKey: string;
    private readonly sessionStates = new Map<string, SessionLoginState>();
    private readonly targetResolver = new CompiledTargetResolver();

    constructor(
        private readonly delegate: BrowserAdapter,
        private readonly options: JiandaoyunLoginBrowserAdapterOptions
    ) {
        const hostname = new URL(options.startUrl).hostname.toLowerCase();
        const accountHash = createHash('sha256')
            .update(options.username ?? 'missing-account')
            .digest('hex')
            .slice(0, 16);
        this.cacheKey = `${ LOGIN_MODULE_ID }.${ hostname }.${ accountHash }`;
        this.cache = new LocalStorageStateCache(options.cacheRoot);
    }

    public start = async (
        options: BrowserStartOptions
    ): Promise<BrowserSession> => {
        const cachedState = await this.cache.load(this.cacheKey);
        let session: BrowserSession;
        try {
            session = await this.delegate.start({
                ...options,
                ...cachedState ? { storageState: cachedState } : {}
            });
        } catch (error) {
            if (!cachedState) {
                throw error;
            }
            await this.cache.clear(this.cacheKey);
            session = await this.delegate.start(options);
        }
        this.sessionStates.set(session.sessionId, {
            cacheLoaded: cachedState !== undefined,
            ensured: false
        });
        return session;
    };

    public observe: BrowserAdapter['observe'] = (session) =>
        this.delegate.observe(session);

    public execute = async (
        session: BrowserSession,
        command: ActionCommand,
        target?: ResolvedTarget
    ): Promise<ActionResult> => {
        const result = await this.delegate.execute(session, command, target);
        const state = this.requireSessionState(session);
        if (
            command.type !== 'NAVIGATE'
            || result.status !== 'executed'
            || state.ensured
        ) {
            return result;
        }

        try {
            await this.ensureLoggedIn(session, state);
            state.ensured = true;
            return result;
        } catch (error) {
            return {
                ...result,
                status: 'failed',
                finishedAt: new Date().toISOString(),
                error: {
                    code: 'LOGIN_MODULE_FAILED',
                    message: error instanceof Error
                        ? error.message
                        : '简道云登录模块执行失败。'
                }
            };
        }
    };

    public captureScreenshot: BrowserAdapter['captureScreenshot'] =
        (session) => this.delegate.captureScreenshot(session);

    public captureStorageState = async (
        session: BrowserSession
    ): Promise<JsonValue> => {
        if (!this.delegate.captureStorageState) {
            throw new Error('当前浏览器不支持导出登录态。');
        }
        return await this.delegate.captureStorageState(session);
    };

    public enhanceObservationWithVision = async (
        session: BrowserSession,
        observation: PageObservation,
        signal: AbortSignal
    ): Promise<VisualGroundingResult> => {
        if (!this.delegate.enhanceObservationWithVision) {
            return {
                status: 'unsupported',
                summary: '当前浏览器未接入视觉定位。'
            };
        }
        return await this.delegate.enhanceObservationWithVision(
            session,
            observation,
            signal
        );
    };

    public reset: BrowserAdapter['reset'] = (session) =>
        this.delegate.reset(session);

    public close = async (session: BrowserSession): Promise<void> => {
        this.sessionStates.delete(session.sessionId);
        await this.delegate.close(session);
    };

    private async ensureLoggedIn(
        session: BrowserSession,
        state: SessionLoginState
    ): Promise<void> {
        let observation = await this.delegate.observe(session);
        if (this.isLoggedIn(observation)) {
            await this.saveCurrentState(session);
            return;
        }
        if (state.cacheLoaded) {
            await this.cache.clear(this.cacheKey);
        }
        if (!this.options.username || !this.options.password) {
            throw new Error(
                '登录模块缺少本机环境变量 JIANDAOYUN_USERNAME 或 JIANDAOYUN_PASSWORD。'
            );
        }

        observation = await this.executeTargetedStep(
            session,
            observation,
            'TYPE',
            USERNAME_TARGET,
            this.options.username
        );
        observation = await this.executeTargetedStep(
            session,
            observation,
            'TYPE',
            PASSWORD_TARGET,
            this.options.password
        );
        observation = await this.executeTargetedStep(
            session,
            observation,
            'CLICK',
            LOGIN_BUTTON_TARGET
        );

        for (let attempt = 0; attempt < 5 && !this.isLoggedIn(observation);
            attempt += 1) {
            const waitResult = await this.delegate.execute(session, {
                type: 'WAIT',
                value: { source: 'literal', value: 1_000 },
                reasonSummary: '等待结构化登录完成跳转',
                risk: 'read-only'
            });
            if (waitResult.status !== 'executed') {
                break;
            }
            observation = await this.delegate.observe(session);
        }
        if (!this.isLoggedIn(observation)) {
            throw new Error('结构化登录已执行，但未进入简道云工作台。');
        }
        await this.saveCurrentState(session);
    }

    private async executeTargetedStep(
        session: BrowserSession,
        observation: PageObservation,
        type: 'CLICK' | 'TYPE',
        target: CompiledTarget,
        value?: string
    ): Promise<PageObservation> {
        const element = this.targetResolver.resolve(target, observation);
        const result = await this.delegate.execute(session, {
            type,
            target: {
                candidateId: element.candidateId,
                description: target.description
            },
            ...value === undefined
                ? {}
                : { value: { source: 'literal' as const, value } },
            expectedEffect: type === 'TYPE'
                ? '登录输入框完成填写'
                : '提交登录并进入工作台',
            reasonSummary: `登录模块执行结构化 ${ type } 步骤`,
            risk: 'reversible'
        });
        if (result.status !== 'executed') {
            throw new Error(
                `登录模块无法执行${ target.description }：${
                    result.error?.message ?? result.status
                }`
            );
        }
        return await this.delegate.observe(session);
    }

    private isLoggedIn(observation: PageObservation): boolean {
        try {
            const url = new URL(observation.page.url);
            const loginFormVisible = observation.interactiveElements.some(
                (element) => (
                    element.visible
                    && (
                        element.placeholder === '手机号/邮箱'
                        || element.placeholder === '密码'
                        || element.role === 'button' && element.name === '登录'
                    )
                )
            );
            return url.pathname.startsWith('/dashboard')
                && !loginFormVisible;
        } catch {
            return false;
        }
    }

    private async saveCurrentState(session: BrowserSession): Promise<void> {
        if (!this.delegate.captureStorageState) {
            return;
        }
        await this.cache.save(
            this.cacheKey,
            await this.delegate.captureStorageState(session)
        );
    }

    private requireSessionState(session: BrowserSession): SessionLoginState {
        const state = this.sessionStates.get(session.sessionId);
        if (!state) {
            throw new Error(`登录模块找不到浏览器会话：${ session.sessionId }。`);
        }
        return state;
    }
}

/** 本机私有、带过期时间且原子写入的浏览器 storageState 缓存。 */
class LocalStorageStateCache {
    constructor(private readonly rootDirectory: string) {}

    public async load(key: string): Promise<JsonValue | undefined> {
        const filePath = this.filePath(key);
        try {
            const stat = await fs.stat(filePath);
            if (stat.size > MAX_CACHE_BYTES) {
                await this.clear(key);
                return undefined;
            }
            const parsed = JSON.parse(
                await fs.readFile(filePath, 'utf8')
            ) as unknown;
            if (!isCachedStorageState(parsed) || parsed.expiresAt <= Date.now()) {
                await this.clear(key);
                return undefined;
            }
            return parsed.state;
        } catch (error) {
            if (hasErrorCode(error, 'ENOENT')) {
                return undefined;
            }
            await this.clear(key);
            return undefined;
        }
    }

    public async save(key: string, state: JsonValue): Promise<void> {
        const filePath = this.filePath(key);
        await fs.mkdir(this.rootDirectory, { recursive: true });
        const temporary = `${ filePath }.${ randomUUID() }.tmp`;
        await fs.writeFile(temporary, JSON.stringify({
            expiresAt: Date.now() + CACHE_TTL_MS,
            state
        }), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
        });
        await fs.rename(temporary, filePath);
    }

    public async clear(key: string): Promise<void> {
        await fs.rm(this.filePath(key), { force: true });
    }

    private filePath(key: string): string {
        if (!CACHE_KEY_PATTERN.test(key)) {
            throw new Error('登录态缓存键不安全。');
        }
        return path.join(this.rootDirectory, `${ key }.json`);
    }
}

function isCachedStorageState(value: unknown): value is CachedStorageState {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const object = value as Record<string, unknown>;
    return typeof object.expiresAt === 'number'
        && isJsonValue(object.state);
}

function isJsonValue(value: unknown): value is JsonValue {
    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    return typeof value === 'object'
        && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function hasErrorCode(error: unknown, code: string): boolean {
    return error instanceof Error
        && 'code' in error
        && error.code === code;
}
