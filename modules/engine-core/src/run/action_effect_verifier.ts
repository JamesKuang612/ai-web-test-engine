import type {
    ActionCommand,
    ActionResult,
    EffectVerification,
    EvidenceRef,
    PageObservation,
} from '../contracts';

export interface ActionEffectVerificationInput {
    command: ActionCommand;
    result: ActionResult;
    before?: PageObservation;
    after: PageObservation;
    evidence: EvidenceRef[];
}

/** 只验证一次物理动作的局部可观察效果，不判断业务 Step 是否完成。 */
export class ActionEffectVerifier {
    public verify(input: ActionEffectVerificationInput): EffectVerification {
        const { command } = input;
        if (command.type === 'TYPE') {
            return this.verifyType(input);
        }
        if (command.type === 'SELECT') {
            return this.verifySelect(input);
        }
        if (command.type === 'CHECK') {
            return this.verifyCheck(input);
        }
        if (command.type === 'WAIT') {
            return this.verifyWait(input);
        }
        return this.verifyGeneric(input);
    }

    private verifyGeneric(
        input: ActionEffectVerificationInput
    ): EffectVerification {
        const unexpectedNavigation = input.command.type === 'CLICK'
            && input.result.browserSignals.urlChanged
            && !isNavigationExpected(input.command);
        const changed = input.before?.stateFingerprint !==
            input.after.stateFingerprint;
        const confirmed = input.result.status === 'executed'
            && changed
            && !input.after.page.loading
            && !unexpectedNavigation;
        return {
            status: input.result.status !== 'executed'
                ? 'contradicted'
                : confirmed ? 'confirmed' : 'not-observed',
            expectedEffect: input.command.expectedEffect ??
                '页面状态发生预期变化',
            evidence: input.evidence,
            summary: unexpectedNavigation
                ? '点击意外改变了页面地址，与规划的非导航效果不一致。'
                : confirmed
                    ? input.command.type === 'HOVER'
                        ? '鼠标悬浮后页面出现了可观察变化。'
                        : '页面状态在动作执行后发生了变化。'
                    : input.result.status === 'executed' &&
                        input.after.page.loading
                        ? '动作已执行，但页面仍未完成可见内容渲染。'
                        : input.result.status === 'executed'
                            ? '动作已执行，但页面观察未发现状态变化。'
                            : '浏览器没有成功执行页面动作。'
        };
    }

    private verifyType(
        input: ActionEffectVerificationInput
    ): EffectVerification {
        const value = input.command.value?.source === 'literal'
            ? input.command.value.value
            : undefined;
        const state = findTargetValueState(input);
        const clearing = value === '';
        const confirmed = input.result.status === 'executed' && (
            clearing
                ? state === 'empty'
                : state === 'filled' || state === 'masked'
        );
        return resultEffect(
            input,
            confirmed,
            input.command.expectedEffect ?? (
                clearing ? '目标输入框被清空' : '目标输入框变为已填写'
            ),
            confirmed
                ? clearing
                    ? '目标输入框已显示为空。'
                    : '目标输入框已显示为填写状态。'
                : '输入动作后没有确认目标输入框的值状态。'
        );
    }

    private verifySelect(
        input: ActionEffectVerificationInput
    ): EffectVerification {
        const confirmed = input.result.status === 'executed' &&
            findTargetValueState(input) === 'filled';
        return resultEffect(
            input,
            confirmed,
            input.command.expectedEffect ?? '目标下拉框完成选择',
            confirmed
                ? '目标下拉框已显示为选中状态。'
                : '选择动作后没有确认目标下拉框的选中状态。'
        );
    }

    private verifyCheck(
        input: ActionEffectVerificationInput
    ): EffectVerification {
        const expected = input.command.value?.source === 'literal'
            ? input.command.value.value
            : undefined;
        const checked = input.after.interactiveElements.find(
            (element) => element.candidateId ===
                input.command.target?.candidateId
        )?.checked;
        const confirmed = input.result.status === 'executed'
            && typeof expected === 'boolean'
            && checked === expected;
        return resultEffect(
            input,
            confirmed,
            input.command.expectedEffect ?? '目标复选框状态正确',
            confirmed
                ? `目标复选框已${ expected ? '勾选' : '取消勾选' }。`
                : '操作后没有确认目标复选框的勾选状态。'
        );
    }

    private verifyWait(
        input: ActionEffectVerificationInput
    ): EffectVerification {
        const confirmed = input.result.status === 'executed';
        return {
            status: confirmed ? 'confirmed' : 'contradicted',
            expectedEffect: input.command.expectedEffect ?? '等待异步页面内容',
            evidence: input.evidence,
            summary: confirmed
                ? '等待动作已经完成。'
                : '浏览器没有成功完成等待动作。'
        };
    }
}

function findTargetValueState(input: ActionEffectVerificationInput) {
    return input.after.interactiveElements.find(
        (element) => element.candidateId === input.command.target?.candidateId
    )?.valueState;
}

function resultEffect(
    input: ActionEffectVerificationInput,
    confirmed: boolean,
    expectedEffect: string,
    summary: string
): EffectVerification {
    return {
        status: input.result.status !== 'executed'
            ? 'contradicted'
            : confirmed ? 'confirmed' : 'not-observed',
        expectedEffect,
        evidence: input.evidence,
        summary
    };
}

function isNavigationExpected(command: ActionCommand): boolean {
    return /跳转|页面进入|进入.+页面|进入(?:工作台|应用)(?=$|[\s，。；,]|并|后)|导航|打开.+页面|打开(?:工作台|应用)(?=$|[\s，。；,]|并|后)|返回(?:.+页面|工作台|首页|上一页)|登录(?:成功)?(?:后|进入|跳转|完成)|URL|地址/iu.test([
        command.expectedEffect ?? '',
        command.reasonSummary
    ].join(' '));
}

