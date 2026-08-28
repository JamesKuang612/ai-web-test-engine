import type {
    ObservedElement,
} from '@ai-web-test-engine/core';

export const VISUAL_CANDIDATE_OVERLAY_ID =
    'ai-web-test-visual-candidate-overlay';

interface VisualCandidateBox {
    candidateId: string;
    height: number;
    width: number;
    x: number;
    y: number;
}

/** 只把当前视口内可执行候选转换为视觉模型可识别的编号框。 */
export function toVisualCandidateBoxes(
    elements: ObservedElement[]
): VisualCandidateBox[] {
    return elements.flatMap((element) => {
        const box = element.boundingBox;
        if (
            !element.visible || !element.inViewport || element.disabled ||
            !box || box.width <= 0 || box.height <= 0 ||
            ![ box.x, box.y, box.width, box.height ].every(Number.isFinite)
        ) {
            return [];
        }
        return [{
            candidateId: element.candidateId,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
        }];
    });
}

/** 生成一次性覆盖层脚本；覆盖层不拦截鼠标，也不改变页面布局。 */
export function createVisualCandidateOverlayScript(
    boxes: VisualCandidateBox[]
): string {
    const input = JSON.stringify({
        boxes,
        overlayId: VISUAL_CANDIDATE_OVERLAY_ID
    });
    return String.raw`(() => {
        const input = ${ input };
        document.getElementById(input.overlayId)?.remove();
        const root = document.createElement('div');
        root.id = input.overlayId;
        root.setAttribute('aria-hidden', 'true');
        Object.assign(root.style, {
            position: 'fixed',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '2147483647'
        });
        for (const box of input.boxes) {
            const frame = document.createElement('div');
            Object.assign(frame.style, {
                position: 'fixed',
                left: Math.max(0, box.x) + 'px',
                top: Math.max(0, box.y) + 'px',
                width: Math.max(1, box.width) + 'px',
                height: Math.max(1, box.height) + 'px',
                border: '2px solid #ff2d55',
                boxSizing: 'border-box',
                background: 'rgba(255, 45, 85, 0.04)'
            });
            const label = document.createElement('span');
            label.textContent = box.candidateId;
            Object.assign(label.style, {
                position: 'absolute',
                left: '0',
                top: '0',
                transform: 'translateY(-100%)',
                padding: '1px 4px',
                borderRadius: '2px',
                background: '#ff2d55',
                color: '#fff',
                font: 'bold 12px/16px monospace',
                whiteSpace: 'nowrap'
            });
            frame.appendChild(label);
            root.appendChild(frame);
        }
        document.documentElement.appendChild(root);
    })()`;
}

/** 无论视觉调用成功与否，都删除临时候选框。 */
export const REMOVE_VISUAL_CANDIDATE_OVERLAY_SCRIPT = String.raw`(() => {
    document.getElementById(${ JSON.stringify(
        VISUAL_CANDIDATE_OVERLAY_ID
    ) })?.remove();
})()`;
