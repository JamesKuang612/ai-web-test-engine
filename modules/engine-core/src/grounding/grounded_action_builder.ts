import type {
    ActionCommand,
    ResolvedTarget,
    SemanticAction,
} from '../contracts';

/** Grounding 成功后交给现有 Browser/Trace 链路的兼容执行对象。 */
export interface GroundedAction {
    command: ActionCommand;
    resolvedTarget?: ResolvedTarget;
    semanticAction: SemanticAction;
}

/** 把语义动作转换成短期兼容的物理 ActionCommand。 */
export class GroundedActionBuilder {
    public build(
        semanticAction: SemanticAction,
        resolvedTarget?: ResolvedTarget
    ): GroundedAction {
        if (semanticAction.target && !resolvedTarget) {
            throw new Error('带目标的语义动作必须先完成 Grounding。');
        }
        const command: ActionCommand = {
            type: semanticAction.type,
            ...semanticAction.target && resolvedTarget
                ? {
                    target: {
                        candidateId: resolvedTarget.candidateId,
                        description: semanticAction.target.description
                    }
                }
                : {},
            ...semanticAction.value
                ? { value: structuredClone(semanticAction.value) }
                : {},
            ...semanticAction.expectedEffect
                ? { expectedEffect: semanticAction.expectedEffect }
                : {},
            reasonSummary: semanticAction.reasonSummary,
            // 仅为旧 Trace/CompiledPlan 提供兼容元数据，不参与执行授权。
            risk: inferCompatibilityRisk(semanticAction)
        };
        return {
            command,
            ...resolvedTarget ? { resolvedTarget } : {},
            semanticAction: structuredClone(semanticAction)
        };
    }

    /** 将 Setup/Replay 的旧命令压缩为不包含 candidateId/risk 的语义历史。 */
    public fromLegacyCommand(command: ActionCommand): SemanticAction {
        return {
            type: command.type,
            ...command.target
                ? {
                    target: {
                        description: command.target.description
                    }
                }
                : {},
            ...command.value ? { value: structuredClone(command.value) } : {},
            ...command.expectedEffect
                ? { expectedEffect: command.expectedEffect }
                : {},
            reasonSummary: command.reasonSummary
        };
    }
}

function inferCompatibilityRisk(
    action: SemanticAction
): ActionCommand['risk'] {
    if (action.type === 'CLICK') {
        return 'side-effect';
    }
    if (
        action.type === 'CHECK'
        || action.type === 'SELECT'
        || action.type === 'TYPE'
    ) {
        return 'reversible';
    }
    return 'read-only';
}
