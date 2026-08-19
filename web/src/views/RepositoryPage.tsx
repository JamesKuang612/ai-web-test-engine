import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import {
    repositoryEntries,
    type RepositoryEntryType
} from '../repository-data';

type EntryFilter = 'all' | RepositoryEntryType;

export function RepositoryPage() {
    const [entryFilter, setEntryFilter] = useState<EntryFilter>('all');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

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
    }, [entryFilter, searchQuery]);

    const resetFilters = () => {
        setEntryFilter('all');
        setSearchQuery('');
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
                        {repositoryEntries
                            .filter((entry) => entry.type === 'folder')
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
                        <Link className="create-test-button" to="/tests/new">
                            <Icon name="plus" size={17} />
                            新建测试
                        </Link>
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
                    </div>
                </section>
            </main>
        </div>
    );
}
