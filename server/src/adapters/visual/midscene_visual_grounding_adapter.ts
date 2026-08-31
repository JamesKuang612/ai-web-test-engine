import { randomUUID } from 'node:crypto';

import type {
    PagePerception,
    SemanticTarget,
    VisualGroundingPort,
    VisualGroundingResult,
} from '@ai-web-test-engine/core';

import type {
    PlaywrightPageProvider,
} from '../browser';
import {
    createConfiguredMidsceneVisualAgent,
} from './midscene_visual_agent';

/** 配置关闭视觉时保持同一 Grounder 组合结构。 */
export class DisabledVisualGroundingAdapter implements VisualGroundingPort {
    public locate: VisualGroundingPort['locate'] = () => Promise.resolve({
        modelCalls: 0,
        status: 'unsupported',
        regions: [],
        summary: '当前环境已关闭视觉定位。'
    });
}

/** 使用 Midscene aiLocate 发现目标区域，但不让 Midscene 执行鼠标动作。 */
export class MidsceneVisualGroundingAdapter implements VisualGroundingPort {
    constructor(private readonly pageProvider: PlaywrightPageProvider) {}

    public locate: VisualGroundingPort['locate'] = async (
        session,
        target,
        perception,
        signal
    ): Promise<VisualGroundingResult> => {
        signal.throwIfAborted();
        if (!this.pageProvider.isObservationCurrent(
            session,
            perception.dom.observationId
        )) {
            return {
                modelCalls: 0,
                status: 'not-found',
                regions: [],
                summary: '页面 observation 已过期，拒绝使用视觉结果。'
            };
        }
        const agent = createConfiguredMidsceneVisualAgent(
            this.pageProvider.getPage(session)
        );
        try {
            const located = await waitForVisualResult(
                agent.aiLocate(buildVisualLocatePrompt(target, perception)),
                signal
            );
            signal.throwIfAborted();
            const rect = located.rect;
            if (
                !rect ||
                !isValidNumber(rect.left) ||
                !isValidNumber(rect.top) ||
                !isValidNumber(rect.width) ||
                !isValidNumber(rect.height) ||
                rect.width <= 0 || rect.height <= 0
            ) {
                return {
                    modelCalls: 1,
                    status: 'not-found',
                    regions: [],
                    summary: `视觉模型没有找到“${ target.description }”。`
                };
            }
            return {
                modelCalls: 1,
                status: 'located',
                regions: [{
                    id: `visual-${ randomUUID() }`,
                    boundingBox: {
                        height: rect.height,
                        width: rect.width,
                        x: rect.left,
                        y: rect.top
                    },
                    context: target.scope ? [ target.scope ] : [],
                    description: target.description
                }],
                summary: `视觉模型发现了“${ target.description }”的页面区域。`
            };
        } catch (error) {
            signal.throwIfAborted();
            return {
                modelCalls: 1,
                status: 'not-found',
                regions: [],
                summary: `视觉定位失败：${
                    error instanceof Error ? error.message : '未知错误'
                }`
            };
        } finally {
            await agent.destroy();
        }
    };
}

/** relation 在 Phase 2 仍不进入视觉 Prompt。 */
export function buildVisualLocatePrompt(
    target: SemanticTarget,
    perception: PagePerception
): string {
    return [
        `请只定位当前页面中的目标：${ target.description }。`,
        target.scope ? `业务范围：${ target.scope }。` : '',
        `当前页面标题：${ perception.dom.page.title }。`,
        '只返回目标区域，不要点击、悬浮、滚动或改变页面。'
    ].filter(Boolean).join('\n');
}

function isValidNumber(value: number): boolean {
    return Number.isFinite(value);
}

/** 主动终止只结束等待；Midscene 后台结果仍由 Promise 安全消费。 */
async function waitForVisualResult<T>(
    task: Promise<T>,
    signal: AbortSignal
): Promise<T> {
    signal.throwIfAborted();
    return await new Promise<T>((resolve, reject) => {
        const cleanup = (): void => signal.removeEventListener(
            'abort',
            onAbort
        );
        const onAbort = (): void => {
            cleanup();
            reject(signal.reason ?? new Error('视觉定位已终止。'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        task.then(
            (result) => {
                cleanup();
                resolve(result);
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            }
        );
    });
}
