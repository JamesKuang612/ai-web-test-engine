# AI Web Test Engine：Codex 开发交接（2026-08-28）

> 本文面向第二天在另一台电脑接手开发的 Codex。先完整阅读本文和 `docs/codex-handoff-2026-08-27.md`，再检查 Git 状态。本文不包含任何账号、密码、Cookie 或浏览器登录态。

## 1. 明天接手时先做什么

1. 克隆或更新仓库：

   ```text
   ssh://git@code.fineres.com:7999/~ethan.kuang/ai-web-test-engine.git
   ```

2. 当前协作方式是个人直接在 `master` 开发和推送，不使用 PR 或开发分支。先执行：

   ```powershell
   git switch master
   git pull --ff-only origin master
   git status --short --branch
   ```

3. 确认 Node.js `>= 22.19.0 < 23.0.0` 和 npm `>= 10.9.3`，然后安装依赖与浏览器：

   ```powershell
   npm install
   npx playwright install chromium
   ```

4. 新电脑必须重新配置本机环境变量。不要向 Codex 对话、代码、文档或 Git 提供实际值：

   ```text
   JIANDAOYUN_USERNAME
   JIANDAOYUN_PASSWORD
   ```

   它们在 2026-08-28 使用的电脑上是 Windows 用户级环境变量，但不会随 Git 同步到另一台电脑。

5. 后端运行编译产物，修改后或首次启动前先构建：

   ```powershell
   npm run build
   npm start
   ```

   另开终端启动前端：

   ```powershell
   npm run dev:web -- --host 0.0.0.0
   ```

   默认地址：前端 `http://127.0.0.1:5173/`，后端 `http://127.0.0.1:3000`。

## 2. 2026-08-28 已完成的产品改造

本轮目标是将界面向 Momentic 的创建与编辑体验靠拢，并加入可复用登录模块。

### 2.1 创建与编辑界面

- 新建测试只要求“用例名称、起始地址”，不再要求创建时填写自然语言动作。
- 新测试创建后进入空白编辑器，左侧通过“添加步骤”分步编辑自然语言操作。
- 当前存储协议仍只有一个 `action` 字符串；前端保存时将左侧步骤拼接，读取时再拆分。
- 右侧继续展示真实运行截图，没有实现浏览器画面流或直接交互协议。
- 起始地址允许以下简道云 Host：
  - `test.jdydevelop.com`
  - `test.frjdy.com`
  - `www.jiandaoyun.com`
- Windows 可视模式启动 Playwright Chromium 出现 `spawn UNKNOWN` 时，会依次回退到系统 Chrome、Edge。

主要文件：

- `web/src/views/RepositoryPage.tsx`
- `web/src/views/TestEditorPage.tsx`
- `web/src/styles.css`
- `server/src/services/test_definition.service.ts`
- `server/src/adapters/browser/playwright_browser_adapter.ts`

### 2.2 第一版登录模块

用例执行配置新增：

```yaml
execution:
  setupModules:
    - jiandaoyun-login
```

行为如下：

1. 启动浏览器前，按“Host + 本机账号哈希”读取浏览器 `storageState` 缓存。
2. 导航到用例起始地址后检查是否已经处于工作台，并确认页面没有登录表单。
3. 缓存有效时直接进入业务 AI 探索，不重复登录。
4. 缓存缺失、过期或实际登录态失效时，清理旧缓存，并在同一浏览器会话中固定执行：
   - 定位账号输入框并填写 `JIANDAOYUN_USERNAME`；
   - 定位密码输入框并填写 `JIANDAOYUN_PASSWORD`；
   - 定位“登录”按钮并点击；
   - 确认进入 `/dashboard` 且登录表单消失。
5. 登录成功后保存新的 `storageState`，默认有效期 8 小时，再把控制权交给业务步骤。

登录步骤使用编译目标解析，不调用模型，也不会进入业务测试的自然语言步骤。账号密码只在浏览器动作边界从本机环境取得。

缓存位置是 `<artifact_root>/.auth-cache/*.json`，随 `test-results` 被 Git 忽略。缓存不会跨电脑同步，也不得提交。

主要文件：

- `server/src/adapters/browser/jiandaoyun_login_browser_adapter.ts`
- `modules/engine-core/src/ports/browser_adapter.ts`
- `server/src/services/run_debug.service.ts`
- `server/src/services/debug_test_context.ts`

### 2.3 前端选择和兼容规则

- 新建测试默认选择 `jiandaoyun-login`。
- 已存在且没有 `setupModules` 的旧测试保持关闭，避免无意改变历史用例。
- 在测试编辑页打开“选项”，可勾选或取消“使用简道云登录模块”。应用后还需保存，才会写入 YAML。
- 运行请求会把选择传给服务端；服务端只接受白名单模块 `jiandaoyun-login`。
- 启用模块后，意图构建上下文会明确告诉模型：登录已由前置模块完成，业务动作不得重复登录。

