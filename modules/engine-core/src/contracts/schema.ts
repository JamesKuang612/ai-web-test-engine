import type {
    ActionCommand,
} from './action';
import type {
    CompiledPlan,
} from './compiled_plan';
import type {
    TestIntent,
} from './intent';
import type {
    PageObservation,
} from './observation';
import type {
    RunResult,
    RunSnapshot,
} from './run';
import type {
    RunEvent,
} from './run_event';
import type {
    EnvironmentDefinition,
    StartRunInput,
    TestDefinition,
} from './test_definition';
import type {
    TraceEvent,
} from './trace';
import type {
    VerdictDecision,
} from './verdict';

/**
 * JSON Schema 生成入口。这里只聚合跨进程或持久化边界上的根对象。
 */
export interface EngineContracts {
    actionCommand: ActionCommand;
    compiledPlan: CompiledPlan;
    environmentDefinition: EnvironmentDefinition;
    pageObservation: PageObservation;
    runEvent: RunEvent;
    runResult: RunResult;
    runSnapshot: RunSnapshot;
    startRunInput: StartRunInput;
    testDefinition: TestDefinition;
    testIntent: TestIntent;
    traceEvent: TraceEvent;
    verdictDecision: VerdictDecision;
}
