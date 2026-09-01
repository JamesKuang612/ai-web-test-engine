/** 精确文本匹配的确定性结果。 */
export interface ExactVisibleTextMatch {
    matched: boolean;
    missing: string[];
}

/**
 * 按 DOM 可见文本逐项完全相等匹配；ordered 模式额外要求出现顺序一致。
 */
export function matchExactVisibleText(
    visibleText: string[],
    expectedValues: string[],
    ordered: boolean
): ExactVisibleTextMatch {
    const remainingText = [...visibleText];
    const missing = expectedValues.filter((expected) => {
        const index = remainingText.findIndex((actual) => actual === expected);
        if (index < 0) {
            return true;
        }
        remainingText.splice(index, 1);
        return false;
    });
    if (missing.length > 0) {
        return {
            matched: false,
            missing
        };
    }
    if (!ordered) {
        return {
            matched: true,
            missing: []
        };
    }

    let cursor = 0;
    const orderedMatch = expectedValues.every((expected) => {
        const relativeIndex = visibleText
            .slice(cursor)
            .findIndex((actual) => actual === expected);
        if (relativeIndex < 0) {
            return false;
        }
        cursor += relativeIndex + 1;
        return true;
    });
    return {
        matched: orderedMatch,
        missing: []
    };
}
