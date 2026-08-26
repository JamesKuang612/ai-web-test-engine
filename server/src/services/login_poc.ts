import type {
    BuildIntentInput,
    RunMode,
    StartRunInput,
} from '@ai-web-test-engine/core';
import {
    createDebugTestBuildInput,
    createDebugTestStartInput,
    DEFAULT_TEST_START_URL,
} from './debug_test_context';

/** 创建意图预览和完整调试运行共同使用的登录 POC 上下文。 */
export function createLoginPocBuildInput(
    action: string
): BuildIntentInput {
    return createDebugTestBuildInput({
        action,
        id: 'debug-login-foundation-run',
        name: '简道云登录地基验证',
        startUrl: DEFAULT_TEST_START_URL
    });
}

/** 为登录调试接口补充执行模式和多轮运行预算。 */
export function createLoginPocStartInput(
    action: string,
    mode: RunMode = 'ai-explore',
    planRef?: string
): StartRunInput {
    return createDebugTestStartInput({
        action,
        id: 'debug-login-foundation-run',
        name: '简道云登录地基验证',
        startUrl: DEFAULT_TEST_START_URL
    }, mode, planRef);
}
