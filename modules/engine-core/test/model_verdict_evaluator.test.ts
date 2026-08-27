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
    history: [{
        command: {
            type: 'NAVIGATE',
            value: {
                source: 'literal',
                value: 'https://test.jdydevelop.com/dashboard#/'
            },
            reasonSummary: '进入测试起始页面',
            risk: 'read-only'
        },
        actionResult: {
            status: 'executed',
            startedAt: '2026-08-26T00:00:00.000Z',
            finishedAt: '2026-08-26T00:00:01.000Z',
            browserSignals: {
                dialogOpened: false,
                downloadStarted: false,
                newTabOpened: false,
                urlChanged: true
            }
        },
        beforeObservationRef: 'observation-before-navigation.json',
        afterObservationRef: 'observation-after-navigation.json'
    }],
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
        assert.match(
            adapter.lastRequest?.userPrompt ?? '',
            /https:\/\/test\.jdydevelop\.com\/dashboard/u
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

describe('ModelVerdictEvaluator exact text assertions', () => {
    it('程序级逐字复核会推翻模型的宽松 PASS', async () => {
        const exactSuccessId = 'engine-exact-text-1';
        const exactFailureId = 'engine-exact-text-1-mismatch';
        const exactInput: EvaluateVerdictInput = {
            ...input,
            testIntent: {
                ...input.testIntent,
                successCriteria: [
                    ...input.testIntent.successCriteria,
                    {
                        id: exactSuccessId,
                        description: '页面逐字显示“退出登录”。',
                        preferredEvidence: ['dom'],
                        required: true
                    }
                ],
                failureCriteria: [
                    ...input.testIntent.failureCriteria,
                    {
                        id: exactFailureId,
                        description: '“退出登录”文字不完全一致。'
                    }
                ],
                exactTextAssertions: [{
                    successCriterionId: exactSuccessId,
                    failureCriterionId: exactFailureId,
                    ordered: false,
                    values: ['退出登录']
                }]
            },
            observation: {
                ...input.observation,
                visibleText: [
                    '简道云工作台',
                    '退出'
                ]
            }
        };
        const loosePass: VerdictDecision = {
            ...passDecision,
            successCriteria: [
                ...passDecision.successCriteria,
                {
                    criterionId: exactSuccessId,
                    status: 'MATCHED',
                    summary: '“退出”语义等同于退出登录。'
                }
            ],
            failureCriteria: [
                ...passDecision.failureCriteria,
                {
                    criterionId: exactFailureId,
                    status: 'NOT_MATCHED',
                    summary: '模型认为没有差异。'
                }
            ]
        };
        const evaluator = new ModelVerdictEvaluator(
            new FakeModelAdapter(loosePass),
            verdictDecisionSchema
        );

        const decision = await evaluator.evaluate(
            exactInput,
            new AbortController().signal
        );

        assert.equal(decision.result, 'FAIL');
        assert.equal(
            decision.successCriteria.at(-1)?.status,
            'NOT_MATCHED'
        );
        assert.equal(
            decision.failureCriteria.at(-1)?.status,
            'MATCHED'
        );
        assert.match(decision.summary, /缺失精确文本：退出登录/u);
    });
});

describe('ModelVerdictEvaluator unfinished exact text assertions', () => {
    it('执行中途无法继续时不会把尚未出现的最终文本判为失败', async () => {
        const exactSuccessId = 'engine-exact-text-1';
        const exactFailureId = 'engine-exact-text-1-mismatch';
        const exactInput: EvaluateVerdictInput = {
            ...input,
            testIntent: {
                ...input.testIntent,
                successCriteria: [
                    ...input.testIntent.successCriteria,
                    {
                        id: exactSuccessId,
                        description: '最终工作台逐字显示“2026.8.27”。',
                        preferredEvidence: ['dom'],
                        required: true
                    }
                ],
                failureCriteria: [
                    ...input.testIntent.failureCriteria,
                    {
                        id: exactFailureId,
                        description: '最终应用名称文字不完全一致。'
                    }
                ],
                exactTextAssertions: [{
                    successCriterionId: exactSuccessId,
                    failureCriterionId: exactFailureId,
                    ordered: false,
                    values: ['2026.8.27']
                }]
            },
            observation: {
                ...input.observation,
                visibleText: [
                    '新建应用',
                    '创建空白应用'
                ]
            },
            stopCommand: {
                type: 'UNCERTAIN',
                reasonSummary: '当前页面没有可唯一定位的创建空白应用候选元素。',
                risk: 'read-only'
            }
        };
        const prematurePass: VerdictDecision = {
            ...passDecision,
            successCriteria: [
                ...passDecision.successCriteria,
                {
                    criterionId: exactSuccessId,
                    status: 'MATCHED',
                    summary: '模型错误地提前放行。'
                }
            ],
            failureCriteria: [
                ...passDecision.failureCriteria,
                {
                    criterionId: exactFailureId,
                    status: 'NOT_MATCHED',
                    summary: '模型尚未发现文字差异。'
                }
            ]
        };
        const evaluator = new ModelVerdictEvaluator(
            new FakeModelAdapter(prematurePass),
            verdictDecisionSchema
        );

        const decision = await evaluator.evaluate(
            exactInput,
            new AbortController().signal
        );

        assert.equal(decision.result, 'UNCERTAIN');
        assert.equal(
            decision.successCriteria.at(-1)?.status,
            'UNKNOWN'
        );
        assert.equal(
            decision.failureCriteria.at(-1)?.status,
            'UNKNOWN'
        );
        assert.match(decision.summary, /暂不可判定/u);
        assert.match(decision.summary, /2026\.8\.27/u);
    });
});

describe('ModelVerdictEvaluator uncertain stop boundary', () => {
    it('中途停止时不会把最终目标尚未出现判为业务失败', async () => {
        const absentInput: EvaluateVerdictInput = {
            ...input,
            testIntent: {
                ...input.testIntent,
                successCriteria: [{
                    id: 'application-exists',
                    description: '工作台存在应用“2026.8.27”。',
                    preferredEvidence: ['dom'],
                    required: true
                }],
                failureCriteria: [{
                    id: 'application-not-found',
                    description: '创建完成后未找到应用“2026.8.27”。'
                }]
            },
            observation: {
                ...input.observation,
                visibleText: [ '工作台', '新建应用' ]
            },
            stopCommand: {
                type: 'UNCERTAIN',
                reasonSummary: '当前页面证据不足。',
                risk: 'read-only'
            }
        };
        const prematureFailure: VerdictDecision = {
            result: 'FAIL',
            summary: '没有找到目标应用。',
            successCriteria: [{
                criterionId: 'application-exists',
                status: 'NOT_MATCHED',
                summary: '页面未出现目标应用。'
            }],
            failureCriteria: [{
                criterionId: 'application-not-found',
                status: 'MATCHED',
                summary: '工作台未找到目标应用。'
            }]
        };
        const evaluator = new ModelVerdictEvaluator(
            new FakeModelAdapter(prematureFailure),
            verdictDecisionSchema
        );

        const decision = await evaluator.evaluate(
            absentInput,
            new AbortController().signal
        );

        assert.equal(decision.result, 'UNCERTAIN');
        assert.equal(decision.successCriteria[0]?.status, 'UNKNOWN');
        assert.equal(decision.failureCriteria[0]?.status, 'UNKNOWN');
        assert.match(decision.summary, /证据不足阶段/u);
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
