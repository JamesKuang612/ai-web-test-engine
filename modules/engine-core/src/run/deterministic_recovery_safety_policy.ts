import type {
    RecoverySafetyDecision,
    RecoverySafetyInput,
} from '../contracts';
import type {
    RecoverySafetyPolicy,
} from './recovery_ports';

const FORBIDDEN_SIDE_EFFECT = /删除|发布|支付|付款|发送|提交|保存|创建|授权|权限|delete|publish|pay|send|submit|save|create|permission/iu;

/** Recovery proposal 不能自我授权；这里只允许低风险可逆状态操作。 */
export class DeterministicRecoverySafetyPolicy
implements RecoverySafetyPolicy {
    public evaluate(input: RecoverySafetyInput): RecoverySafetyDecision {
        const action = input.action;
        if (action.type === 'REOBSERVE' || action.type === 'WAIT') {
            return allow('只读取或等待页面状态。');
        }
        if (action.type === 'SCROLL' || action.type === 'HOVER') {
            return allow('只改变可逆的页面展示状态。');
        }
        if (action.type === 'BACK') {
            return input.recoveryCausedNavigation
                ? allow('只撤销 Recovery 自己造成的同源错误导航。')
                : deny('BACK 不能撤销用户原始业务动作。');
        }
        const description = snapshotText(input);
        if (FORBIDDEN_SIDE_EFFECT.test(description)) {
            return deny('恢复目标可能产生超出原始目标的业务副作用。');
        }
        if (action.type === 'CLEAR') {
            const isSearch = /搜索|筛选|过滤|search|filter/iu.test(description);
            const filled = input.resolvedSnapshot?.valueState === 'filled';
            const sensitive = /密码|口令|令牌|token|secret|password/iu.test(
                description
            );
            const primary = sameTarget(input);
            return isSearch && filled && !sensitive && !primary
                ? allow('允许清空非敏感、非主目标的已填写搜索或筛选。')
                : deny('CLEAR 只允许已填写的非敏感搜索/筛选，且不能是主目标。');
        }
        if (action.type === 'CLICK') {
            return /关闭|取消|收起|清除|菜单|标签|dismiss|cancel|close|clear|menu|tab/iu
                .test(description)
                ? allow('点击只改变可逆的临时页面状态。')
                : deny('Recovery CLICK 目标不是已知的低风险临时控件。');
        }
        return deny('Recovery 动作不在允许范围内。');
    }
}

function snapshotText(input: RecoverySafetyInput): string {
    const snapshot = input.resolvedSnapshot;
    const target = 'target' in input.action ? input.action.target : undefined;
    return [
        target?.description,
        target?.scope,
        snapshot?.role,
        snapshot?.name,
        snapshot?.text,
        snapshot?.label,
        snapshot?.placeholder,
        snapshot?.visualDescription,
        ...(snapshot?.nearbyText ?? [])
    ].filter(Boolean).join(' ');
}

function sameTarget(input: RecoverySafetyInput): boolean {
    if (!('target' in input.action)) {
        return false;
    }
    return input.action.target.description ===
        input.step.primaryAction.target?.description;
}

function allow(reason: string): RecoverySafetyDecision {
    return { allowed: true, reason };
}

function deny(reason: string): RecoverySafetyDecision {
    return { allowed: false, reason };
}

