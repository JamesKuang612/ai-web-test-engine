/** FineOneAPI 当前支持的两种 OpenAI 兼容请求协议。 */
export type LlmApiProtocol = 'chat_completions' | 'responses';

/** 当前可选的本地订阅或 HTTP 模型 Provider。 */
export type LlmProvider = 'codex_app_server' | 'fine_one';

/** Codex 模型支持的推理强度。 */
export type LlmReasoningEffort =
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | 'ultra';

/** Codex 可选的加速服务档位；未配置时使用账户默认档位。 */
export type LlmServiceTier = 'priority';

/** 模型 Provider 配置；FineOne API Key 只允许由本机私有配置覆盖。 */
export interface ILlmComponentConf {
    readonly provider: LlmProvider;
    readonly base_url: string;
    readonly api_key: string;
    readonly model: string;
    readonly protocol: LlmApiProtocol;
    readonly reasoning_effort: LlmReasoningEffort;
    readonly service_tier?: LlmServiceTier;
    readonly codex_command: string;
}

/** Playwright 浏览器会话的本地启动参数。 */
export interface IBrowserComponentConf {
    readonly headless: boolean;
    readonly viewport: {
        readonly height: number,
        readonly width: number
    };
}

/** 当前服务需要的可选组件配置集合。 */
export interface IComponentsConf {
    readonly browser: IBrowserComponentConf;
    readonly llm: ILlmComponentConf;
}
