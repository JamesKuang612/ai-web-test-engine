import {
    Navigate,
    NavLink,
    Route,
    Routes,
    useParams
} from 'react-router-dom';

function RepositoryPage() {
    return (
        <section className="page-panel">
            <p className="eyebrow">Repository</p>
            <h1>本地测试项目</h1>
            <p>
                这里将展示由本地文件和 Git 管理的测试目录、用例与运行结果。
            </p>
            <NavLink className="primary-link" to="/tests/example-login">
                打开示例测试
            </NavLink>
        </section>
    );
}

function TestEditorPage() {
    const { testId } = useParams();

    return (
        <section className="page-panel">
            <p className="eyebrow">Test editor</p>
            <h1>测试编辑与执行工作台</h1>
            <p>
                当前测试：<code>{testId}</code>
            </p>
            <p>
                后续将在这里加入 AI Action、浏览器预览、执行状态和证据面板。
            </p>
        </section>
    );
}

export default function App() {
    return (
        <div className="app-shell">
            <header className="app-header">
                <NavLink className="brand" to="/repository">
                    AI Web Test Engine
                </NavLink>
                <nav aria-label="主导航">
                    <NavLink to="/repository">Repository</NavLink>
                    <NavLink to="/tests/example-login">Test editor</NavLink>
                </nav>
            </header>
            <main>
                <Routes>
                    <Route
                        path="/"
                        element={<Navigate replace to="/repository" />}
                    />
                    <Route path="/repository" element={<RepositoryPage />} />
                    <Route path="/tests/:testId" element={<TestEditorPage />} />
                    <Route
                        path="*"
                        element={<Navigate replace to="/repository" />}
                    />
                </Routes>
            </main>
        </div>
    );
}
