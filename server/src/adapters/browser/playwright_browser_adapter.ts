import {
    createHash,
    randomUUID,
} from 'node:crypto';

import type {
    Browser,
    BrowserContext,
    BrowserContextOptions,
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
    JsonValue,
    ObservedElement,
    PageObservation,
    ResolvedTarget,
    VisualGroundingResult,
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
import type {
    VisualCandidateAnnotation,
    VisualCandidateAnnotator,
} from '../visual';

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
    visualCandidateAnnotator?: VisualCandidateAnnotator;
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
const HOVER_SETTLE_DELAY_MS = 200;
const MIN_WAIT_ACTION_MS = 100;
const MAX_WAIT_ACTION_MS = 5_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
const SCREENSHOT_ATTEMPTS = 2;
const SCREENSHOT_RETRY_DELAY_MS = 250;
const PAGE_NOT_RENDERED_NOTICE =
    '页面在等待窗口内未渲染出可见文本、交互元素或视觉内容。';

/** 仅识别当前 Windows 可视 Chromium 的进程创建失败。 */
export function shouldUseWindowsBrowserFallback(
    error: unknown,
    headless: boolean,
    platform: typeof process.platform = process.platform
): boolean {
    return !headless
        && platform === 'win32'
        && error instanceof Error
        && /browserType\.launch: spawn UNKNOWN/u.test(error.message);
}

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
    private readonly visualCandidateAnnotator?: VisualCandidateAnnotator;

    constructor(options: PlaywrightBrowserAdapterOptions = {}) {
        this.pageContentWaitMs = options.pageContentWaitMs ??
            DEFAULT_PAGE_CONTENT_WAIT_MS;
        this.visualCandidateAnnotator = options.visualCandidateAnnotator;
    }

    /**
     * 启动一个独立的 Chromium 浏览器，并创建新的上下文和空白页面。
     */
    public start = async (
        options: BrowserStartOptions
    ): Promise<BrowserSession> => {
        const browser = await this.launchChromium(options.headless);

        try {
            const context = await browser.newContext({
                ...options.storageState
                    ? {
                        storageState: options.storageState as
                            BrowserContextOptions['storageState']
                    }
                    : {},
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
     * Windows 可能会阻止未签名的 Playwright Chromium 以可视模式启动。
     * 只针对 spawn UNKNOWN 依次回退到已安装的 Chrome 和 Edge。
     */
    private launchChromium = async (headless: boolean): Promise<Browser> => {
        try {
            return await chromium.launch({ headless });
        } catch (error) {
            if (!shouldUseWindowsBrowserFallback(error, headless)) {
                throw error;
            }
        }

        let fallbackError: unknown;
        for (const channel of [ 'chrome', 'msedge' ] as const) {
            try {
                return await chromium.launch({
                    channel,
                    headless
                });
            } catch (error) {
                fallbackError = error;
            }
        }

        throw fallbackError;
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

    /** 用 Midscene 一次性识别已有候选框，并把视觉语义合并回同一份观察。 */
    public enhanceObservationWithVision = async (
        session: BrowserSession,
        observation: PageObservation,
        signal: AbortSignal
    ): Promise<VisualGroundingResult> => {
        if (!this.visualCandidateAnnotator) {
            return {
                status: 'unsupported',
                summary: '当前浏览器适配器未配置候选元素视觉标注能力。'
            };
        }
        const managedSession = this.requireSession(session);
        signal.throwIfAborted();
        if (
            managedSession.page.url() !== observation.page.url ||
            managedSession.elementIndex?.observationId !==
                observation.observationId
        ) {
            return {
                status: 'not-found',
                summary: '页面状态已变化，已拒绝对过期候选框进行视觉标注。'
            };
        }
        const candidates = observation.interactiveElements.filter(
            (element) => element.visible && element.inViewport &&
                !element.disabled && element.boundingBox
        );
        if (candidates.length === 0) {
            return {
                status: 'not-found',
                summary: '当前视口没有可供视觉模型标注的候选框。'
            };
        }

        try {
            const annotations = await this.visualCandidateAnnotator.annotate(
                managedSession.page,
                candidates,
                signal
            );
            signal.throwIfAborted();
            if (annotations.length === 0) {
                return {
                    status: 'not-found',
                    summary: '视觉模型未能为当前候选框返回有效名称。'
                };
            }
            const enhancedObservation = this.mergeVisualAnnotations(
                observation,
                annotations
            );
            return {
                status: 'grounded',
                summary: `视觉模型已批量标注 ${
                    annotations.length
                } 个候选元素。`,
                candidateIds: annotations.map(
                    ({ candidateId }) => candidateId
                ),
                observation: enhancedObservation
            };
        } catch (error) {
            signal.throwIfAborted();
            return {
                status: 'not-found',
                summary: `视觉候选标注失败：${
                    error instanceof Error ? error.message : '未知错误'
                }`
            };
        }
    };

    /**
     * 执行导航、点击、输入等受控浏览器动作。
     *
     * 当前支持导航、输入、点击、悬浮、选择、勾选和受限等待动作。
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

        if (command.type === 'HOVER') {
            return await this.executeHover(managedSession, command, startedAt);
        }

        if (command.type === 'SELECT') {
            return await this.executeSelect(
                managedSession,
                command,
                startedAt
            );
        }

        if (command.type === 'CHECK') {
            return await this.executeCheck(
                managedSession,
                command,
                startedAt
            );
        }

        if (command.type === 'WAIT') {
            return await this.executeWait(
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

    /** 导出当前上下文的登录态，不包含在普通运行证据中。 */
    public captureStorageState = async (
        session: BrowserSession
    ): Promise<JsonValue> => {
        const state = await this.requireSession(session).context.storageState();
        return state as JsonValue;
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

    /** 将鼠标悬浮到候选元素，并保留悬浮状态供下一次页面观察采集。 */
    private async executeHover(
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
                    code: 'INVALID_HOVER_COMMAND',
                    message: 'HOVER 必须提供 candidateId。'
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
                        message: `候选元素当前不可唯一悬浮：${ candidateId }`
                    }
                );
            }
            await locator.hover();
            await session.page.waitForTimeout(HOVER_SETTLE_DELAY_MS);
            return this.createActionResult(
                startedAt,
                'executed',
                session.page.url() !== previousUrl
            );
        } catch (error) {
            const timedOut = error instanceof errors.TimeoutError;
            return this.createActionResult(
                startedAt,
                timedOut ? 'timed-out' : 'failed',
                session.page.url() !== previousUrl,
                {
                    code: timedOut ? 'HOVER_TIMEOUT' : 'HOVER_FAILED',
                    message: timedOut
                        ? '鼠标悬浮动作执行超时。'
                        : 'Playwright 无法完成鼠标悬浮动作。'
                }
            );
        } finally {
            // 悬浮可能改变可见控件集合，下一次观察必须重新建立候选索引。
            session.elementIndex = undefined;
        }
    }

    /** 按页面显示文本或 option value 精确选择原生下拉框选项。 */
    private async executeSelect(
        session: ManagedBrowserSession,
        command: ActionCommand,
        startedAt: string
    ): Promise<ActionResult> {
        const candidateId = command.target?.candidateId;
        const value = command.value?.source === 'literal'
            ? command.value.value
            : undefined;
        if (!candidateId || typeof value !== 'string') {
            return this.createActionResult(startedAt, 'rejected', false, {
                code: 'INVALID_SELECT_COMMAND',
                message: 'SELECT 必须提供 candidateId 和字符串选项值。'
            });
        }
        const locator = session.elementIndex?.locators.get(candidateId);
        if (!locator) {
            return this.createActionResult(startedAt, 'rejected', false, {
                code: 'TARGET_NOT_FOUND',
                message: `当前页面观察中不存在候选元素：${ candidateId }`
            });
        }
        try {
            if (
                await locator.count() !== 1
                || !await locator.isVisible()
                || !await locator.isEnabled()
            ) {
                return this.createActionResult(startedAt, 'rejected', false, {
                    code: 'TARGET_NOT_ACTIONABLE',
                    message: `候选元素当前不可唯一操作：${ candidateId }`
                });
            }
            const matches = await this.findSelectOptionMatches(
                locator,
                value
            );
            if (matches.length !== 1) {
                return this.createActionResult(startedAt, 'rejected', false, {
                    code: 'SELECT_OPTION_NOT_UNIQUE',
                    message: `下拉框中无法唯一匹配选项：${ value }`
                });
            }
            await locator.selectOption(matches[0]);
            return this.createActionResult(startedAt, 'executed', false);
        } catch (error) {
            const timedOut = error instanceof errors.TimeoutError;
            return this.createActionResult(
                startedAt,
                timedOut ? 'timed-out' : 'failed',
                false,
                {
                    code: timedOut ? 'SELECT_TIMEOUT' : 'SELECT_FAILED',
                    message: timedOut
                        ? '下拉选择动作执行超时。'
                        : 'Playwright 无法完成下拉选择动作。'
                }
            );
        } finally {
            session.elementIndex = undefined;
        }
    }

    /** 不执行页面脚本，逐项读取 option，避免测试覆盖插桩污染浏览器上下文。 */
    private async findSelectOptionMatches(
        locator: Locator,
        expected: string
    ): Promise<Array<{ label?: string, value?: string }>> {
        const optionLocator = locator.locator('option');
        const optionCount = await optionLocator.count();
        const matches: Array<{ label?: string, value?: string }> = [];
        for (let index = 0; index < optionCount; index += 1) {
            const option = optionLocator.nth(index);
            const label = (
                await option.getAttribute('label')
                ?? await option.textContent()
                ?? ''
            ).trim();
            const value = await option.getAttribute('value');
            if (label === expected) {
                matches.push({ label: expected });
            } else if (value === expected) {
                matches.push({ value: expected });
            }
        }
        return matches;
    }

    /** 将复选框或单选框设置为 Planner 明确指定的布尔状态。 */
    private async executeCheck(
        session: ManagedBrowserSession,
        command: ActionCommand,
        startedAt: string
    ): Promise<ActionResult> {
        const candidateId = command.target?.candidateId;
        const checked = command.value?.source === 'literal'
            ? command.value.value
            : undefined;
        if (!candidateId || typeof checked !== 'boolean') {
            return this.createActionResult(startedAt, 'rejected', false, {
                code: 'INVALID_CHECK_COMMAND',
                message: 'CHECK 必须提供 candidateId 和布尔字面量。'
            });
        }
        const locator = session.elementIndex?.locators.get(candidateId);
        if (!locator) {
            return this.createActionResult(startedAt, 'rejected', false, {
                code: 'TARGET_NOT_FOUND',
                message: `当前页面观察中不存在候选元素：${ candidateId }`
            });
        }
        try {
            if (
                await locator.count() !== 1
                || !await locator.isVisible()
                || !await locator.isEnabled()
            ) {
                return this.createActionResult(startedAt, 'rejected', false, {
                    code: 'TARGET_NOT_ACTIONABLE',
                    message: `候选元素当前不可唯一操作：${ candidateId }`
                });
            }
            await locator.setChecked(checked);
            return this.createActionResult(startedAt, 'executed', false);
        } catch (error) {
            const timedOut = error instanceof errors.TimeoutError;
            return this.createActionResult(
                startedAt,
                timedOut ? 'timed-out' : 'failed',
                false,
                {
                    code: timedOut ? 'CHECK_TIMEOUT' : 'CHECK_FAILED',
                    message: timedOut
                        ? '勾选动作执行超时。'
                        : 'Playwright 无法完成勾选动作。'
                }
            );
        } finally {
            session.elementIndex = undefined;
        }
    }

    /** 执行有严格上下限的等待，避免模型生成无限或超长暂停。 */
    private async executeWait(
        session: ManagedBrowserSession,
        command: ActionCommand,
        startedAt: string
    ): Promise<ActionResult> {
        const durationMs = command.value?.source === 'literal'
            ? command.value.value
            : undefined;
        if (
            typeof durationMs !== 'number'
            || !Number.isInteger(durationMs)
            || durationMs < MIN_WAIT_ACTION_MS
            || durationMs > MAX_WAIT_ACTION_MS
        ) {
            return this.createActionResult(startedAt, 'rejected', false, {
                code: 'INVALID_WAIT_COMMAND',
                message: 'WAIT 必须提供 100～5000 毫秒的整数字面量。'
            });
        }
        await session.page.waitForTimeout(durationMs);
        return this.createActionResult(startedAt, 'executed', false);
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
        return /跳转|页面进入|进入.+页面|进入(?:工作台|应用)(?=$|[\s，。；,]|并|后)|导航|打开.+页面|打开(?:工作台|应用)(?=$|[\s，。；,]|并|后)|返回(?:.+页面|工作台|首页|上一页)|登录(?:成功)?(?:后|进入|跳转|完成)|URL|地址/iu.test([
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

    /** 保留 DOM 语义和 Locator，只补充每个确定候选框的视觉名称。 */
    private mergeVisualAnnotations(
        observation: PageObservation,
        annotations: VisualCandidateAnnotation[]
    ): PageObservation {
        const annotationById = new Map(annotations.map((annotation) => [
            annotation.candidateId,
            annotation
        ]));
        const interactiveElements = observation.interactiveElements.map(
            (element): ObservedElement => {
                const annotation = annotationById.get(element.candidateId);
                if (!annotation) {
                    return element;
                }
                return {
                    ...element,
                    discoverySource: 'vision-assisted',
                    visualDescription: [
                        annotation.visualDescription,
                        ...annotation.elementType
                            ? [ `类型：${ annotation.elementType }` ]
                            : [],
                        ...annotation.confidence === undefined
                            ? []
                            : [ `置信度：${ annotation.confidence }` ]
                    ].join('；')
                };
            }
        );
        return {
            ...observation,
            interactiveElements,
            stateFingerprint: createHash('sha256')
                .update(JSON.stringify({
                    base: observation.stateFingerprint,
                    visualAnnotations: annotations
                }))
                .digest('hex')
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
