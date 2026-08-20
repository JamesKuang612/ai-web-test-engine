import { getSvc, registerSvc } from 'nstarter-core';
import { PingService } from './ping.service';
import { PongService } from './pong.service';
import { IntentPreviewService } from './intent_preview.service';

// 先完成服务注册，再从 NStarter 容器中取得可复用的单例。
registerSvc(PingService);
registerSvc(PongService);
registerSvc(IntentPreviewService);

export const pingService = getSvc<PingService>(PingService);
export const pongService = getSvc<PongService>(PongService);
export const intentPreviewService = getSvc<IntentPreviewService>(
    IntentPreviewService
);
