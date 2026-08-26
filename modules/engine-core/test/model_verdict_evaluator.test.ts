import assert from 'node:assert/strict';
import {
    describe,
    it,
} from 'mocha';
import type {
    EvaluateVerdictInput,
    ModelAdapter,
    ModelRequest,
    ModelResult,
    RuntimeSchema,
    VerdictDecision,
} from '../src';
import {
    ModelVerdictEvaluator,
    verdictDecisionSchema,
} from '../src';

const input: EvaluateVerdictInput = {
    testIntent: {
        schemaVersion: 1,
        objective: '登录并进入工作台',
        preconditions: [],
        successCriteria: [{
            id: 'workspace-visible',
            description: '页面显示工作台',
            preferredEvidence: [
                'dom',
                'url'
            ],
            required: true
        }],
        failureCriteria: [{
            id: 'login-error',
            description: '页面显示账号或密码错误'
        }],
        constraints: [],
        allowedHosts: ['test.jdydevelop.com'],
        dataPolicy: {
            generatedValues: {}
        }
    },
    observation: {
        schemaVersion: 1,
        observationId: 'observation-final',
        capturedAt: '2026-08-26T00:00:00.000Z',
        page: {
            loading: false,
            title: '简道云工作台',
            url: 'https://test.jdydevelop.com/dashboard#/',
            viewport: {
                width: 1280,
                height: 720
            }
        },
        visibleText: ['简道云工作台'],
        interactiveElements: [],
        notices: [],
        tabs: [],
        stateFingerprint: 'final-fingerprint',
        truncated: false
    },
    history: [],
    stopCommand: {
        type: 'FINISH',
        reasonSummary: '页面已经进入工作台',
        risk: 'read-only'
    }
};

const passDecision: VerdictDecision = {
    result: 'PASS',
    summary: '最终页面显示工作台，登录成功。',
    successCriteria: [{
        criterionId: 'workspace-visible',
        status: 'MATCHED',
        summary: '页面标题和正文均显示工作台。'
    }],
    failureCriteria: [{
        criterionId: 'login-error',
        status: 'NOT_MATCHED',
        summary: '没有观察到登录错误提示。'
    }]
};

describe('ModelVerdictEvaluator', () => {
    it('根据最终页面证据返回与全部条件一致的 PASS', async () => {
        const adapter = new FakeModelAdapter(passDecision);
        const evaluator = new ModelVerdictEvaluator(
            adapter,
            verdictDecisionSchema,
            {
                maxOutputTokens: 1_000,
                timeoutMs: 20_000
            }
        );

        const decision = await evaluator.evaluate(
            input,
            new AbortController().signal
        );

        assert.deepEqual(decision, passDecision);
        assert.equal(adapter.lastRequest?.timeoutMs, 20_000);
        assert.match(
            adapter.lastRequest?.userPrompt ?? '',
            /简道云工作台/u
        );
    });

    it('拒绝遗漏 TestIntent 条件的判定', async () => {
        const evaluator = new ModelVerdictEvaluator(
            new FakeModelAdapter({
                ...passDecision,
                failureCriteria: []
            }),
            verdictDecisionSchema
        );

        await assert.rejects(
            evaluator.evaluate(input, new AbortController().signal),
            /失败条件判断没有完整覆盖 TestIntent/u
        );
    });

    it('拒绝条件证据与 PASS 结果互相矛盾', async () => {
        const evaluator = new ModelVerdictEvaluator(
            new FakeModelAdapter({
                ...passDecision,
                successCriteria: [{
                    ...passDecision.successCriteria[0],
                    status: 'UNKNOWN'
                }]
            }),
            verdictDecisionSchema
        );

        await assert.rejects(
            evaluator.evaluate(input, new AbortController().signal),
            /Verdict PASS 与条件判断不一致/u
        );
    });
});

/** 返回固定结构化输出并记录模型请求。 */
class FakeModelAdapter implements ModelAdapter {
    public lastRequest?: ModelRequest;

    constructor(private readonly output: unknown) {}

    /** 通过真实 Schema 解析预设模型输出。 */
    public generateStructured<T>(
        request: ModelRequest,
        schema: RuntimeSchema<T>,
        _signal: AbortSignal
    ): Promise<ModelResult<T>> {
        this.lastRequest = request;
        return Promise.resolve({
            model: 'fake-model',
            value: schema.parse(this.output)
        });
    }
}
