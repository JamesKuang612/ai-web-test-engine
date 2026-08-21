import { AbstractEntity } from 'nstarter-entity';

import { IServerConf } from './server.config';
import { IStorageConf } from './storage.config';
import { ISystemConf } from './system.config';
import {
    IComponentsConf,
    IBrowserComponentConf,
    ILlmComponentConf,
    LlmApiProtocol,
    LlmProvider,
    LlmReasoningEffort,
} from './components.config';

/**
 * 聚合服务启动所需的系统、HTTP、存储和组件配置。
 */
export class Config extends AbstractEntity {
    env: string;
    hostname: string;
    version: string;
    includes?: string[];

    server: IServerConf;
    storage: IStorageConf;
    system: ISystemConf;
    components: IComponentsConf;
}

export {
    IServerConf,
    IStorageConf,
    ISystemConf,
    IComponentsConf,
    IBrowserComponentConf,
    ILlmComponentConf,
    LlmApiProtocol,
    LlmProvider,
    LlmReasoningEffort
};
