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

/** 模型 Provider 配置；FineOne API Key 只允许由本机私有配置覆盖。 */
export interface ILlmComponentConf {
    readonly provider: LlmProvider;
    readonly base_url: string;
    readonly api_key: string;
    readonly model: string;
    readonly protocol: LlmApiProtocol;
    readonly reasoning_effort: LlmReasoningEffort;
    readonly codex_command: string;
}

/** 当前服务需要的可选组件配置集合。 */
export interface IComponentsConf {
    readonly llm: ILlmComponentConf;
}
