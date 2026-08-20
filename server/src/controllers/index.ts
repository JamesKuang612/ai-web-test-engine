import { getCtl, registerCtl } from 'nstarter-core';
import { DemoController } from './demo.controller';

// 控制器由 NStarter 容器创建，路由层只依赖导出的单例。
registerCtl(DemoController);

export const demoController = getCtl<DemoController>(DemoController);
