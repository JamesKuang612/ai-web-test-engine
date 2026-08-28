import {
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import {
    Link,
    useNavigate,
    useParams,
} from 'react-router-dom';
import type {
    DebugPlanGenerationResult,
    DebugRunEvent,
    DebugRunMode,
    DebugRunResult,
    DebugRunSession,
    DebugRunSessionUpdate,
} from '../api/run-debug';
import {
    cancelDebugRunSession,
    generateDebugRunPlan,
    getDebugScreenshotUrl,
    getLatestDebugRunSession,
    startDebugRun,
    subscribeDebugRunSession,
} from '../api/run-debug';
import {
    createTestDefinition,
    getTestDefinitionRecord,
    updateTestDefinition,
} from '../api/test-definitions';
import { Icon } from '../components/Icon';

type InspectorTab = 'timeline' | 'context' | 'console' | 'network' | 'html';
type LoadState = 'error' | 'loading' | 'ready';
type RunState =
    | 'cancelled'
    | 'failed'
    | 'idle'
    | 'passed'
    | 'running'
    | 'uncertain';
type SaveState = 'dirty' | 'saved' | 'saving';

const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'timeline', label: '时间线' },
    { id: 'context', label: '上下文' },
    { id: 'console', label: '控制台' },
    { id: 'network', label: '网络' },
    { id: 'html', label: 'HTML' }
];

const DEFAULT_START_URL = 'https://test.jdydevelop.com/dashboard#/';
const PLAN_REFERENCE_STORAGE_PREFIX = 'ai-web-test-engine.plan-ref.';

