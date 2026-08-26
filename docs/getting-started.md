# 新人快速上手

这份文档用于帮助第一次接触项目的同学，在 Windows 环境中从拉取代码开始，完成安装、构建、启动和第一条真实链路验证。

完成本文后，你应当能够：

- 启动后端 HTTP 服务和前端开发页面；
- 通过自然语言调用一次登录 POC；
- 看懂本次运行是否正常结束；
- 找到本地保存的运行产物；
- 在 WebStorm 中沿核心调用链打断点。

## 1. 先了解当前阶段

项目以 Momentic 为产品标杆，目标是实现一个本地运行、测试资产由 Git 管理的 AI Web 测试执行引擎。

当前已经完成的最小纵向链路是：

```text
自然语言 action
  → 模型生成结构化 TestIntent
  → RunCoordinator 协调运行
  → Playwright 观察页面并逐步执行登录动作
  → 独立 Verdict 判定最终业务结果
  → 将成功轨迹编译为 CompiledPlan
  → 在全新浏览器上下文执行确定性回放
  → 保存 Run、Observation、Screenshot、Trace 和 Result
```

当前登录 POC 已支持使用本机环境变量填写账号和密码、点击登录、验证工作台状态，并对成功轨迹进行结构化回放。阶段性验证成功时应看到：

```text
lifecycle = COMPLETED
result = PASS
```

`COMPLETED` 表示执行链路正常结束；`PASS` 表示探索和全新上下文回放均通过最终业务判定。

## 2. 环境要求

建议使用 Windows PowerShell 执行本文命令。

| 工具 | 项目要求 | 检查命令 |
| --- | --- | --- |
| Git | 能访问公司 Bitbucket | `git --version` |
| Node.js | `>= 22.19.0` 且 `< 23.0.0` | `node --version` |
| npm | `>= 10.9.3` | `npm --version` |
| Codex CLI | 能使用团队选定的模型 | `codex --version` |
| WebStorm | 可选，用于阅读和断点调试 | 在“关于”页面检查 |

如果 Node.js 或 npm 版本不符合要求，请使用公司的标准 Node 版本管理方式切换，不要直接修改项目中的版本约束。

## 3. Fork 和拉取代码

只想阅读、运行项目时，可以直接拉取上游仓库。准备参与开发时，建议先在 Bitbucket 中 Fork 上游仓库到个人账号，再克隆个人 Fork。

上游仓库地址：

```text
ssh://git@code.fineres.com:7999/~ethan.kuang/ai-web-test-engine.git
```

克隆个人 Fork 后，将上游仓库登记为 `upstream`：

```powershell
git clone <从 Bitbucket 复制的个人 Fork SSH 地址>
Set-Location -LiteralPath '.\ai-web-test-engine'
git remote add upstream 'ssh://git@code.fineres.com:7999/~ethan.kuang/ai-web-test-engine.git'
git remote -v
```

正常情况下：

- `origin` 指向个人 Fork，用于推送个人开发分支；
- `upstream` 指向团队上游仓库，用于同步 `dev` 等公共分支。

开始任务前先同步上游，并从团队指定的基线分支创建任务分支：

```powershell
git fetch upstream
git switch -c feature/<任务编号> upstream/dev
```

如果远程还没有 `dev`，不要自行创建同名公共分支，先向项目负责人确认当前基线。

## 4. 安装依赖

下面的命令都要在项目根目录执行，也就是能看到根 `package.json` 的目录。

```powershell
npm install
npx playwright install chromium
```

说明：

- `npm install` 会安装根工程、后端、前端和 `engine-core` 工作区的依赖；
- 第二条命令会下载 Playwright 使用的 Chromium；
- 安装过程可能出现依赖弃用警告，只有命令最终以错误退出时才表示安装失败；
- 不要提交 `node_modules`，它已经被 `.gitignore` 忽略。

## 5. 准备 Codex CLI

开发环境默认通过本机 Codex 登录调用 `gpt-5.6-terra`，项目中不需要保存 OpenAI API Key。

如果尚未安装 Codex CLI，可以通过 npm 安装：

```powershell
npm install --global @openai/codex
codex --version
```

