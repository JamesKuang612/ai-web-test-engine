import type {
    ExecutionEngine,
    RunEventPublisher,
    RunMode,
    RunResult,
} from '@ai-web-test-engine/core';
import path from 'node:path';
import {
    CompositeTargetGrounder,
    ModelActionPlanner,
    ModelRecoveryPlanner,
    ModelStepProgressEvaluator,
    ModelVerdictEvaluator,
    PerceptionService,
    RunCoordinator,
    semanticActionSchema,
    SemanticStepProgressEvaluator,
    verdictDecisionSchema,
} from '@ai-web-test-engine/core';
import { service } from 'nstarter-core';
import {
    JiandaoyunLoginBrowserAdapter,
    PlaywrightBrowserAdapter,
    PlaywrightCandidateMappingAdapter,
    PlaywrightPagePerceptionAdapter,
} from '../adapters/browser';
import { resolveArtifactRootDirectories } from '../adapters/storage/artifact_root';
import { LocalEnvironmentValueResolver } from '../adapters/environment';
import { LoggingRunEventPublisher } from '../adapters/events';
import { LocalArtifactStore } from '../adapters/storage/local_artifact_store';
import { config } from '../config';
import {
    DisabledVisualGroundingAdapter,
    MidsceneVisualGroundingAdapter,
} from '../adapters/visual';
import {
    createConfiguredIntentBuilder,
    createConfiguredModelAdapter,
} from './intent_preview.service';
import {
    createDebugTestStartInput,
    DEFAULT_TEST_START_URL,
    JIANDAOYUN_ALLOWED_HOSTS,
    JIANDAOYUN_LOGIN_MODULE_ID,
} from './debug_test_context';

/** 表示完整调试接口收到的自然语言内容不合法。 */
export class RunDebugInputError extends Error {
    /** 创建一条可以安全返回给接口调用方的输入错误。 */
    constructor(message: string) {
        super(message);
        this.name = 'RunDebugInputError';
    }
}

/** 调试入口允许调用方选择探索或指定已有计划回放。 */
export interface RunDebugOptions {
    mode?: unknown;
    planRef?: unknown;
    setupModules?: unknown;
    startUrl?: unknown;
    testId?: unknown;
    testName?: unknown;
}

const SUPPORTED_RUN_MODES = new Set<RunMode>([
    'ai-explore',
    'structured-replay'
]);
const PLAN_REF_PATTERN =
    /^[a-zA-Z0-9_-]+\/json\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/u;

