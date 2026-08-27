# AI Web Test Engine：Codex 开发交接（2026-08-27）

> 本文面向接手开发的新 Codex 线程。请先完整阅读本文，再检查仓库和运行产物。不要仅依据旧 README 推断当前行为。

## 1. 接手时先做什么

1. 进入项目根目录：

   ```text
   F:\workspace\EthanKuang\ai-web-test-engine-workspace\ai-web-test-engine
   ```

2. 执行 `git status --short --branch`，保留用户现有测试 YAML，不要清理、覆盖或擅自提交。
3. 阅读本文第 8 节的保留问题，再决定是否继续修复。
4. 修改 TypeScript 后先构建，再启动后端；后端运行的是 `server/dist/app.js`。

## 2. Git 快照与协作约定

- 当前分支：`master`
- 当前 HEAD：`46dbcbf feat(运行流程): 拆分探索与计划生成并完善判定展示`
- 文档创建前，`master` 与 `origin/master` 一致。
- 用户目前独立开发，不使用 PR 和 `dev` 分支；需要推送时直接推送 `master`。
- 每次编码前先检查 Git 状态；一个可验证的小阶段对应一个提交，范围可以适度放大。
- 提交信息使用中文。
- 除非用户明确要求，不要自动提交或推送。

文档创建前已有以下用户工作区改动，必须保留：

```text
 M tests/avatar-account-menu.test.yaml
?? tests/test-6db28452.test.yaml
?? tests/test-881275b6.test.yaml
```

其中：

- `avatar-account-menu.test.yaml` 增加了结构化回放引用；
- 两个 `test-*.test.yaml` 是用户通过前端创建的真实测试用例；
- 前端显示“未保存”时，页面中的最新自然语言可能尚未写回 YAML，因此分析 Run 时应以 `intent.json` 和 `trace.jsonl` 为准。

## 3. 项目目标与当前架构

项目以 Momentic 为产品体验标杆，目标是实现本地运行、测试资产由 Git 管理的 AI Web 测试执行引擎。

当前主链路：

```text
自然语言测试动作
  → ModelIntentBuilder 生成 TestIntent
  → RunCoordinator 启动 AI 探索
  → Playwright 采集 PageObservation 并执行动作
  → UNCERTAIN 恢复（重新观察 → Midscene 视觉增强）
  → 独立 Verdict 严格判定 PASS / FAIL / UNCERTAIN
  → 保存探索轨迹和 plan-compilation-source
  → 用户主动点击“生成结构化计划”
  → 成功后得到 compiledPlanRef
  → 用户选择 structured-replay，在全新浏览器上下文回放
```

重要变化：首次 AI 探索已经与计划生成、结构化回放解耦。探索成功不再自动编译和回放。计划生成失败也不应把已经通过的探索改成 CRASHED。

## 4. 已完成能力

### 4.1 测试资产与调试台

- 前端可自主创建和编辑测试用例，不再局限于固定登录 POC。
- 测试仓库读取本地 `tests/*.test.yaml`。
- 调试台支持 AI 探索和结构化回放两种模式。
- 支持实时 SSE 运行时间线、运行截图查看、断线轮询恢复和主动终止。
- 页面明确区分 `PASS`、`FAIL`、`UNCERTAIN`、`CRASHED`。
- 时间线会标记最终 Verdict 使用的 PageObservation。

### 4.2 AI 探索与浏览器动作

已支持：

- `NAVIGATE`
- `TYPE`
- `CLICK`
- `SELECT`
- `CHECK`
- 100～5000 毫秒的受限 `WAIT`

连续无意义等待会被引擎终止。Playwright 本地调试默认 `headless: false`，可直接观察真实浏览器。

### 4.3 严格断言

- 用户在验证、断言或校验语句中用引号标出的文本会生成精确文本断言。
- 断言要求逐字匹配；例如“退出”不能等价为“退出登录”。
- 登录和头像账号菜单场景已完成真实验证，未出现假通过。

### 4.4 UNCERTAIN 与视觉增强

当前恢复策略：

1. Planner 首次返回 `UNCERTAIN`：立即重新采集 DOM 和截图，不额外固定等待 10 秒。
2. 再次 `UNCERTAIN`：使用 Planner 提供的业务语义目标调用 Midscene。
3. Midscene 通过同一 Codex App Server 使用 `gpt-5.6-terra`。
4. Midscene 坐标不会被直接点击；先用 `document.elementsFromPoint()` 反查可见 DOM，再补充成 PageObservation 候选，交回原 Planner 决策。
5. 坐标不能可靠映射到 DOM 时保守返回 `UNCERTAIN`。

配置位于 `conf.d/config.yml`：

```yaml
components:
  llm:
    provider: codex_app_server
    model: gpt-5.6-terra
    reasoning_effort: high
  visual_grounding:
    enabled: true
    provider: midscene
    base_url: codex://app-server
    model: gpt-5.6-terra
    model_family: gpt-5
    reasoning_enabled: false
    timeout_ms: 120000
```

