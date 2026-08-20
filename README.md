# ai-web-test-engine

## 开发说明

#### 开发准备

* 安装依赖

  ```bash
  npm install
  ```

* 编译

  ```bash
  npm run build
  ```

* 运行

  ```bash
  node ./server/dist/app.js --enable-source-maps
  ```

### 模型 Provider

开发环境默认使用本机 Codex 订阅调用 `gpt-5.6-sol`，不需要在项目中填写 API Key。首次使用前需要安装 Codex CLI 并完成登录：

```bash
codex login
codex --version
```

默认配置位于 `conf.d/config.yml`：

```yaml
components:
  llm:
    provider: codex_app_server
    model: gpt-5.6-sol
    reasoning_effort: high
    codex_command: codex
```

每次模型调用都会创建一个不持久化的临时线程，并禁用工具、网络和环境访问。需要回退到 FineOneAPI 时，将 `provider` 改为 `fine_one`；API Key 只写入本机的 `~/.ai-web-test-engine/config.yml`，不要提交到 Git。

* 更新 JSON Schema

  当工程内的实体对象结构定义 (`src/entities`) 发生修改后，需要手动更新 json-schema 结构描述文文件。

  ```bash
  npm run json-schema
  ```

### 工程目录结构

```text
<project_root>
├── ci/                         # CI 编排
├── conf.d/                     # 配置文件目录
├── server/                     # 服务端模块工程目录
│   ├── resources/              # 服务端资源文件目录
│   │   │── grpc/               # GRPC proto 结构定义文件
│   │   └── i18n/               # 国际化资源文件
│   ├── src/                    # 服务端源码
│   │   ├── components/         # 框架基础组件
│   │   │   ├── lib             # 组件配置定义
│   │   │   │   ├── logger      # 日志收集模块配置
│   │   │   │   └── monitor     # 监控模块配置
│   │   │   └── before.ts       # 组件启动前置加载项管理
│   │   ├── constants/          # 常量定义
│   │   ├── entities/           # 实体对象结构定义
│   │   ├── errors/             # 错误异常定义
│   │   ├── models/             # 数据库存储模型定义
│   │   ├── services/           # 业务方法
│   │   ├── controllers/        # 请求处理方法
│   │   ├── routes/             # Express 请求路由表
│   │   │   └── middlewares/    # Express 中间件扩展
│   │   ├── utils/              # 工程内部公用的工具方法
│   │   ├── types/              # 工程内部类型定义
│   │   ├── apm.ts              # APM 探针加载入口
│   │   ├── app.ts              # 应用主程序入口
│   │   ├── config.ts           # 全局配置
│   │   ├── context.ts          # 全局上下文定义
│   │   └── schema.ts           # 结构约束定义 schema 装载入口
│   ├── test/                   # 单元测试目录
│   ├── tools/                  # 开发工具组件
│   ├── typings/                # 模块内类型定义
│   ├── tsconfig.build.json     # TypeScript 构建配置文件
│   └── tsconfig.json           # TypeScript 开发配置文件 (IDE)
├── modules/                    # 子模块工程目录
├── typings/                    # TypeScript 公共类型定义
├── web/                        # 前端目录
│   ├── public/                 # Web 公共资源目录
│   │   ├── images/             # 前端图片资源目录
│   │   ├── js/                 # 前端 javascript 脚本目录
│   │   └── css/                # 前端样式资源目录
│   └── views/                  # Web 视图模板
├── package.json                # 全局 npm 工作目录配置
├── nx.json                     # nx 配置
├── README.md                   # 工程说明文件
└── LICENSE                     # 许可证文件
```

### 打包构建

* 构建容器镜像

  ```bash
  make docker-build
  ```

* 单元测试

  ```bash
  make docker-test
  ```

----

Made on 🌍 with 💓.
