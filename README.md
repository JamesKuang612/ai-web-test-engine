# ai-web-test-engine

## 开发说明

#### 开发准备

* 安装依赖

  ```bash
  npm install
  npx playwright install chromium
  ```

* 编译

  ```bash
  npm run build
  ```

* 运行

  ```bash
  node ./server/dist/app.js --enable-source-maps
  ```

* 完整检查

  ```bash
  npm run build
  npm run eslint
  npm test
  ```

### 地基调试接口

当前已经跑通第一条最小纵向链路：

```text
自然语言 action
  → ModelIntentBuilder
  → RunCoordinator
  → Playwright 启动与起始页导航
  → 页面 observe
  → 本地 Run、Observation、Trace、Result
```

服务启动后，可以在 PowerShell 中执行：

```powershell
$body = @{
  action = '打开简道云登录页'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:3000/api/debug/run' `
  -ContentType 'application/json' `
  -Body $body
```

成功打开并观察起始页面时，接口会返回生命周期为 `COMPLETED`、业务结果为 `UNCERTAIN` 的 `RunResult`。`UNCERTAIN` 表示基础链路已经跑通，但当前版本尚未执行登录交互和业务断言，不能误报为测试通过。

每次运行的产物默认保存在：

```text
test-results/<runId>/
├── run.json
├── result.json
├── trace.jsonl
└── json/
    ├── intent.json
    ├── observation-before-navigation.json
    └── observation-after-navigation.json
```

浏览器是否显示以及视口大小由 `components.browser` 控制。本机调试时可以在 `~/.ai-web-test-engine/config.yml` 中将 `headless` 覆盖为 `false`，不要修改并提交团队默认配置。

建议新人优先在以下位置打断点理解链路：

1. `server/src/controllers/run_debug.controller.ts`
2. `server/src/services/run_debug.service.ts`
3. `modules/engine-core/src/run/run_coordinator.ts`
4. `server/src/adapters/browser/playwright_browser_adapter.ts`
5. `server/src/adapters/storage/local_artifact_store.ts`

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
│   │   ├── adapters/            # 外部模型和本地存储适配器
│   │   ├── services/           # 业务方法
│   │   ├── controllers/        # 请求处理方法
│   │   ├── routes/             # Express 请求路由表
│   │   │   └── middlewares/    # Express 中间件扩展
│   │   ├── app.ts              # 应用主程序入口
│   │   ├── config.ts           # 全局配置
│   │   ├── context.ts          # 全局上下文定义
│   │   └── schema.ts           # 结构约束定义 schema 装载入口
│   ├── test/                   # 单元测试目录
│   ├── tools/                  # 开发工具组件
│   ├── tsconfig.build.json     # TypeScript 构建配置文件
│   └── tsconfig.json           # TypeScript 开发配置文件 (IDE)
├── modules/                    # 执行引擎领域模块
│   └── engine-core/            # 核心契约、端口和运行协调逻辑
├── web/                        # React/Vite 前端工程
│   └── src/                    # 页面、组件和样式源码
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
