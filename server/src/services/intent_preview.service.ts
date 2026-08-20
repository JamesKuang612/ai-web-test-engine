import {
    ModelIntentBuilder,
    testIntentSchema,
} from '@ai-web-test-engine/core';
import type {
    BuildIntentInput,
    IntentBuilder,
    TestIntent,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import {
    CodexAppServerModelAdapter,
    FineOneModelAdapter,
} from '../adapters/model';
import { config } from '../config';

/** 表示意图预览接口收到的自然语言内容不合法。 */
export class IntentPreviewInputError extends Error {
    /** 创建一条可以安全返回给调试接口调用方的输入错误。 */
    constructor(message: string) {
        super(message);
        this.name = 'IntentPreviewInputError';
    }
}

/** 按 NStarter 配置选择 Codex 订阅或 FineOne HTTP 模型适配器。 */
function createConfiguredIntentBuilder(): IntentBuilder {
    const llmConfig = config.components.llm;
    const adapter = llmConfig.provider === 'codex_app_server'
        ? new CodexAppServerModelAdapter({
            command: llmConfig.codex_command,
            model: llmConfig.model,
            reasoningEffort: llmConfig.reasoning_effort
        })
        : new FineOneModelAdapter({
            baseUrl: llmConfig.base_url,
            apiKey: llmConfig.api_key,
            model: llmConfig.model,
            protocol: llmConfig.protocol
        });

    return new ModelIntentBuilder(
        adapter,
        testIntentSchema,
        {
            maxOutputTokens: 4_000,
            timeoutMs: 120_000
        }
    );
}

/** 为开发阶段接口提供自然语言到 TestIntent 的预览能力。 */
@service()
export class IntentPreviewService {
    /** 默认使用配置中的真实 Provider，测试可以注入 Fake IntentBuilder。 */
    constructor(
        private readonly intentBuilder: IntentBuilder =
            createConfiguredIntentBuilder()
    ) {}

    /** 使用固定的登录 POC 环境构建测试意图，不启动浏览器。 */
    public async preview(
        action: string,
        signal: AbortSignal
    ): Promise<TestIntent> {
        const normalizedAction = action.trim();
        if (!normalizedAction) {
            throw new IntentPreviewInputError(
                'action 必须是非空字符串。'
            );
        }
        if (normalizedAction.length > 10_000) {
            throw new IntentPreviewInputError(
                'action 长度不能超过 10000 个字符。'
            );
        }

        return await this.intentBuilder.build(
            this.createBuildInput(normalizedAction),
            signal
        );
    }

    /** 为阶段性验证补齐简道云登录 POC 的非敏感上下文。 */
    private createBuildInput(action: string): BuildIntentInput {
        return {
            test: {
                schemaVersion: 1,
                id: 'debug-login-intent-preview',
                name: '登录意图预览',
                environmentId: 'jiandaoyun-test',
                startUrl: 'https://test.jdydevelop.com/portal/signin',
                action
            },
            environment: {
                schemaVersion: 1,
                id: 'jiandaoyun-test',
                name: '简道云测试环境',
                baseUrl: 'https://test.jdydevelop.com',
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
}
