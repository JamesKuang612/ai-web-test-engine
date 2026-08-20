import type { ErrorRequestHandler } from 'express';
import httpStatus from 'http-status';
import { Logger } from 'nstarter-core';

/** 将页面、接口和全局异常转换为各自约定的 HTTP 响应。 */
export class ErrorHandler {
    /** 处理页面路由异常，业务错误渲染错误页，未知错误只返回状态码。 */
    public static viewErrorHandler: ErrorRequestHandler = ((err, req, res, next) => {
        if (err && !err.isNsError) {
            Logger.error(err);
            return res.status(httpStatus.BAD_REQUEST).end();
        }
        return res.status(httpStatus.BAD_REQUEST).render('error', {
            title: err.message,
            error: err
        });
    });

    /** 处理接口路由异常，并以 JSON 格式返回可公开的错误信息。 */
    public static requestErrorHandler: ErrorRequestHandler = ((err, req, res, next) => {
        if (err && !err.isNsError) {
            Logger.error(err);
            return res.status(httpStatus.BAD_REQUEST).end();
        }
        return res.status(httpStatus.BAD_REQUEST).json({
            error: err.message
        });
    });

    /** 兜底处理解析和请求体错误，避免内部异常细节泄露给客户端。 */
    public static defaultErrorHandler: ErrorRequestHandler = ((err, req, res, next) => {
        if (err && !err.isNsError) {
            if (/^Unexpected\stoken/.test(err.message)) {
                // Invalid JSON
                return res.status(httpStatus.NOT_ACCEPTABLE).send({
                    error: 'Invalid JSON request.'
                });
            } else if (err.name === 'PayloadTooLargeError') {
                // Entity too large
                return res.status(httpStatus.REQUEST_ENTITY_TOO_LARGE).send({
                    error: 'Request entity too large.'
                });
            }
            return res.status(httpStatus.BAD_REQUEST).json({
                error: 'Bad request.'
            });
        }
        return res.status(httpStatus.BAD_REQUEST).json({
            error: err.message
        });
    });
}
