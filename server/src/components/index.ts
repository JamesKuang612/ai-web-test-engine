import { registerComponent, getComponent } from 'nstarter-core';
import { beforeLoad } from './before';

// 组件加载前的前置行为
beforeLoad();










import { HttpServerComponent } from './http_server.component';
registerComponent(HttpServerComponent);
export const httpServerComponent = getComponent<HttpServerComponent>(HttpServerComponent);
