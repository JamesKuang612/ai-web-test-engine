import {
    createHash,
    randomUUID,
} from 'node:crypto';

import type {
    Browser,
    BrowserContext,
    Page,
} from 'playwright';
import {
    chromium,
    errors,
} from 'playwright';

import type {
    ActionCommand,
    ActionResult,
    BrowserAdapter,
    BrowserSession,
    BrowserStartOptions,
    PageObservation,
    ResolvedTarget,
} from '@ai-web-test-engine/core';

/** 保存 Playwright 运行时对象，不把这些对象暴露给核心引擎。 */
interface ManagedBrowserSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
}

/** 从同一个页面执行上下文中一次性取得的基础状态。 */
interface CapturedPageState {
    bodyText: string;
    loading: boolean;
    tabs: Array<{
        active: boolean,
        title: string,
        url: string
    }>;
    title: string;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_VISIBLE_TEXT_LINES = 200;
const MAX_VISIBLE_TEXT_LENGTH = 500;
const OBSERVATION_ATTEMPTS = 5;
const OBSERVATION_RETRY_DELAY_MS = 250;

/**
 * 使用 Playwright Chromium 实现浏览器端口。
 *
 * 核心引擎只持有 sessionId，真正的 Browser、Context 和 Page
 * 统一保存在当前适配器内部。
 */
export class PlaywrightBrowserAdapter implements BrowserAdapter {
    private readonly sessions =
        new Map<string, ManagedBrowserSession>();

    /**
     * 启动一个独立的 Chromium 浏览器，并创建新的上下文和空白页面。
     */
    public start = async (
        options: BrowserStartOptions
    ): Promise<BrowserSession> => {
        const browser = await chromium.launch({
            headless: options.headless
        });

        try {
            const context = await browser.newContext({
                viewport: {
                    width: options.viewport.width,
                    height: options.viewport.height
                }
            });
            const page = await context.newPage();
            const sessionId = randomUUID();

            this.sessions.set(sessionId, {
                browser,
                context,
                page
            });

            return {
                sessionId
            };
        } catch (error) {
            // 创建上下文或页面失败时，避免遗留 Chromium 进程。
            await browser.close();
            throw error;
        }
    };

    /**
     * 采集当前页面的地址、标题、视口、可见文本和标签页摘要。
     *
     * 可交互元素、页面提示和截图证据将在后续阶段补充。
     */
    public observe = async (
        session: BrowserSession
    ): Promise<PageObservation> => {
        const managedSession = this.requireSession(session);
        const {
            context,
            page,
        } = managedSession;
        const observationId = randomUUID();
        const capturedAt = new Date().toISOString();
        const viewport = page.viewportSize();

        if (!viewport) {
            throw new Error(
                `浏览器会话没有可用的视口：${ session.sessionId }`
            );
        }

        const {
            title,
            bodyText,
            loading,
            tabs,
        } = await this.capturePageState(context, page);
        const {
            visibleText,
            truncated,
        } = this.normalizeVisibleText(bodyText);
        const url = page.url();
        const stateFingerprint = createHash('sha256')
            .update(JSON.stringify({
                title,
                url,
                visibleText
            }))
            .digest('hex');

        return {
            schemaVersion: 1,
            observationId,
            capturedAt,
            page: {
                loading,
                title,
                url,
                viewport
            },
            visibleText,
            interactiveElements: [],
            notices: [],
            tabs,
            stateFingerprint,
            truncated
        };
    };

    /**
     * 执行导航、点击、输入等受控浏览器动作。
     *
     * 当前支持 NAVIGATE；其他动作会返回 UNSUPPORTED_ACTION。
     */
    public execute = async (
        session: BrowserSession,
        command: ActionCommand,
        _target?: ResolvedTarget
    ): Promise<ActionResult> => {
        const managedSession = this.requireSession(session);
        const startedAt = new Date().toISOString();

        if (command.type !== 'NAVIGATE') {
            return this.createActionResult(
                startedAt,
                'rejected',
                false,
                {
                    code: 'UNSUPPORTED_ACTION',
                    message: `浏览器动作 ${ command.type } 尚未实现。`
                }
            );
        }

        const navigationUrl = this.getNavigationUrl(command);
        if (!navigationUrl) {
            return this.createActionResult(
                startedAt,
                'rejected',
                false,
                {
                    code: 'INVALID_NAVIGATION_URL',
                    message: 'NAVIGATE 必须提供合法的 HTTP 或 HTTPS 字面量 URL。'
                }
            );
        }

        const previousUrl = managedSession.page.url();

        try {
            await managedSession.page.goto(navigationUrl, {
                timeout: NAVIGATION_TIMEOUT_MS,
                // 起始页提交响应后即可交给 observe 处理后续加载和重定向。
                waitUntil: 'commit'
            });

            return this.createActionResult(
                startedAt,
                'executed',
                managedSession.page.url() !== previousUrl
            );
        } catch (error) {
            const timedOut = error instanceof errors.TimeoutError;

            return this.createActionResult(
                startedAt,
                timedOut
                    ? 'timed-out'
                    : 'failed',
                managedSession.page.url() !== previousUrl,
                {
                    code: timedOut
                        ? 'NAVIGATION_TIMEOUT'
                        : 'NAVIGATION_FAILED',
                    message: timedOut
                        ? `页面导航超过 ${ NAVIGATION_TIMEOUT_MS } 毫秒。`
                        : 'Playwright 无法完成页面导航。'
                }
            );
        }
    };

