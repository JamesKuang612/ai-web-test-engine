import type {
    ObservedElement,
} from '@ai-web-test-engine/core';
import type {
    Page,
} from 'playwright';
import {
    createConfiguredMidsceneVisualAgent,
} from './midscene_visual_agent';
import {
    createVisualCandidateOverlayScript,
    REMOVE_VISUAL_CANDIDATE_OVERLAY_SCRIPT,
    toVisualCandidateBoxes,
} from './visual_candidate_overlay_script';

/** Midscene 为一个确定候选框补充的独立视觉语义。 */
export interface VisualCandidateAnnotation {
    candidateId: string;
    confidence?: number;
    elementType?: string;
    visualDescription: string;
}

/** 浏览器适配器依赖的批量视觉标注边界，测试可注入确定性替身。 */
export interface VisualCandidateAnnotator {
    annotate: (
        page: Page,
        candidates: ObservedElement[],
        signal: AbortSignal
    ) => Promise<VisualCandidateAnnotation[]>;
}

interface MidsceneAnnotationResponse {
    annotations: VisualCandidateAnnotation[];
}

/** 使用 Midscene + Terra 一次看图并命名全部候选框。 */
export class MidsceneVisualCandidateAnnotator
implements VisualCandidateAnnotator {
    public annotate = async (
        page: Page,
        candidates: ObservedElement[],
        signal: AbortSignal
    ): Promise<VisualCandidateAnnotation[]> => {
        signal.throwIfAborted();
        const boxes = toVisualCandidateBoxes(candidates);
        if (boxes.length === 0) {
            return [];
        }

        const agent = createConfiguredMidsceneVisualAgent(page);
        try {
            await page.evaluate(
                createVisualCandidateOverlayScript(boxes)
            );
            const raw = await waitForVisualResult(
                agent.aiQuery<MidsceneAnnotationResponse>(
                    buildCandidateAnnotationDemand(boxes.map(
                        ({ candidateId }) => candidateId
                    )),
                    {
                        domIncluded: false,
                        screenshotIncluded: true
                    }
                ),
                signal
            );
            signal.throwIfAborted();
            return parseVisualCandidateAnnotations(
                raw,
                new Set(boxes.map(({ candidateId }) => candidateId))
            );
        } finally {
            await Promise.allSettled([
                agent.destroy(),
                page.evaluate(REMOVE_VISUAL_CANDIDATE_OVERLAY_SCRIPT)
            ]);
        }
    };
}

/** 用显式 ID 列表约束模型输出，避免它创造页面上不存在的目标。 */
export function buildCandidateAnnotationDemand(
    candidateIds: string[]
): Record<string, string> {
    return {
        annotations: [
            '截图中每个粉红色候选框都标有唯一 candidateId。',
            `请逐一识别这些候选：${ candidateIds.join('、') }。`,
            '返回 JSON 数组，每项严格包含 candidateId、visualDescription，',
            '可选包含 elementType 和 0 到 1 的 confidence。',
            'visualDescription 请用简洁中文说明可见外观与最可能的交互用途，',
            '例如“空心五角星图标，可能是收藏按钮”。',
            '必须覆盖每个看得清的候选框；看不清时也保留 candidateId，',
            '并把 visualDescription 写为“无法可靠识别”。',
            '不得返回候选 ID 列表之外的元素。'
        ].join('')
    };
}

/** 只接受已提供的候选 ID，并清理模型可能返回的额外或畸形字段。 */
export function parseVisualCandidateAnnotations(
    value: unknown,
    allowedCandidateIds: ReadonlySet<string>
): VisualCandidateAnnotation[] {
    const records = extractAnnotationRecords(value);
    const seen = new Set<string>();
    return records.flatMap((record) => {
        if (!isRecord(record)) {
            return [];
        }
        const candidateId = normalizeText(record.candidateId, 100);
        const visualDescription = normalizeText(
            record.visualDescription,
            300
        );
        if (
            !candidateId || !visualDescription ||
            !allowedCandidateIds.has(candidateId) || seen.has(candidateId)
        ) {
            return [];
        }
        seen.add(candidateId);
        const elementType = normalizeText(record.elementType, 100);
        const confidence = typeof record.confidence === 'number' &&
            Number.isFinite(record.confidence) &&
            record.confidence >= 0 && record.confidence <= 1
            ? record.confidence
            : undefined;
        return [{
            candidateId,
            visualDescription,
            ...elementType ? { elementType } : {},
            ...confidence === undefined ? {} : { confidence }
        }];
    });
}

function extractAnnotationRecords(value: unknown): unknown[] {
    if (Array.isArray(value)) {
        return value;
    }
    if (isRecord(value) && Array.isArray(value.annotations)) {
        return value.annotations;
    }
    return [];
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized ? normalized.slice(0, maxLength) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
            reject(signal.reason ?? new Error('视觉标注已终止。'));
        };
        const cleanup = (): void => {
            signal.removeEventListener('abort', onAbort);
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
