import assert from 'node:assert/strict';

import {
    selectProductiveActions,
} from '../src';

describe('selectProductiveActions', () => {
    it('gear → close gear → clear → New App 只编译 productive 路径', () => {
        const trace = [
            action('CLICK', 'gear', 'wrong-state'),
            action('CLICK', 'close gear', 'non-productive'),
            action('TYPE', 'clear', 'productive'),
            action('CLICK', 'New App', 'productive')
        ];

        assert.deepEqual(
            selectProductiveActions(trace).map(({ name }) => name),
            [ 'clear', 'New App' ]
        );
    });

    it('BACK 即使标为 productive 也保持 Trace-only', () => {
        assert.deepEqual(selectProductiveActions([
            action('BACK', 'undo recovery navigation', 'productive')
        ]), []);
    });
});

function action(
    type: 'BACK' | 'CLICK' | 'TYPE',
    name: string,
    compilationContribution:
        'productive' | 'non-productive' | 'wrong-state'
) {
    return {
        command: { type },
        name,
        adjudicationStatus: 'completed' as const,
        compilationContribution
    };
}
