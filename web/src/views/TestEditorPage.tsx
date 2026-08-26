import {
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
    DebugRunMode,
    DebugRunResult,
} from '../api/run-debug';
import {
    requestDebugRun,
} from '../api/run-debug';
import { Icon } from '../components/Icon';
import { repositoryEntries } from '../repository-data';

type InspectorTab = 'context' | 'console' | 'network' | 'html';
type RunState = 'failed' | 'idle' | 'passed' | 'running';

const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'context', label: '上下文' },
    { id: 'console', label: '控制台' },
    { id: 'network', label: '网络' },
    { id: 'html', label: 'HTML' }
];

interface TestScenario {
    action: string;
    steps: string[];
}

const DEFAULT_SCENARIO: TestScenario = {
    action: '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。',
    steps: [
        '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。'
    ]
};
const TEST_SCENARIOS: Record<string, TestScenario> = {
    'avatar-account-menu': {
        action: [
            '使用环境变量中的账号和密码登录简道云，等待工作台加载完成；',
            '点击页面右上角用户头像，确认账号菜单成功展开；',
            '从上到下逐字严格验证账号菜单完整显示以下文本：',
            '“吾名佳欣”、“测试企业(31186)”、“我创建的”、',
            '“我的收藏”、“个人设置”、“管理后台”、“版本购买”、',
            '“语言”、“简体中文”、“退出”。',
            '以上每项均为精确文本断言，顺序、文字或缺失任一不符均判定失败。'
        ].join(''),
        steps: [
            '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。',
            [
                '点击页面右上角用户头像，验证账号菜单已展开，',
                '并按顺序逐字显示“吾名佳欣”、“测试企业(31186)”、',
                '“我创建的”、“我的收藏”、“个人设置”、“管理后台”、',
                '“版本购买”、“语言”、“简体中文”、“退出”。'
            ].join('')
        ]
    }
};
const PLAN_REFERENCE_STORAGE_KEY = 'ai-web-test-engine.last-plan-ref';

function getTestScenario(testId?: string): TestScenario {
    return testId ? TEST_SCENARIOS[testId] ?? DEFAULT_SCENARIO : DEFAULT_SCENARIO;
}

