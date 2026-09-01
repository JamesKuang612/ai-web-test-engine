import type {
    RecoveryAction,
    SemanticTarget,
} from '../contracts';

export interface RecoveryTargetQualityDecision {
    allowed: boolean;
    reason: string;
}

const GENERIC_TARGET_PATTERN = /^(?:button|link|textbox|element|icon|input|div|span|按钮|链接|输入框|元素|页面元素|图标)$/iu;
const GENERIC_WRAPPER_PREFIX = new RegExp(
    '^(?:(?:页面(?:上|中|内)?(?:的|这个|该)?|某个|某一|一个|这个|那个|该|' +
    '当前页面(?:的)?)\\s*)+',
    'iu'
);
const GENERIC_ROLE_TOKEN =
    /(?:button|link|textbox|element|icon|input|div|span|按钮|链接|输入框|元素|图标|卡片)/giu;

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
    if (description.length < 2 || GENERIC_TARGET_PATTERN.test(description)) {
        return false;
    }
    const semanticCore = description
        .replace(GENERIC_WRAPPER_PREFIX, '')
        .replace(GENERIC_ROLE_TOKEN, '')
        .replace(/(?:的|这个|该|某个|一个)/gu, '')
        .trim();
    return semanticCore.length > 0;
}
