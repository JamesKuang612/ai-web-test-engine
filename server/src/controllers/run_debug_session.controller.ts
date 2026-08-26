import type {
    NextFunction,
    Request,
    Response,
} from 'express';
import { controller } from 'nstarter-core';
import {
    artifactPreviewService,
    runDebugSessionService,
} from '../services';
import {
    ArtifactPreviewError,
    ArtifactPreviewService,
} from '../services/artifact_preview.service';
import {
    RunDebugSessionNotFoundError,
    RunDebugSessionService,
    type RunDebugSessionUpdate,
} from '../services/run_debug_session.service';

const SSE_HEARTBEAT_MS = 15_000;

/** 暴露异步运行、实时事件、截图读取和主动终止接口。 */
@controller()
export class RunDebugSessionController {
    constructor(
        private readonly sessions: Pick<
            RunDebugSessionService,
            'cancel' | 'get' | 'start' | 'subscribe'
        > = runDebugSessionService,
        private readonly artifacts: Pick<
            ArtifactPreviewService,
            'readScreenshot'
        > = artifactPreviewService
    ) {}

    public start = (
        req: Request,
        res: Response,
        next: NextFunction
    ): void => {
        try {
            const action = typeof req.body?.action === 'string'
                ? req.body.action
                : '';
            res.status(202).json({
                session: this.sessions.start(action, {
                    mode: req.body?.mode,
                    planRef: req.body?.planRef,
                    startUrl: req.body?.startUrl,
                    testId: req.body?.testId,
                    testName: req.body?.testName
                })
            });
        } catch (error) {
            next(error);
        }
    };

    public status = (
        req: Request,
        res: Response,
        next: NextFunction
    ): void => {
        try {
            res.json({
                session: this.sessions.get(req.params.sessionId)
            });
        } catch (error) {
            this.handleSessionError(error, res, next);
        }
    };

    public cancel = (
        req: Request,
        res: Response,
        next: NextFunction
    ): void => {
        try {
            res.status(202).json({
                session: this.sessions.cancel(req.params.sessionId)
            });
        } catch (error) {
            this.handleSessionError(error, res, next);
        }
    };

    /** 使用标准 SSE 发送已有事件和后续追加事件，终态后主动关闭连接。 */
    public events = (
        req: Request,
        res: Response,
        next: NextFunction
    ): void => {
        try {
            const sessionId = req.params.sessionId;
            this.sessions.get(sessionId);
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();

            let unsubscribe = (): void => undefined;
            let cleaned = false;
            const heartbeat = setInterval(() => {
                res.write(': heartbeat\n\n');
            }, SSE_HEARTBEAT_MS);
            const cleanup = () => {
                if (cleaned) {
                    return;
                }
                cleaned = true;
                clearInterval(heartbeat);
                unsubscribe();
            };
            const send = (update: RunDebugSessionUpdate) => {
                if (cleaned) {
                    return;
                }
                res.write(`data: ${ JSON.stringify(update) }\n\n`);
                if (
                    update.kind === 'session'
                    && isTerminal(update.session.status)
                ) {
                    cleanup();
                    res.end();
                }
            };
            unsubscribe = this.sessions.subscribe(sessionId, send);
            req.once('close', cleanup);

            const snapshot = this.sessions.get(sessionId);
            for (const event of snapshot.events) {
                send({
                    kind: 'run-event',
                    event
                });
            }
            send({
                kind: 'session',
                session: snapshot
            });
        } catch (error) {
            if (!res.headersSent) {
                this.handleSessionError(error, res, next);
                return;
            }
            res.end();
        }
    };

    public screenshot = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const content = await this.artifacts.readScreenshot(req.query.ref);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(content);
        } catch (error) {
            if (error instanceof ArtifactPreviewError) {
                res.status(404).json({
                    code: 'SCREENSHOT_NOT_FOUND',
                    error: error.message
                });
                return;
            }
            next(error);
        }
    };

    private handleSessionError(
        error: unknown,
        res: Response,
        next: NextFunction
    ): void {
        if (error instanceof RunDebugSessionNotFoundError) {
            res.status(404).json({
                code: 'RUN_SESSION_NOT_FOUND',
                error: error.message
            });
            return;
        }
        next(error);
    }
}

function isTerminal(status: string): boolean {
    return status === 'CANCELLED'
        || status === 'COMPLETED'
        || status === 'CRASHED';
}
