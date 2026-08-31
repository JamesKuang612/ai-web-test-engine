import type {
    EffectVerification,
    PrimaryRetryDecision,
    SemanticAction,
} from '../contracts';

/** 防止“未观察到效果”被误解为可以重复未知副作用。 */
export class PrimaryRetryPolicy {
    public decide(input: {
        action: SemanticAction,
        browserExecuted: boolean,
        effect?: EffectVerification
    }): PrimaryRetryDecision {
        if (!input.browserExecuted) {
            return { kind: 'execute-after-reground' };
        }
        if (
            input.effect?.status === 'not-observed'
            || input.effect?.status === 'uncertain'
            || input.effect?.status === 'contradicted'
        ) {
            return { kind: 'reverify' };
        }
        if (isIdempotent(input.action)) {
            return { kind: 'retry-idempotent' };
        }
        return {
            kind: 'do-not-retry',
            reason: '原始动作已经执行，无法证明重复执行不会扩大业务副作用。'
        };
    }
}

function isIdempotent(action: SemanticAction): boolean {
    return action.type === 'HOVER'
        || action.type === 'WAIT'
        || action.type === 'CHECK'
        || action.type === 'SELECT'
        || action.type === 'TYPE';
}
