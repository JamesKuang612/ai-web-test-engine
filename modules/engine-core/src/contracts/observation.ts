import type {
    EngineSchemaVersion,
} from './common';

export interface LocatorHint {
    strategy: 'css' | 'label' | 'placeholder' | 'role-name' | 'test-id' | 'text';
    value: string;
}

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

export interface PageNotice {
    level: 'error' | 'info' | 'success' | 'warning';
    text: string;
}

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
    screenshotRef: string;
    stateFingerprint: string;
    truncated: boolean;
}
