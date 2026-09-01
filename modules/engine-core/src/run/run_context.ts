import type {
    EvidenceRef,
    PageObservation,
    PagePerception,
    RunBudgets,
    RunLifecycleState,
    StartRunInput,
    TestIntent,
} from '../contracts';
import type {
    BrowserSession,
} from '../ports';
import type {
    PlannerHistoryEntry,
} from '../planning';

/** 一次运行中由执行引擎维护、结束后释放的内存工作状态。 */
export interface RunContext {
    runId: string;
    input: StartRunInput;
    testIntent: TestIntent;
    browserSession: BrowserSession;
    lastImmediateObservation?: PageObservation;
    lastImmediateObservationReference?: EvidenceRef;
    currentStablePerception?: CurrentStablePerception;
    stablePerceptionUsable: boolean;
    perceptionRevision: number;
    pendingPerceptionReference?: EvidenceRef;
    history: PlannerHistoryEntry[];
    budgets: RunBudgets;
    lifecycle: RunLifecycleState;
    counters: {
        actionCount: number,
        modelCallCount: number,
        repeatedStateActionCount: number
    };
    startedAt: number;
}

/** Runtime 唯一可供决策模块读取的当前稳定页面事实。 */
export interface CurrentStablePerception {
    readonly revision: number;
    readonly perception: PagePerception;
    readonly reference: EvidenceRef;
}
