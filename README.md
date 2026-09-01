# AI Web Test Engine

一个本地运行、测试资产由 Git 管理的 AI Web 测试执行引擎研究原型。

> **项目状态：已封版（2026-09-01）**
> 本仓库保留 Phase 3.5 + P0 Runtime Correctness 的最终研究基线，后续新架构不在本目录继续开发。这里的代码适合复盘、实验对照和复用基础设施，不应视为已经达到生产可用稳定性的测试产品。

## 最终基线

项目从最初的“模型直接选择 DOM candidate”演进为职责分离的运行时：

```text
TestDefinition
  ↓
IntentBuilder → TestIntent
  ↓
Environment Setup / Login Module
  ↓
PageSettler + PagePerception
  ├─ DOM observation
  ├─ bounded accessibility snapshot
  ├─ interaction state / hit-test
  ├─ visual regions
  └─ PerceptionDelta
  ↓
ModelActionPlanner → SemanticAction
  ↓
CompositeTargetGrounder
  ├─ deterministic DOM grounding
  ├─ accessibility grounding
  └─ visual discovery → DOM/transient candidate mapping
  ↓
ResolvedTarget
  ↓
BrowserAdapter / Playwright
  ↓
ActionResult
  ↓
EffectVerification
  ↓
SemanticStepProgress
  ↓
bounded Recovery → settle → re-ground original primary action
  ↓
Verdict + Trace + productive CompiledPlan
```

架构中几个必须保持分离的概念：

- `SemanticAction` 表达“想做什么”，不包含 `candidateId`；
- `Grounder` 是 semantic target 到物理目标的唯一绑定边界；
- `ResolvedTarget` 保存瞬时 candidate 与 grounding snapshot；
- Browser 只执行物理动作，不理解业务目标；
- `ActionResult=executed` 不等于业务 Step 已完成；
- Trace 忠实记录真实执行，CompiledPlan 只收录 productive path；
- 页面未稳定时，不允许据此产生确定性 not-found、progress 或 PASS。

## 已实现能力

### 测试资产与前端

- `tests/*.test.yaml` 作为 Git 管理的测试定义；
- 支持中文用例名、创建、读取、更新、重命名和删除；
- React/Vite 页面提供项目文件列表、用例编辑、运行状态和历史终态恢复；
- 后端通过同步接口、异步 Run Session 和 SSE 提供运行能力；
- 最近一次上下文、控制台和结果从本机 `test-results` 恢复。

### Runtime V2 基线

- Planner 输出 `SemanticAction`，不选择物理 candidate；
- DOM、A11y、hit-test 和视觉区域组成统一 `PagePerception`；
- VisualRegion 必须映射到真实 DOM/transient candidate，禁止任意坐标点击；
- CLICK 与 HOVER 使用不同 actionability 规则；
- `SemanticStepController` 保持原始 primary goal，执行 bounded recovery；
- Recovery 仅允许受控、低风险、可逆的 transient state action；
- Recovery model protocol failure 可诊断、有限修复并保守降级；
- PageSettler 使用 bounded stability sampling，不以固定长 sleep 为唯一机制；
- exact-text assertion 使用严格相等匹配，并且只有完整覆盖 TestIntent 时才能 deterministic PASS；
- productive trajectory 可编译为 `CompiledPlan` 并执行 deterministic replay。

### 模型与浏览器

- `ModelAdapter` 当前是单轮结构化 JSON 边界；
- 默认文本模型为 DeepSeek OpenAI-compatible Chat Completions；
- 可切换到本机 Codex App Server，Codex 路径使用隔离、只读、无工具临时线程；
- 视觉定位由 `@midscene/web` 调用 DeepSeek 多模态模型；
- 浏览器执行由本地 Playwright Chromium 完成；
- 简道云登录模块支持本机账号密码和本地 storage-state 缓存。

## 未实现与已知限制

封版时以下能力没有进入本仓库：

- Global SemanticPlan / TaskPlanner；
- MCP Client、Playwright MCP 或模型 function calling；
- 任意 screenshot coordinate click；
- replay healing、cache rewrite 和完整 self-heal；
- 生产级并发隔离、远程浏览器集群和权限系统；
- 跨设备同步 `test-results`、登录缓存和 CompiledPlan artifact。

当前 `ModelAdapter` 只有 `generateStructured()`，即使底层 provider 支持 tools，本项目也没有实现 tool-call loop。真实页面中仍可能遇到：

- provider 返回非严格 JSON 导致 Planner 不可用；
- 自定义 spinner/loading 状态没有被稳定性采样识别；
- 图标、canvas、复杂 iframe 或动态弹层无法可靠映射；
- 页面状态已经改变，但 deterministic evidence 不足，只能返回 `UNCERTAIN`；
- YAML 中保存了本机 `planRef`，换设备后缺少对应 `test-results` artifact。

这些是封版时已知边界，不要通过放宽 schema、猜测成功、随机点击或直接坐标执行来掩盖。

## 环境要求

| 工具 | 版本/要求 |
| --- | --- |
| Node.js | `>= 22.19.0` 且 `< 23.0.0` |
| npm | `>= 10.9.3` |
| Chromium | 通过 Playwright 安装 |
| DeepSeek API Key | 真实模型运行时需要 |
| Codex CLI | 仅在切换到 `codex_app_server` 时需要 |

