import type {
    BuildIntentInput,
    RunMode,
    StartRunInput,
} from '@ai-web-test-engine/core';

const LOGIN_URL = 'https://test.jdydevelop.com/dashboard#/';

/** 创建意图预览和完整调试运行共同使用的登录 POC 上下文。 */
export function createLoginPocBuildInput(
    action: string
): BuildIntentInput {
    return {
        test: {
            schemaVersion: 1,
            id: 'debug-login-foundation-run',
            name: '简道云登录地基验证',
            environmentId: 'jiandaoyun-test',
            startUrl: LOGIN_URL,
            action
        },
        environment: {
            schemaVersion: 1,
            id: 'jiandaoyun-test',
            name: '简道云测试环境',
            baseUrl: LOGIN_URL,
            allowedHosts: [
                'test.jdydevelop.com',
                'test.frjdy.com'
            ],
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
                '验证账号菜单时只允许展开和观察，不得执行退出登录或修改账号配置。'
            ],
            terms: {
                workspace: '简道云登录后展示的工作台页面',
                accountMenu: '点击工作台右上角用户头像后展开的账号菜单'
            }
        }
    };
}

/** 为登录调试接口补充执行模式和多轮运行预算。 */
export function createLoginPocStartInput(
    action: string,
    mode: RunMode = 'ai-explore',
    planRef?: string
): StartRunInput {
    const buildInput = createLoginPocBuildInput(action);
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
            maxActions: 12,
            maxDurationMs: 300_000,
            maxModelCalls: mode === 'structured-replay' ? 1 : 9,
            maxRepeatedStateActions: 1
        }
    };
}
