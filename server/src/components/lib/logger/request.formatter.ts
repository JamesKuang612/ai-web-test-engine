import type { IRequestMetaFormatter } from 'nstarter-core';

/**
 * 将请求 ID 补充到访问日志元数据中，便于串联同一次请求的日志。
 * @param req
 * @param res
 * @param meta
 */
export const reqMetaFormatter: IRequestMetaFormatter = (req, res, meta) => {
    return {
        ...meta,
        request_id: req.requestId
    };
};
