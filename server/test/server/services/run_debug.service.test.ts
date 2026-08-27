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
        assert.deepEqual(
            engine.lastInput?.environment.allowedHosts,
            [
                'test.jdydevelop.com',
                'test.frjdy.com',
                'www.jiandaoyun.com'
            ]
        );
        assert.equal(engine.lastInput?.budgets.maxActions, 20);
        assert.equal(engine.lastInput?.budgets.maxModelCalls, 15);
        assert.equal(
            engine.lastInput?.projectContext.terms.accountMenu,
            '点击工作台右上角用户头像后展开的账号菜单'
        );
        assert.equal(
            engine.lastInput?.projectContext.rules.some(
                (rule) => rule.includes('不得执行退出登录')
            ),
            true
        );
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

    it('为 structured-replay 设置计划引用和单次模型预算', async () => {
        const engine = new FakeExecutionEngine();
        const service = new RunDebugService(engine);

        await service.run(
            '执行登录计划',
            new AbortController().signal,
            {
                mode: 'structured-replay',
                planRef: 'source-run/json/compiled-plan.json'
            }
        );

        assert.equal(engine.lastInput?.mode, 'structured-replay');
        assert.equal(
            engine.lastInput?.test.execution?.planRef,
            'source-run/json/compiled-plan.json'
        );
        assert.equal(engine.lastInput?.budgets.maxModelCalls, 1);
    });

    it('拒绝缺少安全 planRef 的 structured-replay 请求', async () => {
        const service = new RunDebugService(new FakeExecutionEngine());

        await assert.rejects(() => service.run(
            '执行登录计划',
            new AbortController().signal,
            {
                mode: 'structured-replay',
                planRef: '../compiled-plan.json'
            }
        ), RunDebugInputError);
    });

    it('使用前端提供的用例身份和安全起始地址', async () => {
        const engine = new FakeExecutionEngine();
        const service = new RunDebugService(engine);

        await service.run(
            '点击“我的待办”。',
            new AbortController().signal,
            {
                testId: 'my-todo',
                testName: '验证我的待办',
                startUrl: 'https://test.jdydevelop.com/dashboard#/todo'
            }
        );

        assert.equal(engine.lastInput?.test.id, 'my-todo');
        assert.equal(engine.lastInput?.test.name, '验证我的待办');
        assert.equal(
            engine.lastInput?.test.startUrl,
            'https://test.jdydevelop.com/dashboard#/todo'
        );
    });

    it('只接受白名单登录模块并写入运行上下文', async () => {
        const engine = new FakeExecutionEngine();
        const service = new RunDebugService(engine);

        await service.run('打开我的待办。', new AbortController().signal, {
            setupModules: [ 'jiandaoyun-login' ]
        });

        assert.deepEqual(
            engine.lastInput?.test.execution?.setupModules,
            [ 'jiandaoyun-login' ]
        );
        assert.equal(
            engine.lastInput?.projectContext.rules.some(
                (rule) => rule.includes('结构化登录')
            ),
            true
        );
        await assert.rejects(() => service.run(
            '打开页面。',
            new AbortController().signal,
            { setupModules: [ 'unknown-module' ] }
        ), RunDebugInputError);
    });

    it('拒绝越过环境 Host 边界的起始地址', async () => {
        const service = new RunDebugService(new FakeExecutionEngine());

        await assert.rejects(() => service.run(
            '打开页面',
            new AbortController().signal,
            {
                startUrl: 'https://example.com/'
            }
        ), /只允许以下 Host/u);
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
