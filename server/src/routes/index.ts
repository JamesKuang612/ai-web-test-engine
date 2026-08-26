import { Router } from 'express';
import { ErrorHandler } from './middlewares/error.handler';
import {
    intentPreviewController,
    runDebugController,
    testDefinitionController,
} from '../controllers';

export { securityMiddlewares } from './middlewares/security.handler';

/** 只承载 JSON 接口的路由，并使用接口错误处理器收尾。 */
export const requestRouter = Router();

requestRouter.post(
    '/api/debug/intent-preview',
    intentPreviewController.preview
);
requestRouter.post(
    '/api/debug/run',
    runDebugController.run
);
requestRouter.get(
    '/api/tests',
    testDefinitionController.list
);
requestRouter.post(
    '/api/tests',
    testDefinitionController.create
);
requestRouter.get(
    '/api/tests/:testId',
    testDefinitionController.get
);
requestRouter.put(
    '/api/tests/:testId',
    testDefinitionController.update
);
requestRouter.use(ErrorHandler.requestErrorHandler);

/** 汇总当前 JSON 接口，作为 HTTP 组件的统一入口。 */
export const router = Router();
router.use('/', requestRouter);
