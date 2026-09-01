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

const TEXT_ASSERTION_ANCHOR_PATTERN = new RegExp([
    '(?:必须显示|应当显示|应该显示)',
    '(?:(?:验证|断言|校验|确认|逐字|精确文本)' +
        '[^。！？；;\\n]{0,80}?(?:显示|出现|文本|文案|内容|提示))'
].join('|'), 'giu');
const NEXT_ACTION_BOUNDARY_PATTERN =
    /[，,](?=\s*(?:如果|若|否则|然后|随后|再|完成后|搜索|输入|填写|点击|选择|创建|打开))/iu;
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
        .flatMap(extractAssertionGroups)
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

/** 只关联明确文本验证锚点之后的引号，并在下一业务动作前结束 scope。 */
function extractAssertionGroups(segment: string): Array<{
    ordered: boolean,
    values: string[]
}> {
    const anchors = [ ...segment.matchAll(TEXT_ASSERTION_ANCHOR_PATTERN) ];
    return anchors.map((anchor, index) => {
        const start = anchor.index;
        const nextAnchor = anchors[index + 1]?.index ?? segment.length;
        const candidate = segment.slice(start, nextAnchor);
        const actionBoundary = candidate.search(NEXT_ACTION_BOUNDARY_PATTERN);
        const assertionClause = actionBoundary >= 0
            ? candidate.slice(0, actionBoundary)
            : candidate;
        return {
            ordered: ORDER_LANGUAGE_PATTERN.test([
                segment.slice(0, start),
                assertionClause
            ].join(' ')),
            values: extractQuotedTexts(assertionClause)
        };
    });
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
