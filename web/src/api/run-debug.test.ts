import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type {
    DebugRunSessionUpdate,
} from './run-debug';
import {
    subscribeDebugRunSession,
} from './run-debug';

afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances.length = 0;
});

describe('run debug event subscription', () => {
    it('delivers SSE events and closes after a terminal session', () => {
        vi.stubGlobal('EventSource', FakeEventSource);
        const updates: DebugRunSessionUpdate[] = [];
        subscribeDebugRunSession('session-001', {
            onError: (error) => {
                throw error;
            },
            onUpdate: (update) => updates.push(update)
        });
        const source = FakeEventSource.instances[0];

        expect(source.url).toBe('/api/debug/runs/session-001/events');
        source.emit({
            kind: 'run-event',
            event: {
                schemaVersion: 1,
                eventId: 'event-001',
                runId: 'run-001',
                type: 'observation.created',
                sequence: 1,
                timestamp: '2026-08-26T08:00:00.000Z',
                payload: {
                    screenshotRef: 'run-001/artifacts/screen.png'
                }
            }
        });
        source.emit({
            kind: 'session',
            session: {
                schemaVersion: 1,
                sessionId: 'session-001',
                status: 'CANCELLED',
                createdAt: '2026-08-26T08:00:00.000Z',
                updatedAt: '2026-08-26T08:00:02.000Z',
                events: []
            }
        });

        expect(updates).toHaveLength(2);
        expect(source.close).toHaveBeenCalledOnce();
    });
});

class FakeEventSource {
    public static readonly instances: FakeEventSource[] = [];
    public readonly close = vi.fn();
    public onerror: ((event: Event) => void) | null = null;
    public onmessage: ((event: MessageEvent<string>) => void) | null = null;

    constructor(public readonly url: string) {
        FakeEventSource.instances.push(this);
    }

    public emit(update: DebugRunSessionUpdate): void {
        this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify(update)
        }));
    }
}
