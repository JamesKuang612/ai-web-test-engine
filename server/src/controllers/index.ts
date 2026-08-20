import { getCtl, registerCtl } from 'nstarter-core';
import { DemoController } from './demo.controller';
import { IntentPreviewController } from './intent_preview.controller';

// 控制器由 NStarter 容器创建，路由层只依赖导出的单例。
registerCtl(DemoController);
registerCtl(IntentPreviewController);

export const demoController = getCtl<DemoController>(DemoController);
export const intentPreviewController = getCtl<IntentPreviewController>(
    IntentPreviewController
);