### 4.5 探索、计划生成和回放解耦

- AI 探索完成后保存 `json/plan-compilation-source.json`。
- 前端仅在探索 `PASS` 且尚无 `compiledPlanRef` 时显示“生成结构化计划”。
- 计划生成成功后，用户可以切换到结构化回放。
- 计划生成失败在计划阶段单独展示，不污染探索结果。

相关代码：

- `modules/engine-core/src/replay/plan_compilation_source.ts`
- `modules/engine-core/src/run/run_coordinator.ts`
- `server/src/services/plan_generation.service.ts`
- `server/src/controllers/plan_generation.controller.ts`
- `web/src/views/TestEditorPage.tsx`

## 5. 主要 HTTP 接口

```text
POST   /api/debug/intent-preview
POST   /api/debug/run                         # 同步调试入口
POST   /api/debug/runs                        # 创建异步运行会话
GET    /api/debug/runs/:sessionId             # 获取会话快照
GET    /api/debug/runs/:sessionId/events      # SSE 事件流
DELETE /api/debug/runs/:sessionId             # 主动终止
POST   /api/debug/runs/:runId/plan            # 探索通过后主动生成计划
GET    /api/debug/artifact?ref=...             # 读取受控截图

GET    /api/tests
POST   /api/tests
GET    /api/tests/:testId
PUT    /api/tests/:testId
```

## 6. 本地运行与验证

环境要求：Node.js 22、npm 10、已登录的 Codex CLI、Playwright Chromium。

不要将测试账号或密码写入代码、文档或 Git。后端启动进程需要：

```text
JIANDAOYUN_USERNAME
JIANDAOYUN_PASSWORD
```

测试基址：

```text
https://test.jdydevelop.com/dashboard#/
```

常用命令：

```powershell
npm run build
npm run eslint
npm test
npm run dev:web
```

后端使用 WebStorm 调试时：

```text
工作目录：<project>\server
Node 参数：--enable-source-maps
入口文件：dist\app.js
```

服务地址：

```text
后端：http://127.0.0.1:3000
前端：http://127.0.0.1:5173
```

2026-08-27 交接前已重新验证：

- `npm run build`：通过；
- `npm run eslint`：通过；
- `npm test`：通过；
- engine-core：59 项测试通过；
- server：73 项测试通过；
- web：12 项测试通过。

## 7. 运行产物位置与排查顺序

`artifact_root` 是相对路径 `./test-results`，因此产物位置取决于后端工作目录：

- 从项目根目录启动：`<project>/test-results/<runId>/`
- WebStorm 以 `server` 为工作目录启动：`<project>/server/test-results/<runId>/`

当前 8 月 27 日真实测试主要位于 `server/test-results`。

建议按以下顺序排查：

1. `run.json`、`result.json`：最终状态、失败分类和指标；
2. `json/intent.json`：模型是否正确理解用户要求，是否擅自增加约束；
3. `trace.jsonl`：每一步 Planner 选择、理由、candidateId 和动作结果；
4. `json/observation-*.json`：当时提供给 Planner 的候选元素；
5. `artifacts/screenshot-*.png`：页面视觉状态、弹层和遮挡；
6. `json/verdict.json`：最终业务判定；
7. `json/plan-compilation-source.json`、`compiled-plan.json`：计划生成和回放问题。

不要只看最终截图猜原因。

## 8. 当前保留问题：创建应用场景误走搜索与点击超时

用户决定今天暂停修复，下一线程接力时可从这里继续。

### 8.1 用户真实意图

本次前端未保存输入为：

```text
登录后，点击新建应用，创建一个名为“旷世奇才”的应用，创建完成后退回工作台验证一下应用是否存在。
```

用户要求的是直接创建，不是先搜索同名应用。

### 8.2 对应 Run

```text
runId: 71c99811-689b-4da9-94b4-eb9633a452dc
目录: server/test-results/71c99811-689b-4da9-94b4-eb9633a452dc
结果: FAIL
失败: PAGE_TIMEOUT / ACTING / 点击动作执行超时
耗时: 120.2 秒
动作: 8
模型调用: 9
```

### 8.3 已确认的失败链路

1. `intent.json` 正确生成了“创建并回到工作台验证”的目标。
2. 但模型擅自增加约束：

   ```text
   避免重复创建同名应用；如“旷世奇才”已存在，不重复创建。
   ```

3. 受该约束影响，Planner 第 5 步没有点击“新建应用”，而是把“旷世奇才”输入“我的应用名称搜索框”。
4. 搜索为空后，第 7 步点击了 candidate `e30`。Planner 将其描述为“我的应用区域的新增应用按钮”，但真实元素是“我的应用”旁的设置齿轮。
5. 该点击打开了“我的应用”设置弹层。
6. 第 8 步 PageObservation 仍暴露了背景层的“新建应用”候选 `e32`。Planner 选择它，但弹层阻挡点击，Playwright 最终超时。