export function TestEditorPage() {
    const { testId } = useParams();
    const initialScenario = getTestScenario(testId);
    const [activeTab, setActiveTab] = useState<InspectorTab>('context');
    const [action, setAction] = useState(initialScenario.action);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [mode, setMode] = useState<DebugRunMode>('ai-explore');
    const [planRef, setPlanRef] = useState(() => (
        window.localStorage.getItem(PLAN_REFERENCE_STORAGE_KEY) ?? ''
    ));
    const [result, setResult] = useState<DebugRunResult>();
    const [runError, setRunError] = useState('');
    const [runState, setRunState] = useState<RunState>('idle');
    const [steps, setSteps] = useState(initialScenario.steps);
    const [url, setUrl] = useState(
        'https://test.jdydevelop.com/portal/signin'
    );
    const abortControllerRef = useRef<AbortController | undefined>(undefined);
    const runStartedAtRef = useRef(0);

    const currentTest = useMemo(() => repositoryEntries.find(
        (entry) => entry.testId === testId
    ), [testId]);
    const fileName = currentTest?.name ?? (
        testId === 'new' ? '未命名测试.test.yaml' : `${testId}.test.yaml`
    );

    useEffect(() => {
        const scenario = getTestScenario(testId);
        setAction(scenario.action);
        setSteps([...scenario.steps]);
    }, [testId]);

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

    useEffect(() => () => abortControllerRef.current?.abort(), []);

    const runTest = async () => {
        const normalizedAction = action.trim();
        const normalizedPlanRef = planRef.trim();
        if (!normalizedAction) {
            showInputError('请输入要执行的测试动作。');
            return;
        }
        if (mode === 'structured-replay' && !normalizedPlanRef) {
            showInputError('结构化回放需要填写 compiledPlanRef。');
            return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        runStartedAtRef.current = Date.now();
        setElapsedSeconds(0);
        setResult(undefined);
        setRunError('');
        setActiveTab('console');
        setRunState('running');
        try {
            const nextResult = await requestDebugRun({
                action: normalizedAction,
                mode,
                ...mode === 'structured-replay'
                    ? { planRef: normalizedPlanRef }
                    : {}
            }, controller.signal);
            if (controller.signal.aborted) {
                return;
            }
            setResult(nextResult);
            setElapsedSeconds(Math.round(nextResult.metrics.durationMs / 1_000));
            setRunState(
                nextResult.lifecycle === 'COMPLETED'
                && nextResult.result === 'PASS'
                    ? 'passed'
                    : 'failed'
            );
            if (nextResult.compiledPlanRef) {
                setPlanRef(nextResult.compiledPlanRef);
                window.localStorage.setItem(
                    PLAN_REFERENCE_STORAGE_KEY,
                    nextResult.compiledPlanRef
                );
            }
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            setRunError(
                error instanceof Error ? error.message : '运行请求失败。'
            );
            setRunState('failed');
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = undefined;
            }
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
        setRunState('idle');
        setResult(undefined);
        setRunError('');
        setElapsedSeconds(0);
        setUrl('https://test.jdydevelop.com/portal/signin');
    };

    const prepareReplay = () => {
        setMode('structured-replay');
        setRunState('idle');
        setRunError('');
    };

    const addStep = () => {
        setSteps((currentSteps) => [
            ...currentSteps,
            '点击此处描述下一个测试步骤。'
        ]);
    };

    return (
        <main className="test-workbench">
            <header className="test-titlebar">
                <nav aria-label="面包屑导航" className="test-breadcrumbs">
                    <Link to="/repository">项目文件</Link>
                    <Icon name="chevron-right" size={16} />
                    <strong title={fileName}>{fileName}</strong>
                    <span className="save-state">已保存</span>
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
                    <button aria-label="保存" title="保存" type="button">
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

                <button
                    className={`run-button ${runState}`}
                    disabled={runState === 'running'}
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
                    {runState === 'idle' && '运行'}
                </button>
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
                            <span>运行模式</span>
                            <select
                                aria-label="运行模式"
                                disabled={runState === 'running'}
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
                                disabled={runState === 'running'}
                                onChange={(event) => setAction(event.target.value)}
                                rows={3}
                                value={action}
                            />
                        </label>

                        {mode === 'structured-replay' && (
                            <label className="debug-field">
                                <span>compiledPlanRef</span>
                                <input
                                    aria-label="计划引用"
                                    disabled={runState === 'running'}
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
                                ? '预计 60～120 秒；通过后自动保存计划引用。'
                                : '预计 20～40 秒；跳过意图构建和动作规划。'}
                        </p>
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
                                onChange={(event) => setUrl(event.target.value)}
                                spellCheck="false"
                                value={url}
                            />
                        </label>
                        <button className="browser-tab-button" type="button">
                            <span className="tab-status-dot" />
                            标签页：登录简道云
                            <Icon name="chevron-down" size={15} />
                        </button>
                        <button
                            className="reset-button"
                            onClick={resetTest}
                            type="button"
                        >
                            <Icon name="rotate-left" size={17} />
                            重置
                        </button>
                    </div>

                    <div className="browser-viewport">
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
                        {runState === 'running' && (
                            <div className="running-overlay">
                                <span className="running-spinner" />
                                <strong>
                                    {mode === 'ai-explore'
                                        ? 'AI 正在探索并执行测试'
                                        : '正在执行结构化回放'}
                                </strong>
                                <p>已等待 {elapsedSeconds} 秒，请保持服务端运行…</p>
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
                                            <div><dt>BASE_URL</dt><dd>"https://test.jdydevelop.com/dashboard#/"</dd></div>
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
                <strong>请求失败</strong>
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
