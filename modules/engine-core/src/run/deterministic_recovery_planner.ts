import type {
    RecoveryDecision,
    RecoveryPlannerInput,
} from '../contracts';
import type {
    RecoveryPlannerPort,
} from './recovery_ports';
import {
    isSpecificRecoveryTarget,
} from './recovery_target_quality_policy';

/** 只提出当前感知能够明确证明安全且通用的 transient 恢复。 */
export class DeterministicRecoveryPlanner implements RecoveryPlannerPort {
    public async plan(
        input: RecoveryPlannerInput
    ): Promise<RecoveryDecision> {
        if (input.view.page.loading) {
            return recover({
                type: 'WAIT',
                duration: 'short',
                reasonSummary: '页面仍在加载，短暂等待后重新观察'
            });
        }
        if (
            input.failure.progress?.status === 'unknown'
            && input.recentAttempts.length === 0
        ) {
            return recover({
                type: 'REOBSERVE',
                reasonSummary: '原始动作已经执行但效果未确定，先重新观察再判定'
            });
        }
        const filledSearch = input.view.elements.filter((element) => (
            element.visible
            && element.valueState === 'filled'
            && isSearchOrFilter(element)
            && !matchesPrimaryTarget(element, input)
        ));
        if (filledSearch.length === 1) {
            const target = recoveryTarget(filledSearch[0]);
            if (target) {
                return recover({
                    type: 'CLEAR',
                    target,
                    reasonSummary: '清除当前唯一生效的搜索或筛选条件'
                });
            }
        }
        if (
            input.failure.grounding?.status === 'not-found'
            && input.step.primaryAction.target?.scope
        ) {
            const scope = input.step.primaryAction.target.scope;
            const scopeMatches = input.view.elements.filter((element) => (
                element.visible && elementText(element).includes(scope)
            ));
            if (scopeMatches.length === 1) {
                const target = recoveryTarget(scopeMatches[0]);
                if (target) {
                    return recover({
                        type: 'HOVER',
                        target,
                        reasonSummary: '悬浮原始目标所属区域以暴露隐藏控件'
                    });
                }
            }
        }
        if (input.failure.grounding?.status === 'not-visible') {
            return recover({
                type: 'SCROLL',
                direction: 'down',
                amount: 'medium',
                reasonSummary: '小范围滚动以寻找当前不可见的原始目标'
            });
        }
        if (
            input.failure.grounding?.status === 'blocked'
            || input.view.overlayState === 'blocked'
        ) {
            const dismiss = input.view.elements.filter((element) => (
                element.visible && isDismissElement(element)
            ));
            if (dismiss.length === 1) {
                const target = recoveryTarget(dismiss[0]);
                if (target) {
                    return recover({
                        type: 'CLICK',
                        target,
                        reasonSummary: '关闭当前阻挡操作的临时浮层'
                    });
                }
            }
        }
        return {
            kind: 'stop',
            reason: '当前感知中没有明确、安全且通用的确定性恢复动作。'
        };
    }
}

function recover(action: Extract<RecoveryDecision, {kind: 'recover'}>['action']):
RecoveryDecision {
    return { kind: 'recover', action };
}

function isSearchOrFilter(element: RecoveryPlannerInput['view']['elements'][number]) {
    return /搜索|筛选|过滤|search|filter/iu.test(elementText(element));
}

function isDismissElement(element: RecoveryPlannerInput['view']['elements'][number]) {
    return /关闭|取消|收起|dismiss|cancel|close/iu.test(elementText(element));
}

function matchesPrimaryTarget(
    element: RecoveryPlannerInput['view']['elements'][number],
    input: RecoveryPlannerInput
): boolean {
    const description = input.step.primaryAction.target?.description;
    return Boolean(description && elementText(element).includes(description));
}

function recoveryTarget(
    element: RecoveryPlannerInput['view']['elements'][number]
): {description: string} | undefined {
    const description = [
        element.name,
        element.label,
        element.placeholder,
        element.text,
        element.visualDescription
    ].find((value) => value && isSpecificRecoveryTarget({
        description: value
    }));
    return description ? { description } : undefined;
}

function elementText(
    element: RecoveryPlannerInput['view']['elements'][number]
): string {
    return [
        element.role,
        element.name,
        element.text,
        element.label,
        element.placeholder,
        element.visualDescription,
        ...element.nearbyText
    ].filter(Boolean).join(' ');
}
