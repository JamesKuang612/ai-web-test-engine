import { registerComponent, getComponent } from 'nstarter-core';
import { beforeLoad } from './before';

// 组件加载前的前置行为
beforeLoad();










import { HttpServerComponent } from './http_server.component';
// 将 HTTP 组件交给 NStarter 容器管理，并导出容器中的单例实例。
registerComponent(HttpServerComponent);
export const httpServerComponent = getComponent<HttpServerComponent>(HttpServerComponent);
