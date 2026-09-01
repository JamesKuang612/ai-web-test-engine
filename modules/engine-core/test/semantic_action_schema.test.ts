import assert from 'node:assert/strict';
import {
    SemanticActionSchemaError,
    semanticActionSchema,
} from '../src';

describe('semanticActionSchema', () => {
    it('所有对象节点满足 Codex strict required 约束', () => {
        assertStrictObjectSchemas(semanticActionSchema.jsonSchema);
    });

    it('主 Planner Schema 不开放 Recovery-only 动作', () => {
        [ 'BACK', 'SCROLL', 'INSPECT', 'NAVIGATE' ].forEach((type) => {
            assert.throws(() => semanticActionSchema.parse({
                type,
                target: null,
                value: null,
                expectedEffect: null,
                reasonSummary: 'Recovery-only'
            }));
        });
    });

    it('接受不包含物理定位信息的语义动作', () => {
        assert.deepEqual(semanticActionSchema.parse({
            type: 'CLICK',
            target: {
                description: '收藏星标',
                scope: '应用 11'
            },
            value: null,
            expectedEffect: '应用 11 变为已收藏',
            reasonSummary: '收藏目标应用'
        }), {
            type: 'CLICK',
            target: {
                description: '收藏星标',
                scope: '应用 11'
            },
            expectedEffect: '应用 11 变为已收藏',
            reasonSummary: '收藏目标应用'
        });
    });

    it('把 strict schema 的 nullable scope 还原为缺省 scope', () => {
        assert.deepEqual(semanticActionSchema.parse({
            type: 'CLICK',
            target: {
                description: '新建应用',
                scope: null
            },
            value: null,
            expectedEffect: null,
            reasonSummary: '点击新建应用'
        }), {
            type: 'CLICK',
            target: { description: '新建应用' },
            reasonSummary: '点击新建应用'
        });
    });

    it('Phase 1 拒绝 Planner 输出空间 relation', () => {
        assert.throws(() => semanticActionSchema.parse({
            type: 'CLICK',
            target: {
                description: '收藏星标',
                relation: '应用名称左侧'
            },
            value: null,
            expectedEffect: '应用变为已收藏',
            reasonSummary: '点击收藏'
        }), (error: unknown) => error instanceof SemanticActionSchemaError
            && error.path === 'SemanticAction.target.relation');
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

function assertStrictObjectSchemas(value: unknown, path = 'schema'): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertStrictObjectSchemas(
            item,
            `${ path }[${ index }]`
        ));
        return;
    }
    if (typeof value !== 'object' || value === null) {
        return;
    }
    const record = value as Record<string, unknown>;
    if (
        record.type === 'object'
        && typeof record.properties === 'object'
        && record.properties !== null
    ) {
        const properties = Object.keys(
            record.properties as Record<string, unknown>
        ).sort();
        assert.deepEqual(
            Array.isArray(record.required) ? [ ...record.required ].sort() : [],
            properties,
            `${ path }.required 必须包含 properties 的全部字段`
        );
    }
    Object.entries(record).forEach(([ key, item ]) => {
        assertStrictObjectSchemas(item, `${ path }.${ key }`);
    });
}