这不是单一模型随机性，而是三个问题叠加：

- TestIntent 无依据增加“避免重复创建”业务约束；
- 无文字图标缺少可靠语义，Planner 对齿轮进行了错误命名；
- PageObservation 没有充分过滤被顶层弹层遮挡、实际无法命中的背景元素。

### 8.4 推荐修复顺序

建议先做代码层可测的确定性修复，再真实测试：

1. **约束来源控制**
   - 检查 `ModelIntentBuilder` 的 system prompt 和后处理；
   - 禁止凭空加入“避免重复创建/提交”等改变执行路径的业务约束；
   - 最好为约束增加来源概念，区分用户原文、引擎安全策略和模型建议；
   - 模型建议不得覆盖用户明确动作。

2. **候选元素真实可点击性**
   - 在 Playwright observation 脚本中加入 hit-test；
   - 候选中心点的 `document.elementFromPoint()` / `elementsFromPoint()` 应命中自身或其后代；
   - 顶层 modal/dialog/drawer 打开时，过滤被遮挡的背景候选；
   - 不要仅凭 `visible`、尺寸和 `inViewport` 判断可点击。

3. **无文字图标语义与不确定策略**
   - 优先采集 `aria-label`、`title`、role、邻近文本和可访问名称；
   - 没有可靠语义的图标不能被模型任意重命名为“新增”；
   - 当候选语义与目标不够一致时，应返回 `UNCERTAIN`，让现有普通重试和 Midscene 视觉增强接管，而不是猜测点击。

4. **回归测试**
   - 为弹层遮挡、图标误标和无依据约束分别补单元测试；
   - 再让用户从前端真实运行创建应用场景；
   - 真实测试仍由用户主导，不要擅自在测试环境创建大量业务数据。

## 9. 另一个已验证场景

Run `e29c3ce9-c453-46bc-917b-e961386d58cb` 已在新流程下完成一次 AI 探索：

- 进入应用 `2026.8.27.1028`；
- 打开“表单2”；
- 提交一条数据；
- 进入“数据管理”搜索并确认记录存在；
- 探索结果为 `PASS`；
- 已保存 `json/plan-compilation-source.json`；
- 没有在探索结束时自动回放，说明流程解耦已生效。

此类复杂轨迹生成结构化计划时，仍可能因某一步缺少稳定定位提示而失败。现在这类错误应只在用户点击“生成结构化计划”后展示，不应推翻探索 PASS。

## 10. 关键代码导航

领域核心：

- `modules/engine-core/src/run/run_coordinator.ts`
- `modules/engine-core/src/intent/model_intent_builder.ts`
- `modules/engine-core/src/planning/model_action_planner.ts`
- `modules/engine-core/src/verdict/model_verdict_evaluator.ts`
- `modules/engine-core/src/replay/plan_compilation_source.ts`

浏览器与视觉：

- `server/src/adapters/browser/playwright_browser_adapter.ts`
- `server/src/adapters/browser/visual_element_script.ts`
- `server/src/adapters/visual/midscene_visual_target_locator.ts`
- `server/src/adapters/visual/midscene_visual_agent.ts`

服务端编排：

- `server/src/services/run_debug.service.ts`
- `server/src/services/run_debug_session.service.ts`
- `server/src/services/plan_generation.service.ts`
- `server/src/controllers/run_debug.controller.ts`
- `server/src/controllers/plan_generation.controller.ts`
- `server/src/routes/index.ts`

前端：

- `web/src/views/TestEditorPage.tsx`
- `web/src/api/run-debug.ts`
- `web/src/api/test-definitions.ts`
- `web/src/styles.css`

## 11. 文档与历史线程

- 架构讨论线程：`codex://threads/01a017e6-f4e2-7a81-b296-258458ceb88b`
- 中途接力线程：`codex://threads/01a0426a-77c1-79e2-a06f-6e413db5b2e2`
- 本交接来源线程：`codex://threads/01a03806-7d30-76e2-b898-45c3b0b8c823`

注意：`README.md` 和 `docs/getting-started.md` 中仍有“探索后自动编译并回放”的旧描述。当前真实行为以代码和本文为准，后续应补一次文档同步提交。

## 12. 给新线程的建议开场任务

可以直接把下面这段作为新线程的第一条开发指令：

```text
请先阅读 docs/codex-handoff-2026-08-27.md，并检查 Git 状态，不要覆盖或提交现有三个测试 YAML。随后复盘 Run 71c99811-689b-4da9-94b4-eb9633a452dc 的 intent.json、trace.jsonl、observation 和截图。先给出一个小阶段修复说明，重点解决：模型无依据增加“避免重复创建”约束、图标语义猜测、弹层遮挡背景候选仍被判为可点击。确认方案后再编码；每个阶段执行 build、eslint、test，使用中文提交信息，未经要求不要推送。
```
