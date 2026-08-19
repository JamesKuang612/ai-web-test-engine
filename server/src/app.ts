import { Logger } from 'nstarter-core';
import { sleep } from 'nstarter-utils';
import './schema';
import {
    httpServerComponent,
} from './components';
import { Consts } from './constants';

process.on('uncaughtException', (err) => {
    Logger.error(err);
    return false;
});

class AppManager {

    /**
     * 安全关闭服务
     */
    public static async gracefulShutdown() {
        // 等待 readinessProbe 进入 fail 状态
        await sleep(Consts.System.SHUTDOWN_WAIT_MS);
        try {
            // 按顺序停止服务
            await httpServerComponent.shutdown();
        } catch (err: any) {
            Logger.error(err);
        } finally {
            // 等待日志记录
            await sleep(1000);
            process.exit(0);
        }
    }

    /**
     * 监听关闭事件，安全退出
     */
    public static listenShutdownEvent() {
        process.on('SIGTERM', async () => {
            await AppManager.gracefulShutdown();
        });
    }

    public static async start() {

        // 基础组件

        // 任务调度

        // 网络服务
        await httpServerComponent.init();

        // 监听关闭事件
        AppManager.listenShutdownEvent();
    }
}

if (require.main === module) {
    AppManager.start().then();
}
