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
    MIDSCENE_MODEL_FAMILY: 'gpt-5';
    MIDSCENE_MODEL_NAME: string;
    MIDSCENE_MODEL_REASONING_ENABLED: 'false' | 'true';
    MIDSCENE_MODEL_TIMEOUT: number;
}

/** 本机旧配置未声明视觉组件时使用的安全默认值。 */
export const DEFAULT_MIDSCENE_VISUAL_CONFIG: IVisualGroundingComponentConf = {
    enabled: true,
    provider: 'midscene',
    base_url: 'codex://app-server',
    model: 'gpt-5.6-terra',
    model_family: 'gpt-5',
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
    return createMidsceneAgentOptions(
        config.components.visual_grounding ?? DEFAULT_MIDSCENE_VISUAL_CONFIG
    );
}

/**
 * 为未来的视觉兜底创建绑定现有 Playwright Page 的 Midscene Agent。
 * 当前执行链路尚未调用此工厂。
 */
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
    if (!visualConfig.base_url.startsWith('codex://')) {
        throw new Error('Midscene 视觉模型必须通过 Codex App Server 调用。');
    }
    if (!visualConfig.model.trim()) {
        throw new Error('Midscene 视觉模型名称不能为空。');
    }
    if (visualConfig.model_family !== 'gpt-5') {
        throw new Error('Terra 视觉模型必须使用 gpt-5 model family。');
    }
    if (
        !Number.isFinite(visualConfig.timeout_ms) ||
        visualConfig.timeout_ms <= 0
    ) {
        throw new Error('Midscene 视觉模型超时必须是正数。');
    }
}
