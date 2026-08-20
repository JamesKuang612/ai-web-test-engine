/** 所有日志输出方式共享的开关和级别配置。 */
interface ILogConf {
    /**
     * 是否启用日志记录
     */
    readonly enabled: boolean;

    /**
     * 日志级别
     */
    readonly level: string;
}

interface IConsoleLogConf extends ILogConf {
    /**
     * 开启彩色输出
     */
    readonly colorize?: boolean;
}

interface IFileLogConf extends ILogConf {
    /**
     * 日志输出目录
     */
    readonly dir?: string;

    /**
     * 是否压缩历史日志文件。
     */
    readonly zip?: boolean;
    /** 历史日志文件的保留天数。 */
    readonly rotate_days?: number;
}

/** 服务运行环境、日志及可信代理等全局配置。 */
export interface ISystemConf {
    readonly timezone: string;
    // 日志
    readonly log: {
        readonly console?: IConsoleLogConf,
        readonly file?: IFileLogConf
    };
    readonly req_log: {
        readonly enabled: boolean
    };
    readonly trusted_proxy: string[];
}
