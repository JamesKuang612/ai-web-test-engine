import type {
    BuildIntentInput,
    RunMode,
    StartRunInput,
} from '@ai-web-test-engine/core';

export const DEFAULT_TEST_START_URL =
    'https://test.jdydevelop.com/dashboard#/';
export const JIANDAOYUN_ALLOWED_HOSTS = [
    'test.jdydevelop.com',
    'test.frjdy.com'
];

export interface DebugTestInput {
    action: string;
    id: string;
    name: string;
    startUrl: string;
}

/** 创建通用自然语言用例使用的简道云测试环境和项目约束。 */
export function createDebugTestBuildInput(
    test: DebugTestInput
): BuildIntentInput {
    return {
        test: {
            schemaVersion: 1,
            id: test.id,
            name: test.name,
            environmentId: 'jiandaoyun-test',
            startUrl: test.startUrl,
            action: test.action
        },
        environment: {
            schemaVersion: 1,
            id: 'jiandaoyun-test',
            name: '简道云测试环境',
            baseUrl: test.startUrl,
            allowedHosts: JIANDAOYUN_ALLOWED_HOSTS,
            variables: {
                username: {
                    source: 'local',
                    key: 'JIANDAOYUN_USERNAME',
                    sensitive: false
                },
                password: {
                    source: 'local',
                    key: 'JIANDAOYUN_PASSWORD',
                    sensitive: true
                }
            }
        },
        projectContext: {
            projectId: 'ai-web-test-engine',
            rules: [
                '如果当前已经登录，不要退出或重复登录。',
                '不得访问 allowedHosts 以外的页面。',
                '不得在测试意图中写入账号、密码或令牌。',
                '验证账号菜单时只允许展开和观察，不得执行退出登录或修改账号配置。',
                '用户在验证、断言或校验语句中使用引号标出的文本必须逐字匹配，不得使用同义词、部分文本或模糊匹配。'
            ],
            terms: {
                workspace: '简道云登录后展示的工作台页面',
                accountMenu: '点击工作台右上角用户头像后展开的账号菜单'
            }
        }
    };
}

/** 为通用调试用例补充执行模式、计划引用和多轮预算。 */
export function createDebugTestStartInput(
    test: DebugTestInput,
    mode: RunMode = 'ai-explore',
    planRef?: string
): StartRunInput {
    const buildInput = createDebugTestBuildInput(test);
    return {
        ...buildInput,
        test: {
            ...buildInput.test,
            ...mode === 'structured-replay' && planRef
                ? {
                    execution: {
                        planRef,
                        preferredMode: mode
                    }
                }
                : {}
        },
        mode,
        budgets: {
            maxActions: 20,
            maxDurationMs: 600_000,
            maxModelCalls: mode === 'structured-replay' ? 1 : 15,
            maxRepeatedStateActions: 1
        }
    };
}
