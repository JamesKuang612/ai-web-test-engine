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
     *
     */
    readonly zip?: boolean;
    readonly rotate_days?: number;
}





export interface ISystemConf {
    readonly timezone: string;
    // 日志
    readonly log: {
        readonly console?: IConsoleLogConf,
        readonly file?: IFileLogConf,
    };
    readonly req_log: {
        readonly enabled: boolean
    };
    readonly trusted_proxy: string[];
}
