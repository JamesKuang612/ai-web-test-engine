import type {
    EngineSchemaVersion,
} from './common';

/** 浏览器适配器为页面元素提供的候选定位方式。 */
export interface LocatorHint {
    strategy: 'css' | 'label' | 'placeholder' | 'role-name' | 'test-id' | 'text';
    value: string;
}

/** 页面上一个可观察元素的语义、状态和位置摘要。 */
export interface ObservedElement {
    candidateId: string;
    tag: string;
    role?: string;
    name?: string;
    text?: string;
    label?: string;
    placeholder?: string;
    valueState?: 'empty' | 'filled' | 'masked' | 'unknown';
    disabled: boolean;
    checked?: boolean;
    visible: boolean;
    inViewport: boolean;
    attributes: Record<string, string>;
    nearbyText: string[];
    boundingBox?: {
        height: number,
        width: number,
        x: number,
        y: number
    };
    locatorHints: LocatorHint[];
}

/** 页面中可能影响测试判断的提示、成功或错误消息。 */
export interface PageNotice {
    level: 'error' | 'info' | 'success' | 'warning';
    text: string;
}

/** 浏览器中一个标签页的最小状态摘要。 */
export interface TabSummary {
    active: boolean;
    title: string;
    url: string;
}

/** 经过压缩、脱敏后提供给 Planner 的页面快照。 */
export interface PageObservation {
    schemaVersion: EngineSchemaVersion;
    observationId: string;
    capturedAt: string;
    page: {
        loading: boolean,
        title: string,
        url: string,
        viewport: {
            height: number,
            width: number
        }
    };
    visibleText: string[];
    interactiveElements: ObservedElement[];
    notices: PageNotice[];
    tabs: TabSummary[];
    /** 截图持久化完成后写入的证据引用。 */
    screenshotRef?: string;
    stateFingerprint: string;
    truncated: boolean;
}
