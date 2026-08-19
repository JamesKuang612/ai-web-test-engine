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
    PLANNING: ['DECIDING_VERDICT', 'RESOLVING'],
    QUEUED: ['STARTING'],
    RECORDING: ['DECIDING_VERDICT', 'OBSERVING'],
    REPLAY_VALIDATING: ['COMPLETED'],
    RESOLVING: ['ACTING'],
    STARTING: ['BUILDING_INTENT'],
    VERIFYING: ['RECORDING']
};

export class InvalidRunTransitionError extends Error {
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
    constructor(private state: RunLifecycleState = 'QUEUED') {}

    public current(): RunLifecycleState {
        return this.state;
    }

    public isTerminal(): boolean {
        return TERMINAL_STATES.has(this.state);
    }

    public canTransition(next: RunLifecycleState): boolean {
        if (this.isTerminal()) {
            return false;
        }
        if (next === 'CANCELLED' || next === 'CRASHED') {
            return true;
        }
        return NORMAL_TRANSITIONS[this.state].includes(next);
    }

    public transition(next: RunLifecycleState): RunLifecycleState {
        if (!this.canTransition(next)) {
            throw new InvalidRunTransitionError(this.state, next);
        }
        this.state = next;
        return this.state;
    }
}
