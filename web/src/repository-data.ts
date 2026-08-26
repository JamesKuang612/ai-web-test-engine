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

/** 目录本身由工作区固定提供，测试文件由服务端真实 YAML 仓库返回。 */
export const repositoryFolders: RepositoryEntry[] = [
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
    }
];
