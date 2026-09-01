import assert from 'node:assert/strict';

import type {
    GroundingDecision,
    ModelProtocolDiagnostic,
    PagePerception,
    RecoveryDecision,
    RecoveryPlannerPort,
    RecoverySafetyPolicy,
    SemanticAction,
    SemanticStepActionExecution,
    SemanticStepRuntimePort,
    TestIntent,
} from '../src';
import {
    DeterministicRecoverySafetyPolicy,
    SemanticStepController,
    SemanticStepProgressEvaluator,
} from '../src';

// eslint-disable-next-line max-lines-per-function
describe('SemanticStepController', () => {
    it('async search: CLEAR → internal settle → original action succeeds', async () => {
        const initial = perception('initial', {
            elements: [ element('search', '搜索', 'filled') ]
        });
        const searching = perception('searching', {
            previous: initial,
            elements: [ element('search', '搜索', 'empty') ],
            visibleText: [ '搜索中...' ],
            stability: 'transient'
        });
        const ready = perception('ready', {
            previous: searching,
            elements: [
                element('search', '搜索', 'empty'),
                element('new-app', '新建应用')
            ]
        });
        const done = perception('done', {
            previous: ready,
            url: 'https://example.test/new-app',
            title: '新建应用页面'
        });
        const runtime = new FakeRuntime(initial, (action, current) => {
            if (action.type === 'TYPE') {
                return grounded('search', current, '搜索');
            }
            return current.dom.stateFingerprint === 'ready'
                || current.dom.stateFingerprint === 'done'
                ? grounded('new-app', current, '新建应用')
                : decision('blocked');
        }, (action) => action.type === 'TYPE' ? searching : done,
        (current) => current.dom.stateFingerprint === 'searching'
            ? ready
            : current);

        const result = await controller(runtime).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            expectedEffect: '进入新建应用页面',
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'completed');
        assert.deepEqual(runtime.executedTypes, [ 'TYPE', 'CLICK' ]);
        assert.equal(result.recoveryAttempts.length, 1);
        assert.equal(runtime.settleCalls, 3);
        assert.deepEqual(result.executions.map(
            ({ compilationContribution }) => compilationContribution
        ), [ 'productive', 'productive' ]);
    });

    it('search overlay: blocked → CLEAR → original action succeeds', async () => {
        const initial = perception('initial', {
            elements: [ element('search', '搜索', 'filled') ]
        });
        const cleared = perception('cleared', {
            previous: initial,
            elements: [ element('search', '搜索', 'empty') ]
        });
        const done = perception('done', {
            previous: cleared,
            url: 'https://example.test/new-app',
            title: '新建应用页面'
        });
        const runtime = new FakeRuntime(initial, (action, current) => {
            if (action.type === 'TYPE') {
                return grounded('search', current, '搜索');
            }
            return current.dom.stateFingerprint === 'initial'
                ? decision('blocked')
                : grounded('new-app', current);
        }, (action) => action.type === 'TYPE' ? cleared : done);

        const result = await controller(runtime).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            expectedEffect: '进入新建应用页面',
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'completed');
        assert.deepEqual(runtime.executedTypes, [ 'TYPE', 'CLICK' ]);
        assert.equal(result.executions[0]?.recoveryAction?.type, 'CLEAR');
        assert.deepEqual(result.executions.map(
            ({ compilationContribution }) => compilationContribution
        ), [ 'productive', 'productive' ]);
    });

    it('hover reveal: not-found → HOVER → original action succeeds', async () => {
        const initial = perception('initial', {
            elements: [ element('card', '应用 11') ]
        });
        const revealed = perception('revealed', {
            previous: initial,
            elements: [
                element('card', '应用 11'),
                element('star', '收藏星标')
            ]
        });
        const favorited = perception('favorited', {
            previous: revealed,
            visibleText: [ '已收藏应用 11' ]
        });
        const runtime = new FakeRuntime(initial, (action, current) => {
            if (action.type === 'HOVER') {
                return grounded('card', current);
            }
            return current.dom.stateFingerprint === 'initial'
                ? decision('not-found')
                : grounded('star', current);
        }, (action) => action.type === 'HOVER' ? revealed : favorited);
        const progress = new SemanticStepProgressEvaluator({
            modelFallback: {
                evaluate: async () => ({
                    status: 'complete',
                    basis: 'model',
                    summary: '收藏状态已经出现。',
                    evidence: []
                })
            }
        });

        const result = await controller(runtime, progress).execute(step({
            type: 'CLICK',
            target: {
                description: '收藏星标',
                scope: '应用 11'
            },
            expectedEffect: '应用 11 进入我的收藏',
            reasonSummary: '收藏应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'completed');
        assert.deepEqual(runtime.executedTypes, [ 'HOVER', 'CLICK' ]);
        assert.equal(runtime.modelPurposes.includes('step-progress'), true);
    });

    it('wrong transient action: executed wrong-state → restore → continue', async () => {
        const initial = perception('initial');
        const wrong = perception('wrong', {
            previous: initial,
            url: 'https://example.test/settings',
            elements: [ element('close', '关闭菜单') ],
            blocked: true
        });
        const restored = perception('restored', {
            previous: wrong,
            elements: [ element('new-app', '新建应用') ]
        });
        const done = perception('done', {
            previous: restored,
            url: 'https://example.test/new-app',
            title: '新建应用页面'
        });
        const model = new SequenceRecoveryPlanner([{
            kind: 'recover',
            action: {
                type: 'CLICK',
                target: { description: '设置菜单' },
                reasonSummary: '打开临时菜单寻找入口'
            }
        }]);
        const runtime = new FakeRuntime(initial, (action, current) => {
            if (action.target?.description === '设置菜单') {
                return grounded('gear', current, '设置菜单');
            }
            if (action.target?.description === '关闭菜单') {
                return grounded('close', current, '关闭菜单');
            }
            return current.dom.stateFingerprint === 'restored' ||
                current.dom.stateFingerprint === 'done'
                ? grounded('new-app', current)
                : decision('not-found');
        }, (action, current) => {
            if (action.target?.description === '设置菜单') {
                return wrong;
            }
            if (action.target?.description === '关闭菜单') {
                return restored;
            }
            return current.dom.stateFingerprint === 'restored' ? done : current;
        });

        const result = await controller(
            runtime,
            new SemanticStepProgressEvaluator(),
            model
        ).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            expectedEffect: '进入新建应用页面',
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'completed');
        assert.deepEqual(runtime.executedTypes, [ 'CLICK', 'CLICK', 'CLICK' ]);
        assert.equal(result.executions[1]?.restorative, true);
        assert.equal(result.executions[1]?.recoveryOutcome, 'progress');
        assert.deepEqual(result.executions.map(
            ({ compilationContribution }) => compilationContribution
        ), [ 'wrong-state', 'non-productive', 'productive' ]);
    });

    it('unsafe recovery: proposal rejected and Browser never called', async () => {
        const initial = perception('initial');
        const model = new SequenceRecoveryPlanner([{
            kind: 'recover',
            action: {
                type: 'CLICK',
                target: { description: '删除应用' },
                reasonSummary: '尝试删除应用以恢复'
            }
        }]);
        const runtime = new FakeRuntime(
            initial,
            (action, current) => action.target?.description === '删除应用'
                ? grounded('delete', current, '删除应用')
                : decision('not-found'),
            () => initial
        );

        const result = await controller(
            runtime,
            new SemanticStepProgressEvaluator(),
            model
        ).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'unsafe');
        assert.equal(runtime.executedTypes.length, 0);
    });

    it('recovery cycle: 相同状态与动作触发 bounded termination', async () => {
        const loading = perception('loading', { loading: true });
        const runtime = new FakeRuntime(
            loading,
            () => decision('not-found'),
            () => loading
        );

        const result = await controller(runtime).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'cycle');
        assert.deepEqual(runtime.executedTypes, [ 'WAIT' ]);
    });

    it('physical success != semantic success', async () => {
        const initial = perception('initial', {
            elements: [ element('card', '应用 11') ]
        });
        const unchanged = perception('unchanged', { previous: initial });
        const runtime = new FakeRuntime(
            initial,
            (_action, current) => grounded('card', current),
            () => unchanged
        );

        const result = await controller(runtime).execute(step({
            type: 'HOVER',
            target: { description: '应用 11' },
            reasonSummary: '显示隐藏操作'
        }), intent, signal());

        assert.notEqual(result.outcome.status, 'completed');
        assert.equal(runtime.executedTypes.length, 2);
        assert.equal(runtime.executedTypes.every((type) => type === 'HOVER'), true);
        assert.equal(result.executions[0]?.actionResult.status, 'executed');
    });

    it('历史 delta 存在但本次 recovery 无变化时判 no-progress', async () => {
        const historical = perception('historical');
        const initial = perception('initial', { previous: historical });
        const unchanged = perception('unchanged', {
            previous: initial,
            delta: emptyDelta()
        });
        const model = new SequenceRecoveryPlanner([{
            kind: 'recover',
            action: {
                type: 'CLICK',
                target: { description: '关闭菜单' },
                reasonSummary: '关闭临时菜单'
            }
        }]);
        const runtime = new FakeRuntime(
            initial,
            (action, current) => action.target?.description === '关闭菜单'
                ? grounded('close', current, '关闭菜单')
                : decision('not-found'),
            () => unchanged
        );

        const result = await controller(
            runtime,
            new SemanticStepProgressEvaluator(),
            model
        ).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.executions[0]?.recoveryOutcome, 'no-progress');
        assert.equal(
            result.executions[0]?.compilationContribution,
            'non-productive'
        );
    });

    it('无关 visibleText/candidate delta 不构成 primary progress', async () => {
        const initial = perception('initial');
        const unrelatedDelta = emptyDelta();
        unrelatedDelta.visibleText.added = [ '后台任务已经完成' ];
        unrelatedDelta.candidates.added = [ 'toast-close' ];
        const changed = perception('changed', {
            previous: initial,
            delta: unrelatedDelta,
            visibleText: [ '后台任务已经完成' ]
        });
        const model = new SequenceRecoveryPlanner([{
            kind: 'recover',
            action: {
                type: 'CLICK',
                target: { description: '关闭菜单' },
                reasonSummary: '关闭临时菜单'
            }
        }]);
        const runtime = new FakeRuntime(
            initial,
            (action, current) => action.target?.description === '关闭菜单'
                ? grounded('close', current, '关闭菜单')
                : decision('not-found'),
            () => changed
        );

        const result = await controller(
            runtime,
            new SemanticStepProgressEvaluator(),
            model
        ).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.executions[0]?.recoveryOutcome, 'no-progress');
        assert.equal(
            result.executions[0]?.compilationContribution,
            'non-productive'
        );
    });

    it('Recovery protocol repair 失败后 exhausted 而不抛异常', async () => {
        const initial = perception('initial', {
            elements: [ element('search', '搜索', 'filled') ]
        });
        const cleared = perception('cleared', {
            previous: initial,
            elements: [ element('search', '搜索', 'empty') ]
        });
        const runtime = new FakeRuntime(
            initial,
            (action, current) => action.type === 'TYPE'
                ? grounded('search', current, '搜索')
                : decision('not-found'),
            (action) => action.type === 'TYPE' ? cleared : initial
        );
        const planner = new ProtocolFailureRecoveryPlanner();

        const result = await controller(
            runtime,
            new SemanticStepProgressEvaluator(),
            planner
        ).execute(step({
            type: 'CLICK',
            target: { description: '新建应用' },
            reasonSummary: '创建应用'
        }), intent, signal());

        assert.equal(result.outcome.status, 'exhausted');
        assert.deepEqual(runtime.executedTypes, [ 'TYPE' ]);
        assert.equal(result.executions[0]?.recoveryAction?.type, 'CLEAR');
        assert.equal(
            result.executions[0]?.compilationContribution,
            'non-productive'
        );
        assert.deepEqual(runtime.modelPurposes, [
            'recovery-planner',
            'recovery-protocol-repair'
        ]);
        assert.deepEqual(runtime.protocolPhases, [ 'initial', 'repair' ]);
    });

    it('非导航 wrong-state 不会授权 BACK', () => {
        const policy = new DeterministicRecoverySafetyPolicy();
        const common = {
            action: {
                type: 'BACK' as const,
                reasonSummary: '撤销错误状态'
            },
            step: step({
                type: 'CLICK',
                target: { description: '新建应用' },
                reasonSummary: '创建应用'
            }),
            testIntent: intent,
            recoveryIntent: '撤销错误状态'
        };

        assert.equal(policy.evaluate(common).allowed, false);
        assert.equal(policy.evaluate({
            ...common,
            recoveryNavigation: {
                fromUrl: 'https://example.test/workbench',
                toUrl: 'https://example.test/settings'
            }
        }).allowed, true);
        assert.equal(policy.evaluate({
            ...common,
            recoveryNavigation: {
                fromUrl: 'https://example.test/workbench',
                toUrl: 'https://outside.test/settings'
            }
        }).allowed, false);
    });
});

