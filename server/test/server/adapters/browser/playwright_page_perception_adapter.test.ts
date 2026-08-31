import assert from 'node:assert/strict';

import {
    parseAriaSnapshot,
} from '../../../../src/adapters/browser';

describe('PlaywrightPagePerceptionAdapter', () => {
    it('解析 AI aria snapshot 的语义、状态、bbox 和祖先上下文', () => {
        const nodes = parseAriaSnapshot([
            '- region "应用11" [ref=e1] [box=10,20,300,200]:',
            '  - button "收藏" [ref=e2] [box=20,30,24,24] [disabled]',
            '  - checkbox "启用" [ref=e3] [checked=mixed]'
        ].join('\n'));

        assert.equal(nodes[0].role, 'region');
        assert.deepEqual(nodes[0].boundingBox, {
            height: 200,
            width: 300,
            x: 10,
            y: 20
        });
        assert.equal(nodes[0].children[0].name, '收藏');
        assert.equal(nodes[0].children[0].disabled, true);
        assert.deepEqual(nodes[0].children[0].ancestors, [{
            name: '应用11',
            role: 'region'
        }]);
        assert.equal(nodes[0].children[1].checked, 'mixed');
    });
});
