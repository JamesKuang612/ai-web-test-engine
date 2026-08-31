import type {
    AccessibilityNode,
    SemanticTarget,
} from '../contracts';

/** 从 bounded A11y 表示中找出语义与 scope 一致的节点。 */
export class AccessibilityTargetGrounder {
    public findMatches(
        target: SemanticTarget,
        nodes: AccessibilityNode[]
    ): AccessibilityNode[] {
        return nodes.filter((node) => {
            const primary = [ node.name, node.description ]
                .some((value) => matches(target.description, value));
            if (!primary) {
                return false;
            }
            if (!target.scope) {
                return true;
            }
            return [
                node.name,
                node.description,
                ...node.ancestors.flatMap(({ name, role }) => [ name, role ])
            ].some((value) => matches(target.scope!, value));
        });
    }

    /** 只返回主语义完全相同的节点，用于检测跨模态强冲突。 */
    public findExactMatches(
        target: SemanticTarget,
        nodes: AccessibilityNode[]
    ): AccessibilityNode[] {
        return this.findMatches(target, nodes).filter((node) =>
            [ node.name, node.description ].some((value) =>
                normalize(target.description) === normalize(value)
            )
        );
    }
}

function matches(expected: string, actual: string | undefined): boolean {
    const left = normalize(expected);
    const right = normalize(actual);
    if (!left || !right) {
        return false;
    }
    return left === right ||
        Math.min(left.length, right.length) >= 2 &&
        (left.includes(right) || right.includes(left));
}

function normalize(value: string | undefined): string {
    return value
        ?.normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .trim() ?? '';
}
