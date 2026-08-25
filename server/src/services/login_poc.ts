import type {
    BuildIntentInput,
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
                'test.jdydevelop.com'
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
                '不得在测试意图中写入账号、密码或令牌。'
            ],
            terms: {
                workspace: '简道云登录后展示的工作台页面'
            }
        }
    };
}

/** 为地基调试接口补充执行模式和保守的单次运行预算。 */
export function createLoginPocStartInput(
    action: string
): StartRunInput {
    return {
        ...createLoginPocBuildInput(action),
        mode: 'ai-explore',
        budgets: {
            maxActions: 2,
            maxDurationMs: 180_000,
            maxModelCalls: 2,
            maxRepeatedStateActions: 0
        }
    };
}