重要兼容限制：历史 `compiledPlan` 如果已经包含账号、密码和点击登录的步骤，不要在结构化回放时同时开启登录模块，否则计划到登录步骤时页面已经处于登录后状态。正确做法是先以 AI 探索模式启用模块运行，再从不包含登录动作的新业务轨迹生成计划。

## 3. 第一版明确未做的内容

- 没有通用模块市场或用户自定义模块，目前只有内建的简道云登录模块。
- 没有在时间线中单独展示“缓存命中、结构化重登”的细粒度 setup 事件。
- 没有 UI 清理登录态缓存；失效会自动清理，本机也可停止服务后手动删除 `.auth-cache`。
- 缓存 TTL 固定为 8 小时，尚未做配置项。
- 右侧仍是运行截图，不是实时浏览器视频流，也不能在截图中直接操作。

## 4. 验证状态

2026-08-28 提交前已经完成以下验证；用户当晚决定不再继续手工测试：

- `npm run eslint`：通过；
- `npm test`：通过；
  - engine-core：59 项；
  - server：当时全量 81 项，随后新增一条过期缓存用例并针对性验证，登录模块 3 项均通过；
  - web：12 项；
- `npm run build`：通过；
- `git diff --check`：通过；
- 真实生产环境只做了无业务副作用的登录验收：连续两次都进入 `https://www.jiandaoyun.com/dashboard#/`，页面没有登录表单；
- 前端 `/repository`、后端 `/api/tests` 均返回 HTTP 200。

登录模块测试覆盖：

1. 无缓存时固定 `NAVIGATE → TYPE → TYPE → CLICK` 并保存状态；
2. 缓存命中时只执行 `NAVIGATE`；
3. 缓存过期时不加载旧状态，重新执行结构化登录。

## 5. 当前真实测试 YAML

本次按用户要求将所有未提交内容一起提交，包括三份从前端创建的测试：

- `tests/test-04899efd.test.yaml`
  - 生产环境；
  - 当前带一个历史结构化计划引用；
  - 该计划很可能包含旧式登录步骤，启用新登录模块前注意上一节兼容规则。
- `tests/test-61ee56fb.test.yaml`
  - 生产环境；
  - 当前 `action` 为空。
- `tests/test-bb217408.test.yaml`
  - 生产环境；
  - 当前 `action` 为空。

不要擅自删除这些用户测试。

## 6. 明天建议的第一轮人工检查

用户今晚明确说不继续验证，因此下一台电脑准备好本机变量后，可从以下最小路径开始：

1. 新建一条没有登录描述的简单只读用例；新用例应默认启用登录模块。
2. 首次运行确认能够结构化登录并进入工作台，再执行正文。
3. 立即重复运行，确认不再出现登录操作，耗时明显缩短。
4. 打开“选项”关闭登录模块、保存，再确认 YAML 的 `setupModules` 被清除。
5. 对旧用例手动开启模块时，先使用 AI 探索，不要直接复用含登录步骤的历史计划。

真实测试尽量选择只读操作。未经用户明确同意，不要创建、修改或删除生产业务数据。

## 7. 仍需关注的旧问题

`docs/codex-handoff-2026-08-27.md` 第 8 节记录的问题仍未解决：

- 模型可能无依据增加“避免重复创建”等改变路径的业务约束；
- 无文字图标语义不足时可能被错误命名；
- 顶层弹层打开后，背景候选可能仍被判为可点击并导致超时。

推荐修复顺序仍是：约束来源控制 → DOM hit-test/弹层遮挡过滤 → 无文字图标语义和不确定策略 → 回归测试。

## 8. Git 与提交说明

- 当前开发分支：`master`。
- 远端：`origin`，公司 Bitbucket SSH 仓库。
- 本文与 2026-08-28 的全部前后端、核心模块、测试和用户 YAML 一同提交并推送。
- 接手后用 `git log -1 --oneline` 查看最终提交哈希。
- 不要提交 `test-results`、`.auth-cache`、本机配置、环境变量或任何凭据。

## 9. 给明天 Codex 的建议开场指令

```text
请先完整阅读 docs/codex-handoff-2026-08-28.md 和 docs/codex-handoff-2026-08-27.md，然后执行 git status --short --branch 与 git log -3 --oneline。当前直接在 master 开发。先确认新电脑具备 Node 22.19、依赖、Playwright 浏览器、本机 JIANDAOYUN_USERNAME/JIANDAOYUN_PASSWORD，但不要读取或输出变量实际值。构建并启动前后端后，优先人工验证新建用例默认启用“简道云登录模块”、首次结构化登录、第二次缓存命中。不要直接给包含旧登录步骤的 compiledPlan 叠加登录模块，不要擅自修改生产业务数据。若继续开发，再处理旧交接文档第 8 节的约束来源、弹层遮挡和图标语义问题。
```
