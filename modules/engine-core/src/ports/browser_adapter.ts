import type {
    ActionCommand,
    ActionResult,
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
    viewport: {
        height: number,
        width: number
    };
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
    /** 将浏览器会话恢复到本次测试约定的初始状态。 */
    reset: (session: BrowserSession) => Promise<void>;
    /** 关闭浏览器会话并释放对应资源。 */
    close: (session: BrowserSession) => Promise<void>;
}
