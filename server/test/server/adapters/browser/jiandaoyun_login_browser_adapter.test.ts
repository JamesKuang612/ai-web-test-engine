import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
    ActionCommand,
    ActionResult,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    JsonValue,
    PageObservation,
} from '@ai-web-test-engine/core';
import {
    JiandaoyunLoginBrowserAdapter,
} from '../../../../src/adapters/browser';

describe('JiandaoyunLoginBrowserAdapter', () => {
    let cacheRoot = '';

    beforeEach(async () => {
        cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jdy-auth-cache-'));
    });

    afterEach(async () => {
        await fs.rm(cacheRoot, { force: true, recursive: true });
    });

    it('缓存缺失时结构化登录并保存 storageState', async () => {
        const delegate = new FakeBrowserAdapter([
            loginObservation(),
            loginObservation(),
            loginObservation(),
            dashboardObservation()
        ]);
        const adapter = createAdapter(delegate, cacheRoot);
        const session = await adapter.start(browserOptions());
        const result = await adapter.execute(session, navigateCommand());

        assert.equal(result.status, 'executed');
        assert.deepEqual(
            delegate.commands.map((command) => command.type),
            [ 'NAVIGATE', 'TYPE', 'TYPE', 'CLICK' ]
        );
        assert.equal(delegate.captureStorageStateCalls, 1);
        assert.equal((await fs.readdir(cacheRoot)).length, 1);
        await adapter.close(session);
    });

    it('缓存命中且仍有效时直接进入业务页面', async () => {
        const firstDelegate = new FakeBrowserAdapter([
            loginObservation(),
            loginObservation(),
            loginObservation(),
            dashboardObservation()
        ]);
        const firstAdapter = createAdapter(firstDelegate, cacheRoot);
        const firstSession = await firstAdapter.start(browserOptions());
        await firstAdapter.execute(firstSession, navigateCommand());
        await firstAdapter.close(firstSession);

        const cachedDelegate = new FakeBrowserAdapter([
            dashboardObservation()
        ]);
        const cachedAdapter = createAdapter(cachedDelegate, cacheRoot);
        const cachedSession = await cachedAdapter.start(browserOptions());
        const result = await cachedAdapter.execute(
            cachedSession,
            navigateCommand()
        );

        assert.equal(result.status, 'executed');
        assert.deepEqual(
            cachedDelegate.commands.map((command) => command.type),
            [ 'NAVIGATE' ]
        );
        assert.deepEqual(cachedDelegate.startOptions?.storageState, {
            cookies: [],
            origins: []
        });
        await cachedAdapter.close(cachedSession);
    });

    it('缓存过期时丢弃旧状态并重新结构化登录', async () => {
        const accountHash = createHash('sha256')
            .update('fixture@example.com')
            .digest('hex')
            .slice(0, 16);
        await fs.writeFile(
            path.join(
                cacheRoot,
                `jiandaoyun-login.www.jiandaoyun.com.${ accountHash }.json`
            ),
            JSON.stringify({
                expiresAt: Date.now() - 1,
                state: { cookies: [], origins: [] }
            }),
            'utf8'
        );
        const delegate = new FakeBrowserAdapter([
            loginObservation(),
            loginObservation(),
            loginObservation(),
            dashboardObservation()
        ]);
        const adapter = createAdapter(delegate, cacheRoot);
        const session = await adapter.start(browserOptions());

        assert.equal(delegate.startOptions?.storageState, undefined);
        const result = await adapter.execute(session, navigateCommand());
        assert.equal(result.status, 'executed');
        assert.deepEqual(
            delegate.commands.map((command) => command.type),
            [ 'NAVIGATE', 'TYPE', 'TYPE', 'CLICK' ]
        );
        await adapter.close(session);
    });
});

function createAdapter(
    delegate: BrowserAdapter,
    cacheRoot: string
): JiandaoyunLoginBrowserAdapter {
    return new JiandaoyunLoginBrowserAdapter(delegate, {
        cacheRoot,
        password: 'fixture-password',
        startUrl: 'https://www.jiandaoyun.com/dashboard#/',
        username: 'fixture@example.com'
    });
}

