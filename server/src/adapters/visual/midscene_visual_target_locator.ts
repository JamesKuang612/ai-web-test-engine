import type {
    VisualGroundingRequest,
} from '@ai-web-test-engine/core';
import type {
    Page,
} from 'playwright';
import {
    createConfiguredMidsceneVisualAgent,
} from './midscene_visual_agent';

/** Midscene 归一化后交给浏览器适配器的视觉区域。 */
export interface VisualTargetLocation {
    center: [number, number];
    dpr?: number;
    rect?: {
        height: number,
        left: number,
        top: number,
        width: number
    };
}

/** 浏览器适配器依赖的最小视觉定位边界，测试可注入确定性替身。 */
export interface VisualTargetLocator {
    locate: (
        page: Page,
        request: VisualGroundingRequest,
        signal: AbortSignal
    ) => Promise<VisualTargetLocation | undefined>;
}

/** 使用 Midscene + Terra 对当前 Playwright 页面执行定向视觉定位。 */
export class MidsceneVisualTargetLocator implements VisualTargetLocator {
    public locate = async (
        page: Page,
        request: VisualGroundingRequest,
        signal: AbortSignal
    ): Promise<VisualTargetLocation | undefined> => {
        signal.throwIfAborted();
        const agent = createConfiguredMidsceneVisualAgent(page);
        const result = await waitForVisualResult(
            agent.aiLocate(
                this.buildLocatePrompt(request),
                {
                    deepLocate: true
                }
            ),
            signal
        );
        signal.throwIfAborted();

        if (!isFinitePoint(result.center)) {
            return undefined;
        }
        return {
            center: [
                result.center[0],
                result.center[1]
            ],
            ...typeof result.dpr === 'number' && Number.isFinite(result.dpr)
                ? {
                    dpr: result.dpr
                }
                : {},
            ...isFiniteRect(result.rect)
                ? {
                    rect: {
                        left: result.rect.left,
                        top: result.rect.top,
                        width: result.rect.width,
                        height: result.rect.height
                    }
                }
                : {}
        };
    };

    /** 只描述业务目标，不提前臆测控件外观和坐标。 */
    private buildLocatePrompt(request: VisualGroundingRequest): string {
        return [
            '请在当前网页内容中定位一个最符合以下业务语义的可交互控件：',
            request.targetDescription,
            ...request.expectedEffect
                ? [ `操作后的期望效果：${ request.expectedEffect }` ]
                : [],
            '只定位网页内容中的控件，不要选择浏览器工具栏或浏览器后退按钮。'
        ].join('\n');
    }
}

function isFinitePoint(value: unknown): value is [number, number] {
    return Array.isArray(value) &&
        value.length === 2 &&
        value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isFiniteRect(value: unknown): value is {
    height: number,
    left: number,
    top: number,
    width: number
} {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const rect = value as Record<string, unknown>;
    return [
        rect.left,
        rect.top,
        rect.width,
        rect.height
    ].every((item) => typeof item === 'number' && Number.isFinite(item));
}

/** 让主动终止立即结束视觉等待；后台模型结果会被安全消费。 */
async function waitForVisualResult<T>(
    task: Promise<T>,
    signal: AbortSignal
): Promise<T> {
    signal.throwIfAborted();
    return await new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
            cleanup();
            reject(signal.reason ?? new Error('视觉定位已终止。'));
        };
        const cleanup = (): void => {
            signal.removeEventListener('abort', onAbort);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        task.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            }
        );
    });
}
