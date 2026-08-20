import type { PongService } from './pong.service';
import { injectService, service } from 'nstarter-core';
import { foo } from 'ns-module';
import { sleep } from 'nstarter-utils';

/** 演示 NStarter 服务注册、服务注入以及模块调用方式。 */
@service()
export class PingService {
    @injectService()
    private pongService: PongService;

    /** 模拟一个短耗时的 ping 操作。 */
    public async ping() {
        console.log('ping');
        await sleep(100);
    }

    /** 调用注入的 PongService，演示服务之间的协作。 */
    public pong () {
        this.pongService.pong();
    }

    /** 调用独立工作区模块，验证服务端可以消费 monorepo 内部包。 */
    public moduleFoo() {
        console.log(foo());
    }
}
