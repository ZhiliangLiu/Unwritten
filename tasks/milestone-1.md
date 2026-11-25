# 第一个里程碑 · 实现任务拆解

设计依据是 [docs/milestone-1.md](../docs/milestone-1.md)。本文件把它拆成可以交给子代理逐个执行的任务：每一步写在哪个文件、那个文件做什么、具体怎么写、要注意什么、做完怎样验证。

界面走查使用 [Figma · Milestone 1](https://www.figma.com/design/uaT0KDEwC6wvVbKUiT5BcQ/Unwritten?node-id=23-7921)。

本文件是进度追踪文件，可以勾选。设计本身以 `docs/` 为准；本文件和 `docs/` 冲突时，先停下来汇报，由维护者裁定后改 `docs/`，再改这里。

---

## 0. 给执行者（必读）

### 0.1 怎么用这份文件

1. 先读完 §0、§2、§3，再读分配给你的那一个任务（§5 里的 `Txx`）。不要跳过“先读”里列出的设计文档章节。
2. 只改你的任务“拥有的文件”。需要改别的任务拥有的文件时，停下来汇报（§0.3）。
3. 按“步骤”的顺序做，每做完一步把 `- [ ]` 改成 `- [x]`。
4. 全部步骤做完后，逐条跑“完成判据”里的命令，把输出贴进汇报。
5. 本文的路径、类型和接口约定供任务交接；业务与视觉契约以 `docs/` 为准，库的 API 以安装后的类型声明为准。若差异改变了交接契约，先按 §0.3 汇报。

### 0.2 硬性规则（违反即返工）

| 规则 | 说明 |
| --- | --- |
| 不写注释 | 任何代码文件都不写注释，包括 CSS、shell、`tsconfig.json`。lint 抑制指令（`// oxlint-disable…`、`// @ts-expect-error`、`/* stylelint-disable */`）也算注释，同样禁止。见根目录 [AGENTS.md §8](../AGENTS.md#8-不写注释) |
| 只用 pnpm | 不用 npm、yarn、npx。临时执行用 `pnpm exec` 或 `pnpm dlx` |
| 不加依赖 | 全部依赖由 T01 一次装好。需要新依赖时停下来汇报 |
| 不 commit、不 push | 改动留在工作树里，由编排者汇总后请维护者授权提交 |
| 相对导入写扩展名 | TypeScript 里的相对导入一律写 `.ts` / `.tsx` 后缀，例如 `import { x } from "./a.ts"` |
| 只用可擦除语法 | 不写 `enum`、`namespace`、构造函数参数属性（`constructor(private x)`）、装饰器。tsconfig 开了 `erasableSyntaxOnly` |
| 界面文案走 i18n | 组件里不出现用户能看到的字面字符串，`aria-label`、`placeholder`、`title`、`alt` 也算。见 §2.4 |
| 纯文本渲染 | AI 输出、作品内容、玩家输入、模型返回的错误信息一律当纯文本渲染。不用 `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function` |
| 样式只用 token | 视觉属性只能用 `--uw-*` token。见 [apps/client/AGENTS.md §2](../apps/client/AGENTS.md#2-样式只用-token) |
| 测试内容虚构 | 测试和示例里的故事、人物名、对白全部自己编，不从任何真实作品里摘 |
| 测试数据 | 自动化测试用 `fs.mkdtempSync(path.join(os.tmpdir(), "unwritten-"))` 建临时数据目录，测试结束删除。手动验证的数据放仓库下的 `.data/` |
| key 不进仓库 | 测试夹具不能叫 `providers.json`，也不能以它开头。测试里要写配置文件时，写进临时数据目录 |
| 提案工具参数只用字符串 | `propose_turn`、`propose_preview` 的每个参数都是字符串，结构化内容用“每行一个 JSON” |
| 事务里不 await | SQLite 驱动是同步的。`db.transaction(...)` 的回调里不调用任何异步函数 |

### 0.3 遇到这些情况，停下来汇报

- 本文没写、设计文档也没写的设计决定。不要自己发明，写清楚“缺什么、有哪几种做法、各自代价”。
- 库的 API 和本文描述的差别大到改变了做法（不只是改个名字）。
- 需要改别的任务拥有的文件，或需要新依赖。
- 完成判据里的某条跑不通，而且你判断问题不在自己的代码里。
- 发现设计文档前后矛盾。

汇报格式：**卡在哪一步 / 看到了什么（原始输出）/ 你认为的原因 / 可选做法**。

### 0.4 并行与工作树

- 编排者按 §3 的波次派发任务。同一波次的任务互不依赖，可以同时执行。
- 并行执行的子代理各用一个 git 工作树（Agent 工具的 `isolation: "worktree"`）。工作树里没有 `node_modules`，开工先跑 `pnpm install --frozen-lockfile`。
- 每个任务只碰自己拥有的文件，所以工作树之间不会冲突。编排者收齐后按任务编号顺序合进主工作树，跑一遍全量检查（§0.5 第 3 条）。
- `pnpm-workspace.yaml`、各 `package.json`、`pnpm-lock.yaml` 只归 T01。其他任务一律不改。

### 0.5 完成一个任务的标准动作

1. 跑本任务的“完成判据”。
2. 用 `code-review-skill` 对本任务的全部 diff 自检（根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律)）。确认成立的问题修掉，再对完整 diff 重新自检；只是“可能”的问题写进汇报。
3. 在仓库根目录跑：`pnpm typecheck && pnpm lint && pnpm test`。纯设计任务在脚手架尚未合入时只跑自己的检查。
4. 汇报：改了哪些文件、每条完成判据的输出、自检结论、还没解决的问题。

---

## 1. 范围评估

### 1.1 结论

范围合理，可以按它做。它是一条最薄的完整链路：设置模型 → 写背景 → 预览并采用开场 → 连续游玩 → 重启续玩。这条链路上的每一块（契约、幂等键、比较再更新、事件流、带令牌的入口、配置文件的原子写入）都是后续里程碑直接复用的地基。推迟的部分（Electron、工作站、故事事实、分线）都和这条链路解耦，推迟它们不会让后续返工。

需要补的不是新功能，而是“里程碑没明写、但验收离不开”的部分（§1.2），以及几处必须先拍板的选型事实（§1.4）。

### 1.2 里程碑没写、但验收离不开的部分（本拆解已纳入）

| 补充项 | 为什么离不开 | 落在哪个任务 |
| --- | --- | --- |
| 主题 token、首屏外观脚本 | 验收要在生产构建里检查内容安全策略，而唯一的内联脚本就是首屏外观脚本（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）。界面“沿用 token 规则”也要求 token 先存在。外观只跟随系统，设置界面推迟 | T03、T07 |
| i18n 基础设施与文案键检查 | “界面沿用文案规则”；core 只返回错误码，client 必须有 `errors:<code>` 才能显示失败原因 | T06 |
| 运行诊断与性能样本 | 走查时能在 SQLite 里按请求复查失败、重试和各阶段耗时 | T02、T04、T07–T11、T13–T17 |
| 模型调用记录 `llm_calls` | 真实模型走查时用来看 token 量、耗时和错误类别。只写记录，不做用量界面 | T04、T08 |
| 同一数据目录只允许一个 core | 架构硬规则；验收反复重启 core，两个进程同时写库会损坏进度（[架构总览 §2](../docs/architecture.md#2-进程模型)） | T04 |
| 测试用的伪 OpenAI 服务 | 验收要求端到端测试“从界面配置模型开始”，配置走的是真实 HTTP，pi-ai 的进程内伪服务商接不进去 | T05 |
| 开场结束时的场景 | `turns.scene` 不能为空，续写的上下文也要“当前场景”，所以预览要一并产出地点和时间 | T09 |
| 作品语言 | 续写用作品语言写；预览按背景所用的语言定下（[i18n §6](../docs/i18n.md#6-作品语言)） | T09 |
| OpenCode Go 的请求头 | 维护者很可能用自定义端点接 OpenCode Go 做真实走查，主机是 `opencode.ai` 的请求要带 User-Agent 和会话头（[LLM 端点 §5](../docs/llm-endpoints.md#5-opencode-go)） | T08 |
| 令牌失效后的提示 | 每次重启 core 都换令牌，旧标签页的请求会被拒绝。页面要切到“从新地址打开”的说明，而不是一直报错 | T11 |
| 采用开场后草稿只读 | 发布后改稿推迟了，创作页要明确显示“已存入作品库”，不再允许改背景 | T09、T13 |

### 1.3 明确推迟（不做）

下面这些在设计文档里有，但本里程碑不做。执行者遇到相关代码路径时，不要顺手实现。

| 推迟项 | 理由 |
| --- | --- |
| `ask_clarification`、`needs_clarification` 状态的界面 | 验收不涉及澄清；表结构照设计建好，状态值保留 |
| 未发送输入的自动保存（`routes.draft_input`） | 验收不涉及；列照设计建好 |
| 失败后“改写行动”按钮 | 失败后输入框仍可用，玩家可以直接写新行动；“重试”已满足验收 |
| ⌘1–⌘9、⌘S、⌘, 快捷键 | 键盘走查用 Tab 和 Enter 就能完成主路径 |
| 伪语言 `pseudo` | 文案键测试和 oxlint 规则已能挡住绕过 i18n 的文案 |
| 外观与阅读偏好的设置界面、`settings.get/update` | 首屏按默认偏好渲染，外观跟随系统 |
| 删除端点、“用界面配置覆盖坏文件”、查找模型、能力字段的手填 | 里程碑只要求新增、修改、测试、设默认；上下文窗口未知时按 32,768 处理（[LLM 端点 §8](../docs/llm-endpoints.md#8-调用预算与错误)） |
| 后台摘要、全文索引、故事事实表、只读工具 | 里程碑已推迟 |
| 长剧情虚拟化 | 验收只有几回合；整条路线一次加载 |
| 模型用量和诊断查看界面 | 样本和事件可直接查询 SQLite。首个里程碑的验收需要数据和分析口径 |
| husky、lint-staged、GitHub Actions | 提交前由编排者在本机跑全量检查；CI 在桌面交付时一起做 |
| `contracts/desktop.ts` 与 desktop 进程消息 | 本里程碑没有 desktop |
| 包内 README | 根目录 [AGENTS.md §9](../AGENTS.md#9-源码目录的-readme) 规定了写法，但不是必需；等包的边界稳定后再写 |

### 1.4 需要维护者拍板的决定（本文先按推荐项写）

| 编号 | 问题 | 本文采用 | 其他做法 |
| --- | --- | --- | --- |
| D1 | Drizzle 的 `node:sqlite` 驱动只在 1.0 预发布版里有。稳定版 0.45 没有这个驱动，技术选型里“原生支持 `node:sqlite`”的说法对稳定版不成立 | `drizzle-orm` 与 `drizzle-kit` 用 `1.0.0-rc.6`，驱动用 `drizzle-orm/node-sqlite` | 稳定版 0.45 + better-sqlite3（成熟，但要为 Node 和 Electron 各编一次原生模块）；稳定版 0.45 + `sqlite-proxy` 包一层 `node:sqlite`（异步接口，事务写法别扭） |
| D2 | pi-ai 的 npm 包已经改名。`@mariozechner/pi-ai` 停在 0.73，1.x 在 `@earendil-works/pi-ai` 下 | `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` 的 1.6 | 无 |
| D3 | 预览是里程碑特有的生成任务，`jobs.kind` 里没有它 | 新增 `kind = 'preview'`，写进[创作工作站 §9](../docs/author-workstation.md#9-生成任务)和 §13 | 复用 `opening`：语义不同，后续做完整向导时要拆开 |
| D4 | 设计写“不跟随重定向（`redirect: "error"`）”。`"error"` 抛出的是笼统的网络错误，分不出是不是重定向 | 统一的 `fetch` 封装用 `redirect: "manual"`，收到 301/302/303/307/308 就抛出 `redirected`；效果同样是不跟随 | 保持 `"error"`，靠错误信息字符串猜 |
| D5 | 技术选型要求 Node 24（和 Electron 45 内置的一致），本机装的是 Node 26 | `.node-version` 写 `24`，各包 `engines` 写 `">=24"`，本机 26 也能跑 | 严格锁 24：本机要装 24 |

D1–D4 由 T00 在维护者确认后落入设计文档。T01 在确认 D1、D2、D5 后锁定依赖和 Node 版本。这里的勾选框跟踪实现进度。

---

## 2. 贯穿全局的约定

### 2.1 命名

- 分层叫 client、core、contracts，不说前端、后端。包名：`@unwritten/client`、`@unwritten/core`、`@unwritten/contracts`、`@unwritten/e2e`。
- 领域词按 [docs/AGENTS.md §4.1](../docs/AGENTS.md#41-术语对照表)：作品、版本、草稿、发布版本、开场、开局、回合、路线。代码里对应 `work`、`version`、`draft`、`published`、`opening`、`playthrough`、`turn`、`route`。
- 文件名：TypeScript 模块用 kebab-case（`providers-file.ts`），React 组件用 PascalCase（`PlayPage.tsx`），CSS Module 和组件同名（`PlayPage.module.css`），hook 用 camelCase（`useEnterToSubmit.ts`）。
- 数据库列用 snake_case，Drizzle 字段用 camelCase。

### 2.2 id、时间、JSON

- id 一律 `crypto.randomUUID()`。自定义端点的 id 例外，格式见 T08。
- 时间一律存毫秒整数 `Date.now()`，列类型 `INTEGER`。显示时用 `Intl.RelativeTimeFormat` 或 `Intl.DateTimeFormat`。
- JSON 列用 Drizzle 的 `text(..., { mode: "json" })`。写进 JSON 列的对象，形状由 `packages/core/src/store/meta.ts` 的 Zod schema 定义。

### 2.3 错误码

- 全部错误码只在 `packages/contracts/src/errors.ts` 的 `ERROR_CODES` 里列一次（T02 给出完整清单）。
- core 抛错一律用 `appError(code, message, detail)`（T04 的 `packages/core/src/errors.ts`），它构造 oRPC 的 `ORPCError`：`code` 是我们的错误码，`message` 只给开发者看，`data.detail` 是可以显示给用户的原始详情（例如模型服务返回的错误原文，已脱敏），没有就是 `null`。
- 回合请求和生成任务的失败原因（`turn_requests.error`、`jobs.error`）也是 `ERROR_CODES` 里的码。
- client 显示错误：`errors:<code>`；查不到时显示 `errors:unknown` 并带上 code（[i18n §5](../docs/i18n.md#5-core-返回什么)）。`message` 永远不显示。`detail` 放在“详细信息”下面原样显示。

### 2.4 i18n

- 库：i18next + react-i18next。文件：`apps/client/src/i18n/zh-CN/<命名空间>.json`。
- 命名空间：`common`、`errors` 随首屏加载；`library`、`authoring`、`play`、`settings` 按需加载。本里程碑不用 `workstation`。
- 调用时永远写完整键：`t("play:input.submit")`。不写 `useTranslation("play")` 之后的短键，因为文案键测试按完整键扫描源码。
- 键名格式 `<命名空间>:<区域>.<元素>[.<状态>]`。JSON 文件里按点号嵌套。
- 不拼接字符串组句，用插值：`t("library:card.updated", { time })`。
- 数量用 `count`：`t("play:turn.heading", { count: depth })`。
- 动态键只允许一处：`errors:${code}`。别处一律写静态键，否则文案键测试查不出没用到的键。
- 每个页面任务只往自己的命名空间加键；`common` 和 `errors` 的键由 T06 一次写全。全部文案见附录 A，照抄，不自己改写措辞。需要附录 A 之外的新键时，按[设计准则 §8](../docs/design-guidelines.md#8-文案语气)的语气写，并在汇报里列出。
- 作品标题、背景、正文、选项、玩家输入、端点名、模型 id、模型返回的错误原文都是数据，原样显示，不过 `t()`。
- core 给模型的提示词是内部实现，写在 core 里的常量中，不走 i18n。

### 2.5 运行诊断与性能记录

持久化位置、保留期、字段边界和计时起止点以[运行诊断与性能记录](../docs/diagnostics.md)为准。T04 实现唯一的 SQLite 写入入口。T02 规定 client 允许上报的字段，T07 接入，T11 提供 client 记录和计时入口，各页面在对应操作的完成点交样本。`--log-level` 只过滤运行事件。

| event | module | 级别 | 专用字段或关联 ID | 谁写 |
| --- | --- | --- | --- | --- |
| `core.started` / `core.stopped` | core | info | 启动事件带 `port` | T07 |
| `core.start_failed` | core | error | `stage`（`data_dir`、`library`、`services`、`recover`、`assets`、`listen`）和稳定错误码 | T07 |
| `store.migrated` / `store.locked` | core | info / error | 无 | T07 |
| `client.assets.missing` | core | warn | 无 | T07 |
| `http.rejected` | api | warn | `reason`（`host` / `origin` / `token`） | T07 |
| `rpc.failed` / `rpc.crashed` | api | warn / error | 已注册的 `procedure`、`code` | T07 |
| `client.error` | client | error | `area`、`code` | T07、T11 |
| `llm.config.loaded` / `llm.config.written` | llm | info | 配置状态、修订号前缀 | T08 |
| `llm.call` | llm | info | `callId`、请求或任务 ID、`status`、`code` | T08 |
| `llm.test` | llm | info | `ok`、`code` | T08 |
| `preview.job.started` / `.done` / `.failed` | authoring | info / info / warn | `workId`、`jobId`、`code` | T09 |
| `work.adopted` | authoring | info | `workId`、`jobId`、`routeId` | T09 |
| `turn.request.submitted` | play | info | `requestId`、`routeId`、`attempt` | T10 |
| `turn.request.done` / `.failed` / `.superseded` | play | info / warn / info | `requestId`、`attempt`、`turnId`（成功）、`code`（失败） | T10 |
| `recovery.interrupted` | core | info | `turnRequests`、`jobs` | T07 |
| `diagnostics.dropped` | core | warn | 丢弃条数 `count` | T04 |

| 性能样本 | 归属 |
| --- | --- |
| `core.startup`、`core.library_open`、`core.recover` | T07 |
| `llm.connection_test`、`llm.first_output` | T08 |
| `preview.total`、`preview.queue`、`preview.validate`、`preview.commit` | T09 |
| `turn.total`、`turn.queue`、`turn.context`、`turn.validate`、`turn.commit` | T10 |
| `client.library_ready`、`client.preview_visible`、`client.turn_visible` | T11 提供计时和上报入口，T13–T14 在页面接入 |

### 2.6 安全

- core 只监听 `127.0.0.1`。令牌每次启动重新生成，只在内存和 stdout 里出现。
- 每个 `/api` 请求都校验 `Authorization: Bearer <令牌>`；所有请求都校验 `Host`；带 `Origin` 的请求校验同源（[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)）。core 不返回任何 CORS 头。
- `index.html` 带内容安全策略头，nonce 每次请求重新生成。
- core 所有外发请求都经过 `llm` 模块的 `fetch` 封装，不跟随重定向。
- key 不出 core：所有接口只返回 `hasKey` 和 `keySource`。

### 2.7 测试

| 层 | 工具 | 放哪里 | 命名 |
| --- | --- | --- | --- |
| contracts、core 单元与集成 | Vitest（Node 环境） | 和被测文件放在一起 | `*.test.ts` |
| client 纯逻辑 | Vitest（Node 环境，项目名 `unit`） | 同上 | `*.test.ts` |
| client 组件 | Vitest 浏览器模式（项目名 `browser`，Chromium）+ `vitest-browser-react` + axe-core | 同上 | `*.test.tsx` |
| 端到端 | Playwright，浏览器打开独立运行的 core | `e2e/tests/` | `*.spec.ts` |

- 查元素用角色和名称（`getByRole`）。
- 测试里的故事内容全部虚构。测试名写约束本身，例如 `"重复提交同一个 requestId 只产生一个回合"`。
- 需要模型的测试一律用伪服务：core 的单元测试用 `createScriptedLlm`（T04），core 集成测试和端到端测试用伪 OpenAI 服务（T05）。不调用真实模型。

## 3. 任务依赖与并行波次

```
W1   T00 设计补洞（与 T01 共用 §1.4 中已确认的选型）
     T01 仓库脚手架
      │
W2   ├─ T02 contracts（依赖 T01）
     └─ T05 伪 OpenAI 服务（依赖 T01）
      │
W3   ├─ T03 client 主题 token（依赖 T02）
     ├─ T04 core 地基（依赖 T02）
     └─ T06 client i18n（依赖 T02）
      │
W4   ├─ T07 core HTTP 层（依赖 T04）
     ├─ T08 core llm 模块（依赖 T04、T05）
     ├─ T09 core 作品库与预览（依赖 T04 与 T00 的预览任务契约）
     ├─ T10 core 回合循环（依赖 T04）
     └─ T11 client 外壳（依赖 T03、T06）
      │
W5   ├─ T12 设置页 ┐
     ├─ T13 作品库与创作页 ├（依赖 T11；只依赖契约，可以和 W4 的 core 任务同时）
     └─ T14 阅读页 ┘
      │
W6   T15 core 入口装配与集成测试（依赖 T07–T10）
      │
W7   T16 端到端测试（依赖 T15、T12–T14）
      │
W8   T17 真实模型走查与收口
```

| 任务 | 依赖 | 可同时执行的任务 | 预计规模 |
| --- | --- | --- | --- |
| T00 | 维护者确认 §1.4 | T01 | 小 |
| T01 | 维护者确认 D1、D2、D5 | T00 | 中 |
| T02 | T01 | T05 | 中 |
| T03 | T01、T02 | T05、T04、T06 | 中 |
| T04 | T02 | T03、T05、T06 | 中 |
| T05 | T01 | T02、T03、T04、T06 | 中 |
| T06 | T02 | T03、T04、T05 | 小 |
| T07 | T04 | T08、T09、T10、T11 | 中 |
| T08 | T04、T05 | T07、T09、T10、T11 | 大 |
| T09 | T04、T00 | T07、T08、T10、T11 | 中 |
| T10 | T04 | T07、T08、T09、T11 | 大 |
| T11 | T03、T06 | T07–T10 | 中 |
| T12 | T11 | T13、T14、T07–T10 | 中 |
| T13 | T11 | T12、T14、T07–T10 | 中 |
| T14 | T11 | T12、T13、T07–T10 | 中 |
| T15 | T07、T08、T09、T10 | T12–T14 | 中 |
| T16 | T15、T12、T13、T14 | 无 | 大 |
| T17 | T16 | 无 | 小 |

关键路径是 T01 → T02 → T04 → T08 / T10 → T15 → T16。T09、T10 不等 T08：它们只依赖 T04 定下的 `LlmService` 接口，单元测试用 `createScriptedLlm`。

**接口先行。** core 各模块之间的接口（`services.ts`、`llm/types.ts`）和 client 与 core 之间的契约（contracts）都在本文里写死了，所以下游任务可以在上游实现完成前开工。实现时如果发现接口必须改，停下来汇报，不要单方面改。

---

## 4. 文件总表

“归属”指哪个任务创建并拥有这个文件。只有归属任务能改它；标了“→”的表示所有权在后续任务转交（前一个任务写占位，后一个任务覆盖）。

### 4.1 根目录

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json` | 根脚本（统一经 turbo 调度）、根开发依赖、`packageManager` | T01 |
| `pnpm-workspace.yaml` | workspace 列表与 catalog（全仓唯一的版本来源） | T01 |
| `pnpm-lock.yaml` | 锁文件，由 pnpm 生成 | T01 |
| `turbo.json` | 任务编排：`build`、`typecheck`、`test`、`//#lint` | T01 |
| `tsconfig.base.json` | 各包 tsconfig 继承的公共配置 | T01 |
| `.node-version` | Node 主版本 `24` | T01 |
| `.prettierrc.json` | Prettier 配置 | T01 |
| `.oxlintrc.json` | oxlint 配置：规则、JS 插件、按路径覆盖、依赖方向 | T01 |
| `stylelint.config.mjs` | Stylelint 配置：只用 token、禁颜色字面量、逻辑属性、禁 `transition: all` | T01 |
| `scripts/lint/oxlint-plugin-unwritten.mjs` | 自写的 oxlint JS 插件：JSX `style` 只允许 `--` 开头的键 | T01 |
| `tasks/milestone-1.md` | 本文件 | 编排者 |
| `packages/tokens/tokens.json`、`packages/tokens/build-css.mjs`、`packages/tokens/build-css.test.mjs`、`scripts/check-tokens.mjs` | token 单源、web 导出与契约检查 | 设计交接 → T03 |

### 4.2 `packages/contracts`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json`、`tsconfig.json` | 包定义；`exports` 直接指向 `src/index.ts` | T01 |
| `src/index.ts` | 汇总导出：`contract`、全部 schema 与类型 | T01 → T02 |
| `src/errors.ts` | `ERROR_CODES`、`ErrorCodeSchema`、`ErrorDataSchema` | T02 |
| `src/errors.test.ts` | 错误码唯一、格式为 snake_case | T02 |
| `src/schemas/common.ts` | 通用 schema：uuid、时间戳、修订号、语言标签 | T02 |
| `src/schemas/llm.ts` | 模型设置相关的输入输出 schema | T02 |
| `src/schemas/works.ts` | 作品库、草稿、预览任务的 schema | T02 |
| `src/schemas/play.ts` | 回合、路线、回合请求的 schema | T02 |
| `src/schemas/appearance.ts` | 外观偏好的枚举、默认值、`appearanceAttributes()` | T02 |
| `src/schemas/log.ts` | `log.client` 的输入 schema | T02 |
| `src/events.ts` | 事件流的事件类型 `CoreEventSchema` | T02 |
| `src/procedures/llm.ts`、`works.ts`、`play.ts`、`events.ts`、`log.ts` | oRPC 契约，按领域分文件 | T02 |

### 4.3 `packages/core`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json`、`tsconfig.json`、`tsdown.config.ts`、`vitest.config.ts`、`drizzle.config.ts` | 包定义、构建、测试、迁移生成配置 | T01 |
| `src/main.ts` | 进程入口：先装 fetch 守卫，再解析参数、启动、处理退出信号 | T01 → T15 |
| `src/cli.ts` | 解析命令行参数 | T04 |
| `src/errors.ts` | `appError()`：构造带我们错误码的 `ORPCError`；错误码到 HTTP 状态的映射 | T04 |
| `src/services.ts` | 各模块服务的接口与工厂类型（只有类型） | T04 |
| `src/log/logger.ts`、`src/log/schema.ts`、`src/log/migrations/`、`drizzle.diagnostics.config.ts` | 打开独立诊断库、生成迁移、校验并批量写入运行事件和性能样本 | T04 |
| `src/log/scrub.ts` | `scrubSecrets()`：从文本里抹掉 key | T04 |
| `src/store/db.ts` | 打开 SQLite、设置 pragma、独占锁、执行迁移、导出 `Database` 类型 | T04 |
| `src/store/schema.ts` | 全部表的 Drizzle 定义 | T04 |
| `src/store/meta.ts` | JSON 列的 Zod schema 与类型（版本 meta、回合动作、场景、预览任务的输入和结果） | T04 |
| `src/store/migrations/` | drizzle-kit 生成的迁移 | T04 |
| `src/events/bus.ts` | 进程内事件总线 | T04 |
| `src/text/turn-text.ts` | 共享文本工具：`normalizeProse`、`parseJsonLines`、`parseOptionLines`、`ParseResult` | T04 |
| `src/llm/types.ts` | `LlmTool`、`LlmRunInput`、`ResolvedModel`、`LlmRunError` 等类型 | T04 |
| `src/test-support/scripted-llm.ts` | 单元测试用的假 `LlmService` | T04 |
| `src/test-support/temp-dir.ts` | 建、删临时数据目录 | T04 |
| `src/test-support/fake-openai-server.ts` | 伪 OpenAI 兼容服务（HTTP） | T05 |
| `src/test-support/llm-steps.ts` | 构造伪服务脚本步骤的帮助函数 | T05 |
| `src/test-support/index.ts` | 汇总导出测试支持代码 | T05 |
| `src/api/http-app.ts` | Hono 应用：安全中间件、静态文件、挂载 oRPC | T07 |
| `src/api/security.ts` | Host、Origin、令牌校验 | T07 |
| `src/api/client-assets.ts` | 读取 client 构建产物，渲染带 nonce 和外观属性的 `index.html`，生成内容安全策略头 | T07 |
| `src/api/router.ts` | 用 `implement(contract)` 实现全部过程，调用各服务 | T07 |
| `src/app.ts` | `startCore()`：按顺序建日志、库、总线、服务、HTTP，返回地址和关闭函数 | T07 |
| `src/llm/fetch-guard.ts` | 不跟随重定向的 `fetch` 封装；记录本次调用的 HTTP 状态 | T08 |
| `src/llm/fetch-guard-install.ts` | 副作用模块：替换全局 `fetch` | T08 |
| `src/llm/providers-schema.ts` | `providers.json` 的 Zod schema | T08 |
| `src/llm/providers-file.ts` | 读、校验、算修订号、原子写入、写入排队 | T08 |
| `src/llm/url.ts` | 整理端点地址 | T08 |
| `src/llm/endpoint-id.ts` | 生成自定义端点 id | T08 |
| `src/llm/keys.ts` | `$VAR` 写法解析、key 状态 | T08 |
| `src/llm/budget.ts` | 长度估算、默认预算 | T08 |
| `src/llm/classify.ts` | 把一次失败归到错误类别 | T08 |
| `src/llm/pi.ts` | 唯一导入 pi-ai 和 pi-agent-core 的文件 | T08 |
| `src/llm/run.ts` | `run()`：工具循环、超时、重试一次、写 `llm_calls` | T08 |
| `src/llm/test-connection.ts` | 测试连接 | T08 |
| `src/llm/service.ts` | `createLlmService()`：组装上面的部分，实现 `LlmService` | T08 |
| `src/library/service.ts` | `createLibraryService()`：作品列表、新建、读取、保存背景 | T09 |
| `src/authoring/preview-tool.ts` | `propose_preview` 的 schema、解析与校验 | T09 |
| `src/authoring/preview-prompt.ts` | 预览用的系统提示与用户消息 | T09 |
| `src/authoring/service.ts` | `createAuthoringService()`：生成预览任务、采用预览 | T09 |
| `src/play/chain.ts` | 沿祖先链取回合 | T10 |
| `src/play/narrator-prompt.ts` | narrator 的系统提示 | T10 |
| `src/play/context.ts` | 按预算组装续写的用户消息 | T10 |
| `src/play/propose-turn-tool.ts` | `propose_turn` 的 schema、解析与校验 | T10 |
| `src/play/service.ts` | `createPlayService()`：读路线、提交行动、重试、执行队列、提交事务 | T10 |
| `src/app.integration.test.ts` | 用伪 OpenAI 服务跑通整条链路 | T15 |

### 4.4 `apps/client`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`index.html` | 包定义、构建（含首屏脚本插件）、测试配置、HTML 模板 | T01 |
| `src/theme/boot.inline.js` | 首屏前把外观偏好解析成 `data-uw-theme` 的内联脚本 | T01 |
| `src/main.tsx` | 入口：读令牌、装全局错误上报、挂载 React | T01 → T11 |
| `src/theme/global.css`、`tokens.css`、`media.css`、`themes/*.css` | 全局基础样式及由 JSON 生成的 CSS | T03 |
| `src/theme/appearance.ts` | `applyAppearance()`：首屏之后唯一写根属性的入口 | T03 |
| `src/theme/appearance.test.ts` | 首屏与后续外观切换测试 | T03 |
| `src/i18n/index.ts`、`backend.ts` | i18next 初始化与按需加载 | T06 |
| `src/i18n/zh-CN/*.json` | 文案。`common`、`errors` 归 T06；其余四个由 T06 建空文件，再转交页面任务 | T06 → T12、T13、T14 |
| `src/i18n/keys.test.ts` | 文案键测试：用到的键都存在；错误码与 `errors` 一一对应 | T06 |
| `src/app/App.tsx`、`router.tsx`、`NoTokenPage.tsx` | Provider 组装、路由实例、无令牌说明页 | T11 |
| `src/routes/__root.tsx`、`index.tsx`、`settings.tsx`、`works.$workId.edit.tsx`、`play.$routeId.tsx` | TanStack Router 的文件路由 | T11 |
| `src/routeTree.gen.ts` | 路由插件生成，不手改 | T11（生成） |
| `src/shared/api/*` | 令牌、oRPC 客户端、查询客户端、事件流分发、错误显示 | T11 |
| `src/shared/ui/*` | 共享组件：Button、TextField、TextArea、Page、Toolbar、BackLink、PageHeading、LiveRegion、VisuallyHidden、Notice、Badge、GeneratingMarker | T11 |
| `src/shared/hooks/useEnterToSubmit.ts` | 输入框 Enter 发送、Shift+Enter 换行、组字时不发送 | T11 |
| `src/shared/lib/log.ts`、`format.ts` | 向 core 上报结构化错误和耗时；相对时间格式化 | T11 |
| `src/features/library/*` | 作品库页 | T11 → T13 |
| `src/features/authoring/*` | 创作页：背景、预览、采用 | T11 → T13 |
| `src/features/play/*` | 阅读页 | T11 → T14 |
| `src/features/settings/*` | 模型设置页 | T11 → T12 |

### 4.5 `e2e`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json`、`playwright.config.ts` | 包定义与 Playwright 配置 | T01 |
| `fixtures/core-process.ts` | 用子进程启动、停止、强杀独立运行的 core | T16 |
| `fixtures/api.ts` | 测试里直接调 core 接口的客户端 | T16 |
| `fixtures/test.ts` | 扩展 Playwright 的 `test`：临时数据目录、伪 OpenAI 服务、core 进程 | T16 |
| `tests/*.spec.ts` | 端到端用例 | T16 |

---

## 5. 任务

每个任务的固定结构：**目的 / 依赖 / 拥有的文件 / 先读 / 步骤 / 注意事项 / 完成判据**。

### T00 设计补洞：把 §1.4 的决定写进 docs

**目的。** 仓库规定设计以 `docs/` 为准，代码与文档冲突时先改文档（[AGENTS.md §6](../AGENTS.md#6-项目事实)）。§1.4 的 D1–D4 和本拆解新增的几个约定（事件总线模块、core 的命令行参数）要先落进设计文档，后续任务才有据可依。

**依赖。** 维护者确认 §1.4。维护者改选了其他做法时，按维护者的选择改写下面的步骤，并同步修改本文受影响的任务。

**拥有的文件。** `docs/tech-stack.md`、`docs/llm-endpoints.md`、`docs/author-workstation.md`、`docs/architecture.md`、`apps/client/AGENTS.md`、`tasks/milestone-1.md`。

**先读。** [docs/AGENTS.md](../docs/AGENTS.md) 全文，尤其是 §2 写作原则和 §3 审计。

**步骤。**

- [ ] 1. `docs/tech-stack.md` §2 总览表的 core 行：把 `Drizzle ORM + drizzle-kit` 改成 `Drizzle ORM 1 + drizzle-kit 1`。
- [ ] 2. `docs/tech-stack.md` §7 的 Drizzle 行，“理由”一列末尾加一句：`node:sqlite` 驱动是 `drizzle-orm/node-sqlite`，从 1.0 起提供，所以 drizzle-orm 和 drizzle-kit 都用 1.x。
- [ ] 3. `docs/tech-stack.md` §7 的 pi-ai 行，“用途”一列改成：调用模型、工具调用循环。npm 包是 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`。
- [ ] 4. `docs/tech-stack.md` §11 目录结构，在 `packages/core/src/` 下补两行，位置放在 `log/` 之后：
  ```
  │     │  ├─ events/               进程内事件总线：各模块发布变更，事件流过程订阅
  │     │  └─ test-support/         测试支持代码：伪 OpenAI 服务、脚本化的 llm，不进构建产物
  ```
  同时把原来 `log/` 那一行的 `└─` 改成 `├─`，保持树形正确。
- [ ] 5. `docs/llm-endpoints.md` §3 “保护规则”里以“经 `llm` 模块出去的请求一律不跟随重定向”开头的那一条：把括号里的 `` （`redirect: "error"`） `` 改成 `` （统一的 `fetch` 封装以 `redirect: "manual"` 发请求，收到 301、302、303、307、308 时丢弃响应体，以 `redirected` 失败） ``。这一条其余内容不动。
- [ ] 6. `docs/author-workstation.md` §9 的任务表加一行，放在 `trial_extract` 之后：
  ```
  | `preview`：一次生成标题、简介、公开设定、开场正文、推荐行动和开场场景 | `narrator` | 任务自己的 `result`；作者采用时写入草稿并发布（[第一个里程碑](./milestone-1.md)） |
  ```
- [ ] 7. `docs/author-workstation.md` §13 的 `jobs` 表，`kind` 那一行的注释改成 `-- plan | opening | title_blurb | trial_extract | preview`。
- [ ] 8. `docs/architecture.md` §4 的模块表加一行，放在 `api` 之前：`| \`events\` | 进程内事件总线：各模块发布变更通知，事件流过程订阅后推给 client |`。
- [ ] 9. `docs/architecture.md` §2.2 第一段改成：
  ```
  `node packages/core/dist/main.js --data-dir <目录> [--port <端口>] [--client-dir <目录>] [--client-origin <地址>] [--log-level <级别>]` 会启动 core，并在 stdout 打印一行 `UNWRITTEN_CORE_URL=<带令牌的地址>`，用浏览器打开这个地址即可使用。`--client-dir` 指定 client 构建产物的目录，默认是仓库里的 `apps/client/dist`；`--client-origin` 只改变打印出的地址的源，开发时传 Vite 开发服务器的地址；`--log-level` 默认 `info`。这个模式有两个用途：开发调试，以及将来 web 客户端的基础。部署成多人使用的服务需要真正的账号鉴权，这不在本设计范围内。
  ```
- [ ] 10. 运行 `node scripts/check-doc-links.mjs`，必须通过。
- [ ] 11. 按 [docs/AGENTS.md §3](../docs/AGENTS.md#3-审计) 对本次新增的行跑三遍扫描，逐条判断命中。
- [ ] 12. `docs/llm-endpoints.md` §2 的自定义端点 id 改成“6 位十六进制，取自创建请求 id 的哈希”；§5 的 OpenCode Go 请求头改成由 `llm` 模块补充；§8 的 `run` 入参改成 `LlmRunInput` 的字段。
- [ ] 13. `apps/client/AGENTS.md` §6 的令牌规则改成“启动地址的 hash 是唯一例外”。
- [ ] 14. 同步修正本文 T01、T04、T07、T08、T10、T12、T16 中与本次决定冲突的步骤。
- [ ] 15. 再运行一次 `node scripts/check-doc-links.mjs`，必须通过。

**注意事项。**

- 直接写成现在时，不写“新增”“改为”“里程碑一”之类的过程词。
- 不改上面没列出的段落。看到其他问题，写进汇报。
- 这些文件的工作树里可能有维护者未提交的改动（`git status` 会显示）。只改上面列出的句子，不碰别的行。

**完成判据。**

- `node scripts/check-doc-links.mjs` 输出“链接检查通过”。
- `git diff docs/` 只包含本任务列出的改动。
- 三遍扫描的命中都已逐条判断，汇报里列出命中和判断结论。

### T01 仓库脚手架与工具链

**目的。** 一次搭好全部包、配置和依赖，后续任务不再改 `package.json` 和 catalog，这样并行的工作树之间不会冲突。同时验证三件关键的事：TypeScript 7 能检查全仓；Node 能直接运行 core 的 TypeScript 源码（包括从 workspace 导入 contracts 的源码）；构建产物的结构符合 core 的预期。

**依赖。** 维护者确认 §1.4 的 D1、D2、D5。

**拥有的文件。** §4 里归属 T01 的全部文件。

**先读。** [技术选型](../docs/tech-stack.md) §1–§3、§8–§11；[架构总览 §7](../docs/architecture.md#7-目录结构)；根目录 [AGENTS.md](../AGENTS.md) §6–§8。

**步骤。**

- [ ] 1. 确认环境：`node -v`（≥ 24）、`pnpm -v`（12.x）。
- [ ] 2. 写 `.node-version`，内容是一行 `24`。
- [ ] 3. 写 `pnpm-workspace.yaml`：

  ```yaml
  packages:
    - apps/*
    - packages/*
    - e2e
  catalog:
    "@axe-core/playwright": 4.14.1
    "@babel/core": 7.29.13
    "@base-ui/react": 1.9.0
    "@earendil-works/pi-agent-core": 1.6.0
    "@earendil-works/pi-ai": 1.6.0
    "@hono/node-server": 2.1.11
    "@hookform/resolvers": 7.0.9
    "@orpc/client": 1.16.6
    "@orpc/contract": 1.16.6
    "@orpc/server": 1.16.6
    "@orpc/tanstack-query": 1.16.6
    "@playwright/test": 1.65.1
    "@rolldown/plugin-babel": 0.3.1
    "@tanstack/react-query": 5.108.4
    "@tanstack/react-router": 1.170.46
    "@tanstack/router-plugin": 1.169.0
    "@types/node": 24.19.4
    "@types/react": 19.3.2
    "@types/react-dom": 19.3.0
    "@vitejs/plugin-react": 6.3.0
    "@vitest/browser-playwright": 5.1.2
    axe-core: 4.14.1
    babel-plugin-react-compiler: 1.0.0
    drizzle-kit: 1.0.0-rc.6
    drizzle-orm: 1.0.0-rc.6
    eslint-plugin-i18next: 6.1.5
    eslint-plugin-react-hooks: 7.1.1
    hono: 4.13.22
    i18next: 27.2.9
    lightningcss: 1.33.0
    lucide-react: 1.80.0
    oxlint: 1.95.0
    oxlint-tsgolint: 7.0.2008
    p-queue: 10.0.0
    playwright: 1.65.1
    prettier: 3.10.1
    react: 19.3.1
    react-dom: 19.3.1
    react-hook-form: 7.92.0
    react-i18next: 18.0.3
    stylelint: 18.1.0
    stylelint-config-standard: 41.1.0
    stylelint-declaration-strict-value: 1.13.0
    stylelint-use-logical: 2.1.3
    tsdown: 0.23.7
    turbo: 2.11.13
    typescript: 7.0.2
    vite: 8.3.8
    vitest: 5.1.2
    vitest-browser-react: 2.3.0
    zod: 4.6.7
  ```

  这些是写本文时 npm 上的最新版本。开工时用 `pnpm view <包名> version` 逐个核一遍；有更新的补丁版或次版本可以用，有新的主版本时不升级，写进汇报。

- [ ] 4. 写根目录 `package.json`：

  ```json
  {
    "name": "unwritten",
    "private": true,
    "type": "module",
    "packageManager": "pnpm@12.21.0",
    "engines": { "node": ">=24" },
    "scripts": {
      "build": "turbo run build",
      "typecheck": "turbo run typecheck",
      "lint": "oxlint --type-aware && stylelint \"apps/client/src/**/*.css\" --allow-empty-input",
      "test": "node scripts/check-tokens.mjs && node --test packages/tokens/build-css.test.mjs && turbo run test",
      "e2e": "turbo run build && pnpm --filter @unwritten/e2e e2e",
      "format": "prettier --write apps packages e2e scripts \"*.json\"",
      "format:check": "prettier --check apps packages e2e scripts \"*.json\"",
      "check:docs": "node scripts/check-doc-links.mjs",
      "dev:core": "pnpm --filter @unwritten/core dev",
      "dev:client": "pnpm --filter @unwritten/client dev"
    },
    "devDependencies": {
      "@types/node": "catalog:",
      "eslint-plugin-i18next": "catalog:",
      "eslint-plugin-react-hooks": "catalog:",
      "oxlint": "catalog:",
      "oxlint-tsgolint": "catalog:",
      "prettier": "catalog:",
      "stylelint": "catalog:",
      "stylelint-config-standard": "catalog:",
      "stylelint-declaration-strict-value": "catalog:",
      "stylelint-use-logical": "catalog:",
      "turbo": "catalog:",
      "typescript": "catalog:"
    }
  }
  ```

  `packageManager` 写本机 `pnpm -v` 的实际版本。根脚本 `lint` 不经过 turbo 调用自身：turbo 里的 `//#lint` 任务执行的就是这条根脚本，如果根脚本再调 `turbo run lint` 会无限递归。

- [ ] 5. 写 `turbo.json`：

  ```json
  {
    "$schema": "https://turborepo.com/schema.json",
    "tasks": {
      "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
      "@unwritten/client#build": {
        "dependsOn": ["^build"],
        "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/packages/tokens/tokens.json", "$TURBO_ROOT$/packages/tokens/build-css.mjs"],
        "outputs": ["dist/**"]
      },
      "typecheck": {},
      "test": {},
      "@unwritten/client#test": {
        "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/packages/tokens/tokens.json", "$TURBO_ROOT$/packages/tokens/build-css.mjs"]
      },
      "//#lint": {},
      "dev": { "cache": false, "persistent": true }
    }
  }
  ```

- [ ] 6. 写 `tsconfig.base.json`：

  ```json
  {
    "compilerOptions": {
      "target": "es2024",
      "lib": ["es2024"],
      "module": "nodenext",
      "moduleResolution": "nodenext",
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitOverride": true,
      "noFallthroughCasesInSwitch": true,
      "verbatimModuleSyntax": true,
      "erasableSyntaxOnly": true,
      "allowImportingTsExtensions": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "skipLibCheck": true,
      "noEmit": true,
      "types": []
    }
  }
  ```

- [ ] 7. 写 `.prettierrc.json`：`{ "printWidth": 120 }`。现有的 `scripts/check-doc-links.mjs` 用双引号、分号、120 列，Prettier 默认值正好一致。格式化范围只包括代码目录（见根脚本 `format`），不碰 `docs/` 和 Markdown，免得和本任务无关的文档出现大片格式改动。
- [ ] 8. 写 `packages/contracts`：
  - `package.json`：

    ```json
    {
      "name": "@unwritten/contracts",
      "version": "0.1.0",
      "private": true,
      "type": "module",
      "exports": { ".": "./src/index.ts" },
      "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run --passWithNoTests" },
      "dependencies": { "@orpc/contract": "catalog:", "zod": "catalog:" },
      "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
    }
    ```

  - `tsconfig.json`：`{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
  - `src/index.ts`：一行占位 `export const contract = {};`，T02 会整体替换。
- [ ] 9. 写 `packages/core`：
  - `package.json`：

    ```json
    {
      "name": "@unwritten/core",
      "version": "0.1.0",
      "private": true,
      "type": "module",
      "engines": { "node": ">=24" },
      "scripts": {
        "dev": "node --watch src/main.ts --data-dir ../../.data --port 4317 --client-origin http://localhost:5173 --log-level debug",
        "start": "node dist/main.js --data-dir ../../.data",
        "build": "tsdown",
        "typecheck": "tsc --noEmit",
        "test": "vitest run --passWithNoTests",
        "db:generate": "drizzle-kit generate"
      },
      "dependencies": {
        "@earendil-works/pi-agent-core": "catalog:",
        "@earendil-works/pi-ai": "catalog:",
        "@hono/node-server": "catalog:",
        "@orpc/contract": "catalog:",
        "@orpc/server": "catalog:",
        "@unwritten/contracts": "workspace:*",
        "drizzle-orm": "catalog:",
        "hono": "catalog:",
        "p-queue": "catalog:",
        "zod": "catalog:"
      },
      "devDependencies": {
        "@orpc/client": "catalog:",
        "@types/node": "catalog:",
        "drizzle-kit": "catalog:",
        "tsdown": "catalog:",
        "typescript": "catalog:",
        "vitest": "catalog:"
      }
    }
    ```

  - `tsconfig.json`：`{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "*.ts"] }`
  - `tsdown.config.ts`：

    ```ts
    import { defineConfig } from "tsdown";

    export default defineConfig({
      entry: ["src/main.ts"],
      format: "esm",
      platform: "node",
      target: "node24",
      outDir: "dist",
      clean: true,
      fixedExtension: false,
      noExternal: ["@unwritten/contracts"],
      copy: [
        { from: "src/store/migrations", to: "dist/migrations" },
        { from: "src/log/migrations", to: "dist/diagnostic-migrations" },
      ],
    });
    ```

    `noExternal` 让 contracts 的源码打进 core 的产物，因为 contracts 只导出 TypeScript 源码。`fixedExtension: false` 让产物叫 `main.js` 而不是 `main.mjs`，和架构文档里的启动命令一致。`copy` 的写法以 tsdown 的类型声明为准；`src/store/migrations` 和 `src/log/migrations` 先各放一个 `.gitkeep`。T04 生成两套独立迁移。
  - `vitest.config.ts`：

    ```ts
    import { defineConfig } from "vitest/config";

    export default defineConfig({
      test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30_000 },
    });
    ```

  - `drizzle.config.ts`：

    ```ts
    import { defineConfig } from "drizzle-kit";

    export default defineConfig({ dialect: "sqlite", schema: "./src/store/schema.ts", out: "./src/store/migrations" });
    ```

  - `src/main.ts`：占位，用来验证 Node 能直接运行 workspace 里的 TypeScript 源码：

    ```ts
    import { contract } from "@unwritten/contracts";

    console.log(`contract keys: ${Object.keys(contract).length}`);
    ```

- [ ] 10. 写 `apps/client`：
  - `package.json`：

    ```json
    {
      "name": "@unwritten/client",
      "version": "0.1.0",
      "private": true,
      "type": "module",
      "scripts": {
        "dev": "node ../../packages/tokens/build-css.mjs && vite",
        "build": "node ../../packages/tokens/build-css.mjs && vite build",
        "typecheck": "tsc --noEmit",
        "test": "node ../../packages/tokens/build-css.mjs && vitest run --passWithNoTests"
      },
      "dependencies": {
        "@base-ui/react": "catalog:",
        "@hookform/resolvers": "catalog:",
        "@orpc/client": "catalog:",
        "@orpc/contract": "catalog:",
        "@orpc/tanstack-query": "catalog:",
        "@tanstack/react-query": "catalog:",
        "@tanstack/react-router": "catalog:",
        "@unwritten/contracts": "workspace:*",
        "i18next": "catalog:",
        "lucide-react": "catalog:",
        "react": "catalog:",
        "react-dom": "catalog:",
        "react-hook-form": "catalog:",
        "react-i18next": "catalog:",
        "zod": "catalog:"
      },
      "devDependencies": {
        "@babel/core": "catalog:",
        "@rolldown/plugin-babel": "catalog:",
        "@tanstack/router-plugin": "catalog:",
        "@types/node": "catalog:",
        "@types/react": "catalog:",
        "@types/react-dom": "catalog:",
        "@vitejs/plugin-react": "catalog:",
        "@vitest/browser-playwright": "catalog:",
        "axe-core": "catalog:",
        "babel-plugin-react-compiler": "catalog:",
        "lightningcss": "catalog:",
        "playwright": "catalog:",
        "typescript": "catalog:",
        "vite": "catalog:",
        "vitest": "catalog:",
        "vitest-browser-react": "catalog:"
      }
    }
    ```

  - `tsconfig.json`：

    ```json
    {
      "extends": "../../tsconfig.base.json",
      "compilerOptions": {
        "lib": ["es2024", "dom", "dom.iterable"],
        "module": "esnext",
        "moduleResolution": "bundler",
        "jsx": "react-jsx",
        "types": ["vite/client", "node"]
      },
      "include": ["src", "vite.config.ts", "vitest.config.ts"]
    }
    ```

  - `index.html`：

    ```html
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Unwritten</title>
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
      </body>
    </html>
    ```

    `<html lang="zh-CN">` 和 `<head>` 两处字面量是 core 注入外观属性和首屏脚本的锚点（T07），不要改写，也不要给 `<head>` 加属性。
  - `src/theme/boot.inline.js`：

    ```js
    (function () {
      var root = document.documentElement;
      var preference = root.getAttribute("data-uw-appearance");
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var theme = preference === "dark" || (preference !== "light" && prefersDark) ? "dark" : "light";
      root.setAttribute("data-uw-theme", theme);
    })();
    ```

    它在首次绘制前运行，DOM 上因此永远不会出现 `data-uw-theme="system"`（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）。用 ES5 写法，是因为它不经过 Vite 转译，原样内联进 HTML。
  - `vite.config.ts`：

    ```ts
    import { readFileSync } from "node:fs";
    import { fileURLToPath } from "node:url";
    import { tanstackRouter } from "@tanstack/router-plugin/vite";
    import { appearanceAttributes, DEFAULT_APPEARANCE } from "@unwritten/contracts";
    import babel from "@rolldown/plugin-babel";
    import react, { reactCompilerPreset } from "@vitejs/plugin-react";
    import { defineConfig, type Plugin } from "vite";

    const CORE_DEV_ORIGIN = "http://127.0.0.1:4317";
    const BOOT_SCRIPT_PATH = fileURLToPath(new URL("./src/theme/boot.inline.js", import.meta.url));

    function bootScriptPlugin(): Plugin {
      return {
        name: "unwritten-boot-script",
        transformIndexHtml: {
          order: "pre",
          handler(html, context) {
            if (!context.server) return html;
            const script = readFileSync(BOOT_SCRIPT_PATH, "utf8");
            return html
              .replace('<html lang="zh-CN">', `<html lang="zh-CN" ${appearanceAttributes(DEFAULT_APPEARANCE)}>`)
              .replace("<head>", `<head><script>${script}</script>`);
          },
        },
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "boot.inline.js", source: readFileSync(BOOT_SCRIPT_PATH, "utf8") });
        },
      };
    }

    export default defineConfig({
      plugins: [
        tanstackRouter({ target: "react", autoCodeSplitting: true }),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
        bootScriptPlugin(),
      ],
      css: { transformer: "lightningcss", lightningcss: { drafts: { customMedia: true } } },
      build: { outDir: "dist", emptyOutDir: true, cssMinify: "lightningcss", modulePreload: { polyfill: false } },
      server: {
        port: 5173,
        strictPort: true,
        proxy: {
          "/api": {
            target: CORE_DEV_ORIGIN,
            changeOrigin: true,
            configure(proxy) {
              proxy.on("proxyReq", (proxyRequest) => {
                proxyRequest.setHeader("origin", CORE_DEV_ORIGIN);
              });
            },
          },
        },
      },
    });
    ```

    T02 完成前 `appearanceAttributes` 还不存在。T01 先在 `packages/contracts/src/index.ts` 的占位里临时导出这两个名字（`export const DEFAULT_APPEARANCE = {}; export function appearanceAttributes(_: unknown) { return ""; }`），T02 整体替换时给出真实实现。
  - `vitest.config.ts`：

    ```ts
    import { playwright } from "@vitest/browser-playwright";
    import { defineConfig, mergeConfig } from "vitest/config";
    import viteConfig from "./vite.config.ts";

    export default mergeConfig(
      viteConfig,
      defineConfig({
        test: {
          passWithNoTests: true,
          projects: [
            { extends: true, test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] } },
            {
              extends: true,
              test: {
                name: "browser",
                include: ["src/**/*.test.tsx"],
                browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }] },
              },
            },
          ],
        },
      }),
    );
    ```

  - `src/main.tsx`：占位 `import { createRoot } from "react-dom/client"; const container = document.getElementById("root"); if (container) createRoot(container).render(null);`，T11 整体替换。
- [ ] 11. 写 `e2e`：
  - `package.json`：

    ```json
    {
      "name": "@unwritten/e2e",
      "private": true,
      "type": "module",
      "scripts": { "e2e": "playwright test", "typecheck": "tsc --noEmit" },
      "devDependencies": {
        "@axe-core/playwright": "catalog:",
        "@orpc/client": "catalog:",
        "@playwright/test": "catalog:",
        "@types/node": "catalog:",
        "typescript": "catalog:"
      }
    }
    ```

    e2e 的脚本叫 `e2e` 而不是 `test`，这样 `turbo run test` 不会顺带跑端到端测试。
  - `tsconfig.json`：`{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["**/*.ts"] }`
  - `playwright.config.ts`：

    ```ts
    import { defineConfig, devices } from "@playwright/test";

    export default defineConfig({
      testDir: "./tests",
      workers: 1,
      fullyParallel: false,
      timeout: 90_000,
      expect: { timeout: 15_000 },
      reporter: [["list"]],
      use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
    });
    ```

- [ ] 12. 写 `scripts/lint/oxlint-plugin-unwritten.mjs`。它是一个 ESLint 格式的插件，只有一条规则 `style-custom-properties-only`：JSX 的 `style` 属性必须是对象字面量，对象的每个键都必须是以 `--` 开头的字符串字面量。

  ```js
  const MESSAGE = "style 只能设置 -- 开头的 CSS 自定义属性，视觉值写在 CSS Module 里";

  function propertyKey(property) {
    if (property.type !== "Property" || property.computed) return null;
    if (property.key.type === "Literal" && typeof property.key.value === "string") return property.key.value;
    if (property.key.type === "Identifier") return property.key.name;
    return null;
  }

  export default {
    meta: { name: "unwritten" },
    rules: {
      "style-custom-properties-only": {
        create(context) {
          return {
            JSXAttribute(node) {
              if (node.name.type !== "JSXIdentifier" || node.name.name !== "style") return;
              const expression = node.value?.type === "JSXExpressionContainer" ? node.value.expression : null;
              if (!expression || expression.type !== "ObjectExpression") {
                context.report({ node, message: MESSAGE });
                return;
              }
              for (const property of expression.properties) {
                const key = propertyKey(property);
                if (key === null || !key.startsWith("--")) context.report({ node: property, message: MESSAGE });
              }
            },
          };
        },
      },
    },
  };
  ```

- [ ] 13. 写 `.oxlintrc.json`：

  ```json
  {
    "$schema": "./node_modules/oxlint/configuration_schema.json",
    "plugins": ["typescript", "react", "jsx-a11y", "import", "unicorn"],
    "jsPlugins": ["eslint-plugin-i18next", "eslint-plugin-react-hooks", "./scripts/lint/oxlint-plugin-unwritten.mjs"],
    "categories": { "correctness": "error" },
    "rules": {
      "no-console": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    },
    "overrides": [
      {
        "files": ["apps/client/src/**/*.tsx"],
        "rules": {
          "i18next/no-literal-string": [
            "error",
            { "mode": "jsx-only", "jsx-attributes": { "include": ["aria-label", "placeholder", "title", "alt"] } }
          ],
          "unwritten/style-custom-properties-only": "error",
          "react/no-danger": "error"
        }
      },
      {
        "files": ["apps/client/**"],
        "rules": {
          "no-restricted-imports": [
            "error",
            {
              "paths": [
                { "name": "@unwritten/core", "message": "client 不导入 core，只通过 contracts 通信" },
                { "name": "@unwritten/contracts/desktop", "message": "client 不导入 desktop 的进程消息类型" }
              ],
              "patterns": [{ "group": ["@unwritten/core/*"], "message": "client 不导入 core" }]
            }
          ]
        }
      },
      {
        "files": ["packages/core/src/**"],
        "rules": {
          "no-restricted-imports": [
            "error",
            {
              "patterns": [
                {
                  "group": ["@earendil-works/*"],
                  "message": "只有 packages/core/src/llm/pi.ts 可以导入 pi-ai 和 pi-agent-core"
                }
              ]
            }
          ]
        }
      },
      { "files": ["packages/core/src/llm/pi.ts"], "rules": { "no-restricted-imports": "off" } },
      { "files": ["packages/core/src/main.ts", "scripts/**", "e2e/**"], "rules": { "no-console": "off" } },
      { "files": ["**/*.test.ts", "**/*.test.tsx", "e2e/**"], "rules": { "i18next/no-literal-string": "off" } }
    ],
    "ignorePatterns": ["**/dist/**", "**/routeTree.gen.ts", "**/migrations/**", "**/node_modules/**"]
  }
  ```

  字段名和插件选项以 oxlint 与 `eslint-plugin-i18next` 的文档为准（可用 context7 查 oxlint 的 `jsPlugins` 和 `overrides`，以及 eslint-plugin-i18next 6.x 的 `no-literal-string` 选项）。如果 JS 插件加载失败，按[技术选型 §10](../docs/tech-stack.md#10-typescript-7-与工具链)的已知限制处理：停下来汇报，不要退回 ESLint。
- [ ] 14. 写 `stylelint.config.mjs`：

  ```js
  const STRICT_PROPERTIES = [
    "/color$/",
    "background",
    "background-color",
    "border-radius",
    "box-shadow",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "/^margin/",
    "/^padding/",
    "gap",
    "row-gap",
    "column-gap",
    "/^inset/",
    "z-index",
    "opacity",
    "transition",
    "animation",
    "outline-width",
    "outline-offset",
    "border-width",
    "/^border-(block|inline)(-start|-end)?-width$/",
    "/^(min-|max-)?(inline|block)-size$/",
  ];

  const ALLOWED_LITERALS = [
    "0",
    "none",
    "auto",
    "inherit",
    "initial",
    "unset",
    "currentColor",
    "transparent",
    "100%",
    "1fr",
    "min-content",
    "max-content",
    "fit-content",
  ];

  export default {
    extends: ["stylelint-config-standard"],
    plugins: ["stylelint-declaration-strict-value", "stylelint-use-logical"],
    rules: {
      "selector-class-pattern": null,
      "color-no-hex": true,
      "color-named": "never",
      "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix"],
      "declaration-property-value-disallowed-list": { "transition": ["/\\ball\\b/"], "transition-property": ["all"] },
      "csstools/use-logical": "always",
      "scale-unlimited/declaration-strict-value": [STRICT_PROPERTIES, { ignoreValues: ALLOWED_LITERALS }],
    },
    ignoreFiles: [
      "apps/client/src/theme/tokens.css",
      "apps/client/src/theme/media.css",
      "apps/client/src/theme/themes/*.css",
    ],
  };
  ```

  规则名、选项名以三个插件各自的文档为准。`stylelint-config-standard` 自带的个别规则可能和 token 写法冲突（例如要求小写十六进制、限制 `@custom-media` 命名），遇到时只在这个配置文件里关掉那一条，并在汇报里写明关掉了哪条、为什么。
- [ ] 15. 运行 `pnpm install`。如果 pnpm 提示有依赖的构建脚本被忽略，把名单写进汇报，不要自己批准。
- [ ] 16. 运行 `pnpm --filter @unwritten/client exec playwright install chromium`，为 client 的浏览器模式测试装上 Chromium。

**注意事项。**

- Vite 的配置文件从 `@unwritten/contracts` 导入 TypeScript 源码。如果 `vite build` 报无法加载配置，改用 `vite --configLoader runner` 和 `vite build --configLoader runner`（写进 client 的 `dev`、`build` 脚本），并在汇报里写明。
- `e2e` 目录下还没有测试文件，`playwright test` 会报“没有测试”，这是预期的；T16 补上。
- 根目录 `.gitignore` 已经覆盖 `dist/`、`.data/`、`node_modules/`、`providers.json*`，不需要改。

**完成判据。**

- `pnpm install` 成功，`pnpm-lock.yaml` 已生成。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过，类型检查用的是 `typescript@7`（`pnpm exec tsc -v` 输出 7.x）。
- `node packages/core/src/main.ts` 打印 `contract keys: 0`。这证明 Node 能直接运行 core 的 TypeScript 源码，并能从 workspace 导入 contracts 的源码。打印失败时停下来汇报原始报错，不要改用别的运行方式。
- 用 `turbo run build --filter=@unwritten/client --dry=json` 比较修改 token 文件前后的任务哈希。只改 token 的取值也必须触发 client 重建。
- `apps/client/dist/` 里有 `index.html` 和 `boot.inline.js`；`packages/core/dist/main.js` 存在，`node packages/core/dist/main.js` 同样打印 `contract keys: 0`。
- 突变检查：在 `apps/client/src/` 下临时建一个 `Probe.tsx`，内容是 `export const Probe = () => <div style={{ color: "red" }} title="提示">文字</div>;`，运行 `pnpm lint`，必须报出三处（`style`、`title`、JSX 文本）；再临时建 `probe.module.css`，内容是 `.a { color: #fff; margin-left: 4px; transition: all 1s; }`，运行 `pnpm lint`，必须报出三处（十六进制颜色、`margin-left`、`transition: all`）。两次都报错后删掉这两个文件。
- 依赖方向检查：在 `apps/client/src/` 下临时建 `probe.ts`，写 `import "@unwritten/core";`，`pnpm lint` 必须报错；在 `packages/core/src/` 下临时建 `probe.ts`，写 `import "@earendil-works/pi-ai";`，`pnpm lint` 必须报错。检查后删掉。

### T02 contracts：client 与 core 之间的全部契约

**目的。** 契约是 client 和 core 唯一的接口，也是信任边界：core 在入口按它校验每个输入（[架构总览 §3](../docs/architecture.md#3-client-与-core-的通信)）。把它一次写全，client 的页面任务和 core 的模块任务就能同时开工。

**依赖。** T01。

**拥有的文件。** `packages/contracts/src/` 下的全部文件。

**先读。** [技术选型 §6](../docs/tech-stack.md#6-contracts)；[i18n §5](../docs/i18n.md#5-core-返回什么)；[LLM 端点 §10](../docs/llm-endpoints.md#10-core-接口)；oRPC 1.x 的 contract-first 文档（context7 查 `@orpc/contract` 的 `oc` 和 `eventIterator`）。

**步骤。** 下面的代码就是要写的内容，照抄后按 oRPC 和 Zod 的实际类型声明修正细节。

- [ ] 1. `src/errors.ts`：

  ```ts
  import { z } from "zod";

  export const ERROR_CODES = [
    "invalid_input",
    "internal",
    "not_found",
    "stale_revision",
    "stale_preview",
    "already_published",
    "job_running",
    "preview_not_ready",
    "stale_head",
    "request_in_progress",
    "idempotency_conflict",
    "option_mismatch",
    "request_not_retryable",
    "llm_not_configured",
    "llm_config_invalid",
    "llm_config_too_new",
    "config_conflict",
    "endpoint_not_found",
    "invalid_url",
    "unauthorized",
    "quota",
    "rate_limited",
    "context_overflow",
    "context_too_small",
    "network",
    "unreachable",
    "timeout",
    "server",
    "redirected",
    "not_compatible",
    "no_tool_call",
    "invalid_output",
    "interrupted",
    "save",
  ] as const;

  export const ErrorCodeSchema = z.enum(ERROR_CODES);
  export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

  export const ErrorDataSchema = z.object({ detail: z.string().nullable() });
  export type ErrorData = z.infer<typeof ErrorDataSchema>;
  ```

  各错误码的含义：

  | 码 | 什么时候出现 |
  | --- | --- |
  | `invalid_input` | 输入不符合契约，或语义上不合法（例如背景为空就生成预览） |
  | `internal` | core 的意外错误 |
  | `not_found` | 作品、路线、请求不存在 |
  | `stale_revision` | 保存背景或生成预览时，客户端所见的草稿修订号已过期 |
  | `stale_preview` | 采用的预览基于旧的草稿修订号 |
  | `already_published` | 作品已采用开场，不能再改背景或再次采用 |
  | `job_running` | 同一作品已有运行中的预览任务 |
  | `preview_not_ready` | 采用时预览任务未完成或已失败 |
  | `stale_head` | 提交行动时预期 head 已过期 |
  | `request_in_progress` | 同一路线已有进行中的回合请求 |
  | `idempotency_conflict` | 同一个幂等键带了不同的参数 |
  | `option_mismatch` | 带了推荐项序号，但原话和该回合的推荐项对不上 |
  | `request_not_retryable` | 重试一个不是 `failed` 的请求 |
  | `llm_not_configured` | 用途没有可用的模型 |
  | `llm_config_invalid` | `providers.json` 无法解析或不符合 schema，拒绝从界面写入 |
  | `llm_config_too_new` | `providers.json` 的版本高于当前支持的版本，拒绝写入 |
  | `config_conflict` | 写配置时文件修订号和界面读取时不一致 |
  | `endpoint_not_found` | 端点不存在，或端点下没有这个模型 |
  | `invalid_url` | 端点地址不合法 |
  | `unauthorized` … `save` | 模型调用或回合请求的失败类别，含义见 [LLM 端点 §8](../docs/llm-endpoints.md#8-调用预算与错误)和[回合循环 §8](../docs/turn-loop.md#8-中断与恢复)。`unreachable` 只用于测试连接（连不上地址），`not_compatible` 表示地址不是兼容接口或模型 id 不存在，`no_tool_call` 表示测试连接时模型没有调用 `ping` |

- [ ] 2. `src/schemas/common.ts`：

  ```ts
  import { z } from "zod";

  export const UuidSchema = z.uuid();
  export const TimestampSchema = z.number().int().nonnegative();
  export const ContentRevSchema = z.number().int().nonnegative();
  export const LanguageTagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
  ```

- [ ] 3. `src/schemas/appearance.ts`：

  ```ts
  import { z } from "zod";

  export const AppearanceSchema = z.object({
    appearance: z.enum(["system", "light", "dark"]),
    proseSize: z.enum(["1", "2", "3", "4", "5"]),
    proseFont: z.enum(["serif", "sans"]),
    proseLeading: z.enum(["comfortable", "compact"]),
  });
  export type Appearance = z.infer<typeof AppearanceSchema>;

  export const DEFAULT_APPEARANCE: Appearance = {
    appearance: "system",
    proseSize: "3",
    proseFont: "serif",
    proseLeading: "comfortable",
  };

  export function appearanceAttributes(input: Appearance): string {
    const value = AppearanceSchema.parse(input);
    return [
      `data-uw-appearance="${value.appearance}"`,
      `data-uw-prose-size="${value.proseSize}"`,
      `data-uw-prose-font="${value.proseFont}"`,
      `data-uw-prose-leading="${value.proseLeading}"`,
    ].join(" ");
  }
  ```

  先按 schema 校验再拼接，保证写进 HTML 的只有枚举值（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）。core（T07）和 Vite 开发插件（T01）都用这个函数，所以默认偏好只有这一处来源。

- [ ] 4. `src/schemas/llm.ts`：

  ```ts
  import { z } from "zod";
  import { ErrorCodeSchema } from "../errors.ts";
  import { UuidSchema } from "./common.ts";

  export const ModelCapabilitiesSchema = z.object({
    id: z.string().min(1),
    contextWindow: z.number().int().positive().nullable(),
    maxTokens: z.number().int().positive().nullable(),
    tools: z.boolean().nullable(),
  });

  export const KeyStatusSchema = z.object({
    hasKey: z.boolean(),
    source: z.enum(["file", "env", "none"]),
    envVar: z.string().nullable(),
  });

  export const EndpointViewSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    api: z.enum(["openai-completions", "anthropic-messages"]),
    baseUrl: z.string(),
    key: KeyStatusSchema,
    models: z.array(ModelCapabilitiesSchema),
  });

  export const ModelRefSchema = z.object({ endpointId: z.string().min(1), modelId: z.string().min(1) });

  export const ConfigProblemSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("syntax"),
      line: z.number().int().positive(),
      column: z.number().int().positive(),
      message: z.string(),
    }),
    z.object({ kind: z.literal("schema"), path: z.string(), message: z.string() }),
    z.object({ kind: z.literal("too_new"), version: z.number().int() }),
  ]);

  export const LlmConfigViewSchema = z.object({
    status: z.enum(["ok", "missing", "invalid", "too_new"]),
    revision: z.string(),
    problem: ConfigProblemSchema.nullable(),
    endpoints: z.array(EndpointViewSchema),
    defaultModel: ModelRefSchema.nullable(),
    defaultModelUsable: z.boolean(),
  });

  const EndpointNameSchema = z.string().trim().min(1).max(60);
  const BaseUrlInputSchema = z.string().trim().min(1).max(2048);
  const ModelIdSchema = z.string().trim().min(1).max(200);
  const ApiKeyValueSchema = z.string().trim().min(1).max(4096);

  export const CreateEndpointInputSchema = z.object({
    requestId: UuidSchema,
    baseRevision: z.string(),
    name: EndpointNameSchema,
    baseUrl: BaseUrlInputSchema,
    modelId: ModelIdSchema,
    apiKey: ApiKeyValueSchema.nullable(),
    makeDefault: z.boolean(),
  });

  export const CreateEndpointOutputSchema = z.object({ endpointId: z.string(), config: LlmConfigViewSchema });

  export const KeyChangeSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("keep") }),
    z.object({ action: z.literal("set"), value: ApiKeyValueSchema }),
    z.object({ action: z.literal("remove") }),
  ]);

  export const UpdateEndpointInputSchema = z.object({
    baseRevision: z.string(),
    endpointId: z.string().min(1),
    name: EndpointNameSchema,
    modelId: ModelIdSchema,
    key: KeyChangeSchema,
  });

  export const SetPurposeInputSchema = z.object({
    baseRevision: z.string(),
    purpose: z.literal("default"),
    model: ModelRefSchema,
  });

  export const TestKeySchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("set"), value: ApiKeyValueSchema }),
    z.object({ action: z.literal("keep"), endpointId: z.string().min(1) }),
    z.object({ action: z.literal("none") }),
  ]);

  export const TestConnectionInputSchema = z.object({
    baseUrl: BaseUrlInputSchema,
    modelId: ModelIdSchema,
    key: TestKeySchema,
  });

  export const TestConnectionResultSchema = z.object({
    ok: z.boolean(),
    code: ErrorCodeSchema.nullable(),
    detail: z.string().nullable(),
    savedToolsCapability: z.boolean(),
  });

  export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
  export type KeyStatus = z.infer<typeof KeyStatusSchema>;
  export type EndpointView = z.infer<typeof EndpointViewSchema>;
  export type ModelRef = z.infer<typeof ModelRefSchema>;
  export type ConfigProblem = z.infer<typeof ConfigProblemSchema>;
  export type LlmConfigView = z.infer<typeof LlmConfigViewSchema>;
  export type CreateEndpointInput = z.infer<typeof CreateEndpointInputSchema>;
  export type CreateEndpointOutput = z.infer<typeof CreateEndpointOutputSchema>;
  export type KeyChange = z.infer<typeof KeyChangeSchema>;
  export type UpdateEndpointInput = z.infer<typeof UpdateEndpointInputSchema>;
  export type SetPurposeInput = z.infer<typeof SetPurposeInputSchema>;
  export type TestKey = z.infer<typeof TestKeySchema>;
  export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>;
  export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
  ```

  几个形状背后的规则：
  - 修改端点不接受 `baseUrl`，所以地址从接口层面就改不了；要换地址只能新增端点（[LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)）。
  - `KeyChange` 三选一：留空就是 `keep`，填了新值是 `set`，点「移除 key」是 `remove`。
  - `baseRevision` 是界面读取配置时拿到的 `revision`，core 用它做比较再写入。
  - `requestId` 是新增端点的幂等键，重发时复用。
  - 本里程碑每个端点只有一个模型，界面上只填一个模型 id；文件格式里 `models` 仍是数组。

- [ ] 5. `src/schemas/works.ts`：

  ```ts
  import { z } from "zod";
  import { ErrorCodeSchema } from "../errors.ts";
  import { ContentRevSchema, LanguageTagSchema, TimestampSchema, UuidSchema } from "./common.ts";

  export const BACKGROUND_MAX_LENGTH = 20_000;

  export const WorkStatusSchema = z.enum(["draft", "playable"]);

  export const WorkSummarySchema = z.object({
    id: UuidSchema,
    title: z.string().nullable(),
    blurb: z.string().nullable(),
    label: z.string(),
    status: WorkStatusSchema,
    hasProgress: z.boolean(),
    routeId: UuidSchema.nullable(),
    updatedAt: TimestampSchema,
  });

  export const PreviewSchema = z.object({
    title: z.string(),
    blurb: z.string(),
    publicSetting: z.string(),
    prose: z.string(),
    options: z.array(z.object({ text: z.string() })),
    scene: z.object({ place: z.string(), time: z.string() }),
    language: LanguageTagSchema,
  });

  export const JobStatusSchema = z.enum(["running", "done", "failed"]);

  export const PreviewJobViewSchema = z.object({
    id: UuidSchema,
    status: JobStatusSchema,
    basedOnContentRev: ContentRevSchema,
    error: ErrorCodeSchema.nullable(),
    preview: PreviewSchema.nullable(),
    updatedAt: TimestampSchema,
  });

  export const WorkDetailSchema = z.object({
    id: UuidSchema,
    title: z.string().nullable(),
    blurb: z.string().nullable(),
    status: WorkStatusSchema,
    routeId: UuidSchema.nullable(),
    draft: z.object({ contentRev: ContentRevSchema, background: z.string() }),
    latestPreviewJob: PreviewJobViewSchema.nullable(),
  });

  export const WorkIdInputSchema = z.object({ workId: UuidSchema });

  export const SaveBackgroundInputSchema = z.object({
    workId: UuidSchema,
    baseContentRev: ContentRevSchema,
    background: z.string().max(BACKGROUND_MAX_LENGTH),
  });
  export const SaveBackgroundOutputSchema = z.object({ contentRev: ContentRevSchema });

  export const GeneratePreviewInputSchema = z.object({ workId: UuidSchema, jobId: UuidSchema, contentRev: ContentRevSchema });

  export const AdoptPreviewInputSchema = z.object({ workId: UuidSchema, jobId: UuidSchema });
  export const AdoptPreviewOutputSchema = z.object({ routeId: UuidSchema });

  export type WorkStatus = z.infer<typeof WorkStatusSchema>;
  export type WorkSummary = z.infer<typeof WorkSummarySchema>;
  export type Preview = z.infer<typeof PreviewSchema>;
  export type JobStatus = z.infer<typeof JobStatusSchema>;
  export type PreviewJobView = z.infer<typeof PreviewJobViewSchema>;
  export type WorkDetail = z.infer<typeof WorkDetailSchema>;
  export type WorkIdInput = z.infer<typeof WorkIdInputSchema>;
  export type SaveBackgroundInput = z.infer<typeof SaveBackgroundInputSchema>;
  export type SaveBackgroundOutput = z.infer<typeof SaveBackgroundOutputSchema>;
  export type GeneratePreviewInput = z.infer<typeof GeneratePreviewInputSchema>;
  export type AdoptPreviewInput = z.infer<typeof AdoptPreviewInputSchema>;
  export type AdoptPreviewOutput = z.infer<typeof AdoptPreviewOutputSchema>;
  ```

  - `label` 是作品库卡片上用来辨认作品的文字：有标题用标题；没有标题用背景的第一行非空文字，截到 40 个字符；背景也是空的就返回空字符串，由 client 显示“未命名草稿”。
  - `WorkDetail.routeId` 在作品采用开场后指向那条唯一的路线。
  - `jobId` 由 client 生成，同时是生成预览的幂等键。

- [ ] 6. `src/schemas/play.ts`：

  ```ts
  import { z } from "zod";
  import { ErrorCodeSchema } from "../errors.ts";
  import { LanguageTagSchema, TimestampSchema, UuidSchema } from "./common.ts";

  export const ACTION_TEXT_MAX_LENGTH = 2_000;

  export const PlayerActionInputSchema = z.object({
    text: z.string().trim().min(1).max(ACTION_TEXT_MAX_LENGTH),
    optionIndex: z.number().int().min(1).max(9).nullable(),
  });

  export const ActionViewSchema = z.object({ text: z.string(), optionIndex: z.number().int().nullable() });

  export const TurnViewSchema = z.object({
    id: UuidSchema,
    originRequest: z.object({ id: UuidSchema, attempt: z.number().int().positive() }).nullable(),
    depth: z.number().int().nonnegative(),
    action: ActionViewSchema.nullable(),
    prose: z.string(),
    options: z.array(z.object({ text: z.string() })),
    createdAt: TimestampSchema,
  });

  export const TurnRequestStatusSchema = z.enum([
    "running",
    "needs_clarification",
    "done",
    "failed",
    "superseded",
    "cancelled",
  ]);

  export const TurnRequestViewSchema = z.object({
    id: UuidSchema,
    status: TurnRequestStatusSchema,
    action: ActionViewSchema,
    error: ErrorCodeSchema.nullable(),
    attempts: z.number().int().positive(),
    expectedHeadTurnId: UuidSchema,
    resultTurnId: UuidSchema.nullable(),
    updatedAt: TimestampSchema,
  });

  export const RouteViewSchema = z.object({
    id: UuidSchema,
    workId: UuidSchema,
    workTitle: z.string().nullable(),
    language: LanguageTagSchema,
    headTurnId: UuidSchema,
    turns: z.array(TurnViewSchema),
    pending: TurnRequestViewSchema.nullable(),
  });

  export const RouteIdInputSchema = z.object({ routeId: UuidSchema });

  export const SubmitActionInputSchema = z.object({
    requestId: UuidSchema,
    routeId: UuidSchema,
    expectedHeadTurnId: UuidSchema,
    action: PlayerActionInputSchema,
  });

  export const RetryInputSchema = z.object({ requestId: UuidSchema });

  export type PlayerActionInput = z.infer<typeof PlayerActionInputSchema>;
  export type ActionView = z.infer<typeof ActionViewSchema>;
  export type TurnView = z.infer<typeof TurnViewSchema>;
  export type TurnRequestStatus = z.infer<typeof TurnRequestStatusSchema>;
  export type TurnRequestView = z.infer<typeof TurnRequestViewSchema>;
  export type RouteView = z.infer<typeof RouteViewSchema>;
  export type RouteIdInput = z.infer<typeof RouteIdInputSchema>;
  export type SubmitActionInput = z.infer<typeof SubmitActionInputSchema>;
  export type RetryInput = z.infer<typeof RetryInputSchema>;
  ```

  - `turns` 按 `depth` 从开场到 head 排列。`originRequest` 来自产生该回合的请求与尝试号，没有对应请求时为空。它用于定位生成结果，回查丢失事件时也能恢复关联。
  - `pending` 是这条路线上 `expected_head_turn_id` 等于当前 head、状态为 `running` 或 `failed` 的最新一个请求；没有就是 `null`。`done`、`superseded` 的请求不出现在这里。
  - 输入用 `PlayerActionInputSchema`（带 trim 和长度限制），输出用 `ActionViewSchema`（只描述形状）。不要把带变换的 schema 用在输出上。

- [ ] 7. `src/schemas/log.ts`：`ClientLogInputSchema` 是按 `kind` 区分的严格对象联合，导出对应的 `ClientLogInput` 类型。客户端上报不接收自由文本、格式化错误、URL、堆栈或任意上下文字段。

  | kind | 字段 |
  | --- | --- |
  | `event` | `area` 为 `library\|authoring\|play\|settings\|app`，`code` 取 `ErrorCodeSchema` |
  | `sample` | `metric` 为 §2.5 的三个 client 样本名，`durationMs` 为有限非负数，`outcome` 为 `ok\|error\|interrupted`。预览样本带 `jobId`，游玩样本带 `requestId`，两者可附 `workId`。续写样本带正整数 `attempt`，若命令在新尝试登记前被拒绝或取代则可省略 |

  用严格对象及按 `metric` 划分的样本联合钉住各指标允许的 ID，ID 用 `UuidSchema`。测试拒绝额外字段、未知名、错误的关联 ID、非有限或负耗时。

- [ ] 8. `src/events.ts`：

  ```ts
  import { z } from "zod";
  import { UuidSchema } from "./schemas/common.ts";
  import { TurnRequestStatusSchema } from "./schemas/play.ts";
  import { JobStatusSchema } from "./schemas/works.ts";

  export const CoreEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("llm.config_changed") }),
    z.object({ type: z.literal("works.changed"), workId: UuidSchema }),
    z.object({ type: z.literal("job.updated"), workId: UuidSchema, jobId: UuidSchema, status: JobStatusSchema }),
    z.object({
      type: z.literal("turn_request.updated"),
      routeId: UuidSchema,
      requestId: UuidSchema,
      status: TurnRequestStatusSchema,
    }),
    z.object({ type: z.literal("turn.committed"), routeId: UuidSchema, turnId: UuidSchema }),
  ]);
  export type CoreEvent = z.infer<typeof CoreEventSchema>;
  ```

  事件只是通知：client 收到后让相关查询失效，再以查询结果为准（[架构总览 §3](../docs/architecture.md#3-client-与-core-的通信)）。所以事件里只放 id 和状态，不放正文。

- [ ] 9. `src/procedures/*.ts`：

  ```ts
  import { oc } from "@orpc/contract";
  import {
    CreateEndpointInputSchema,
    CreateEndpointOutputSchema,
    LlmConfigViewSchema,
    SetPurposeInputSchema,
    TestConnectionInputSchema,
    TestConnectionResultSchema,
    UpdateEndpointInputSchema,
  } from "../schemas/llm.ts";

  export const llmContract = {
    providers: { list: oc.output(LlmConfigViewSchema) },
    endpoints: {
      create: oc.input(CreateEndpointInputSchema).output(CreateEndpointOutputSchema),
      update: oc.input(UpdateEndpointInputSchema).output(LlmConfigViewSchema),
    },
    purposes: { set: oc.input(SetPurposeInputSchema).output(LlmConfigViewSchema) },
    test: oc.input(TestConnectionInputSchema).output(TestConnectionResultSchema),
  };
  ```

  `works.ts`：

  ```ts
  export const worksContract = {
    list: oc.output(z.array(WorkSummarySchema)),
    create: oc.input(WorkIdInputSchema).output(WorkDetailSchema),
    get: oc.input(WorkIdInputSchema).output(WorkDetailSchema),
    saveBackground: oc.input(SaveBackgroundInputSchema).output(SaveBackgroundOutputSchema),
    generatePreview: oc.input(GeneratePreviewInputSchema).output(PreviewJobViewSchema),
    adoptPreview: oc.input(AdoptPreviewInputSchema).output(AdoptPreviewOutputSchema),
  };
  ```

  `play.ts`：

  ```ts
  export const playContract = {
    getRoute: oc.input(RouteIdInputSchema).output(RouteViewSchema),
    submitAction: oc.input(SubmitActionInputSchema).output(TurnRequestViewSchema),
    retry: oc.input(RetryInputSchema).output(TurnRequestViewSchema),
  };
  ```

  `events.ts`：

  ```ts
  import { eventIterator, oc } from "@orpc/contract";
  import { CoreEventSchema } from "../events.ts";

  export const eventsContract = { subscribe: oc.output(eventIterator(CoreEventSchema)) };
  ```

  `log.ts`：

  ```ts
  export const logContract = { client: oc.input(ClientLogInputSchema).output(z.object({})) };
  ```

  上面省略的 import 按用到的名字补齐。

- [ ] 10. `src/index.ts`（整体替换 T01 的占位）：

  ```ts
  import { eventsContract } from "./procedures/events.ts";
  import { llmContract } from "./procedures/llm.ts";
  import { logContract } from "./procedures/log.ts";
  import { playContract } from "./procedures/play.ts";
  import { worksContract } from "./procedures/works.ts";

  export const contract = {
    llm: llmContract,
    works: worksContract,
    play: playContract,
    events: eventsContract,
    log: logContract,
  };
  export type Contract = typeof contract;

  export * from "./errors.ts";
  export * from "./events.ts";
  export * from "./schemas/appearance.ts";
  export * from "./schemas/common.ts";
  export * from "./schemas/llm.ts";
  export * from "./schemas/log.ts";
  export * from "./schemas/play.ts";
  export * from "./schemas/works.ts";
  ```

- [ ] 11. `src/errors.test.ts`：两条用例。`ERROR_CODES` 没有重复；每一项都匹配 `/^[a-z]+(_[a-z]+)*$/`。另加 `appearanceAttributes` 的用例：默认值输出四个属性；传入不在枚举里的值时抛错（用 `as never` 绕过类型）。

**注意事项。**

- contracts 不含业务逻辑。`appearanceAttributes` 只是把枚举映射成属性字符串，是唯一的例外，因为 core 和 Vite 插件必须用同一份默认值。
- 契约的过程名就是 HTTP 路径（`/api/works/list` 这种），改名会同时影响 client 和 core。写完后不再改名。
- Zod 4 的 `z.uuid()` 校验的是 RFC 9562 格式，`crypto.randomUUID()` 生成的 v4 能通过。

**完成判据。**

- `pnpm --filter @unwritten/contracts typecheck` 和 `test` 通过。
- `pnpm --filter @unwritten/client typecheck` 通过（证明 Vite 配置里的 `appearanceAttributes` 导入已经接上真实实现）。
- 突变：把 `ERROR_CODES` 里的 `"save"` 复制一份追加到末尾，`errors.test.ts` 必须失败；恢复。

### T03 client 主题 token 与全局样式

**目的。** 用设计交接的 DTCG JSON 生成 client 样式，两套主题与动效覆盖走同一条生成链路。

**依赖。** T01。T02 提供外观偏好的契约。

**拥有的文件。** §4.1 的 token 交接文件和 `apps/client/src/theme/`（除 `boot.inline.js`）。T01 把生成命令接入 client 的 `build`、`dev` 和 `test`，并配置生成文件的 Stylelint 豁免。

**先读。** [主题与 token §11–12](../docs/theme.md#11-文件布局)、[动效 §3–4](../docs/motion.md#3-token) 和 [client 规范](../apps/client/AGENTS.md)。

**步骤。**

- [ ] 1. 运行 `node scripts/check-tokens.mjs`，再运行 `node packages/tokens/build-css.mjs apps/client/src/theme`。源码中的 token 和浏览器产物使用同一个 JSON。
- [ ] 2. 核对基元、组合排版、动效、两套主题、阅读偏好、对比度偏好及减少动态效果的选择器。确认构建和开发启动都先生成、再由 Lightning CSS 处理断点。生成的 CSS 由 Git 忽略。
- [ ] 3. `global.css`：全局基础样式。按需引入：`@import './tokens.css'; @import './media.css'; @import './themes/light.css'; @import './themes/dark.css';`，然后：

  ```css
  html {
    background-color: var(--uw-color-bg);
    color: var(--uw-color-text);
    font-family: var(--uw-font-ui);
    line-height: var(--uw-leading-ui);
    line-break: strict;
    scroll-padding-block-start: var(--uw-size-toolbar);
  }

  @supports (text-autospace: normal) {
    html {
      text-autospace: normal;
      text-spacing-trim: normal;
    }
  }

  body {
    margin: 0;
    font-size: var(--uw-text-md);
  }

  :focus-visible {
    outline: var(--uw-focus-ring-width) solid var(--uw-color-focus-ring);
    outline-offset: var(--uw-focus-ring-offset);
  }

  em,
  strong {
    font-style: normal;
    font-weight: var(--uw-weight-semibold);
  }
  ```

  `html` 不设 `font-size`，保持浏览器默认的 16px，让 rem 和系统缩放一致（[a11y §6](../docs/a11y.md#6-尺寸缩放与目标大小)）。
- [ ] 4. `appearance.ts`：首屏之后唯一写根属性的入口（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）。本里程碑只处理“跟随系统”：

  ```ts
  import type { Appearance } from "@unwritten/contracts";

  const DARK_QUERY = "(prefers-color-scheme: dark)";

  function resolveTheme(preference: Appearance["appearance"]): "light" | "dark" {
    if (preference === "light" || preference === "dark") return preference;
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  }

  export function applyAppearance(preference: Appearance["appearance"]): void {
    const root = document.documentElement;
    const theme = resolveTheme(preference);
    if (root.getAttribute("data-uw-theme") === theme) return;
    const swap = () => root.setAttribute("data-uw-theme", theme);
    if (typeof document.startViewTransition !== "function") {
      swap();
      return;
    }
    root.setAttribute("data-uw-theme-switching", "");
    const transition = document.startViewTransition(swap);
    void transition.finished.finally(() => root.removeAttribute("data-uw-theme-switching"));
  }

  export function followSystemAppearance(): () => void {
    const query = window.matchMedia(DARK_QUERY);
    const listener = () => applyAppearance(readPreference());
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }

  function readPreference(): Appearance["appearance"] {
    const value = document.documentElement.getAttribute("data-uw-appearance");
    return value === "light" || value === "dark" ? value : "system";
  }
  ```

  T11 在应用启动时调用一次 `followSystemAppearance()`。主题切换的整页交叉淡入淡出时长由 CSS 控制：在 `global.css` 里给 `::view-transition-old(root)`、`::view-transition-new(root)` 设 `animation-duration: var(--uw-motion-duration-theme)`。
- [ ] 5. 用 client 的浏览器测试覆盖首屏主题、系统明暗变化、减少动态效果和焦点环。CSS 导出样例和 token 校验由交接脚本的 Node 测试覆盖。

**注意事项。** 视觉值和别名在 JSON 中维护。布局和全局样式只引用 CSS 变量。生成步骤不依赖第三方库。

**完成判据。** `node scripts/check-tokens.mjs`、`node --test packages/tokens/build-css.test.mjs`、client 外观测试与 lint 均通过。修改临时副本中的浅色 `ink` 使其超出对比度范围，token 检查必须失败；恢复后通过。

### T04 core 地基：参数、日志、数据库、事件总线、服务接口

**目的。** 给 core 的四个业务任务（T07–T10）打好共同的地基：同一套表结构、同一个日志器、同一个事件总线、同一组服务接口。表结构和接口一次定死，T07–T10 就能并行开发，互不修改对方的文件。

**依赖。** T02。

**拥有的文件。** `packages/core/drizzle.diagnostics.config.ts`，以及 `packages/core/src/` 下的 `cli.ts`、`errors.ts`、`services.ts`、`log/*`、`store/*`（含生成的迁移）、`events/*`、`text/*`、`llm/types.ts`、`test-support/scripted-llm.ts`、`test-support/temp-dir.ts` 和对应测试。

**先读。** [数据模型](../docs/data-model.md) §2、§3、§8；[回合循环 §2](../docs/turn-loop.md#2-回合请求)；[创作工作站 §13](../docs/author-workstation.md#13-数据表) 的 `jobs`；[LLM 端点 §9](../docs/llm-endpoints.md#9-调用记录)；[运行诊断与性能记录](../docs/diagnostics.md)和本文 §2.5。Drizzle 1.0 的 `node-sqlite` 驱动用法以 `node_modules/drizzle-orm/node-sqlite/*.d.ts` 为准。

**步骤。**

- [ ] 1. `src/cli.ts`：用 `node:util` 的 `parseArgs` 解析参数，导出 `parseCliArgs(argv: string[]): CliOptions`。

  ```ts
  export interface CliOptions {
    dataDir: string;
    port: number;
    clientDir: string;
    clientOrigin: string | null;
    logLevel: "debug" | "info" | "warn" | "error";
  }
  ```

  - `--data-dir` 必填，转成绝对路径（`path.resolve`）。
  - `--port` 默认 `0`，必须是 0–65535 的整数。
  - `--client-dir` 默认 `fileURLToPath(new URL("../../../apps/client/dist/", import.meta.url))`。这个相对路径在 `src/cli.ts` 和打包后的 `dist/main.js` 里都指向仓库根目录下的 `apps/client/dist/`，因为两个文件离仓库根目录的层数相同。
  - `--client-origin` 可选，必须是 `http://` 或 `https://` 开头、没有路径的源。
  - `--log-level` 默认 `info`。
  - 不合法时抛出带清楚说明的 `Error`（这是给开发者看的命令行输出，不走 i18n）。
  - 测试 `cli.test.ts`：缺 `--data-dir` 报错；`--port 70000` 报错；默认值正确；`--client-dir` 默认值以 `apps/client/dist` 结尾。
- [ ] 2. `src/errors.ts`：

  ```ts
  import { ORPCError } from "@orpc/server";
  import type { ErrorCode, ErrorData } from "@unwritten/contracts";

  const HTTP_STATUS: Record<ErrorCode, number> = {
    invalid_input: 400,
    internal: 500,
    not_found: 404,
    stale_revision: 409,
    stale_preview: 409,
    already_published: 409,
    job_running: 409,
    preview_not_ready: 409,
    stale_head: 409,
    request_in_progress: 409,
    idempotency_conflict: 409,
    option_mismatch: 409,
    request_not_retryable: 409,
    llm_not_configured: 409,
    llm_config_invalid: 409,
    llm_config_too_new: 409,
    config_conflict: 409,
    endpoint_not_found: 404,
    invalid_url: 400,
    unauthorized: 502,
    quota: 502,
    rate_limited: 502,
    context_overflow: 502,
    context_too_small: 409,
    network: 502,
    unreachable: 502,
    timeout: 504,
    server: 502,
    redirected: 502,
    not_compatible: 502,
    no_tool_call: 502,
    invalid_output: 502,
    interrupted: 409,
    save: 500,
  };

  export function appError(code: ErrorCode, message: string, detail: string | null = null) {
    const data: ErrorData = { detail };
    return new ORPCError(code, { status: HTTP_STATUS[code], message, data });
  }
  ```

  用法：`throw appError("stale_head", "route head moved")`。`message` 用英文短句，只给开发者看。
- [ ] 3. `src/store/meta.ts`：JSON 列里对象的形状。

  ```ts
  import { PreviewSchema } from "@unwritten/contracts";
  import { z } from "zod";

  export const StoredOptionSchema = z.object({ text: z.string() });
  export const StoredSceneSchema = z.object({ place: z.string(), time: z.string(), present: z.array(z.string()) });
  export const StoredActionSchema = z.object({ text: z.string(), optionIndex: z.number().int().nullable() });

  export const PlanItemSchema = z.object({
    id: z.string(),
    text: z.string(),
    source: z.enum(["author", "ai", "author_confirmed"]),
  });

  export const PUBLIC_SETTING_PLAN_ITEM_ID = "public_setting";

  export const VersionMetaSchema = z.object({
    background: z.string(),
    plan: z.object({ items: z.array(PlanItemSchema) }).optional(),
    opening: z
      .object({ prose: z.string(), options: z.array(StoredOptionSchema), scene: StoredSceneSchema })
      .optional(),
    narration: z.object({ language: z.string() }).optional(),
  });

  export const PreviewJobInputSchema = z.object({ contentRev: z.number().int().nonnegative(), background: z.string() });
  export const PreviewJobResultSchema = z.object({
    preview: PreviewSchema,
    adoption: z.object({ versionId: z.string(), routeId: z.string() }).nullable(),
  });

  export const TurnRequestLogSchema = z.array(
    z.object({ tool: z.string(), ok: z.boolean(), errors: z.array(z.string()) }),
  );

  export type StoredOption = z.infer<typeof StoredOptionSchema>;
  export type StoredScene = z.infer<typeof StoredSceneSchema>;
  export type StoredAction = z.infer<typeof StoredActionSchema>;
  export type VersionMeta = z.infer<typeof VersionMetaSchema>;
  export type PreviewJobInput = z.infer<typeof PreviewJobInputSchema>;
  export type PreviewJobResult = z.infer<typeof PreviewJobResultSchema>;
  export type TurnRequestLog = z.infer<typeof TurnRequestLogSchema>;
  ```

  - 公开设定存成故事方案的一项：`plan.items` 里 `id` 为 `public_setting`、`source` 为 `ai` 的那一项。这样以后的完整故事方案直接沿用同一个结构（[数据模型 §2](../docs/data-model.md#2-作品与版本)）。
  - 预览任务的结果里带 `adoption`：作者采用后记下发布版本和路线 id，用来让“采用”这个命令幂等（T09）。
- [ ] 4. `src/store/schema.ts`：全部表。列名、可空性、外键、索引照下面写；没列出的列不加。

  ```ts
  import { sql } from "drizzle-orm";
  import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
  import type { PreviewJobInput, PreviewJobResult, StoredAction, StoredOption, StoredScene, TurnRequestLog, VersionMeta } from "./meta.ts";

  export const works = sqliteTable("works", {
    id: text("id").primaryKey(),
    title: text("title"),
    blurb: text("blurb"),
    draftId: text("draft_id").notNull(),
    publishedId: text("published_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  });

  export const workVersions = sqliteTable(
    "work_versions",
    {
      id: text("id").primaryKey(),
      workId: text("work_id")
        .notNull()
        .references(() => works.id, { onDelete: "cascade" }),
      kind: text("kind", { enum: ["draft", "trial", "published"] }).notNull(),
      copiedFrom: text("copied_from"),
      contentRev: integer("content_rev").notNull().default(0),
      sourceRev: integer("source_rev"),
      meta: text("meta", { mode: "json" }).$type<VersionMeta>().notNull(),
      createdAt: integer("created_at").notNull(),
      updatedAt: integer("updated_at").notNull(),
    },
    (table) => [index("work_versions_work_idx").on(table.workId)],
  );

  export const playthroughs = sqliteTable(
    "playthroughs",
    {
      id: text("id").primaryKey(),
      versionId: text("version_id")
        .notNull()
        .references(() => workVersions.id, { onDelete: "cascade" }),
      kind: text("kind", { enum: ["play", "trial"] }).notNull(),
      protagonist: text("protagonist", { mode: "json" }),
      cast: text("cast", { mode: "json" }),
      rootTurnId: text("root_turn_id"),
      createdAt: integer("created_at").notNull(),
    },
    (table) => [index("playthroughs_version_idx").on(table.versionId)],
  );

  export const turns = sqliteTable(
    "turns",
    {
      id: text("id").primaryKey(),
      playthroughId: text("playthrough_id")
        .notNull()
        .references(() => playthroughs.id, { onDelete: "cascade" }),
      parentId: text("parent_id").references((): AnySQLiteColumn => turns.id),
      depth: integer("depth").notNull(),
      action: text("action", { mode: "json" }).$type<StoredAction>(),
      prose: text("prose").notNull(),
      options: text("options", { mode: "json" }).$type<StoredOption[]>().notNull(),
      scene: text("scene", { mode: "json" }).$type<StoredScene>().notNull(),
      ending: integer("ending").notNull().default(0),
      status: text("status", { enum: ["committed", "candidate"] }).notNull(),
      createdAt: integer("created_at").notNull(),
    },
    (table) => [index("turns_playthrough_idx").on(table.playthroughId), index("turns_parent_idx").on(table.parentId)],
  );

  export const routes = sqliteTable(
    "routes",
    {
      id: text("id").primaryKey(),
      playthroughId: text("playthrough_id")
        .notNull()
        .references(() => playthroughs.id, { onDelete: "cascade" }),
      headTurnId: text("head_turn_id")
        .notNull()
        .references(() => turns.id),
      name: text("name"),
      draftInput: text("draft_input"),
      createdAt: integer("created_at").notNull(),
      updatedAt: integer("updated_at").notNull(),
    },
    (table) => [index("routes_playthrough_idx").on(table.playthroughId)],
  );

  export const turnRequests = sqliteTable(
    "turn_requests",
    {
      id: text("id").primaryKey(),
      playthroughId: text("playthrough_id")
        .notNull()
        .references(() => playthroughs.id, { onDelete: "cascade" }),
      routeId: text("route_id").references(() => routes.id, { onDelete: "cascade" }),
      kind: text("kind", { enum: ["continue", "rewrite", "opening"] }).notNull(),
      expectedHeadTurnId: text("expected_head_turn_id"),
      parentTurnId: text("parent_turn_id"),
      action: text("action", { mode: "json" }).$type<StoredAction>(),
      preference: text("preference"),
      clarification: text("clarification", { mode: "json" }),
      status: text("status", {
        enum: ["running", "needs_clarification", "done", "failed", "superseded", "cancelled"],
      }).notNull(),
      error: text("error"),
      resultTurnId: text("result_turn_id"),
      attempts: integer("attempts").notNull().default(1),
      log: text("log", { mode: "json" }).$type<TurnRequestLog>(),
      createdAt: integer("created_at").notNull(),
      updatedAt: integer("updated_at").notNull(),
    },
    (table) => [
      uniqueIndex("turn_requests_one_active_per_route")
        .on(table.routeId)
        .where(sql`status in ('running', 'needs_clarification') and route_id is not null`),
      uniqueIndex("turn_requests_one_active_opening")
        .on(table.playthroughId)
        .where(sql`kind = 'opening' and status in ('running', 'needs_clarification')`),
      index("turn_requests_route_idx").on(table.routeId, table.createdAt),
      uniqueIndex("turn_requests_result_idx").on(table.resultTurnId),
    ],
  );

  export const jobs = sqliteTable(
    "jobs",
    {
      id: text("id").primaryKey(),
      workId: text("work_id")
        .notNull()
        .references(() => works.id, { onDelete: "cascade" }),
      kind: text("kind", { enum: ["plan", "opening", "title_blurb", "trial_extract", "preview"] }).notNull(),
      status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
      input: text("input", { mode: "json" }).$type<PreviewJobInput>().notNull(),
      result: text("result", { mode: "json" }).$type<PreviewJobResult>(),
      error: text("error"),
      createdAt: integer("created_at").notNull(),
      updatedAt: integer("updated_at").notNull(),
    },
    (table) => [index("jobs_work_idx").on(table.workId, table.createdAt)],
  );

  export const llmCalls = sqliteTable(
    "llm_calls",
    {
      id: text("id").primaryKey(),
      purpose: text("purpose").notNull(),
      workId: text("work_id").references(() => works.id, { onDelete: "set null" }),
      provider: text("provider").notNull(),
      model: text("model").notNull(),
      refKind: text("ref_kind"),
      refId: text("ref_id"),
      inputTokens: integer("input_tokens"),
      outputTokens: integer("output_tokens"),
      cacheReadTokens: integer("cache_read_tokens"),
      cost: real("cost"),
      costFromProvider: integer("cost_from_provider"),
      durationMs: integer("duration_ms"),
      status: text("status", { enum: ["ok", "error", "aborted"] }).notNull(),
      error: text("error"),
      createdAt: integer("created_at").notNull(),
    },
    (table) => [index("llm_calls_created_idx").on(table.createdAt)],
  );
  ```

  - `works.draft_id`、`published_id`、`playthroughs.root_turn_id` 不加外键，和[数据模型 §2–§3](../docs/data-model.md#2-作品与版本) 一致；它们和被指向的行在同一个事务里写入。
  - 部分唯一索引的 `where` 里直接写列名，不用 `${table.status}` 插值：插值会生成带表名前缀的列引用，SQLite 的部分索引不一定接受。
  - `jobs.input`、`jobs.result` 的类型本里程碑只有预览一种；以后加任务类型时把 `$type` 改成联合类型。
  - 故事事实表（`entities` 等）、`saves`、`turn_summaries`、`prose_fts`、`chat_*`、`card_claims` 本里程碑不建。
- [ ] 5. 运行 `pnpm --filter @unwritten/core db:generate`，生成第一份迁移到 `src/store/migrations/`。打开生成的 SQL 核对：两个部分唯一索引带 `WHERE`；外键带 `ON DELETE CASCADE`。生成的文件不手改；不对就改 `schema.ts` 重新生成。删除 T01 留下的 `.gitkeep`。
- [ ] 6. `src/store/db.ts`：

  ```ts
  export class DataDirLockedError extends Error {}

  export interface OpenedDatabase {
    db: Database;
    close(): void;
  }

  export function openDatabase(file: string): OpenedDatabase;
  ```

  按这个顺序做：
  1. `new DatabaseSync(file)`（`node:sqlite`）。
  2. `exec("PRAGMA busy_timeout = 0")`、`exec("PRAGMA locking_mode = EXCLUSIVE")`、`exec("PRAGMA journal_mode = WAL")`、`exec("PRAGMA foreign_keys = ON")`。
  3. `exec("BEGIN IMMEDIATE")` 再 `exec("COMMIT")`：这一步取得并一直持有独占锁。把第 2 步的几条 PRAGMA 和第 3 步一起放进同一个 `try`：任何一步抛出 SQLite 的忙锁错误（`SQLITE_BUSY`、`errcode 5`，或信息里含 `database is locked`）时，关闭连接、抛 `DataDirLockedError`。另一个进程可能先在第 2 步的 `PRAGMA journal_mode = WAL` 上就失败，不能只把 `BEGIN IMMEDIATE` 当作失败点。独占锁随进程退出由操作系统释放，所以 core 崩溃后不会留下死锁文件。
  4. 用驱动创建 Drizzle 实例（`drizzle({ client, schema })` 或驱动实际要求的写法），`schema` 是 `import * as schema from "./schema.ts"`。
  5. 执行迁移：`migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations/", import.meta.url)) })`。打包后这段代码在 `dist/main.js` 里，`new URL` 解析到 `dist/migrations/`，正好是 T01 配置的复制目标。
  6. 导出 `export type Database = ...`：驱动返回的数据库类型。

  写事务一律用 `db.transaction((tx) => { … }, { behavior: "immediate" })`（选项名以驱动类型为准），回调是同步函数。
- [ ] 7. `src/store/db.test.ts`：
  - 打开临时目录里的库，迁移后 `sqlite_master` 里有 `works`、`work_versions`、`playthroughs`、`turns`、`routes`、`turn_requests`、`jobs`、`llm_calls` 八张表。
  - `PRAGMA foreign_keys` 读出来是 1；删除一个 `works` 行，它的 `work_versions` 行随之删除。
  - 部分唯一索引：同一 `route_id` 插两条 `status='running'` 的请求，第二条失败；一条 `running` 加一条 `failed` 可以共存。
  - 独占锁：用 `child_process.fork` 起一个子进程，子进程对同一个库文件调用 `openDatabase`，必须以 `DataDirLockedError` 失败（子进程把结果通过 `process.send` 发回来）。必须用子进程测：同一进程里的两个连接不能代表另一个 core 进程的行为。子进程脚本放在 `src/store/test-fixtures/open-db-child.ts`，用 `node` 直接运行 TypeScript 源码。断言收到的错误是 `DataDirLockedError`，不是原始 `ERR_SQLITE_ERROR`。
- [ ] 8. `src/log/scrub.ts`：

  ```ts
  const KEY_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi];

  export function scrubSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
    let result = text;
    for (const secret of secrets) {
      if (secret && secret.length >= 4) result = result.split(secret).join("[redacted]");
    }
    for (const pattern of KEY_PATTERNS) result = result.replace(pattern, "[redacted]");
    return result;
  }
  ```

  测试：已知 key 被替换；`sk-` 开头的长串被替换；`Bearer xxx` 被替换；不相关的文字不变。
- [ ] 9. `src/log/schema.ts`、`migrations/`、`logger.ts`：按[诊断契约](../docs/diagnostics.md)为 `diagnostics.db` 生成两张表和独立迁移。用时间索引分批清理，两表分别为运行、请求、任务、调用 ID 和时间的组合建立查询索引，性能样本按版本和时间建立分析索引。迁移目录相对于模块定位。源码运行时读取 `src/log/migrations/`，打包产物读取 `dist/diagnostic-migrations/`；用 `import.meta.url` 是否以 `.ts` 结尾判断：是就取 `./migrations/`，否则取 `./diagnostic-migrations/`。加一条测试，直接运行构建产物，确认它找到的是复制后的迁移目录。
  - `createLogger({ dataDir, level, appVersion })` 返回 `Logger`，提供 `record(event)`、`sample(sample)`、`flush()`、`close()`。事件名、事件字段及指标数据按 §2.5 和诊断契约校验。写入端赋值记录 ID、运行 ID、时间和版本。模块按约定提供关联 ID。
  - 用 `pnpm --filter @unwritten/core exec drizzle-kit generate --config drizzle.diagnostics.config.ts` 生成诊断库迁移。连接使用 WAL、普通锁模式和 `busy_timeout = 0`。同一写入端用准备好的语句分批提交，每批结束后把控制权交回事件循环。保留裁剪、队列溢出和诊断库失效处理按诊断契约实现。导出供测试使用的时钟注入，正式调用用 `Date.now()` 记录发生时间、`performance.now()` 计算耗时。
  - 单测覆盖落库、重启读取、保留期、溢出与故障计数、级别筛选和字段白名单。用第二个连接持有读事务时检查写入仍成功，再持有写事务触发争用走故障分支。用注入的调度验证单轮批次上限以及余下记录会在后续轮次提交。诊断库不可用时校验正常业务可继续。用虚构的凭据和作品内容验证库里没有这些字段或原文，并检查数据目录中没有日志文件。
- [ ] 10. `src/events/bus.ts`：

  ```ts
  import type { CoreEvent } from "@unwritten/contracts";

  export interface EventBus {
    publish(event: CoreEvent): void;
    subscribe(signal: AbortSignal): AsyncGenerator<CoreEvent>;
  }

  export function createEventBus(): EventBus {
    const listeners = new Set<(event: CoreEvent) => void>();
    return {
      publish(event) {
        for (const listener of listeners) listener(event);
      },
      async *subscribe(signal) {
        const queue: CoreEvent[] = [];
        let wake: (() => void) | null = null;
        const notify = () => {
          const resolve = wake;
          wake = null;
          resolve?.();
        };
        const listener = (event: CoreEvent) => {
          queue.push(event);
          notify();
        };
        listeners.add(listener);
        signal.addEventListener("abort", notify, { once: true });
        try {
          while (!signal.aborted) {
            const next = queue.shift();
            if (next) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else wake = resolve;
            });
          }
        } finally {
          listeners.delete(listener);
          signal.removeEventListener("abort", notify);
        }
      },
    };
  }
  ```

  测试：两个订阅者都收到同一事件；按发布顺序收到；`abort` 后迭代结束，监听器被移除（再发布不报错、不积压）。
- [ ] 11. `src/llm/types.ts`：

  ```ts
  import type { ErrorCode } from "@unwritten/contracts";

  export type Purpose = "narrator" | "author_chat" | "background";

  export interface LlmToolResult {
    text: string;
    terminate: boolean;
  }

  export interface LlmTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(args: Record<string, unknown>): Promise<LlmToolResult>;
  }

  export interface LlmRunRef {
    kind: "turn_request" | "job";
    id: string;
    attempt: number;
    workId: string | null;
  }

  export interface LlmRunInput {
    purpose: Purpose;
    system: string;
    prompt: string;
    tools: LlmTool[];
    requiredToolName: string;
    sessionId: string;
    ref: LlmRunRef;
    signal?: AbortSignal;
  }

  export interface LlmRunResult {
    requiredToolTerminated: boolean;
  }

  export interface ResolvedModel {
    endpointId: string;
    modelId: string;
    contextWindow: number;
    maxOutputTokens: number;
  }

  export class LlmRunError extends Error {
    readonly code: ErrorCode;
    readonly detail: string | null;

    constructor(code: ErrorCode, detail: string | null) {
      super(code);
      this.name = "LlmRunError";
      this.code = code;
      this.detail = detail;
    }
  }
  ```

  工具的约定（T08 实现、T09 和 T10 使用）：
  - `execute` 抛出 `Error` 表示这次调用不合格，错误信息原样作为工具错误交还模型，模型会修正后重新调用。
  - `execute` 返回 `terminate: true` 表示结束整个工具循环。是否“成功”由工具自己记在闭包里，`run()` 不关心。
  - `run()` 在模型一次都没调用 `requiredToolName` 就结束时，补发提醒最多 2 次；仍然没有调用，抛 `LlmRunError("invalid_output")`。
- [ ] 12. `src/services.ts`：

  ```ts
  import type {
    AdoptPreviewInput,
    AdoptPreviewOutput,
    CreateEndpointInput,
    CreateEndpointOutput,
    GeneratePreviewInput,
    LlmConfigView,
    PreviewJobView,
    RetryInput,
    RouteIdInput,
    RouteView,
    SaveBackgroundInput,
    SaveBackgroundOutput,
    SetPurposeInput,
    SubmitActionInput,
    TestConnectionInput,
    TestConnectionResult,
    TurnRequestView,
    UpdateEndpointInput,
    WorkDetail,
    WorkIdInput,
    WorkSummary,
  } from "@unwritten/contracts";
  import type { EventBus } from "./events/bus.ts";
  import type { LlmRunInput, LlmRunResult, Purpose, ResolvedModel } from "./llm/types.ts";
  import type { Logger } from "./log/logger.ts";
  import type { Database } from "./store/db.ts";

  export interface LlmService {
    listProviders(): LlmConfigView;
    createEndpoint(input: CreateEndpointInput): Promise<CreateEndpointOutput>;
    updateEndpoint(input: UpdateEndpointInput): Promise<LlmConfigView>;
    setPurpose(input: SetPurposeInput): Promise<LlmConfigView>;
    testConnection(input: TestConnectionInput): Promise<TestConnectionResult>;
    resolve(purpose: Purpose): ResolvedModel | null;
    estimateTokens(text: string): number;
    run(input: LlmRunInput): Promise<LlmRunResult>;
    pruneCalls(): number;
  }

  export interface LibraryService {
    list(): WorkSummary[];
    create(input: WorkIdInput): WorkDetail;
    get(input: WorkIdInput): WorkDetail;
    saveBackground(input: SaveBackgroundInput): SaveBackgroundOutput;
  }

  export interface AuthoringService {
    generatePreview(input: GeneratePreviewInput): PreviewJobView;
    adoptPreview(input: AdoptPreviewInput): AdoptPreviewOutput;
    recoverInterrupted(): number;
    whenIdle(): Promise<void>;
  }

  export interface PlayService {
    getRoute(input: RouteIdInput): RouteView;
    submitAction(input: SubmitActionInput): TurnRequestView;
    retry(input: RetryInput): TurnRequestView;
    recoverInterrupted(): number;
    pruneOldRequestLogs(): number;
    whenIdle(): Promise<void>;
  }

  export interface CoreDeps {
    shutdown: AbortSignal;
    dataDir: string;
    db: Database;
    bus: EventBus;
    logger: Logger;
  }

  export interface Services {
    llm: LlmService;
    library: LibraryService;
    authoring: AuthoringService;
    play: PlayService;
    bus: EventBus;
    logger: Logger;
  }

  export interface ServiceFactories {
    llm(deps: CoreDeps): LlmService;
    library(deps: CoreDeps): LibraryService;
    authoring(deps: CoreDeps & { llm: LlmService }): AuthoringService;
    play(deps: CoreDeps & { llm: LlmService }): PlayService;
  }
  ```

  - 读接口和大部分写接口是同步的，因为 `node:sqlite` 是同步驱动。只有碰文件队列或网络的才是 `Promise`。
  - `recoverInterrupted()` 把运行中的请求或任务改成 `failed`、原因 `interrupted`，返回改了几行（T07 在启动时调用）。
  - `whenIdle()` 等待后台队列清空，供关闭流程和测试调用。后台任务在开始前检查 `shutdown`，进行中的模型调用也受它控制。
- [ ] 13. `src/test-support/temp-dir.ts`：`export function makeTempDataDir(): { dir: string; cleanup(): void }`，用 `fs.mkdtempSync(path.join(os.tmpdir(), "unwritten-"))` 建目录，`cleanup` 用 `fs.rmSync(dir, { recursive: true, force: true })`。
- [ ] 14. `src/test-support/scripted-llm.ts`：单元测试用的假 `LlmService`，T09、T10 的测试用它代替真实模型。

  ```ts
  export type ScriptStep = { args: Record<string, string> } | { fail: ErrorCode; detail?: string };

  export interface ScriptedLlm extends LlmService {
    runs: LlmRunInput[];
    enqueue(...steps: ScriptStep[]): void;
    setResolved(model: ResolvedModel | null): void;
  }

  export function createScriptedLlm(options?: { resolved?: ResolvedModel | null }): ScriptedLlm;
  ```

  - `resolve()` 返回 `setResolved` 设定的值，默认 `{ endpointId: "custom-test-000000", modelId: "test-model", contextWindow: 32768, maxOutputTokens: 8192 }`。
  - `estimateTokens` 用 T08 的估算规则的简化版：`Math.ceil(text.length * 2)`，足够测试预算逻辑。
  - `run(input)`：把 `input` 记进 `runs`；然后依次取队列里的步骤：遇到 `fail` 就抛 `new LlmRunError(step.fail, step.detail ?? null)`；遇到 `args` 就找到 `input.tools` 里名为 `input.requiredToolName` 的工具调用 `execute(step.args)`——抛错就继续取下一步（模拟模型修正），返回 `terminate: true` 就结束并返回 `{ requiredToolTerminated: true }`。队列取空仍未结束，抛 `LlmRunError("invalid_output")`。
  - 设置相关的方法（`listProviders` 等）直接抛 `Error("not scripted")`。
  - 自测：`scripted-llm.test.ts` 覆盖上面三种走向。
- [ ] 15. `src/text/turn-text.ts`：共享文本工具，T09 和 T10 都用这一份，不各写一份。

  ```ts
  export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
  export type JsonLine = { line: number; value: unknown };

  export function normalizeProse(text: string): string;
  export function parseJsonLines(text: string, label: string): ParseResult<JsonLine[]>;
  export function parseOptionLines(
    text: string,
    limits: { min: number; max: number; textMax: number },
  ): ParseResult<StoredOption[]>;
  ```

  - `normalizeProse`：把 CRLF 统一成 LF，去掉每行首尾空白和行尾空白，连续空行压成一个空行，去掉首尾空行；段落之间用一个空行分隔。
  - `parseJsonLines`：按行解析，跳过空行；每行必须是 JSON 对象；不是 JSON 时错误写 `第 N 行 <label>：不是合法的 JSON`，不是对象时写 `第 N 行 <label>：必须是对象`。返回每行的原始行号，供 T09/T10 写更具体的字段错误。
  - `parseOptionLines`：用 `parseJsonLines` 解析；每项必须有非空字符串 `text`，不能有 `hint`，`text` 去掉首尾空白后不超过 `limits.textMax`；条数在 `limits.min` 到 `limits.max` 之间；错误说明写明第几行、哪个字段。
  - 测试 `turn-text.test.ts`：CRLF、连续空行、首尾空行；JSON 行号错误；不是对象；选项的 `hint`、空 `text`、超长、条数上下限。

**注意事项。**

- `node:sqlite` 在 Node 24 里可能打印 ExperimentalWarning，这是正常的，不要为了压掉它改启动参数。
- Drizzle 1.0 的 API 和 0.x 有差别（关系查询、驱动入口）。一切以 `node_modules` 里的类型声明为准，不要照着网上 0.x 的例子写。
- JSON 列读出来是解析后的对象，Drizzle 不校验它的形状。写入前由调用方保证形状正确（用 `meta.ts` 里的类型约束）。
- 这个任务不写 `main.ts`，也不启动 HTTP。

**完成判据。**

- `pnpm --filter @unwritten/core typecheck`、`test` 通过；新增的 `turn-text.test.ts` 覆盖共享解析规则。
- 生成的迁移 SQL 里能看到两个带 `WHERE` 的唯一索引。
- 突变：把 `openDatabase` 里的 `PRAGMA locking_mode = EXCLUSIVE` 删掉，独占锁用例必须失败；恢复。把 `PRAGMA foreign_keys = ON` 删掉，级联删除用例必须失败；恢复。

### T05 测试用伪 OpenAI 服务

**目的。** 端到端测试要求“从界面配置模型开始”，所以模型调用必须走真实的 HTTP：界面填地址 → core 写 `providers.json` → `llm` 模块构造 pi-ai 服务商 → 发请求。这个伪服务实现 OpenAI 兼容的 `/v1/chat/completions`，按测试排好的脚本返回工具调用、文本、HTTP 错误、重定向或中途断线，并记下收到的每个请求，供测试断言上下文内容。core 的集成测试（T15）和端到端测试（T16）共用它。

**依赖。** T01。

**拥有的文件。** `packages/core/src/test-support/fake-openai-server.ts`、`llm-steps.ts`、`index.ts` 及其测试。

**先读。** OpenAI Chat Completions 的流式响应格式（SSE 的 `chat.completion.chunk`，`delta.tool_calls` 的分片规则）；本文 T08 的测试连接与 `run()` 部分（知道 core 会怎样调用它）。

**步骤。**

- [ ] 1. `fake-openai-server.ts` 的接口：

  ```ts
  export type FakeStep =
    | { kind: "tool_call"; name: string; arguments: string }
    | { kind: "text"; text: string }
    | { kind: "http_error"; status: number; message: string }
    | { kind: "redirect"; status: 301 | 302 | 303 | 307 | 308; location: string }
    | { kind: "drop_mid_stream" }
    | { kind: "hang" };

  export interface RecordedRequest {
    path: string;
    headers: Record<string, string>;
    body: unknown;
  }

  export interface FakeOpenAiServer {
    baseUrl: string;
    enqueue(...steps: FakeStep[]): void;
    pending(): number;
    requests: RecordedRequest[];
    reset(): void;
    close(): Promise<void>;
  }

  export function startFakeOpenAiServer(options?: { apiKey?: string }): Promise<FakeOpenAiServer>;
  ```

- [ ] 2. 实现要点：
  - 用 `node:http` 的 `createServer`，监听 `127.0.0.1` 的 0 端口，`baseUrl` 是 `http://127.0.0.1:<端口>/v1`。
  - 每个请求先读完 body，按 JSON 解析，连同路径和小写化的请求头记进 `requests`。
  - 设了 `apiKey` 时，`authorization` 头不等于 `Bearer <apiKey>` 就返回 401，body 是 `{"error":{"message":"invalid api key","type":"invalid_request_error"}}`。
  - 只处理 `POST /v1/chat/completions`，其他路径返回 404。
  - 从队列头取一步。队列空时返回 500，body 的 `message` 写 `"no scripted response"`，让测试一眼看出少排了脚本。
  - `tool_call`：请求体里 `stream` 为真时返回 SSE；否则返回普通 JSON。SSE 依次发：
    1. 一块 `delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_<序号>", type: "function", function: { name, arguments: "" } }] }`；
    2. 把 `arguments` 切成每段 40 个字符，每段一块 `delta: { tool_calls: [{ index: 0, function: { arguments: <这一段> } }] }`；
    3. 一块 `delta: {}`、`finish_reason: "tool_calls"`；
    4. 一块 `choices: []`，带 `usage: { prompt_tokens, completion_tokens, total_tokens }`（按请求和回复的字符数各除以 4 估一个数）；
    5. `data: [DONE]`。

    每块都是 `data: <JSON>\n\n`，JSON 里带 `id`、`object: "chat.completion.chunk"`、`created`、`model`（取请求里的 `model`）。响应头 `content-type: text/event-stream`。
  - `text`：同样的格式，`delta.content` 分段输出文本，`finish_reason: "stop"`。
  - `http_error`：返回对应状态码，body 是 `{"error":{"message":<message>}}`。
  - `redirect`：返回对应状态码和 `location` 头，body 为空。
  - `drop_mid_stream`：发出第 1 块和半个 `arguments` 分段后，直接 `socket.destroy()`。
  - `hang`：什么都不发，也不关连接，直到 `close()`。
  - `close()` 要能结束 `hang` 住的连接（记下所有 socket，关闭时逐个 `destroy`）。
- [ ] 3. `llm-steps.ts`：构造脚本步骤的帮助函数，参数都是普通的 TypeScript 值，函数负责拼出字符串参数。

  ```ts
  export function pingStep(): FakeStep;
  export function proposeTurnStep(input: {
    prose: string;
    options: string[];
    scene?: { place: string; time: string; present: string[] };
    ending?: boolean;
  }): FakeStep;
  export function proposePreviewStep(input: {
    title: string;
    blurb: string;
    publicSetting: string;
    prose: string;
    options: string[];
    place: string;
    time: string;
    language: string;
  }): FakeStep;
  export function rawToolStep(name: string, args: Record<string, string>): FakeStep;
  ```

  - `pingStep()` = `{ kind: "tool_call", name: "ping", arguments: "{}" }`。
  - `proposeTurnStep` 生成 `propose_turn` 的参数：`prose` 原样；`options` 每项写成一行 `{"text": …}`，用 `\n` 连接；`changes` 有 `scene` 时写一行 `{"type":"scene","place":…,"time":…,"present":"甲,乙"}`，否则是空字符串；`ending` 是 `"true"` 或 `"false"`。最后 `JSON.stringify` 成 `arguments`。
  - `proposePreviewStep` 同理，参数名用 `snake_case`：`title`、`blurb`、`public_setting`、`prose`、`options`、`place`、`time`、`language`。
  - `rawToolStep` 用来构造故意写错的参数。
- [ ] 4. `index.ts`：导出上面两个文件的全部公开名字，以及 T04 的 `makeTempDataDir`、`createScriptedLlm`。
- [ ] 5. `fake-openai-server.test.ts`：用原生 `fetch` 直接打伪服务：
  - `tool_call` 的流式响应能被逐块解析，拼回的 `arguments` 等于原文；
  - 错误 key 返回 401；
  - `redirect` 返回 302 和 `location`（`fetch` 用 `redirect: "manual"` 才能看到）；
  - 队列空返回 500；
  - `drop_mid_stream` 让读取 body 的 `fetch` 抛错；
  - `requests` 记下了请求体。

**注意事项。**

- 这个文件只用 Node 内置模块，不导入 pi-ai，也不导入 core 的业务代码。
- 测试脚本里的正文、选项全部虚构。
- 它不进构建产物：tsdown 的入口只有 `src/main.ts`，`test-support` 没有被 `main.ts` 导入。

**完成判据。**

- `pnpm --filter @unwritten/core test` 里本任务的用例通过。
- 突变：把 `tool_call` 的分段长度从 40 改成 0（死循环保护：如果写成 `while` 要确认不会卡死），或者删掉第 4 块 usage，用例里至少一条失败或超时；恢复。

### T06 client i18n 基础设施

**目的。** 文案从第一行代码起就走 i18n 层（[i18n §2](../docs/i18n.md#2-语言)）。这个任务搭好 i18next、按需加载、首屏的两个命名空间，以及两道检查：代码里用到的键都存在；`errors` 和 contracts 的错误码一一对应。后者保证 core 新增错误码时，client 少写文案会立刻测试失败。

**依赖。** T02。

**拥有的文件。** `apps/client/src/i18n/index.ts`、`backend.ts`、`keys.test.ts`、`zh-CN/common.json`、`zh-CN/errors.json`；`zh-CN/library.json`、`authoring.json`、`play.json`、`settings.json` 只建成 `{}`，之后转交页面任务。

**先读。** [i18n](../docs/i18n.md) 全文；本文 §2.4、附录 A。

**步骤。**

- [ ] 1. `backend.ts`：按需加载命名空间的 i18next 后端，不引入额外依赖。

  ```ts
  import type { BackendModule } from "i18next";

  const loaders = import.meta.glob<Record<string, unknown>>("./zh-CN/*.json", { import: "default" });

  export const lazyNamespaceBackend: BackendModule = {
    type: "backend",
    init() {},
    read(language, namespace, callback) {
      const load = loaders[`./${language}/${namespace}.json`];
      if (!load) {
        callback(new Error(`missing i18n namespace ${language}/${namespace}`), false);
        return;
      }
      load().then(
        (resources) => callback(null, resources),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), false),
      );
    },
  };
  ```

- [ ] 2. `index.ts`：

  ```ts
  import i18next from "i18next";
  import { initReactI18next } from "react-i18next";
  import { lazyNamespaceBackend } from "./backend.ts";
  import common from "./zh-CN/common.json";
  import errors from "./zh-CN/errors.json";

  export const UI_LANGUAGE = "zh-CN";

  export async function initI18n(): Promise<void> {
    await i18next
      .use(lazyNamespaceBackend)
      .use(initReactI18next)
      .init({
        lng: UI_LANGUAGE,
        fallbackLng: false,
        ns: ["common", "errors"],
        defaultNS: "common",
        resources: { [UI_LANGUAGE]: { common, errors } },
        partialBundledLanguages: true,
        interpolation: { escapeValue: false },
      });
  }

  export function loadNamespace(namespace: "library" | "authoring" | "play" | "settings"): Promise<void> {
    return i18next.loadNamespaces(namespace);
  }
  ```

  `escapeValue: false` 是因为 React 渲染时本身会转义；插值进去的作品数据仍按纯文本显示。路由在 `loader` 里调用 `loadNamespace`（T11），页面渲染时命名空间已经就绪，不需要 Suspense 兜底。
- [ ] 3. `zh-CN/common.json`、`zh-CN/errors.json`：照附录 A 的 A.1、A.2 写全。其余四个文件写 `{}`。
- [ ] 4. `keys.test.ts`（Node 环境）：
  - 读取 `src/` 下全部 `.ts`、`.tsx` 文件，排除 `*.test.*` 和 `src/i18n/`、`src/routeTree.gen.ts`。先断言文件数大于 0。
  - 用两个正则取出用到的键：`` /\bt\(\s*["'`]([a-z]+):([A-Za-z0-9_.-]+)["'`]/g `` 和 `/i18nKey=["']([a-z]+):([A-Za-z0-9_.-]+)["']/g`。
  - 用例 1：每个用到的键，在 `zh-CN/<命名空间>.json` 里按点号逐层取值，结果是非空字符串。失败时列出全部缺失的键。
  - 用例 2：`errors.json` 的顶层键集合等于 `ERROR_CODES` 加上 `unknown`，不多不少。`ERROR_CODES` 从 `@unwritten/contracts` 导入，不手抄。
  - 用例 3：每个 JSON 文件里的叶子值都是非空字符串。
  - 用例 4：没有被用到的键（`errors` 命名空间除外）用 `console.warn` 列出，不让测试失败（[i18n §10](../docs/i18n.md#10-强制检查)写的是“列出来提醒删除”）。
  - 这个阶段还没有页面代码，用例 1 可能只扫到很少的键；T11–T14 加上页面后它自然覆盖全部。

**注意事项。**

- 不建 `pseudo` 伪语言（§1.3 推迟）。
- JSON 文件不能写注释，本来也写不了。
- 用例 2 的方向是双向的：少写一个错误码的文案会失败，多写一个已经不存在的错误码也会失败。

**完成判据。**

- `pnpm --filter @unwritten/client test` 里本任务的用例通过。
- 突变：从 `errors.json` 删掉 `stale_head`，用例 2 失败；恢复。在任意 `.tsx` 里写一句 `t("common:nope.missing")`，用例 1 失败；删掉。

### T07 core HTTP 层与安全入口

**目的。** 实现 core 对外的唯一入口：Hono 应用负责 Host、Origin、令牌三道校验，发出带内容安全策略的 `index.html` 和静态资源，挂载 oRPC 契约的实现。同时写 `startCore()`，按顺序把日志、数据库、事件总线、各服务和 HTTP 服务装配起来。各服务的真实实现由 T08–T10 提供，这里通过 `ServiceFactories` 注入，测试里用假服务。

**依赖。** T04。

**拥有的文件。** `packages/core/src/api/*`、`packages/core/src/app.ts` 及其测试。

**先读。** [架构总览 §2.1、§2.2、§3、§7](../docs/architecture.md#21-本机接口的安全)；[主题与 token §9](../docs/theme.md#9-外观偏好与切换)；oRPC 1.x 的 server 文档（`implement`、`RPCHandler`、事件迭代器、中间件）；Hono 4 与 `@hono/node-server` 2.x 的 `serve`。

**步骤。**

- [ ] 1. `api/security.ts`：三个 Hono 中间件。

  ```ts
  export function hostGuard(getPort: () => number, logger: Logger): MiddlewareHandler;
  export function originGuard(logger: Logger): MiddlewareHandler;
  export function tokenGuard(token: string, logger: Logger): MiddlewareHandler;
  ```

  - `hostGuard`：`Host` 请求头必须正好是 `127.0.0.1:<端口>` 或 `localhost:<端口>`，端口是实际监听的端口（`getPort()`，因为监听 0 端口时启动后才知道）。否则返回 403，记 `http.rejected`（`reason: "host"`）。
  - `originGuard`：请求带 `Origin` 头时，它必须等于 `http://<Host 头的值>`。否则 403，`reason: "origin"`。不带 `Origin` 的请求放行。
  - `tokenGuard`：只挂在 `/api/*`。`Authorization` 必须是 `Bearer <令牌>`，用 `crypto.timingSafeEqual` 比较（两边长度不同时直接判不等，不调用它）。否则 401，`reason: "token"`。
  - 拒绝原因按 §2.5 记录为枚举。
  - 三个中间件都不设置任何 `Access-Control-*` 响应头。
- [ ] 2. `api/client-assets.ts`：

  ```ts
  export interface ClientAssets {
    dir: string;
    indexHtml: string;
    bootScript: string;
  }

  export function loadClientAssets(clientDir: string): ClientAssets | null;
  export function renderIndexHtml(assets: ClientAssets, nonce: string, appearance: Appearance): string;
  export function contentSecurityPolicy(nonce: string): string;
  export function newNonce(): string;
  ```

  - `loadClientAssets`：读 `index.html` 和 `boot.inline.js`。目录或文件不存在返回 `null`。`index.html` 里找不到 `<html lang="zh-CN">` 或 `<head>` 时抛错，让问题在启动时暴露。
  - `renderIndexHtml`：把第一处 `<html lang="zh-CN">` 换成 `<html lang="zh-CN" ${appearanceAttributes(appearance)}>`；把第一处 `<head>` 换成 `<head><script nonce="${nonce}">${bootScript}</script>`。只用这两处固定替换，不做别的字符串拼接。
  - `contentSecurityPolicy`：照[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全) 原文，nonce 插在 `script-src` 里：

    ```
    default-src 'self'; script-src 'self' 'nonce-<nonce>'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
    ```

  - `newNonce`：`randomBytes(16).toString("base64")`。
- [ ] 3. `api/router.ts`：用 oRPC 的 `implement(contract)` 实现全部过程。上下文类型是 `{ services: Services }`。每个处理函数只做一件事：从 `context.services` 里调用对应的方法，把结果原样返回。

  | 过程 | 调用 |
  | --- | --- |
  | `llm.providers.list` | `llm.listProviders()` |
  | `llm.endpoints.create` | `llm.createEndpoint(input)` |
  | `llm.endpoints.update` | `llm.updateEndpoint(input)` |
  | `llm.purposes.set` | `llm.setPurpose(input)` |
  | `llm.test` | `llm.testConnection(input)` |
  | `works.list` | `library.list()` |
  | `works.create` | `library.create(input)` |
  | `works.get` | `library.get(input)` |
  | `works.saveBackground` | `library.saveBackground(input)` |
  | `works.generatePreview` | `authoring.generatePreview(input)` |
  | `works.adoptPreview` | `authoring.adoptPreview(input)` |
  | `play.getRoute` | `play.getRoute(input)` |
  | `play.submitAction` | `play.submitAction(input)` |
  | `play.retry` | `play.retry(input)` |
  | `events.subscribe` | 异步生成器：`for await (const event of context.services.bus.subscribe(signal)) yield event;` |
  | `log.client` | 校验通过后，把结构化错误交给 `logger.record`，计时结果交给 `logger.sample`。由 core 设置来源和落库字段，返回 `{}` |

  给全部过程加一个统一的错误中间件（`os.use(...)` 或 oRPC 实际提供的等价写法）：
  - 捕获到 `ORPCError` 且 `code` 在 `ERROR_CODES` 里：记 `rpc.failed`（warn，`procedure` 是过程路径，`code`），原样抛出。
  - 捕获到 `ORPCError` 且 `code` 是 `BAD_REQUEST`（输入校验失败）：转成 `appError("invalid_input", error.message)` 抛出。
  - 其他错误：记 `rpc.crashed`（error，过程名与 `internal`），抛 `appError("internal", "unexpected error")`。不把原始错误信息透出给 client。

  如果 oRPC 的输入校验发生在中间件之外、捕获不到，就在 `RPCHandler` 的错误拦截器里做同样的转换；两处都做不到时，汇报，client（T11）对 `BAD_REQUEST` 另有回落。
- [ ] 4. `api/http-app.ts`：

  ```ts
  export function createHttpApp(options: {
    token: string;
    getPort(): number;
    assets: ClientAssets | null;
    services: Services;
    logger: Logger;
  }): Hono;
  ```

  路由顺序：
  1. `app.use("*", hostGuard(...))`，`app.use("*", originGuard(...))`。
  2. `app.use("/api/*", tokenGuard(...))`。
  3. `app.all("/api/*", …)`：`const { matched, response } = await rpcHandler.handle(c.req.raw, { prefix: "/api", context: { services } })`，`matched` 时返回 `response`，否则 404。`rpcHandler = new RPCHandler(router)` 在函数外创建一次。
  4. `app.get("/assets/*", …)`：自己实现静态文件，不用 `serveStatic`（它按进程工作目录解析根目录，容易出错）：
     - 取 `c.req.path` 去掉开头的 `/`，`path.resolve(assets.dir, 那段路径)`，结果必须以 `path.join(assets.dir, "assets") + path.sep` 开头，否则 404（防目录穿越）。
     - 文件不存在 404。
     - `Content-Type` 按扩展名：`.js` → `text/javascript; charset=utf-8`，`.css` → `text/css; charset=utf-8`，`.svg` → `image/svg+xml`，`.woff2` → `font/woff2`，`.png` → `image/png`，`.json` → `application/json`，`.map` → `application/json`，其他 `application/octet-stream`。
     - `Cache-Control: public, max-age=31536000, immutable`，`X-Content-Type-Options: nosniff`。
  5. `app.get("*", …)`：其余 GET 一律返回 `index.html`（单页应用回落）。`assets` 为 `null` 时返回 503，正文是纯文本 `client build not found`（给开发者看，不走 i18n）。响应头：`Content-Type: text/html; charset=utf-8`、`Cache-Control: no-store`、`Content-Security-Policy: <每次请求新的 nonce>`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。外观用 `DEFAULT_APPEARANCE`。
- [ ] 5. `app.ts`：

  ```ts
  export interface RunningCore {
    url: string;
    origin: string;
    port: number;
    token: string;
    services: Services;
    close(): Promise<void>;
  }

  export async function startCore(options: CliOptions, factories: ServiceFactories): Promise<RunningCore>;
  ```

  按顺序：
  1. `fs.mkdirSync(options.dataDir, { recursive: true })`。
  2. 用 core 包的版本和 `options.logLevel` 创建 `logger`，打开并迁移诊断库。用单调时钟保留步骤 1 前的启动起点。
  3. 测量 `core.library_open`，包含 `openDatabase(path.join(dataDir, "library.db"))` 的加锁与迁移。抛 `DataDirLockedError` 时记 `store.locked`，原样抛出。成功后记 `store.migrated`。
  4. 创建事件总线和关闭用的 `AbortController`，把 `shutdown` 信号和 `dataDir`、`db`、`bus`、`logger` 注入服务。
  5. 依次创建 `llm`、`library`、`authoring`（传入 `llm`）、`play`（传入 `llm`）。
  6. 恢复：`turnRequests = play.recoverInterrupted()`、`jobs = authoring.recoverInterrupted()`，记录 `core.recover` 和 `recovery.interrupted`。随后调用 `llm.pruneCalls()` 和 `play.pruneOldRequestLogs()` 清理过期留存，返回值不写日志。必须在 HTTP 开始监听之前做，这样任何页面都读不到“运行中却已经没人在跑”的请求。
  7. `token = randomBytes(32).toString("base64url")`。
  8. `assets = loadClientAssets(options.clientDir)`；为 `null` 时记一条 warn（`event: "client.assets.missing"`）。
  9. `app = createHttpApp(...)`；用 `@hono/node-server` 的 `serve` 在 `127.0.0.1`、`options.port` 上监听，等到真正开始监听后读出实际端口。
  10. `origin = "http://127.0.0.1:" + port`；`url = (options.clientOrigin ?? origin) + "/#token=" + token`。
  11. 记 `core.started` 和 `core.startup`。启动失败时记 `core.start_failed` 和已结束的计时，清理已经打开的业务资源，提交队列并关闭诊断连接，再把失败交给入口处理。启动地址留给 T15 输出。
  12. `close()`：复用同一个关闭 Promise。停止接受连接，发出关闭信号并断开长连接。等 HTTP 请求结束后排空创作和游玩队列，再关闭作品库。写入 `core.stopped`，提交队列，最后关闭诊断库。
- [ ] 6. `api/http-app.test.ts`：用假的 `Services`（每个方法用 `vi.fn` 返回固定值）和 `app.request()`：
  - 不带令牌请求 `/api/works/list` → 401；错误令牌 → 401；正确令牌 → 200。
  - `Host: evil.example:1234` → 403，即使令牌正确。
  - `Origin: http://evil.example` → 403；`Origin` 等于 `http://127.0.0.1:<端口>` → 放行。
  - 任何响应都没有 `access-control-allow-origin` 头。
  - `GET /` 返回的 HTML 里有 `data-uw-appearance="system"`、`<script nonce="X">`，且 `Content-Security-Policy` 头里的 nonce 也是 X；两次请求的 nonce 不同。
  - 静态资源路径校验以解析后仍命中 `/assets/*` 的请求为验收对象。对资源目录外文件的解析结果拒绝读取，未知资源返回 404。浏览器解析后已经变成站内页面路径的请求走单页应用回落。
  - 用 oRPC 客户端（`@orpc/client` 的 `createORPCClient` + `RPCLink`，`fetch` 指向 `app.fetch`）调用 `works.list`，拿到假服务返回的值；让假服务抛 `appError("stale_head", …)`，客户端收到的错误 `code` 是 `stale_head`；让假服务抛普通 `Error`，客户端收到 `internal`，错误信息里不含原始信息。
  - 事件流：订阅 `events.subscribe`，往假的事件总线发布一个事件，客户端收到它。
  - `log.client`：有效的事件与样本分别入库。未知字段及非法计时不会写入客户端提交的记录。RPC 拒绝事件只允许记录过程名和固定错误码。
  - 静态文件的测试用临时目录造一份假的 `index.html`、`boot.inline.js`、`assets/app.js`。
- [ ] 7. `app.test.ts`：用假的 `ServiceFactories` 和临时数据目录调用 `startCore`：返回的 `url` 形如 `http://127.0.0.1:<端口>/#token=<令牌>`；用 `fetch` 访问 `origin + "/api/works/list"`（带令牌）成功；`close()` 后端口不再接受连接；恢复函数在监听前被调用（假服务里记录调用顺序）。另让假 HTTP handler 和假后台任务分别在收到关闭信号后写库再结束，断言两者结束前数据库仍可用，结束后同一个数据目录能重新打开。

**注意事项。**

- core 里没有任何只在开发模式下放行的分支（[架构总览 §7](../docs/architecture.md#7-目录结构)）。
- 不要在日志里写 `url`、`token`、请求头的值。打印带令牌的地址是 T15 的 `main.ts` 的事，只写 stdout。
- oRPC 的 RPC 协议路径是 `/api/<过程路径用斜杠连接>`，例如 `/api/works/list`。不要另外写任何 REST 路由。
- 事件流是普通的 HTTP 流式响应，同样经过 Host、Origin、令牌三道校验。

**完成判据。**

- `pnpm --filter @unwritten/core typecheck`、`test` 通过。
- 突变：把 `hostGuard` 挂载那一行删掉，Host 用例失败；把 `timingSafeEqual` 比较改成恒为真，令牌用例失败；把 `renderIndexHtml` 里的 nonce 改成固定字符串，“两次请求 nonce 不同”的用例失败。逐个恢复。

### T08 core llm 模块

**目的。** 实现 `LlmService`：读写 `providers.json`（原子写入、修订号比较、坏文件不覆盖）、测试连接、按用途解析模型、跑工具调用循环（超时、重试一次、补发提醒、写调用记录）。`llm` 是 core 所有外发请求的唯一出口，也是唯一导入 pi-ai 的模块（[架构总览 §4](../docs/architecture.md#4-core-的内部模块)）。

**依赖。** T04、T05。

**拥有的文件。** `packages/core/src/llm/` 下除 `types.ts` 以外的全部文件及其测试。

**先读。** [LLM 端点](../docs/llm-endpoints.md) §2、§3、§5–§9；pi-ai 的 README（`node_modules/@earendil-works/pi-ai/README.md`）里的 Custom Providers、Client Identity、Tools、Error Handling、Stop Reasons 几节；pi-agent-core 的 README（Agent Options、Tools、Error Handling）；本文 T04 第 11 步的工具约定。

**步骤。**

- [ ] 1. `url.ts`：整理端点地址（[LLM 端点 §6](../docs/llm-endpoints.md#6-自定义端点)）。

  ```ts
  const TRAILING_SEGMENTS = ["/chat/completions", "/completions", "/models", "/messages"];

  export function normalizeBaseUrl(raw: string): string | null {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search) return null;
    let path = url.pathname;
    let changed = true;
    while (changed) {
      changed = false;
      path = path.replace(/\/+$/, "");
      for (const segment of TRAILING_SEGMENTS) {
        if (path.endsWith(segment)) {
          path = path.slice(0, -segment.length);
          changed = true;
        }
      }
    }
    return `${url.origin}${path}`;
  }
  ```

  测试：`http://127.0.0.1:11434/v1/` → `http://127.0.0.1:11434/v1`；`https://x.example/v1/chat/completions` → `https://x.example/v1`；`https://u:p@x.example/v1`、`https://x.example/v1?a=1`、`ftp://x.example`、`不是地址` → `null`；`https://x.example/v1#frag` → `https://x.example/v1`。
- [ ] 2. `endpoint-id.ts`：

  ```ts
  import { createHash } from "node:crypto";

  export function endpointSlug(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20)
      .replace(/-+$/g, "");
    return slug || "endpoint";
  }

  export function newEndpointId(name: string, requestId: string): string {
    const hex = createHash("sha256").update(requestId).digest("hex").slice(0, 6);
    return `custom-${endpointSlug(name)}-${hex}`;
  }
  ```

  六位十六进制取自 `requestId` 的哈希，而不是随机数：同一个创建请求重发时得到同一个 id，“重发复用创建请求分配的端点 id”因此成立（[LLM 端点 §10](../docs/llm-endpoints.md#10-core-接口)）。测试：同一 `requestId` 得到同一 id；中文名得到 `custom-endpoint-xxxxxx`；格式匹配 `/^custom-[a-z0-9-]{1,20}-[0-9a-f]{6}$/`。
- [ ] 3. `keys.ts`：

  ```ts
  import type { KeyStatus } from "@unwritten/contracts";

  const ENV_REFERENCE = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

  export function envVarOf(raw: string): string | null {
    const match = ENV_REFERENCE.exec(raw);
    return match ? (match[1] ?? match[2] ?? null) : null;
  }

  export function resolveApiKey(raw: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
    if (!raw) return undefined;
    const name = envVarOf(raw);
    if (name === null) return raw;
    return env[name] || undefined;
  }

  export function keyStatus(raw: string | undefined, env: NodeJS.ProcessEnv): KeyStatus {
    if (!raw) return { hasKey: false, source: "none", envVar: null };
    const name = envVarOf(raw);
    if (name !== null) return { hasKey: Boolean(env[name]), source: "env", envVar: name };
    return { hasKey: true, source: "file", envVar: null };
  }
  ```

  测试覆盖 `$A`、`${A}`、明文、空值、变量未设置。
- [ ] 4. `budget.ts`：

  ```ts
  export const DEFAULT_CONTEXT_WINDOW = 32_768;
  export const CJK_TOKENS_PER_CHAR = 2;
  export const OTHER_CHARS_PER_TOKEN = 3;
  export const MIN_DEFAULT_MAX_TOKENS = 256;
  export const MAX_DEFAULT_MAX_TOKENS = 16_384;

  const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

  export function estimateTokens(text: string): number {
    let cjk = 0;
    let other = 0;
    for (const char of text) {
      if (CJK_CHAR.test(char)) cjk += 1;
      else other += 1;
    }
    return cjk * CJK_TOKENS_PER_CHAR + Math.ceil(other / OTHER_CHARS_PER_TOKEN);
  }

  export function defaultMaxTokens(contextWindow: number): number {
    return Math.min(MAX_DEFAULT_MAX_TOKENS, Math.max(MIN_DEFAULT_MAX_TOKENS, Math.floor(contextWindow / 4)));
  }
  ```

  这些系数和上限是[LLM 端点 §6、§8](../docs/llm-endpoints.md#8-调用预算与错误) 里的默认值。测试：`estimateTokens("你好")` = 4；`estimateTokens("abcdef")` = 2；`defaultMaxTokens(32768)` = 8192；`defaultMaxTokens(512)` = 256；`defaultMaxTokens(1_000_000)` = 16384。
- [ ] 5. `fetch-guard.ts` 与 `fetch-guard-install.ts`：

  ```ts
  export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

  export class RedirectBlockedError extends Error {
    readonly status: number;

    constructor(status: number) {
      super(`redirect blocked: ${status}`);
      this.name = "RedirectBlockedError";
      this.status = status;
    }
  }

  export interface FetchRecorder {
    lastStatus: number | null;
    redirected: boolean;
  }

  export function createFetchRecorder(): FetchRecorder {
    return { lastStatus: null, redirected: false };
  }

  export function createGuardedFetch(base: typeof fetch, recorder?: FetchRecorder): typeof fetch {
    return async (input, init) => {
      const response = await base(input, { ...init, redirect: "manual" });
      if (recorder) recorder.lastStatus = response.status;
      if (REDIRECT_STATUSES.has(response.status)) {
        if (recorder) recorder.redirected = true;
        await response.body?.cancel();
        throw new RedirectBlockedError(response.status);
      }
      return response;
    };
  }

  let installed = false;
  let originalFetch: typeof fetch | null = null;

  export function installGlobalFetchGuard(): void {
    if (installed) return;
    originalFetch = globalThis.fetch;
    globalThis.fetch = createGuardedFetch(originalFetch);
    installed = true;
  }

  export function unguardedFetch(): typeof fetch {
    return originalFetch ?? globalThis.fetch;
  }
  ```

  `fetch-guard-install.ts` 只有一行：`installGlobalFetchGuard();`（从 `./fetch-guard.ts` 导入）。T15 让 `main.ts` 第一个导入它，早于 pi-ai 和各家 SDK 的加载（[LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)）。每次调用自己再包一层 `createGuardedFetch(unguardedFetch(), recorder)`，用来记录这次调用的 HTTP 状态，避免两层守卫重复读取响应。
- [ ] 6. `providers-schema.ts`：

  ```ts
  import { z } from "zod";

  export const PROVIDERS_FILE_VERSION = 1;

  const ModelEntrySchema = z.looseObject({
    id: z.string().min(1),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    tools: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    vision: z.boolean().optional(),
  });

  const EndpointEntrySchema = z.looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    api: z.enum(["openai-completions", "anthropic-messages"]),
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    models: z.array(ModelEntrySchema),
  });

  const PurposeRefSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });

  export const ProvidersFileSchema = z.looseObject({
    version: z.literal(PROVIDERS_FILE_VERSION),
    providers: z.record(z.string(), z.looseObject({ apiKey: z.string().optional() })).default({}),
    endpoints: z.array(EndpointEntrySchema).default([]),
    purposes: z
      .object({
        default: PurposeRefSchema.optional(),
        narrator: PurposeRefSchema.optional(),
        author_chat: PurposeRefSchema.optional(),
        background: PurposeRefSchema.optional(),
      })
      .default({}),
  });

  export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;
  export type EndpointEntry = z.infer<typeof EndpointEntrySchema>;

  export function emptyProvidersFile(): ProvidersFile {
    return { version: PROVIDERS_FILE_VERSION, providers: {}, endpoints: [], purposes: {} };
  }
  ```

  用 `looseObject` 是为了保留用户手写的、本版本不认识的字段：界面写回文件时不能把它们弄丢。
- [ ] 7. `providers-file.ts`：

  ```ts
  export type ProvidersState =
    | { status: "missing"; revision: "absent"; file: ProvidersFile }
    | { status: "ok"; revision: string; file: ProvidersFile }
    | { status: "invalid"; revision: string; problem: ConfigProblem }
    | { status: "too_new"; revision: string; problem: ConfigProblem };

  export interface ProvidersStore {
    load(): ProvidersState;
    write(file: ProvidersFile): ProvidersState;
    enqueue<T>(task: () => T | Promise<T>): Promise<T>;
  }

  export function createProvidersStore(filePath: string, onRevisionChange: (state: ProvidersState) => void): ProvidersStore;
  ```

  - **`load()`**：`fs.statSync`；不存在返回 `missing`（`file` 是 `emptyProvidersFile()`）。`mtimeMs` 和 `size` 都和缓存相同时返回缓存。否则读出字节：
    1. `revision` = 字节的 SHA-256 十六进制。
    2. `JSON.parse` 失败 → `invalid`，`problem` 是 `syntax`。行列号：错误信息里有 `line N column M` 就用它；否则从 `position N` 算（数 `N` 之前有几个 `\n`，列号是到上一个换行符的距离加一）；都没有就是第 1 行第 1 列。`message` 是解析器的原始信息。
    3. 解析结果是对象且 `version` 是大于 1 的数字 → `too_new`。
    4. `ProvidersFileSchema.safeParse` 失败 → `invalid`，`problem` 是 `schema`，`path` 是第一个问题的 `path.join(".")`，`message` 是它的 `message`。
    5. 成功 → `ok`。
    - `revision` 和上一次不同时调用 `onRevisionChange(state)`（第一次加载也调用）。T08 的服务在这个回调里发布 `llm.config_changed` 并记 `llm.config.loaded`。
  - **`write(file)`**：
    1. 内容 = `JSON.stringify(file, null, 2) + "\n"`。
    2. 临时文件名 = `` `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp` ``。它以 `providers.json.` 开头，所以落在 `.gitignore` 的规则里（[LLM 端点 §2](../docs/llm-endpoints.md#2-providersjson)）。
    3. `fs.writeFileSync(tmp, content, { mode: 0o600 })`，`fs.renameSync(tmp, filePath)`；非 Windows 再 `fs.chmodSync(filePath, 0o600)`。写失败时删掉临时文件再抛出。
    4. 清掉缓存，调用 `load()` 拿到新状态并返回。
  - **`enqueue(task)`**：用一条 Promise 链把所有写操作串起来：`tail = tail.then(task, task)`，返回这次任务的结果。前一个任务失败不影响后一个任务执行。
- [ ] 8. `classify.ts`：把一次失败归到错误类别。

  ```ts
  export interface FailureEvidence {
    httpStatus: number | null;
    redirected: boolean;
    timedOut: boolean;
    aborted: boolean;
    errorMessage: string;
  }

  export function classifyFailure(evidence: FailureEvidence): ErrorCode;
  ```

  按顺序判断，命中就返回：

  | 条件 | 结果 |
  | --- | --- |
  | `redirected` | `redirected` |
  | `timedOut` | `timeout` |
  | `aborted` | `interrupted` |
  | 状态 401、403 | `unauthorized` |
  | 状态 429，且信息匹配 `/quota\|insufficient\|exceeded\|billing\|usage limit\|limit reached/i` | `quota` |
  | 状态 429 | `rate_limited` |
  | 状态 400、413、422，且信息匹配 `/context\|too long\|maximum.*tokens\|token limit\|prompt is too long/i` | `context_overflow` |
  | 状态 404 | `not_compatible` |
  | 状态 ≥ 500 | `server` |
  | 状态是 null 或 2xx（连接失败，或流式输出中途断开），信息匹配 `/timeout\|timed out/i` | `timeout` |
  | 状态是 null 或 2xx | `network` |
  | 其他 | `server` |

  每一行写一条测试。
- [ ] 9. `pi.ts`：全仓唯一导入 `@earendil-works/*` 的文件。对外只暴露下面这些，类型里不出现 pi-ai 的类型：

  ```ts
  export interface RuntimeTarget {
    endpointId: string;
    endpointName: string;
    baseUrl: string;
    modelId: string;
    apiKey: string | undefined;
    contextWindow: number;
    maxOutputTokens: number;
  }

  export interface Transport {
    fetch: typeof fetch;
    headers: Record<string, string>;
    sessionId: string;
    signal: AbortSignal;
  }

  export interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cost: number;
    costFromProvider: boolean;
  }

  export interface CompletionOutcome {
    stopReason: string;
    errorMessage: string | null;
    calledToolNames: string[];
    usage: UsageTotals;
  }

  export function completeOnce(
    target: RuntimeTarget,
    transport: Transport,
    input: { system: string; user: string; tools: LlmTool[]; maxTokens: number },
  ): Promise<CompletionOutcome>;

  export interface AgentSession {
    prompt(text: string): Promise<CompletionOutcome>;
    abort(): void;
  }

  export function createAgentSession(
    target: RuntimeTarget,
    transport: Transport,
    input: { system: string; tools: LlmTool[]; onActivity(kind: "output" | "turn_end"): void },
  ): AgentSession;
  ```

  实现要点（API 细节以 `node_modules` 里的类型为准）：
  - **构造服务商。** 每次调用都按 `target` 新建：
    - 模型对象：`api: "openai-completions"`、`provider: target.endpointId`、`baseUrl`、`reasoning: false`、`input: ["text"]`、`cost` 全为 0、`contextWindow`、`maxTokens: target.maxOutputTokens`，`compat` 用保守设置：`supportsStore: false`、`supportsDeveloperRole: false`、`supportsReasoningEffort: false`、`maxTokensField: "max_tokens"`（[LLM 端点 §6](../docs/llm-endpoints.md#6-自定义端点)）。
    - `createProvider({ id, name, baseUrl, auth: { apiKey: { name, resolve: async () => ({ auth: apiKey ? { apiKey } : {} }) } }, models: [model], api: openAICompletionsApi() })`，`openAICompletionsApi` 从 `@earendil-works/pi-ai/api/openai-completions.lazy` 导入。
    - `createModels({ identity: IDENTITY })` 再 `setProvider`。
    - `IDENTITY = { userAgent: { custom: "unwritten/<core 的 package.json 版本>" }, attribution: null }`。不用 pi-ai 的 attribution：它会给某些服务商加上我们没有的网址；OpenCode 需要的请求头由 `run.ts` 自己加。
  - **`completeOnce`**：`models.complete(model, { systemPrompt, messages: [{ role: "user", content: user, timestamp: Date.now() }], tools }, { fetch, headers, sessionId, signal, maxRetries: 0, maxTokens })`。`tools` 是 `{ name, description, parameters }` 的数组。从返回的消息里取 `stopReason`、`errorMessage`、`content` 里 `type === "toolCall"` 的 `name`、`usage`。
  - **`createAgentSession`**：
    - `new Agent({ initialState: { systemPrompt, model, thinkingLevel: "off", tools: agentTools, messages: [] }, streamFn, sessionId, identity: IDENTITY, toolExecution: "sequential" })`。
    - `streamFn = (m, context, options) => models.streamSimple(m, context, { ...options, fetch: transport.fetch, headers: { ...options?.headers, ...transport.headers }, maxRetries: 0 })`。`maxRetries: 0` 关掉 SDK 自己的重试，重试策略只由 `run.ts` 决定（“自动重试最多一次”，[LLM 端点 §8](../docs/llm-endpoints.md#8-调用预算与错误)）。
    - 每个 `LlmTool` 转成 `AgentTool`：`execute: async (_id, params) => { const result = await tool.execute(params); return { content: [{ type: "text", text: result.text }], details: {}, terminate: result.terminate }; }`。工具抛出的错误由 Agent 交还模型。
    - `agent.subscribe`：`message_update` → `onActivity("output")`；`turn_end` → `onActivity("turn_end")`。
    - `transport.signal` 中止时调用 `agent.abort()`。
    - `prompt(text)`：`await agent.prompt(text)`，然后取 `agent.state.messages` 里最后一条 `role === "assistant"` 的消息，返回它的 `stopReason`、`errorMessage`；`usage` 是这次 `prompt` 新增的全部助手消息的用量之和。
- [ ] 10. `run.ts`：`export function createRunner(deps: RunnerDeps): (input: LlmRunInput) => Promise<LlmRunResult>`。`RunnerDeps` 包括 `db`、`logger`、`shutdown`、`timeouts` 和 `targetFor(purpose): RuntimeTarget | null`。

  常量（默认值，测试可以覆盖）：

  ```ts
  export interface LlmTimeouts {
    firstOutputMs: number;
    stallMs: number;
  }

  export const DEFAULT_TIMEOUTS: LlmTimeouts = { firstOutputMs: 120_000, stallMs: 60_000 };
  export const MAX_TOOL_ROUNDS = 8;
  export const MAX_NUDGES = 2;
  export const RATE_LIMIT_RETRY_DELAY_MS = 2_000;
  const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["network", "timeout", "server", "rate_limited"]);
  ```

  `run(input)`：
  1. `target = targetFor(input.purpose)`，为 `null` 时抛 `LlmRunError("llm_not_configured", null)`。
  2. 最多两次尝试。每次尝试：
     - `recorder = createFetchRecorder()`，`fetch = createGuardedFetch(unguardedFetch(), recorder)`。
     - 每次尝试使用自己的 `AbortController`。它和 `input.signal`、`shutdown` 一起组成模型调用的信号。信号已中止时直接按 `interrupted` 结束。重试等待也响应中止。
     - `headers = opencodeHeaders(target.baseUrl, input.sessionId)`：主机名是 `opencode.ai` 时返回 `{ "x-opencode-client": "unwritten", "x-opencode-session": sessionId }`，否则 `{}`（[LLM 端点 §5](../docs/llm-endpoints.md#5-opencode-go)）。导出这个函数，单独测试。
     - 包一层工具：名为 `input.requiredToolName` 的工具被调用时记 `state.requiredCalled = true`，它返回 `terminate: true` 时记 `state.terminated = true`。
     - 计时：开始时设首次输出计时器（`firstOutputMs`）；第一次 `onActivity("output")` 时清掉它、开始停顿计时器（`stallMs`），以后每次输出都重置停顿计时器。任一计时器到点：`state.timedOut = true`，`session.abort()`。
     - `onActivity("turn_end")`：`state.rounds += 1`；超过 `MAX_TOOL_ROUNDS` 时 `state.tooManyRounds = true`，`session.abort()`。
     - 进入模型调用前生成 `callId`，记下起点。第一次 `onActivity("output")` 记录首输出终点。
     - `outcome = await session.prompt(input.prompt)`。之后只要 `outcome.stopReason` 不是 `"error"` / `"aborted"`、`state.terminated` 为假、补发次数小于 `MAX_NUDGES`，就 `outcome = await session.prompt(提醒)`，提醒文字是 `` `请调用 ${input.requiredToolName} 提交结果，不要直接回复文字。` ``。
     - 统一处理成功返回、SDK 抛错和中止，判定这次尝试的结果：
       - `state.tooManyRounds` → 失败 `invalid_output`；
       - SDK 抛错，或 `stopReason` 是 `"error"` 或 `"aborted"` → 失败，类别 = `classifyFailure({ httpStatus: recorder.lastStatus, redirected: recorder.redirected, timedOut: state.timedOut, aborted: input.signal?.aborted || shutdown.aborted, errorMessage })`，`detail = scrubSecrets(errorMessage, [target.apiKey]).slice(0, 500)`；
       - `state.terminated` 为假 → 失败 `invalid_output`；
       - 否则判为成功。
     - 清理计时器，记录 `llm.call` 和已有终点的 `llm.first_output`，写入 `llm_calls`。三处沿用同一个 `callId`。模型样本带 `input.ref.attempt`，按该次调用的最终结果归组。成功时返回 `{ requiredToolTerminated: true }`。
  3. 失败时：类别在 `RETRYABLE` 里、这次尝试没有收到任何输出（没有过 `onActivity("output")`）、是第一次尝试、`input.signal` 没有中止——满足全部条件才重试；`rate_limited` 先等 `RATE_LIMIT_RETRY_DELAY_MS`。否则抛 `LlmRunError(类别, detail)`。

  `llm_calls` 的一行：`id` 使用当次 `callId`；`purpose`；`workId` 取 `input.ref.workId`；`provider` 是端点 id；`model`；`refKind`、`refId` 取 `input.ref`；三个 token 数和 `cost`、`costFromProvider`（转成 0/1）取自用量；`durationMs`；`status` 是 `ok` / `error` / `aborted`；`error` 是类别或 `null`；`createdAt`。
- [ ] 11. `test-connection.ts`：`export function createConnectionTester(deps): (input: TestConnectionInput) => Promise<TestConnectionResult>`。
  1. `baseUrl = normalizeBaseUrl(input.baseUrl)`；为 `null` 时返回 `{ ok: false, code: "invalid_url", detail: null, savedToolsCapability: false }`。
  2. key：`set` → 原值；`keep` → 找到对应端点（找不到抛 `appError("endpoint_not_found", …)`），取它的 `apiKey`；`none` → 无。再经 `resolveApiKey` 解析 `$VAR`。
  3. `completeOnce(target, transport, { system: "你在做连接测试。只调用 ping 工具，不要输出其他内容。", user: "调用 ping。", tools: [PING_TOOL], maxTokens: 1024 })`。`PING_TOOL` 的参数是 `{ type: "object", properties: {}, additionalProperties: false }`，`execute` 不会被调用。`transport.signal` 合并 `shutdown` 和 `AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS)`，`TEST_CONNECTION_TIMEOUT_MS = 20_000`。`contextWindow` 用 `DEFAULT_CONTEXT_WINDOW`。
  4. 结果：
     - `stopReason` 是 `"error"` / `"aborted"`：类别按 `classifyFailure` 判；判成 `network` 且 `recorder.lastStatus` 为 `null`（一个响应都没收到）时改成 `unreachable`；判成 `interrupted` 时（超时信号触发）改成 `timeout`。`detail` 脱敏后截到 500 字。
     - 调用了 `ping`：`ok: true`。如果 key 是 `keep`、端点的 `baseUrl` 和这次一样、端点下有这个模型，就排队把这个模型的 `tools` 写成 `true`（文件状态不是 `ok` 时跳过）；写成了或者本来就是 `true`，`savedToolsCapability` 为真。
     - 其他：`{ ok: false, code: "no_tool_call" }`。
  5. 每条返回路径记录 `llm.test` 和 `llm.connection_test`。连接测试不计入作品用量。
- [ ] 12. `service.ts`：`export function createLlmService(deps: CoreDeps, options?: { env?: NodeJS.ProcessEnv; timeouts?: Partial<LlmTimeouts> }): LlmService`。
  - `store = createProvidersStore(path.join(dataDir, "providers.json"), onRevisionChange)`；`onRevisionChange` 发布 `{ type: "llm.config_changed" }`，记 `llm.config.loaded`（第一次加载只记日志，不发布事件）。
  - **`listProviders()`**：`load()` 后转成 `LlmConfigView`：
    - `status`、`revision` 照抄状态；`problem` 只在 `invalid` / `too_new` 时有值。
    - `invalid` / `too_new` 时 `endpoints` 为空数组、`defaultModel` 为 `null`。
    - 每个端点：`key = keyStatus(apiKey, env)`；模型的能力字段缺省时为 `null`。**视图里永远不出现 `apiKey` 字段。**
    - `defaultModel` 来自 `purposes.default`；`defaultModelUsable` = `resolve("narrator") !== null` 且解析到的就是默认模型。
  - **`createEndpoint(input)`**：
    1. `baseUrl = normalizeBaseUrl(input.baseUrl)`，`null` 时抛 `appError("invalid_url", …)`。
    2. 进入 `store.enqueue`：
       - 状态 `invalid` → `appError("llm_config_invalid", …)`；`too_new` → `appError("llm_config_too_new", …)`。
       - `id = newEndpointId(input.name, input.requestId)`。
       - 文件里已有这个 id：名称、地址、模型 id 都相同 → 直接返回 `{ endpointId: id, config: 当前视图 }`（重发）；否则 `appError("idempotency_conflict", …)`。
       - `state.revision !== input.baseRevision` → `appError("config_conflict", …)`。
       - 复制一份文件（`structuredClone`），追加 `{ id, name, api: "openai-completions", baseUrl, apiKey?, models: [{ id: modelId }] }`（`apiKey` 为 `null` 时不写这个字段）；`makeDefault` 为真时 `purposes.default = { provider: id, model: modelId }`。
       - `store.write`，记 `llm.config.written`，返回新视图。
  - **`updateEndpoint(input)`**：同样进入队列、同样检查文件状态。
    - 找不到端点 → `endpoint_not_found`。
    - 目标 key：`keep` → 原值；`set` → 新值；`remove` → 无。
    - 名称、模型 id、目标 key 都和文件里一样 → 直接返回当前视图（重发或没有改动）。
    - 修订号不一致 → `config_conflict`。
    - 写入：改名称；模型 id 变了就把 `models` 换成 `[{ id: 新模型 id }]`（能力字段随之清空，因为它们属于旧模型），并把 `purposes` 里所有指向 `(这个端点, 旧模型 id)` 的项改成新模型 id；设置或删除 `apiKey`。
  - **`setPurpose(input)`**：端点不存在或端点下没有这个模型 → `endpoint_not_found`；`purposes.default` 已经是它 → 返回当前视图；修订号不一致 → `config_conflict`；否则写入。
  - **`resolve(purpose)`**：`load()`；状态不是 `ok` → `null`。取 `purposes[purpose] ?? purposes.default`；找不到端点、端点的 `api` 不是 `openai-completions`、端点下没有这个模型、或者 `purpose` 是 `narrator` / `author_chat` 而模型的 `tools === false` → `null`。否则返回 `{ endpointId, modelId, contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW, maxOutputTokens: maxTokens ?? defaultMaxTokens(contextWindow) }`。
  - `targetFor(purpose)` 是 `resolve` 的内部版本，多带 `endpointName`、`baseUrl`、解析后的 `apiKey`，只给 `run.ts` 用，不出 `llm` 模块。
  - `estimateTokens` 直接用 `budget.ts` 的。`run` 用 `createRunner`，`testConnection` 用 `createConnectionTester`。
  - `pruneCalls()`：删除 `LLM_CALL_RETENTION_DAYS = 90` 天以前的 `llm_calls` 行，返回删除行数。T07 在启动时调用。
  - 修改配置后从下一次 `resolve` 开始生效；已经在跑的 `run` 继续用它开始时拿到的 `target`（[LLM 端点 §7](../docs/llm-endpoints.md#7-用途分配)）。
- [ ] 13. 测试。单元测试放在各自文件旁边；用到伪服务的放进 `service.test.ts`、`run.test.ts`、`test-connection.test.ts`。每个测试都用临时数据目录。
  - `providers-file.test.ts`：缺文件 → `missing`；`{"version": 1,\n  oops\n}` → `syntax`，行号 2；`{"version":1,"endpoints":[{"id":1}]}` → `schema`，`path` 以 `endpoints.0` 开头；`{"version":2}` → `too_new`；写入后目录里只剩 `providers.json`，没有残留临时文件；非 Windows 上文件权限是 `0o600`；用户手写的未知顶层字段写回后仍在。
  - `service.test.ts`：
    - 新增端点后文件内容正确；同一 `requestId` 重发返回同一个 id，文件里只有一个端点；同一 `requestId` 换了名称 → `idempotency_conflict`。
    - 用过期的 `baseRevision` 写入 → `config_conflict`，文件字节不变。
    - 文件是坏 JSON 时写入 → `llm_config_invalid`，文件字节不变；`listProviders()` 返回 `invalid` 和行列号。
    - `updateEndpoint` 的 `keep` / `set` / `remove` 三种走向；改模型 id 后 `purposes.default` 跟着改。
    - 任何视图 `JSON.stringify` 之后都不包含 key 的值；`$MY_KEY` 写法显示 `source: "env"`、`envVar: "MY_KEY"`。
    - 手动改写文件后再调 `listProviders()`，事件总线收到 `llm.config_changed`。
    - `resolve`：没有默认 → `null`；默认模型 `tools: false` → `null`；正常 → 带默认预算。
  - `test-connection.test.ts`（伪服务）：`pingStep()` → `ok: true`，`keep` 时模型的 `tools` 写成 `true`；伪服务设了 key 而测试用错的 → `unauthorized`；回复文本 → `no_tool_call`；伪服务返回 302 指向第二个伪服务 → `redirected`，第二个伪服务一个请求都没收到；连一个已关闭的端口 → `unreachable`；伪服务返回 401 且错误信息里带着 key 原文 → `detail` 里没有 key。
  - `run.test.ts`（伪服务，`timeouts` 设成几百毫秒）：
    - 工具调用一次成功 → 返回；伪服务收到 1 个请求，请求头 `user-agent` 是 `unwritten/0.1.0`。
    - 先回文本、再调工具 → 成功，伪服务收到 2 个请求（补发提醒生效）。
    - 连续 3 次文本 → `invalid_output`。
    - 第一次 500、第二次成功 → 成功，收到 2 个请求；连续两次 500 → `server`。
    - 401 → `unauthorized`，只收到 1 个请求。
    - `drop_mid_stream` → `network`，只收到 1 个请求（已经收到过输出，不重试）。
    - `hang` → `timeout`。
    - 每次尝试都写了一行 `llm_calls`，包括 SDK 直接抛错和已开始的调用被中止。诊断事件按 `callId` 关联。首输出前失败的调用没有首输出样本，自动重试得到的新调用 ID 与应用层尝试号分别核对。
    - `opencodeHeaders`：`https://opencode.ai/inference/go/openai/v1` 返回两个头，其他主机返回空对象。
  - `fetch-guard.test.ts`：`installGlobalFetchGuard()` 之后，对返回 302 的伪服务调用全局 `fetch` 会抛 `RedirectBlockedError`，跳转目标收不到请求。
  - `pruneCalls()` 删掉 90 天以前的 `llm_calls`，保留较新的行。

**注意事项。**

- **key 不出 core。** 诊断只记录白名单字段。返回给 client 的错误详情经 `scrubSecrets` 脱敏，诊断库记录错误码。
- **pi-ai 的 API 名字可能和本文写的有出入。** 以 `node_modules/@earendil-works/pi-ai/dist/*.d.ts` 为准；行为差别大到要改设计时（例如无法传入自定义 `fetch`），停下来汇报。
- **不要依赖 SDK 抛出的错误文本判断重定向。** 重定向只看 `recorder.redirected`。
- 本里程碑不做内置服务商、模型发现、Anthropic 协议的调用。文件里如果有 `anthropic-messages` 端点，照常列出，但 `resolve` 不会选中它。
- `run.ts` 只关心“必需工具有没有以 `terminate` 结束”，不关心模型交上来的内容对不对——那是工具自己的事。

**完成判据。**

- `pnpm --filter @unwritten/core typecheck`、`test` 通过。
- `rg "@earendil-works" packages/core/src` 只命中 `llm/pi.ts`。
- 突变：
  - 把 `createGuardedFetch` 里的 `redirect: "manual"` 删掉，重定向用例必须失败（跳转目标收到请求）。
  - 把 `createEndpoint` 里比较 `baseRevision` 的那一行删掉，`config_conflict` 用例必须失败。
  - 把 `listProviders` 的端点视图改成展开整个端点对象（`...endpoint`），“视图里没有 key”的用例必须失败。
  - 把重试条件里的“没有收到输出”去掉，`drop_mid_stream` 用例必须失败（会收到 2 个请求）。
  - 逐个恢复。

### T09 core 作品库与开场预览

**目的。** 实现“写背景 → 生成预览 → 采用并存入作品库”这一段。三条约束最要紧：预览绑定生成时的草稿修订号，改过背景后旧预览不能采用；采用在一个事务里完成全部写入（发布版本、发布指针、开局、根回合、第一条路线）；所有写命令都幂等。

**依赖。** T04 和 T00 的预览任务契约。T08 可以并行，模型调用测试用 `createScriptedLlm`。

**拥有的文件。** `packages/core/src/library/*`、`packages/core/src/authoring/*` 及其测试。

**先读。** [数据模型 §2–§3](../docs/data-model.md#2-作品与版本)；[创作工作站 §9](../docs/author-workstation.md#9-生成任务)；[回合循环 §10](../docs/turn-loop.md#10-开场)；[第一个里程碑](../docs/milestone-1.md)“预览开场”一行与实现顺序第 3 条；本文附录 B.1。

**步骤。**

- [ ] 1. `library/service.ts`：`export function createLibraryService(deps: CoreDeps): LibraryService`。
  - 导出 `workLabel(title: string | null, background: string): string`：有标题返回标题；否则取背景里第一行非空文字（先 `trim`），超过 40 个字符截成前 40 个（按 `Array.from` 的字符计，不按 UTF-16 单元）；都没有返回 `""`。
  - **`list()`**：全部作品按 `updatedAt` 倒序。每部作品返回标题和简介，`label` 用草稿的背景计算，`status` 随发布指针取 `playable` 或 `draft`。`routeId` 取发布版本下正式开局的第一条路线（按 `createdAt` 取最早的一条）。没有路线时给 `null`，`hasProgress` 为假。有路线时比较它的 head 和该开局的根回合。
  - **`create({ workId })`**：事务里：作品已存在 → 直接返回 `get`（重发）。否则插入 `works`（`title`、`blurb`、`publishedId` 为空，`draftId` 是新版本 id）和一条 `work_versions`（`kind = 'draft'`、`contentRev = 0`、`meta = { background: "" }`）。事务外发布 `works.changed`，返回 `get`。
  - **`get({ workId })`**：作品不存在 → `appError("not_found", …)`。返回 `WorkDetail`：
    - `draft` 取 `draftId` 指向的版本的 `contentRev` 和 `meta.background`；
    - `latestPreviewJob` 是这部作品 `kind = 'preview'` 的任务里 `createdAt` 最新的一个，转成 `PreviewJobView`：`basedOnContentRev` 取 `input.contentRev`，`preview` 取 `result?.preview ?? null`；
    - `routeId` 同 `list()`。
  - **`saveBackground({ workId, baseContentRev, background })`**：事务里：
    1. 作品不存在 → `not_found`；已发布 → `already_published`（本里程碑发布后不改稿）。
    2. 当前背景和传入的完全相同 → 返回当前 `contentRev`，不加一（重发或没有改动）。
    3. `baseContentRev` 不等于当前 `contentRev` → `stale_revision`。
    4. 写入新背景，`contentRev + 1`，版本和作品的 `updatedAt` 更新。
    事务外发布 `works.changed`。
- [ ] 2. 共享文本工具已在 T04 的 `src/text/turn-text.ts` 里（`normalizeProse`、`parseJsonLines`、`parseOptionLines`）。本任务和 T10 都用它，不要各写一份。
- [ ] 3. `authoring/preview-tool.ts`：

  ```ts
  export const PREVIEW_TOOL_NAME = "propose_preview";

  export const PREVIEW_LIMITS = {
    titleMax: 40,
    blurbMax: 200,
    publicSettingMax: 1_000,
    proseMax: 6_000,
    paragraphsMax: 20,
    optionsMin: 1,
    optionsMax: 6,
    optionTextMax: 100,
    placeMax: 100,
    timeMax: 100,
  } as const;

  export const PREVIEW_TOOL_PARAMETERS = {
    type: "object",
    properties: {
      title: { type: "string", description: "作品标题" },
      blurb: { type: "string", description: "给玩家看的简介，一两句话，不剧透" },
      public_setting: { type: "string", description: "简短的公开设定：世界、主角身份和处境" },
      prose: { type: "string", description: "开场正文，段落之间空一行" },
      options: { type: "string", description: '推荐行动，每行一个 JSON：{"text":"…"}' },
      place: { type: "string", description: "开场结束时主角所在的地点" },
      time: { type: "string", description: "开场结束时的故事时间" },
      language: { type: "string", description: "作品语言的语言标签，例如 zh-CN" },
    },
    required: ["title", "blurb", "public_setting", "prose", "options", "place", "time", "language"],
    additionalProperties: false,
  } as const;

  export function parsePreviewArgs(args: Record<string, unknown>): ParseResult<Preview>;
  ```

  `ParseResult<T>` 定义在 `turn-text.ts`：`{ ok: true; value: T } | { ok: false; errors: string[] }`。校验规则，每条不通过就往 `errors` 里加一句给模型看的中文说明（写清哪个参数、为什么）：
  - 每个参数都必须是字符串，缺了或不是字符串：`参数 title 必须是字符串`。
  - `title`、`blurb`、`public_setting`、`place`、`time` 去掉首尾空白后不能为空，且不超过对应上限。
  - `prose` 用 `normalizeProse` 整理后，段落数在 1 到 20 之间，总长不超过 6000 个字符。
  - `options` 用 `parseOptionLines` 解析，条数在 1 到 6 之间。
  - `language` 符合 contracts 里的 `LanguageTagSchema`。
  - 全部通过时返回 `Preview`：`publicSetting` 对应 `public_setting`，`scene` 是 `{ place, time }`，其余字段同名。
- [ ] 4. `authoring/preview-prompt.ts`：导出附录 B.1 的 `PREVIEW_SYSTEM_PROMPT`，以及 `buildPreviewPrompt(background: string): string`，返回 `` `【作者背景】\n${background}` ``。
- [ ] 5. `authoring/service.ts`：`export function createAuthoringService(deps: CoreDeps & { llm: LlmService }): AuthoringService`。
  - 后台队列：`new PQueue({ concurrency: PREVIEW_CONCURRENCY })`，`PREVIEW_CONCURRENCY = 1`。`MAX_CORRECTIONS = 2`（[回合循环 §6](../docs/turn-loop.md#6-校验与保存)：模型最多修正 2 次）。
  - **`generatePreview({ workId, jobId, contentRev })`**：事务里按顺序检查：
    1. `jobId` 已存在：同一作品、同一 `contentRev` → 返回它的视图（重发）；否则 `idempotency_conflict`。
    2. 作品不存在 → `not_found`；已发布 → `already_published`。
    3. `contentRev` 不等于草稿当前的 `contentRev` → `stale_revision`。
    4. 草稿背景 `trim()` 后为空 → `invalid_input`。
    5. 这部作品已有 `running` 的预览任务 → `job_running`。
    6. `llm.resolve("narrator")` 为 `null` → `llm_not_configured`。
    7. 插入任务：`kind = 'preview'`、`status = 'running'`、`input = { contentRev, background }`（背景在这一刻冻结，[创作工作站 §9](../docs/author-workstation.md#9-生成任务)）。
    事务外：只有新登记任务才发布 `job.updated`、记录 `preview.job.started` 并执行 `queue.add(() => runPreviewJob(jobId))`，返回视图。幂等重发直接返回已有视图。
  - **`runPreviewJob(jobId)`**（不导出）：
    1. 读任务，不是 `running` 就返回。
    2. 建工具：`execute(args)` 调 `parsePreviewArgs`。通过 → 记下结果，返回 `{ text: "已收到。", terminate: true }`。不通过 → 失败次数加一；超过 `MAX_CORRECTIONS` → 返回 `{ text: 错误说明, terminate: true }`（结束循环，不记结果）；否则 `throw new Error(错误说明)`（交还模型修正）。错误说明是 `errors.join("\n")`。
    3. `await llm.run({ purpose: "narrator", system: PREVIEW_SYSTEM_PROMPT, prompt: buildPreviewPrompt(input.background), tools: [tool], requiredToolName: PREVIEW_TOOL_NAME, sessionId: workId, ref: { kind: "job", id: jobId, attempt: 1, workId } })`。会话标识用作品 id（[LLM 端点 §5](../docs/llm-endpoints.md#5-opencode-go)）。
    4. 抛 `LlmRunError` → 任务失败，原因是它的 `code`；抛别的错误 → 原因 `internal`。
    5. 没有记下结果 → 失败，原因 `invalid_output`。
    6. 成功 → `UPDATE jobs SET status = 'done', result = { preview, adoption: null } WHERE id = ? AND status = 'running'`。写入抛错时记录失败的 `preview.commit`，任务按 `save` 失败处理。
    7. 失败 → `UPDATE jobs SET status = 'failed', error = ? WHERE id = ? AND status = 'running'`。
    8. 发布 `job.updated`，记 `preview.job.done` 或 `preview.job.failed`。
  - **计时。** 任务登记成功后记录尝试的起点，进入后台处理时结束排队计时。每次解析与校验提案、提交生成结果都有独立区间。任务完成、失败或可处理地中断时结束总计时。各样本沿用 `workId`、`jobId`。
  - **`adoptPreview({ workId, jobId })`**：一个事务完成全部写入：
    1. 任务不存在，或任务不属于这部作品 → `not_found`。
    2. 任务的 `result.adoption` 已有值 → 直接返回 `{ routeId: adoption.routeId }`（重发）。
    3. 作品已发布 → `already_published`。
    4. 任务不是 `done` → `preview_not_ready`。
    5. 任务的 `input.contentRev` 不等于草稿当前的 `contentRev` → `stale_preview`。
    6. 写入（`now = Date.now()`，`nextRev = 草稿 contentRev + 1`，新 id 都用 `crypto.randomUUID()`）：
       - 新的 `meta`：

         ```ts
         const meta: VersionMeta = {
           background: draft.meta.background,
           plan: { items: [{ id: PUBLIC_SETTING_PLAN_ITEM_ID, text: preview.publicSetting, source: "ai" }] },
           opening: { prose: preview.prose, options: preview.options, scene: { ...preview.scene, present: [] } },
           narration: { language: preview.language },
         };
         ```

       - 更新草稿：`meta`、`contentRev = nextRev`、`updatedAt`。
       - 插入发布版本：`kind = 'published'`、`copiedFrom = 草稿 id`、`contentRev = nextRev`、`sourceRev = nextRev`、同一份 `meta`。
       - 更新作品：`title = preview.title`、`blurb = preview.blurb`、`publishedId = 发布版本 id`、`updatedAt`。
       - 插入开局：`versionId = 发布版本 id`、`kind = 'play'`、`rootTurnId = 根回合 id`。
       - 插入根回合：`parentId = null`、`depth = 0`、`action = null`、`prose`、`options`、`scene = meta.opening.scene`、`status = 'committed'`。
       - 插入路线：`headTurnId = 根回合 id`。
       - 更新任务：`result = { preview, adoption: { versionId, routeId } }`。
    事务外：发布 `works.changed`，记 `work.adopted`，返回 `{ routeId }`。
  - **`recoverInterrupted()`**：把 `running` 的任务标为 `failed` / `interrupted`，取回本次更新的 `jobId`、`workId`。事务结束后逐条记 `preview.job.failed`，返回改动行数。
  - **`whenIdle()`**：`queue.onIdle()`。关闭后，尚未开始的任务结束总计时，结果为 `interrupted`，保留任务记录供恢复。已经开始的任务响应关闭信号，在数据库关闭前结束。
- [ ] 6. 测试（临时数据目录 + `openDatabase` + `createScriptedLlm` + 真实的事件总线）：
  - `library/service.test.ts`：`create` 重发不重复建；`list` 按更新时间倒序，并区分草稿、仅有开场及已有回合的作品；`workLabel` 的三种情况和 40 字截断；`saveBackground` 的相同内容不加修订号、过期修订号 → `stale_revision`、成功后加一；`get` 不存在 → `not_found`。
  - 诊断验收：成功、校验失败、模型失败和提交失败分别记录 §2.5 的预览样本。排队时关闭只记中断的总耗时。`preview.total` 在该次尝试结束时只写一条，所有样本用 `jobId` 关联。
  - `authoring/preview-tool.test.ts`：合格参数通过；每条规则各一条不通过的用例，断言错误说明里提到了对应参数名；`options` 第 2 行不是 JSON 时错误说明里有“第 2 行”。
  - `authoring/service.test.ts`：
    - 生成预览成功：任务先是 `running`，`whenIdle()` 后是 `done`；`llm.runs[0]` 的 `sessionId` 是作品 id，`prompt` 里有背景原文。
    - 同一 `jobId` 重发返回同一任务，任务表里只有一行；同一 `jobId` 换了 `contentRev` → `idempotency_conflict`。
    - 过期的 `contentRev` → `stale_revision`；背景为空 → `invalid_input`；`setResolved(null)` → `llm_not_configured`；已有运行中的任务时再生成 → `job_running`（让脚本化 llm 的第一步等待一个手动控制的 Promise）。
    - 两次不合格、第三次合格 → `done`；三次都不合格 → `failed` / `invalid_output`；脚本给出 `{ fail: "network" }` → `failed` / `network`。
    - 采用：生成预览后改背景，再采用 → `stale_preview`；基于当前背景重新生成并采用 → 返回 `routeId`，并逐项核对第 5 步第 6 点的每一处写入；同一 `jobId` 再采用 → 同一个 `routeId`，各表行数不变；用另一个任务采用 → `already_published`；采用后 `saveBackground` → `already_published`。
    - `recoverInterrupted()` 把 `running` 的任务改成 `failed` / `interrupted`，按原任务 ID 留下失败事件。再次恢复时事件数不增加。
    - 测试里的背景和预览内容全部虚构。

**注意事项。**

- 采用的事务里任何一步失败，整个事务回滚；不要拆成几个事务。
- 本里程碑没有主角填写项，开场正文里不会有 `{{protagonist.…}}` 占位符，不需要替换逻辑。
- 发布版本复制的是 `meta` 的四个字段；草稿专有的 `opening_candidates`、`wizard_step` 本里程碑不存在。
- 预览任务运行期间作者改了背景：任务照常完成（输入已冻结），结果的 `basedOnContentRev` 小于草稿当前修订号，client 据此显示“基于修改前的背景”，采用时 core 拒绝。

**完成判据。**

- `pnpm --filter @unwritten/core typecheck`、`test` 通过。
- 突变：
  - 删掉采用时比较 `input.contentRev` 的那一步，`stale_preview` 用例必须失败。
  - 把采用里“已有 `adoption` 直接返回”那一步删掉，重发采用的用例必须失败。
  - 把 `MAX_CORRECTIONS` 改成 0，“两次不合格、第三次合格”的用例必须失败。
  - 逐个恢复。

### T10 core 回合循环

**目的。** 实现续写：玩家提交行动 → core 登记请求并立即返回 → 后台按预算组装上下文、让模型调用 `propose_turn` → 校验 → 一个事务里追加回合、推进路线 head、标记请求完成。幂等键、预期 head、单路线单请求、失败保留上一个完整决定点、重试沿用原请求，这几条是本任务的验收重点。

**依赖。** T04。不依赖 T08。

**拥有的文件。** `packages/core/src/play/*` 及其测试。

**先读。** [回合循环](../docs/turn-loop.md) §1–§3、§5、§6、§8；[数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)、[§5](../docs/data-model.md#5-可见性规则)；[第一个里程碑](../docs/milestone-1.md)实现顺序第 4 条和“近期剧情直接用原文”一段；本文附录 B.2。

**步骤。**

- [ ] 1. `chain.ts`：

  ```ts
  export type TurnRow = typeof turns.$inferSelect;

  export function ancestorChain(db: Database, headTurnId: string): Array<TurnRow & {
    originRequest: { id: string; attempt: number } | null;
  }>;
  ```

  - 用递归查询读取祖先回合及原请求标识（[数据模型 §5](../docs/data-model.md#5-可见性规则)）：

    ```sql
    WITH RECURSIVE path(id, parent_id) AS (
      SELECT id, parent_id FROM turns WHERE id = ?
      UNION ALL
      SELECT t.id, t.parent_id FROM turns t JOIN path p ON t.id = p.parent_id
    )
    SELECT t.*, r.id AS request_id, r.attempts AS request_attempt
    FROM path p
    JOIN turns t ON t.id = p.id
    LEFT JOIN turn_requests r ON r.result_turn_id = t.id
    ORDER BY t.depth
    ```

    用 Drizzle 的 `sql` 模板执行（`db.all(sql\`…\`)` 或驱动实际提供的写法）。
  - 按表定义解码回合字段，将可空的请求 ID 和尝试号转成 `originRequest`。
  - 断言 `rows[i].depth === i`，不成立就抛错：那说明回合树的数据坏了。
- [ ] 2. `narrator-prompt.ts`：导出附录 B.2 的 `NARRATOR_SYSTEM_PROMPT`。
- [ ] 3. `propose-turn-tool.ts`：

  ```ts
  export const PROPOSE_TURN_TOOL_NAME = "propose_turn";

  export const TURN_LIMITS = {
    proseMax: 6_000,
    paragraphsMax: 20,
    optionsMin: 1,
    optionsMax: 6,
    optionTextMax: 100,
    placeMax: 100,
    timeMax: 100,
    presentMax: 20,
  } as const;

  export const PROPOSE_TURN_PARAMETERS = {
    type: "object",
    properties: {
      prose: { type: "string", description: "正文，段落之间空一行" },
      options: { type: "string", description: '推荐行动，每行一个 JSON：{"text":"…"}' },
      changes: {
        type: "string",
        description: '每行一个 JSON。只接受场景：{"type":"scene","place":"…","time":"…","present":"甲,乙"}。场景没有变化时填空字符串',
      },
      ending: { type: "string", description: '填 "false"' },
    },
    required: ["prose", "options", "changes", "ending"],
    additionalProperties: false,
  } as const;

  export interface ProposedTurn {
    prose: string;
    options: StoredOption[];
    scene: StoredScene;
  }

  export function parseProposeTurnArgs(args: Record<string, unknown>, parentScene: StoredScene): ParseResult<ProposedTurn>;
  ```

  参数名和含义沿用[回合循环 §5](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)，`changes` 本里程碑只接受 `scene`。校验规则：
  - 四个参数都必须是字符串。
  - `prose`：`normalizeProse` 后段落数 1–20，总长不超过 6000。
  - `options`：`parseOptionLines`，1–6 条，不能带 `hint`（作品没有开启“提醒已知后果”）。
  - `changes`：`parseJsonLines` 逐行解析。每行必须是带字符串 `type` 的对象；`type` 不是 `scene` → `第 N 行 changes：本作品只接受 scene 类型`；`scene` 最多一行；`scene` 行的 `place`、`time` 是不超过 100 字的字符串，`present` 是字符串，按 `/[,，、]/` 切开、去空白、去空项，最多 20 人。没有 `scene` 行时沿用 `parentScene`。
  - `ending`：`trim()` 后必须是 `"false"`。是 `"true"` → `这部作品没有结束条件，ending 只能填 "false"`（[回合循环 §6](../docs/turn-loop.md#6-校验与保存)的“结局”检查）。
- [ ] 4. `context.ts`：按预算组装 narrator 的用户消息（[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)，本里程碑没有只读工具和索引）。

  ```ts
  export interface NarratorContextInput {
    meta: VersionMeta;
    chain: TurnRow[];
    action: StoredAction;
    model: ResolvedModel;
    estimateTokens(text: string): number;
    toolSchemaText: string;
  }

  export type NarratorContext =
    | { ok: true; system: string; prompt: string; includedTurns: number; omittedTurns: number }
    | { ok: false; code: "context_too_small" };

  export function buildNarratorContext(input: NarratorContextInput): NarratorContext;
  ```

  各块的格式（块与块之间空一行）：
  - 设定块：`【作品设定】\n<背景>\n\n【公开设定】\n<plan 里 public_setting 那一项的 text>`。
  - 叙事块：`` `【叙事要求】\n作品语言：${language}。正文和选项都用这种语言写。` ``，`language` 取 `meta.narration?.language ?? "zh-CN"`。
  - 场景块：`【当前场景】\n地点：<place>\n时间：<time>\n在场：<present 用“、”连接>`，取 head 回合的 `scene`；空值写“未说明”。
  - 回合块：开场是 `T0（开场）\n<正文>`；其余是 `T<depth>\n玩家行动：<action.text>\n<正文>`。
  - 省略说明：`【更早的回合】\n另有 N 个更早的回合未列出。`
  - 行动块：`【玩家这次的行动】\n<text>`，再接一行：`optionIndex` 非空时 `（玩家选择了推荐行动第 N 项。）`，否则 `（这是玩家自己写的行动，按原意回应。）`。

  预算与顺序：
  1. `budget = model.contextWindow - model.maxOutputTokens - estimateTokens(toolSchemaText) - estimateTokens(NARRATOR_SYSTEM_PROMPT)`。
  2. 必需材料 = 设定块、叙事块、场景块、行动块，以及最新一个回合（head）的回合块。它们的估算之和超过预算 → `{ ok: false, code: "context_too_small" }`。不截断任何必需材料。
  3. 先为省略说明预留一份最坏情况的长度（用 `N = 99999` 估算）。
  4. 从 head 的父回合往开场方向，一个一个尝试加入：加入后不超预算就加入，否则停止。停止后剩下的都算省略。
  5. 拼接顺序：设定块、叙事块、场景块、省略说明（有省略时才有）、`【最近的回合】`、已加入的回合按时间正序、head 的回合块、行动块。
  6. 返回的 `system` 就是 `NARRATOR_SYSTEM_PROMPT`。

  这里只放本作品发布版本的设定和本路线祖先链上的回合，所以别的作品、别的路线的内容天然进不来。
- [ ] 5. `service.ts`：`export function createPlayService(deps: CoreDeps & { llm: LlmService }): PlayService`。常量：`TURN_CONCURRENCY = 2`、`MAX_CORRECTIONS = 2`、`REQUEST_LOG_RETENTION_DAYS = 90`。
  - **`getRoute({ routeId })`**：路线不存在 → `not_found`。取开局、版本、作品；`turns = ancestorChain(head)` 转成 `TurnView`，保留 `originRequest`。`language` 同第 4 步；`pending` 是这条路线上 `expectedHeadTurnId = head` 且状态为 `running` 或 `failed` 的请求里 `createdAt` 最新的一个，没有就是 `null`。
  - **`submitAction({ requestId, routeId, expectedHeadTurnId, action })`**：事务里按顺序：
    1. `requestId` 已存在：路线、预期 head、行动原话、推荐项序号四项都相同 → 返回它当前的视图（重发，[回合循环 §2](../docs/turn-loop.md#2-回合请求)）；否则 `idempotency_conflict`。
    2. 路线不存在 → `not_found`。
    3. 路线的 head 不等于 `expectedHeadTurnId` → `stale_head`。
    4. `action.optionIndex` 非空时：head 回合的 `options[optionIndex - 1]?.text` 必须等于 `action.text`，否则 `option_mismatch`（core 核对原话，[回合循环 §1](../docs/turn-loop.md#1-一回合的流程)）。
    5. 这条路线已有 `running` 或 `needs_clarification` 的请求 → `request_in_progress`。
    6. `llm.resolve("narrator")` 为 `null` → `llm_not_configured`。
    7. 插入请求：`kind = 'continue'`、`expectedHeadTurnId`、`parentTurnId = head`、`action`、`status = 'running'`、`attempts = 1`。插入撞上部分唯一索引（两个标签页同时提交的竞态）时，捕获约束错误，改抛 `request_in_progress`。
    事务外：只有实际登记的新请求才发布 `turn_request.updated`、记录 `turn.request.submitted` 并入队 `runTurnRequest(requestId)`。
  - **`retry({ requestId })`**：事务里：请求不存在 → `not_found`；`running` → 返回当前视图；不是 `failed` → `request_not_retryable`；路线 head 已不等于它的 `expectedHeadTurnId` → 把它改成 `superseded`，返回视图（不入队）；路线上有别的进行中的请求 → `request_in_progress`；`llm.resolve` 为 `null` → `llm_not_configured`；否则 `status = 'running'`、`attempts + 1`、`error = null`。实际进入新的运行尝试后，在事务外发布事件、记录 `turn.request.submitted` 与递增后的尝试号，并入队。过期的请求记录取代事件，返回当前视图。重试沿用原来的预期 head 和行动（[回合循环 §2](../docs/turn-loop.md#2-回合请求)）。
  - **`runTurnRequest(requestId)`**（不导出）：
    1. 读请求，不是 `running` 就返回。
    2. 取路线、开局、版本 `meta`、`chain = ancestorChain(请求的 parentTurnId)`。
    3. `model = llm.resolve("narrator")`；为 `null` → 失败 `llm_not_configured`。
    4. `buildNarratorContext({ meta, chain, action, model, estimateTokens: llm.estimateTokens, toolSchemaText: JSON.stringify(PROPOSE_TURN_PARAMETERS) + 工具描述 })`；`ok` 为假 → 失败 `context_too_small`。
    5. 建 `propose_turn` 工具，结构同 T09 第 5 步的预览工具：通过 → 记下 `ProposedTurn`，`terminate: true`；不通过 → 超过 `MAX_CORRECTIONS` 返回 `terminate: true`，否则抛错交还模型。每次调用往足迹里追加一条 `{ tool: "propose_turn", ok, errors }`。工具描述：`提交这一回合的正文、推荐行动和场景。写完正文后调用一次。`
    6. `await llm.run({ purpose: "narrator", system, prompt, tools: [tool], requiredToolName: PROPOSE_TURN_TOOL_NAME, sessionId: routeId, ref: { kind: "turn_request", id: requestId, attempt: request.attempts, workId } })`。会话标识用路线 id（[LLM 端点 §5](../docs/llm-endpoints.md#5-opencode-go)）。`LlmRunError` → 失败，原因是它的 `code`；其他错误 → 失败 `internal`。
    7. 没有记下 `ProposedTurn` → 失败 `invalid_output`。
    8. 提交（见下）。提交抛错 → 失败 `save`。
  - **计时。** 首次登记和有效重试分别记录起点，复用 `requestId` 并带本次 `attempt`。后台开始时结束排队计时，构建上下文、每次工具校验、最终提交各记录一个区间。在完成、失败或中断时结束总计时，取代计为中断。用现有的上下文成本估算记录上下文 token 数。幂等重发沿用已有请求，不再计时。
  - **提交事务**（[回合循环 §6](../docs/turn-loop.md#6-校验与保存)）：
    1. 重新读路线。head 不等于请求的 `expectedHeadTurnId` → `UPDATE turn_requests SET status = 'superseded' WHERE id = ? AND status = 'running'`，结束（不插入回合），事务外发布事件、记 `turn.request.superseded`。
    2. 插入回合：`parentId = parentTurnId`、`depth = 父回合 depth + 1`、`action`、`prose`、`options`、`scene`、`ending = 0`、`status = 'committed'`。
    3. `UPDATE routes SET head_turn_id = 新回合, updated_at = now, draft_input = NULL WHERE id = ? AND head_turn_id = 预期 head`，影响行数必须是 1，否则抛错（事务回滚）。
    4. `UPDATE turn_requests SET status = 'done', result_turn_id = 新回合, log = 足迹, updated_at = now WHERE id = ? AND status = 'running'`，影响行数必须是 1，否则抛错。
    5. 事务外：发布 `turn.committed` 和 `turn_request.updated`，记 `turn.request.done`。
  - **失败**：`UPDATE turn_requests SET status = 'failed', error = ?, log = 足迹, updated_at = now WHERE id = ? AND status = 'running'`；发布 `turn_request.updated`；记 `turn.request.failed`。路线一律不动，所以上一个完整决定点保持原样。
  - **`recoverInterrupted()`**：把 `running` 的请求标成 `failed` / `interrupted`，取回这次更新的请求 ID 与尝试号。旧足迹按[回合循环 §2](../docs/turn-loop.md#2-回合请求)清理。事务结束后为每个中断请求记 `turn.request.failed`，并返回恢复行数。
  - **`whenIdle()`**：`queue.onIdle()`。关闭后，尚未开始的尝试结束总计时，结果为 `interrupted`，保留请求记录供恢复。已经开始的尝试响应关闭信号，在数据库关闭前结束。
  - **`pruneOldRequestLogs()`**：把 90 天以前的 `turn_requests.log` 置空，返回改动行数。T07 在启动时调用。
- [ ] 6. 测试（临时数据目录、真实的库和事件总线、`createScriptedLlm`）。在测试文件里写一个 `seedPlayableWork(db, { background, publicSetting, openingProse, options })`，直接插入一部已发布作品、开局、根回合和路线（不依赖 T09 的代码），返回各个 id。内容全部虚构。
  - `propose-turn-tool.test.ts`：合格参数通过；`changes` 为空时场景沿用父回合；每条规则一条不通过的用例；`ending: "true"` 被拒；`present` 的中英文逗号和顿号都能切开。
  - 诊断验收：续写总耗时和发生过的各阶段都保留 `requestId` 与尝试号。失败后重试生成独立样本，提交回滚要留下失败的提交样本。排队时关闭只记中断的总耗时。进程意外退出没有终点时只记恢复事件。
  - `context.test.ts`：预算充足时全部回合都在、没有省略说明；预算只够必需材料时其余回合全部省略，省略说明里的数字正确；预算连必需材料都不够 → `context_too_small`；回合按时间正序排列；行动块对推荐项和自由输入写的说明不同。
  - `service.test.ts`：
    - `getRoute` 只有开场时 `turns` 一项，`originRequest` 和 `pending` 都为 `null`。
    - 点推荐项 1（原话一致）→ `running` → `whenIdle()` 后 `done`；路线有 2 个回合，新回合 `depth = 1`、行动里带 `optionIndex: 1`；事件依次是 `turn_request.updated(running)`、`turn.committed`、`turn_request.updated(done)`。
    - 自由输入（`optionIndex: null`）同样成功。
    - 推荐项序号和原话对不上 → `option_mismatch`；预期 head 过期 → `stale_head`，路线不变。
    - 同一 `requestId` 连续提交两次 → 返回同一个请求；`whenIdle()` 后只新增 1 个回合，`llm.runs` 只有 1 次。
    - 同一 `requestId` 换了原话 → `idempotency_conflict`。
    - 第一个请求还在运行（脚本化 llm 等待一个手动控制的 Promise）时提交第二个 → `request_in_progress`。
    - `setResolved(null)` → `llm_not_configured`，请求表里没有新行。
    - 三次不合格 → `failed` / `invalid_output`，路线不变，`getRoute().pending` 是这个失败的请求；再排一组合格参数并 `retry` → `done`，`attempts = 2`，只新增 1 个回合。单独查询 `getRoute` 能从新回合的 `originRequest` 读到原请求 ID 和尝试号 2。
    - 脚本给出 `{ fail: "network" }` → `failed` / `network`；`retry` 后成功。
    - 对 `done` 的请求重试 → `request_not_retryable`；对 `running` 的请求重试 → 返回 `running` 的视图。
    - 运行期间把路线 head 直接改到另一个回合（模拟另一个标签页推进了路线）→ 请求变成 `superseded`，没有插入新回合。
    - 用 SQLite 触发器 `CREATE TRIGGER fail_insert BEFORE INSERT ON turns BEGIN SELECT RAISE(ABORT, 'boom'); END;` 让提交失败 → 请求 `failed` / `save`，路线不变。
    - `recoverInterrupted()` 把 `running` 改成 `failed` / `interrupted`，留下原请求和尝试号。再执行恢复不增加事件，之后 `retry` 能成功。`pruneOldRequestLogs()` 清空 90 天以前的 `log`，保留原请求行。
    - 上下文承接：第一回合自由输入一句虚构的行动，第二回合时 `llm.runs[1].prompt` 里能找到第一回合的行动原话和正文。
    - 作品隔离：建两部作品各走一回合，第二部作品的 `prompt` 里找不到第一部作品的背景和正文。
    - 预算不足：`setResolved({ …, contextWindow: 200, maxOutputTokens: 100 })` → `failed` / `context_too_small`。

**注意事项。**

- 提交事务和提交前的检查必须在同一个事务里，`WHERE … AND status = 'running'`、`WHERE … AND head_turn_id = 预期 head` 两个条件都不能省：它们挡住的是“两个标签页同时操作”“恢复后又跑完了旧请求”这类竞态。
- 生成到一半的正文永远不写进 `turns`。模型交上来、校验没通过的正文也不进任何表，只有校验错误说明进 `turn_requests.log`。
- `turn_requests.log` 随回合请求保存在作品库（[回合循环 §2](../docs/turn-loop.md#2-回合请求)）。
- 不实现 `ask_clarification`、重写、开场请求（§1.3）。

**完成判据。**

- `pnpm --filter @unwritten/core typecheck`、`test` 通过。
- 突变：
  - 删掉 `submitAction` 里“`requestId` 已存在就返回”那一步，重复提交的用例必须失败。
  - 把提交事务第 3 步的 `AND head_turn_id = 预期 head` 去掉、同时去掉第 1 步的 head 检查，`superseded` 用例必须失败。
  - 把失败分支改成同时推进路线 head，`invalid_output` 用例里“路线不变”的断言必须失败。
  - 把 `context.ts` 的必需材料检查去掉，`context_too_small` 用例必须失败。
  - 逐个恢复。

### T11 client 外壳、共享请求与组件

**目的。** 给页面一套导航、鉴权、查询、重连、焦点和状态播报的入口。

**依赖。** T03、T06。与 core 的对接以 T02 契约为准。

**拥有的文件。** §4.4 里归属 T11 的文件。页面任务接手各自的页面目录和文案。

**先读。** [架构总览 §2.1、§3、§7](../docs/architecture.md#21-本机接口的安全)、[可访问性](../docs/a11y.md)、[i18n](../docs/i18n.md)、附录 A.1。

**步骤。**

- [ ] 1. 页面入口读取 URL hash 中的令牌，只保存在内存。生产环境用 `replaceState` 清除令牌，保留路径和查询串；开发环境按架构规则保留 hash。无令牌时只挂载说明页，完全跳过 API、事件订阅和错误上报。鉴权守卫的 HTTP 401 让根界面切换到说明页并取消还在运行的查询；模型鉴权错误由页面按业务错误显示。
- [ ] 2. `shared/api` 暴露一套契约客户端、QueryClient、查询键与错误转换。由 RPCLink 为普通请求和事件订阅设置同一个请求头。错误只取已知契约码与通过校验的详情；本地网络失败使用对应文案。应用级错误按 T02 的区域和错误码上报。
- [ ] 3. 根布局启动一条可取消的 `events.subscribe`。`llm.config_changed` 失效配置查询，`works.changed` 失效库和对应作品，`job.updated` 失效对应作品，`turn_request.updated` 失效对应路线，`turn.committed` 同时失效对应路线与作品库，以便刷新作品的进度入口。接通或重连后刷新当前查询，填补通知空窗；连接中断以有上限的退避重连。路由切换复用连接；卸载、鉴权失效时取消迭代和重试定时器。
- [ ] 4. 注册 `/`、`/settings`、`/works/$workId/edit`、`/play/$routeId`，loader 加载相应文案。用组件接入各页面。每页一个 `h1`，路由切换后同步标题和焦点。接上 T03 的系统外观监听。
- [ ] 5. 写共享 Button、TextField、TextArea、Page、Toolbar、BackLink、PageHeading、Notice、Badge、LiveRegion、VisuallyHidden、GeneratingMarker。表单标签与提示绑定，图标按钮有可读名称，焦点环、尺寸、材料和过渡引用 token。Enter 提交 hook 同时检查组合事件状态和 `nativeEvent.isComposing`，Shift+Enter 保留换行。
- [ ] 6. `shared/lib/log.ts` 提供 client 诊断入口，按[性能样本定义](../docs/diagnostics.md#3-性能样本)用 `performance.now()` 开始和结束计时。页面完成对应的 DOM 提交后上报，同一操作终点只报一次。上报失败即结束，鉴权失效后停止上报。
- [ ] 7. 浏览器测试覆盖无令牌零请求、刷新、鉴权、事件重连补查、焦点、组字、共享部件的 axe 检查，以及性能样本去重和上报失败。

**注意事项。** 查询失效用于重新读状态。变更请求遇到结果不明时由发起方按原幂等键或最新服务端状态处理。

**完成判据。** client 类型检查和测试通过；模拟重连时只得到一条新订阅，遗漏的变更能从回查中恢复。

### T12 模型设置页

**目的。** 添加、测试和维护一个可用于开场与续写的 OpenAI 兼容模型。

**依赖。** T11。

**拥有的文件。** `apps/client/src/features/settings/`、`src/i18n/zh-CN/settings.json`。

**先读。** [LLM 端点 §2–3、§6–8、§10](../docs/llm-endpoints.md#2-providersjson)、[第一个里程碑](../docs/milestone-1.md) 和附录 A.6。

**步骤。**

- [ ] 1. 用 `llm.providers.list` 显示端点、模型 ID、凭据状态和默认模型。配置缺失时展示新增表单。无效或版本过高时显示服务返回的出错位置与恢复文案，禁止写操作。
- [ ] 2. 新建表单支持名称、兼容地址、模型 ID、可选 API key 和设为默认。测试走 `llm.test`，区分网络、凭据、协议和无工具调用；测试结果只对应当次表单值，修改后清除。保存调用 `llm.endpoints.create`，同一待确认的提交复用 `requestId`，并携带最近读取的 `baseRevision`。地址是 `http` 且主机不是本机回环地址、而这次会带 key 时，表单显示警告但不阻止测试或保存（[LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)）。
- [ ] 3. 修改表单固定端点地址。key 留空发 `keep`，输入新值发 `set`，明确选中移除发 `remove`。测试分别映射到 `keep`、`set`、`none`。单独切换默认模型调用 `llm.purposes.set`。只在提交完成后清空本地 key，重新读配置后仍只显示状态。
- [ ] 4. 收到 `config_conflict` 时重新查询并保留表单输入，请用户核对后重新提交。用可读通知与 LiveRegion 区分测试中、测试结果、保存成功及失败。
- [ ] 5. 测试新增与默认切换、测试工具调用失败、保留或移除 key、冲突时保留输入、坏文件禁止写入，以及键盘填写和焦点。

**注意事项。** key 只存在表单内存与必要的请求体中。为含 key 的表单请求禁用自动重试，完成后清除保留凭据的变更状态。

**完成判据。** 设置页类型检查、组件测试和 axe 检查通过；成功、失败和冲突三条路径均用角色与可读名称断言。

### T13 作品库与创作页

**目的。** 从空作品库创建草稿、生成并采用当前修订的开场，保存后能够正式进入同一部作品。

**依赖。** T11。

**拥有的文件。** `apps/client/src/features/library/`、`src/features/authoring/`、`src/i18n/zh-CN/{library,authoring}.json`。

**先读。** [创作流程](../docs/authoring-flow.md)、[第一个里程碑](../docs/milestone-1.md)、附录 A.3–4。完整产品流程和本里程碑的单步预览分别验收。

**步骤。**

- [ ] 1. 作品库用 `works.list` 显示空、载入、读取失败和作品卡。草稿进入编辑，可玩作品显示简介，按 `hasProgress` 显示「开始故事」或「继续游玩」，用 `routeId` 进入同一条路线。新建时生成稳定的 `workId`，`works.create` 成功后进入编辑页。
- [ ] 2. 编辑页用 `works.get` 恢复背景、修订号和最近任务。使用 `works.saveBackground` 保存编辑原文。保存成功才显示已保存；仍有未保存输入时明确展示状态，离开时允许保存后离开或继续编辑。
- [ ] 3. 触发生成时先分配本次 `jobId` 并开始计时。等保存完成后用返回的 `contentRev` 和该 `jobId` 调 `works.generatePreview`。以该任务的预览或错误首次渲染为终点。生成前保存失败时，记录同一操作的错误耗时。配置不可用时显示设置入口；使用任务状态播报生成中、失败和完成。预览显示标题、简介、公开设定、正文和推荐行动，均以纯文本显示。
- [ ] 4. 本地背景已经编辑或任务修订号与草稿不符时，禁用采用并提示重新生成。收到修订冲突时重新查作品，保留本地编辑，显式重试保存。采用用 `works.adoptPreview`，再次读取作品和库确认已发布；显示开始故事和返回作品库。已发布草稿只读，失败保留原预览并提示处理方式。
- [ ] 5. 作品库和预览页接入 `client.library_ready` 与 `client.preview_visible`。测试空库、草稿恢复、旧预览、采用、模型缺失和预览失败，并核对样本结果和预览任务 ID。

**注意事项。** 事件回查更新服务端状态，不能覆盖尚未保存的本地输入。界面预览中的选项只用于阅读。

**完成判据。** client 类型检查、作品库与创作页测试和 axe 检查通过；旧修订预览在同一个标签页和另一个标签页更新背景后均不能采用。

### T14 阅读页、行动与恢复

**目的。** 让玩家阅读已提交的情节、发送一次行动，并在等待、失败和重启后找到同一个决定点。

**依赖。** T11。

**拥有的文件。** `apps/client/src/features/play/`、`src/i18n/zh-CN/play.json`。

**先读。** [游玩流程 §1–2、§5](../docs/gameplay-flow.md#1-进入作品找到正确的起点)、[回合循环 §2、§8](../docs/turn-loop.md#2-回合请求)、[动效](../docs/motion.md)、附录 A.5。

**步骤。**

- [ ] 1. 按 `play.getRoute` 的顺序渲染开场、行动原话和已提交正文。用含标题的节给每回合命名，纯文本保留段落。初次续玩定位到最新决定点；玩家在回看历史时保留位置，提交后显示回到最新入口。
- [ ] 2. 只在最新决定点展示推荐行动与自由输入。点击选项提交原文和一基序号，自由输入提交 `optionIndex: null`。每次发送带当前 `expectedHeadTurnId` 和稳定的 `requestId`。结果不明时用同一请求重发，直到取得当前视图；明确失败后按对应状态处理。
- [ ] 3. 运行中的行动原话和生成提示显示在上一段完整正文之后，锁住重复发送。生成失败保留原话，`play.retry` 传原请求 ID。重连或重开从查询恢复；回合提交后只追加一份正式回应，过期 head 重新查路线并保留尚可编辑的输入。
- [ ] 4. 使用 LiveRegion 播报等待、完成和失败，新回合按动效规则进入。设置缺失且已有作品时保留阅读能力，通过设置入口恢复生成。
- [ ] 5. 阅读页接入 `client.turn_visible`。测试推荐和自由行动、组字、失败重试、过期决定点、重连去重、返回最新和可访问性。初次发送用尝试号 1，重试以返回的新尝试号为准。等 `originRequest` 或失败状态与当前请求和尝试号匹配，并且对应结果渲染后，才结束计时。明确拒绝或未入队即返回 `superseded` 时，以本次提示为终点。测试重试前还显示上次失败提示、成功通知丢失后重新查询两种情况。单纯续玩时不补造样本。

**注意事项。** 判断最新决定点、待处理行动和提交结果时，以 core 返回的 id 与状态为准，避免 query 回查把同一行动显示两次。

**完成判据。** client 类型检查、阅读页测试和 axe 检查通过；失败及重试成功之后分别只有一份已提交历史。

### T15 core 入口装配与集成测试

**目的。** 将真实 core 各模块接上同一个启动、恢复、关闭入口，用伪服务走完配置到续玩的接口链路。

**依赖。** T07、T08、T09、T10。

**拥有的文件。** `packages/core/src/main.ts`、`src/app.integration.test.ts`。

**先读。** [架构总览 §2.2](../docs/architecture.md#22-core-独立运行)、T04 的 `ServiceFactories`、T07 的 `startCore` 和 T05 的伪服务。

**步骤。**

- [ ] 1. 入口先加载 fetch 守卫，再导入其余模块。解析参数并调用 `startCore`，注入四个真实工厂。监听成功后向 stdout 输出一行 `UNWRITTEN_CORE_URL=<带令牌的地址>`。失败返回非零退出码，诊断详情留在诊断库。库不可写时只向 stderr 给出固定故障提示。
- [ ] 2. SIGINT、SIGTERM 共用一个关闭流程，停止接收请求并等待 `close()`。测试用过的伪端点、临时目录、服务实例均在 finally 清理。
- [ ] 3. 通过真实 oRPC 客户端和 T05 的 HTTP 伪服务测试配置、工具调用、草稿、预览、采用、连续行动。停掉首实例，用相同数据目录启动第二实例，验证新令牌、原路线与后续请求上下文。并发标签页、过期 head 与重复请求的边界用真实服务装配覆盖一次。

**注意事项。** `startCore` 负责恢复和监听顺序。生产入口只负责装配与进程生命周期。

**完成判据。** core 类型检查、单元和集成测试全部通过；带持久化数据重启后能恢复最新已提交的决定点。

### T16 生产构建端到端测试

**目的。** 从浏览器操作验证里程碑验收的用户路径及关键恢复行为。

**依赖。** T12–T15。

**拥有的文件。** `e2e/fixtures/`、`e2e/tests/`。

**先读。** [第一个里程碑](../docs/milestone-1.md)的验收表、[技术选型 §8](../docs/tech-stack.md#8-测试)、[可访问性 §11](../docs/a11y.md#11-测试)。

**步骤。**

- [ ] 1. 每个测试创建临时数据目录、脚本化伪服务和独立 core 进程。用启动 stdout 读取地址，保留在测试夹具内。等待明确的就绪行，进程提前退出时显示脱敏诊断；测试完成终止进程与伪服务并删除目录。等待界面或请求状态，避免固定延时。
- [ ] 2. 从空库设置模型，测试工具调用并设为默认，写背景，生成预览，改背景再生成并采用。点推荐行动、自由输入并完成第三回合。重启 core，打开新地址继续游玩；断言历史、行动原话、当前决定点以及伪服务收到的后续上下文都正确。
- [ ] 3. 模拟错误 key、没有调用工具、无效配置文件、无效预览或回合、进程生成中断。确认已有库和阅读仍可访问；失败后原行动保留，重试只提交一次。单独测试切换作品不会串上下文。
- [ ] 4. 验证生产 HTML 与接口边界、无令牌时的说明和零 API 请求。用键盘走主路径，检查可见焦点；用浏览器组合事件模拟组字回车。每个页面在浅色和深色主题下各跑一次 `@axe-core/playwright` 检查，真实输入法与播报留给 T17。
- [ ] 5. 用读取诊断库的数据验收持久化，界面路径仍按角色、名称和可见状态验收。正常退出后重开诊断库，按任务、请求和调用 ID 核对 core、client 样本，区分失败、重试和成功。正常退出后检查数据目录只含契约列出的数据库及其 SQLite 伴随文件、模型配置及允许的备份。stdout 只含启动地址，运行事件和性能样本仅从诊断库读到。

**完成判据。** `pnpm build`、`pnpm e2e` 通过；主路径和失败恢复用例各连续运行两遍，临时进程和数据目录均已清理。

### T17 真实模型走查与收口

**目的。** 核对真实模型的效果、中文输入与可访问性，并保留可复跑的验收记录。

**依赖。** T16；维护者提供有权调用的真实端点和凭据。通过设置页输入凭据，手动数据放在 `.data/`。

**拥有的文件。** 本文的手动验收记录。

**先读。** [第一个里程碑](../docs/milestone-1.md)的目标和验收表。

**步骤。**

- [ ] 1. 从空的手动数据目录启动生产构建。在界面测试并保存真实模型。写一句虚构的背景，先看预览，再修改背景并生成，采用新开场。
- [ ] 2. 点一次推荐行动、提交一次自由行动、完成第三回合后重启 core。用新地址续玩，要求剧情承接第一次自由行动留下的实际后果。记录开场是否留下可行动的决定、自由行动是否被接住、重启后是否接得上。
- [ ] 3. 用实际中文输入法确认组字回车不会发送。仅用键盘通过主要页面，检查路由焦点和读屏状态播报。
- [ ] 4. 跑 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm e2e`、`node scripts/check-doc-links.mjs` 和 `node scripts/check-tokens.mjs`。按 §0.5 自检。记录验收结论，按相同场景和区间核对诊断库的样本数、中位数和第 95 百分位。运行诊断和性能读数保留在本机诊断库。

**完成判据。** 自动化验收均通过，维护者能在真实模型上重走完整闭环；真实模型的体验核对也有单独结论。

## 附录 A · 中文文案

以下键均按 §2.4 写入对应命名空间。字段的标签、帮助文字和占位文字各自使用独立键。端点和作品数据按原值显示。

### A.1 common

| 键 | 文案 |
| --- | --- |
| `app.name` | Unwritten |
| `nav.library` | 作品库 |
| `nav.settings` | 设置 |
| `action.cancel` | 取消 |
| `action.retry` | 重试 |
| `status.loading` | 正在加载 |
| `status.saved` | 已保存 |
| `error.details` | 详细信息 |
| `noToken.heading` | 请从启动时给出的地址打开 |
| `noToken.description` | 请从 core 启动时给出的地址重新打开。使用桌面版时，请重启应用。 |

### A.2 errors

| 键 | 文案 |
| --- | --- |
| `invalid_input` | 有内容未填写或格式有误。请检查后重试。 |
| `internal` | 暂时无法完成操作。请重试。 |
| `not_found` | 找不到这项内容。请返回作品库。 |
| `stale_revision` | 草稿已更新。请核对后再保存。 |
| `stale_preview` | 背景已修改。请重新生成预览。 |
| `already_published` | 这部作品已存入作品库。 |
| `job_running` | 正在生成预览。请稍后再试。 |
| `preview_not_ready` | 预览还未生成完成。 |
| `stale_head` | 路线已有更新。请查看最新段落后再行动。 |
| `request_in_progress` | 正在写下一段，请等这一段完成。 |
| `idempotency_conflict` | 这次请求的内容已改变。请刷新进度后重试。 |
| `option_mismatch` | 推荐行动已更新。请重新选择。 |
| `request_not_retryable` | 这次行动的状态已变化。请查看最新段落。 |
| `llm_not_configured` | 还没有可用的默认模型。请到设置里配置。 |
| `llm_config_invalid` | 模型配置无法读取。请检查配置文件。 |
| `llm_config_too_new` | 这份模型配置需要更新的应用版本。 |
| `config_conflict` | 模型配置已更新。请核对后再保存。 |
| `endpoint_not_found` | 找不到此端点或模型。请重新选择。 |
| `invalid_url` | 端点地址无效。请输入完整的 HTTP 或 HTTPS 地址。 |
| `unauthorized` | 模型服务拒绝了凭据。请检查 API key。 |
| `quota` | 模型服务的额度不足。请检查账户额度或换一个模型。 |
| `rate_limited` | 模型服务暂时限制了请求。请稍后重试。 |
| `context_overflow` | 模型放不下这次请求所需的内容。请换一个上下文窗口更大的模型。 |
| `context_too_small` | 当前模型放不下继续这段故事所需的设定和剧情。请换一个模型。 |
| `network` | 连不上模型服务。请检查网络或到设置里换一个端点。 |
| `unreachable` | 无法连接这个地址。请检查地址和网络。 |
| `timeout` | 模型回复超时。请重试。 |
| `server` | 模型服务暂时出错。请稍后重试。 |
| `redirected` | 此地址要求跳转。请用最终地址添加新端点。 |
| `not_compatible` | 此地址或模型不支持所需接口。请核对资料。 |
| `no_tool_call` | 模型接通了，但没有完成工具调用。请换一个支持工具调用的模型。 |
| `invalid_output` | 模型没有交出可用的结果。请重试。 |
| `interrupted` | 上次生成中断了。请重试。 |
| `save` | 本次结果未保存。请重试。 |
| `unknown` | 暂时无法完成操作（{{code}}）。请重试。 |

### A.3 library

| 键 | 文案 |
| --- | --- |
| `page.heading` | 作品库 |
| `empty.heading` | 还没有作品 |
| `empty.description` | 写一句背景，AI 会帮你写出开场。 |
| `action.create` | 新建故事 |
| `card.draft` / `card.playable` | 草稿 / 可玩 |
| `card.edit` / `card.play` | 继续创作 / 开始故事 |
| `card.resume` | 继续游玩 |
| `card.updated` | 更新于 {{time}} |

### A.4 authoring

| 键 | 文案 |
| --- | --- |
| `page.heading` | 写背景 |
| `background.label` | 故事背景 |
| `background.help` | 玩家是谁？身在何处？眼前发生了什么？ |
| `background.save` | 保存背景 |
| `background.unsaved` | 有尚未保存的背景 |
| `preview.generate` | 生成开场预览 |
| `preview.running` | 正在写开场 |
| `preview.heading` | 预览开场 |
| `preview.setting` | 公开设定 |
| `preview.adopt` | 采用开场并存入作品库 |
| `published.heading` | 已存入作品库 |
| `published.play` | 开始故事 |
| `published.back` | 返回作品库 |

### A.5 play

| 键 | 文案 |
| --- | --- |
| `turn.opening` | 开场 |
| `turn.heading` | 第 {{count}} 回合 |
| `input.label` | 你的行动 |
| `input.placeholder` | 写下你想做的事，或想说的话 |
| `input.help` | Enter 发送，Shift+Enter 换行 |
| `input.submit` | 发送行动 |
| `pending.running` | 正在写下一段 |
| `pending.complete` | 新的一段已写好 |
| `pending.failed` | 本段未完成 |
| `pending.retry` | 重试这次行动 |
| `history.latest` | 回到最新 |

### A.6 settings

| 键 | 文案 |
| --- | --- |
| `page.heading` | 模型设置 |
| `current.heading` | 默认模型 |
| `current.empty` | 尚未配置默认模型 |
| `endpoint.add` / `endpoint.edit` | 添加端点 / 修改端点 |
| `endpoint.name` / `endpoint.address` / `endpoint.modelId` | 端点名称 / 接口地址 / 模型 ID |
| `endpoint.key` / `endpoint.keyHelp` | API key / 留空保留已保存的 key。 |
| `endpoint.keyRemove` | 移除已保存的 key |
| `endpoint.keySet` / `endpoint.keyMissing` / `endpoint.keyEnvMissing` | 已配置 / 未配置 / 找不到配置的环境变量 |
| `endpoint.test` / `endpoint.testing` / `endpoint.testOk` | 测试连接 / 正在测试 / 连接成功，工具调用可用 |
| `endpoint.default` / `endpoint.save` | 设为默认模型 / 保存端点 |

## 附录 B · 模型提示

### B.1 PREVIEW_SYSTEM_PROMPT

> 你要根据作者的背景写出一部文字冒险的开场。沿用背景明确写出的事实，按背景所用的语言补充玩家能知道的设定。让玩家清楚自己是谁、现在身处何地，以及眼前为什么值得行动。用可读的段落写开场，停在一个由玩家决定的时刻。为同一处境给出不同且现在可执行的行动。标题、简介和公开设定只使用开场时玩家可以知道的信息。调用 `propose_preview` 提交全文，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。

### B.2 NARRATOR_SYSTEM_PROMPT

> 你是这个文字冒险的叙事者。沿用作品设定、当前场景和这条路线的既有经历。用要求的作品语言回应玩家本次行动的原意，演出当下可以发生的后果，留下由玩家决定的下一步。用完整段落写正文，并给出少量不同、具体而可执行的推荐行动。可以让行动失败或产生代价，交代玩家能观察到的原因。按工具的字符串格式调用 `propose_turn` 交出正文、选项和场景变化。收到校验反馈时修正后再提交。