    /**
     * 将浏览器会话恢复到约定的初始状态。
     */
    public reset = async (
        session: BrowserSession
    ): Promise<void> => {
        this.requireSession(session);

        throw new Error(
            'PlaywrightBrowserAdapter.reset 尚未实现。'
        );
    };

    /**
     * 关闭指定浏览器会话，并从内存中移除对应记录。
     */
    public close = async (
        session: BrowserSession
    ): Promise<void> => {
        const managedSession = this.requireSession(session);

        try {
            // 关闭 Browser 时，其 Context 和 Page 也会一并关闭。
            await managedSession.browser.close();
        } finally {
            this.sessions.delete(session.sessionId);
        }
    };

    /**
     * 根据公开的 sessionId 查找 Playwright 运行时对象。
     */
    private requireSession(
        session: BrowserSession
    ): ManagedBrowserSession {
        const managedSession = this.sessions.get(
            session.sessionId
        );

        if (!managedSession) {
            throw new Error(
                `浏览器会话不存在或已经关闭：${ session.sessionId }`
            );
        }

        return managedSession;
    }

    /**
     * 在同一页面上下文中采集基础状态；遇到页面重定向时有限重试。
     */
    private async capturePageState(
        context: BrowserContext,
        page: Page
    ): Promise<CapturedPageState> {
        for (let attempt = 1; attempt <= OBSERVATION_ATTEMPTS; attempt += 1) {
            try {
                try {
                    await page.waitForLoadState('domcontentloaded', {
                        timeout: 5_000
                    });
                } catch (error) {
                    if (!(error instanceof errors.TimeoutError)) {
                        throw error;
                    }
                    // 慢页面也需要返回当前可用状态，由 loading 字段表达未完成。
                }
                const state = await page.evaluate<{
                    bodyText: string,
                    loading: boolean,
                    title: string
                }>([
                    '({',
                    'title: document.title,',
                    'bodyText: document.body?.innerText ?? "",',
                    'loading: document.readyState !== "complete"',
                    '})'
                ].join(''));
                const tabs = await Promise.all(
                    context.pages().map(async (tab) => ({
                        active: tab === page,
                        title: tab === page
                            ? state.title
                            : await tab.title(),
                        url: tab.url()
                    }))
                );
                return {
                    ...state,
                    tabs
                };
            } catch (error) {
                if (
                    attempt === OBSERVATION_ATTEMPTS ||
                    !this.isTransientNavigationError(error)
                ) {
                    throw error;
                }
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, OBSERVATION_RETRY_DELAY_MS);
                });
            }
        }

        throw new Error('页面状态采集达到重试上限。');
    }

    /** 判断观察失败是否由页面正在切换执行上下文造成。 */
    private isTransientNavigationError(error: unknown): boolean {
        return error instanceof errors.TimeoutError ||
            error instanceof Error &&
            /execution context was destroyed|because of a navigation/iu
                .test(error.message);
    }

    /** 清理页面文本，并限制提供给执行引擎的文本数量和单行长度。 */
    private normalizeVisibleText(bodyText: string): {
        visibleText: string[],
        truncated: boolean
    } {
        const lines = bodyText
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter(Boolean);
        const visibleText = lines
            .slice(0, MAX_VISIBLE_TEXT_LINES)
            .map((line) => line.slice(
                0,
                MAX_VISIBLE_TEXT_LENGTH
            ));
        const truncated =
            lines.length > MAX_VISIBLE_TEXT_LINES ||
            lines.some(
                (line) => line.length > MAX_VISIBLE_TEXT_LENGTH
            );

        return {
            visibleText,
            truncated
        };
    }

    /** 从 NAVIGATE 命令中读取并校验 HTTP 或 HTTPS URL。 */
    private getNavigationUrl(command: ActionCommand): string | undefined {
        const value = command.value;
        if (
            value?.source !== 'literal' ||
            typeof value.value !== 'string' ||
            !value.value.trim()
        ) {
            return undefined;
        }

        try {
            const url = new URL(value.value.trim());
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return undefined;
            }
            return url.toString();
        } catch {
            return undefined;
        }
    }

    /** 创建字段完整且时间格式统一的浏览器动作结果。 */
    private createActionResult(
        startedAt: string,
        status: ActionResult['status'],
        urlChanged: boolean,
        error?: ActionResult['error']
    ): ActionResult {
        return {
            status,
            startedAt,
            finishedAt: new Date().toISOString(),
            ...(error
                ? {
                    error
                }
                : {}),
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged
            }
        };
    }
}
