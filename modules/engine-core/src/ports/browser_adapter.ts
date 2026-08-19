import type {
    ActionCommand,
    ActionResult,
    PageObservation,
    ResolvedTarget,
} from '../contracts';

export interface BrowserSession {
    sessionId: string;
}

export interface BrowserStartOptions {
    headless: boolean;
    viewport: {
        height: number,
        width: number
    };
}

/** 隔离 Playwright、CDP 和具体 Chromium 生命周期。 */
export interface BrowserAdapter {
    start: (options: BrowserStartOptions) => Promise<BrowserSession>;
    observe: (session: BrowserSession) => Promise<PageObservation>;
    execute: (
        session: BrowserSession,
        command: ActionCommand,
        target?: ResolvedTarget
    ) => Promise<ActionResult>;
    reset: (session: BrowserSession) => Promise<void>;
    close: (session: BrowserSession) => Promise<void>;
}
