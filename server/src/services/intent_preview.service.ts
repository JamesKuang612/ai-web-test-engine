import {
    ModelIntentBuilder,
    testIntentSchema,
} from '@ai-web-test-engine/core';
import type {
    IntentBuilder,
    ModelAdapter,
    TestIntent,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import {
    CodexAppServerModelAdapter,
    FineOneModelAdapter,
} from '../adapters/model';
import { config } from '../config';
import { createLoginPocBuildInput } from './login_poc';

/** 表示意图预览接口收到的自然语言内容不合法。 */
export class IntentPreviewInputError extends Error {
    /** 创建一条可以安全返回给调试接口调用方的输入错误。 */
    constructor(message: string) {
        super(message);
        this.name = 'IntentPreviewInputError';
    }
}

/** 按 NStarter 配置选择 Codex 订阅或 FineOne HTTP 模型适配器。 */
export function createConfiguredModelAdapter(): ModelAdapter {
    const llmConfig = config.components.llm;
    return llmConfig.provider === 'codex_app_server'
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
}

/** 使用指定模型边界创建测试意图构建器。 */
export function createConfiguredIntentBuilder(
    adapter: ModelAdapter = createConfiguredModelAdapter()
): IntentBuilder {
    return new ModelIntentBuilder(
        adapter,
        testIntentSchema,
        {
            maxOutputTokens: 4_000,
            timeoutMs: 300_000
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
            createLoginPocBuildInput(normalizedAction),
            signal
        );
    }
}
