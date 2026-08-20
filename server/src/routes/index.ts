import { Router } from 'express';
import { ErrorHandler } from './middlewares/error.handler';
import {
    demoController,
} from '../controllers';

export { securityMiddlewares } from './middlewares/security.handler';

/** 只承载 JSON 接口的路由，并使用接口错误处理器收尾。 */
export const requestRouter = Router();

requestRouter.post('/ping', demoController.doPing);
requestRouter.use(ErrorHandler.requestErrorHandler);

/** 承载服务端页面路由，并使用页面错误处理器收尾。 */
export const viewRouter = Router();

viewRouter.get('/', demoController.goWelcomeView);
viewRouter.get('/error', demoController.goErrorView);
viewRouter.use(ErrorHandler.viewErrorHandler);

/** 汇总页面和接口路由，作为 HTTP 组件的统一入口。 */
export const router = Router();
router.use('/', viewRouter);
router.use('/', requestRouter);