const intent: TestIntent = {
    schemaVersion: 1,
    objective: '完成目标操作',
    preconditions: [],
    successCriteria: [{
        id: 'done',
        description: '目标完成',
        preferredEvidence: [ 'dom' ],
        required: true
    }],
    failureCriteria: [],
    constraints: [],
    allowedHosts: [ 'example.test' ],
    dataPolicy: { generatedValues: {} }
};

class FakeRuntime implements SemanticStepRuntimePort<string> {
    public executedTypes: string[] = [];
    public modelPurposes: string[] = [];
    public settleCalls = 0;
    public protocolPhases: Array<'initial' | 'repair'> = [];
    private current: PagePerception;

    constructor(
        initial: PagePerception,
        private readonly grounder: (
            action: SemanticAction,
            perception: PagePerception
        ) => GroundingDecision,
        private readonly transition: (
            action: SemanticAction,
            perception: PagePerception
        ) => PagePerception,
        private readonly settleTransition: (
            perception: PagePerception
        ) => PagePerception = (perception) => perception
    ) {
        this.current = initial;
    }

    public canUseModel = () => true;
    public canExecuteAction = () => true;
    public perceive: SemanticStepRuntimePort<string>['perceive'] = async () =>
        this.current;
    public ground: SemanticStepRuntimePort<string>['ground'] = async (
        action,
        current
    ) => this.grounder(action, current);
    public settle: SemanticStepRuntimePort<string>['settle'] = async (
        current
    ) => {
        this.settleCalls += 1;
        const settled = this.settleTransition(current);
        return { status: 'stable', perception: settled as PagePerception & {
        stability: {
            consistency: 'consistent',
            state: 'stable',
            transientSignals: []
        }
        }, samples: [] };
    };
    public execute: SemanticStepRuntimePort<string>['execute'] = async (input) => {
        this.executedTypes.push(input.action.type);
        const after = this.transition(input.action, this.current);
        const urlChanged = after.dom.page.url !== this.current.dom.page.url;
        const execution: SemanticStepActionExecution<string> = {
            record: `${ input.origin }-${ this.executedTypes.length }`,
            origin: input.origin,
            semanticAction: input.action,
            ...input.recoveryAction
                ? { recoveryAction: input.recoveryAction }
                : {},
            actionResult: {
                status: 'executed',
                startedAt: '2026-08-31T00:00:00.000Z',
                finishedAt: '2026-08-31T00:00:01.000Z',
                browserSignals: {
                    dialogOpened: false,
                    downloadStarted: false,
                    newTabOpened: false,
                    urlChanged
                }
            },
            effect: {
                status: urlChanged && input.origin === 'recovery'
                    ? 'contradicted'
                    : 'confirmed',
                expectedEffect: input.action.expectedEffect ?? '局部变化',
                evidence: [],
                summary: '浏览器已执行动作。'
            },
            before: this.current,
            after,
            resolvedTarget: input.resolvedTarget,
            restorative: false,
            compilationContribution: 'non-productive'
        };
        this.current = after;
        return execution;
    };
    public recordReobserve = async () => {};
    public recordRecoveryProtocolDiagnostic = async (
        diagnostic: ModelProtocolDiagnostic
    ) => {
        this.protocolPhases.push(diagnostic.phase);
    };
    public reverifyEffectAfterSettling:
    SemanticStepRuntimePort<string>['reverifyEffectAfterSettling'] = async (
        execution
    ) => execution.effect;
    public consumeModelCalls: SemanticStepRuntimePort<string>['consumeModelCalls'] =
        (_count, purpose) => this.modelPurposes.push(purpose);
}

