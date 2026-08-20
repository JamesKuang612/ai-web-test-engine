import { ContextProvider, controller } from 'nstarter-core';
import type { Request, Response } from 'express';
import { Errors } from '../errors';
import {
    pingService,
} from '../services';

/** 提供 NStarter 脚手架自带的页面渲染、错误处理和请求追踪示例。 */
@controller()
export class DemoController {
    /**
     * 渲染脚手架欢迎页，展示基础页面响应方式。
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
     * 主动抛出业务错误，展示页面路由的统一错误处理。
     * @param req
     * @param res
     */
    public async goErrorView(req: Request, res: Response) {
        // const { params } = req;
        throw Errors.user(1001);
    };

    /**
     * 调用示例服务并返回当前请求的 traceId。
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