export function TestEditorPage() {
    const { testId } = useParams();
    const navigate = useNavigate();
    const activeTestId = testId ?? 'new';
    const isNewTest = activeTestId === 'new';
    const [activeTab, setActiveTab] = useState<InspectorTab>('context');
    const [steps, setSteps] = useState<string[]>([]);
    const [definitionState, setDefinitionState] = useState<LoadState>('loading');
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [loadError, setLoadError] = useState('');
    const [mode, setMode] = useState<DebugRunMode>('ai-explore');
    const [loginModuleEnabled, setLoginModuleEnabled] = useState(true);
    const [planRef, setPlanRef] = useState('');
    const [planGeneration, setPlanGeneration] = useState<
        DebugPlanGenerationResult | undefined
    >();
    const [planGenerating, setPlanGenerating] = useState(false);
    const [result, setResult] = useState<DebugRunResult>();
    const [resultMode, setResultMode] = useState<DebugRunMode>();
    const [runError, setRunError] = useState('');
    const [runEvents, setRunEvents] = useState<DebugRunEvent[]>([]);
    const [runSessionId, setRunSessionId] = useState('');
    const [runState, setRunState] = useState<RunState>('idle');
    const [selectedScreenshotRef, setSelectedScreenshotRef] = useState('');
    const [saveError, setSaveError] = useState('');
    const [saveState, setSaveState] = useState<SaveState>('dirty');
    const [savedFileName, setSavedFileName] = useState('');
    const [testName, setTestName] = useState('');
    const [url, setUrl] = useState(DEFAULT_START_URL);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [optionsName, setOptionsName] = useState('');
    const [optionsUrl, setOptionsUrl] = useState(DEFAULT_START_URL);
    const [optionsMode, setOptionsMode] = useState<DebugRunMode>('ai-explore');
    const [optionsLoginModuleEnabled, setOptionsLoginModuleEnabled] =
        useState(true);
    const [optionsError, setOptionsError] = useState('');
    const abortControllerRef = useRef<AbortController | undefined>(undefined);
    const finalizedSessionRef = useRef('');
    const runSubscriptionCleanupRef = useRef<(() => void) | undefined>(
        undefined
    );
    const runStartedAtRef = useRef(0);
    const [stopRequested, setStopRequested] = useState(false);

    const fileName = isNewTest
        ? '未命名测试.test.yaml'
        : savedFileName || `${ activeTestId }.test.yaml`;
    const action = useMemo(() => serializeActionSteps(steps), [steps]);

    useEffect(() => {
        const controller = new AbortController();
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        runSubscriptionCleanupRef.current?.();
        runSubscriptionCleanupRef.current = undefined;
        finalizedSessionRef.current = '';
        setRunState('idle');
        setResult(undefined);
        setResultMode(undefined);
        setPlanGeneration(undefined);
        setPlanGenerating(false);
        setRunError('');
        setRunEvents([]);
        setRunSessionId('');
        setSelectedScreenshotRef('');
        setStopRequested(false);
        setElapsedSeconds(0);
        setMode('ai-explore');
        setLoginModuleEnabled(true);
        setPlanRef(readStoredPlanRef(activeTestId));
        setSaveError('');
        setLoadError('');
        setSavedFileName('');
        if (isNewTest) {
            setTestName('');
            setSteps([]);
            setUrl(DEFAULT_START_URL);
            setDefinitionState('ready');
            setSaveState('dirty');
            return () => controller.abort();
        }

        setDefinitionState('loading');
        void Promise.all([
            getTestDefinitionRecord(activeTestId, controller.signal),
            getLatestDebugRunSession(activeTestId, controller.signal)
                .catch(() => undefined)
        ]).then(([record, previousSession]) => {
                const definition = record.definition;
                const savedPlanRef = definition.execution?.planRef
                    ?? readStoredPlanRef(activeTestId);
                setSavedFileName(record.fileName);
                setTestName(definition.name);
                setSteps(parseActionSteps(definition.action));
                setUrl(definition.startUrl ?? DEFAULT_START_URL);
                setPlanRef(savedPlanRef);
                setLoginModuleEnabled(
                    definition.execution?.setupModules?.includes(
                        'jiandaoyun-login'
                    ) ?? false
                );
                setMode(
                    savedPlanRef
                    && definition.execution?.preferredMode
                        === 'structured-replay'
                        ? 'structured-replay'
                        : 'ai-explore'
                );
                setSaveState('saved');
                setDefinitionState('ready');
                if (previousSession && isTerminalSession(previousSession)) {
                    const previousResult = previousSession.result;
                    setRunSessionId(previousSession.sessionId);
                    setRunEvents(previousSession.events);
                    setSelectedScreenshotRef(
                        findLatestScreenshotRef(previousSession.events)
                    );
                    setResult(previousResult);
                    setResultMode(previousSession.mode ?? 'ai-explore');
                    setElapsedSeconds(previousResult
                        ? Math.round(previousResult.metrics.durationMs / 1_000)
                        : 0);
                    if (previousSession.status === 'CANCELLED') {
                        setRunState('cancelled');
                        setRunError(
                            previousSession.error
                            ?? previousResult?.summary
                            ?? '上一次运行已终止。'
                        );
                    } else if (!previousResult) {
                        setRunState('failed');
                        setRunError(
                            previousSession.error
                            ?? '上一次运行异常结束。'
                        );
                    } else {
                        setRunState(
                            previousResult.lifecycle !== 'COMPLETED'
                                ? 'failed'
                                : previousResult.result === 'PASS'
                                    ? 'passed'
                                    : previousResult.result === 'UNCERTAIN'
                                        ? 'uncertain'
                                        : 'failed'
                        );
                    }
                }
            }).catch((error) => {
                if (!controller.signal.aborted) {
                    setLoadError(
                        error instanceof Error
                            ? error.message
                            : '测试用例加载失败。'
                    );
                    setDefinitionState('error');
                }
            });
        return () => controller.abort();
    }, [activeTestId, isNewTest]);

    useEffect(() => {
        if (runState !== 'running') {
            return undefined;
        }
        const updateElapsed = () => setElapsedSeconds(Math.max(
            0,
            Math.floor((Date.now() - runStartedAtRef.current) / 1000)
        ));
        updateElapsed();
        const timer = window.setInterval(updateElapsed, 1_000);
        return () => window.clearInterval(timer);
    }, [runState]);

    useEffect(() => () => {
        abortControllerRef.current?.abort();
        runSubscriptionCleanupRef.current?.();
    }, []);

    const markDefinitionEdited = () => {
        setSaveState('dirty');
        setSaveError('');
        setMode('ai-explore');
        setPlanRef('');
        setPlanGeneration(undefined);
        setPlanGenerating(false);
        window.localStorage.removeItem(planStorageKey(activeTestId));
    };

    const saveTest = async () => {
        const draft = {
            action,
            name: testName.trim(),
            planRef: planRef.trim() || null,
            setupModules: loginModuleEnabled
                ? [ 'jiandaoyun-login' as const ]
                : [],
            startUrl: url.trim()
        };
        if (!draft.name || !draft.startUrl) {
            setSaveError('用例名称和起始地址均不能为空。');
            return;
        }
        setSaveState('saving');
        setSaveError('');
        try {
            const record = isNewTest
                ? await createTestDefinition(draft)
                : await updateTestDefinition(activeTestId, draft);
            setSavedFileName(record.fileName);
            setSaveState('saved');
            if (isNewTest) {
                navigate(`/tests/${ record.definition.id }`, {
                    replace: true
                });
            }
        } catch (error) {
            setSaveState('dirty');
            setSaveError(
                error instanceof Error ? error.message : '保存测试用例失败。'
            );
        }
    };

    const receiveRunEvents = (events: DebugRunEvent[]) => {
        setRunEvents((current) => mergeRunEvents(current, events));
        const screenshotRef = findLatestScreenshotRef(events);
        if (screenshotRef) {
            setSelectedScreenshotRef(screenshotRef);
        }
    };

    const persistCompiledPlan = (
        compiledPlanRef: string,
        normalizedAction: string
    ) => {
        setPlanRef(compiledPlanRef);
        window.localStorage.setItem(
            planStorageKey(activeTestId),
            compiledPlanRef
        );
        updateTestDefinition(activeTestId, {
            action: normalizedAction,
            name: testName.trim(),
            planRef: compiledPlanRef,
            setupModules: loginModuleEnabled
                ? [ 'jiandaoyun-login' as const ]
                : [],
            startUrl: url.trim()
        }).then((record) => {
            setTestName(record.definition.name);
            setSaveState('saved');
        }).catch((error) => {
            setSaveState('dirty');
            setSaveError(
                error instanceof Error
                    ? `计划已生成，但保存到用例失败：${ error.message }`
                    : '计划已生成，但保存到用例失败。'
            );
        });
    };

    const finalizeRunSession = (session: DebugRunSession) => {
        if (
            !isTerminalSession(session)
            || finalizedSessionRef.current === session.sessionId
        ) {
            return;
        }
        finalizedSessionRef.current = session.sessionId;
        runSubscriptionCleanupRef.current?.();
        runSubscriptionCleanupRef.current = undefined;
        setStopRequested(false);
        const nextResult = session.result;
        setResult(nextResult);
        if (nextResult) {
            setElapsedSeconds(Math.round(
                nextResult.metrics.durationMs / 1_000
            ));
        }
        if (session.status === 'CANCELLED') {
            setRunError(session.error ?? nextResult?.summary ?? '运行已终止。');
            setRunState('cancelled');
            return;
        }
        setRunState(
            nextResult?.lifecycle !== 'COMPLETED'
                ? 'failed'
                : nextResult.result === 'PASS'
                    ? 'passed'
                    : nextResult.result === 'UNCERTAIN'
                        ? 'uncertain'
                        : 'failed'
        );
        if (!nextResult) {
            setRunError(session.error ?? '运行异常结束，服务端未返回结果。');
            return;
        }
    };

    const receiveRunSession = (session: DebugRunSession) => {
        setRunSessionId(session.sessionId);
        receiveRunEvents(session.events);
        finalizeRunSession(session);
    };

    const runTest = async () => {
        const normalizedAction = action;
        const normalizedPlanRef = planRef.trim();
        if (!normalizedAction) {
            showInputError('请输入要执行的测试动作。');
            return;
        }
        if (isNewTest) {
            showInputError('请先保存新测试，再启动运行。');
            return;
        }
        if (!testName.trim() || !url.trim()) {
            showInputError('用例名称和起始地址不能为空。');
            return;
        }
        if (definitionState !== 'ready') {
            showInputError('测试用例尚未加载完成。');
            return;
        }
        if (mode === 'structured-replay' && !normalizedPlanRef) {
            showInputError('结构化回放需要填写 compiledPlanRef。');
            return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        runSubscriptionCleanupRef.current?.();
        runSubscriptionCleanupRef.current = undefined;
        finalizedSessionRef.current = '';
        runStartedAtRef.current = Date.now();
        setElapsedSeconds(0);
        setResult(undefined);
        setResultMode(mode);
        setPlanGeneration(undefined);
        setPlanGenerating(false);
        setRunError('');
        setRunEvents([]);
        setRunSessionId('');
        setSelectedScreenshotRef('');
        setStopRequested(false);
        setActiveTab('timeline');
        setRunState('running');
        try {
            const session = await startDebugRun({
                action: normalizedAction,
                mode,
                startUrl: url.trim(),
                testId: activeTestId,
                testName: testName.trim(),
                setupModules: loginModuleEnabled
                    ? [ 'jiandaoyun-login' ]
                    : [],
                ...mode === 'structured-replay'
                    ? { planRef: normalizedPlanRef }
                    : {}
            }, controller.signal);
            if (controller.signal.aborted) {
                return;
            }
            receiveRunSession(session);
            if (isTerminalSession(session)) {
                return;
            }
            runSubscriptionCleanupRef.current = subscribeDebugRunSession(
                session.sessionId,
                {
                    onError: (error) => {
                        setRunError(error.message);
                        setRunState('failed');
                        setActiveTab('console');
                    },
                    onUpdate: (update: DebugRunSessionUpdate) => {
                        if (update.kind === 'run-event') {
                            receiveRunEvents([update.event]);
                            return;
                        }
                        receiveRunSession(update.session);
                    }
                }
            );
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            setRunError(
                error instanceof Error ? error.message : '运行请求失败。'
            );
            setRunState('failed');
            setActiveTab('console');
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = undefined;
            }
        }
    };

    const stopRun = async () => {
        if (runState !== 'running' || stopRequested) {
            return;
        }
        setStopRequested(true);
        if (!runSessionId) {
            abortControllerRef.current?.abort();
            setRunError('运行已在建立会话前终止。');
            setRunState('cancelled');
            setStopRequested(false);
            return;
        }
        try {
            const session = await cancelDebugRunSession(runSessionId);
            receiveRunSession(session);
        } catch (error) {
            setRunError(
                error instanceof Error ? error.message : '终止运行失败。'
            );
            setStopRequested(false);
        }
    };

    const generatePlan = async () => {
        if (
            !result
            || result.lifecycle !== 'COMPLETED'
            || result.result !== 'PASS'
            || resultMode !== 'ai-explore'
            || planGenerating
        ) {
            return;
        }
        setPlanGenerating(true);
        setPlanGeneration(undefined);
        try {
            const nextPlanGeneration = await generateDebugRunPlan(result.runId);
            setPlanGeneration(nextPlanGeneration);
            if (
                nextPlanGeneration.status === 'SUCCEEDED'
                && nextPlanGeneration.compiledPlanRef
            ) {
                persistCompiledPlan(
                    nextPlanGeneration.compiledPlanRef,
                    action
                );
            }
        } catch (error) {
            setPlanGeneration({
                schemaVersion: 1,
                runId: result.runId,
                status: 'FAILED',
                summary: error instanceof Error
                    ? error.message
                    : '计划生成请求失败。'
            });
        } finally {
            setPlanGenerating(false);
        }
    };

    const showInputError = (message: string) => {
        setRunError(message);
        setResult(undefined);
        setResultMode(undefined);
        setPlanGeneration(undefined);
        setPlanGenerating(false);
        setRunState('failed');
        setActiveTab('console');
    };

    const resetTest = () => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        runSubscriptionCleanupRef.current?.();
        runSubscriptionCleanupRef.current = undefined;
        finalizedSessionRef.current = '';
        setRunState('idle');
        setResult(undefined);
        setResultMode(undefined);
        setPlanGeneration(undefined);
        setPlanGenerating(false);
        setRunError('');
        setRunEvents([]);
        setRunSessionId('');
        setSelectedScreenshotRef('');
        setStopRequested(false);
        setElapsedSeconds(0);
    };

    const prepareReplay = () => {
        setMode('structured-replay');
        setRunState('idle');
        setRunError('');
    };

    const addStep = () => {
        setSteps((currentSteps) => [ ...currentSteps, '' ]);
        markDefinitionEdited();
    };

    const updateStep = (index: number, value: string) => {
        setSteps((currentSteps) => currentSteps.map(
            (step, stepIndex) => stepIndex === index ? value : step
        ));
        markDefinitionEdited();
    };

    const removeStep = (index: number) => {
        setSteps((currentSteps) => currentSteps.filter(
            (_step, stepIndex) => stepIndex !== index
        ));
        markDefinitionEdited();
    };

    const openOptions = () => {
        setOptionsName(testName);
        setOptionsUrl(url);
        setOptionsMode(mode);
        setOptionsLoginModuleEnabled(loginModuleEnabled);
        setOptionsError('');
        setOptionsOpen(true);
    };

    const applyOptions = () => {
        const normalizedName = optionsName.trim();
        const normalizedUrl = optionsUrl.trim();
        if (!normalizedName || !normalizedUrl) {
            setOptionsError('用例名称和起始地址均不能为空。');
            return;
        }
        const definitionChanged = normalizedName !== testName.trim()
            || normalizedUrl !== url.trim()
            || optionsLoginModuleEnabled !== loginModuleEnabled;
        setTestName(normalizedName);
        setUrl(normalizedUrl);
        setLoginModuleEnabled(optionsLoginModuleEnabled);
        if (definitionChanged) {
            markDefinitionEdited();
        } else {
            setMode(optionsMode);
        }
        setOptionsOpen(false);
    };

    const editorDisabled = runState === 'running'
        || definitionState === 'loading';
    const saveLabel = saveState === 'saving'
        ? '保存中'
        : saveState === 'saved'
            ? '已保存'
            : '未保存';

    return (
        <main className="test-workbench">
            <header className="test-titlebar">
                <nav aria-label="面包屑导航" className="test-breadcrumbs">
                    <Link to="/repository">项目文件</Link>
                    <Icon name="chevron-right" size={16} />
                    <strong title={fileName}>{fileName}</strong>
                    <span className="save-state">{saveLabel}</span>
                </nav>

                <div className="test-title-actions">
                    <label className="environment-select">
                        <span>默认环境：</span>
                        <select aria-label="默认环境" defaultValue="jiandaoyun-test">
                            <option value="jiandaoyun-test">简道云环境</option>
                            <option value="local">本地环境</option>
                        </select>
                        <Icon name="chevron-down" size={15} />
                    </label>
                    <button
                        className="options-button"
                        onClick={openOptions}
                        type="button"
                    >
                        <Icon name="sliders" size={17} />
                        选项
                    </button>
                </div>
            </header>

            <section className="test-toolbar" aria-label="测试工具栏">
                <div className="editing-tools">
                    <button
                        aria-label="保存"
                        disabled={editorDisabled || saveState === 'saving'}
                        onClick={() => void saveTest()}
                        title="保存为真实 YAML 用例"
                        type="button"
                    >
                        <Icon name="save" size={18} />
                    </button>
                    <button aria-label="撤销" title="撤销" type="button">
                        <Icon name="undo" size={18} />
                    </button>
                    <button aria-label="重做" title="重做" type="button">
                        <Icon className="redo-icon" name="undo" size={18} />
                    </button>
                    <i />
                    <button aria-label="流程视图" title="流程视图" type="button">
                        <Icon name="workflow" size={18} />
                    </button>
                    <button aria-label="录制操作" title="录制操作" type="button">
                        <Icon name="video" size={18} />
                    </button>
                    <button aria-label="工具" title="工具" type="button">
                        <Icon name="hammer" size={18} />
                    </button>
                </div>

                <div className="run-controls">
                    <button
                        className={`run-button ${runState}`}
                        disabled={editorDisabled || definitionState !== 'ready'}
                        onClick={() => void runTest()}
                        type="button"
                    >
                        {runState === 'passed' ? (
                            <Icon name="check" size={18} />
                        ) : (
                            <Icon name="play" size={18} />
                        )}
                        {runState === 'running' && '运行中'}
                        {runState === 'passed' && '已通过'}
                        {runState === 'uncertain' && '待确认'}
                        {runState === 'failed' && '重新运行'}
                        {runState === 'cancelled' && '重新运行'}
                        {runState === 'idle' && '运行'}
                    </button>
                    {runState === 'running' && (
                        <button
                            className="stop-run-button"
                            disabled={stopRequested}
                            onClick={() => void stopRun()}
                            type="button"
                        >
                            <span aria-hidden="true" />
                            {stopRequested ? '终止中' : '终止'}
                        </button>
                    )}
                </div>
            </section>

            <div className="workbench-body">
                <aside className="steps-panel">
                    <div className="steps-list">
                        {steps.map((step, index) => (
                            <article className="ai-step-card" key={index}>
                                <span className="step-index">{index}</span>
                                <div className="step-type-icon">
                                    <Icon name="sparkles" size={18} />
                                </div>
                                <div className="step-content">
                                    <p>AI 操作</p>
                                    <textarea
                                        aria-label={`操作步骤 ${ index + 1 }`}
                                        disabled={editorDisabled}
                                        onChange={(event) => updateStep(
                                            index,
                                            event.target.value
                                        )}
                                        placeholder="用自然语言描述这个操作和需要验证的结果。"
                                        rows={3}
                                        value={step}
                                    />
                                </div>
                                <button
                                    aria-label={`删除操作步骤 ${index + 1}`}
                                    className="step-more-button"
                                    disabled={editorDisabled}
                                    onClick={() => removeStep(index)}
                                    type="button"
                                >
                                    <Icon name="trash" size={16} />
                                </button>
                            </article>
                        ))}
                    </div>

                    {steps.length === 0 && (
                        <div className="steps-empty-state">
                            <Icon name="sparkles" size={20} />
                            <strong>还没有操作步骤</strong>
                            <span>从一条自然语言操作开始创建测试。</span>
                        </div>
                    )}

                    {(saveError || loadError) && (
                        <p className="steps-panel-error" role="alert">
                            {saveError || loadError}
                        </p>
                    )}

                    <button
                        className="add-step-button"
                        disabled={editorDisabled}
                        onClick={addStep}
                        type="button"
                    >
                        <Icon name="plus" size={17} />
                        添加步骤
                    </button>
                </aside>

                <section className="browser-workspace">
                    <div className="browser-toolbar">
                        <button aria-label="刷新页面" type="button">
                            <Icon name="refresh" size={17} />
                        </button>
                        <label className="browser-address">
                            <Icon name="monitor" size={16} />
                            <input
                                aria-label="浏览器地址"
                                readOnly
                                spellCheck="false"
                                value={url}
                            />
                        </label>
                        <button className="browser-tab-button" type="button">
                            <span className="tab-status-dot" />
                            标签页：{testName || '未命名测试'}
                            <Icon name="chevron-down" size={15} />
                        </button>
                        <button
                            className="reset-button"
                            disabled={runState === 'running'}
                            onClick={resetTest}
                            type="button"
                        >
                            <Icon name="rotate-left" size={17} />
                            重置
                        </button>
                    </div>

                    <div className="browser-viewport">
                        {selectedScreenshotRef ? (
                            <figure className="live-run-screenshot">
                                <img
                                    alt="当前运行截图"
                                    src={getDebugScreenshotUrl(
                                        selectedScreenshotRef
                                    )}
                                />
                                <figcaption>
                                    真实运行截图
                                    <code>{selectedScreenshotRef}</code>
                                </figcaption>
                            </figure>
                        ) : (
                            <div className="mock-login-page">
                            <div className="mock-brand">
                                <span className="brand-symbol">F</span>
                                <strong>帆软</strong>
                                <i />
                                <span className="jdy-symbol">◇</span>
                                <strong>简道云</strong>
                            </div>

                            <div className="login-illustration" aria-hidden="true">
                                <div className="illustration-glow" />
                                <div className="illustration-window">
                                    <div className="window-top"><i /><i /><i /></div>
                                    <div className="window-content">
                                        <div className="window-menu"><i /><i /><i /><i /></div>
                                        <div className="window-chart">
                                            <span /><span /><span /><span />
                                        </div>
                                        <div className="window-card"><i /><i /><i /></div>
                                    </div>
                                </div>
                                <div className="illustration-float-card">
                                    <i /><i /><i />
                                </div>
                            </div>

                            <form
                                className="mock-login-card"
                                onSubmit={(event) => event.preventDefault()}
                            >
                                <h2>登录</h2>
                                <p>还没有账号？<a href="#signup">立即注册</a></p>
                                <input
                                    aria-label="手机号或邮箱"
                                    placeholder="手机号 / 邮箱"
                                    type="text"
                                />
                                <input
                                    aria-label="密码"
                                    placeholder="密码"
                                    type="password"
                                />
                                <div className="login-assistance">
                                    <label><input type="checkbox" /> 记住我</label>
                                    <a href="#forgot">忘记密码？</a>
                                </div>
                                <button type="submit">登录</button>
                                <span className="verification-login">使用验证码登录</span>
                                <div className="login-divider"><i />或<i /></div>
                                <div className="login-providers">
                                    <span>F</span><span>微</span><span>钉</span><span>企</span>
                                </div>
                            </form>
                            </div>
                        )}
                        {runState === 'running' && (
                            <div className={`running-overlay ${
                                selectedScreenshotRef ? 'compact' : ''
                            }`}>
                                <span className="running-spinner" />
                                <strong>
                                    {mode === 'ai-explore'
                                        ? 'AI 正在探索并执行测试'
                                        : '正在执行结构化回放'}
                                </strong>
                                <p>
                                    {stopRequested
                                        ? '正在等待浏览器安全退出…'
                                        : `已等待 ${ elapsedSeconds } 秒`}
                                </p>
                            </div>
                        )}
                        {runState === 'passed' && (
                            <div className="run-result-toast">
                                <Icon name="check" size={18} />
                                <div>
                                    <strong>测试通过</strong>
                                    <span>
                                        {result?.metrics.actionCount ?? 0} 个动作 · {elapsedSeconds} 秒
                                    </span>
                                </div>
                            </div>
                        )}
                        {runState === 'failed' && (
                            <div className="run-result-toast failed">
                                <Icon name="code" size={18} />
                                <div>
                                    <strong>运行未通过</strong>
                                    <span>请在控制台查看详情</span>
                                </div>
                            </div>
                        )}
                        {runState === 'uncertain' && (
                            <div className="run-result-toast uncertain">
                                <Icon name="lightbulb" size={18} />
                                <div>
                                    <strong>需要确认</strong>
                                    <span>证据不足，请在控制台复核</span>
                                </div>
                            </div>
                        )}
                        {runState === 'cancelled' && (
                            <div className="run-result-toast cancelled">
                                <Icon name="code" size={18} />
                                <div>
                                    <strong>运行已终止</strong>
                                    <span>已保留终止前的事件与截图</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <section className="inspector-panel">
                        <div className="inspector-tabs" role="tablist">
                            {inspectorTabs.map((tab) => (
                                <button
                                    aria-selected={activeTab === tab.id}
                                    className={activeTab === tab.id ? 'active' : ''}
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    role="tab"
                                    type="button"
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="inspector-content">
                            {activeTab === 'timeline' && (
                                <RunTimeline
                                    events={runEvents}
                                    onSelectScreenshot={
                                        setSelectedScreenshotRef
                                    }
                                    runSessionId={runSessionId}
                                    runState={runState}
                                    selectedScreenshotRef={
                                        selectedScreenshotRef
                                    }
                                />
                            )}
                            {activeTab === 'context' && (
                                <>
                                    <p>
                                        测试步骤可以直接使用这些运行时变量，
                                        也可以通过 <code>{'{{ }}'}</code> 语法引用。
                                    </p>
                                    <label className="context-search">
                                        <Icon name="search" size={16} />
                                        <input placeholder="搜索键或值…" type="search" />
                                    </label>
                                    <div className="environment-values">
                                        <p><Icon name="chevron-down" size={15} /> env: <span>6 个变量</span></p>
                                        <dl>
                                            <div><dt>CURRENT_URL</dt><dd>"{url}"</dd></div>
                                            <div><dt>BASE_URL</dt><dd>"{url}"</dd></div>
                                        </dl>
                                    </div>
                                </>
                            )}
                            {activeTab === 'console' && (
                                <RunConsole
                                    canGeneratePlan={
                                        resultMode === 'ai-explore'
                                        && result?.lifecycle === 'COMPLETED'
                                        && result?.result === 'PASS'
                                    }
                                    compiledPlanRef={
                                        planGeneration?.compiledPlanRef
                                        ?? result?.compiledPlanRef
                                        ?? (planRef || undefined)
                                    }
                                    elapsedSeconds={elapsedSeconds}
                                    error={runError}
                                    onGeneratePlan={generatePlan}
                                    onPrepareReplay={prepareReplay}
                                    planGenerating={planGenerating}
                                    planGeneration={planGeneration}
                                    result={result}
                                    runState={runState}
                                />
                            )}
                            {activeTab === 'network' && (
                                <div className="inspector-empty">
                                    <Icon name="workflow" size={20} />
                                    <span>尚未捕获网络请求。</span>
                                </div>
                            )}
                            {activeTab === 'html' && (
                                <div className="html-preview">
                                    <Icon name="braces" size={18} />
                                    <code>&lt;main id=&quot;login-page&quot;&gt;…&lt;/main&gt;</code>
                                </div>
                            )}
                        </div>
                    </section>
                </section>
            </div>

            {optionsOpen && (
                <div className="dialog-backdrop" role="presentation">
                    <form
                        aria-labelledby="test-options-title"
                        aria-modal="true"
                        className="test-settings-dialog"
                        onSubmit={(event) => {
                            event.preventDefault();
                            applyOptions();
                        }}
                        role="dialog"
                    >
                        <header>
                            <div>
                                <h2 id="test-options-title">测试选项</h2>
                                <p>基础信息不会占用步骤编辑区域。</p>
                            </div>
                            <button
                                aria-label="关闭测试选项"
                                onClick={() => setOptionsOpen(false)}
                                type="button"
                            >
                                <Icon name="x" size={18} />
                            </button>
                        </header>
                        <div className="dialog-fields">
                            <label>
                                <span>用例名称</span>
                                <input
                                    aria-label="用例名称"
                                    onChange={(event) => {
                                        setOptionsName(event.target.value);
                                        setOptionsError('');
                                    }}
                                    value={optionsName}
                                />
                            </label>
                            <label>
                                <span>起始地址</span>
                                <input
                                    aria-label="起始地址"
                                    onChange={(event) => {
                                        setOptionsUrl(event.target.value);
                                        setOptionsError('');
                                    }}
                                    spellCheck="false"
                                    value={optionsUrl}
                                />
                            </label>
                            <label>
                                <span>本次运行方式</span>
                                <select
                                    aria-label="运行模式"
                                    onChange={(event) => setOptionsMode(
                                        event.target.value as DebugRunMode
                                    )}
                                    value={optionsMode}
                                >
                                    <option value="ai-explore">AI 探索</option>
                                    <option
                                        disabled={!planRef}
                                        value="structured-replay"
                                    >
                                        结构化回放
                                    </option>
                                </select>
                            </label>
                            <label className="setup-module-option">
                                <input
                                    aria-label="使用简道云登录模块"
                                    checked={optionsLoginModuleEnabled}
                                    onChange={(event) => {
                                        setOptionsLoginModuleEnabled(
                                            event.target.checked
                                        );
                                        setOptionsError('');
                                    }}
                                    type="checkbox"
                                />
                                <span>
                                    <strong>使用简道云登录模块</strong>
                                    <small>
                                        优先恢复本机登录态，失效后自动结构化重登。
                                    </small>
                                </span>
                            </label>
                            <p className="dialog-field-hint">
                                {planRef
                                    ? '此测试已有可用的结构化计划。'
                                    : '探索通过并生成计划后，才可选择结构化回放。'}
                            </p>
                            {optionsError && (
                                <p className="dialog-error" role="alert">
                                    {optionsError}
                                </p>
                            )}
                        </div>
                        <footer>
                            <button
                                className="dialog-secondary-button"
                                onClick={() => setOptionsOpen(false)}
                                type="button"
                            >
                                取消
                            </button>
                            <button
                                className="dialog-primary-button"
                                type="submit"
                            >
                                应用
                            </button>
                        </footer>
                    </form>
                </div>
            )}
        </main>
    );
}

function parseActionSteps(action: string): string[] {
    return action
        .split(/[；;\n]+/u)
        .map((step) => step.trim())
        .filter(Boolean);
}

function serializeActionSteps(steps: string[]): string {
    return steps
        .map((step) => step.trim())
        .filter(Boolean)
        .join('；\n');
}

interface RunTimelineProps {
    events: DebugRunEvent[];
    onSelectScreenshot: (ref: string) => void;
    runSessionId: string;
    runState: RunState;
    selectedScreenshotRef: string;
}

/** 按核心事件序号实时展示执行进度，并允许回看任意一张页面截图。 */
function RunTimeline({
    events,
    onSelectScreenshot,
    runSessionId,
    runState,
    selectedScreenshotRef,
}: RunTimelineProps) {
    if (events.length === 0) {
        return (
            <div className="inspector-empty">
                {runState === 'running' && (
                    <span className="running-spinner dark" />
                )}
                <span>
                    {runState === 'running'
                        ? '会话已建立，正在等待第一条运行事件…'
                        : '运行测试后，实时事件会显示在这里。'}
                </span>
            </div>
        );
    }
    const verdictObservationRef = getVerdictObservationRef(events);
    return (
        <div className="run-timeline">
            <header>
                <strong>实时运行时间线</strong>
                <span>
                    {events.length} 条事件
                    {runSessionId ? ` · 会话 ${ runSessionId }` : ''}
                </span>
            </header>
            {verdictObservationRef && (
                <div className="timeline-verdict-source">
                    <Icon name="check" size={14} />
                    <span>最终判定依据</span>
                    <code>{verdictObservationRef}</code>
                </div>
            )}
            <ol>
                {events.map((event) => {
                    const screenshotRef = getScreenshotRef(event);
                    const observationRef = getObservationRef(event);
                    const isVerdictSource = event.type === 'observation.created'
                        && observationRef === verdictObservationRef;
                    return (
                        <li
                            className={[
                                screenshotRef === selectedScreenshotRef
                                    ? 'selected'
                                    : '',
                                isVerdictSource ? 'verdict-source' : ''
                            ].filter(Boolean).join(' ')}
                            key={event.eventId}
                        >
                            <span className={`timeline-dot ${
                                getEventTone(event.type)
                            }`} />
                            <div>
                                <p>
                                    <strong>{getEventLabel(event.type)}</strong>
                                    <time>{formatEventTime(event.timestamp)}</time>
                                </p>
                                <span>{getEventSummary(event)}</span>
                                {isVerdictSource && (
                                    <em>最终判定使用此页面观察</em>
                                )}
                            </div>
                            {screenshotRef && (
                                <button
                                    onClick={() => onSelectScreenshot(
                                        screenshotRef
                                    )}
                                    type="button"
                                >
                                    {screenshotRef === selectedScreenshotRef
                                        ? '正在查看'
                                        : '查看截图'}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

interface RunConsoleProps {
    canGeneratePlan: boolean;
    compiledPlanRef?: string;
    elapsedSeconds: number;
    error: string;
    onGeneratePlan: () => void;
    onPrepareReplay: () => void;
    planGenerating: boolean;
    planGeneration?: DebugPlanGenerationResult;
    result?: DebugRunResult;
    runState: RunState;
}

/** 在现有检查器区域展示轻量运行摘要、产物引用和原始响应。 */
function RunConsole({
    canGeneratePlan,
    compiledPlanRef,
    elapsedSeconds,
    error,
    onGeneratePlan,
    onPrepareReplay,
    planGenerating,
    planGeneration,
    result,
    runState,
}: RunConsoleProps) {
    if (runState === 'running') {
        return (
            <div className="run-console-status">
                <span className="running-spinner dark" />
                <div>
                    <strong>执行引擎正在运行</strong>
                    <p>请求已持续 {elapsedSeconds} 秒，结果完成后会自动显示。</p>
                </div>
            </div>
        );
    }
    if (error) {
        return (
            <div className="run-console-error" role="alert">
                <strong>
                    {runState === 'cancelled' ? '运行已终止' : '请求失败'}
                </strong>
                <p>{error}</p>
            </div>
        );
    }
    if (!result) {
        return (
            <div className="inspector-empty">
                <Icon name="code" size={20} />
                <span>运行测试后，结果和指标会显示在这里。</span>
            </div>
        );
    }

    return (
        <div className="run-console-result">
            <div className="run-summary-row">
                <span className={`result-badge ${result.result?.toLowerCase()}`}>
                    {result.result ?? result.lifecycle}
                </span>
                <div>
                    <strong>{result.summary}</strong>
                    <span>Run ID：{result.runId}</span>
                </div>
                <div className="run-summary-actions">
                    {canGeneratePlan && !compiledPlanRef && (
                        <button
                            disabled={planGenerating}
                            onClick={onGeneratePlan}
                            type="button"
                        >
                            {planGenerating
                                ? '正在生成计划…'
                                : planGeneration?.status === 'FAILED'
                                    ? '重新生成计划'
                                    : '生成结构化计划'}
                        </button>
                    )}
                    {compiledPlanRef && (
                        <button onClick={onPrepareReplay} type="button">
                            使用此计划回放
                        </button>
                    )}
                </div>
            </div>

            <dl className="run-metrics">
                <div><dt>动作</dt><dd>{result.metrics.actionCount}</dd></div>
                <div><dt>模型调用</dt><dd>{result.metrics.modelCallCount}</dd></div>
                <div><dt>耗时</dt><dd>{formatDuration(result.metrics.durationMs)}</dd></div>
                <div><dt>重复状态</dt><dd>{result.metrics.repeatedStateActionCount}</dd></div>
            </dl>

            {planGeneration && (
                <div className={`plan-generation-result ${
                    planGeneration.status.toLowerCase()
                }`}>
                    <strong>
                        {planGeneration.status === 'SUCCEEDED'
                            ? '计划生成成功'
                            : '计划生成失败'}
                    </strong>
                    <p>{planGeneration.summary}</p>
                </div>
            )}
            {compiledPlanRef && (
                <div className="run-reference">
                    <span>compiledPlanRef</span>
                    <code>{compiledPlanRef}</code>
                </div>
            )}
            {result.failure && (
                <div className="run-failure-detail">
                    <strong>{result.failure.category}</strong>
                    <span>{result.failure.phase}</span>
                    <p>{result.failure.summary}</p>
                </div>
            )}

            <details className="run-evidence">
                <summary>运行产物（{result.evidence.length}）</summary>
                <ul>
                    {result.evidence.map((evidence) => (
                        <li key={evidence.ref}>
                            <span>{evidence.kind}</span>
                            <code>{evidence.ref}</code>
                        </li>
                    ))}
                </ul>
            </details>
            <details className="raw-response">
                <summary>原始响应</summary>
                <pre>{JSON.stringify({ result, planGeneration }, null, 2)}</pre>
            </details>
        </div>
    );
}

function formatDuration(durationMs: number): string {
    return durationMs < 1_000
        ? `${ durationMs } ms`
        : `${ (durationMs / 1_000).toFixed(1) } 秒`;
}

function mergeRunEvents(
    current: DebugRunEvent[],
    incoming: DebugRunEvent[]
): DebugRunEvent[] {
    const events = new Map(current.map((event) => [event.eventId, event]));
    for (const event of incoming) {
        events.set(event.eventId, event);
    }
    return [...events.values()].sort((left, right) => (
        left.sequence - right.sequence
    ));
}

function findLatestScreenshotRef(events: DebugRunEvent[]): string {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const screenshotRef = getScreenshotRef(events[index]);
        if (screenshotRef) {
            return screenshotRef;
        }
    }
    return '';
}

function getScreenshotRef(event: DebugRunEvent): string {
    return typeof event.payload.screenshotRef === 'string'
        ? event.payload.screenshotRef
        : '';
}

function getObservationRef(event: DebugRunEvent): string {
    return typeof event.payload.observationRef === 'string'
        ? event.payload.observationRef
        : '';
}

function getVerdictObservationRef(events: DebugRunEvent[]): string {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === 'verdict.completed') {
            return getObservationRef(event);
        }
    }
    return '';
}

const eventLabels: Record<string, string> = {
    'action.completed': '动作完成',
    'action.failed': '动作失败',
    'action.planned': '动作已规划',
    'action.started': '开始执行动作',
    'browser.frame.updated': '浏览器画面更新',
    'browser.started': '浏览器已启动',
    'effect.verified': '页面效果已验证',
    'observation.created': '页面状态已采集',
    'plan.compilation.completed': '回放计划已生成',
    'plan.compilation.started': '正在生成回放计划',
    'replay.validation.completed': '回放验证完成',
    'run.cancelled': '运行已终止',
    'run.completed': '运行已完成',
    'run.crashed': '运行异常',
    'run.created': '运行已创建',
    'run.status.changed': '阶段变化',
    'target.resolved': '页面目标已定位',
    'trace.appended': '执行轨迹已保存',
    'verdict.completed': '测试结论已生成'
};

function getEventLabel(type: string): string {
    return eventLabels[type] ?? type;
}

function getEventSummary(event: DebugRunEvent): string {
    const fields = [
        'summary',
        'reasonSummary',
        'lifecycle',
        'actionType',
        'status',
        'url'
    ];
    for (const field of fields) {
        const value = event.payload[field];
        if (typeof value === 'string' && value) {
            return value;
        }
    }
    return `事件序号 ${ event.sequence }`;
}

function getEventTone(type: string): string {
    if (type.includes('failed') || type.includes('crashed')) {
        return 'danger';
    }
    if (
        type.includes('completed')
        || type === 'effect.verified'
    ) {
        return 'success';
    }
    return 'active';
}

function formatEventTime(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? timestamp
        : date.toLocaleTimeString('zh-CN', { hour12: false });
}

function isTerminalSession(session: DebugRunSession): boolean {
    return session.status === 'CANCELLED'
        || session.status === 'COMPLETED'
        || session.status === 'CRASHED';
}

function planStorageKey(testId: string): string {
    return `${ PLAN_REFERENCE_STORAGE_PREFIX }${ testId }`;
}

function readStoredPlanRef(testId: string): string {
    return window.localStorage.getItem(planStorageKey(testId)) ?? '';
}
