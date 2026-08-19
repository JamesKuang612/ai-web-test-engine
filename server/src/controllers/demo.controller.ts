import { ContextProvider, controller } from 'nstarter-core';
import type { Request, Response } from 'express';
import { Errors } from '../errors';
import {
    pingService,
} from '../services';

@controller()
export class DemoController {
    /**
     * 主页渲染 & 国际化示例
     * @param req
     * @param res
     */
    public async goWelcomeView(req: Request, res: Response) {
        // const { params } = req;
        return res.render('welcome', {
            title: 'To Infinity and Beyond!'
        });
    };

    /**
     * 错误页面示例
     * @param req
     * @param res
     */
    public async goErrorView(req: Request, res: Response) {
        // const { params } = req;
        throw Errors.user(1001);
    };

    /**
     * POST 请求 & 上下文跟踪示例
     * @param req
     * @param res
     */
    public async doPing(req: Request, res: Response) {
        // const { body } = req;
        const context = ContextProvider.getContext();
        await pingService.ping();
        pingService.moduleFoo();
        return res.json({
            'msg': 'pong',
            'traceId': context?.traceId
        });
    }


}
