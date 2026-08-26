import {
    createHash,
    randomUUID,
} from 'node:crypto';

import type {
    Browser,
    BrowserContext,
    Locator,
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
    BrowserScreenshot,
    BrowserSession,
    BrowserStartOptions,
    ObservedElement,
    PageObservation,
    ResolvedTarget,
} from '@ai-web-test-engine/core';

import {
    INTERACTIVE_ELEMENT_SCRIPT,
    INTERACTIVE_SELECTOR,
    MAX_INTERACTIVE_ELEMENTS,
    RUNTIME_CANDIDATE_ATTRIBUTE,
} from './interactive_element_script';
import type {
    CapturedInteractiveElement,
} from './interactive_element_script';

/** 保存 Playwright 运行时对象，不把这些对象暴露给核心引擎。 */
interface ManagedBrowserSession {
    browser: Browser;
    context: BrowserContext;
    elementIndex?: {
        observationId: string,
        locators: Map<string, Locator>
    };
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

/** 允许测试缩短页面内容等待时间，生产环境继续使用稳健默认值。 */
export interface PlaywrightBrowserAdapterOptions {
    pageContentWaitMs?: number;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_VISIBLE_TEXT_LINES = 200;
const MAX_VISIBLE_TEXT_LENGTH = 500;
const DEFAULT_PAGE_CONTENT_WAIT_MS = 30_000;
const OBSERVATION_ATTEMPTS = 5;
const OBSERVATION_RETRY_DELAY_MS = 250;
const CLICK_NAVIGATION_WAIT_MS = 15_000;
const CLICK_SETTLE_DELAY_MS = 500;
const CLICK_DOM_CHANGE_WAIT_MS = 2_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
const SCREENSHOT_ATTEMPTS = 2;
const SCREENSHOT_RETRY_DELAY_MS = 250;
const PAGE_NOT_RENDERED_NOTICE =
    '页面在等待窗口内未渲染出可见文本、交互元素或视觉内容。';

/**
 * 使用 Playwright Chromium 实现浏览器端口。
 *
 * 核心引擎只持有 sessionId，真正的 Browser、Context 和 Page
 * 统一保存在当前适配器内部。
 */
export class PlaywrightBrowserAdapter implements BrowserAdapter {
    private readonly sessions =
        new Map<string, ManagedBrowserSession>();
    private readonly pageContentWaitMs: number;

    constructor(options: PlaywrightBrowserAdapterOptions = {}) {
        this.pageContentWaitMs = options.pageContentWaitMs ??
            DEFAULT_PAGE_CONTENT_WAIT_MS;
    }

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
     * 截图由独立方法采集，页面提示将在后续阶段补充。
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
        const contentReady = await this.waitForRenderedContent(page);
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
        const interactiveElements = await this.captureInteractiveElements(
            managedSession,
            observationId
        );
        const url = page.url();
        const stateFingerprint = createHash('sha256')
            .update(JSON.stringify({
                title,
                url,
                loading: loading || !contentReady,
                visibleText,
                interactiveElements: interactiveElements.elements.map(
                    (element) => ({
                        candidateId: element.candidateId,
                        role: element.role,
                        name: element.name,
                        valueState: element.valueState,
                        disabled: element.disabled,
                        visible: element.visible
                    })
                )
            }))
            .digest('hex');

        return {
            schemaVersion: 1,
            observationId,
            capturedAt,
            page: {
                loading: loading || !contentReady,
                title,
                url,
                viewport
            },
            visibleText,
            interactiveElements: interactiveElements.elements,
            notices: contentReady
                ? []
                : [{
                    level: 'warning',
                    text: PAGE_NOT_RENDERED_NOTICE
                }],
            tabs,
            stateFingerprint,
            truncated: truncated || interactiveElements.truncated
        };
    };

