import type {
    AccessibilitySnapshot,
    ElementInteractionState,
    PageObservation,
} from '../contracts';
import type {
    BrowserSession,
} from './browser_adapter';

/** 浏览器侧采集的独立感知信号；物理映射由其他端口负责。 */
export interface CapturedPerceptionSignals {
    accessibility: AccessibilitySnapshot;
    interactionStates: Record<string, ElementInteractionState>;
}
/** 只负责从当前页面采集 bounded 感知信号。 */
export interface PagePerceptionPort {
    capture: (
        session: BrowserSession,
        observation: PageObservation,
        signal: AbortSignal
    ) => Promise<CapturedPerceptionSignals>;
}
