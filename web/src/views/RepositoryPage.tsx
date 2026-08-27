import {
    useEffect,
    useMemo,
    useState,
} from 'react';
import {
    Link,
    useNavigate,
} from 'react-router-dom';
import {
    createTestDefinition,
    listTestDefinitions,
} from '../api/test-definitions';
import { Icon } from '../components/Icon';
import {
    repositoryFolders,
    type RepositoryEntry,
    type RepositoryEntryType
} from '../repository-data';

type EntryFilter = 'all' | RepositoryEntryType;

const DEFAULT_START_URL = 'https://test.jdydevelop.com/dashboard#/';

export function RepositoryPage() {
    const navigate = useNavigate();
    const [entryFilter, setEntryFilter] = useState<EntryFilter>('all');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [testEntries, setTestEntries] = useState<RepositoryEntry[]>([]);
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [createOpen, setCreateOpen] = useState(false);
    const [createName, setCreateName] = useState('');
    const [createStartUrl, setCreateStartUrl] = useState(DEFAULT_START_URL);
    const [createError, setCreateError] = useState('');
    const [createSubmitting, setCreateSubmitting] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setLoadError('');
        void listTestDefinitions(controller.signal).then((records) => {
            setTestEntries(records.map((record) => ({
                id: record.definition.id,
                name: record.fileName,
                description: record.definition.action,
                testId: record.definition.id,
                type: 'test',
                createdAt: '—',
                updatedAt: formatUpdatedAt(record.updatedAt)
            })));
        }).catch((error) => {
            if (!controller.signal.aborted) {
                setLoadError(
                    error instanceof Error
                        ? error.message
                        : '测试用例加载失败。'
                );
            }
        }).finally(() => {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        });
        return () => controller.abort();
    }, [refreshVersion]);

    const repositoryEntries = useMemo(() => [
        ...repositoryFolders,
        ...testEntries
    ], [testEntries]);

    const visibleEntries = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

        return repositoryEntries.filter((entry) => {
            const matchesType = entryFilter === 'all' ||
                entry.type === entryFilter;
            const matchesSearch = normalizedQuery.length === 0 ||
                entry.name.toLocaleLowerCase().includes(normalizedQuery) ||
                entry.description?.toLocaleLowerCase()
                    .includes(normalizedQuery);

            return matchesType && matchesSearch;
        });
    }, [entryFilter, repositoryEntries, searchQuery]);

    const resetFilters = () => {
        setEntryFilter('all');
        setSearchQuery('');
        setRefreshVersion((version) => version + 1);
    };

    const openCreateDialog = () => {
        setCreateName('');
        setCreateStartUrl(DEFAULT_START_URL);
        setCreateError('');
        setCreateOpen(true);
    };

    const closeCreateDialog = () => {
        if (!createSubmitting) {
            setCreateOpen(false);
        }
    };

    const createTest = async () => {
        const name = createName.trim();
        const startUrl = createStartUrl.trim();
        if (!name || !startUrl) {
            setCreateError('用例名称和起始地址均不能为空。');
            return;
        }
        setCreateSubmitting(true);
        setCreateError('');
        try {
            const record = await createTestDefinition({
                action: '',
                name,
                setupModules: [ 'jiandaoyun-login' ],
                startUrl
            });
            navigate(`/tests/${ record.definition.id }`);
        } catch (error) {
            setCreateError(
                error instanceof Error ? error.message : '创建测试失败。'
            );
        } finally {
            setCreateSubmitting(false);
        }
    };

    return (
        <div className="repository-shell">
            <aside className="repository-sidebar">
                <div className="sidebar-main">
                    <button className="project-switcher" type="button">
                        <span className="project-mark">AI</span>
                        <span className="project-name">ai-web-test-engine</span>
                        <Icon name="chevron-down" size={16} />
                    </button>

                    <button
                        className="sidebar-search-button"
                        onClick={() => setSearchOpen((value) => !value)}
                        type="button"
                    >
                        <Icon name="search" />
                        <span>搜索</span>
                        <kbd>⌘ K</kbd>
                    </button>

                    {searchOpen && (
                        <div className="sidebar-search-field">
                            <Icon name="search" size={16} />
                            <input
                                aria-label="搜索文件或描述"
                                autoFocus
                                onChange={(event) => {
                                    setSearchQuery(event.target.value);
                                }}
                                placeholder="搜索文件或描述"
                                type="search"
                                value={searchQuery}
                            />
                        </div>
                    )}

                    <p className="sidebar-section-label">项目文件</p>
                    <nav aria-label="项目目录" className="folder-navigation">
                        {repositoryFolders
                            .map((entry) => (
                                <a href={`#${entry.id}`} key={entry.id}>
                                    <Icon name="folder" />
                                    <span>{entry.name}</span>
                                    <Icon
                                        className="folder-chevron"
                                        name="chevron-right"
                                        size={16}
                                    />
                                </a>
                            ))}
                    </nav>
                </div>

                <div className="sidebar-footer">
                    <button type="button">
                        <Icon name="book" />
                        <span>使用文档</span>
                    </button>
                    <button type="button">
                        <Icon name="lightbulb" />
                        <span>快速指南</span>
                    </button>
                    <button type="button">
                        <Icon name="message" />
                        <span>反馈建议</span>
                    </button>
                    <p>AI Web Test Engine v0.1.0</p>
                </div>
            </aside>

            <main className="repository-main">
                <header className="repository-header">
                    <div>
                        <p className="page-kicker">本地项目</p>
                        <h1>项目文件</h1>
                    </div>
                    <div className="header-actions">
                        <div className="git-state" title="当前 Git 工作区状态">
                            <Icon name="git-branch" size={16} />
                            <span>master</span>
                            <i />
                            <Icon name="check" size={15} />
                            <span>工作区干净</span>
                        </div>
                        <button
                            className="create-test-button"
                            onClick={openCreateDialog}
                            type="button"
                        >
                            <Icon name="plus" size={17} />
                            新建测试
                        </button>
                    </div>
                </header>

                <section className="repository-content">
                    <div className="repository-toolbar">
                        <div className="filter-select-wrap">
                            <Icon name="plus" size={15} />
                            <select
                                aria-label="筛选类型"
                                onChange={(event) => {
                                    setEntryFilter(
                                        event.target.value as EntryFilter
                                    );
                                }}
                                value={entryFilter}
                            >
                                <option value="all">全部类型</option>
                                <option value="folder">文件夹</option>
                                <option value="test">测试文件</option>
                            </select>
                        </div>
                        <div className="toolbar-summary">
                            <span>共 {visibleEntries.length} 项</span>
                            <button
                                aria-label="重置筛选"
                                onClick={resetFilters}
                                title="重置筛选"
                                type="button"
                            >
                                <Icon name="refresh" size={17} />
                            </button>
                        </div>
                    </div>

                    <div className="repository-table-wrap">
                        <table className="repository-table">
                            <thead>
                                <tr>
                                    <th>
                                        <span>名称</span>
                                        <Icon name="sort" size={15} />
                                    </th>
                                    <th>创建时间</th>
                                    <th>
                                        <span>最后更新</span>
                                        <Icon name="sort" size={15} />
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleEntries.map((entry) => (
                                    <tr id={entry.id} key={entry.id}>
                                        <td>
                                            <div className="entry-name-cell">
                                                <span
                                                    className={
                                                        `entry-icon ${entry.type}`
                                                    }
                                                >
                                                    <Icon
                                                        name={entry.type === 'folder'
                                                            ? 'folder'
                                                            : 'file-code'}
                                                        size={20}
                                                    />
                                                </span>
                                                <div>
                                                    {entry.type === 'test' &&
                                                        entry.testId ? (
                                                            <Link
                                                                className="entry-name"
                                                                to={
                                                                    `/tests/${entry.testId}`
                                                                }
                                                            >
                                                                {entry.name}
                                                            </Link>
                                                        ) : (
                                                            <a
                                                                className="entry-name"
                                                                href={`#${entry.id}`}
                                                            >
                                                                {entry.name}
                                                            </a>
                                                        )}
                                                    {entry.description && (
                                                        <p title={entry.description}>
                                                            {entry.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className="time-value">
                                                {entry.createdAt ?? '—'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="time-value">
                                                {entry.updatedAt ?? '—'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {visibleEntries.length === 0 && (
                            <div className="empty-repository">
                                <Icon name="search" size={22} />
                                <strong>没有找到匹配的项目</strong>
                                <span>请调整搜索内容或文件类型。</span>
                            </div>
                        )}
                        {loading && (
                            <div className="empty-repository">
                                <span>正在读取项目 tests 目录…</span>
                            </div>
                        )}
                        {loadError && (
                            <div className="empty-repository" role="alert">
                                <Icon name="code" size={22} />
                                <strong>测试用例加载失败</strong>
                                <span>{loadError}</span>
                            </div>
                        )}
                    </div>
                </section>
            </main>

            {createOpen && (
                <div className="dialog-backdrop" role="presentation">
                    <form
                        aria-labelledby="create-test-title"
                        aria-modal="true"
                        className="test-settings-dialog create-test-dialog"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void createTest();
                        }}
                        role="dialog"
                    >
                        <header>
                            <div>
                                <h2 id="create-test-title">新建测试</h2>
                                <p>先创建测试文件，操作步骤稍后在编辑器中添加。</p>
                            </div>
                            <button
                                aria-label="关闭新建测试窗口"
                                disabled={createSubmitting}
                                onClick={closeCreateDialog}
                                type="button"
                            >
                                <Icon name="x" size={18} />
                            </button>
                        </header>

                        <div className="dialog-fields">
                            <label>
                                <span>用例名称</span>
                                <input
                                    aria-label="新建用例名称"
                                    autoFocus
                                    disabled={createSubmitting}
                                    onChange={(event) => {
                                        setCreateName(event.target.value);
                                        setCreateError('');
                                    }}
                                    placeholder="例如：验证我的待办"
                                    value={createName}
                                />
                            </label>
                            <label>
                                <span>起始地址</span>
                                <input
                                    aria-label="新建测试起始地址"
                                    disabled={createSubmitting}
                                    onChange={(event) => {
                                        setCreateStartUrl(event.target.value);
                                        setCreateError('');
                                    }}
                                    spellCheck="false"
                                    value={createStartUrl}
                                />
                            </label>
                            <p className="dialog-field-hint">
                                创建后进入空白编辑器，再从左侧添加自然语言操作。
                            </p>
                            {createError && (
                                <p className="dialog-error" role="alert">
                                    {createError}
                                </p>
                            )}
                        </div>

                        <footer>
                            <button
                                className="dialog-secondary-button"
                                disabled={createSubmitting}
                                onClick={closeCreateDialog}
                                type="button"
                            >
                                取消
                            </button>
                            <button
                                className="dialog-primary-button"
                                disabled={createSubmitting}
                                type="submit"
                            >
                                {createSubmitting ? '创建中…' : '创建测试'}
                            </button>
                        </footer>
                    </form>
                </div>
            )}
        </div>
    );
}

function formatUpdatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