    /**
     * 执行导航、点击、输入等受控浏览器动作。
     *
     * 当前支持 NAVIGATE、TYPE 和 CLICK；其他动作会返回 UNSUPPORTED_ACTION。
     */
    public execute = async (
        session: BrowserSession,
        command: ActionCommand,
        _target?: ResolvedTarget
    ): Promise<ActionResult> => {
        const managedSession = this.requireSession(session);
        const startedAt = new Date().toISOString();

        if (command.type === 'TYPE') {
            return await this.executeType(
                managedSession,
                command,
                startedAt
            );
        }

        if (command.type === 'CLICK') {
            return await this.executeClick(
                managedSession,
                command,
                startedAt
            );
        }

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
        managedSession.elementIndex = undefined;

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

    /** 截取当前页面并返回 PNG 字节，不在浏览器层决定保存路径。 */
    public captureScreenshot = async (
        session: BrowserSession
    ): Promise<BrowserScreenshot> => {
        const managedSession = this.requireSession(session);
        for (let attempt = 1; attempt <= SCREENSHOT_ATTEMPTS; attempt += 1) {
            try {
                return {
                    content: await managedSession.page.screenshot({
                        animations: 'disabled',
                        fullPage: false,
                        timeout: SCREENSHOT_TIMEOUT_MS,
                        type: 'png'
                    }),
                    mediaType: 'image/png'
                };
            } catch (error) {
                if (!this.isRetryableScreenshotError(error)) {
                    throw error;
                }
                if (attempt < SCREENSHOT_ATTEMPTS) {
                    await managedSession.page.waitForTimeout(
                        SCREENSHOT_RETRY_DELAY_MS
                    );
                }
            }
        }

        return await this.captureScreenshotViaCdp(managedSession);
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

    /** 执行一次候选元素输入，并将字面量限制在浏览器调用边界内。 */
    private async executeType(
        session: ManagedBrowserSession,
        command: ActionCommand,
        startedAt: string
    ): Promise<ActionResult> {
        const candidateId = command.target?.candidateId;
        const value = command.value?.source === 'literal'
            ? command.value.value
            : undefined;
        if (!candidateId || typeof value !== 'string') {
            return this.createActionResult(
                startedAt,
                'rejected',
                false,
                {
                    code: 'INVALID_TYPE_COMMAND',
                    message: 'TYPE 必须提供 candidateId 和字符串字面量。'
                }
            );
        }

        const locator = session.elementIndex?.locators.get(candidateId);
        if (!locator) {
            return this.createActionResult(
                startedAt,
                'rejected',
                false,
                {
                    code: 'TARGET_NOT_FOUND',
                    message: `当前页面观察中不存在候选元素：${ candidateId }`
                }
            );
        }

        const previousUrl = session.page.url();
        try {
            if (await locator.count() !== 1 || !await locator.isVisible()) {
                return this.createActionResult(
                    startedAt,
                    'rejected',
                    false,
                    {
                        code: 'TARGET_NOT_ACTIONABLE',
                        message: `候选元素当前不可唯一操作：${ candidateId }`
                    }
                );
            }
            await locator.fill(value);
            return this.createActionResult(
                startedAt,
                'executed',
                session.page.url() !== previousUrl
            );
        } catch (error) {
            const timedOut = error instanceof errors.TimeoutError;
            return this.createActionResult(
                startedAt,
                timedOut
                    ? 'timed-out'
                    : 'failed',
                session.page.url() !== previousUrl,
                {
                    code: timedOut
                        ? 'TYPE_TIMEOUT'
                        : 'TYPE_FAILED',
                    message: timedOut
                        ? '输入动作执行超时。'
                        : 'Playwright 无法完成输入动作。'
                }
            );
        }
    }

    /** 点击当前页面观察中的唯一候选元素。 */
    private async executeClick(
        session: ManagedBrowserSession,
        command: ActionCommand,
        startedAt: string
    ): Promise<ActionResult> {
        const candidateId = command.target?.candidateId;
        if (!candidateId) {
            return this.createActionResult(
                startedAt,
                'rejected',
                false,
                {
                    code: 'INVALID_CLICK_COMMAND',
                    message: 'CLICK 必须提供 candidateId。'
                }
            );
        }

        const locator = session.elementIndex?.locators.get(candidateId);
        if (!locator) {
            return this.createActionResult(
                startedAt,
                'rejected',
                false,
                {
                    code: 'TARGET_NOT_FOUND',
                    message: `当前页面观察中不存在候选元素：${ candidateId }`
                }
            );
        }

        const previousUrl = session.page.url();
        const navigationExpected = this.isNavigationExpected(command);
        try {
            if (
                await locator.count() !== 1 ||
                !await locator.isVisible() ||
                !await locator.isEnabled()
            ) {
                return this.createActionResult(
                    startedAt,
                    'rejected',
                    false,
                    {
                        code: 'TARGET_NOT_ACTIONABLE',
                        message: `候选元素当前不可唯一操作：${ candidateId }`
                    }
                );
            }
            const previousDomState = await this.captureDomChangeState(
                session.page
            );
            await locator.click();
            await this.waitForClickSettlement(
                session.page,
                previousUrl,
                navigationExpected,
                previousDomState
            );
            return this.createActionResult(
                startedAt,
                'executed',
                session.page.url() !== previousUrl
            );
        } catch (error) {
            const timedOut = error instanceof errors.TimeoutError;
            return this.createActionResult(
                startedAt,
                timedOut
                    ? 'timed-out'
                    : 'failed',
                session.page.url() !== previousUrl,
                {
                    code: timedOut
                        ? 'CLICK_TIMEOUT'
                        : 'CLICK_FAILED',
                    message: timedOut
                        ? '点击动作执行超时。'
                        : 'Playwright 无法完成点击动作。'
                }
            );
        } finally {
            // 点击可能触发 DOM 更新或页面跳转，旧候选元素不能继续复用。
            session.elementIndex = undefined;
        }
    }

    /** 为可能触发异步跳转的点击保留观察窗口，避免过早重复操作。 */
    private async waitForClickSettlement(
        page: Page,
        previousUrl: string,
        navigationExpected: boolean,
        previousDomState: string
    ): Promise<void> {
        if (!navigationExpected) {
            try {
                await page.waitForFunction(
                    [
                        '(previousState) => {',
                        'const body = document.body;',
                        'const expanded = Array.from(document.querySelectorAll(',
                        '"[aria-expanded]"',
                        ')).map((element) => element.getAttribute("aria-expanded"));',
                        'const currentState = JSON.stringify({',
                        'text: body?.innerText ?? "",',
                        'childCount: body?.querySelectorAll("*").length ?? 0,',
                        'expanded',
                        '});',
                        'return currentState !== previousState;',
                        '}'
                    ].join(''),
                    previousDomState,
                    {
                        timeout: CLICK_DOM_CHANGE_WAIT_MS
                    }
                );
            } catch (error) {
                if (!(error instanceof errors.TimeoutError)) {
                    throw error;
                }
            }
            await page.waitForTimeout(CLICK_SETTLE_DELAY_MS);
            return;
        }
        try {
            await page.waitForURL(
                (url) => url.toString() !== previousUrl,
                {
                    timeout: CLICK_NAVIGATION_WAIT_MS,
                    waitUntil: 'domcontentloaded'
                }
            );
        } catch (error) {
            if (!(error instanceof errors.TimeoutError)) {
                throw error;
            }
            // 点击本身已经成功；未跳转交由后续 observation 和 Planner 判断。
        }
    }

    /** 生成用于等待菜单、弹层等局部 DOM 变化的轻量状态。 */
    private captureDomChangeState(page: Page): Promise<string> {
        return page.evaluate<string>([
            '(() => {',
            'const body = document.body;',
            'const expanded = Array.from(document.querySelectorAll(',
            '"[aria-expanded]"',
            ')).map((element) => element.getAttribute("aria-expanded"));',
            'return JSON.stringify({',
            'text: body?.innerText ?? "",',
            'childCount: body?.querySelectorAll("*").length ?? 0,',
            'expanded',
            '});',
            '})()'
        ].join(''));
    }

    /** 根据 Planner 描述判断点击是否预期进入另一个页面。 */
    private isNavigationExpected(command: ActionCommand): boolean {
        return /跳转|进入.+页面|导航|打开.+页面|URL|地址/iu.test([
            command.expectedEffect ?? '',
            command.reasonSummary
        ].join(' '));
    }

    /** 采集可见交互元素，并建立当前 observation 的 Locator 索引。 */
    private async captureInteractiveElements(
        session: ManagedBrowserSession,
        observationId: string
    ): Promise<{
        elements: ObservedElement[],
        truncated: boolean
    }> {
        const captured = await session.page.evaluate<
            CapturedInteractiveElement[]
        >(INTERACTIVE_ELEMENT_SCRIPT);
        const locators = new Map<string, Locator>();
        const observed = captured.map((element) => {
            locators.set(
                element.candidateId,
                session.page.locator(
                    `[${ RUNTIME_CANDIDATE_ATTRIBUTE }="${
                        element.candidateId
                    }"]`
                )
            );
            return element;
        });
        const truncated = observed.length >= MAX_INTERACTIVE_ELEMENTS;

        session.elementIndex = {
            observationId,
            locators
        };
        return {
            elements: observed,
            truncated
        };
    }

    /** 为延迟渲染的 SPA 等待首批可见文本或交互元素。 */
    private async waitForRenderedContent(page: Page): Promise<boolean> {
        if (page.url() === 'about:blank') {
            return true;
        }
        try {
            await page.waitForFunction(
                [
                    '(() => {',
                    'const bodyText = document.body?.innerText.trim() ?? "";',
                    `const interactiveSelector = ${
                        JSON.stringify(INTERACTIVE_SELECTOR)
                    };`,
                    'if (bodyText || document.querySelector(interactiveSelector)) {',
                    'return true;',
                    '}',
                    'return Array.from(document.querySelectorAll(',
                    '"canvas, img, svg, video"',
                    ')).some((element) => {',
                    'const rectangle = element.getBoundingClientRect();',
                    'return rectangle.width > 0 && rectangle.height > 0;',
                    '});',
                    '})()'
                ].join(''),
                undefined,
                {
                    timeout: this.pageContentWaitMs
                }
            );
            return true;
        } catch (error) {
            if (!(error instanceof errors.TimeoutError)) {
                throw error;
            }
            return false;
        }
    }

    /** Playwright 截图卡在字体或渲染阶段时，改用 Chromium CDP 直接取证。 */
    private async captureScreenshotViaCdp(
        session: ManagedBrowserSession
    ): Promise<BrowserScreenshot> {
        const cdpSession = await session.context.newCDPSession(session.page);
        try {
            const response = await cdpSession.send(
                'Page.captureScreenshot',
                {
                    captureBeyondViewport: false,
                    format: 'png',
                    fromSurface: true
                }
            ) as {
                data: string
            };
            return {
                content: new Uint8Array(Buffer.from(response.data, 'base64')),
                mediaType: 'image/png'
            };
        } finally {
            await cdpSession.detach();
        }
    }

    /** 只对截图超时或渲染阶段异常做重试，页面关闭等硬错误立即上抛。 */
    private isRetryableScreenshotError(error: unknown): boolean {
        return error instanceof errors.TimeoutError ||
            error instanceof Error &&
            /screenshot|font|render|timeout/iu.test(error.message);
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