class SequenceRecoveryPlanner implements RecoveryPlannerPort {
    constructor(private readonly decisions: RecoveryDecision[]) {}
    public plan: RecoveryPlannerPort['plan'] = async () => ({
        status: 'decision',
        decision: this.decisions.shift() ?? {
            kind: 'stop',
            reason: '没有更多恢复动作'
        }
    });
}

class ProtocolFailureRecoveryPlanner implements RecoveryPlannerPort {
    public plan: RecoveryPlannerPort['plan'] = async () => ({
        status: 'protocol-invalid',
        diagnostic: protocolDiagnostic('initial')
    });
    public repairProtocol: NonNullable<
    RecoveryPlannerPort['repairProtocol']> = async () => ({
        status: 'protocol-invalid',
        diagnostic: protocolDiagnostic('repair')
    });
}

function protocolDiagnostic(
    phase: 'initial' | 'repair'
): ModelProtocolDiagnostic {
    return {
        schemaVersion: 1,
        modelRole: 'recovery-planner',
        phase,
        failureType: 'schema-invalid',
        parsedJson: { kind: 'stop' },
        schemaIssues: [{
            path: 'RecoveryDecision.action',
            code: 'missing-field',
            message: '字段缺失。'
        }],
        sanitized: true,
        truncated: false
    };
}