首次使用时运行：

```powershell
codex
```

按照终端提示选择使用 ChatGPT 登录。也可以用下面的命令检查登录状态：

```powershell
codex login status
```

Codex CLI 的安装和登录方式以 [OpenAI 官方文档](https://learn.chatgpt.com/docs/codex/cli) 为准。

项目默认模型配置位于 `conf.d/config.yml`：

```yaml
components:
  llm:
    provider: codex_app_server
    model: gpt-5.6-terra
    reasoning_effort: high
    codex_command: codex
```

模型配置应与当前阶段验证基线保持一致。如果当前账号看不到该模型，先把错误信息交给项目负责人确认。

## 6. 构建并运行完整检查

先执行一次完整检查，确认本机环境和当前代码基线正常：

```powershell
npm run build
npm run eslint
npm test
```

三个命令都应以退出码 `0` 结束。测试不会调用真实模型，也不会要求登录简道云。

常用命令如下：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 构建后端、前端和领域模块 |
| `npm run eslint` | 检查代码规范 |
| `npm test` | 运行全部单元测试 |
| `npm run dev:web` | 启动前端开发服务器 |
| `npm start` | 启动已经构建好的后端 |

## 7. 启动后端

后端运行的是编译产物，因此修改 TypeScript 后要先重新执行 `npm run build`。

真实登录前，在当前终端或 WebStorm 运行配置中准备本机环境变量；不要把实际值写进仓库：

```powershell
$env:JIANDAOYUN_USERNAME = '<测试账号>'
$env:JIANDAOYUN_PASSWORD = '<测试密码>'
```

```powershell
npm start
```

默认接口地址是：

```text
http://127.0.0.1:3000
```

保持这个终端窗口运行，再打开一个 PowerShell 窗口执行下一节的验证命令。

## 8. 运行第一条真实链路

在新的 PowerShell 窗口中执行：

```powershell
$requestBody = @{
    action = '使用环境变量中的账号和密码登录简道云，并等待工作台加载完成。'
} | ConvertTo-Json

$response = Invoke-RestMethod `
    -Method Post `
    -Uri 'http://127.0.0.1:3000/api/debug/run' `
    -ContentType 'application/json' `
    -Body $requestBody

$response.result | Format-List
```

真实模型调用可能需要一段时间。本阶段单次运行的最大时长是 300 秒，等待期间不要重复提交请求。

成功时重点检查：

```text
lifecycle : COMPLETED
result    : PASS
```

同时应返回 `runId` 和 `compiledPlanRef`。前者用于定位本次运行的全部本地文件，后者可用于发起不经过意图构建和逐步规划的结构化回放。

## 9. 检查运行产物

每次运行默认保存在：

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

第一次阅读时建议按下面的顺序查看：

1. `intent.json`：模型如何理解用户输入；
2. `observation-*.json`：每个动作前后的结构化页面状态；
3. `artifacts/*.png`：探索和回放阶段的页面截图；
4. `trace.jsonl`：探索阶段实际执行过的动作轨迹；
5. `compiled-plan.json`：成功轨迹编译出的安全回放计划；
6. `result.json`：本次运行的最终结论和指标。

`test-results` 是本地运行产物，已经被 Git 忽略，不要手工加入提交。

## 10. 浏览器窗口与无头运行

当前本地调试基线默认显示 Chromium 窗口，可以直接观察探索和结构化回放过程：

```yaml
components:
  browser:
    headless: false
```

需要后台或 CI 运行时，在个人用户目录或部署配置中新建覆盖项：

```text
%USERPROFILE%\.ai-web-test-engine\config.yml
```

只写个人需要覆盖的配置：

```yaml
components:
  browser:
    headless: true
```

本机配置的优先级高于仓库中的 `conf.d/config.yml`。账号、密码、API Key 等私密信息也只能放在本机配置或本机环境中，不能提交到 Git。

## 11. 启动前端

后端验证通过后，可以在另一个终端启动前端：

```powershell
npm run dev:web
```

浏览器访问：

```text
http://127.0.0.1:5173/tests/login-and-open-workbench
```

调试台已经接入探索与结构化回放接口，可以编辑自然语言动作、查看最终结果和复用最近一次 `compiledPlanRef`。中间浏览器区域仍是静态示意图，真实浏览器过程请直接观察 Playwright 打开的 Chromium 窗口。

## 12. 使用 WebStorm 断点调试

先执行 `npm run build`，然后在 WebStorm 中创建一个 Node.js 运行配置：

| 配置项 | 内容 |
| --- | --- |
| 名称 | `Server Debug` |
| Node 运行时 | 符合项目要求的 Node.js 22 |
| Node 形参 | `--enable-source-maps` |
| 工作目录 | 项目根目录下的 `server` 目录 |
| 文件 | `dist/app.js` |
| 环境变量 | `JIANDAOYUN_USERNAME`、`JIANDAOYUN_PASSWORD` |

建议按数据流依次在这些源码中打断点：

1. `server/src/controllers/run_debug.controller.ts`：接收 HTTP 请求；
2. `server/src/services/run_debug.service.ts`：组装一次登录 POC 运行；
3. `modules/engine-core/src/run/run_coordinator.ts`：协调意图、浏览器、事件和存储；
4. `modules/engine-core/src/intent/model_intent_builder.ts`：请求模型并生成结构化意图；
5. `server/src/adapters/model/codex_app_server_model_adapter.ts`：把引擎模型端口适配到 Codex；
6. `server/src/adapters/model/codex_app_server_client.ts`：通过 App Server 协议调用本机 Codex；
7. `server/src/adapters/browser/playwright_browser_adapter.ts`：启动并操作 Chromium；
8. `server/src/adapters/storage/local_artifact_store.ts`：将运行数据写入本地目录。

接口请求进入第一个断点后，使用“步入”跟踪调用，优先观察 `action`、`TestIntent`、`RunSnapshot` 和 `RunResult` 的变化。

## 13. 常见问题

### `codex` 不是可识别的命令

先执行：

```powershell
npm install --global @openai/codex
codex --version
```

如果安装成功后仍找不到命令，重新打开 PowerShell 和 WebStorm，让新的 `PATH` 生效。

### Codex 未登录或登录失效

```powershell
codex login status
codex
```

在交互界面中重新使用 ChatGPT 登录，然后重启后端服务。

### 返回 `MODEL_NOT_AVAILABLE`

这表示当前 Codex 登录没有提供配置中的模型。保留完整错误信息并联系项目负责人，不要在代码中静默回退到能力更低的模型。

### Playwright 提示找不到浏览器可执行文件

```powershell
npx playwright install chromium
```

安装完成后重新启动后端。

### 访问 `127.0.0.1:3000` 被拒绝

确认已经执行 `npm run build` 和 `npm start`，并查看后端终端是否有启动错误。项目目前没有首页，请使用 `/api/debug/run` 接口验证。

### 端口 3000 已被占用

```powershell
Get-NetTCPConnection -LocalPort 3000
```

确认占用进程是否属于自己，再停止对应服务；不要直接结束不认识的公司进程。

### 接口没有返回 `PASS`

先检查 `failure.phase`、`summary` 和对应 Run 目录中的观察、截图与 Trace。`UNCERTAIN` 表示最终证据不足，`CRASHED` 表示运行在某个阶段异常终止，两者都不能当作登录成功。

### 没有生成 `test-results`

确认后端工作目录是项目根目录，并检查接口是否真正返回了 `runId`。如果运行在创建 Run 之前失败，可能不会生成完整产物。

## 14. 开始编码前的检查清单

- 已经从正确的上游基线创建个人任务分支；
- `npm run build`、`npm run eslint`、`npm test` 全部通过；
- 能运行 `/api/debug/run` 并得到预期结果；
- 不在仓库配置中写入账号、密码、令牌或 API Key；
- Commit Message 遵循 Conventional Commits，例如：

```text
feat(engine): 增加登录动作规划
fix(browser): 修复页面导航超时处理
test(storage): 补充本地产物存储测试
docs: 完善新人调试说明
```

提交 PR 前再次运行完整检查，并自行阅读本次代码差异。