安装依赖：

```powershell
npm install
npx playwright install chromium
```

## 本机配置与凭据

仓库默认配置位于 `conf.d/config.yml`，个人覆盖配置位于：

```text
%USERPROFILE%\.ai-web-test-engine\config.yml
```

默认文本与视觉模型：

```yaml
components:
  llm:
    provider: openai_compatible
    base_url: https://api.deepseek.com
    model: deepseek-v4-flash
    protocol: chat_completions
  visual_grounding:
    enabled: true
    provider: midscene
    base_url: https://api.deepseek.com
    model: deepseek-v4-flash-vision-exp
    model_family: deepseek
    reasoning_enabled: false
```

API Key 只允许写入本机覆盖配置，不要写入仓库配置、YAML 用例、patch 或运行日志。

使用简道云登录模块时，在启动后端的同一个终端设置：

```powershell
$env:JIANDAOYUN_USERNAME = '<测试账号>'
$env:JIANDAOYUN_PASSWORD = '<测试密码>'
```

本地登录缓存位于：

```text
test-results/.auth-cache/
```

该目录不进入 Git，也不会跨设备同步。

## 构建与启动

完整检查：

```powershell
npm run json-schema
npm run eslint
npm run build
npm test
```

启动后端：

```powershell
npm run build
npm start
```

后端默认地址：

```text
http://127.0.0.1:3000
```

另开终端启动前端：

```powershell
npm run dev:web
```

前端默认地址：

```text
http://127.0.0.1:5173/repository
```

Vite 会将 `/api` 代理到本机 3000 端口。

## HTTP 接口

```text
POST   /api/debug/intent-preview
POST   /api/debug/run
POST   /api/debug/runs
GET    /api/debug/runs/:sessionId
GET    /api/debug/runs/:sessionId/events
DELETE /api/debug/runs/:sessionId
POST   /api/debug/runs/:runId/plan
GET    /api/debug/tests/:testId/latest-run
GET    /api/debug/artifact

GET    /api/tests
POST   /api/tests
GET    /api/tests/:testId
PUT    /api/tests/:testId
DELETE /api/tests/:testId
```

同步调试示例：

```powershell
$body = @{
  action = '登录后，验证工作台页面显示“我的待办”。'
  setupModules = @('jiandaoyun-login')
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:3000/api/debug/run' `
  -ContentType 'application/json' `
  -Body $body
```

## 数据与持久化

测试定义：

```text
tests/*.test.yaml
```

运行产物：

```text
test-results/<runId>/
├── run.json
├── result.json
├── session.json
├── trace.jsonl
├── artifacts/
│   └── screenshot-*.png
└── json/
    ├── intent.json
    ├── observation-*.json
    ├── page-perception-*.json
    ├── page-settling-*.json
    ├── grounding-decision-*.json
    ├── recovery-*.json
    ├── verdict.json
    ├── compiled-plan.json
    └── replay-validation.json
```

`test-results`、截图、Cookie、storage state、`.env` 和个人配置都被 Git 忽略。不要为了跨设备恢复历史而强制提交这些文件。

根目录中的 `phase-*.patch` 和 `0001-*.patch` 是封版前各阶段架构 Review 的历史增量，仅用于审查与复盘，不是运行依赖。

## 工程结构

```text
<project_root>
├── conf.d/                    # 默认配置
├── docs/                      # 历史上手与交接资料
├── modules/engine-core/       # 领域契约、Grounding、Runtime、Verdict、Replay
├── server/
│   ├── src/adapters/          # Model、Playwright、Storage 外部适配器
│   ├── src/controllers/       # HTTP Controller
│   ├── src/services/          # Run/TestDefinition 服务装配
│   └── test/                  # Server 测试
├── tests/                     # Git 管理的 YAML 测试定义
├── web/                       # React/Vite 前端
├── test-results/              # 本机运行产物，Git ignored
└── README.md
```

建议从以下入口阅读最终代码：

1. `server/src/services/run_debug.service.ts`
2. `modules/engine-core/src/run/run_coordinator.ts`
3. `modules/engine-core/src/run/semantic_step_controller.ts`
4. `modules/engine-core/src/perception/perception_service.ts`
5. `modules/engine-core/src/grounding/composite_target_grounder.ts`
6. `server/src/adapters/browser/playwright_browser_adapter.ts`
7. `server/src/adapters/storage/local_artifact_store.ts`
8. `web/src/views/TestEditorPage.tsx`

`docs/getting-started.md` 和 `docs/codex-handoff-*.md` 记录了项目演进过程，其中部分默认模型、运行链路和待办已经过时；判断当前行为时以代码、本 README 和最终测试为准。

## 封版验证

封版前最后一次完整验证结果：

```text
Core tests   144 passed
Server tests 104 passed
Web tests     15 passed
ESLint        passed
Build         passed
JSON Schema   passed
```

后续如果仅做历史复现，建议固定当前 commit、`package-lock.json` 和模型配置。新的 Agent-first / MCP 架构应在新的空目录和独立仓库中实现，不要继续向本基线叠加职责。
