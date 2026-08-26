import { getSvc, registerSvc } from 'nstarter-core';
import { IntentPreviewService } from './intent_preview.service';
import { RunDebugService } from './run_debug.service';
import { TestDefinitionService } from './test_definition.service';

// 先完成服务注册，再从 NStarter 容器中取得可复用的单例。
registerSvc(IntentPreviewService);
registerSvc(RunDebugService);
registerSvc(TestDefinitionService);

export const intentPreviewService = getSvc<IntentPreviewService>(
    IntentPreviewService
);
export const runDebugService = getSvc<RunDebugService>(RunDebugService);
export const testDefinitionService = getSvc<TestDefinitionService>(
    TestDefinitionService
);
