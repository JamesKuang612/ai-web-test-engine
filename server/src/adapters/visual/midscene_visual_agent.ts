import type {
    AgentOpt,
} from '@midscene/web';
import {
    PlaywrightAgent,
} from '@midscene/web/playwright';
import type {
    Page,
} from 'playwright';
import {
    config,
} from '../../config';
import type {
    IVisualGroundingComponentConf,
} from '../../entities/config';

/** Midscene 通过 Agent modelConfig 接收的环境变量风格配置。 */
export interface MidsceneModelConfig extends Record<string, string | number> {
    MIDSCENE_MODEL_BASE_URL: string;
    MIDSCENE_MODEL_FAMILY: 'deepseek' | 'gpt-5';
    MIDSCENE_MODEL_NAME: string;
    MIDSCENE_MODEL_REASONING_ENABLED: 'false' | 'true';
    MIDSCENE_MODEL_TIMEOUT: number;
}

/** 本机旧配置未声明视觉组件时使用的安全默认值。 */
export const DEFAULT_MIDSCENE_VISUAL_CONFIG: IVisualGroundingComponentConf = {
    enabled: true,
    provider: 'midscene',
    base_url: 'https://api.deepseek.com',
    api_key: '',
    model: 'deepseek-v4-flash-vision-exp',
    model_family: 'deepseek',
    reasoning_enabled: false,
    timeout_ms: 120_000
};

/**
 * 把项目配置转换为隔离的 Midscene Agent 配置。
 *
 * 这里不写入 process.env，避免视觉模型设置影响服务内其他模型调用。
 */
export function createMidsceneAgentOptions(
    visualConfig: IVisualGroundingComponentConf
): AgentOpt {
    validateMidsceneVisualConfig(visualConfig);
    const modelConfig: MidsceneModelConfig = {
        MIDSCENE_MODEL_BASE_URL: visualConfig.base_url,
        MIDSCENE_MODEL_FAMILY: visualConfig.model_family,
        MIDSCENE_MODEL_NAME: visualConfig.model,
        MIDSCENE_MODEL_REASONING_ENABLED: visualConfig.reasoning_enabled
            ? 'true'
            : 'false',
        MIDSCENE_MODEL_TIMEOUT: visualConfig.timeout_ms
    };
    if (visualConfig.api_key?.trim()) {
        modelConfig.MIDSCENE_MODEL_API_KEY = visualConfig.api_key.trim();
    }
    return {
        autoPrintReportMsg: false,
        cache: false,
        generateReport: false,
        modelConfig,
        persistExecutionDump: false,
        screenshotShrinkFactor: 1
    };
}

/** 读取项目默认配置，供启动检查和后续执行链路复用。 */
export function createConfiguredMidsceneAgentOptions(): AgentOpt {
    const visualConfig = config.components.visual_grounding ??
        DEFAULT_MIDSCENE_VISUAL_CONFIG;
    return createMidsceneAgentOptions({
        ...visualConfig,
        api_key: visualConfig.api_key || config.components.llm.api_key
    });
}

/** 为视觉兜底创建绑定现有 Playwright Page 的 Midscene Agent。 */
export function createConfiguredMidsceneVisualAgent(
    page: Page
): PlaywrightAgent {
    return new PlaywrightAgent(
        page,
        createConfiguredMidsceneAgentOptions()
    );
}

function validateMidsceneVisualConfig(
    visualConfig: IVisualGroundingComponentConf
): void {
    if (!visualConfig.enabled) {
        throw new Error('Midscene 视觉定位当前未启用。');
    }
    if (visualConfig.provider !== 'midscene') {
        throw new Error(`不支持的视觉定位 Provider：${ visualConfig.provider }`);
    }
    if (
        !visualConfig.base_url.startsWith('codex://') &&
        !/^https:\/\//u.test(visualConfig.base_url)
    ) {
        throw new Error('Midscene 视觉模型地址必须使用 HTTPS 或 Codex App Server。');
    }
    if (!visualConfig.model.trim()) {
        throw new Error('Midscene 视觉模型名称不能为空。');
    }
    if (
        visualConfig.model_family !== 'gpt-5' &&
        visualConfig.model_family !== 'deepseek'
    ) {
        throw new Error('Midscene 视觉模型 family 当前只支持 gpt-5 或 deepseek。');
    }
    if (
        !visualConfig.base_url.startsWith('codex://') &&
        !visualConfig.api_key?.trim()
    ) {
        throw new Error('Midscene HTTP 视觉模型必须配置 API Key。');
    }
    if (
        !Number.isFinite(visualConfig.timeout_ms) ||
        visualConfig.timeout_ms <= 0
    ) {
        throw new Error('Midscene 视觉模型超时必须是正数。');
    }
}
