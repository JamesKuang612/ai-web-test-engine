import type { PingService } from './ping.service';
import { injectService, service } from 'nstarter-core';

/** 与 PingService 互相注入，用于展示 NStarter 对循环服务依赖的处理。 */
@service()
export class PongService {
    @injectService()
    private pingService: PingService;

    /** 输出 pong，作为最小服务调用示例。 */
    public pong() {
        console.log('pong');
    }

    /** 回调 PingService，演示循环依赖下的方法调用。 */
    public ping() {
        this.pingService.ping();
    }
}
