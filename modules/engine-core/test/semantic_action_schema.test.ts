import assert from 'node:assert/strict';
import {
    SemanticActionSchemaError,
    semanticActionSchema,
} from '../src';

describe('semanticActionSchema', () => {
    it('接受不包含物理定位信息的语义动作', () => {
        assert.deepEqual(semanticActionSchema.parse({
            type: 'CLICK',
            target: {
                description: '收藏星标',
                scope: '应用 11',
                relation: '应用名称左侧'
            },
            value: null,
            expectedEffect: '应用 11 变为已收藏',
            reasonSummary: '收藏目标应用'
        }), {
            type: 'CLICK',
            target: {
                description: '收藏星标',
                scope: '应用 11',
                relation: '应用名称左侧'
            },
            expectedEffect: '应用 11 变为已收藏',
            reasonSummary: '收藏目标应用'
        });
    });

    it('拒绝 Planner 输出 candidateId', () => {
        assert.throws(() => semanticActionSchema.parse({
            type: 'CLICK',
            target: {
                candidateId: 'e7',
                description: '收藏星标'
            },
            value: null,
            expectedEffect: '应用变为已收藏',
            reasonSummary: '点击收藏'
        }), (error: unknown) => error instanceof SemanticActionSchemaError
            && error.path === 'SemanticAction.target.candidateId');
    });

    it('拒绝 Planner 提供风险授权字段', () => {
        assert.throws(() => semanticActionSchema.parse({
            type: 'FINISH',
            target: null,
            value: null,
            expectedEffect: null,
            reasonSummary: '目标已经满足',
            risk: 'read-only'
        }), (error: unknown) => error instanceof SemanticActionSchemaError
            && error.path === 'SemanticAction.risk');
    });
});
