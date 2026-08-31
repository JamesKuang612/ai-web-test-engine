import type {
    BrowserSession,
} from '@ai-web-test-engine/core';
import type {
    Locator,
    Page,
} from 'playwright';

/** 仅供 server 内 Playwright 感知与映射适配器共享当前 live page。 */
export interface PlaywrightPageProvider {
    getPage: (session: BrowserSession) => Page;
    getCandidateLocator: (
        session: BrowserSession,
        observationId: string,
        candidateId: string
    ) => Locator | undefined;
    getCandidateIds: (
        session: BrowserSession,
        observationId: string
    ) => string[];
    getAccessibilityRef: (
        session: BrowserSession,
        observationId: string,
        accessibilityNodeId: string
    ) => string | undefined;
    isObservationCurrent: (
        session: BrowserSession,
        observationId: string
    ) => boolean;
    registerTransientCandidate: (
        session: BrowserSession,
        observationId: string,
        candidateId: string,
        locator: Locator
    ) => void;
    registerAccessibilityRef: (
        session: BrowserSession,
        observationId: string,
        accessibilityNodeId: string,
        ariaRef: string
    ) => void;
}
