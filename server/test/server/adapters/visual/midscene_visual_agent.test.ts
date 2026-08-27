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
    base_url: 'codex://app-server',
    model: 'gpt-5.6-terra',
    model_family: 'gpt-5',
    reasoning_enabled: false,
    timeout_ms: 120_000
};

describe('MidsceneVisualAgent', () => {
    it('生成使用 Codex App Server 与 Terra 的隔离模型配置', () => {
        const options = createMidsceneAgentOptions(visualConfig);

        assert.deepEqual(options.modelConfig, {
            MIDSCENE_MODEL_BASE_URL: 'codex://app-server',
            MIDSCENE_MODEL_FAMILY: 'gpt-5',
            MIDSCENE_MODEL_NAME: 'gpt-5.6-terra',
            MIDSCENE_MODEL_REASONING_ENABLED: 'false',
            MIDSCENE_MODEL_TIMEOUT: 120_000
        });
        assert.equal(options.cache, false);
        assert.equal(options.generateReport, false);
        assert.equal(options.persistExecutionDump, false);
        assert.equal(options.screenshotShrinkFactor, 1);
    });

    it('拒绝绕开 Codex App Server 的视觉模型地址', () => {
        assert.throws(
            () => createMidsceneAgentOptions({
                ...visualConfig,
                base_url: 'https://example.com/v1'
            }),
            /必须通过 Codex App Server/u
        );
    });

    it('仓库默认配置已指向 Terra 视觉模型', () => {
        const options = createConfiguredMidsceneAgentOptions();

        assert.equal(
            options.modelConfig?.MIDSCENE_MODEL_BASE_URL,
            'codex://app-server'
        );
        assert.equal(
            options.modelConfig?.MIDSCENE_MODEL_NAME,
            'gpt-5.6-terra'
        );
        assert.equal(
            options.modelConfig?.MIDSCENE_MODEL_FAMILY,
            'gpt-5'
        );
    });
});
