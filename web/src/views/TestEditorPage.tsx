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
    DebugRunEvent,
    DebugRunMode,
    DebugRunResult,
    DebugRunSession,
    DebugRunSessionUpdate,
} from '../api/run-debug';
import {
    cancelDebugRunSession,
    getDebugScreenshotUrl,
    startDebugRun,
    subscribeDebugRunSession,
} from '../api/run-debug';
import {
    createTestDefinition,
    getTestDefinition,
    updateTestDefinition,
} from '../api/test-definitions';
import { Icon } from '../components/Icon';

type InspectorTab = 'timeline' | 'context' | 'console' | 'network' | 'html';
type LoadState = 'error' | 'loading' | 'ready';
type RunState = 'cancelled' | 'failed' | 'idle' | 'passed' | 'running';
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
    const [action, setAction] = useState('');
    const [definitionState, setDefinitionState] = useState<LoadState>('loading');
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [loadError, setLoadError] = useState('');
    const [mode, setMode] = useState<DebugRunMode>('ai-explore');
    const [planRef, setPlanRef] = useState('');
    const [result, setResult] = useState<DebugRunResult>();
    const [runError, setRunError] = useState('');
    const [runEvents, setRunEvents] = useState<DebugRunEvent[]>([]);
    const [runSessionId, setRunSessionId] = useState('');
    const [runState, setRunState] = useState<RunState>('idle');
    const [selectedScreenshotRef, setSelectedScreenshotRef] = useState('');
    const [saveError, setSaveError] = useState('');
    const [saveState, setSaveState] = useState<SaveState>('dirty');
    const [testName, setTestName] = useState('');
    const [url, setUrl] = useState(DEFAULT_START_URL);
    const abortControllerRef = useRef<AbortController | undefined>(undefined);
    const finalizedSessionRef = useRef('');
    const runSubscriptionCleanupRef = useRef<(() => void) | undefined>(
        undefined
    );
    const runStartedAtRef = useRef(0);
    const [stopRequested, setStopRequested] = useState(false);

    const fileName = isNewTest
        ? '未命名测试.test.yaml'
        : `${ activeTestId }.test.yaml`;
    const steps = useMemo(() => action
        .split(/[；;\n]+/u)
        .map((step) => step.trim())
        .filter(Boolean), [action]);

    useEffect(() => {
        const controller = new AbortController();
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        runSubscriptionCleanupRef.current?.();
        runSubscriptionCleanupRef.current = undefined;
        finalizedSessionRef.current = '';
        setRunState('idle');
        setResult(undefined);
        setRunError('');
        setRunEvents([]);
        setRunSessionId('');
        setSelectedScreenshotRef('');
        setStopRequested(false);
        setElapsedSeconds(0);
        setMode('ai-explore');
        setPlanRef(readStoredPlanRef(activeTestId));
        setSaveError('');
        setLoadError('');
        if (isNewTest) {
            setTestName('');
            setAction('');
            setUrl(DEFAULT_START_URL);
            setDefinitionState('ready');
            setSaveState('dirty');
            return () => controller.abort();
        }

        setDefinitionState('loading');
        void getTestDefinition(activeTestId, controller.signal)
            .then((definition) => {
                const savedPlanRef = definition.execution?.planRef
                    ?? readStoredPlanRef(activeTestId);
                setTestName(definition.name);
                setAction(definition.action);
                setUrl(definition.startUrl ?? DEFAULT_START_URL);
                setPlanRef(savedPlanRef);
                setMode(
                    savedPlanRef
                    && definition.execution?.preferredMode
                        === 'structured-replay'
                        ? 'structured-replay'
                        : 'ai-explore'
                );
                setSaveState('saved');
                setDefinitionState('ready');
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
        window.localStorage.removeItem(planStorageKey(activeTestId));
    };

    const saveTest = async () => {
        const draft = {
            action: action.trim(),
            name: testName.trim(),
            planRef: planRef.trim() || null,
            startUrl: url.trim()
        };
        if (!draft.name || !draft.action || !draft.startUrl) {
            setSaveError('用例名称、起始地址和测试动作均不能为空。');
            return;
        }
        setSaveState('saving');
        setSaveError('');
        try {
            const record = isNewTest
                ? await createTestDefinition(draft)
                : await updateTestDefinition(activeTestId, draft);
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
        nextResult: DebugRunResult,
        normalizedAction: string
    ) => {
        if (!nextResult.compiledPlanRef) {
            return;
        }
        setPlanRef(nextResult.compiledPlanRef);
        window.localStorage.setItem(
            planStorageKey(activeTestId),
            nextResult.compiledPlanRef
        );
        updateTestDefinition(activeTestId, {
            action: normalizedAction,
            name: testName.trim(),
            planRef: nextResult.compiledPlanRef,
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

    const finalizeRunSession = (
        session: DebugRunSession,
        normalizedAction: string
    ) => {
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
            nextResult?.lifecycle === 'COMPLETED'
            && nextResult.result === 'PASS'
                ? 'passed'
                : 'failed'
        );
        if (!nextResult) {
            setRunError(session.error ?? '运行异常结束，服务端未返回结果。');
            return;
        }
        persistCompiledPlan(nextResult, normalizedAction);
    };

    const receiveRunSession = (
        session: DebugRunSession,
        normalizedAction: string
    ) => {
        setRunSessionId(session.sessionId);
        receiveRunEvents(session.events);
        finalizeRunSession(session, normalizedAction);
    };

    const runTest = async () => {
        const normalizedAction = action.trim();
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
                ...mode === 'structured-replay'
                    ? { planRef: normalizedPlanRef }
                    : {}
            }, controller.signal);
            if (controller.signal.aborted) {
                return;
            }
            receiveRunSession(session, normalizedAction);
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
                        receiveRunSession(update.session, normalizedAction);
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
            receiveRunSession(session, action.trim());
        } catch (error) {
            setRunError(
                error instanceof Error ? error.message : '终止运行失败。'
            );
            setStopRequested(false);
        }
    };

    const showInputError = (message: string) => {
        setRunError(message);
        setResult(undefined);
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
        setAction((currentAction) => [
            currentAction.trim(),
            '点击此处描述下一个测试步骤。'
        ].filter(Boolean).join('\n'));
        markDefinitionEdited();
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
                            <option value="jiandaoyun-test">简道云测试环境</option>
                            <option value="local">本地环境</option>
                        </select>
                        <Icon name="chevron-down" size={15} />
                    </label>
                    <button className="options-button" type="button">
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
                    <section className="debug-run-card" aria-label="运行调试">
                        <div className="debug-run-heading">
                            <div>
                                <strong>运行调试</strong>
                                <span>连接本地执行引擎</span>
                            </div>
                            <i className={runState === 'running' ? 'busy' : ''} />
                        </div>

                        <label className="debug-field">
                            <span>用例名称</span>
                            <input
                                aria-label="用例名称"
                                disabled={editorDisabled}
                                onChange={(event) => {
                                    setTestName(event.target.value);
                                    markDefinitionEdited();
                                }}
                                placeholder="例如：验证我的待办"
                                value={testName}
                            />
                        </label>

                        <label className="debug-field">
                            <span>起始地址</span>
                            <input
                                aria-label="起始地址"
                                disabled={editorDisabled}
                                onChange={(event) => {
                                    setUrl(event.target.value);
                                    markDefinitionEdited();
                                }}
                                spellCheck="false"
                                value={url}
                            />
                        </label>

                        <label className="debug-field">
                            <span>运行模式</span>
                            <select
                                aria-label="运行模式"
                                disabled={editorDisabled}
                                onChange={(event) => setMode(
                                    event.target.value as DebugRunMode
                                )}
                                value={mode}
                            >
                                <option value="ai-explore">AI 探索并生成计划</option>
                                <option value="structured-replay">结构化回放</option>
                            </select>
                        </label>

                        <label className="debug-field">
                            <span>测试动作</span>
                            <textarea
                                aria-label="测试动作"
                                disabled={editorDisabled}
                                onChange={(event) => {
                                    setAction(event.target.value);
                                    markDefinitionEdited();
                                }}
                                placeholder="用自然语言描述操作和需要严格验证的结果。"
                                rows={5}
                                value={action}
                            />
                        </label>

                        {mode === 'structured-replay' && (
                            <label className="debug-field">
                                <span>compiledPlanRef</span>
                                <input
                                    aria-label="计划引用"
                                    disabled={editorDisabled}
                                    onChange={(event) => setPlanRef(
                                        event.target.value
                                    )}
                                    placeholder="runId/json/compiled-plan.json"
                                    spellCheck="false"
                                    value={planRef}
                                />
                            </label>
                        )}

                        <p className="debug-run-hint">
                            {mode === 'ai-explore'
                                ? '引号内的验证文本会逐字复核；通过后按用例保存计划引用。'
                                : '预计 20～40 秒；跳过意图构建和动作规划。'}
                        </p>
                        {(saveError || loadError) && (
                            <p className="debug-run-form-error" role="alert">
                                {saveError || loadError}
                            </p>
                        )}
                    </section>

                    <div className="steps-list">
                        {steps.map((step, index) => (
                            <article className="ai-step-card" key={`${step}-${index}`}>
                                <div className="step-type-icon">
                                    <Icon name="sparkles" size={18} />
                                </div>
                                <div className="step-content">
                                    <p>AI 操作</p>
                                    <button type="button">{step}</button>
                                </div>
                                <button
                                    aria-label={`步骤 ${index + 1} 的更多操作`}
                                    className="step-more-button"
                                    type="button"
                                >
                                    <Icon name="more-horizontal" size={18} />
                                </button>
                            </article>
                        ))}
                    </div>

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
                                disabled={editorDisabled}
                                onChange={(event) => {
                                    setUrl(event.target.value);
                                    markDefinitionEdited();
                                }}
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
                                    elapsedSeconds={elapsedSeconds}
                                    error={runError}
                                    onPrepareReplay={prepareReplay}
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
        </main>
    );
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
    return (
        <div className="run-timeline">
            <header>
                <strong>实时运行时间线</strong>
                <span>
                    {events.length} 条事件
                    {runSessionId ? ` · 会话 ${ runSessionId }` : ''}
                </span>
            </header>
            <ol>
                {events.map((event) => {
                    const screenshotRef = getScreenshotRef(event);
                    return (
                        <li
                            className={
                                screenshotRef === selectedScreenshotRef
                                    ? 'selected'
                                    : ''
                            }
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
    elapsedSeconds: number;
    error: string;
    onPrepareReplay: () => void;
    result?: DebugRunResult;
    runState: RunState;
}

/** 在现有检查器区域展示轻量运行摘要、产物引用和原始响应。 */
function RunConsole({
    elapsedSeconds,
    error,
    onPrepareReplay,
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
                {result.compiledPlanRef && (
                    <button onClick={onPrepareReplay} type="button">
                        使用此计划回放
                    </button>
                )}
            </div>

            <dl className="run-metrics">
                <div><dt>动作</dt><dd>{result.metrics.actionCount}</dd></div>
                <div><dt>模型调用</dt><dd>{result.metrics.modelCallCount}</dd></div>
                <div><dt>耗时</dt><dd>{formatDuration(result.metrics.durationMs)}</dd></div>
                <div><dt>重复状态</dt><dd>{result.metrics.repeatedStateActionCount}</dd></div>
            </dl>

            {result.compiledPlanRef && (
                <div className="run-reference">
                    <span>compiledPlanRef</span>
                    <code>{result.compiledPlanRef}</code>
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
                <pre>{JSON.stringify(result, null, 2)}</pre>
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