function controller(
    runtime: FakeRuntime,
    progress = new SemanticStepProgressEvaluator(),
    planner?: RecoveryPlannerPort,
    safety: RecoverySafetyPolicy = new DeterministicRecoverySafetyPolicy()
) {
    return new SemanticStepController(runtime, progress, safety, planner);
}

function step(primaryAction: SemanticAction) {
    return {
        id: 'step-1',
        primaryAction,
        ...primaryAction.expectedEffect
            ? { expectedEffect: primaryAction.expectedEffect }
            : {},
        source: 'runtime-wrapper' as const
    };
}

function decision(status: GroundingDecision['status']): GroundingDecision {
    return {
        status,
        confidence: 0,
        evidence: [],
        summary: status
    };
}

function grounded(
    candidateId: string,
    current: PagePerception,
    name = candidateId
): GroundingDecision {
    return {
        status: 'grounded',
        target: {
            description: name,
            observationId: current.dom.observationId,
            candidateId,
            elementSnapshot: {
                tag: 'button',
                role: 'button',
                name,
                valueState: name.includes('搜索') ? 'filled' : undefined,
                disabled: false,
                visible: true,
                inViewport: true,
                attributes: {},
                nearbyText: [],
                locatorHints: []
            },
            strategy: 'candidate-id',
            locatorData: {},
            confidence: 1,
            confidenceBasis: 'deterministic',
            unique: true,
            actionable: true,
            evidence: []
        },
        confidence: 1,
        confidenceBasis: 'deterministic',
        evidence: [],
        summary: 'grounded'
    };
}

