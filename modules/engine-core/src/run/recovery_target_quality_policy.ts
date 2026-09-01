import type {
    RecoveryAction,
    SemanticTarget,
} from '../contracts';

export interface RecoveryTargetQualityDecision {
    allowed: boolean;
    reason: string;
}

const GENERIC_TARGET_PATTERN = /^(?:button|link|textbox|element|icon|input|div|span|按钮|链接|输入框|元素|页面元素|图标)$/iu;

/** Recovery proposal 必须描述具体语义目标，role/tag 本身不是身份。 */
export class RecoveryTargetQualityPolicy {
    public evaluate(action: RecoveryAction): RecoveryTargetQualityDecision {
        if (!('target' in action)) {
            return { allowed: true, reason: '该 RecoveryAction 不需要目标。' };
        }
        return isSpecificRecoveryTarget(action.target)
            ? { allowed: true, reason: 'RecoveryTarget 具有具体语义身份。' }
            : {
                allowed: false,
                reason: 'RecoveryTarget 只有泛化 role/tag，无法形成安全定位。'
            };
    }
}

export function isSpecificRecoveryTarget(target: SemanticTarget): boolean {
    const description = target.description.trim().replace(/\s+/gu, ' ');
    return description.length >= 2 && !GENERIC_TARGET_PATTERN.test(description);
}
