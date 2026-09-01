import type {
    ActionCommand,
    CompilationContribution,
} from '../contracts';

export interface CompilationContributionRecord {
    command: Pick<ActionCommand, 'type'>;
    compilationContribution?: CompilationContribution;
    adjudicationStatus?: 'completed';
}

/** Runtime progress 与编译生产性分离；BACK 无条件保持 Trace-only。 */
export function selectProductiveActions<
    T extends CompilationContributionRecord
>(actions: T[]): T[] {
    return actions.filter((action) => (
        action.adjudicationStatus === 'completed'
        &&
        action.compilationContribution === 'productive'
        && action.command.type !== 'BACK'
    ));
}
