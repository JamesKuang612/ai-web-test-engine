import type {
    ExactTextAssertion,
    FailureCriterion,
    SuccessCriterion,
} from '../contracts';

export interface ExtractedExactTextAssertions {
    assertions: ExactTextAssertion[];
    failureCriteria: FailureCriterion[];
    successCriteria: SuccessCriterion[];
}

const ASSERTION_LANGUAGE_PATTERN =
    /验证|断言|校验|确认|逐字|精确文本|必须显示|应当显示|应该显示/iu;
const ORDER_LANGUAGE_PATTERN =
    /顺序|依次|从上到下|从左到右/iu;
const QUOTED_TEXT_PATTERN =
    /“([^”\r\n]{1,200})”|"([^"\r\n]{1,200})"|‘([^’\r\n]{1,200})’/gu;

/**
 * 只从带有明确验证语义的分句提取引号文本；点击目标等普通引用不会变成断言。
 */
export function extractExactTextAssertions(
    action: string,
    existingSuccessCriteria: SuccessCriterion[],
    existingFailureCriteria: FailureCriterion[]
): ExtractedExactTextAssertions {
    const usedIds = new Set([
        ...existingSuccessCriteria.map((criterion) => criterion.id),
        ...existingFailureCriteria.map((criterion) => criterion.id)
    ]);
    const groups = action
        .split(/[。！？；;\n]+/u)
        .map((segment) => segment.trim())
        .filter((segment) => ASSERTION_LANGUAGE_PATTERN.test(segment))
        .map((segment) => ({
            ordered: ORDER_LANGUAGE_PATTERN.test(segment),
            values: extractQuotedTexts(segment)
        }))
        .filter((group) => group.values.length > 0);

    const assertions: ExactTextAssertion[] = [];
    const successCriteria: SuccessCriterion[] = [];
    const failureCriteria: FailureCriterion[] = [];

    groups.forEach((group, index) => {
        const successCriterionId = createUniqueId(
            `engine-exact-text-${ index + 1 }`,
            usedIds
        );
        const failureCriterionId = createUniqueId(
            `${ successCriterionId }-mismatch`,
            usedIds
        );
        const quotedValues = group.values
            .map((value) => `“${ value }”`)
            .join('、');
        const orderDescription = group.ordered
            ? '按声明顺序逐字显示'
            : '逐字显示';

        assertions.push({
            successCriterionId,
            failureCriterionId,
            ordered: group.ordered,
            values: group.values
        });
        successCriteria.push({
            id: successCriterionId,
            description: `最终页面必须${ orderDescription }${ quotedValues }。`,
            preferredEvidence: ['dom'],
            required: true
        });
        failureCriteria.push({
            id: failureCriterionId,
            description: `任一精确文本缺失、文字不同${
                group.ordered ? '或顺序不符' : ''
            }。`
        });
    });

    return {
        assertions,
        successCriteria,
        failureCriteria
    };
}

/** 提取同一断言分句中的中英文引号内容，并保持原始顺序和文字。 */
function extractQuotedTexts(segment: string): string[] {
    return [...segment.matchAll(QUOTED_TEXT_PATTERN)]
        .map((match) => match[1] ?? match[2] ?? match[3] ?? '')
        .filter((value) => value.length > 0);
}

/** 避免程序断言 ID 与模型生成条件 ID 碰撞。 */
function createUniqueId(base: string, usedIds: Set<string>): string {
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) {
        candidate = `${ base }-${ suffix }`;
        suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
}
