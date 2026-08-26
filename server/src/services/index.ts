import { getSvc, registerSvc } from 'nstarter-core';
import { ArtifactPreviewService } from './artifact_preview.service';
import { IntentPreviewService } from './intent_preview.service';
import { RunDebugService } from './run_debug.service';
import { RunDebugSessionService } from './run_debug_session.service';
import { TestDefinitionService } from './test_definition.service';

// 先完成服务注册，再从 NStarter 容器中取得可复用的单例。
registerSvc(ArtifactPreviewService);
registerSvc(IntentPreviewService);
registerSvc(RunDebugService);
registerSvc(RunDebugSessionService);
registerSvc(TestDefinitionService);

export const artifactPreviewService = getSvc<ArtifactPreviewService>(
    ArtifactPreviewService
);
export const intentPreviewService = getSvc<IntentPreviewService>(
    IntentPreviewService
);
export const runDebugService = getSvc<RunDebugService>(RunDebugService);
export const runDebugSessionService = getSvc<RunDebugSessionService>(
    RunDebugSessionService
);
export const testDefinitionService = getSvc<TestDefinitionService>(
    TestDefinitionService
);
