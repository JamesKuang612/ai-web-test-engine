import assert from 'node:assert/strict';
import type {
    ExecutionEngine,
    RunResult,
    StartRunInput,
} from '@ai-web-test-engine/core';
import {
    RunDebugInputError,
    RunDebugService,
} from '../../../src/services/run_debug.service';

const runResult: RunResult = {
    schemaVersion: 1,
    runId: 'run-debug-001',
    lifecycle: 'COMPLETED',
    result: 'UNCERTAIN',
    summary: '基础执行链路已跑通；尚未执行交互动作或业务断言。',
    evidence: [],
    traceRef: 'run-debug-001/trace.jsonl',
    metrics: {
        actionCount: 1,
        durationMs: 100,
        modelCallCount: 1,
        repeatedStateActionCount: 0
    }
};

describe('RunDebugService', () => {
    it('为自然语言补齐登录 POC 输入并启动执行引擎', async () => {
        const engine = new FakeExecutionEngine();
        const service = new RunDebugService(engine);
        const controller = new AbortController();

        const result = await service.run(
            '  打开简道云登录页  ',
            controller.signal
        );

        assert.equal(result, runResult);
        assert.equal(
            engine.lastInput?.test.action,
            '打开简道云登录页'
        );
        assert.equal(
            engine.lastInput?.test.startUrl,
            'https://test.jdydevelop.com/dashboard#/'
        );
        assert.equal(
            engine.lastInput?.environment.baseUrl,
            'https://test.jdydevelop.com/dashboard#/'
        );
        assert.equal(engine.lastInput?.budgets.maxActions, 2);
        assert.equal(engine.lastInput?.budgets.maxModelCalls, 2);
        assert.equal(engine.lastSignal, controller.signal);
    });

    it('拒绝空白的自然语言 action', async () => {
        const service = new RunDebugService(
            new FakeExecutionEngine()
        );

        await assert.rejects(
            service.run('   ', new AbortController().signal),
            RunDebugInputError
        );
    });
});

/** 记录 RunDebugService 交给核心执行引擎的参数。 */
class FakeExecutionEngine implements ExecutionEngine {
    public lastInput?: StartRunInput;
    public lastSignal?: AbortSignal;

    /** 返回固定结果并保留本次调用信息。 */
    public start = (
        input: StartRunInput,
        signal: AbortSignal
    ): Promise<RunResult> => {
        this.lastInput = input;
        this.lastSignal = signal;
        return Promise.resolve(runResult);
    };
}
