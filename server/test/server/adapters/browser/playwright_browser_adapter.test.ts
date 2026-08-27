import assert from 'node:assert/strict';
import http from 'node:http';
import type {
    AddressInfo,
} from 'node:net';
import {
    describe,
    it,
} from 'mocha';
import type {
    Page,
} from 'playwright';
import {
    errors,
} from 'playwright';
import type {
    ActionCommand,
    BrowserSession,
} from '@ai-web-test-engine/core';
import {
    PlaywrightBrowserAdapter,
} from '../../../../src/adapters/browser/playwright_browser_adapter';

const START_OPTIONS = {
    headless: true,
    viewport: {
        width: 1280,
        height: 720
    }
};
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('PlaywrightBrowserAdapter', () => {
    it('启动独立 Chromium 会话并在使用后正常关闭', async () => {
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);

            assert.match(
                session.sessionId,
                UUID_PATTERN
            );

            await adapter.close(session);
            session = undefined;
        } finally {
            if (session) {
                await adapter.close(session);
            }
        }
    }).timeout(15_000);

    it('拒绝操作不存在或已经关闭的浏览器会话', async () => {
        const adapter = new PlaywrightBrowserAdapter();

        await assert.rejects(
            adapter.close({
                sessionId: 'missing-session'
            }),
            /浏览器会话不存在或已经关闭/u
        );
    });

    it('执行 NAVIGATE 并返回页面地址变化信号', async () => {
        const testServer = await startTestHttpServer();
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);

            const result = await adapter.execute(
                session,
                createNavigateCommand(`${ testServer.url }/login`)
            );

            assert.equal(result.status, 'executed');
            assert.equal(result.error, undefined);
            assert.deepEqual(result.browserSignals, {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: true
            });
            assert.equal(testServer.wasRequested(), true);
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('观察当前页面的基础状态并生成稳定指纹', async () => {
        const testServer = await startTestHttpServer();
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(`${ testServer.url }/login`)
            );

            const first = await adapter.observe(session);
            const second = await adapter.observe(session);

            assert.match(first.observationId, UUID_PATTERN);
            assert.equal(first.page.title, '登录测试页');
            assert.equal(
                first.page.url,
                `${ testServer.url }/login`
            );
            assert.deepEqual(
                first.page.viewport,
                START_OPTIONS.viewport
            );
            assert.equal(first.page.loading, false);
            assert.deepEqual(first.visibleText, [
                '登录简道云',
                '请输入账号和密码',
                '登录'
            ]);
            assert.equal(first.interactiveElements.length, 3);
            assert.equal(
                first.interactiveElements[0]?.name,
                '手机号或邮箱'
            );
            assert.equal(
                first.interactiveElements[0]?.valueState,
                'empty'
            );
            assert.equal(
                first.interactiveElements[1]?.valueState,
                'empty'
            );
            assert.equal(
                first.interactiveElements[2]?.role,
                'button'
            );
            assert.deepEqual(first.notices, []);
            assert.deepEqual(first.tabs, [{
                active: true,
                title: '登录测试页',
                url: `${ testServer.url }/login`
            }]);
            assert.match(first.stateFingerprint, /^[0-9a-f]{64}$/u);
            assert.equal(
                first.stateFingerprint,
                second.stateFingerprint
            );
            assert.equal(first.truncated, false);
            assert.equal(first.screenshotRef, undefined);
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('根据最新页面观察的 candidateId 执行 TYPE', async () => {
        const testServer = await startTestHttpServer();
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(`${ testServer.url }/login`)
            );
            const before = await adapter.observe(session);
            const username = before.interactiveElements.find(
                (element) => element.name === '手机号或邮箱'
            );
            assert.ok(username);

            const result = await adapter.execute(session, {
                type: 'TYPE',
                target: {
                    candidateId: username.candidateId,
                    description: '手机号或邮箱输入框'
                },
                value: {
                    source: 'literal',
                    value: 'tester@example.com'
                },
                expectedEffect: '账号输入框变为已填写',
                reasonSummary: '填写登录账号',
                risk: 'reversible'
            });
            const after = await adapter.observe(session);

            assert.equal(result.status, 'executed');
            assert.equal(
                after.interactiveElements.find(
                    (element) => element.name === '手机号或邮箱'
                )?.valueState,
                'filled'
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('根据最新页面观察的 candidateId 执行 CLICK', async () => {
        const testServer = await startTestHttpServer([
            '<!doctype html><title>点击测试页</title><body>',
            '<button type="button" onclick="document.body.dataset.clicked = \'yes\'; this.textContent = \'已登录\'">登录</button>',
            '</body>'
        ].join(''));
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );
            const before = await adapter.observe(session);
            const loginButton = before.interactiveElements.find(
                (element) => element.name === '登录'
            );
            assert.ok(loginButton);

            const result = await adapter.execute(session, {
                type: 'CLICK',
                target: {
                    candidateId: loginButton.candidateId,
                    description: '登录按钮'
                },
                expectedEffect: '页面显示已登录',
                reasonSummary: '提交登录表单',
                risk: 'side-effect'
            });
            const after = await adapter.observe(session);

            assert.equal(result.status, 'executed');
            assert.equal(
                after.interactiveElements[0]?.name,
                '已登录'
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('识别并点击无标准按钮语义的用户头像', async () => {
        const testServer = await startTestHttpServer([
            '<!doctype html><title>工作台</title>',
            '<style>',
            '.topbar-user-avatar { cursor: pointer; width: 40px; height: 40px; }',
            '.topbar-user-avatar img { width: 32px; height: 32px; }',
            '</style><body><nav>工作台</nav>',
            '<div class="topbar-user-avatar" aria-haspopup="menu" ',
            'aria-expanded="false">',
            '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
            '</div><script>',
            'document.querySelector(\'.topbar-user-avatar\')',
            '.addEventListener(\'click\', function () { setTimeout(() => {',
            'this.setAttribute(\'aria-expanded\', \'true\');',
            'const menu = document.createElement(\'div\');',
            'menu.setAttribute(\'role\', \'menu\');',
            'menu.textContent = \'个人中心 退出登录\';',
            'document.body.appendChild(menu);',
            '}, 300); });',
            '</script></body>'
        ].join(''));
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );
            const before = await adapter.observe(session);
            const avatar = before.interactiveElements.find(
                (element) => element.name === 'topbar user avatar'
            );
            assert.ok(avatar);
            assert.equal(avatar.tag, 'div');
            assert.equal(avatar.role, 'button');
            assert.equal(
                before.interactiveElements.some(
                    (element) => element.tag === 'img'
                ),
                false
            );
            assert.deepEqual(avatar.locatorHints, [
                {
                    strategy: 'css',
                    value: 'div'
                },
                {
                    strategy: 'css',
                    value: '.topbar-user-avatar'
                },
                {
                    strategy: 'role-name',
                    value: 'button|topbar user avatar'
                }
            ]);

            const result = await adapter.execute(session, {
                type: 'CLICK',
                target: {
                    candidateId: avatar.candidateId,
                    description: '页面右上角用户头像'
                },
                expectedEffect: '展开账号菜单',
                reasonSummary: '检查账号菜单',
                risk: 'reversible'
            });
            const after = await adapter.observe(session);

            assert.equal(result.status, 'executed');
            assert.equal(
                after.visibleText.some((text) => text.includes('退出登录')),
                true,
                JSON.stringify({
                    result,
                    visibleText: after.visibleText,
                    interactiveElements: after.interactiveElements
                })
            );
            assert.equal(
                after.interactiveElements.find(
                    (element) => element.name === 'topbar user avatar'
                )?.attributes['aria-expanded'],
                'true'
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('点击预期跳转的按钮时等待异步导航完成', async () => {
        const testServer = await startTestHttpServer([
            '<!doctype html><title>异步登录页</title><body>',
            '<button type="button" onclick="setTimeout(() => { location.href = \'/dashboard\'; }, 300)">登录</button>',
            '</body>'
        ].join(''));
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );
            const before = await adapter.observe(session);
            const loginButton = before.interactiveElements.find(
                (element) => element.name === '登录'
            );
            assert.ok(loginButton);

            const result = await adapter.execute(session, {
                type: 'CLICK',
                target: {
                    candidateId: loginButton.candidateId,
                    description: '登录按钮'
                },
                expectedEffect: '跳转至工作台页面',
                reasonSummary: '提交登录表单',
                risk: 'side-effect'
            });
            const after = await adapter.observe(session);

            assert.equal(result.status, 'executed');
            assert.equal(result.browserSignals.urlChanged, true);
            assert.equal(after.page.url, `${ testServer.url }/dashboard`);
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('等待 SPA 延迟渲染出首个交互元素', async () => {
        const testServer = await startTestHttpServer([
            '<!doctype html><title>延迟登录页</title><body>',
            '<script>',
            'setTimeout(() => {',
            'document.body.innerHTML =',
            "'<input aria-label=\"账号\"><button>下一步</button>';",
            '}, 250);',
            '</script></body>'
        ].join(''));
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );

            const observation = await adapter.observe(session);

            assert.equal(observation.interactiveElements.length, 2);
            assert.equal(
                observation.interactiveElements[0]?.name,
                '账号'
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('页面长时间空白时标记为仍在加载', async () => {
        const testServer = await startTestHttpServer(
            '<!doctype html><title>空白工作台</title><body></body>'
        );
        const adapter = new PlaywrightBrowserAdapter({
            pageContentWaitMs: 50
        });
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );

            const observation = await adapter.observe(session);

            assert.equal(observation.page.loading, true);
            assert.deepEqual(observation.visibleText, []);
            assert.deepEqual(observation.interactiveElements, []);
            assert.deepEqual(observation.notices, [{
                level: 'warning',
                text: '页面在等待窗口内未渲染出可见文本、交互元素或视觉内容。'
            }]);
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('采集当前页面 PNG 截图', async () => {
        const testServer = await startTestHttpServer();
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );

            const screenshot = await adapter.captureScreenshot(session);

            assert.equal(screenshot.mediaType, 'image/png');
            assert.deepEqual(
                [...screenshot.content.slice(0, 4)],
                [
                    137,
                    80,
                    78,
                    71
                ]
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('Playwright 截图连续超时时使用 CDP 降级取证', async () => {
        const testServer = await startTestHttpServer();
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );
            const page = requireManagedPage(adapter, session);
            let screenshotAttempts = 0;
            Object.defineProperty(page, 'screenshot', {
                configurable: true,
                value: () => {
                    screenshotAttempts += 1;
                    return Promise.reject(new errors.TimeoutError(
                        'page.screenshot: Timeout exceeded while waiting for fonts'
                    ));
                }
            });

            const screenshot = await adapter.captureScreenshot(session);

            assert.equal(screenshotAttempts, 2);
            assert.equal(screenshot.mediaType, 'image/png');
            assert.deepEqual(
                [...screenshot.content.slice(0, 4)],
                [
                    137,
                    80,
                    78,
                    71
                ]
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('限制页面文本数量和单行长度并标记截断', async () => {
        const textLines = Array.from(
            {
                length: 201
            },
            (_value, index) => index === 0
                ? '长'.repeat(501)
                : `第 ${ index + 1 } 行`
        );
        const testServer = await startTestHttpServer([
            '<!doctype html><title>长文本页</title><body>',
            ...textLines.map((line) => `<div>${ line }</div>`),
            '</body>'
        ].join(''));
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(
                session,
                createNavigateCommand(testServer.url)
            );

            const observation = await adapter.observe(session);

            assert.equal(observation.visibleText.length, 200);
            assert.equal(observation.visibleText[0]?.length, 500);
            assert.equal(observation.truncated, true);
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('执行 SELECT、CHECK 和受限 WAIT 动作', async () => {
        const testServer = await startTestHttpServer([
            '<!doctype html><title>表单控件</title><body>',
            '<label>语言<select aria-label="语言">',
            '<option value="zh-CN">简体中文</option>',
            '<option value="en-US" selected>English</option>',
            '</select></label>',
            '<label><input type="checkbox">接收通知</label>',
            '</body>'
        ].join(''));
        const adapter = new PlaywrightBrowserAdapter();
        let session: BrowserSession | undefined;

        try {
            session = await adapter.start(START_OPTIONS);
            await adapter.execute(session, createNavigateCommand(testServer.url));
            const before = await adapter.observe(session);
            const language = before.interactiveElements.find(
                (element) => element.name === '语言'
            );
            assert.ok(language);
            const selectResult = await adapter.execute(session, {
                type: 'SELECT',
                target: {
                    candidateId: language.candidateId,
                    description: '语言下拉框'
                },
                value: {
                    source: 'literal',
                    value: '简体中文'
                },
                reasonSummary: '选择简体中文',
                risk: 'reversible'
            });
            const afterSelect = await adapter.observe(session);
            const notification = afterSelect.interactiveElements.find(
                (element) => element.name === '接收通知'
            );
            assert.ok(notification);
            const checkResult = await adapter.execute(session, {
                type: 'CHECK',
                target: {
                    candidateId: notification.candidateId,
                    description: '接收通知复选框'
                },
                value: {
                    source: 'literal',
                    value: true
                },
                reasonSummary: '勾选接收通知',
                risk: 'reversible'
            });
            const afterCheck = await adapter.observe(session);
            const waitResult = await adapter.execute(session, {
                type: 'WAIT',
                value: {
                    source: 'literal',
                    value: 100
                },
                reasonSummary: '等待异步内容',
                risk: 'read-only'
            });

            assert.equal(
                selectResult.status,
                'executed',
                JSON.stringify(selectResult)
            );
            assert.equal(
                afterSelect.interactiveElements.find(
                    (element) => element.name === '语言'
                )?.valueState,
                'filled'
            );
            assert.equal(
                checkResult.status,
                'executed',
                JSON.stringify(checkResult)
            );
            assert.equal(
                afterCheck.interactiveElements.find(
                    (element) => element.name === '接收通知'
                )?.checked,
                true
            );
            assert.equal(
                waitResult.status,
                'executed',
                JSON.stringify(waitResult)
            );
        } finally {
            if (session) {
                await adapter.close(session);
            }
            await testServer.close();
        }
    }).timeout(15_000);

    it('拒绝尚未支持的动作和不安全的导航地址', async () => {
        const adapter = new PlaywrightBrowserAdapter();
        const session = await adapter.start(START_OPTIONS);

        try {
            const unsupportedResult = await adapter.execute(session, {
                type: 'BACK',
                reasonSummary: '返回上一页',
                risk: 'read-only'
            });
            assert.equal(unsupportedResult.status, 'rejected');
            assert.equal(
                unsupportedResult.error?.code,
                'UNSUPPORTED_ACTION'
            );

            const invalidUrlResult = await adapter.execute(
                session,
                createNavigateCommand('javascript:alert(1)')
            );
            assert.equal(invalidUrlResult.status, 'rejected');
            assert.equal(
                invalidUrlResult.error?.code,
                'INVALID_NAVIGATION_URL'
            );
        } finally {
            await adapter.close(session);
        }
    }).timeout(15_000);
});

/** 创建一个只包含字面量 URL 的导航动作。 */
function createNavigateCommand(url: string): ActionCommand {
    return {
        type: 'NAVIGATE',
        value: {
            source: 'literal',
            value: url
        },
        reasonSummary: '打开测试页面',
        risk: 'read-only'
    };
}

/** 仅供适配器白盒测试模拟 Playwright 截图超时。 */
function requireManagedPage(
    adapter: PlaywrightBrowserAdapter,
    session: BrowserSession
): Page {
    const inspectable = adapter as unknown as {
        sessions: Map<string, {
            page: Page
        }>
    };
    const page = inspectable.sessions.get(session.sessionId)?.page;
    assert.ok(page);
    return page;
}

/** 启动本地 HTTP 页面，避免导航测试依赖外部网络。 */
async function startTestHttpServer(
    html = [
        '<!doctype html><title>登录测试页</title><body>',
        '<h1>登录简道云</h1>',
        '<p>请输入账号和密码</p>',
        '<input aria-label="手机号或邮箱" placeholder="手机号 / 邮箱">',
        '<input aria-label="密码" placeholder="密码" type="password">',
        '<button type="button">登录</button>',
        '</body>'
    ].join('')
): Promise<{
    url: string,
    wasRequested: () => boolean,
    close: () => Promise<void>
}> {
    let requested = false;
    const server = http.createServer((_request, response) => {
        requested = true;
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8'
        });
        response.end(html);
    });

    await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => reject(error);
        server.once('error', handleError);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', handleError);
            resolve();
        });
    });

    const address = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${ address.port }`,
        wasRequested: () => requested,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        })
    };
}
