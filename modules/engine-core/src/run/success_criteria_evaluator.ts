import type {
    CriterionAssessment,
    ExactTextAssertion,
    PagePerception,
    TestIntent,
} from '../contracts';
import {
    matchExactVisibleText,
} from '../perception';

export interface SuccessCriteriaEvaluation {
    status: 'satisfied' | 'incomplete' | 'not-applicable';
    failureCriteria: CriterionAssessment[];
    matched: ExactTextAssertion[];
    missing: Array<{
        assertion: ExactTextAssertion,
        values: string[]
    }>;
    successCriteria: CriterionAssessment[];
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
                failureCriteria: testIntent.failureCriteria.map(
                    (criterion) => unknownAssessment(criterion.id)
                ),
                matched: [],
                missing: [],
                successCriteria: testIntent.successCriteria.map(
                    (criterion) => unknownAssessment(criterion.id)
                )
            };
        }
        const matched: ExactTextAssertion[] = [];
        const missing: SuccessCriteriaEvaluation['missing'] = [];
        const matches = new Map<ExactTextAssertion, boolean>();
        for (const assertion of assertions) {
            const result = matchExactVisibleText(
                perception.dom.visibleText,
                assertion.values,
                assertion.ordered
            );
            matches.set(assertion, result.matched);
            if (result.matched) {
                matched.push(assertion);
            } else {
                missing.push({ assertion, values: result.missing });
            }
        }
        const successCriteria = testIntent.successCriteria.map((criterion) => {
            const evidence = assertions.filter(
                ({ successCriterionId }) => successCriterionId === criterion.id
            );
            if (evidence.length === 0) {
                return unknownAssessment(criterion.id);
            }
            return evidence.every((assertion) => matches.get(assertion))
                ? matchedSuccessAssessment(criterion.id)
                : unmatchedSuccessAssessment(criterion.id);
        });
        const failureCriteria = testIntent.failureCriteria.map((criterion) => {
            const evidence = assertions.filter(
                ({ failureCriterionId }) => failureCriterionId === criterion.id
            );
            if (evidence.length === 0) {
                return unknownAssessment(criterion.id);
            }
            return evidence.every((assertion) => matches.get(assertion))
                ? excludedFailureAssessment(criterion.id)
                : matchedFailureAssessment(criterion.id);
        });
        const requiredSuccessCovered = testIntent.successCriteria
            .filter(({ required }) => required)
            .every((criterion) => assertions.some(
                ({ successCriterionId }) => successCriterionId === criterion.id
            ));
        const allFailureCriteriaExcluded = failureCriteria.every(
            ({ status }) => status === 'NOT_MATCHED'
        );
        return {
            status: missing.length === 0
                && requiredSuccessCovered
                && allFailureCriteriaExcluded
                ? 'satisfied'
                : 'incomplete',
            failureCriteria,
            matched,
            missing,
            successCriteria
        };
    }
}

function unknownAssessment(criterionId: string): CriterionAssessment {
    return {
        criterionId,
        status: 'UNKNOWN',
        summary: '当前确定性精确文本证据未覆盖此条件。'
    };
}

function matchedSuccessAssessment(criterionId: string): CriterionAssessment {
    return {
        criterionId,
        status: 'MATCHED',
        summary: '稳定 DOM 页面逐字包含此条件要求的全部精确文本。'
    };
}

function unmatchedSuccessAssessment(criterionId: string): CriterionAssessment {
    return {
        criterionId,
        status: 'NOT_MATCHED',
        summary: '稳定 DOM 页面未逐字满足此条件的精确文本要求。'
    };
}

function excludedFailureAssessment(criterionId: string): CriterionAssessment {
    return {
        criterionId,
        status: 'NOT_MATCHED',
        summary: '稳定 DOM 页面不存在此精确文本不匹配条件。'
    };
}

function matchedFailureAssessment(criterionId: string): CriterionAssessment {
    return {
        criterionId,
        status: 'MATCHED',
        summary: '稳定 DOM 页面存在此精确文本不匹配条件。'
    };
}