/** 根据本机配置组装真实模型、Playwright 和本地存储。 */
function createConfiguredExecutionEngine(
    eventPublisher: RunEventPublisher,
    startUrl: string,
    setupModules: string[]
): ExecutionEngine {
    const browserConfig = config.components.browser;
    const artifactRoot = resolveArtifactRootDirectories(
        config.storage.artifact_root
    )[0];
    const modelAdapter = createConfiguredModelAdapter();
    const baseBrowserAdapter = new PlaywrightBrowserAdapter();
    const visualGrounding =
        config.components.visual_grounding?.enabled === false
            ? new DisabledVisualGroundingAdapter()
            : new MidsceneVisualGroundingAdapter(baseBrowserAdapter);
    const perceptionService = new PerceptionService(
        new PlaywrightPagePerceptionAdapter(baseBrowserAdapter)
    );
    const targetGrounder = new CompositeTargetGrounder(
        new PlaywrightCandidateMappingAdapter(baseBrowserAdapter),
        visualGrounding
    );
    const browserAdapter = setupModules.includes(JIANDAOYUN_LOGIN_MODULE_ID)
        ? new JiandaoyunLoginBrowserAdapter(baseBrowserAdapter, {
            cacheRoot: path.join(
                artifactRoot,
                '.auth-cache'
            ),
            password: process.env.JIANDAOYUN_PASSWORD,
            startUrl,
            username: process.env.JIANDAOYUN_USERNAME
        })
        : baseBrowserAdapter;
    return new RunCoordinator(
        new LocalArtifactStore(config.storage.artifact_root),
        eventPublisher,
        createConfiguredIntentBuilder(modelAdapter),
        browserAdapter,
        {
            actionPlanner: new ModelActionPlanner(
                modelAdapter,
                semanticActionSchema,
                {
                    maxOutputTokens: 1_200,
                    timeoutMs: 300_000
                }
            ),
            perceptionService,
            recoveryPlanner: new ModelRecoveryPlanner(modelAdapter, {
                maxOutputTokens: 800,
                timeoutMs: 300_000
            }),
            stepProgressEvaluator: new SemanticStepProgressEvaluator({
                modelFallback: new ModelStepProgressEvaluator(modelAdapter)
            }),
            targetGrounder,
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
        private readonly executionEngine: ExecutionEngine | undefined =
            undefined
    ) {}

    /** 校验自然语言输入并启动一次完整登录运行。 */
    public async run(
        action: string,
        signal: AbortSignal,
        options: RunDebugOptions = {},
        eventPublisher: RunEventPublisher = new LoggingRunEventPublisher()
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

        const mode = this.normalizeMode(options.mode);
        const planRef = this.normalizePlanRef(mode, options.planRef);
        const setupModules = this.normalizeSetupModules(options.setupModules);
        const test = {
            action: normalizedAction,
            id: this.normalizeTestId(options.testId),
            name: this.normalizeTestName(options.testName),
            startUrl: this.normalizeStartUrl(options.startUrl)
        };

        const executionEngine = this.executionEngine
            ?? createConfiguredExecutionEngine(
                eventPublisher,
                test.startUrl,
                setupModules
            );
        return await executionEngine.start(
            createDebugTestStartInput(test, mode, planRef, setupModules),
            signal
        );
    }

    /** 前置模块必须来自服务端白名单，避免请求注入任意执行逻辑。 */
    private normalizeSetupModules(value: unknown): string[] {
        if (value === undefined) {
            return [];
        }
        if (
            !Array.isArray(value)
            || value.some((item) => item !== JIANDAOYUN_LOGIN_MODULE_ID)
            || new Set(value).size !== value.length
        ) {
            throw new RunDebugInputError(
                `setupModules 目前只支持 ${ JIANDAOYUN_LOGIN_MODULE_ID }。`
            );
        }
        return [ ...value ];
    }

    /** 当前调试入口只开放已实际接入的两种运行模式。 */
    private normalizeMode(value: unknown): RunMode {
        if (value === undefined) {
            return 'ai-explore';
        }
        if (
            typeof value !== 'string'
            || !SUPPORTED_RUN_MODES.has(value as RunMode)
        ) {
            throw new RunDebugInputError(
                'mode 只支持 ai-explore 或 structured-replay。'
            );
        }
        return value as RunMode;
    }

    /** 回放模式必须使用存储层生成的受控 JSON 引用。 */
    private normalizePlanRef(
        mode: RunMode,
        value: unknown
    ): string | undefined {
        if (mode !== 'structured-replay') {
            if (value !== undefined) {
                throw new RunDebugInputError(
                    'planRef 只能用于 structured-replay 模式。'
                );
            }
            return undefined;
        }
        if (
            typeof value !== 'string'
            || !PLAN_REF_PATTERN.test(value)
        ) {
            throw new RunDebugInputError(
                'structured-replay 必须提供合法的 planRef。'
            );
        }
        return value;
    }

    /** 用例 ID 会写入运行和结构化计划，必须是安全稳定的文件标识。 */
    private normalizeTestId(value: unknown): string {
        if (value === undefined) {
            return 'debug-natural-language-run';
        }
        if (
            typeof value !== 'string'
            || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)
        ) {
            throw new RunDebugInputError(
                'testId 只能包含小写字母、数字和连字符。'
            );
        }
        return value;
    }

    /** 用例名称只用于模型上下文，不允许空白或超长输入。 */
    private normalizeTestName(value: unknown): string {
        if (value === undefined) {
            return '自然语言调试用例';
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new RunDebugInputError('testName 必须是非空字符串。');
        }
        if (value.trim().length > 120) {
            throw new RunDebugInputError(
                'testName 长度不能超过 120 个字符。'
            );
        }
        return value.trim();
    }

    /** 起始地址只允许位于已明确开放的简道云 Host 范围内。 */
    private normalizeStartUrl(value: unknown): string {
        if (value === undefined) {
            return DEFAULT_TEST_START_URL;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new RunDebugInputError('startUrl 必须是非空字符串。');
        }
        if (value.length > 2_048) {
            throw new RunDebugInputError(
                'startUrl 长度不能超过 2048 个字符。'
            );
        }
        let url: URL;
        try {
            url = new URL(value.trim());
        } catch {
            throw new RunDebugInputError('startUrl 必须是合法 URL。');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new RunDebugInputError(
                'startUrl 只允许 HTTP 或 HTTPS。'
            );
        }
        if (url.username || url.password) {
            throw new RunDebugInputError(
                'startUrl 不得包含账号或密码。'
            );
        }
        if (!JIANDAOYUN_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
            throw new RunDebugInputError(
                `startUrl 只允许以下 Host：${
                    JIANDAOYUN_ALLOWED_HOSTS.join('、')
                }。`
            );
        }
        return url.toString();
    }
}
