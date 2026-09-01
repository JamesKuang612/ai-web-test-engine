# ai-web-test-engine

新人第一次拉取项目时，请先阅读[新人快速上手](docs/getting-started.md)，按照文档完成环境准备、构建和第一条真实链路验证。

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

当前已经跑通登录 POC 的探索、判定、计划编译和确定性回放链路：

```text
自然语言 action
  → ModelIntentBuilder
  → RunCoordinator
  → Playwright 页面观察与登录动作
  → 独立 Verdict 判定
  → CompiledPlan 编译
  → 全新浏览器上下文确定性回放
  → 本地 Run、Observation、Screenshot、Trace、Result
```

通用交互目前支持 `NAVIGATE`、`TYPE`、`CLICK`、`SELECT`、`CHECK`
和 100～5000 毫秒的受限 `WAIT`。这些动作均可进入成功轨迹并参与结构化回放；
连续 `WAIT` 会被执行引擎主动终止，避免无效长时间等待。

服务启动后，可以在 PowerShell 中执行：

```powershell
$body = @{
  action = '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:3000/api/debug/run' `
  -ContentType 'application/json' `
  -Body $body
```

成功完成探索和全新上下文回放时，接口会返回生命周期为 `COMPLETED`、业务结果为 `PASS` 的 `RunResult`，并附带可用于结构化回放的 `compiledPlanRef`。

每次运行的产物默认保存在：

```text
test-results/<runId>/
├── run.json
├── result.json
├── trace.jsonl
├── artifacts/
│   ├── screenshot-after-*.png
│   └── replay-screenshot-after-*.png
└── json/
    ├── intent.json
    ├── observation-*.json
    ├── verdict.json
    ├── replay-validation.json
    └── compiled-plan.json
```

浏览器是否显示以及视口大小由 `components.browser` 控制。当前本地调试基线使用 `headless: false`，可直接观察探索和回放过程；后台或 CI 运行时应在部署配置中覆盖为 `true`。

建议新人优先在以下位置打断点理解链路：

1. `server/src/controllers/run_debug.controller.ts`
2. `server/src/services/run_debug.service.ts`
3. `modules/engine-core/src/run/run_coordinator.ts`
4. `server/src/adapters/browser/playwright_browser_adapter.ts`
5. `server/src/adapters/storage/local_artifact_store.ts`

### 模型 Provider

开发环境默认通过 OpenAI-compatible API 调用 DeepSeek。API Key 只写入本机的 `~/.ai-web-test-engine/config.yml`，不要提交到 Git：

默认配置位于 `conf.d/config.yml`：

```yaml
components:
  llm:
    provider: openai_compatible
    base_url: https://api.deepseek.com
    model: deepseek-v4-flash
    protocol: chat_completions
```

需要回退到本机 Codex 订阅时，将 `provider` 改为 `codex_app_server`，并配置 `model`、`reasoning_effort` 和 `codex_command`。Codex 适配器每次调用都会创建不持久化的临时线程，并禁用工具、网络和环境访问。

视觉定位使用 `@midscene/web` 调用 DeepSeek 多模态模型：

```yaml
components:
  visual_grounding:
    enabled: true
    provider: midscene
    base_url: https://api.deepseek.com
    model: deepseek-v4-flash-vision-exp
    model_family: deepseek
    reasoning_enabled: false
    timeout_ms: 120000
```

该配置通过 Midscene Agent 的 `modelConfig` 注入，不修改全局环境变量。Planner 首次返回 `UNCERTAIN` 时，引擎立即重新采集一次 DOM 和截图；再次 `UNCERTAIN` 时，使用 Planner 提供的业务语义目标调用 Midscene。Midscene 返回的坐标会先通过 `document.elementsFromPoint()` 反查可见 DOM，再补充为 `PageObservation` 候选交回原 Planner 决策，不会绕过 DOM 直接按坐标点击。若坐标无法映射到 DOM，则保守结束为 `UNCERTAIN`。

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
