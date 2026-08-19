import type {
    EngineSchemaVersion,
    JsonValue,
} from './common';

export type RunEventType =
    | 'action.completed'
    | 'action.failed'
    | 'action.planned'
    | 'action.started'
    | 'browser.frame.updated'
    | 'browser.started'
    | 'effect.verified'
    | 'observation.created'
    | 'plan.compilation.completed'
    | 'plan.compilation.started'
    | 'replay.validation.completed'
    | 'run.cancelled'
    | 'run.completed'
    | 'run.crashed'
    | 'run.created'
    | 'run.status.changed'
    | 'target.resolved'
    | 'trace.appended'
    | 'verdict.completed';

/** 通过 SSE 推送给本地编辑器的追加式运行事件。 */
export interface RunEvent {
    schemaVersion: EngineSchemaVersion;
    eventId: string;
    runId: string;
    type: RunEventType;
    sequence: number;
    timestamp: string;
    payload: Record<string, JsonValue>;
}
