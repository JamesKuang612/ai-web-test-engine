import type {
    ExecutionEngine,
    RunResult,
} from '@ai-web-test-engine/core';
import {
    actionCommandSchema,
    ModelActionPlanner,
    ModelVerdictEvaluator,
    RunCoordinator,
    verdictDecisionSchema,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import { PlaywrightBrowserAdapter } from '../adapters/browser';
import { LocalEnvironmentValueResolver } from '../adapters/environment';
import { LoggingRunEventPublisher } from '../adapters/events';
import { LocalArtifactStore } from '../adapters/storage/local_artifact_store';
import { config } from '../config';
import {
    createConfiguredIntentBuilder,
    createConfiguredModelAdapter,
} from './intent_preview.service';
import { createLoginPocStartInput } from './login_poc';

/** 表示完整调试接口收到的自然语言内容不合法。 */
export class RunDebugInputError extends Error {
    /** 创建一条可以安全返回给接口调用方的输入错误。 */
    constructor(message: string) {
        super(message);
        this.name = 'RunDebugInputError';
    }
}

/** 根据本机配置组装真实模型、Playwright 和本地存储。 */
function createConfiguredExecutionEngine(): ExecutionEngine {
    const browserConfig = config.components.browser;
    const modelAdapter = createConfiguredModelAdapter();
    return new RunCoordinator(
        new LocalArtifactStore(config.storage.artifact_root),
        new LoggingRunEventPublisher(),
        createConfiguredIntentBuilder(modelAdapter),
        new PlaywrightBrowserAdapter(),
        {
            actionPlanner: new ModelActionPlanner(
                modelAdapter,
                actionCommandSchema,
                {
                    maxOutputTokens: 1_200,
                    timeoutMs: 300_000
                }
            ),
            verdictEvaluator: new ModelVerdictEvaluator(
                modelAdapter,
                verdictDecisionSchema,
                {
                    maxOutputTokens: 2_000,
                    timeoutMs: 300_000
                }
            )
        },
        new LocalEnvironmentValueResolver(),
        {
            browserStartOptions: {
                headless: browserConfig.headless,
                viewport: {
                    width: browserConfig.viewport.width,
                    height: browserConfig.viewport.height
                }
            }
        }
    );
}

/** 执行登录 POC 的多轮 Agent 闭环，并返回独立判定后的 RunResult。 */
@service()
export class RunDebugService {
    /** 默认装配真实执行引擎，测试可以注入不访问模型和浏览器的替身。 */
    constructor(
        private readonly executionEngine: ExecutionEngine =
            createConfiguredExecutionEngine()
    ) {}

    /** 校验自然语言输入并启动一次完整登录运行。 */
    public async run(
        action: string,
        signal: AbortSignal
    ): Promise<RunResult> {
        const normalizedAction = action.trim();
        if (!normalizedAction) {
            throw new RunDebugInputError(
                'action 必须是非空字符串。'
            );
        }
        if (normalizedAction.length > 10_000) {
            throw new RunDebugInputError(
                'action 长度不能超过 10000 个字符。'
            );
        }

        return await this.executionEngine.start(
            createLoginPocStartInput(normalizedAction),
            signal
        );
    }
}
