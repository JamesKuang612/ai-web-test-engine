import type {
    NextFunction,
    Request,
    Response,
} from 'express';
import { controller } from 'nstarter-core';
import {
    CodexAppServerError,
    OpenAiCompatibleModelAdapterError,
} from '../adapters/model';
import {
    intentPreviewService,
} from '../services';
import {
    IntentPreviewInputError,
    IntentPreviewService,
} from '../services/intent_preview.service';

/** 将 OpenAI-compatible Provider 错误映射为对应的 HTTP 状态码。 */
function getProviderErrorStatus(
    error: OpenAiCompatibleModelAdapterError
): number {
    if (error.code === 'MISSING_API_KEY') {
        return 503;
    }
    if (error.code === 'TIMEOUT') {
        return 504;
    }
    return 502;
}

/** 将 Codex 本地进程和模型错误映射为对应的 HTTP 状态码。 */
function getCodexErrorStatus(error: CodexAppServerError): number {
    if (
        error.code === 'CLI_NOT_FOUND' ||
        error.code === 'MODEL_NOT_AVAILABLE' ||
        error.code === 'NOT_LOGGED_IN'
    ) {
        return 503;
    }
    if (error.code === 'TIMEOUT') {
        return 504;
    }
    return 502;
}

/** 提供只构建 TestIntent、不启动浏览器的阶段性调试接口。 */
@controller()
export class IntentPreviewController {
    /** 默认使用真实预览服务，测试可以注入不访问模型的替身。 */
    constructor(
        private readonly previewService: Pick<
            IntentPreviewService,
            'preview'
        > = intentPreviewService
    ) {}

    /** 接收自然语言 action，并返回真实模型生成的结构化测试意图。 */
    public preview = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        const action = typeof req.body?.action === 'string'
            ? req.body.action
            : '';
        const abortController = new AbortController();
        const abortRequest = () => abortController.abort();
        req.once('aborted', abortRequest);

        try {
            const intent = await this.previewService.preview(
                action,
                abortController.signal
            );
            res.json({
                intent
            });
            return;
        } catch (error) {
            if (error instanceof IntentPreviewInputError) {
                res.status(400).json({
                    code: 'INVALID_INTENT_PREVIEW_INPUT',
                    error: error.message
                });
                return;
            }
            if (error instanceof OpenAiCompatibleModelAdapterError) {
                res.status(getProviderErrorStatus(error)).json({
                    code: error.code,
                    error: error.message
                });
                return;
            }
            if (error instanceof CodexAppServerError) {
                res.status(getCodexErrorStatus(error)).json({
                    code: error.code,
                    error: error.message
                });
                return;
            }
            next(error);
        } finally {
            req.off('aborted', abortRequest);
        }
    };
}
