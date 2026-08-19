import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { repositoryEntries } from '../repository-data';

type InspectorTab = 'context' | 'console' | 'network' | 'html';
type RunState = 'idle' | 'running' | 'passed';

const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'context', label: '上下文' },
    { id: 'console', label: '控制台' },
    { id: 'network', label: '网络' },
    { id: 'html', label: 'HTML' }
];

const initialSteps = [
    '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。'
];

export function TestEditorPage() {
    const { testId } = useParams();
    const [activeTab, setActiveTab] = useState<InspectorTab>('context');
    const [runState, setRunState] = useState<RunState>('idle');
    const [steps, setSteps] = useState(initialSteps);
    const [url, setUrl] = useState(
        'https://test.jdydevelop.com/portal/signin'
    );

    const currentTest = useMemo(() => repositoryEntries.find(
        (entry) => entry.testId === testId
    ), [testId]);
    const fileName = currentTest?.name ?? (
        testId === 'new' ? '未命名测试.test.yaml' : `${testId}.test.yaml`
    );

    const runTest = () => {
        setRunState('running');
        window.setTimeout(() => setRunState('passed'), 700);
    };

    const resetTest = () => {
        setRunState('idle');
        setUrl('https://test.jdydevelop.com/portal/signin');
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
                    onClick={runTest}
                    type="button"
                >
                    {runState === 'passed' ? (
                        <Icon name="check" size={18} />
                    ) : (
                        <Icon name="play" size={18} />
                    )}
                    {runState === 'running' && '运行中'}
                    {runState === 'passed' && '已通过'}
                    {runState === 'idle' && '运行'}
                </button>
            </section>

            <div className="workbench-body">
                <aside className="steps-panel">
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
                                <strong>AI 正在执行第 1 步</strong>
                                <p>分析页面并查找登录入口…</p>
                            </div>
                        )}
                        {runState === 'passed' && (
                            <div className="run-result-toast">
                                <Icon name="check" size={18} />
                                <div><strong>测试通过</strong><span>共执行 1 个步骤</span></div>
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
                                <div className="inspector-empty">
                                    <Icon name="code" size={20} />
                                    <span>运行测试后，页面日志会显示在这里。</span>
                                </div>
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
