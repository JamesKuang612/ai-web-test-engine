import { getCtl, registerCtl } from 'nstarter-core';
import { IntentPreviewController } from './intent_preview.controller';
import { RunDebugController } from './run_debug.controller';
import { TestDefinitionController } from './test_definition.controller';

// 控制器由 NStarter 容器创建，路由层只依赖导出的单例。
registerCtl(IntentPreviewController);
registerCtl(RunDebugController);
registerCtl(TestDefinitionController);

export const intentPreviewController = getCtl<IntentPreviewController>(
    IntentPreviewController
);
export const runDebugController = getCtl<RunDebugController>(
    RunDebugController
);
export const testDefinitionController = getCtl<TestDefinitionController>(
    TestDefinitionController
);
