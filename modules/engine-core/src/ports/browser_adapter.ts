import type {
    ActionCommand,
    ActionResult,
    JsonValue,
    PageObservation,
    ResolvedTarget,
} from '../contracts';

/** 浏览器适配器返回的会话标识，不向核心层暴露具体浏览器对象。 */
export interface BrowserSession {
    sessionId: string;
}

/** 启动浏览器会话时由核心层提供的通用参数。 */
export interface BrowserStartOptions {
    headless: boolean;
    /** 可选的浏览器登录态；只在内存和本机私有缓存间传递。 */
    storageState?: JsonValue;
    viewport: {
        height: number,
        width: number
    };
}

/** 浏览器在当前页面采集的 PNG 截图。 */
export interface BrowserScreenshot {
    content: Uint8Array;
    mediaType: 'image/png';
}

/** 隔离 Playwright、CDP 和具体 Chromium 生命周期。 */
export interface BrowserAdapter {
    /** 根据启动参数创建一段独立的浏览器会话。 */
    start: (options: BrowserStartOptions) => Promise<BrowserSession>;
    /** 采集当前页面并转换为执行引擎可理解的页面观察。 */
    observe: (session: BrowserSession) => Promise<PageObservation>;
    /** 在指定会话中执行一个受控动作，并返回浏览器侧结果。 */
    execute: (
        session: BrowserSession,
        command: ActionCommand,
        target?: ResolvedTarget
    ) => Promise<ActionResult>;
    /** 截取当前页面，供执行引擎保存为运行证据。 */
    captureScreenshot: (
        session: BrowserSession
    ) => Promise<BrowserScreenshot>;
    /** 导出当前上下文的 Cookie 与 localStorage，供本机登录态缓存使用。 */
    captureStorageState?: (session: BrowserSession) => Promise<JsonValue>;
    /** 将浏览器会话恢复到本次测试约定的初始状态。 */
    reset: (session: BrowserSession) => Promise<void>;
    /** 关闭浏览器会话并释放对应资源。 */
    close: (session: BrowserSession) => Promise<void>;
}
