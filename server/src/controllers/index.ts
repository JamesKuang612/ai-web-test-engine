import { getCtl, registerCtl } from 'nstarter-core';
import { IntentPreviewController } from './intent_preview.controller';
import { PlanGenerationController } from './plan_generation.controller';
import { RunDebugController } from './run_debug.controller';
import { RunDebugSessionController } from './run_debug_session.controller';
import { TestDefinitionController } from './test_definition.controller';

// 控制器由 NStarter 容器创建，路由层只依赖导出的单例。
registerCtl(IntentPreviewController);
registerCtl(PlanGenerationController);
registerCtl(RunDebugController);
registerCtl(RunDebugSessionController);
registerCtl(TestDefinitionController);

export const intentPreviewController = getCtl<IntentPreviewController>(
    IntentPreviewController
);
export const planGenerationController = getCtl<PlanGenerationController>(
    PlanGenerationController
);
export const runDebugController = getCtl<RunDebugController>(
    RunDebugController
);
export const runDebugSessionController = getCtl<RunDebugSessionController>(
    RunDebugSessionController
);
export const testDefinitionController = getCtl<TestDefinitionController>(
    TestDefinitionController
);
