import type {
    NextFunction,
    Request,
    Response,
} from 'express';
import { controller } from 'nstarter-core';
import { runDebugService } from '../services';
import {
    RunDebugInputError,
    RunDebugService,
} from '../services/run_debug.service';

/** 暴露自然语言到本地 Run 产物的阶段性完整调试接口。 */
@controller()
export class RunDebugController {
    /** 默认使用真实运行服务，测试可以注入不会访问外部能力的替身。 */
    constructor(
        private readonly service: Pick<RunDebugService, 'run'> =
            runDebugService
    ) {}

    /** 接收自然语言 action，并等待地基闭环执行完成后返回结果。 */
    public run = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        const action = typeof req.body?.action === 'string'
            ? req.body.action
            : '';
        const abortController = new AbortController();
        const abortRequest = () => abortController.abort();
        req.once('aborted', abortRequest);

        try {
            const result = await this.service.run(
                action,
                abortController.signal,
                {
                    mode: req.body?.mode,
                    planRef: req.body?.planRef,
                    setupModules: req.body?.setupModules,
                    startUrl: req.body?.startUrl,
                    testId: req.body?.testId,
                    testName: req.body?.testName
                }
            );
            res.json({
                result
            });
        } catch (error) {
            if (error instanceof RunDebugInputError) {
                res.status(400).json({
                    code: 'INVALID_RUN_DEBUG_INPUT',
                    error: error.message
                });
                return;
            }
            next(error);
        } finally {
            req.off('aborted', abortRequest);
        }
    };
}
