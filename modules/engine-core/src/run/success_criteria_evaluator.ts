import type {
    ExactTextAssertion,
    PagePerception,
    TestIntent,
} from '../contracts';

export interface SuccessCriteriaEvaluation {
    status: 'satisfied' | 'incomplete' | 'not-applicable';
    matched: ExactTextAssertion[];
    missing: Array<{
        assertion: ExactTextAssertion,
        values: string[]
    }>;
}

/** 在调用 Planner 前对程序化精确文本条件做确定性判断。 */
export class SuccessCriteriaEvaluator {
    public evaluate(
        testIntent: TestIntent,
        perception: PagePerception
    ): SuccessCriteriaEvaluation {
        const assertions = testIntent.exactTextAssertions ?? [];
        if (assertions.length === 0) {
            return {
                status: 'not-applicable',
                matched: [],
                missing: []
            };
        }
        const matched: ExactTextAssertion[] = [];
        const missing: SuccessCriteriaEvaluation['missing'] = [];
        for (const assertion of assertions) {
            const result = matchExactVisibleText(
                perception.dom.visibleText,
                assertion.values,
                assertion.ordered
            );
            if (result.matched) {
                matched.push(assertion);
            } else {
                missing.push({ assertion, values: result.missing });
            }
        }
        return {
            status: missing.length === 0 ? 'satisfied' : 'incomplete',
            matched,
            missing
        };
    }
}

function matchExactVisibleText(
    visibleText: string[],
    expectedValues: string[],
    ordered: boolean
): { matched: boolean, missing: string[] } {
    const remainingText = [...visibleText];
    const missing = expectedValues.filter((expected) => {
        const index = remainingText.findIndex((actual) => actual === expected);
        if (index < 0) {
            return true;
        }
        remainingText.splice(index, 1);
        return false;
    });
    if (missing.length > 0 || !ordered) {
        return { matched: missing.length === 0, missing };
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
        missing: orderedMatch ? [] : expectedValues
    };
}
