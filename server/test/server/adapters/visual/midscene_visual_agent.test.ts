import assert from 'node:assert/strict';
import type {
    IVisualGroundingComponentConf,
} from '../../../../src/entities/config';
import {
    createConfiguredMidsceneAgentOptions,
    createMidsceneAgentOptions,
} from '../../../../src/adapters/visual/midscene_visual_agent';

const visualConfig: IVisualGroundingComponentConf = {
    enabled: true,
    provider: 'midscene',
    base_url: 'https://api.deepseek.com',
    api_key: 'test-deepseek-key',
    model: 'deepseek-v4-flash-vision-exp',
    model_family: 'deepseek',
    reasoning_enabled: false,
    timeout_ms: 120_000
};

describe('MidsceneVisualAgent', () => {
    it('生成使用 DeepSeek vision 的隔离模型配置', () => {
        const options = createMidsceneAgentOptions(visualConfig);

        assert.deepEqual(options.modelConfig, {
            MIDSCENE_MODEL_API_KEY: 'test-deepseek-key',
            MIDSCENE_MODEL_BASE_URL: 'https://api.deepseek.com',
            MIDSCENE_MODEL_FAMILY: 'deepseek',
            MIDSCENE_MODEL_NAME: 'deepseek-v4-flash-vision-exp',
            MIDSCENE_MODEL_REASONING_ENABLED: 'false',
            MIDSCENE_MODEL_TIMEOUT: 120_000
        });
        assert.equal(options.cache, false);
        assert.equal(options.generateReport, false);
        assert.equal(options.persistExecutionDump, false);
        assert.equal(options.screenshotShrinkFactor, 1);
    });

    it('拒绝 HTTP 视觉模型缺少 API Key', () => {
        assert.throws(
            () => createMidsceneAgentOptions({
                ...visualConfig,
                api_key: ''
            }),
            /必须配置 API Key/u
        );
    });

    it('仓库默认配置已指向 DeepSeek 视觉模型', () => {
        const options = createConfiguredMidsceneAgentOptions();

        assert.equal(
            options.modelConfig?.MIDSCENE_MODEL_BASE_URL,
            'https://api.deepseek.com'
        );
        assert.equal(
            options.modelConfig?.MIDSCENE_MODEL_NAME,
            'deepseek-v4-flash-vision-exp'
        );
        assert.equal(
            options.modelConfig?.MIDSCENE_MODEL_FAMILY,
            'deepseek'
        );
    });
});
