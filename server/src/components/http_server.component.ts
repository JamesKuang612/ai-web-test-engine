import http from 'http';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';

import {
    component,
    initRequestId,
    RequestLogger,
    ContextProvider,
    BaseComponent,
    Logger
} from 'nstarter-core';

import { config } from '../config';
import { Consts } from '../constants';
import { router, securityMiddlewares } from '../routes';
import { ErrorHandler } from '../routes/middlewares/error.handler';

/**
 * 组装 Express 中间件、路由和底层 HTTP Server，并管理服务启停生命周期。
 */
@component()
export class HttpServerComponent extends BaseComponent {
    private readonly _server: http.Server;

    /** 创建 Express 应用并按固定顺序注册会话、解析、安全和日志中间件。 */
    constructor() {
        super();

        const app = express();
        app.set('trust proxy', this.trustedProxy);

        // view engine setup
        app.set('views', './web/views');
        app.set('view engine', 'pug');
        app.enable('view cache');
        // static file path
        app.use(express.static('./web/public'));

        // session store
        app.use(session({
            secret: config.server.session.secret,
            name: config.server.session.name,
            resave: false,
            saveUninitialized: false,
            cookie: config.server.cookie.policy
        }));

        // parser setup
        app.use(express.json({
            limit: '1mb'
        }));
        app.use(express.urlencoded({
            limit: '1mb',
            extended: false
        }));
        app.use(cookieParser());
        app.use(initRequestId());

        // 安全处理
        app.use(securityMiddlewares);

        // 上下文管理
        app.use(ContextProvider.getMiddleware({
            idGenerator: (req) => req.requestId
        }));

        // request log
        if (config.system.req_log.enabled) {
            app.use(RequestLogger.getMiddleware());
        }

        app.use('/', router);
        app.use(ErrorHandler.defaultErrorHandler);

        this._server = http.createServer(app);
        // NOTICE: https://github.com/nodejs/node/issues/27363
        this._server.keepAliveTimeout = 70_000;
        this._server.headersTimeout = 71_000;
    }

    /** 返回 Express 可以信任的内置及用户配置代理地址。 */
    public get trustedProxy() {
        let trustedProxy = [
            'loopback',     // 127.0.0.1/8, ::1/128
            'linklocal',    // 169.254.0.0/16, fe80::/10
            'uniquelocal'   // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
        ];
        if (config.system.trusted_proxy) {
            trustedProxy = [...trustedProxy, ...config.system.trusted_proxy];
        }
        return trustedProxy;
    }

    /** 暴露底层 HTTP Server，供框架组件和测试读取。 */
    public get server() {
        return this._server;
    }

    /** 在配置端口上启动 HTTP Server，并记录监听或启动错误。 */
    public async init() {
        const port = config.server.http.port;
        this._server.listen(port);
        this._server.on('error', (err) => {
            Logger.error(err);
            process.exit(1);
        });
        this._server.on('listening', () => {
            Logger.info(`App requests listening on：${ port }`);
        });
    }

    /** 停止接收新请求、关闭空闲连接，并为异常连接保留强制超时兜底。 */
    public async shutdown() {
        Logger.info('web server shutting down.');
        await new Promise<void>((resolve) => {
            // 停止新建连接
            this._server.close(() => {
                Logger.info('web server closed successfully.');
                return resolve();
            });
            // @see https://nodejs.org/api/http.html#servercloseidleconnections
            this._server.closeIdleConnections();
            // 超时强制关闭
            setTimeout(() => {
                Logger.warn('web server force terminated.');
                return resolve();
            }, Consts.System.HTTP_SHUTDOWN_MS);
        });
    }
}