function perception(id: string, options: {
    previous?: PagePerception,
    delta?: PagePerception['delta'],
    elements?: ReturnType<typeof element>[],
    visibleText?: string[],
    title?: string,
    url?: string,
    loading?: boolean,
    blocked?: boolean,
    stability?: 'stable' | 'transient'
} = {}): PagePerception {
    const elements = options.elements ?? [];
    return {
        perceptionId: `p-${ id }`,
        capturedAt: '2026-08-31T00:00:00.000Z',
        dom: {
            schemaVersion: 1,
            observationId: `o-${ id }`,
            capturedAt: '2026-08-31T00:00:00.000Z',
            page: {
                loading: options.loading ?? false,
                title: options.title ?? id,
                url: options.url ?? 'https://example.test/workbench',
                viewport: { width: 1280, height: 720 }
            },
            visibleText: options.visibleText ?? [ id ],
            interactiveElements: elements,
            notices: [],
            tabs: [],
            stateFingerprint: id,
            truncated: false
        },
        accessibility: {
            source: 'playwright-aria-snapshot',
            nodes: [],
            truncated: false
        },
        interactionStates: Object.fromEntries(elements.map((item) => [
            item.candidateId,
            {
                candidateId: item.candidateId,
                enabled: true,
                hitTest: options.blocked ? 'blocked' : 'receives-events',
                inViewport: true,
                visible: true
            }
        ])),
        stability: {
            consistency: 'consistent',
            state: options.stability ?? 'stable',
            transientSignals: options.stability === 'transient'
                ? [ 'loading-text' ]
                : []
        },
        ...options.delta
            ? { delta: options.delta }
            : options.previous
            ? {
                delta: {
                    accessibility: {
                        added: [], changed: [], removed: [], truncated: false
                    },
                    candidates: {
                        added: elements.map((item) => item.candidateId),
                        removed: [],
                        truncated: false
                    },
                    overlayState: {
                        before: 'clear',
                        after: options.blocked ? 'blocked' : 'clear',
                        changed: Boolean(options.blocked)
                    },
                    titleChanged: true,
                    urlChanged: options.previous.dom.page.url !==
                        (options.url ?? 'https://example.test/workbench'),
                    visibleText: {
                        added: options.visibleText ?? [ id ],
                        removed: [],
                        truncated: false
                    }
                }
            }
            : {}
    };
}

function emptyDelta(): NonNullable<PagePerception['delta']> {
    return {
        accessibility: {
            added: [], changed: [], removed: [], truncated: false
        },
        candidates: {
            added: [], removed: [], truncated: false
        },
        overlayState: {
            before: 'clear', after: 'clear', changed: false
        },
        titleChanged: false,
        urlChanged: false,
        visibleText: {
            added: [], removed: [], truncated: false
        }
    };
}

function element(
    candidateId: string,
    name: string,
    valueState?: 'empty' | 'filled'
) {
    return {
        candidateId,
        tag: valueState ? 'input' : 'button',
        role: valueState ? 'textbox' : 'button',
        name,
        ...valueState ? { valueState } : {},
        disabled: false,
        visible: true,
        inViewport: true,
        attributes: {},
        nearbyText: [],
        locatorHints: []
    };
}

function signal(): AbortSignal {
    return new AbortController().signal;
}
