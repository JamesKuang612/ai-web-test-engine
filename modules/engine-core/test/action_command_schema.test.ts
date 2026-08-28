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

    it('允许 UNCERTAIN 携带不臆测候选编号的业务语义目标', () => {
        const command = actionCommandSchema.parse({
            type: 'UNCERTAIN',
            target: {
                candidateId: null,
                description: '当前页面内能够返回工作台的控件'
            },
            value: null,
            expectedEffect: '返回工作台并显示应用列表',
            reasonSummary: '观察中缺少可识别的返回控件',
            risk: 'read-only'
        });

        assert.deepEqual(command.target, {
            description: '当前页面内能够返回工作台的控件'
        });
        assert.equal(command.expectedEffect, '返回工作台并显示应用列表');
    });

    it('拒绝 UNCERTAIN 携带伪造 candidateId', () => {
        assert.throws(() => actionCommandSchema.parse({
            type: 'UNCERTAIN',
            target: {
                candidateId: 'guessed-element',
                description: '返回工作台控件'
            },
            value: null,
            expectedEffect: null,
            reasonSummary: '猜测一个页面候选',
            risk: 'read-only'
        }), /UNCERTAIN 只能携带/u);
    });

});

describe('ActionCommand Schema 严格输出', () => {
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

    it('为字面量值声明严格结构化输出要求的显式类型', () => {
        assert.equal(
            JSON.stringify(actionCommandSchema.jsonSchema).includes(
                '"value":{"type":["string","number","boolean","null"]}'
            ),
            true
        );
    });
});

describe('ActionCommand Schema 扩展动作', () => {
    it('解析悬浮、下拉选择、复选框和受限等待动作', () => {
        const hover = actionCommandSchema.parse({
            type: 'HOVER',
            target: {
                candidateId: 'application-11',
                description: '“11”应用卡片'
            },
            reasonSummary: '悬浮后显示收藏按钮',
            risk: 'read-only'
        });
        const select = actionCommandSchema.parse({
            type: 'SELECT',
            target: {
                candidateId: 'select-1',
                description: '语言下拉框'
            },
            value: {
                source: 'literal',
                value: '简体中文'
            },
            reasonSummary: '选择页面语言',
            risk: 'reversible'
        });
        const check = actionCommandSchema.parse({
            type: 'CHECK',
            target: {
                candidateId: 'checkbox-1',
                description: '记住我'
            },
            value: {
                source: 'literal',
                value: true
            },
            reasonSummary: '勾选记住我',
            risk: 'reversible'
        });
        const wait = actionCommandSchema.parse({
            type: 'WAIT',
            value: {
                source: 'literal',
                value: 1_000
            },
            reasonSummary: '等待异步内容渲染',
            risk: 'read-only'
        });

        assert.equal(hover.type, 'HOVER');
        assert.equal(select.type, 'SELECT');
        assert.equal(check.value?.source, 'literal');
        assert.equal(wait.type, 'WAIT');
    });

    it('拒绝模糊勾选状态和越界等待时间', () => {
        assert.throws(() => actionCommandSchema.parse({
            type: 'CHECK',
            target: {
                candidateId: 'checkbox-1',
                description: '记住我'
            },
            value: null,
            reasonSummary: '切换记住我',
            risk: 'reversible'
        }), /CHECK 必须提供输入值引用/u);
        assert.throws(() => actionCommandSchema.parse({
            type: 'WAIT',
            value: {
                source: 'literal',
                value: 30_000
            },
            reasonSummary: '长时间等待',
            risk: 'read-only'
        }), /100～5000/u);
        assert.throws(() => actionCommandSchema.parse({
            type: 'HOVER',
            target: {
                description: '缺少候选编号的应用卡片'
            },
            reasonSummary: '尝试悬浮',
            risk: 'read-only'
        }), /HOVER 必须引用/u);
    });
});
