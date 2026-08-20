import assert from 'node:assert/strict';
import type {
    BuildIntentInput,
    IntentBuilder,
    TestIntent,
} from '@ai-web-test-engine/core';
import {
    IntentPreviewInputError,
    IntentPreviewService,
} from '../../../src/services/intent_preview.service';

const testIntent: TestIntent = {
    schemaVersion: 1,
    objective: '登录简道云并进入工作台',
    preconditions: [],
    successCriteria: [],
    failureCriteria: [],
    constraints: [
        '已经登录时不要重复登录'
    ],
    allowedHosts: [
        'test.jdydevelop.com'
    ],
    dataPolicy: {
        generatedValues: {}
    }
};

describe('IntentPreviewService', () => {
    it('为自然语言补齐登录 POC 上下文并调用 IntentBuilder', async () => {
        const intentBuilder = new FakeIntentBuilder(testIntent);
        const service = new IntentPreviewService(intentBuilder);
        const controller = new AbortController();

        const intent = await service.preview(
            '  帮我登录  ',
            controller.signal
        );

        assert.equal(intent, testIntent);
        assert.equal(intentBuilder.lastInput?.test.action, '帮我登录');
        assert.equal(
            intentBuilder.lastInput?.environment.allowedHosts[0],
            'test.jdydevelop.com'
        );
        assert.equal(
            intentBuilder.lastInput?.environment.variables.password.source,
            'local'
        );
        assert.equal(intentBuilder.lastSignal, controller.signal);
    });

    it('拒绝空白的自然语言 action', async () => {
        const service = new IntentPreviewService(
            new FakeIntentBuilder(testIntent)
        );

        await assert.rejects(
            service.preview(
                '   ',
                new AbortController().signal
            ),
            IntentPreviewInputError
        );
    });
});

/** 返回预设意图并记录 Service 构造的 BuildIntentInput。 */
class FakeIntentBuilder implements IntentBuilder {
    public lastInput?: BuildIntentInput;
    public lastSignal?: AbortSignal;

    constructor(private readonly intent: TestIntent) {}

    /** 模拟一次成功的测试意图构建。 */
    public build = (
        input: BuildIntentInput,
        signal: AbortSignal
    ): Promise<TestIntent> => {
        this.lastInput = input;
        this.lastSignal = signal;
        return Promise.resolve(this.intent);
    };
}
