import type {
    CompiledActionType,
    CompiledTarget,
    ObservedElement,
    PageObservation,
} from '../contracts';

/** 回放页面无法唯一匹配编译目标时抛出的显式错误。 */
export class CompiledTargetResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CompiledTargetResolutionError';
    }
}

/** 用稳定定位提示和语义身份，在新页面观察中重新绑定运行时元素。 */
export class CompiledTargetResolver {
    public resolve(
        target: CompiledTarget,
        observation: PageObservation,
        actionType?: CompiledActionType
    ): ObservedElement {
        const scored = observation.interactiveElements
            .filter((element) => element.visible && (
                actionType === 'HOVER' || !element.disabled
            ))
            .map((element) => ({
                element,
                locatorScore: this.countMatchingHints(target, element),
                semanticScore: this.getSemanticScore(target, element)
            }))
            .filter((candidate) => candidate.locatorScore > 0)
            .sort((left, right) => (
                right.locatorScore - left.locatorScore
                || right.semanticScore - left.semanticScore
            ));

        const best = scored[0];
        if (!best) {
            throw new CompiledTargetResolutionError(
                `当前页面找不到编译目标：${ target.description }`
            );
        }
        const equallyRanked = scored.filter((candidate) => (
            candidate.locatorScore === best.locatorScore
            && candidate.semanticScore === best.semanticScore
        ));
        if (equallyRanked.length !== 1) {
            throw new CompiledTargetResolutionError(
                `当前页面无法唯一定位编译目标：${ target.description }`
            );
        }

        return best.element;
    }

    private countMatchingHints(
        target: CompiledTarget,
        element: ObservedElement
    ): number {
        return target.locatorHints.filter((hint) => (
            element.locatorHints.some((candidateHint) => (
                candidateHint.strategy === hint.strategy
                && candidateHint.value === hint.value
            ))
        )).length;
    }

    private getSemanticScore(
        target: CompiledTarget,
        element: ObservedElement
    ): number {
        const pairs: Array<[string | undefined, string | undefined]> = [
            [ target.identity.tag, element.tag ],
            [ target.identity.role, element.role ],
            [ target.identity.name, element.name ],
            [ target.identity.text, element.text ],
            [ target.identity.label, element.label ],
            [ target.identity.placeholder, element.placeholder ],
            [ target.identity.inputType, element.attributes.type ]
        ];

        return pairs.reduce((score, [ expected, actual ]) => (
            expected && expected === actual
                ? score + 1
                : score
        ), 0);
    }
}