function browserOptions(): BrowserStartOptions {
    return {
        headless: true,
        viewport: { width: 1280, height: 720 }
    };
}

function navigateCommand(): ActionCommand {
    return {
        type: 'NAVIGATE',
        value: {
            source: 'literal',
            value: 'https://www.jiandaoyun.com/dashboard#/'
        },
        reasonSummary: '打开工作台',
        risk: 'read-only'
    };
}

function loginObservation(): PageObservation {
    return observation('https://www.jiandaoyun.com/dashboard#/', [
        {
            candidateId: 'username',
            tag: 'input',
            role: 'textbox',
            name: '手机号/邮箱',
            placeholder: '手机号/邮箱',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: { type: 'text' },
            nearbyText: [],
            locatorHints: [
                { strategy: 'placeholder', value: '手机号/邮箱' },
                { strategy: 'role-name', value: 'textbox|手机号/邮箱' }
            ]
        },
        {
            candidateId: 'password',
            tag: 'input',
            role: 'textbox',
            name: '密码',
            placeholder: '密码',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: { type: 'password' },
            nearbyText: [],
            locatorHints: [
                { strategy: 'placeholder', value: '密码' },
                { strategy: 'role-name', value: 'textbox|密码' }
            ]
        },
        {
            candidateId: 'login',
            tag: 'button',
            role: 'button',
            name: '登录',
            text: '登录',
            disabled: false,
            visible: true,
            inViewport: true,
            attributes: {},
            nearbyText: [],
            locatorHints: [
                { strategy: 'css', value: 'button' },
                { strategy: 'role-name', value: 'button|登录' },
                { strategy: 'text', value: '登录' }
            ]
        }
    ]);
}

function dashboardObservation(): PageObservation {
    return observation('https://www.jiandaoyun.com/dashboard#/', []);
}

function observation(
    url: string,
    interactiveElements: PageObservation['interactiveElements']
): PageObservation {
    return {
        schemaVersion: 1,
        observationId: `observation-${ url }`,
        capturedAt: new Date().toISOString(),
        page: {
            loading: false,
            title: '简道云',
            url,
            viewport: { width: 1280, height: 720 }
        },
        visibleText: [],
        interactiveElements,
        notices: [],
        tabs: [],
        stateFingerprint: url,
        truncated: false
    };
}

class FakeBrowserAdapter implements BrowserAdapter {
    public readonly commands: ActionCommand[] = [];
    public captureStorageStateCalls = 0;
    public startOptions?: BrowserStartOptions;
    private observationIndex = 0;

    constructor(private readonly observations: PageObservation[]) {}

    public start = async (
        options: BrowserStartOptions
    ): Promise<BrowserSession> => {
        this.startOptions = options;
        return { sessionId: 'fake-session' };
    };

    public observe = async (): Promise<PageObservation> => {
        const observation = this.observations[
            Math.min(this.observationIndex, this.observations.length - 1)
        ];
        this.observationIndex += 1;
        if (!observation) {
            throw new Error('测试未提供页面观察。');
        }
        return observation;
    };

    public execute = async (
        _session: BrowserSession,
        command: ActionCommand
    ): Promise<ActionResult> => {
        this.commands.push(command);
        const now = new Date().toISOString();
        return {
            status: 'executed',
            startedAt: now,
            finishedAt: now,
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: command.type === 'NAVIGATE' || command.type === 'CLICK'
            }
        };
    };

    public captureScreenshot: BrowserAdapter['captureScreenshot'] = async () => ({
        content: new Uint8Array(),
        mediaType: 'image/png'
    });

    public captureStorageState = async (): Promise<JsonValue> => {
        this.captureStorageStateCalls += 1;
        return { cookies: [], origins: [] };
    };

    public reset = async (): Promise<void> => undefined;
    public close = async (): Promise<void> => undefined;
}
