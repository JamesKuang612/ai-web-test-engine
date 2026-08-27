import type {
    RunLifecycleState,
} from '../contracts';

const TERMINAL_STATES = new Set<RunLifecycleState>([
    'CANCELLED',
    'COMPLETED',
    'CRASHED'
]);

const NORMAL_TRANSITIONS: Record<RunLifecycleState, RunLifecycleState[]> = {
    ACTING: ['VERIFYING'],
    BUILDING_INTENT: ['OBSERVING'],
    CANCELLED: [],
    COMPILING_PLAN: ['REPLAY_VALIDATING'],
    COMPLETED: [],
    CRASHED: [],
    DECIDING_VERDICT: ['COMPILING_PLAN', 'COMPLETED'],
    OBSERVING: ['PLANNING'],
    PLANNING: ['DECIDING_VERDICT', 'OBSERVING', 'RESOLVING'],
    QUEUED: ['STARTING'],
    RECORDING: ['DECIDING_VERDICT', 'OBSERVING'],
    REPLAY_VALIDATING: ['COMPLETED'],
    RESOLVING: ['ACTING'],
    STARTING: ['BUILDING_INTENT', 'REPLAY_VALIDATING'],
    VERIFYING: ['RECORDING']
};

/** 表示一次不符合状态机规则的生命周期切换。 */
export class InvalidRunTransitionError extends Error {
    /** 记录非法切换的起点和目标状态，方便调用方定位流程错误。 */
    constructor(
        public readonly from: RunLifecycleState,
        public readonly to: RunLifecycleState
    ) {
        super(`Run 生命周期不能从 ${ from } 进入 ${ to }。`);
        this.name = 'InvalidRunTransitionError';
    }
}

/**
 * 只维护 Run 生命周期合法性，不包含浏览器、模型或持久化逻辑。
 */
export class RunLifecycle {
    /** 创建状态机；未指定初始状态时从排队状态开始。 */
    constructor(private state: RunLifecycleState = 'QUEUED') {}

    /** 返回当前生命周期状态。 */
    public current(): RunLifecycleState {
        return this.state;
    }

    /** 判断当前运行是否已经进入不可继续流转的终态。 */
    public isTerminal(): boolean {
        return TERMINAL_STATES.has(this.state);
    }

    /** 判断从当前状态切换到目标状态是否符合生命周期规则。 */
    public canTransition(next: RunLifecycleState): boolean {
        if (this.isTerminal()) {
            return false;
        }
        if (next === 'CANCELLED' || next === 'CRASHED') {
            return true;
        }
        return NORMAL_TRANSITIONS[this.state].includes(next);
    }

    /** 执行一次状态切换，并在切换非法时抛出明确的领域错误。 */
    public transition(next: RunLifecycleState): RunLifecycleState {
        if (!this.canTransition(next)) {
            throw new InvalidRunTransitionError(this.state, next);
        }
        this.state = next;
        return this.state;
    }
}
