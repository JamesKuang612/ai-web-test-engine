import { Logger } from 'nstarter-core';
import { sleep } from 'nstarter-utils';
import './schema';
import {
    httpServerComponent,
} from './components';
import { Consts } from './constants';

// 兜底记录未捕获异常，防止进程静默退出而没有诊断信息。
process.on('uncaughtException', (err) => {
    Logger.error(err);
    return false;
});

/** 负责按顺序启动服务组件，并在进程退出前完成资源清理。 */
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

    /** 初始化当前应用需要的全部组件并开始监听关闭事件。 */
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
    // 仅在该文件作为程序入口运行时启动服务，测试或导入时不会自动启动。
    AppManager.start().then();
}
