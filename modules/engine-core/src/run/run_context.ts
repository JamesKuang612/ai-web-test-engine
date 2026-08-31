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
    latestObservation?: PageObservation;
    latestObservationReference?: EvidenceRef;
    latestPerception?: PagePerception;
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
