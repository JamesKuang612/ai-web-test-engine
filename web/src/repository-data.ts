export type RepositoryEntryType = 'folder' | 'test';

export interface RepositoryEntry {
    createdAt?: string;
    description?: string;
    id: string;
    name: string;
    testId?: string;
    type: RepositoryEntryType;
    updatedAt?: string;
}

export const repositoryEntries: RepositoryEntry[] = [
    {
        id: 'test-results',
        name: 'test-results',
        type: 'folder'
    },
    {
        id: 'tests',
        name: 'tests',
        type: 'folder'
    },
    {
        id: 'modules',
        name: 'modules',
        type: 'folder'
    },
    {
        id: 'login-and-open-workbench',
        name: 'login-and-open-workbench.test.yaml',
        description: '登录简道云测试环境，进入工作台，并确认应用列表成功加载。',
        testId: 'login-and-open-workbench',
        type: 'test',
        createdAt: '今天',
        updatedAt: '12 分钟前'
    },
    {
        id: 'dashboard-navigation',
        name: 'dashboard-navigation.test.yaml',
        description: '进入工作台后检查左侧导航，并验证主要入口均可正常访问。',
        testId: 'dashboard-navigation',
        type: 'test',
        createdAt: '昨天',
        updatedAt: '3 小时前'
    },
    {
        id: 'create-blank-application',
        name: 'create-blank-application.test.yaml',
        description: '创建一个空白应用，验证创建结果，并返回工作台确认应用真实存在。',
        testId: 'create-blank-application',
        type: 'test',
        createdAt: '3 天前',
        updatedAt: '昨天'
    },
    {
        id: 'avatar-account-menu',
        name: 'avatar-account-menu.test.yaml',
        description: '点击页面右上角用户头像，确认个人账户菜单能够完整展开。',
        testId: 'avatar-account-menu',
        type: 'test',
        createdAt: '5 天前',
        updatedAt: '2 天前'
    },
    {
        id: 'delete-record',
        name: 'delete-record.test.yaml',
        description: '删除指定测试记录，并验证列表中不再存在对应数据。',
        testId: 'delete-record',
        type: 'test',
        createdAt: '6 天前',
        updatedAt: '4 天前'
    }
];
