import assert from 'node:assert/strict';
import {
    ActionCommandSchemaError,
    actionCommandSchema,
} from '../src';

describe('ActionCommand Schema', () => {
    it('解析引用页面候选元素和环境变量的 TYPE 动作', () => {
        const command = actionCommandSchema.parse({
            type: 'TYPE',
            target: {
                candidateId: 'element-1',
                description: '账号输入框'
            },
            value: {
                source: 'environment',
                key: 'username'
            },
            expectedEffect: '账号输入框变为已填写',
            reasonSummary: '先填写登录账号',
            risk: 'reversible'
        });

        assert.equal(command.type, 'TYPE');
        assert.equal(command.target?.candidateId, 'element-1');
        assert.equal(command.value?.source, 'environment');
    });

    it('拒绝缺少 candidateId 的页面交互动作', () => {
        assert.throws(() => actionCommandSchema.parse({
            type: 'CLICK',
            target: {
                description: '登录按钮'
            },
            reasonSummary: '提交登录表单',
            risk: 'reversible'
        }), ActionCommandSchemaError);
    });

    it('拒绝终止建议携带页面目标', () => {
        assert.throws(() => actionCommandSchema.parse({
            type: 'FINISH',
            target: {
                candidateId: 'element-1',
                description: '登录按钮'
            },
            reasonSummary: '任务已经完成',
            risk: 'read-only'
        }), ActionCommandSchemaError);
    });

    it('接受严格结构化输出用 null 表示可选字段缺省', () => {
        const command = actionCommandSchema.parse({
            type: 'UNCERTAIN',
            target: null,
            value: null,
            expectedEffect: null,
            reasonSummary: '当前页面不足以继续操作',
            risk: 'read-only'
        });

        assert.deepEqual(command, {
            type: 'UNCERTAIN',
            reasonSummary: '当前页面不足以继续操作',
            risk: 'read-only'
        });
        assert.deepEqual(
            actionCommandSchema.jsonSchema.required,
            [
                'type',
                'target',
                'value',
                'expectedEffect',
                'reasonSummary',
                'risk'
            ]
        );
    });
});
