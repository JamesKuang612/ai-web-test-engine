import {
    expect,
} from 'chai';
import {
    InvalidRunTransitionError,
    RunLifecycle,
} from '../src';

describe('RunLifecycle', () => {
    it('按照首次 AI 探索的主路径推进状态', () => {
        const lifecycle = new RunLifecycle();
        const path = [
            'STARTING',
            'BUILDING_INTENT',
            'OBSERVING',
            'PLANNING',
            'RESOLVING',
            'ACTING',
            'VERIFYING',
            'RECORDING',
            'DECIDING_VERDICT',
            'COMPLETED'
        ] as const;

        path.forEach((state) => lifecycle.transition(state));

        expect(lifecycle.current()).to.equal('COMPLETED');
        expect(lifecycle.isTerminal()).to.equal(true);
    });

    it('允许活动中的运行取消，但终态不能再次推进', () => {
        const lifecycle = new RunLifecycle('OBSERVING');

        expect(lifecycle.transition('CANCELLED')).to.equal('CANCELLED');
        expect(lifecycle.canTransition('STARTING')).to.equal(false);
    });

    it('允许 Planner 证据不足后回到观察阶段', () => {
        const lifecycle = new RunLifecycle('PLANNING');

        expect(lifecycle.transition('OBSERVING')).to.equal('OBSERVING');
        expect(lifecycle.transition('PLANNING')).to.equal('PLANNING');
    });

    it('拒绝跳过观察和规划阶段的非法状态迁移', () => {
        const lifecycle = new RunLifecycle();

        expect(() => lifecycle.transition('ACTING'))
            .to.throw(InvalidRunTransitionError)
            .with.property('from', 'QUEUED');
        expect(lifecycle.current()).to.equal('QUEUED');
    });
});
