import _ from 'lodash';
import os from 'os';
import winston, { format } from 'winston';
import type Transport from 'winston-transport';
import RotateFileTransport from 'winston-daily-rotate-file';
import { LogLevel } from 'nstarter-core';

import { config } from '../../../config';
import { Consts } from '../../../constants';

const errLevels = new Set<string>([LogLevel.error, LogLevel.warn]);

export const defaultTransports: Transport[] = [];

/** 将应用日志统一格式化，并在存在异常对象时附带堆栈。 */
const formatter = format.printf((info) => {
    let output = `${ info.timestamp } - [${ info.level }] ${ info.message }`;
    if (info.error) {
        output = `${ output }${ os.EOL }\t${ (info.error as Error).stack }`;
    }
    return output;
});

/** 将日志级别转换为更醒目的大写形式。 */
const levelFormatter = winston.format((info) => {
    info.level = info.level.toUpperCase();
    return info;
});

/** 只保留低于 warn 的普通应用日志。 */
const msgFilter = format((info) =>
    (!errLevels.has(info.level) ? info : false));
/** 只保留 warn 和 error 级别的异常日志。 */
const errFilter = format((info) =>
    (errLevels.has(info.level) ? info : false));

// console transport
const { console: consoleLogConf } = config.system.log;
if (consoleLogConf?.enabled) {
    const formats = [
        format.timestamp(),
        formatter
    ];
    if (consoleLogConf.colorize) {
        formats.unshift(winston.format.colorize());
    }
    formats.unshift(levelFormatter());
    defaultTransports.push(new winston.transports.Console({
        level: consoleLogConf.level,
        stderrLevels: [LogLevel.error],
        consoleWarnLevels: [LogLevel.warn, LogLevel.debug],
        format: format.combine(...formats)
    }));
}

// file transport
const { file: fileLogConf } = config.system.log;
if (fileLogConf?.enabled) {
    const baseFileLogOptions = {
        dirname: fileLogConf.dir || './log/',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: fileLogConf.zip || true,
        maxFiles: `${
            _.toInteger(fileLogConf.rotate_days) || Consts.System.DEFAULT_LOG_ROTATE_DAYS
        }d`
    };

    defaultTransports.push(new RotateFileTransport({
        ...baseFileLogOptions,
        level: fileLogConf.level,
        filename: 'app_%DATE%.log',
        stream: undefined,
        format: format.combine(
            msgFilter(),
            format.timestamp(),
            formatter
        )
    }));
    defaultTransports.push(new RotateFileTransport({
        ...baseFileLogOptions,
        level: fileLogConf.level,
        filename: 'error_%DATE%.log',
        stream: undefined,
        format: format.combine(
            errFilter(),
            format.timestamp(),
            formatter
        )
    }));
}
