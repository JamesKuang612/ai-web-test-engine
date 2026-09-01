import assert from 'node:assert/strict';

import type {
    RecoveryPlannerInput,
} from '../src';
import {
    DeterministicRecoveryPlanner,
    RecoveryTargetQualityPolicy,
} from '../src';

describe('RecoveryTargetQualityPolicy', () => {
    it('匿名 button + nearbyText 不生成 HOVER "button"', async () => {
        const input = recoveryInput();
        input.view.elements = [{
            role: 'button',
            disabled: false,
            visible: true,
            inViewport: true,
            nearbyText: [ '应用 11' ]
        }];
        const decision = await new DeterministicRecoveryPlanner().plan(input);

        assert.equal(decision.kind, 'stop');
        assert.equal(JSON.stringify(decision).includes('"button"'), false);
    });

    it('保留具有具体 name 的 hover reveal proposal', async () => {
        const input = recoveryInput();
        input.view.elements = [{
            role: 'button',
            name: '应用 11 卡片',
            disabled: false,
            visible: true,
            inViewport: true,
            nearbyText: [ '应用 11' ]
        }];
        const decision = await new DeterministicRecoveryPlanner().plan(input);

        assert.equal(decision.kind, 'recover');
        if (decision.kind === 'recover') {
            assert.equal(decision.action.type, 'HOVER');
            assert.deepEqual('target' in decision.action
                ? decision.action.target
                : undefined, { description: '应用 11 卡片' });
        }
    });

    it('模型层泛化描述同样不能越过 proposal boundary', () => {
        const quality = new RecoveryTargetQualityPolicy();

        [ 'button', '页面上的按钮', '某个 button', '这个图标' ]
            .forEach((description) => assert.equal(quality.evaluate({
                type: 'HOVER',
                target: { description },
                reasonSummary: '尝试显示隐藏控件'
            }).allowed, false, description));
    });

    it('具体语义目标不会被 generic wrapper 清理误伤', () => {
        const quality = new RecoveryTargetQualityPolicy();

        [ '搜索输入框', '关闭按钮', '应用11卡片', '新建应用' ]
            .forEach((description) => assert.equal(quality.evaluate({
                type: 'HOVER',
                target: { description },
                reasonSummary: '执行低风险恢复'
            }).allowed, true, description));
    });
});

function recoveryInput(): RecoveryPlannerInput {
    return {
        step: {
            id: 'step-1',
            primaryAction: {
                type: 'CLICK',
                target: {
                    description: '收藏星标',
                    scope: '应用 11'
                },
                reasonSummary: '收藏应用 11'
            }
        },
        testIntent: {
            schemaVersion: 1,
            objective: '收藏应用 11',
            preconditions: [],
            successCriteria: [],
            failureCriteria: [],
            constraints: [],
            allowedHosts: [ 'example.test' ],
            dataPolicy: { generatedValues: {} }
        },
        failure: {
            grounding: {
                status: 'not-found',
                confidence: 0,
                summary: '未找到收藏星标',
                sourcesUsed: [ 'dom' ]
            }
        },
        view: {
            page: { loading: false, title: '工作台', urlChanged: false },
            visibleText: [ '应用 11' ],
            notices: [],
            elements: [],
            accessibility: [],
            overlayState: 'clear'
        },
        recentAttempts: [],
        allowedCapabilities: [ 'HOVER' ]
    };
}
