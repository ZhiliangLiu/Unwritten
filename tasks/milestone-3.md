# 第三个里程碑 · 实现任务拆解

设计依据是 [docs/milestone-3.md](../docs/milestone-3.md)。本文件把它拆成可以交给子代理逐个执行的任务：每一步写在哪个文件、那个文件做什么、具体怎么写、要注意什么、做完怎样验证。

本文件是进度追踪文件，可以勾选。设计本身以 `docs/` 为准；本文件和 `docs/` 冲突时，先停下来汇报，由维护者裁定后改 `docs/`，再改这里。

执行者可能是能力较弱的模型。所以本文把接口、文件名、函数签名、消息格式、文本格式、文案、测试用例都写死了。**照着写，不要自己发明。** 本文没写到的地方，按 §0.3 停下来汇报。

---

## 0. 给执行者（必读）

### 0.1 怎么用这份文件

1. 先读完 §0、§2、§3，再读分配给你的那一个任务（§5 里的 `Txx`）。“先读”里列出的设计文档章节和现有代码不能跳过。
2. 只改你的任务“拥有的文件”。需要改别的任务拥有的文件时，停下来汇报（§0.3）。
3. 按“步骤”的顺序做，每做完一步把 `- [ ]` 改成 `- [x]`。
4. 全部步骤做完后，逐条跑“完成判据”。每条判据都配了一个“突变”：把哪一行改坏，这条判据必须变红。突变要真的做一遍，看到变红后再改回来（§0.6）。
5. 本文里的路径、类型、接口供任务交接。业务和视觉契约以 `docs/` 为准，库的 API 以安装后的类型声明为准（Electron 看 `apps/desktop/node_modules/electron/electron.d.ts`）。两者对不上、而且差异会改变交接契约时，按 §0.3 汇报。
6. **本文里的事实断言是线索，不是结论。** “某函数在某文件”“某处已经有某能力”都是规划时读到的，执行时可能已经变了。动手前先用 `grep` 按符号名核一遍；前提不成立就停下来说，不要照着错误前提动手。

### 0.2 硬性规则（违反即返工）

| 规则 | 说明 |
| --- | --- |
| 不写注释 | 任何代码文件都不写注释，包括 CSS、SQL、shell、`tsconfig.json`、`electron-builder.yml`。lint 抑制指令（`// oxlint-disable…`、`// @ts-expect-error`、`/* stylelint-disable */`）也算注释，同样禁止。工具生成的迁移文件例外，但不要手改生成出来的部分。见根目录 [AGENTS.md §8](../AGENTS.md#8-不写注释) |
| 只用 pnpm | 不用 npm、yarn、npx。临时执行用 `pnpm exec` |
| 依赖只加本文列出的 | 本里程碑只新增三个依赖：`electron`、`electron-builder`、`shell-env`，版本和写法见 §2.10，由 T04 一次加齐。其他新依赖停下来汇报 |
| 不 commit、不 push | 改动留在工作树里，由编排者汇总后请维护者授权提交 |
| 相对导入写扩展名 | TypeScript 里的相对导入一律写 `.ts` / `.tsx` 后缀 |
| 只用可擦除语法 | 不写 `enum`、`namespace`、构造函数参数属性、装饰器 |
| 界面文案走 i18n | client 组件里不出现用户能看到的字面字符串，`aria-label`、`placeholder`、`title`、`alt` 也算。desktop 的对话框和菜单文字同样走它自己的文案文件（§2.4） |
| 纯文本渲染 | AI 输出、作品内容、玩家输入、模型返回的错误信息一律当纯文本渲染。不用 `dangerouslySetInnerHTML`、`innerHTML` |
| 样式只用 token | 视觉属性只能用 `--uw-*` token。见 [apps/client/AGENTS.md §2](../apps/client/AGENTS.md#2-样式只用-token) |
| 测试内容虚构 | 测试和示例里的故事、人物名、对白全部用附录 D 的虚构素材，或自己另编。不从任何真实作品里摘 |
| 测试数据 | 自动化测试用 `fs.mkdtempSync(path.join(os.tmpdir(), "unwritten-"))` 建临时目录，测试结束删除 |
| key 不进仓库 | 测试夹具不能叫 `providers.json`，也不能以它开头 |
| 提案工具参数只用字符串 | `propose_plan`、`propose_preview`、`propose_cast`、`propose_opening`、`propose_turn` 和全部只读工具的每个参数都是字符串 |
| 事务里不 await | SQLite 驱动是同步的。`db.transaction(...)` 的回调里不调用任何异步函数 |
| 先提交后发布 | `deps.bus.publish(...)` 一律放在事务提交成功之后，不放在事务回调里 |
| desktop 不导入 core | `apps/desktop` 只能导入 `@unwritten/contracts/desktop`，不能导入 `@unwritten/contracts` 主入口和 `@unwritten/core`。由 T02 的 lint 规则强制 |
| client 没有桌面分支 | client 里不出现 `electron`、`isDesktop`、`process.versions.electron` 这类判断 |

### 0.3 遇到这些情况，停下来汇报

- 本文没写、设计文档也没写的设计决定。不要自己发明，写清楚“缺什么、有哪几种做法、各自代价”。
- 库的 API 和本文描述的差别大到改变了做法（不只是改个名字）。
- 需要改别的任务拥有的文件，或需要本文没列出的依赖。
- 完成判据里的某条跑不通，而且你判断问题不在自己的代码里。
- 发现设计文档前后矛盾，或本文和设计文档矛盾。
- 本文的事实断言（某个符号、某个文件、某个现有行为）和代码对不上。

汇报格式：**卡在哪一步 / 看到了什么（原始输出）/ 你认为的原因 / 可选做法**。

### 0.4 并行与工作树

- 编排者按 §3 的波次派发任务。同一波次的任务互不依赖，可以同时执行。
- 每个任务一个 git 工作树（Agent 工具的 `isolation: "worktree"`，或按根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律) 手动建）。工作树里没有 `node_modules`，开工先跑 `pnpm install --frozen-lockfile`（T04 改依赖清单，它自己跑 `pnpm install`）。
- 每个任务只碰自己拥有的文件。编排者收齐一个波次后，按任务编号顺序合进 `milestone-3` 集成分支，跑一遍 §0.5 第 3 条的全量检查；全绿才开下一个波次。
- 除 T04 以外，`pnpm-workspace.yaml`、各 `package.json`、`pnpm-lock.yaml` 本里程碑不改。T02 只改 `packages/contracts/package.json` 的 `exports` 一处。

### 0.5 完成一个任务的标准动作

1. 跑本任务的“完成判据”，并按 §0.6 做突变。
2. 用 `code-review-skill` 对本任务的全部 diff 自检（根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律)）。确认成立的问题修掉，再对完整 diff 重新自检；只是“可能”的问题写进汇报。
3. 在仓库根目录跑：`pnpm typecheck > "${TMPDIR:-/tmp}/uw-typecheck.txt" 2>&1; echo $?`、`pnpm lint > "${TMPDIR:-/tmp}/uw-lint.txt" 2>&1; echo $?`、`pnpm test > "${TMPDIR:-/tmp}/uw-test.txt" 2>&1; echo $?`。读数重定向进文件再看，不要接 `| tail`：管道会吞掉退出码，也会把失败条数截掉。三个退出码都必须是 0。
4. 汇报：改了哪些文件、每条完成判据的输出、每个突变是否变红、自检结论、还没解决的问题。
5. 出示“不该动的东西”的零差异：`git diff --stat -- pnpm-lock.yaml package.json '*/package.json' .oxlintrc.json stylelint.config.mjs lefthook.yml scripts/` 输出为空。T02、T04 例外：只允许出现本任务写明要改的那几个文件。它证明这次的绿不是靠削弱门禁换来的。

### 0.6 怎样做突变

- 突变是“故意把实现改坏一处，确认判据会红”。它是判据唯一的自检：不会红的判据，不知道它在守什么。
- 做法：先跑一次判据，确认是绿的；把指定的那一行改坏；再跑，确认变红；**用编辑器把那一行改回去**，再跑一次确认绿。
- **不要用 `git checkout`、`git restore`、`git stash` 还原突变**：工作区里一直压着你还没提交的成果，一次误还原会全部抹掉。
- 突变改动和测试运行不要同时进行；测试跑完再改下一处。
- 突变没变红时，先回答两个问题：这一行在这个跑法下会被执行吗？还有没有第二道守卫把它接住了？答完写进汇报，不要为了变红去改判据。

---

## 1. 范围评估

### 1.1 结论

两条线，彼此只在 contracts 的不同文件上相交，可以从 W1 起并行：

- **A 线：desktop 外壳。** 设计在[架构总览 §2](../docs/architecture.md#2-进程模型)和[技术选型 §4](../docs/tech-stack.md#4-desktop)里已经写好，代码一行都还没有。规模中等，风险集中在 Electron 的运行时能不能跑现有的 core，这一点规划时已经实测通过（§1.5）。
- **B 线：作者设定向导，以及它在游玩中的兑现。** 这是本里程碑最重的一块，大约是 A 线的三倍。它同时动创作侧（补充设定、故事方案、确认方案、按方案生成开场）和游玩侧（开局、每局生成人物、状态栏、秘密、关键场面、结局、行动提醒）。数据模型、可见性、回合循环已经按这些能力设计过，本次主要是兑现；设计文档没写细的地方，§1.4 先按推荐项定下来。

### 1.2 里程碑没写、但验收离不开的部分（本拆解已纳入）

| 补充项 | 为什么离不开 | 落在哪个任务 |
| --- | --- | --- |
| 启动参数走消息通道 | 令牌放在命令行参数里，本机任何进程用 `ps` 都能看到 | T02、T03、T04 |
| `stop` 和 `start-failed` 两类消息 | desktop 退出时要等 core 提交完诊断再结束；启动失败时要拿到诊断编号显示给用户 | T02、T03、T04 |
| desktop 的诊断经消息通道交给 core 写 | desktop 不能导入 core，又要遵守“诊断只进 `diagnostics.db`”（[运行诊断 §1](../docs/diagnostics.md#1-存储与生命周期)） | T02、T03、T04 |
| `UNWRITTEN_USER_DATA_DIR` 环境变量 | 开发模式要用仓库的 `.data/`（[架构总览 §7](../docs/architecture.md#7-目录结构)），端到端测试要用临时目录 | T04、T06、T08 |
| `author_chat` 用途出现在设置页 | 生成故事方案用这个用途（[创作工作站 §9](../docs/author-workstation.md#9-生成任务)）；M2 因为没有调用方把它从 `PURPOSES` 里拿掉了 | T10 |
| 采用开场只发布，不建开局 | 主角填写项要在开局时由玩家填写，所以开局必须由玩家发起（[游玩流程 §1](../docs/gameplay-flow.md#1-进入作品找到正确的起点)） | T17、T18 |
| 开局页与「重新开局」 | 同上；每局生成人物的作品也要能开第二局才有意义 | T18、T24 |
| 状态栏的来历 | [游玩流程 §4](../docs/gameplay-flow.md#4-看当前状态查过去发生的事)要求点开栏目看到来历并跳回原文 | T16、T25 |
| 旧数据的方案项 | M1、M2 的版本里方案只有一项 `{id: "public_setting", text, source}`，没有 `kind`。读取时要能认出它 | T11 |

### 1.3 明确推迟（不做）

| 推迟项 | 理由 |
| --- | --- |
| 签名、公证、自动更新、发布流程、Windows 和 Linux 的包 | 维护者决定本次只要本机能用的包。`electron-updater` 本次不装 |
| 创作工作站（对话、提案卡、`report_conflict` 工具） | 里程碑已推迟。方案生成时用 `propose_plan` 的 `conflicts` 参数报告冲突（§1.4 D14） |
| 方案的逐项对比视图 | 见 §1.4 D15 |
| 试玩、`trial_extract`、`title_blurb` 任务 | 标题和简介照旧由预览生成 |
| 采用开场之后改稿、「应用到新开局」、「待核对」标记 | 采用之后草稿仍然只读（`already_published`）。所以补充设定各节的修订号本次只记录、不使用 |
| 开场的就地编辑、候选开场 `opening_candidates` | 依赖工作站 |
| 换一种发展、手动存档、从存档另开、所有路线列表 | 里程碑已推迟 |
| `ask_clarification`、`routes.draft_input` | 同第二个里程碑 |
| 主角填写项的“试填一次” | 预览里占位符显示为标签，不做试填 |

### 1.4 设计决定（本文先按推荐项写）

| 编号 | 问题 | 本文采用 | 其他做法 |
| --- | --- | --- | --- |
| D1 | 启动参数怎样交给 core | desktop 用 `utilityProcess.fork(入口, [], { env, stdio: 'pipe', serviceName: 'core' })` 启动 core，**不传命令行参数**；随后发一条 `start` 消息，带数据目录、令牌、端口、client 目录、client 源、日志级别。登录 shell 的环境变量用 `fork` 的 `env` 选项传，不走消息 | 令牌放命令行：`ps` 可见。环境变量走消息：core 要在任何模块加载前改 `process.env`，pi-ai 可能已经读过 |
| D2 | core 怎样知道自己在 desktop 下 | `process.parentPort` 存在就是 desktop 模式：不读命令行，等 `start` 消息；不打印 `UNWRITTEN_CORE_URL` | 加一个 `--desktop` 参数：多一条要维护的约定 |
| D3 | desktop 的诊断怎样落库 | desktop 发 `log` 消息，core 校验后写进 `diagnostics.db`：事件的 `module` 固定为 `desktop`，样本的 `source` 固定为 `desktop`，`run_id` 由 core 写入（与 client 上报同一规则）。core 就绪前 desktop 先缓存，最多 64 条，超出丢弃并计数，就绪后先发一条 `desktop.dropped`。**已知限制：** core 一次都没起来时，desktop 自己的记录留不下，只有 core 写的 `core.start_failed` | desktop 自己打开 `diagnostics.db`：要复制一份 schema 和迁移，两处真相 |
| D4 | 启动失败和 core 意外退出怎样提示 | 原生对话框 `dialog.showMessageBox`：启动失败给「重试」「退出」，意外退出给「重启」「退出」，诊断编号写在 `detail` 里 | HTML 错误页：要么加 preload，要么另做一套页面和 CSP，违反“不使用 preload”（[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)） |
| D5 | desktop 的文案放哪里 | `apps/desktop/src/i18n/zh-CN.json`，键名 `desktop:<区域>.<元素>`，由 `apps/desktop/src/strings.ts` 的 `t(key, vars?)` 读取。菜单项全部显式写 `label`，不用 Electron 的英文默认文字 | 用 Electron 的 role 默认文字：菜单显示英文 |
| D6 | 超时 | core 就绪超时 `CORE_READY_TIMEOUT_MS = 30_000`；退出时发 `stop` 后等待 `CORE_STOP_TIMEOUT_MS = 5_000`，超时再 `kill()`；读登录 shell 环境变量最多等 `SHELL_ENV_TIMEOUT_MS = 5_000`，超时用当前 `process.env` | 不设超时：shell 的 rc 文件卡住时应用永远打不开 |
| D7 | 开发模式 | `pnpm --filter @unwritten/desktop dev` 设 `UNWRITTEN_DEV_CLIENT_ORIGIN=http://localhost:5173` 和 `UNWRITTEN_USER_DATA_DIR=<仓库>/.data`。desktop 看到前者就进开发模式：fork `packages/core/src/main.ts`（Electron 45 的 utilityProcess 支持类型擦除，§1.5 已验证），端口 4317（Vite 代理写死的端口），窗口打开 `http://localhost:5173/#token=…`。没有这个变量、也没打包时，fork `packages/core/dist/main.js`，client 目录用 `apps/client/dist`，端口 0。打包后 fork `<resources>/core/dist/main.js`，client 目录 `<resources>/client` | 开发模式也用构建产物：每改一次 core 都要重新构建 |
| D8 | 打包 | 先跑 `apps/desktop/scripts/stage.mjs`：构建 core 和 client，`pnpm --filter @unwritten/core deploy --prod --config.node-linker=hoisted <stage>/core` 得到带扁平 `node_modules` 的 core（§1.5 已验证），删掉 `node_modules/.bin`，再复制 `apps/client/dist` 到 `<stage>/client`。electron-builder 用 `extraResources` 把两个目录放进资源目录。macOS 目标 `dir` 和 `dmg`，`mac.identity: null` 不签名。fuses 写在 electron-builder 配置的 `electronFuses` 里 | 把 core 打成单文件：pi-ai 依赖多家 SDK，打包器不一定处理得了它们的动态导入 |
| D9 | 窗口全部关闭时 | 所有平台都退出应用（先按 D6 停 core） | macOS 惯例保留进程：没有窗口时 core 还在跑，要多处理 `activate` 重新开窗 |
| D10 | 补充设定的结构 | `meta.settings` 有八节：`world`、`protagonist`、`cast`、`secrets`、`opening`、`actions`、`scenes`、`status`。每节一段作者原文 `text`，有选择的节另带选择：`cast.mode`（`fixed` / `per_run`）、`actions.hints`（`actions_only` / `known_consequences`）、`opening.mode`（`ai` / `situation` / `author_text`）、`protagonist.fields`（主角填写项）。每节在 core 里另存修订号 `rev`。**三处作者锚点照旧存在 `meta.anchors`，不在八节里重复**：叙事要求、内容边界、即兴范围只有一份 | 把锚点并进八节：要迁移已有数据，契约字段也要改名 |
| D11 | “逐部选择”是按作品还是按人物 | 按作品。[创作流程 §2](../docs/authoring-flow.md#2-写背景只补自己在意的设置)的“逐部”指每部作品；主要人物整部作品选一种模式，行动提示整部作品选一种 | 按人物：每个人物位置单独选，开局时要混合处理固定与生成 |
| D12 | 方案的形状 | `meta.plan = { items, conflicts, confirmedRev }`。`items` 按 `kind` 分六种：`summary`、`entity`、`secret`、`state`、`scene`、`ending`，每项有 core 分配的 `id`（UUID）和来源 `source`。旧数据里没有 `kind` 的项读作 `summary`，`key` 取 `public_setting` | 方案只存文本：确认时还要再解析一遍，解析规则会有两份 |
| D13 | 方案生成 | `plan` 任务，用途 `author_chat`，工具 `propose_plan`，参数全是“每行一个 JSON”的字符串（附录 C.1）。重新生成时，来源为 `author`、`author_confirmed` 的项原样保留，模型只补其余的 | 每次整份覆盖：作者改过的项会被冲掉，违反“作者设定优先” |
| D14 | 两条作者设定矛盾 | 模型在 `propose_plan` 的 `conflicts` 里给出两段原话和受影响的体验。core 逐字核对两段原话都出现在作者的背景、锚点或补充设定里，核对不上的丢弃（[创作工作站 §8](../docs/author-workstation.md#8-冲突处理)） | 不核对：可能把模型编的话当成作者原话 |
| D15 | 生成期间作者改了草稿 | 任务照常完成，但结果不写进草稿，任务视图标 `stale: true`。界面给「仍然采用」（覆盖当前方案，受保护的项保留）和「重新生成」。不做逐项对比，写进[创作工作站 §9](../docs/author-workstation.md#9-生成任务)的已知限制 | 逐项对比视图：界面工作量接近一个任务，本次不做 |
| D16 | “已确认”怎样判断 | 确认方案时 `meta.plan.confirmedRev` 记下确认后的 `content_rev`。`confirmedRev === draft.contentRev` 才算已确认；之后草稿的任何写入（包括改背景）都让方案回到未确认，要再点一次确认 | 单独存布尔值：改了背景还显示“已确认”，开场会基于过期的方案 |
| D17 | 确认方案写什么 | 一个事务：删掉草稿里全部作者设定的故事事实行（`origin_turn_id` 为空的实体、称呼、事实、知情、状态栏定义），按方案重新写入，实体、秘密、栏目的 id 就是方案项的 id；写 `meta.keyScenes`、`meta.ending`、`meta.castSlots`；`confirmedRev`、`wizardStep: 'opening'`；`content_rev` 加一。草稿不被任何开局引用，所以整批重写是安全的 | 逐行比对更新：同一件事两套写法 |
| D18 | 开场方式 | `ai`：AI 起草。`situation`：按 `settings.opening.text` 写的情境起草。`author_text`：正文原样采用 `settings.opening.text`，预览工具不带 `prose` 参数，模型只交选项、场景、`changes` 和初始状态 | 作者原文也让模型“照抄”：模型会改字 |
| D19 | 主角填写项 | 每项 `{ name, defaultValue, isName }`，最多 8 项，`isName` 最多一项。占位符写成 `{{protagonist.<name>}}`。有 `isName` 项时，预览的正文和选项里不能出现主角实体的名字：`ai` 和 `situation` 模式作为校验错误交回模型；`author_text` 模式列进预览的 `needsReview`，有未处理的句子时采用返回 `opening_needs_review` | 不检查：玩家填了名字，开场里却是另一个名字 |
| D20 | 采用开场 | 只发布：给预览里新出现的实体分配 id，作为作者设定写进草稿，再把草稿的全部作者设定复制进发布版本；`meta.opening` 记下 `changes`、新实体的 id 和初始状态。**不建开局** | 照旧在采用时建开局：主角填写项没有机会填 |
| D21 | 开局 | `play.start`。固定人物：一个事务里替换占位符，写根回合、开场事实、主角称呼、初始状态值、索引和第一条路线，不调模型。每局生成：登记一个 `kind=opening` 的回合请求，后台分两步跑：先用 `propose_cast` 生成本局人物，存进 `playthroughs.cast`；再用 `propose_opening` 写开场并提交。重试时 `cast` 已有就跳过第一步（[回合循环 §10](../docs/turn-loop.md#10-开场)） | 一次调用同时生成人物和开场：失败重试时人物会换掉 |
| D22 | 每局生成作品的预览 | 预览照常生成一组具体人物。采用时，这些人物不写成作者设定（`changes` 里带 `"slot"` 的行），其余新实体照常写；开场正文存为模板，开局时交给 `propose_opening` 参照 | 预览不生成人物：作者看不到人物怎样进入开场 |
| D23 | 状态栏怎样给 client | 单独的过程 `play.getStatus`，和手记一样在 `turn.committed` 后失效重取 | 并进 `getRoute`：每次取路线都算一遍投影 |
| D24 | 状态栏的来历 | 每个栏目给出本路线上可见变化的列表：回合编号和当时的显示值。状态值没有段号，跳回原文跳到那一回合的标题 | 给状态值加段号：`state` 这类 `changes` 没有 `para` 字段，要改格式 |
| D25 | 结局 | 作品写了结束条件才接受 `ending: "true"`；`RouteView` 加 `ended`。完结后游玩页不显示行动输入，显示「故事到这里结束了」和「重新开局」 | 由 client 判断：client 不知道作品有没有结束条件 |
| D26 | 关键场面怎样引用 | 上下文里给未触发的场面排短编号 `S1`、`S2`…，`scene_hit` 写这个编号，core 在本次请求内映射回场面 id | 写场面 id：模型永远见不到真实 id（[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)） |
| D27 | 幕后折叠的状态 | 只是创作页的界面状态，不写库，每次打开创作页都是折叠的 | 存进 `chat_messages.anchor`：工作站还没做 |
| D28 | 版本号 | `electron@45.2.3`、`electron-builder@26.18.0`、`shell-env@4.0.3`。45.5.0 发布不满两周；Electron 45 的包没有 postinstall，desktop 的 `postinstall` 显式运行 `install-electron` | 用最新版：违反发布满两周的约定 |

T00 在维护者确认后把 D1–D28 写进设计文档。

### 1.5 已验证的前提

规划时实测过，执行者不必重做，但写判据时可以依赖：

| 前提 | 核法 | 读数 |
| --- | --- | --- |
| Electron 45 的 utilityProcess 里 `node:sqlite` 可用，FTS5 trigram 能检索中文 | 临时目录装 `electron@45.2.3`，`utilityProcess.fork` 一个脚本：建 `fts5(body, tokenize='trigram')` 虚表，插一句中文，用三字查询 | `process.versions.node` 为 24.22.2，命中 1 行，`sqlite_version()` 为 3.53.4 |
| `fork` 的 `env` 选项、命令行参数、`parentPort` 消息都能用 | 同一脚本：读 `process.env.SPIKE_ENV`、`process.argv`、回一条消息 | 三项都按预期收到 |
| 现有 core 的构建产物能直接跑在 utilityProcess 里 | `pnpm --filter @unwritten/core build` 后 fork `packages/core/dist/main.js --data-dir <临时目录>` | 打印 `UNWRITTEN_CORE_URL=…`；`diagnostics.db` 里依次有 `store.migrated`、`story.backfill`、`llm.config.loaded`、`recovery.interrupted`、`client.assets.missing`、`core.started`、`core.stopped`。`child.kill()` 后 core 走了正常退出 |
| utilityProcess 能直接跑 `.ts` 源码 | fork 一个带类型标注的 `.ts` 文件 | 正常运行并回消息 |
| `pnpm deploy` 能得到可运行的 core | `pnpm --filter @unwritten/core deploy --prod --config.node-linker=hoisted <目录>`，再 `node <目录>/dist/main.js --data-dir <临时目录>` | 退出码 0；`node_modules` 约 130 MB、62 个顶层目录，除 `.bin` 外没有符号链接；core 正常打印地址 |
| Electron 45 不在安装时下载本体 | 临时目录 `pnpm add electron@45.2.3` 后看 `node_modules/electron/dist`，再运行 `pnpm exec electron --version` | 第一次目录不存在；运行后 `dist/Electron.app` 存在 |

---
## 2. 贯穿全局的约定

### 2.1 命名

- 领域词按 [docs/AGENTS.md §4.1](../docs/AGENTS.md#41-术语对照表)。本里程碑新增的代码名：

  | 概念 | 代码名 |
  | --- | --- |
  | 补充设定（八节） | `WorkSettings`，各节 `SettingSectionId = 'world' \| 'protagonist' \| 'cast' \| 'secrets' \| 'opening' \| 'actions' \| 'scenes' \| 'status'` |
  | 主要人物模式 | `CastMode = 'fixed' \| 'per_run'` |
  | 行动提示模式 | `HintMode = 'actions_only' \| 'known_consequences'` |
  | 开场方式 | `OpeningMode = 'ai' \| 'situation' \| 'author_text'` |
  | 主角填写项 | `ProtagonistField`，占位符 `{{protagonist.<name>}}` |
  | 故事方案、方案项 | `plan`、`PlanItem`，种类 `PlanItemKind = 'summary' \| 'entity' \| 'secret' \| 'state' \| 'scene' \| 'ending'` |
  | 方案项来源 | `PlanSource = 'author' \| 'ai' \| 'author_confirmed'` |
  | 冲突 | `PlanConflict` |
  | 向导步骤 | `WizardStep = 'background' \| 'plan' \| 'opening'` |
  | 人物位置 | `CastSlot` |
  | 关键场面 | `KeyScene` |
  | 状态栏定义、状态值 | `stateDef`（表 `state_defs`）、`stateValue`（表 `state_values`） |
  | 栏目显示方式 | `StateDisplay = 'number' \| 'stage' \| 'list' \| 'text'` |
  | 清单条目状态 | `ListItemStatus = 'open' \| 'done' \| 'failed' \| 'gone'` |
  | 状态栏视图 | `StatusView`、`StatusColumnView` |
  | 开局 | `playthrough`；开局请求是 `kind = 'opening'` 的回合请求 |
  | 进程消息 | `DesktopToCore`、`CoreToDesktop` |

- desktop 新目录：`apps/desktop/src/`。core 新模块：`packages/core/src/desktop/`（只放消息通道，不放业务）。
- 文件名：TypeScript 模块用 kebab-case，React 组件用 PascalCase，CSS Module 和组件同名，hook 用 camelCase。

### 2.2 id、时间、JSON

- id 一律 `crypto.randomUUID()`（core 和 desktop 里用 `import { randomUUID } from 'node:crypto'`）。
- 时间一律存毫秒整数 `Date.now()`。
- JSON 列用 Drizzle 的 `text(..., { mode: 'json' })`，形状由 `packages/core/src/store/meta.ts` 或 `packages/core/src/story/types.ts` 的 Zod schema 定义。
- **方案项、秘密、状态栏栏目、关键场面、人物位置的 id 在方案生成时由 core 分配，之后不变。** 确认方案时，实体、秘密事实、栏目定义直接用方案项的 id 作主键，所以同一个人物在方案、草稿、发布版本里是同一个 id。
- 令牌：`randomBytes(32).toString('base64url')`，由 desktop 生成（D1）；core 独立运行时由 core 生成（现有代码）。

### 2.3 错误码

全部错误码只在 `packages/contracts/src/errors.ts` 的 `ERROR_CODES` 里列一次。本里程碑新增四个，由 T10 加：

| 码 | HTTP 状态 | 什么时候 |
| --- | --- | --- |
| `plan_not_confirmed` | 409 | 生成开场预览时方案没确认，或确认后草稿又改过（D16）；或确认方案时方案还没生成 |
| `opening_needs_review` | 409 | 采用开场时，`author_text` 开场里还有写死主角名的句子，或有未知的占位符（D19） |
| `protagonist_input_invalid` | 400 | 开局时传了作品没有的填写项，或值超过长度上限 |
| `not_published` | 409 | 对还没发布的作品开局 |

加一个错误码要同时改三处：`contracts/src/errors.ts` 的 `ERROR_CODES`、`core/src/errors.ts` 的 `HTTP_STATUS`、`client/src/i18n/zh-CN/errors.json`。`keys.test.ts` 会检查第三处，TypeScript 会检查第二处。

校验模型提案的错误不是错误码，是返回给模型的中文说明（附录 B）。desktop 的启动失败原因也不是错误码，是 `StartFailureReason`（§5 T02）。

### 2.4 i18n

**client。** 规则同第二个里程碑：调用时写完整键 `t('authoring:plan.generate')`；不拼接；动态键只允许 `errors:${code}`；作品内容、AI 输出、模型 id、端点名原样显示。不新增命名空间：创作向导的文案放 `authoring`，开局页、状态栏、完结放 `play`，「重新开局」放 `library`，`author_chat` 用途放 `settings`。全部新文案见附录 A，照抄。枚举值的显示文案用“枚举值 → 键”的对照表，表旁边写一个测试：对 contracts 里枚举的每一个值都能查到一个存在的键（从枚举现取，先断言枚举非空）。

**desktop。** desktop 没有 i18next，文案放在 `apps/desktop/src/i18n/zh-CN.json`，结构是嵌套对象，键名在代码里写成 `desktop:<区域>.<元素>`。`apps/desktop/src/strings.ts` 导出：

```ts
export const DESKTOP_STRING_KEYS = [/* 附录 A.6 的全部键，按顺序 */] as const;
export type DesktopStringKey = (typeof DESKTOP_STRING_KEYS)[number];
export function t(key: DesktopStringKey, vars?: Record<string, string | number>): string;
```

`t` 去掉前缀 `desktop:`，按点号在 JSON 里取值，把 `{{name}}` 换成 `vars.name`；取不到时抛 `Error`。菜单、对话框、标题里的每一个字都走 `t`。

**给模型的文字**（提示词、工具说明、返回给模型的校验错误）写在 core 的常量里，不走 i18n。

### 2.5 运行诊断与性能记录

规则同第二个里程碑，以[运行诊断与性能记录](../docs/diagnostics.md)为准。`deps.logger.record(...)` 记事件，`deps.logger.sample(...)` 记计时。`data` 里只放枚举、计数、布尔和 id，**不放正文、名字、陈述、玩家输入、key、令牌、路径**。logger 会按键名拦掉 `content`、`prose`、`input`、`output`、`detail`、`message`、`token`、`url` 等键，但不要依赖它。

**关键路径成功也要记，不只记失败。** 新增的用户可感知等待（方案生成、确认方案、开局、开场生成、状态栏读取、core 启动）完成时，样本必须带稳定的样本名、耗时、结果、能解释耗时的规模字段，以及已有的作品 ID、任务 ID 或请求 ID。

本里程碑新增的事件和样本：

| 名字 | 类型 | module / source | 级别 | data 字段 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| `desktop.started` | 事件 | desktop | info | `packaged`、`dev`（布尔）、`platform`（`process.platform`） | T04 |
| `desktop.shell_env` | 事件 | desktop | info；超时或失败时 warn | `ok`、`timedOut`（布尔）、`vars`（变量个数） | T04 |
| `desktop.core_exited` | 事件 | desktop | warn | `code`（退出码）、`phase`（`starting` / `running`） | T04 |
| `desktop.core_ready_timeout` | 事件 | desktop | error | 无 | T04 |
| `desktop.core_restarted` | 事件 | desktop | info | `reason`（`retry` / `restart`） | T06 |
| `desktop.renderer_gone` | 事件 | desktop | warn | `reason`（Electron 给的 `details.reason`，是枚举） | T05 |
| `desktop.navigation_blocked` | 事件 | desktop | info | `kind`（`navigate` / `window_open`）、`external`（是否交给了系统浏览器） | T05 |
| `desktop.dropped` | 事件 | desktop | warn | `count` | T04 |
| `desktop.core_ready` | 样本 | desktop | — | `attempt` 放样本的 `attempt` 字段；`data` 无 | T04 |
| `desktop.window_ready` | 样本 | desktop | — | 无 | T06 |
| `desktop.channel.invalid` | 事件 | core | warn | `message`（`start` / `log`，键名用 `kind`）、`issues`（校验问题数） | T03 |
| `work.draft.saved` | 事件（已有） | library | info | 在已有 `contentRev` 上新增 `sections`：本次改了的补充设定节 id 数组 | T13 |
| `work.wizard_step` | 事件 | library | debug | `step` | T13 |
| `plan.job.started` / `plan.job.done` / `plan.job.interrupted` | 事件 | authoring | info | `done` 带 `items`（方案项数）、`conflicts`、`stale`（布尔） | T14 |
| `plan.job.failed` | 事件 | authoring | warn；存储失败 error | `code`、`stage`（`model` / `validation` / `commit` / `failure_state` / `background`）、`corrections`；`invalid_output` 时带 `errorCount`、`fields` | T14 |
| `plan.adopted_stale` | 事件 | authoring | info | `items` | T14 |
| `plan.item.updated` / `plan.item.removed` | 事件 | authoring | info | `kind`（方案项种类） | T15 |
| `plan.confirmed` | 事件 | authoring | info | `entities`、`secrets`、`states`、`scenes`（条数）、`castMode` | T15 |
| `preview.job.failed` | 事件（已有） | authoring | — | `fields` 新增可能值 `state`、`placeholder` | T17 |
| `playthrough.started` | 事件 | play | info | `mode`（`fixed` / `per_run`）、`fields`（填了几项） | T18 |
| `opening.request.done` | 事件 | play | info | `attempt`、`turnId` | T18 |
| `opening.request.failed` | 事件 | play | warn；存储失败 error | `attempt`、`code`、`stage`（`cast` / `opening` / `validation` / `commit` / `background`） | T18 |
| `turn.changes.rejected` | 事件（已有） | play | — | 不变 | — |
| `plan.queue`、`plan.validate`、`plan.commit`、`plan.total` | 样本 | core | — | 带 `jobId`、`workId`；`plan.total` 的 `data.items` 为方案项数 | T14 |
| `plan.confirm` | 样本 | core | — | 带 `workId`；`data` 同 `plan.confirmed` 的四个计数 | T15 |
| `opening.queue`、`opening.cast`、`opening.validate`、`opening.commit`、`opening.total` | 样本 | core | — | 带 `requestId`、`attempt` | T18 |
| `turn.context` | 样本（已有） | core | — | 在已有字段上新增 `secretLines`、`stateLines`、`sceneLines` | T19 |
| `story.status` | 样本 | core | — | `columns`、`closed`（条数） | T19 |
| `client.plan_visible` | 样本 | client | — | 带 `jobId`、`workId` | T10（契约）、T21（上报） |

T00 把这张表的新增行写进 `docs/diagnostics.md` §2 的事件约定和 §3 的样本表。

### 2.6 安全

- 规则同第二个里程碑。新增的注意点：
  - **令牌只出现在三处：** desktop 内存、`start` 消息、窗口地址的 hash。不进诊断、不进 stdout、不进命令行参数、不进文件。
  - **窗口：** `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，不设 `preload`。`will-navigate` 只放行和 core 同源（开发模式是 Vite 的源）的地址；`setWindowOpenHandler` 一律 `deny`。被拦下的地址只有 `http:` 和 `https:` 才交给 `shell.openExternal`，其余协议（`file:`、`javascript:`、自定义协议）直接丢弃。
  - **消息通道是信任边界之一。** core 收到的每一条消息都按 contracts 的 schema 校验，不合格的丢弃并记 `desktop.channel.invalid`，不崩溃。`log` 消息按事件名白名单取值（§5 T02）。
  - **方案和秘密是作者内容。** 只经契约返回给作者自己的 client；诊断只记条数。
  - **状态栏只走主角视角。** `play.getStatus` 不返回幕后栏目、隐藏期间的值和未到达的阶段名（[数据模型 §5](../docs/data-model.md#5-可见性规则)）。

### 2.7 测试

| 层 | 工具 | 放哪里 | 命名 |
| --- | --- | --- | --- |
| contracts、core 单元与集成 | Vitest（Node 环境） | 和被测文件放在一起 | `*.test.ts` |
| desktop 纯逻辑 | Vitest（Node 环境） | 同上 | `*.test.ts` |
| client 纯逻辑 | Vitest（项目名 `unit`） | 同上 | `*.test.ts` |
| client 组件 | Vitest 浏览器模式（项目名 `browser`）+ `vitest-browser-react` + axe-core | 同上 | `*.test.tsx` |
| 端到端 · 浏览器 | Playwright，浏览器打开独立运行的 core | `e2e/tests/` | `*.spec.ts` |
| 端到端 · Electron | Playwright 的 `_electron.launch` 启动 `apps/desktop/dist/main.js` | `e2e/tests/desktop.spec.ts` | 同上 |

**desktop 的可测性。** 在 Node 里 `import { app } from 'electron'` 拿到的是可执行文件路径字符串，不是 API，所以 Vitest 跑不了直接导入 `electron` 的模块。desktop 的代码分两层：

- **纯逻辑**（不导入 `electron`）：消息收发与状态机、导航判定、菜单模板、文案、启动失败原因到文案的映射、诊断缓冲。它们接收注入的依赖（`fork`、计时器、时钟），用 Vitest 测。
- **Electron 胶水**（导入 `electron`）：`main.ts`、`window.ts`、`electron-adapters.ts`。它们只做“把纯逻辑接到 Electron API 上”，由 T08 的 Electron 端到端测试覆盖。

写判据的规矩同第二个里程碑（[tasks/AGENTS.md §4](./AGENTS.md#4-判据)）：每条判据配一个最小突变；断言钉产物，不回抄自己的声明；否定命题要配阳性对照；扫描得到的集合先断非空；控件状态不是保存成功的信号；会启动后台队列的测试用 `whenIdle()` 等完再断言；查元素用 `getByRole` 和可读名称。

需要模型的测试一律用伪服务：core 单元测试用 `createScriptedLlm`，core 集成测试和端到端测试用伪 OpenAI 服务（`packages/core/src/test-support/fake-openai-server.ts`）。

### 2.8 契约变更“只加不删”，最后清理

为了让每个波次合并后 `pnpm typecheck` 都能过，contracts 的变更分两步：

- **T10 只加不删。** 新字段加上，旧字段保留；输入 schema 只放宽，不收紧。例如 `SaveDraftInput` 加的 `settings` 先是可选的，core 收到缺省时保留草稿里已有的设定。
- **T26 收紧。** 等 client 都改用新字段后：`SaveDraftInput.settings` 改为必填；`WorkSummary.routeId` 的含义改为“最近游玩的路线”，删掉 `WorkDetail.routeId`（创作页不再需要它，开局入口见 T24）。

### 2.9 接口先行与占位实现

core 各模块之间的新接口（`services.ts`、`store/meta.ts`、`story/types.ts`）在本文里写死，由 T11、T12 先落地。新增的服务方法先写占位实现：

```ts
throw appError('internal', 'not implemented: <服务名>.<方法名>');
```

后续任务把占位换成真实现。T26 的判据之一是 `grep -rn "not implemented:" packages/core/src` 零命中。占位只允许出现在本文明确要求的位置。

### 2.10 依赖与版本

由 T04 一次加齐，其他任务不改依赖清单：

| 位置 | 改什么 |
| --- | --- |
| `pnpm-workspace.yaml` 的 `catalog` | 加 `electron: 45.2.3`、`electron-builder: 26.18.0`、`shell-env: 4.0.3`，按字母顺序插入 |
| `pnpm-workspace.yaml` 的 `allowBuilds` | 不加 `electron`：Electron 45 的包没有 postinstall，`apps/desktop` 的 `postinstall` 显式运行 `install-electron` |
| `apps/desktop/package.json` 的 `scripts.postinstall` | 写 `install-electron`，让 `pnpm install` 后 `node_modules/electron/dist` 就位 |
| `apps/desktop/package.json` 的 `devDependencies` | `electron`、`electron-builder`、`shell-env`、`@types/node`、`tsdown`、`typescript`、`vitest`，都写 `"catalog:"`；`@unwritten/contracts` 写 `"workspace:*"` 放进 `dependencies` |
| `e2e/package.json` 的 `devDependencies` | 不加。Electron 端到端测试用 `createRequire` 从 `apps/desktop` 解析 Electron 的路径（T08） |
| `docs/tech-stack.md` | 由 T00 写版本、`allowBuilds` 和打包方式；`electron-updater` 那一行改成“签名之后再装”的推迟说明 |

`shell-env`、`zod` 和 `@unwritten/contracts` 都由 tsdown 打进 `apps/desktop/dist/main.js`，所以 desktop 打包时没有运行期 `node_modules`，`shell-env` 放在 `devDependencies`。只有 `electron` 保持外部导入。

---

## 3. 任务依赖与并行波次

```
W0   T00 设计补洞（docs）                                    ┐ 互不依赖
     T01 Figma 校准（编排者执行，持续到 W3 的 client 任务前）  ┘
      │
W1   ├─ T02 contracts：/desktop 入口与 lint 边界（依赖 T00）
     └─ T10 contracts：作者设定与游玩的契约（依赖 T00）
      │
W2   ├─ T03 core：接上进程消息通道（依赖 T02）
     ├─ T04 desktop：包、依赖、core 进程看护、登录 shell 环境、诊断转发（依赖 T02）
     └─ T11 core：服务接口、meta、占位、路由（依赖 T10）
      │
W3   ├─ T05 desktop：窗口、导航、菜单、外观、对话框、文案（依赖 T04）
     ├─ T12 core 存储：状态栏表、事实种类、作者设定的复制、状态值校验（依赖 T11）
     ├─ T13 core：补充设定保存与向导步骤（依赖 T11）
     ├─ T21 client：补充设定编辑（依赖 T10、T01）
     ├─ T22 client：方案面板（依赖 T10、T01）
     └─ T24 client：开局页、作品库入口、查询键与事件分发（依赖 T10、T01）
      │
W4   ├─ T06 desktop：main.ts 装配与开发模式（依赖 T03、T04、T05）
     ├─ T14 core：方案生成任务（依赖 T12、T13）
     ├─ T15 core：方案编辑与确认（依赖 T12、T13）
     ├─ T16 core story：状态栏、秘密、关键场面、新的 changes 类型（依赖 T12）
     ├─ T23 client：开场面板与创作页装配（依赖 T21、T22）
     └─ T25 client：游玩页的状态栏、提醒、完结（依赖 T24）
      │
W5   ├─ T07 desktop：本机安装包（依赖 T06）
     ├─ T08 Electron 端到端（依赖 T06）
     ├─ T17 core：按方案生成开场预览，采用只发布（依赖 T15、T16）
     └─ T19 core：回合循环接上设定，状态栏查询（依赖 T16）
      │
W6   T18 core：开局（固定人物与每局生成）（依赖 T17）
      │
W7   T26 core 装配、集成测试、过渡字段清理（依赖 T07、T08、T14、T18、T19、T23、T24、T25）
      │
W8   T27 浏览器端到端（依赖 T26）
      │
W9   T28 真实模型走查与收口（依赖 T27）
```

| 任务 | 依赖 | 可同时执行的任务 | 规模 |
| --- | --- | --- | --- |
| T00 | 维护者确认 §1.4 | T01 | 中 |
| T01 | 无 | T00、T02、T10、W2 全部 | 大（编排者） |
| T02 | T00 | T10 | 小 |
| T03 | T02 | T04、T11 | 中 |
| T04 | T02 | T03、T11 | 中 |
| T05 | T04 | W3 的其他任务 | 中 |
| T06 | T03、T04、T05 | W4 的其他任务 | 中 |
| T07 | T06 | W5 的其他任务 | 中 |
| T08 | T06 | W5 的其他任务 | 中 |
| T10 | T00 | T02 | 大 |
| T11 | T10 | W2 的其他任务 | 中 |
| T12 | T11 | W3 的其他任务 | 中 |
| T13 | T11 | W3 的其他任务 | 小 |
| T14 | T12、T13 | W4 的其他任务 | 大 |
| T15 | T12、T13 | W4 的其他任务 | 大 |
| T16 | T12 | W4 的其他任务 | 大 |
| T17 | T15、T16 | T19 | 大 |
| T18 | T17 | 无 | 大 |
| T19 | T16 | T17 | 大 |
| T21 | T10、T01 | W3 的其他任务 | 中 |
| T22 | T10、T01 | W3 的其他任务 | 大 |
| T23 | T21、T22 | W4 的其他任务 | 中 |
| T24 | T10、T01 | W3 的其他任务 | 中 |
| T25 | T24 | W4 的其他任务 | 大 |
| T26 | 上表所列 | 无 | 中 |
| T27 | T26 | 无 | 大 |
| T28 | T27 | 无 | 小 |

关键路径：T00 → T10 → T11 → T12 → T16 → T17 → T18 → T26 → T27。A 线（T02 → T03/T04 → T05 → T06 → T07/T08）比它短得多，可以完全藏在 B 线里。

**任务编号里没有 T09、T20。** A 线用 T02–T08，B 线的 core 从 T10 起、client 从 T21 起，空出的编号只是分隔。设置页的 `author_chat` 文案放在 T10 里：它和 `PURPOSES` 的改动必须在同一次合并里落地，否则 client 的类型检查会红。

**client 任务不等 core。** T21–T25 只依赖 T10 定下的契约。core 还没实现的过程，在 client 的组件测试里用 `createFakeApi()`（`apps/client/src/shared/test/fake-api.ts`）代替。

**波次闸门。** 每个波次合并后，编排者在集成分支上跑 §0.5 第 3 条的三项检查和 `node scripts/check-doc-links.mjs`，读数写进 §6 台账。没全绿不开下一个波次。

---

## 4. 文件总表

“归属”指哪个任务创建或改动这个文件。只有归属任务能改它。标了“→”的表示先由前一个任务改，后一个任务接着改。

### 4.1 根目录与文档

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `docs/architecture.md`、`docs/diagnostics.md`、`docs/i18n.md`、`docs/tech-stack.md`、`docs/data-model.md`、`docs/author-workstation.md`、`docs/turn-loop.md`、`docs/milestone-3.md` | 把 §1.4 的决定写进设计 | T00 |
| `pnpm-workspace.yaml` | catalog 与 `allowBuilds`（§2.10） | T04 |
| `.gitignore` | 加 `apps/desktop/.stage/`、`apps/desktop/release/` | T07 |
| `.oxlintrc.json` | desktop 的导入边界；desktop 的 `no-console` 例外不加（desktop 不往控制台写） | T02 |
| `turbo.json` | 不改：desktop 的 `build` 走通用的 `build` 任务 | — |
| `tasks/milestone-3.md` | 本文件；§6 台账由编排者写 | 编排者 |

### 4.2 `packages/contracts`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json` 的 `exports` | 加 `"./desktop": "./src/desktop.ts"` | T02 |
| `tsconfig.json` 的 `types` | 测试用 Node 内置模块 | T10 |
| `src/desktop.ts`、`src/desktop.test.ts` | 进程消息类型与校验 | T02 |
| `src/errors.ts` | 四个新错误码 | T10 |
| `src/schemas/authoring.ts`、`src/schemas/authoring.test.ts` | 新建：补充设定、主角填写项、方案、方案任务视图、向导步骤 | T10 |
| `src/schemas/llm.test.ts` | `author_chat` 可以用于测试连接 | T10 |
| `src/schemas/works.ts` | `WorkDetail.draft` 加设定、方案、步骤；`SaveDraftInput` 加 `settings`；方案相关过程的输入输出；预览加 `needsReview`、`state`；选项加 `hint` | T10 → T26 |
| `src/schemas/play.ts` | 选项加 `hint`；`RouteView` 加 `ended`；开局、开局请求、状态栏视图 | T10 |
| `src/schemas/llm.ts` | `PURPOSES` 加 `author_chat` | T10 |
| `src/schemas/log.ts` | client 样本加 `client.plan_visible` | T10 |
| `src/events.ts` | 加 `playthrough.updated` | T10 |
| `src/procedures/works.ts`、`src/procedures/play.ts` | 新过程 | T10 |
| `src/index.ts` | 导出 `schemas/authoring.ts` | T10 |

### 4.3 `packages/core`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `src/desktop/channel.ts`、`channel.test.ts` | 新建：在 utilityProcess 里读 `start`、回 `ready`、转发外观变化、写 desktop 日志、处理 `stop` | T03 |
| `src/main.ts` | 有 `process.parentPort` 时走消息通道 | T03 |
| `src/app.ts` | `startCore` 接受外部令牌；启动失败时把诊断编号交给调用方（已有 `CoreStartupError`） | T03 → T26 |
| `src/cli.ts` | `CliOptions` 加 `token: string \| null`，命令行模式下恒为 `null` | T03 |
| `src/errors.ts` | `HTTP_STATUS` 加四个码 | T10 |
| `src/llm/service.ts` | `purposeViews` 把 `author_chat` 不支持工具调用标成 `no_tools` | T10 |
| `src/services.ts` | 新服务方法：`LibraryService.setWizardStep`、`AuthoringService` 的方案方法、`PlayService.start/getPlaythrough/getStartInfo/retryOpening/getStatus` | T11 |
| `src/api/router.ts` | 挂上全部新过程（T10 先挂临时 handler） | T10 → T11 |
| `tsdown.config.ts` | `noExternal` 加 `@unwritten/contracts/desktop`，打包后的 core 不再引用 TS 源码 | T07 |
| `src/store/meta.ts` | `VersionMeta` 加 `settings`、新的 `plan`、`castSlots`、`keyScenes`、`ending`、`wizardStep`、`opening.initialState`、`opening.createdIds`、`opening.template`；方案任务的输入与结果；按任务种类取输入和结果的函数 | T11 → T17（`PreviewJobResultSchema` 加 `initialState`、`slots`） |
| `src/store/plan.ts`、`plan.test.ts` | 新建：`readPlan(meta)`、`readSettings(meta)`、`readPublicSetting(meta)`、`isPlanConfirmed(meta, contentRev)` | T11 |
| `src/store/schema.ts` | `state_defs`、`state_values` 两张表；`facts.kind` 的枚举加 `secret`、`scene_hit`；`jobs` 的 `input`、`result` 类型改为联合 | T11（jobs 类型）→ T12 |
| `src/store/migrations/<生成>/` | drizzle-kit 生成的建表迁移 | T12 |
| `src/story/types.ts` | 新事实种类、状态栏的投影类型、新的 `ValidatedChanges` 字段（`states`、`stateItems`、`newStates`、`secrets`、`sceneHits`） | T12 → T16 |
| `src/story/copy.ts`、`copy.test.ts` | 新建：把一个版本的作者设定复制到另一个版本 | T12 |
| `src/story/state.ts`、`state.test.ts` | 新建：栏目配置与值的校验、清单合并 | T12 |
| `src/story/opening-proposal.ts`、`opening-proposal.test.ts` | 新建：开场提案的解析与校验，预览和开局共用 | T17 |
| `src/text/placeholders.ts`、`placeholders.test.ts` | 新建：主角填写项占位符 | T17 |
| `src/text/turn-text.ts` | `parseOptionLines` 支持提醒 | T16 |
| `src/story/projection.ts` | 加载状态栏定义和值、秘密 | T16 |
| `src/story/changes.ts` | 新的 `changes` 类型 | T16 |
| `src/story/writer.ts` | 写入状态栏、秘密、场面；`castSlots` | T16 |
| `src/story/leak.ts` | 检查范围加上提醒和显示中的状态值 | T16 |
| `src/story/status.ts`、`status.test.ts` | 新建：主角视角的状态栏视图 | T16 |
| `src/story/journal.ts` | 收录主角知情的秘密 | T16 |
| `src/story/render.ts` | 秘密、状态栏、场面给模型看的文本 | T16 |
| `src/library/service.ts` | `saveDraft` 存补充设定；`get` 返回设定、方案、步骤、方案任务；`setWizardStep`；作品库卡片取最近游玩的路线 | T13 → T26 |
| `src/authoring/plan-tool.ts`、`plan-prompt.ts`、`plan-job.ts` 及测试 | 新建：方案生成 | T14 |
| `src/authoring/plan-edit.ts` 及测试 | 新建：改一项、删一项、确认方案 | T15 |
| `src/authoring/service.ts` | 把方案方法接到上面两个模块；`generatePreview`、`adoptPreview` 改为按方案 | T11（占位）→ T14、T15（各自一行接线）→ T17 |
| `src/authoring/preview-tool.ts`、`preview-prompt.ts` | 按方案、开场方式、填写项生成预览 | T17 |
| `src/play/start.ts` 及测试 | 新建：开局（固定人物） | T18 |
| `src/play/opening-job.ts`、`cast-tool.ts`、`opening-tool.ts`、`opening-prompt.ts` 及测试 | 新建：每局生成的开局请求 | T18 |
| `src/play/service.ts` | 接上开局、状态栏；续写接上新的 `changes` 和结局 | T11（占位）→ T18、T19 |
| `src/play/context.ts`、`narrator-prompt.ts`、`propose-turn-tool.ts` | 上下文加秘密、状态栏、场面、结束条件、行动提示；`ending`、`hint` | T19 |
| `src/test-support/llm-steps.ts` | 加 `proposePlanStep`、`proposeCastStep`、`proposeOpeningStep` | T14、T18 |
| `src/test-support/story-fixtures.ts` | `seedStory` 支持状态栏定义、状态值和秘密 | T16 |
| `src/app.integration.test.ts` | 采用不再建开局后的适配；补 M3 的集成用例 | T10（类型断言）→ T17（标 `it.todo`）→ T18（恢复）→ T26（新增） |

### 4.4 `apps/desktop`（全部新建）

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `package.json`、`tsconfig.json`、`tsdown.config.ts`、`vitest.config.ts` | 包定义与构建 | T04 |
| `src/i18n/zh-CN.json`、`src/strings.ts`、`src/strings.test.ts` | desktop 文案 | T05 |
| `src/paths.ts`、`src/paths.test.ts` | 按打包、开发、未打包三种模式算出 core 入口、client 目录、端口、client 源、数据目录 | T04 |
| `src/shell-env.ts`、`src/shell-env.test.ts` | 带超时地读取登录 shell 的环境变量 | T04 |
| `src/core-process.ts`、`src/core-process.test.ts` | 启动并看护 core：发 `start`、等 `ready`、超时、退出、停止 | T04 |
| `src/diagnostics.ts`、`src/diagnostics.test.ts` | desktop 的诊断：缓冲、丢弃计数、经 `log` 消息发送 | T04 |
| `src/navigation.ts`、`src/navigation.test.ts` | 判定一个地址是放行、交给系统浏览器还是丢弃 | T05 |
| `src/menu-template.ts`、`src/menu-template.test.ts` | 原生菜单的模板数据 | T05 |
| `src/startup-error.ts`、`src/startup-error.test.ts` | 启动失败原因与意外退出到对话框文案的映射 | T05 |
| `src/window.ts` | `BrowserWindow` 与安全设置、导航拦截、渲染进程崩溃后重开 | T05 |
| `src/electron-adapters.ts` | 把 `utilityProcess.fork`、`dialog`、`nativeTheme`、`Menu` 接到纯逻辑上 | T05 |
| `src/main.ts` | 入口：单实例、数据目录、shell 环境、启动 core、开窗口、错误对话框、退出 | T06 |
| `scripts/stage.mjs` | 打包前把 core 和 client 放进暂存目录 | T07 |
| `electron-builder.yml` | 打包配置与 fuses | T07 |

### 4.5 `apps/client`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `src/i18n/zh-CN/errors.json` | 四个新错误码 | T10 |
| `src/i18n/zh-CN/settings.json`、`src/features/settings/labels.ts`、`labels.test.ts` | `author_chat` 的名称与说明 | T10 |
| `src/i18n/zh-CN/authoring.json` | 向导文案 | T21、T22（同一波次，各自只加附录 A.2 里自己那一块的键，合并时两块并存）→ T23 |
| `src/features/authoring/SettingsSections.tsx`、`ProtagonistFieldsEditor.tsx`、`settings-labels.ts` 及样式、测试 | 新建：补充设定八节、主角填写项 | T21 |
| `src/features/authoring/BackgroundEditor.tsx`、`BackgroundEditor.test.tsx`、`draft.ts` | 草稿带上补充设定；生成方案 | T10（缓存字段）→ T21 |
| `src/features/authoring/PlanPanel.tsx`、`PlanItemCard.tsx`、`PlanItemEditor.tsx`、`PlanConflicts.tsx`、`plan-labels.ts` 及样式、测试 | 新建：方案面板 | T22 |
| `src/features/authoring/placeholder-text.tsx` 及测试 | 新建：把占位符渲染成标签 | T22 |
| `src/features/authoring/PreviewPanel.tsx`、`CastList.tsx` | 预览显示提醒、初始状态、待处理的句子 | T23 |
| `src/features/authoring/WizardSteps.tsx` 及样式、测试 | 新建：步骤导航 | T23 |
| `src/features/authoring/AuthoringPage.tsx`、`AuthoringPage.test.tsx` | 按步骤装配 | T21/T22（最小接线与断言）→ T23 |
| `src/features/authoring/PublishedPanel.tsx` | 「开始故事」指向开局页 | T23 |
| `src/features/play/StartPage.tsx`、`OpeningPendingPage.tsx` 及样式、测试 | 新建：开局页、开场生成中 | T24 |
| `src/features/library/WorkCard.tsx` | 「开始故事」指向开局页；「重新开局」 | T24 |
| `src/i18n/zh-CN/library.json` | 「重新开局」 | T24 |
| `src/app/router.tsx` | 新路由 `/works/$workId/start`、`/playthroughs/$playthroughId` | T24 |
| `src/i18n/zh-CN/play.json` | 开局页的键归 T24；状态栏、提醒、完结的键归 T25 | T24、T25 |
| `src/features/play/StatusBar.tsx`、`StatusColumn.tsx`、`StatusHistory.tsx` 及样式、测试 | 新建：状态栏 | T25 |
| `src/features/play/EndedPanel.tsx` 及样式、测试 | 新建：完结 | T25 |
| `src/features/play/OptionList.tsx`、`PlayPage.tsx`、`PlayPage.test.tsx` | 提醒、状态栏、完结 | T25 |
| `src/shared/api/query.ts` | 加 `startInfo`、`playthrough`、`status` 三个查询键 | T24 |
| `src/shared/lib/log.ts` | `ClientSample` 加 `client.plan_visible` | T21 |
| `src/app/App.tsx` | 事件分发加 `playthrough.updated`；`turn.committed` 时让 `status` 失效 | T24 |
| `src/features/library/LibraryPage.test.tsx`、`authoring/AuthoringPage.test.tsx`、`play/PlayPage.test.tsx` 的假数据函数 | 补新字段的默认值 | T10 → 各自的页面任务 |

### 4.6 `e2e`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `tests/desktop.spec.ts` | Electron 模式 | T08 |
| `tests/milestone-3.spec.ts` | 浏览器模式：作者设定到游玩 | T27 |

---
## 5. 任务

每个任务的固定结构：目的 / 依赖 / 拥有的文件 / 先读 / 步骤 / 接线点 / 注意事项 / 完成判据。

### T00 设计补洞：把 §1.4 的决定写进 docs

**目的。** 设计以 `docs/` 为准。§1.4 的 28 条决定有一半改变了设计文档里的契约（启动参数的来源、诊断的写入方、方案的形状、采用开场的副作用），不写进文档，代码就成了唯一的真相。

**依赖。** 维护者确认 §1.4（可以整体确认，也可以逐条改选；改选的条目先改本文 §1.4 再动手）。

**拥有的文件。** §4.1 第一行列出的八份文档。

**先读。** [docs/AGENTS.md](../docs/AGENTS.md) 全文，尤其 §2 写作原则、§3 审计、§4 中文母语感。

**步骤。**

- [x] 1. `docs/architecture.md`
  - §2 启动顺序第 2 步改成：主进程用 `utilityProcess.fork` 启动 core，环境变量经 `fork` 的 `env` 传入，随后发 `start` 消息传数据目录、令牌、端口、client 目录和日志级别；令牌不进命令行，因为本机其他进程能看到命令行（D1）。
  - §2 第 4 步补：启动错误用原生对话框提示，带诊断编号和「重试」「退出」；第 5 步补：意外退出用原生对话框提供「重启」「退出」，重启时换新令牌（D4）。写明为什么不用 HTML 错误页：窗口不使用 preload。
  - §2.3 的表改成五行：`start`、`stop`、`log`（desktop → core），`ready`、`appearance-changed`、`start-failed`（core → desktop）。环境变量那一项移到表下的一句话里。补一句：core 用 `process.parentPort` 是否存在判断自己是否由 desktop 启动（D2）。
  - §6 补一句：设了环境变量 `UNWRITTEN_USER_DATA_DIR` 时，desktop 用它作为数据目录，开发模式和端到端测试靠它把数据放到别处。
  - §7 第三段“desktop 在开发模式下加载 Vite 的地址”展开成 D7 的内容：设 `UNWRITTEN_DEV_CLIENT_ORIGIN` 进入开发模式，core 跑源码、监听 4317。
  - §8 加一条：窗口全部关闭即退出应用（D9），理由写上。
- [x] 2. `docs/diagnostics.md`
  - §1 把“desktop 的记录遵循同一存储契约”改写成 D3：desktop 经进程消息通道交给 core 写入，事件 `module` 为 `desktop`，样本 `source` 为 `desktop`，`run_id` 由 core 写入；core 就绪前最多缓存 64 条（常量 `DESKTOP_LOG_BUFFER_MAX`），超出计数并在就绪后记 `desktop.dropped`。
  - 末尾加“已知限制”或在 §4 不做的事里写：core 一次都没启动成功时，desktop 自己的事件留不下。
  - §2、§3 按本文 §2.5 的表补事件约定和样本行。
- [x] 3. `docs/i18n.md`
  - §3 的命名空间列表后补：desktop 没有 i18next，原生菜单与对话框的文案放在 `apps/desktop/src/i18n/zh-CN.json`，键名 `desktop:<区域>.<元素>`，规则同 §4（D5）。
  - §5 补一句：desktop 显示启动失败原因时，按 `StartFailureReason` 查自己的文案，不显示 core 的英文 `message`。
- [x] 4. `docs/tech-stack.md`
  - §4 表里 Electron、electron-builder 写成确切版本（D28）；`electron-updater` 一行改为“签名之后再接入；未签名的 macOS 应用不能自动更新”。
  - §4 正文写：pnpm 默认不运行 Electron 的安装脚本，`pnpm-workspace.yaml` 的 `allowBuilds` 放行 `electron`；`shell-env`、`zod`、`@unwritten/contracts` 由 tsdown 打进主进程，打包时没有运行期依赖；core 用 `pnpm deploy --prod --config.node-linker=hoisted` 连同运行依赖放进资源目录（D8）。
  - §11 目录树的 `apps/desktop/src/` 换成 §4.4 的文件列表（每个文件一句作用），去掉 `updater.ts`。
- [x] 5. `docs/data-model.md` §2 的 `meta` 字段表，按 T11 定下的 `VersionMetaSchema`（§5 T11 步骤 2）改写：`settings` 写八节与各节的选择（D10、D11）；`plan` 写 `items`（六种）、`conflicts`、`confirmedRev`（D12、D16）；`protagonist_fields` 改名为 `settings.protagonist.fields` 并写明 `isName`；`cast_slots`、`key_scenes`、`wizard_step` 改成代码里的 `castSlots`、`keyScenes`、`wizardStep`；`opening` 补 `initialState`、`createdIds`、`template`（D20、D22）。“版本的生命周期”表的“存入作品库”一行补：不建开局；“新开局”一行补：由玩家在开局页发起。
- [x] 6. `docs/author-workstation.md` §9：`plan` 任务一行写清工具 `propose_plan`、受保护的项保留、冲突原话逐字核对（D13、D14）；“写回前比较草稿的 `content_rev`”下 `plan` 那一条改成 D15，并在本节末尾补“已知限制：不做逐项对比视图”。“确认方案时生成游玩的结构化初始数据”一条改成 D17 的具体写法。`preview` 一行补：方案确认后才能生成（D16），`author_text` 模式不让模型写正文（D18）。
- [x] 7. `docs/turn-loop.md`
  - §5 `options` 一行补：`hint` 只在作品选了「提醒已知后果」时允许，其余作品带 `hint` 时返回修正。`ending` 一行补：作品没写结束条件时只能是 `"false"`（D25）。`scene_hit` 的 `scene` 写上下文里的 `S` 编号（D26）。
  - §10 第 2 步改成 D21 的两步（`propose_cast` 存进 `playthroughs.cast`，`propose_opening` 写开场），写明重试时跳过已存的人物；第 3 步补占位符检查（D19）。
- [x] 8. `docs/milestone-3.md`：只在决定被改选时同步修改对应句子；没有改选就不动。
- [x] 9. 跑 `node scripts/check-doc-links.mjs`，再按 [docs/AGENTS.md §3](../docs/AGENTS.md#3-审计) 对新增行扫三遍。

**注意事项。**

- 文档写成“系统就是这样”，不写“M3 新增”“改为”。
- 数字分两档：`30_000`、`64` 这类是契约值，写明在哪个常量里；规划实测的读数（130 MB、62 个目录）不进文档。
- 只改这八份文档。发现别处也要改时，写进汇报。

**完成判据。**

- `node scripts/check-doc-links.mjs` 退出码 0。突变：把 `docs/architecture.md` 里新写的一个 `[…](./diagnostics.md#1-存储与生命周期)` 锚点改成 `#1-存储`，必须报错。
- 三遍审计扫描的命中逐条处理完，汇报里列出每条命中和处理方式。
- `rg -n "desktop 的记录遵循同一存储契约" docs` 零命中（旧句子已改写）。

### T01 Figma 校准（编排者执行）

**目的。** 第二个里程碑的界面先在 Figma 里对齐过再写代码。本次新增的界面是创作页的补充设定和方案、开局页、状态栏、完结，同样先画稿，避免 client 任务各自发明布局。

**依赖。** 无。持续到 W3 的 client 任务开工前。

**拥有的文件。** `tasks/assets/milestone-3/` 下的截图；本文 §6.2a。

**先读。** 记忆里的 Figma 文件说明（Starter 套餐只许 1 个 mode、3 个页面）；[设计准则](../docs/design-guidelines.md)；[a11y §8–9](../docs/a11y.md#8-游玩页)；`tasks/milestone-2.md` 的 §6.2a 作为格式参照。

**步骤。**

- [x] 1. 在 Prototype 页新建 section “Milestone 3 · 作者设定”，画：补充设定展开（八节加三处锚点，主角填写项编辑）、方案（摘要、人物、秘密折叠与展开、状态栏栏目、关键场面、结束条件、冲突、AI 与作者来源徽标、生成期间改过草稿的提示）、步骤导航。
- [x] 2. 新建 section “Milestone 3 · 开局与状态栏”，画：开局页（有填写项、无填写项）、开场生成中、开场失败、游玩页的状态栏（数字带进度条、阶段、清单、文字、本回合变化标记、来历展开、已了结）、推荐行动带提醒、完结。
- [x] 3. 每帧浅色截一张存进 `tasks/assets/milestone-3/`，状态栏和方案再各截一张深色。
- [x] 4. 稿子和本文冲突时，稿子符合设计文档就改本文对应任务，写进 §6.2a。

**完成判据。** §6.2a 列出全部截图和每处差异的处置；T21–T25 开工前编排者确认截图已就位。这一项没有机器判据，靠编排者检查。

### T02 contracts：`/desktop` 入口与 lint 边界

**目的。** core 和 desktop 之间只有一条进程消息通道（[架构总览 §2.3](../docs/architecture.md#23-core-与-desktop-的进程消息通道)），消息的类型和校验只在一处定义。desktop 只能导入这个入口，打包时不会带上整份 oRPC 契约。

**依赖。** T00。

**拥有的文件。** `packages/contracts/src/desktop.ts`、`packages/contracts/src/desktop.test.ts`、`packages/contracts/package.json` 的 `exports`、`.oxlintrc.json` 的一段 override。

**先读。** [架构总览 §2.3](../docs/architecture.md#23-core-与-desktop-的进程消息通道)；本文 §1.4 D1–D3；`packages/contracts/src/schemas/appearance.ts`、`schemas/common.ts`；`.oxlintrc.json` 里 `apps/client/**` 那段 `no-restricted-imports`。

**步骤。**

- [ ] 1. `packages/contracts/package.json` 的 `exports` 改成：

  ```json
  "exports": {
    ".": "./src/index.ts",
    "./desktop": "./src/desktop.ts"
  }
  ```

- [ ] 2. 新建 `packages/contracts/src/desktop.ts`。**只能导入** `zod`、`./schemas/appearance.ts`、`./schemas/common.ts`，不能导入 `./index.ts` 或任何 `procedures/`。内容：

  ```ts
  export const DESKTOP_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
  export const START_FAILURE_REASONS = ['data_locked', 'port_in_use', 'data_dir', 'startup'] as const;
  export const DESKTOP_PLATFORMS = ['darwin', 'win32', 'linux', 'other'] as const;
  export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  export const StartMessageSchema = z.strictObject({
    type: z.literal('start'),
    dataDir: z.string().min(1),
    token: z.string().regex(TOKEN_PATTERN),
    port: z.number().int().min(0).max(65_535),
    clientDir: z.string().min(1),
    clientOrigin: z.string().min(1).nullable(),
    logLevel: z.enum(DESKTOP_LOG_LEVELS),
  });
  export const StopMessageSchema = z.strictObject({ type: z.literal('stop') });
  ```

  desktop 事件逐个定义，`data` 用 `z.strictObject`：

  | `event` | `level` 允许值 | `data` |
  | --- | --- | --- |
  | `desktop.started` | `info` | `{ packaged: boolean, dev: boolean, platform: enum(DESKTOP_PLATFORMS) }` |
  | `desktop.shell_env` | `info`、`warn` | `{ ok: boolean, timedOut: boolean, vars: int ≥ 0 }` |
  | `desktop.core_exited` | `warn` | `{ code: int \| null, phase: enum('starting', 'running') }` |
  | `desktop.core_ready_timeout` | `error` | `{}` |
  | `desktop.core_restarted` | `info` | `{ reason: enum('retry', 'restart') }` |
  | `desktop.renderer_gone` | `warn` | `{ reason: string，匹配 /^[a-z-]{1,40}$/ }` |
  | `desktop.navigation_blocked` | `info` | `{ kind: enum('navigate', 'window_open'), external: boolean }` |
  | `desktop.dropped` | `warn` | `{ count: int ≥ 1 }` |

  ```ts
  export const DesktopEventEntrySchema = z.discriminatedUnion('event', [
    z.strictObject({ kind: z.literal('event'), event: z.literal('desktop.started'), level: z.literal('info'), data: … }),
    …
  ]);
  export const DESKTOP_SAMPLE_METRICS = ['desktop.core_ready', 'desktop.window_ready'] as const;
  export const DesktopSampleEntrySchema = z.strictObject({
    kind: z.literal('sample'),
    metric: z.enum(DESKTOP_SAMPLE_METRICS),
    durationMs: z.number().finite().nonnegative(),
    outcome: z.enum(['ok', 'error', 'interrupted']),
    attempt: z.number().int().positive().optional(),
  });
  export const DesktopLogEntrySchema = z.union([DesktopEventEntrySchema, DesktopSampleEntrySchema]);
  export const LogMessageSchema = z.strictObject({ type: z.literal('log'), entry: DesktopLogEntrySchema });

  export const DesktopToCoreSchema = z.discriminatedUnion('type', [StartMessageSchema, StopMessageSchema, LogMessageSchema]);

  export const ReadyMessageSchema = z.strictObject({
    type: z.literal('ready'),
    port: z.number().int().min(1).max(65_535),
    appearance: AppearanceSchema,
  });
  export const AppearanceChangedMessageSchema = z.strictObject({
    type: z.literal('appearance-changed'),
    appearance: AppearanceSchema,
  });
  export const StartFailedMessageSchema = z.strictObject({
    type: z.literal('start-failed'),
    reason: z.enum(START_FAILURE_REASONS),
    diagnosticId: UuidSchema,
  });
  export const CoreToDesktopSchema = z.discriminatedUnion('type', [
    ReadyMessageSchema,
    AppearanceChangedMessageSchema,
    StartFailedMessageSchema,
  ]);
  ```

  导出全部 schema 的 `z.infer` 类型：`StartMessage`、`StopMessage`、`DesktopEventEntry`、`DesktopSampleEntry`、`DesktopLogEntry`、`LogMessage`、`DesktopToCore`、`ReadyMessage`、`AppearanceChangedMessage`、`StartFailedMessage`、`CoreToDesktop`、`StartFailureReason`（`(typeof START_FAILURE_REASONS)[number]`）、`DesktopLogLevel`。
- [ ] 3. `.oxlintrc.json` 的 `overrides` 里，在 `apps/client/**` 那段之后加一段：

  ```json
  {
    "files": ["apps/desktop/**"],
    "rules": {
      "no-restricted-imports": [
        "error",
        {
          "paths": [
            { "name": "@unwritten/contracts", "message": "desktop 只导入 @unwritten/contracts/desktop" },
            { "name": "@unwritten/core", "message": "desktop 不导入 core，只通过进程消息通道通信" }
          ],
          "patterns": [{ "group": ["@unwritten/core/*"], "message": "desktop 不导入 core" }]
        }
      ]
    }
  }
  ```

- [ ] 4. 新建 `packages/contracts/src/desktop.test.ts`：
  - `start 消息拒绝缺字段和多余字段`：缺 `token` 失败；多一个 `extra` 字段失败；合法消息通过（阳性对照）。
  - `令牌格式固定为 43 位 base64url`：`randomBytes(32).toString('base64url')` 生成的值通过；42 位失败；含 `+` 失败。
  - `desktop 事件按事件名限定字段`：`desktop.started` 带 `data.path` 失败；带三个合法字段通过；`desktop.core_exited` 的 `phase: 'stopping'` 失败。
  - `未知事件名被拒`：`event: 'desktop.secret'` 失败。
  - `core → desktop 的三类消息都能解析`：每类一个合法样例通过，`start-failed` 的 `reason: 'timeout'` 失败（`timeout` 是 desktop 自己的原因，不是 core 发的）。
  - `desktop 入口不依赖主入口`：读 `desktop.ts` 的源码文本，断言不含 `'./index.ts'` 和 `procedures/`（字面量）。

**接线点。** 无（T03、T04 导入它）。`grep -rn "contracts/desktop" packages apps` 在本任务结束时只有测试和 `package.json` 命中。

**注意事项。**

- `discriminatedUnion` 的每个成员必须是对象 schema；`level` 用 `z.literal` 或 `z.enum`，对应上表。
- 不要把 `clientOrigin` 写成 URL 校验：core 收到后用 `cli.ts` 里同一份源校验（T03），避免两处规则。

**完成判据。**

- `pnpm --filter @unwritten/contracts test` 通过。
- 突变一：把 `StartMessageSchema` 的 `z.strictObject` 改成 `z.object`，`start 消息拒绝缺字段和多余字段` 必须红。
- 突变二：删掉事件表里 `desktop.core_exited` 的 `phase` 枚举限制（改成 `z.string()`），对应用例必须红。
- lint 边界：临时新建 `apps/desktop/src/lint-probe.ts`，内容 `import { contract } from '@unwritten/contracts'; export const probe = contract;`，跑 `pnpm exec oxlint apps/desktop/src/lint-probe.ts > "${TMPDIR:-/tmp}/uw-probe.txt" 2>&1; echo $?`，退出码非 0 且输出含 `desktop 只导入`。把导入改成 `import { StartMessageSchema } from '@unwritten/contracts/desktop'` 再跑，退出码 0（阳性对照）。跑完删除 `apps/desktop/src/lint-probe.ts`；如果 `apps/desktop` 目录是为此新建的，连目录一起删。

### T03 core：接上进程消息通道

**目的。** core 在 desktop 的 utilityProcess 里运行时，从消息通道拿启动参数（D1、D2），就绪后报告端口和外观，外观变化时通知 desktop，替 desktop 把诊断写进库（D3），收到 `stop` 时正常退出。独立运行的行为一点不变。

**依赖。** T02。

**拥有的文件。** `packages/core/src/desktop/channel.ts`、`channel.test.ts`（新建）；`packages/core/src/main.ts`；`packages/core/src/app.ts` 里 `startCore` 的令牌一行和参数类型；`packages/core/src/cli.ts` 里 `parseOrigin` 的 `export`。

**先读。** 本文 §1.4 D1–D3、§2.6；T02 的 `desktop.ts`；现有 `main.ts`、`app.ts`（`startCore`、`CoreStartupError`、`RunningCore`）、`cli.ts`（`parseOrigin`）、`events/bus.ts`（`subscribe(signal)` 是异步生成器）、`log/logger.ts`（`record`、`sample`、`SampleSource` 已含 `'desktop'`）。

**步骤。**

- [ ] 1. `app.ts`：
  - 新增并导出 `export type CoreStartOptions = CliOptions & { token?: string };`，`startCore` 的第一个参数类型改为它。
  - `const token = randomBytes(32).toString('base64url');` 改成 `const token = options.token ?? randomBytes(32).toString('base64url');`。其他不动。
- [ ] 2. `cli.ts`：`function parseOrigin` 前加 `export`。不改其他。
- [ ] 3. 新建 `desktop/channel.ts`：

  ```ts
  export interface ParentPortLike {
    on(event: 'message', listener: (event: { data: unknown }) => void): void;
    postMessage(message: CoreToDesktop): void;
  }

  export function desktopParentPort(): ParentPortLike | null;
  export function waitForStart(port: ParentPortLike): Promise<{ start: StartMessage; invalid: number }>;
  export function attachDesktopChannel(input: {
    port: ParentPortLike;
    core: RunningCore;
    invalidBeforeStart: number;
    onStop: () => void;
  }): () => void;
  ```

  - `desktopParentPort()`：`const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort; return port ?? null;`。core 不依赖 Electron 的类型，所以这里只声明用到的两个方法。
  - `waitForStart(port)`：注册 `message` 监听；每条消息用 `DesktopToCoreSchema.safeParse(event.data)`；不是合法的 `start` 时 `invalid += 1` 继续等；拿到第一条合法的 `start` 后 resolve `{ start, invalid }`，之后这个监听不再处理任何消息（用一个 `settled` 布尔守住）。`clientOrigin` 不为 `null` 时用 `parseOrigin(clientOrigin)` 校验，抛错算作不合法、继续等。
  - `attachDesktopChannel(input)`：
    1. `input.invalidBeforeStart > 0` 时记事件 `desktop.channel.invalid`（`module: 'core'`、`level: 'warn'`、`data: { kind: 'start', issues: input.invalidBeforeStart }`）。
    2. 发 `{ type: 'ready', port: core.port, appearance: core.services.settings.get() }`。
    3. 建 `AbortController`，后台跑 `for await (const event of core.services.bus.subscribe(controller.signal))`：`event.type === 'settings.changed'` 时发 `{ type: 'appearance-changed', appearance: event.appearance }`。用 `void (async () => { … })()` 启动，循环体外不 await。
    4. 注册 `message` 监听，`DesktopToCoreSchema.safeParse`：
       - 不合法：记 `desktop.channel.invalid`，`data: { kind: 'log', issues: result.error.issues.length }`。
       - `start`：忽略（重复的启动消息）。
       - `log` 且 `entry.kind === 'event'`：`core.services.logger.record({ level: entry.level, module: 'desktop', event: entry.event, data: entry.data })`。
       - `log` 且 `entry.kind === 'sample'`：`core.services.logger.sample({ source: 'desktop', metric: entry.metric, durationMs: entry.durationMs, outcome: entry.outcome, attempt: entry.attempt })`。
       - `stop`：调用 `input.onStop()`，只调一次（布尔守住）。
    5. 返回的函数 `controller.abort()`，并让 `message` 监听之后不再处理（同样用布尔，因为 `ParentPortLike` 没有 `off`）。
- [ ] 4. `main.ts`：
  - 把传给 `startCore` 的工厂对象提成模块级常量 `const factories: ServiceFactories = { … }`，两条路径共用。
  - `run()` 开头：`const port = desktopParentPort(); if (port) return runInDesktop(port);`，其余照旧。
  - 新增 `async function runInDesktop(port: ParentPortLike): Promise<void>`：
    1. `const { start, invalid } = await waitForStart(port);`
    2. 调 `startCore({ dataDir: start.dataDir, port: start.port, clientDir: start.clientDir, clientOrigin: start.clientOrigin, logLevel: start.logLevel, token: start.token }, factories)`。
    3. 捕获 `CoreStartupError`：`port.postMessage({ type: 'start-failed', reason: error.reason, diagnosticId: error.diagnosticId })`，然后 `setTimeout(() => process.exit(1), START_FAILED_EXIT_DELAY_MS)`；常量 `START_FAILED_EXIT_DELAY_MS = 2_000` 写在 `main.ts` 顶部。不是 `CoreStartupError` 的异常照旧向外抛，由 `run().catch` 处理。
    4. 成功后 `attachDesktopChannel({ port, core, invalidBeforeStart: invalid, onStop: () => void shutdown() })`。`shutdown` 用现有那段 `closing` 守住的逻辑（`await core.close(); process.exit(0);`）；把它提成 `function shutdownFor(core: RunningCore)`，两条路径共用。
    5. 照旧注册 `SIGINT`、`SIGTERM`。**不打印** `UNWRITTEN_CORE_URL`。
  - `CoreStartupError.reason` 的类型 `StartupFailure` 和 contracts 的 `START_FAILURE_REASONS` 必须一致：在 `app.ts` 里把 `type StartupFailure = …` 改成 `type StartupFailure = StartFailureReason`（从 `@unwritten/contracts/desktop` 导入）。
- [ ] 5. 新建 `desktop/channel.test.ts`。用一个假的 `ParentPortLike`（数组记下 `postMessage` 的内容，`emit(data)` 触发监听），真实的 `startCore`（用 `app.test.ts` 里同样的临时目录与工厂写法，`createScriptedLlm`）：
  - `第一条合法的 start 之前的消息被计数后忽略`：先 `emit({ type: 'log', … })`、`emit({ type: 'start', token: 'x' })`，再 `emit` 一条合法 `start`；`invalid === 2`，`start.dataDir` 是合法那条的值。
  - `就绪消息带实际端口和存下的外观`：`settings.update({ appearance: 'dark', … })` 后 `attachDesktopChannel`，收到的第一条是 `{ type: 'ready', port: core.port, appearance: { appearance: 'dark', … } }`。端口用 `core.port` 现取，`appearance` 写字面量 `'dark'`。
  - `外观变化转发给 desktop`：attach 后 `settings.update` 改成 `light`，等一个微任务循环（`await new Promise((r) => setImmediate(r))`），`postMessage` 记录里有 `{ type: 'appearance-changed', appearance: { appearance: 'light', … } }`。
  - `desktop 的事件写进诊断库`：`emit({ type: 'log', entry: { kind: 'event', event: 'desktop.started', level: 'info', data: { packaged: false, dev: true, platform: 'darwin' } } })`，`await core.services.logger.flush()`，用 `node:sqlite` 查 `diagnostic_events`：有一行 `module = 'desktop'`、`event = 'desktop.started'`，`data` 解析后 `dev === true`。
  - `desktop 的样本 source 为 desktop`：同上发 `desktop.core_ready` 样本，查 `performance_samples` 得到 `source = 'desktop'`。
  - `不合法的 log 只记一条 invalid，不写别的`：`emit({ type: 'log', entry: { kind: 'event', event: 'desktop.secret', level: 'info', data: {} } })`；诊断库里有 `desktop.channel.invalid`，没有 `event = 'desktop.secret'` 的行。阳性对照：同一个测试里先发一条合法事件，确认它写进去了。
  - `stop 只触发一次 onStop`：连发两条 `stop`，`onStop` 被调用 1 次。
  - 每个测试结束 `await core.close()` 并删除临时目录。
- [ ] 6. `cli.test.ts`、`app.test.ts` 不需要改；如果类型检查因为 `CoreStartOptions` 报错，只补类型，不改断言。

**接线点。** `main.ts` 的 `run()` 一处（`desktopParentPort()` 分支）。`grep -rn "attachDesktopChannel\|waitForStart" packages/core/src` 应只命中 `channel.ts`、`channel.test.ts`、`main.ts`。

**注意事项。**

- `postMessage` 的内容不经过 logger，令牌也从不回传给 desktop。不要记录 `start` 消息的任何字段。
- `process.exit(1)` 推迟 2 秒，是为了让 `start-failed` 消息先送到；desktop 收到后会主动结束进程（T04）。
- 独立运行路径（没有 `parentPort`）一行都不要改行为：`UNWRITTEN_CORE_URL` 照旧打印，令牌照旧由 core 生成。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `attachDesktopChannel` 里转发外观的 `if (event.type === 'settings.changed')` 改成 `if (false)`，`外观变化转发给 desktop` 必须红。
- 突变二：把写 desktop 事件时的 `module: 'desktop'` 改成 `module: 'core'`，`desktop 的事件写进诊断库` 必须红。
- 突变三：去掉 `waitForStart` 里的 `settled` 守卫（每条合法 `start` 都 resolve），`第一条合法的 start 之前的消息被计数后忽略` 不一定红；这时改为在该用例末尾再 `emit` 一条合法 `start`，断言 `startCore` 只被调用一次——如果仍然不红，按 §0.6 如实汇报。
- 独立运行不变：`pnpm --filter @unwritten/core build` 后跑 `node packages/core/dist/main.js --data-dir "$(mktemp -d)"`，stdout 第一行以 `UNWRITTEN_CORE_URL=` 开头。

### T04 desktop：包、依赖、core 进程看护、登录 shell 环境、诊断转发

**目的。** desktop 的主体是“启动并看护 core”（[技术选型 §4](../docs/tech-stack.md#4-desktop)）。这一块写成不导入 Electron 的纯逻辑，用注入的 `fork` 测试，Electron 的胶水留给 T05、T06。

**依赖。** T02。

**拥有的文件。** `pnpm-workspace.yaml`（§2.10 的两处）；`apps/desktop/package.json`、`tsconfig.json`、`tsdown.config.ts`、`vitest.config.ts`；`apps/desktop/src/paths.ts`、`shell-env.ts`、`core-process.ts`、`diagnostics.ts` 及各自的测试；`pnpm-lock.yaml`（由 `pnpm install` 生成）。

**先读。** [架构总览 §2](../docs/architecture.md#2-进程模型)、[§2.3](../docs/architecture.md#23-core-与-desktop-的进程消息通道)；本文 §1.4 D1、D3、D6–D8、§2.10；T02 的 `desktop.ts`；`packages/core/package.json`、`tsconfig.json`、`tsdown.config.ts`、`vitest.config.ts` 作为格式参照。

**步骤。**

- [ ] 1. `pnpm-workspace.yaml`：按 §2.10 在 `catalog` 里按字母顺序加三行；`allowBuilds` 不加 `electron`。`apps/desktop/package.json` 的 `scripts.postinstall` 写 `install-electron`。
- [ ] 2. 新建 `apps/desktop/package.json`：

  ```json
  {
    "name": "@unwritten/desktop",
    "productName": "Unwritten",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "dist/main.js",
    "engines": { "node": ">=24" },
    "scripts": {
      "build": "tsdown",
      "postinstall": "install-electron",
      "dev": "tsdown && UNWRITTEN_DEV_CLIENT_ORIGIN=http://localhost:5173 UNWRITTEN_USER_DATA_DIR=../../.data electron .",
      "start": "tsdown && electron .",
      "stage": "node scripts/stage.mjs",
      "package": "pnpm run build && node scripts/stage.mjs && electron-builder --config electron-builder.yml",
      "typecheck": "tsc --noEmit",
      "test": "vitest run --passWithNoTests"
    },
    "dependencies": { "@unwritten/contracts": "workspace:*" },
    "devDependencies": {
      "@types/node": "catalog:",
      "electron": "catalog:",
      "electron-builder": "catalog:",
      "shell-env": "catalog:",
      "tsdown": "catalog:",
      "typescript": "catalog:",
      "vitest": "catalog:"
    }
  }
  ```

  `UNWRITTEN_USER_DATA_DIR=../../.data` 是相对 `apps/desktop` 的路径，`paths.ts` 会 `resolve` 成绝对路径。
- [ ] 3. `tsconfig.json`：`{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "*.ts"] }`。`vitest.config.ts`：同 core 的写法，`include: ['src/**/*.test.ts']`。`tsdown.config.ts`：

  ```ts
  export default defineConfig({
    entry: ['src/main.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node24',
    outDir: 'dist',
    clean: true,
    fixedExtension: false,
    external: ['electron'],
    noExternal: [/^(?!electron$).*/],
  });
  ```

- [ ] 4. 在仓库根目录跑 `pnpm install > "${TMPDIR:-/tmp}/uw-install.txt" 2>&1; echo $?`，退出码 0；然后确认 `apps/desktop/node_modules/electron/dist` 存在。Electron 45 的包本身没有 postinstall，desktop 的 `postinstall` 会调用 `install-electron`；如果它没有运行，先检查 `apps/desktop/package.json`，不要用 `node_modules/electron/install.js` 手动补。
- [ ] 5. `src/paths.ts`：

  ```ts
  export const DEV_CORE_PORT = 4317;
  export type DesktopMode = 'packaged' | 'dev' | 'local';
  export interface DesktopPaths {
    mode: DesktopMode;
    coreEntry: string;
    clientDir: string;
    port: number;
    clientOrigin: string | null;
    dataDir: string;
  }
  export function resolveDataDir(input: { env: NodeJS.ProcessEnv; userDataPath: string; cwd: string }): string;
  export function resolveDesktopPaths(input: {
    isPackaged: boolean;
    resourcesPath: string;
    appDir: string;
    env: NodeJS.ProcessEnv;
    dataDir: string;
  }): DesktopPaths;
  export function windowUrl(paths: DesktopPaths, port: number, token: string): string;
  export function allowedOrigin(paths: DesktopPaths, port: number): string;
  ```

  - `resolveDataDir`：`env.UNWRITTEN_USER_DATA_DIR` 非空时返回 `path.resolve(input.cwd, 它)`，否则返回 `userDataPath`。
  - `resolveDesktopPaths`：`appDir` 是 `dist/main.js` 所在目录（`apps/desktop/dist`），仓库根是 `path.resolve(appDir, '..', '..', '..')`。
    - `isPackaged`：`mode: 'packaged'`，`coreEntry = join(resourcesPath, 'core', 'dist', 'main.js')`，`clientDir = join(resourcesPath, 'client')`，`port: 0`，`clientOrigin: null`。
    - 未打包且 `env.UNWRITTEN_DEV_CLIENT_ORIGIN` 非空：先校验它，必须匹配 `/^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/`，否则抛 `Error('UNWRITTEN_DEV_CLIENT_ORIGIN must be a loopback http origin')`。`mode: 'dev'`，`coreEntry = join(repo, 'packages', 'core', 'src', 'main.ts')`，`clientDir = join(repo, 'apps', 'client', 'dist')`，`port: DEV_CORE_PORT`，`clientOrigin` 为该值。
    - 其余：`mode: 'local'`，`coreEntry = join(repo, 'packages', 'core', 'dist', 'main.js')`，`clientDir = join(repo, 'apps', 'client', 'dist')`，`port: 0`，`clientOrigin: null`。
  - `allowedOrigin`：`paths.clientOrigin ?? \`http://127.0.0.1:${port}\``。`windowUrl`：`\`${allowedOrigin(paths, port)}/#token=${token}\``。
- [ ] 6. `src/shell-env.ts`：

  ```ts
  export const SHELL_ENV_TIMEOUT_MS = 5_000;
  export interface ShellEnvResult { env: NodeJS.ProcessEnv; ok: boolean; timedOut: boolean; vars: number }
  export async function resolveShellEnv(input: {
    platform: NodeJS.Platform;
    base: NodeJS.ProcessEnv;
    read: () => Promise<Record<string, string>>;
    timeoutMs?: number;
  }): Promise<ShellEnvResult>;
  ```

  - `platform === 'win32'`：直接返回 `{ env: { ...base }, ok: true, timedOut: false, vars: 0 }`，不调用 `read`。
  - 其余平台：`read()` 和一个 `timeoutMs`（默认 `SHELL_ENV_TIMEOUT_MS`）的计时器赛跑。成功：`env = { ...base, ...读到的 }`，`vars` 是读到的键数。超时：`{ env: { ...base }, ok: false, timedOut: true, vars: 0 }`。`read` 抛错：`{ env: { ...base }, ok: false, timedOut: false, vars: 0 }`。无论哪种结果都清掉计时器。
- [ ] 7. `src/diagnostics.ts`：

  ```ts
  export const DESKTOP_LOG_BUFFER_MAX = 64;
  export interface DesktopDiagnostics {
    record(entry: Omit<DesktopEventEntry, 'kind'>): void;
    sample(entry: Omit<DesktopSampleEntry, 'kind'>): void;
    attach(send: (entry: DesktopLogEntry) => void): void;
    detach(): void;
  }
  export function createDesktopDiagnostics(): DesktopDiagnostics;
  ```

  - 没有 `send` 时：记录推进缓冲；缓冲已有 `DESKTOP_LOG_BUFFER_MAX` 条时不推，`dropped += 1`。
  - `attach(send)`：先在 `dropped > 0` 时发 `{ kind: 'event', event: 'desktop.dropped', level: 'warn', data: { count: dropped } }` 并清零，再按顺序发完缓冲，之后的记录直接 `send`。
  - `detach()`：之后的记录回到缓冲。
  - `Omit<…, 'kind'>` 对联合类型会丢失判别，所以 `record` 的参数类型写成 `DistributiveOmit`：在文件里定义 `type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;`。
- [ ] 8. `src/core-process.ts`：

  ```ts
  export const CORE_READY_TIMEOUT_MS = 30_000;
  export const CORE_STOP_TIMEOUT_MS = 5_000;
  export type DesktopStartFailure = StartFailureReason | 'timeout' | 'exited';

  export interface CoreChild {
    postMessage(message: DesktopToCore): void;
    onMessage(listener: (data: unknown) => void): void;
    onExit(listener: (code: number | null) => void): void;
    kill(): void;
  }
  export interface CoreProcessDeps {
    fork(entry: string, env: NodeJS.ProcessEnv): CoreChild;
    setTimer(callback: () => void, ms: number): () => void;
    now(): number;
    createToken(): string;
    diagnostics: DesktopDiagnostics;
  }
  export interface CoreLaunch {
    entry: string;
    env: NodeJS.ProcessEnv;
    start: Omit<StartMessage, 'type' | 'token'>;
  }
  export type CoreStartResult =
    | { ok: true; port: number; token: string; appearance: Appearance }
    | { ok: false; reason: DesktopStartFailure; diagnosticId: string | null };
  export interface CoreProcess {
    start(launch: CoreLaunch): Promise<CoreStartResult>;
    stop(): Promise<void>;
    onAppearanceChanged(listener: (appearance: Appearance) => void): void;
    onUnexpectedExit(listener: (code: number | null) => void): void;
  }
  export function createCoreProcess(deps: CoreProcessDeps): CoreProcess;
  ```

  `Appearance` 从 `StartMessage` 同一个入口取：在 T02 的 `desktop.ts` 里已经导入了 `AppearanceSchema`，这里用 `ReadyMessage['appearance']` 作类型，不导入主入口。

  状态机（内部变量 `state: 'idle' | 'starting' | 'running' | 'stopping'`、`attempt`、`child`）：

  | 当前状态 | 发生了什么 | 做什么 |
  | --- | --- | --- |
  | `idle` | `start(launch)` | `attempt += 1`；`token = deps.createToken()`；记开始时间；`child = deps.fork(entry, env)`；注册监听；`child.postMessage({ type: 'start', token, ...launch.start })`；起 `CORE_READY_TIMEOUT_MS` 计时器；`state = 'starting'`；返回一个等待结果的 Promise |
  | `starting` | 收到 `ready`（`CoreToDesktopSchema` 解析） | 取消计时器；`state = 'running'`；`deps.diagnostics.attach((entry) => child.postMessage({ type: 'log', entry }))`；记样本 `desktop.core_ready`（`outcome: 'ok'`，`attempt`）；resolve `{ ok: true, port, token, appearance }` |
  | `starting` | 收到 `start-failed` | 取消计时器；`child.kill()`；记样本 `desktop.core_ready`（`outcome: 'error'`）；resolve `{ ok: false, reason, diagnosticId }`；`state = 'idle'` |
  | `starting` | 计时器到点 | 记事件 `desktop.core_ready_timeout`；`child.kill()`；样本 `outcome: 'error'`；resolve `{ ok: false, reason: 'timeout', diagnosticId: null }`；`state = 'idle'` |
  | `starting` | 子进程退出（没有先收到上面两种消息） | 记 `desktop.core_exited`（`phase: 'starting'`）；样本 `outcome: 'error'`；resolve `{ ok: false, reason: 'exited', diagnosticId: null }`；`state = 'idle'` |
  | `running` | 收到 `appearance-changed` | 依次调用 `onAppearanceChanged` 的监听 |
  | `running` | 子进程退出 | `deps.diagnostics.detach()`；记 `desktop.core_exited`（`phase: 'running'`）；`state = 'idle'`；依次调用 `onUnexpectedExit` 的监听 |
  | `running` 或 `starting` | `stop()` | `state = 'stopping'`；`deps.diagnostics.detach()`；`child.postMessage({ type: 'stop' })`；起 `CORE_STOP_TIMEOUT_MS` 计时器，到点 `child.kill()`；子进程退出时取消计时器、`state = 'idle'`、resolve |
  | `stopping` | 子进程退出 | 同上一行的“子进程退出时”；**不**调用 `onUnexpectedExit` |
  | `idle` | `stop()` | 立即 resolve |
  | 任何状态 | 收到解析不了的消息 | 忽略 |

  已经 resolve 过的启动 Promise 不再 resolve 第二次；旧子进程的退出事件不能影响新子进程（每次 `start` 用一个局部的 `current` 引用比对）。
- [ ] 9. 测试（全部用假的 `fork` 和手动推进的计时器，不启动真进程）：
  - `paths.test.ts`：`打包后从资源目录启动 core`（字面量路径 `/r/core/dist/main.js`、`/r/client`）；`开发模式跑 core 源码并监听 4317`（`port === 4317` 写字面量，`coreEntry` 以 `packages/core/src/main.ts` 结尾）；`开发源只接受回环 http`（`http://example.com:5173` 抛错，`http://localhost:5173` 通过）；`UNWRITTEN_USER_DATA_DIR 覆盖数据目录并解析成绝对路径`；`窗口地址的令牌只在 hash 里`（`windowUrl` 结果的 `new URL(…).search === ''`，`hash === '#token=…'`）。
  - `shell-env.test.ts`：`读到的变量覆盖启动时的环境`；`超时用启动时的环境并标记超时`（`read` 返回一个永不 resolve 的 Promise，`timeoutMs: 10`）；`读取失败不抛错`；`Windows 不读取`（`read` 被调用 0 次）。
  - `diagnostics.test.ts`：`连接前缓存，连接后按顺序发出`；`缓存满了计数，连接时先发 dropped`（推 `DESKTOP_LOG_BUFFER_MAX + 3` 条，`attach` 后第一条是 `desktop.dropped` 且 `count === 3`，之后正好 64 条）；`断开后回到缓存`。
  - `core-process.test.ts`：
    - `发 start 时带令牌，不带命令行参数`：假 `fork` 记下 `(entry, env)`；断言 `fork` 只收到两个参数，第一条消息 `type === 'start'`，`token` 等于 `createToken()` 的返回值。
    - `收到 ready 后返回端口并开始转发诊断`：`start` 之前 `diagnostics.record` 一条；收到 `ready` 后 resolve 的 `port` 与消息一致，子进程收到一条 `type: 'log'` 的消息。
    - `start-failed 带回诊断编号并结束子进程`：`kill` 被调用 1 次，结果 `reason: 'data_locked'`。
    - `就绪超时`：推进计时器到 `CORE_READY_TIMEOUT_MS`，结果 `reason: 'timeout'`，`kill` 被调用。
    - `启动中退出`：触发 `onExit(1)`，结果 `reason: 'exited'`。
    - `运行中意外退出通知调用方`：`onUnexpectedExit` 的监听收到 `137`。
    - `主动停止不算意外退出`：`stop()` 后子进程收到 `{ type: 'stop' }`，触发 `onExit(0)`，`stop()` resolve，`onUnexpectedExit` 的监听没被调用。阳性对照：上一条用例里它确实会被调用。
    - `停止超时后强制结束`：`stop()` 后不触发退出，推进 `CORE_STOP_TIMEOUT_MS`，`kill` 被调用。
    - `旧子进程的退出不影响新的一次启动`：第一次 `start` 以 `start-failed` 结束，再 `start` 一次；这时触发第一个子进程的 `onExit`，第二次启动的结果不受影响（仍在等待，随后收到 `ready` 正常 resolve）。

**接线点。** 本任务不接线，T06 的 `main.ts` 调用这些模块。

**注意事项。**

- 这四个模块**不能**导入 `electron`。`grep -n "from 'electron'" apps/desktop/src/{paths,shell-env,diagnostics,core-process}.ts` 必须零命中。
- `createToken` 由 T06 注入 `() => randomBytes(32).toString('base64url')`，测试里注入固定字符串。
- `fork` 只收 `entry` 和 `env` 两个参数，所以“命令行参数为空”由接口本身保证；T05 的适配器里 `utilityProcess.fork(entry, [], …)` 的第二个参数必须是空数组。

**完成判据。**

- `pnpm --filter @unwritten/desktop test` 通过，`pnpm --filter @unwritten/desktop typecheck` 通过。
- 突变一：把状态机里 `stopping` 状态的退出处理改成也调用 `onUnexpectedExit`，`主动停止不算意外退出` 必须红。
- 突变二：把 `attach` 里“先发 dropped”的分支删掉，`缓存满了计数，连接时先发 dropped` 必须红。
- 突变三：删掉 `current` 引用比对，`旧子进程的退出不影响新的一次启动` 必须红。
- `apps/desktop/node_modules/electron/dist` 存在（`ls` 的输出贴进汇报）。

### T05 desktop：窗口、导航、菜单、外观、对话框、文案

**目的。** 窗口按[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)的安全设置打开 client；菜单提供缩放、不提供原地刷新（[a11y §6](../docs/a11y.md#6-尺寸缩放与目标大小)）；外观同步到 `nativeTheme`（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）；启动失败和意外退出用原生对话框（D4）；全部文字走 desktop 的文案（D5）。

**依赖。** T04（Electron 的类型声明要等 T04 装好依赖才有；纯逻辑部分用到的 `DesktopStartFailure`、`DesktopDiagnostics` 也在 T04）。

**拥有的文件。** `apps/desktop/src/i18n/zh-CN.json`、`strings.ts`、`navigation.ts`、`menu-template.ts`、`startup-error.ts` 及各自测试；`window.ts`、`electron-adapters.ts`。

**先读。** [架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)；本文 §1.4 D4、D5、D9、§2.4、§2.6、附录 A.6；`apps/desktop/node_modules/electron/electron.d.ts` 里 `BrowserWindow`、`WebContents` 的 `will-navigate`、`setWindowOpenHandler`、`render-process-gone`、`dialog.showMessageBox`、`nativeTheme.themeSource`、`Menu.buildFromTemplate`、`utilityProcess.fork` 的类型；T04 的 `core-process.ts`、`diagnostics.ts` 的导出。

**步骤。**

- [ ] 1. `src/i18n/zh-CN.json`：照抄附录 A.6。`src/strings.ts`：按 §2.4 实现 `DESKTOP_STRING_KEYS`、`DesktopStringKey`、`t()`。JSON 用 `import zhCN from './i18n/zh-CN.json' with { type: 'json' };` 导入。
- [ ] 2. `src/navigation.ts`：

  ```ts
  export type NavigationDecision = { action: 'allow' } | { action: 'external'; url: string } | { action: 'drop' };
  export function decideNavigation(target: string, allowed: string): NavigationDecision;
  export function decideWindowOpen(target: string, allowed: string): Exclude<NavigationDecision, { action: 'allow' }>;
  ```

  - `decideNavigation`：`new URL(target)` 抛错 → `drop`；`url.origin === allowed` → `allow`；`url.protocol` 是 `http:` 或 `https:` → `external`（`url` 用 `url.href`）；其余 → `drop`。
  - `decideWindowOpen`：同源也不开新窗口（新窗口拿不到令牌）→ `drop`；`http:`、`https:` → `external`；其余 → `drop`。
- [ ] 3. `src/menu-template.ts`：

  ```ts
  export type MenuRole =
    | 'about' | 'hide' | 'hideOthers' | 'unhide' | 'quit'
    | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
    | 'resetZoom' | 'zoomIn' | 'zoomOut' | 'togglefullscreen'
    | 'minimize' | 'close' | 'toggleDevTools';
  export interface MenuItemSpec {
    label?: string;
    role?: MenuRole;
    accelerator?: string;
    visible?: boolean;
    type?: 'separator';
    submenu?: MenuItemSpec[];
  }
  export function buildMenuTemplate(input: { platform: NodeJS.Platform; dev: boolean }): MenuItemSpec[];
  ```

  菜单结构（每个 `label` 都用 `t()`，键见附录 A.6）：

  | 菜单 | 项 |
  | --- | --- |
  | 应用（仅 `darwin`，`label: t('desktop:app.name')`） | `about`、分隔、`hide`、`hideOthers`、`unhide`、分隔、`quit` |
  | 编辑 | `undo`、`redo`、分隔、`cut`、`copy`、`paste`、`selectAll` |
  | 显示 | `resetZoom`（`accelerator: 'CommandOrControl+0'`）、`zoomIn`（`'CommandOrControl+Plus'`）、`zoomIn`（`'CommandOrControl+='`，`visible: false`）、`zoomOut`（`'CommandOrControl+-'`）、分隔、`togglefullscreen`；`dev` 为真时再加分隔和 `toggleDevTools` |
  | 窗口 | `minimize`、`close`；非 `darwin` 时再加分隔和 `quit` |

  第二个 `zoomIn` 让不按 Shift 的 ⌘= 也能放大。**不出现** `reload`、`forceReload`：它们原地刷新，令牌已经从地址里抹掉了（[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)）。
- [ ] 4. `src/startup-error.ts`：

  ```ts
  export interface DialogSpec {
    type: 'error' | 'warning';
    title: string;
    message: string;
    detail: string;
    buttons: string[];
    defaultId: number;
    cancelId: number;
  }
  export function startFailureDialog(failure: { reason: DesktopStartFailure; diagnosticId: string | null }): DialogSpec;
  export function crashDialog(code: number | null): DialogSpec;
  ```

  - `startFailureDialog`：`type: 'error'`，`title: t('desktop:startup.title')`，`message` 按 `reason` 查 `desktop:startup.reason.<reason>`，`detail` 在有诊断编号时为 `t('desktop:startup.diagnostic', { id })`，否则为 `t('desktop:startup.noDiagnostic')`；`buttons: [t('desktop:startup.retry'), t('desktop:startup.quit')]`，`defaultId: 0`，`cancelId: 1`。
  - `crashDialog`：`type: 'warning'`，`title: t('desktop:crash.title')`，`message: t('desktop:crash.message')`，`detail: t('desktop:crash.detail')`，`buttons: [t('desktop:crash.restart'), t('desktop:crash.quit')]`，`defaultId: 0`，`cancelId: 1`。退出码不显示给用户（它在诊断里）。
  - 原因到键的映射用 `Record<DesktopStartFailure, DesktopStringKey>`，不写 `switch`。
- [ ] 5. `src/electron-adapters.ts`（导入 `electron`）：

  ```ts
  export function forkUtilityCore(input: { inheritStdio: boolean }): CoreProcessDeps['fork'];
  export async function showDialog(window: BrowserWindow | null, spec: DialogSpec): Promise<number>;
  export function applyThemeSource(appearance: ReadyMessage['appearance']['appearance']): void;
  export function installMenu(template: MenuItemSpec[]): void;
  ```

  - `forkUtilityCore` 返回的函数：`const child = utilityProcess.fork(entry, [], { env, stdio: inheritStdio ? 'inherit' : 'ignore', serviceName: 'core' })`；包成 `CoreChild`：`postMessage` → `child.postMessage`；`onMessage(l)` → `child.on('message', l)`；`onExit(l)` → `child.on('exit', l)`；`kill` → `child.kill()`。
  - `showDialog`：`const result = window ? await dialog.showMessageBox(window, spec) : await dialog.showMessageBox(spec); return result.response;`。**每次调用时**通过 `dialog.showMessageBox` 取函数，不要在模块顶层解构保存（T08 的测试会在运行时替换它）。
  - `applyThemeSource`：`nativeTheme.themeSource = appearance;`（`system`、`light`、`dark` 三个值和 Electron 的取值一致）。
  - `installMenu`：`Menu.setApplicationMenu(Menu.buildFromTemplate(template as MenuItemConstructorOptions[]))`。
- [ ] 6. `src/window.ts`（导入 `electron`）：

  ```ts
  export const WINDOW_DEFAULT_WIDTH = 1200;
  export const WINDOW_DEFAULT_HEIGHT = 820;
  export const WINDOW_MIN_WIDTH = 360;
  export const WINDOW_MIN_HEIGHT = 480;
  export interface MainWindow {
    readonly browserWindow: BrowserWindow;
    load(url: string, allowed: string): void;
    focus(): void;
  }
  export function createMainWindow(input: {
    diagnostics: DesktopDiagnostics;
    onFirstShow: () => void;
  }): MainWindow;
  ```

  - `new BrowserWindow({ width, height, minWidth, minHeight, show: false, title: t('desktop:app.name'), webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })`。不写 `preload`。
  - 保存当前的 `url` 和 `allowed`（只在内存里）。`load(url, allowed)` 更新两者并 `browserWindow.loadURL(url)`。
  - `ready-to-show` 第一次触发时 `show()` 并调用 `onFirstShow()`。
  - `webContents.on('will-navigate', …)`：按 electron.d.ts 里的签名取目标地址（Electron 45 的事件对象上有 `url`）；`decideNavigation(target, allowed)` 不是 `allow` 时 `preventDefault()`；`external` 时 `void shell.openExternal(decision.url)`；记 `desktop.navigation_blocked`（`kind: 'navigate'`，`external` 为是否交给了系统浏览器）。
  - `webContents.setWindowOpenHandler(({ url }) => { … return { action: 'deny' }; })`：按 `decideWindowOpen` 处理，同样记事件。
  - `webContents.on('render-process-gone', (_event, details) => { … })`：记 `desktop.renderer_gone`（`reason: details.reason`），然后 `browserWindow.loadURL(当前 url)`——用带令牌的地址重新打开（[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)）。
  - `focus()`：最小化时先 `restore()`，再 `focus()`。
- [ ] 7. 测试：
  - `strings.test.ts`：`每个键都能取到文字`（遍历 `DESKTOP_STRING_KEYS`，先断言长度大于 0，再断言每个 `t(key)` 是非空字符串）；`JSON 里没有多余的键`（把 JSON 拍平成键列表，和 `DESKTOP_STRING_KEYS` 集合相等）；`插值替换变量`（`t('desktop:startup.diagnostic', { id: 'abc' })` 含 `abc`）；`未知键抛错`（用 `as DesktopStringKey` 传一个不存在的键）。
  - `navigation.test.ts`：同源放行；`https://example.com/a` 交给系统浏览器；`file:///etc/passwd`、`javascript:alert(1)`、`unwritten://x` 丢弃；新窗口即使同源也丢弃。
  - `menu-template.test.ts`：`菜单里没有原地刷新`（递归收集全部 `role`，先断言集合非空且含 `zoomIn`——阳性对照——再断言不含 `reload`、`forceReload`）；`打包后没有开发者工具`（`dev: false` 时不含 `toggleDevTools`，`dev: true` 时含）；`缩放三件套都有快捷键`（`CommandOrControl+0`、`CommandOrControl+Plus`、`CommandOrControl+-` 三个字面量都在）；`每一项可见的菜单都有中文 label`（除分隔外每项 `label` 非空）。
  - `startup-error.test.ts`：每个 `DesktopStartFailure` 值（从 `START_FAILURE_REASONS` 现取再加 `'timeout'`、`'exited'`）都得到非空 `message`；有诊断编号时 `detail` 含编号；按钮顺序是重试在前（`defaultId === 0`）。

**接线点。** 本任务不接线，T06 的 `main.ts` 调用 `createMainWindow`、`installMenu`、`showDialog`、`applyThemeSource`、`forkUtilityCore`、`buildMenuTemplate`、`startFailureDialog`、`crashDialog`。

**注意事项。**

- 只有 `window.ts`、`electron-adapters.ts`（以及 T06 的 `main.ts`）可以导入 `electron`。
- 不要在任何地方记录窗口地址：它带令牌。`desktop.navigation_blocked` 只记 `kind` 和 `external`。
- Electron 的 `will-navigate` 不会因 `#` 后面的变化触发，client 的 `history.replaceState` 不受影响。

**完成判据。**

- `pnpm --filter @unwritten/desktop test`、`typecheck` 通过。
- 突变一：在 `buildMenuTemplate` 的显示菜单里加一项 `{ role: 'reload' }`（`MenuRole` 里临时加上），`菜单里没有原地刷新` 必须红。
- 突变二：把 `decideNavigation` 的协议判断改成只排除 `file:`，`javascript:` 那条必须红。
- 突变三：在 `zh-CN.json` 里删掉 `startup.reason.data_locked`，`每个键都能取到文字` 必须红。
- `grep -rn "preload" apps/desktop/src` 零命中。

### T06 desktop：`main.ts` 装配与开发模式

**目的。** 把 T04、T05 的模块按[架构总览 §2](../docs/architecture.md#2-进程模型)的启动顺序接起来：单实例、数据目录、登录 shell 环境、启动 core、开窗口、错误对话框、重启、退出。

**依赖。** T03、T04、T05。

**拥有的文件。** `apps/desktop/src/main.ts`。

**先读。** [架构总览 §2](../docs/architecture.md#2-进程模型)、[§7](../docs/architecture.md#7-目录结构)；本文 §1.4 D4、D6、D7、D9；T04、T05 的全部导出。

**步骤。**

- [ ] 1. 模块顶层，按顺序：
  1. `const dataDir = resolveDataDir({ env: process.env, userDataPath: app.getPath('userData'), cwd: process.cwd() });`，然后 `app.setPath('userData', dataDir);`。单实例锁按 `userData` 区分，所以测试用的临时数据目录不会和正在用的应用互相锁住。
  2. `if (!app.requestSingleInstanceLock()) { app.quit(); } else { void boot(); }`。
- [ ] 2. `async function boot()`：
  1. `const diagnostics = createDesktopDiagnostics();`
  2. `const paths = resolveDesktopPaths({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir: path.dirname(fileURLToPath(import.meta.url)), env: process.env, dataDir });`
  3. `diagnostics.record({ event: 'desktop.started', level: 'info', data: { packaged: app.isPackaged, dev: paths.mode === 'dev', platform: platformOf(process.platform) } })`；`platformOf` 把 `darwin`、`win32`、`linux` 以外的值映射为 `other`，写在 `main.ts` 里。
  4. `app.on('second-instance', () => mainWindow?.focus());`
  5. `app.on('window-all-closed', () => app.quit());`（D9）
  6. `await app.whenReady();`，`installMenu(buildMenuTemplate({ platform: process.platform, dev: paths.mode === 'dev' }));`
  7. `const shell = await resolveShellEnv({ platform: process.platform, base: process.env, read: () => shellEnv() });`；记 `desktop.shell_env`（`level` 在 `shell.ok` 为假时用 `warn`）。`shellEnv` 从 `shell-env` 包导入。
  8. `const core = createCoreProcess({ fork: forkUtilityCore({ inheritStdio: !app.isPackaged }), setTimer: (cb, ms) => { const h = setTimeout(cb, ms); return () => clearTimeout(h); }, now: () => performance.now(), createToken: () => randomBytes(32).toString('base64url'), diagnostics });`
  9. `core.onAppearanceChanged((appearance) => applyThemeSource(appearance.appearance));`
  10. `core.onUnexpectedExit(() => void handleCrash());`
  11. `await launch('initial');`
- [ ] 3. `async function launch(reason: 'initial' | 'retry' | 'restart')`：
  1. `reason !== 'initial'` 时记 `desktop.core_restarted`（`reason`）。
  2. `const result = await core.start({ entry: paths.coreEntry, env: shell.env, start: { dataDir: paths.dataDir, port: paths.port, clientDir: paths.clientDir, clientOrigin: paths.clientOrigin, logLevel: paths.mode === 'dev' ? 'debug' : 'info' } });`
  3. 成功：`applyThemeSource(result.appearance.appearance)`；窗口不存在时用 `createMainWindow({ diagnostics, onFirstShow })` 创建（`onFirstShow` 记样本 `desktop.window_ready`，起点是创建窗口前的 `performance.now()`）；`mainWindow.load(windowUrl(paths, result.port, result.token), allowedOrigin(paths, result.port))`。
  4. 失败：`const response = await showDialog(mainWindow?.browserWindow ?? null, startFailureDialog(result));`；`response === 0` 时 `await launch('retry')`，否则 `app.quit()`。
- [ ] 4. `async function handleCrash()`：`const response = await showDialog(mainWindow?.browserWindow ?? null, crashDialog(null));`；`0` → `await launch('restart')`；否则 `app.quit()`。
- [ ] 5. 退出：

  ```ts
  let stopped = false;
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    void core.stop().finally(() => {
      stopped = true;
      app.quit();
    });
  });
  ```

  `core` 在 `boot` 里创建，这段写在 `boot` 里、`createCoreProcess` 之后。
- [ ] 6. 手动验证开发模式（写进汇报，不进自动判据）：终端一跑 `pnpm dev:client`，终端二跑 `pnpm --filter @unwritten/desktop dev`。窗口显示作品库；改一个 client 组件，窗口热更新；地址栏（开发者工具里看 `location.href`）仍带 `#token=`（开发构建不抹令牌，[架构总览 §7](../docs/architecture.md#7-目录结构)）；仓库的 `.data/diagnostics.db` 里有 `module = 'desktop'` 的 `desktop.started`。

**接线点。** `apps/desktop/package.json` 的 `main` 已指向 `dist/main.js`（T04）。`pnpm --filter @unwritten/desktop build` 生成 `dist/main.js`。

**注意事项。**

- 错误对话框可能在窗口创建之前弹出（首次启动就失败），所以 `showDialog` 的第一个参数可以是 `null`。
- 开发模式的 core 监听 4317、使用仓库的 `.data/`，和 `pnpm dev:core` 抢同一个端口和同一个数据目录。两者不要同时跑：同时跑时 desktop 会弹“数据目录正被另一个 Unwritten 使用”，这是数据目录锁在正常工作，不是 bug。
- 开发模式下 core 跑的是源码但没有 `--watch`，改了 core 要重启 desktop。
- 重启时窗口复用，地址换成新令牌的地址。
- `launch` 的重试是递归调用，用户一直点「重试」就一直重试，这是预期行为。

**完成判据。**

- `pnpm --filter @unwritten/desktop build` 退出码 0；`grep -c 'from "electron"' apps/desktop/dist/main.js` 至少为 1，`grep -c 'from "shell-env"\|from "zod"\|from "@unwritten/contracts' apps/desktop/dist/main.js` 为 0（运行期没有别的外部依赖）。
- `pnpm --filter @unwritten/desktop typecheck` 通过。
- 自动判据由 T08 承担；本任务汇报里贴上步骤 6 的手动验证结果。

### T07 desktop：本机安装包

**目的。** 打出一个在本机能装、能跑的包（D8），用 fuses 关掉不需要的 Electron 能力（[技术选型 §4](../docs/tech-stack.md#4-desktop)）。不签名、不发布。

**依赖。** T06。

**拥有的文件。** `apps/desktop/scripts/stage.mjs`、`apps/desktop/electron-builder.yml`、`apps/desktop/build/icon.svg`、`icon-simple.svg`、`icon-dark.svg`、`icon-light.png`、`icon-dark.png`、`icon.icns`；`packages/core/tsdown.config.ts` 的 `noExternal` 一处；`.gitignore` 里加两行。

**先读。** 本文 §1.4 D8、§1.5；`packages/core/tsdown.config.ts` 的 `copy`（迁移目录在 `dist/migrations`、`dist/diagnostic-migrations`）；electron-builder 26 的配置项：`extraResources`、`mac.identity`、`electronFuses`（查不到时用 Context7 查 electron-builder 的文档）。

**步骤。**

- [ ] 1. `.gitignore` 追加 `apps/desktop/.stage/` 和 `apps/desktop/release/` 两行。
- [ ] 2. `scripts/stage.mjs`（第一行 `#!/usr/bin/env node`）：
  1. 算出 `repo`（脚本所在目录往上三级）和 `stage = join(repo, 'apps/desktop/.stage')`；`rmSync(stage, { recursive: true, force: true })`。
  2. 依次 `execFileSync('pnpm', [...], { cwd: repo, stdio: 'inherit' })`：`['--filter', '@unwritten/core', 'build']`、`['--filter', '@unwritten/client', 'build']`、`['--filter', '@unwritten/core', 'deploy', '--prod', '--config.node-linker=hoisted', join(stage, 'core')]`。
  3. 删掉 `stage/core` 下除 `dist`、`node_modules`、`package.json` 以外的所有条目，再删 `stage/core/node_modules/.bin`。
  4. `cpSync(join(repo, 'apps/client/dist'), join(stage, 'client'), { recursive: true })`。
  5. 逐个检查 `core/dist/main.js`、`core/dist/migrations`、`core/dist/diagnostic-migrations`、`client/index.html` 存在，缺哪个就 `process.stderr.write` 一行写明缺什么，`process.exit(1)`。
- [ ] 2.5 `packages/core/tsdown.config.ts` 的 `noExternal` 加上 `@unwritten/contracts/desktop`。只写包根时，deploy 后的 core 会保留 `from "@unwritten/contracts/desktop"`，Node 不允许在 `node_modules` 下擦除 `.ts` 类型，打包产物起不来。
- [ ] 3. `electron-builder.yml`：

  ```yaml
  appId: app.unwritten.desktop
  productName: Unwritten
  directories:
    output: release
  files:
    - dist/**
    - package.json
  extraResources:
    - from: .stage
      to: .
    - from: build/icon-light.png
      to: icon-light.png
    - from: build/icon-dark.png
      to: icon-dark.png
  asar: true
  npmRebuild: false
  mac:
    target:
      - dir
      - dmg
    identity: null
    icon: build/icon.icns
    category: public.app-category.entertainment
  electronFuses:
    runAsNode: false
    enableCookieEncryption: true
    enableNodeOptionsEnvironmentVariable: false
    enableNodeCliInspectArguments: false
    enableEmbeddedAsarIntegrityValidation: true
    onlyLoadAppFromAsar: true
  ```

- [ ] 4. 跑 `pnpm --filter @unwritten/desktop package > "${TMPDIR:-/tmp}/uw-package.txt" 2>&1; echo $?`，退出码 0，`apps/desktop/release/mac*/Unwritten.app` 存在。
- [ ] 5. 验证（逐条写进汇报）：
  1. `open apps/desktop/release/mac*/Unwritten.app`，窗口显示作品库。新建作品、写背景、保存，退出后重开，背景还在。数据目录是 `~/Library/Application Support/Unwritten`。
  2. `ELECTRON_RUN_AS_NODE=1 apps/desktop/release/mac*/Unwritten.app/Contents/MacOS/Unwritten -e "console.log(1)"` 不输出 `1`（`RunAsNode` 已关闭）。
  3. `ls apps/desktop/release/mac*/Unwritten.app/Contents/Resources/core/dist/main.js` 存在。
  4. 从 Dock 启动（不是从终端），`providers.json` 里写一个 `$VAR` 引用、变量只在 `~/.zshrc` 里定义，设置页显示 key 来自该环境变量。

**注意事项。**

- **未签名的应用在 Apple Silicon 上可能直接被系统结束**（启动后立刻退出、`Console.app` 里有 `Killed: 9` 或签名相关的报错），因为 electron-builder 改写 `Info.plist` 后，Electron 自带的临时签名失效。遇到时先把 `mac.identity: null` 改成 `mac.identity: '-'`（临时签名）重打一次；仍然不行就停下来汇报，贴上 `codesign -dv --verbose=4` 的输出。
- `enableEmbeddedAsarIntegrityValidation` 在未签名时同样可能导致启动失败。遇到时只关这一项重试，并在汇报里写明。不要为了“能跑”一次关掉多个 fuse。
- 安装包和 `.stage/` 都不进仓库。

**完成判据。**

- 步骤 4 的退出码 0，步骤 5 的四条都有读数。
- 突变：在 `stage.mjs` 里删掉复制 client 的那一步，`pnpm --filter @unwritten/desktop run stage` 必须以非 0 退出，并在 stderr 写明缺 `client/index.html`。
- `git status --short` 里没有 `.stage/`、`release/` 下的文件。

### T08 Electron 端到端

**目的。** 用真实的 Electron 进程验证 desktop 的几条承诺：窗口打开 client、令牌不留在地址里、外观同步到原生主题、单实例、core 意外退出后重启、数据目录被占用时提示并能重试。这些在纯逻辑测试里验不了（§2.7）。

**依赖。** T06。

**拥有的文件。** `e2e/tests/desktop.spec.ts`。

**先读。** `e2e/tests/milestone-2.spec.ts` 的 `boot`、`stop` 写法；`e2e/playwright.config.ts`；Playwright 的 `_electron`（`import { _electron as electron } from '@playwright/test'`，`launch({ executablePath, args, env })`、`firstWindow()`、`evaluate()`、`windows()`、`close()`）。

**步骤。**

- [ ] 1. 文件顶部：

  ```ts
  const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
  const electronPath = desktopRequire('electron') as string;
  const mainPath = fileURLToPath(new URL('../../apps/desktop/dist/main.js', import.meta.url));
  const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

  async function launchDesktop(dataDir: string) {
    return electron.launch({
      executablePath: electronPath,
      args: [mainPath],
      env: { ...process.env, UNWRITTEN_USER_DATA_DIR: dataDir },
    });
  }
  ```

  每个用例用 `mkdtempSync(join(tmpdir(), 'unwritten-desktop-'))` 建数据目录，`finally` 里 `await app.close()` 再 `rmSync`。
- [ ] 2. 用于替换对话框的帮助函数（在主进程里执行）：

  ```ts
  async function holdDialogs(app: ElectronApplication) {
    await app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { dialogs: Array<{ message: string; detail: string }>; releases: Array<() => void> };
      state.dialogs = [];
      state.releases = [];
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const spec = args.at(-1) as { message: string; detail: string };
        state.dialogs.push({ message: spec.message, detail: spec.detail });
        await new Promise<void>((resolve) => state.releases.push(resolve));
        return { response: 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
  }
  ```

  再写 `dialogs(app)`（读 `state.dialogs`）和 `releaseDialog(app)`（取出最早的一个 `release` 并调用）。
- [ ] 3. 用例：
  - `桌面窗口打开作品库，令牌不留在地址里`：`firstWindow()` 后等到 `getByRole('heading', { name: '作品库' })` 可见；`page.url()` 匹配 `/^http:\/\/127\.0\.0\.1:\d+\/$/`，不含 `token`。
  - `外观偏好同步到原生主题`：在窗口里进设置页，点「深色」；轮询 `app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)` 直到等于 `'dark'`；再点「跟随系统」，等到 `'system'`。两个期望值写字面量。
  - `第二次启动只聚焦已有窗口`：第一个应用打开后，用同一个数据目录再 `launchDesktop` 一次；第二个应用的进程在 10 秒内退出（`await second.process()` 的 `exitCode` 不为 `null`，用 `expect.poll`）；第一个应用 `app.windows().length === 1`。
  - `core 意外退出后重启，进度不丢`：
    1. 打开应用，等作品库出现；新建一个作品、写一句背景，等到「已保存」。
    2. `holdDialogs(app)`。
    3. 取 core 的进程号：`app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'core')?.pid)`，断言是数字。Electron 实测 `serviceName` 是 `node.mojom.NodeService`，`name` 才是 `core`。
    4. `process.kill(pid, 'SIGKILL')`；`expect.poll(() => dialogs(app))` 长度变为 1。
    5. 在 desktop 重启 core 之前，用 `spawn(process.execPath, [corePath, '--data-dir', dataDir])` 起一个独立的 core 占住数据目录，等它打印 `UNWRITTEN_CORE_URL=`。
    6. `releaseDialog(app)`（点「重启」）；第二个对话框出现，`message` 含“数据目录”，`detail` 匹配 UUID 的正则。
    7. 结束独立的 core（`SIGTERM` 并等退出），`releaseDialog(app)`（点「重试」）；窗口重新显示作品库，刚才的作品还在。
    8. 新的 core 进程号和第 3 步的不同。
    9. `await app.close()` 后用 `node:sqlite` 打开 `<dataDir>/diagnostics.db`：`diagnostic_events` 里有 `module = 'desktop'` 的 `desktop.started`（阳性对照）、`desktop.core_exited`（`data.phase === 'running'`）、两条 `desktop.core_restarted`（`reason` 分别为 `restart`、`retry`）。
- [ ] 4. 跑 `pnpm e2e > "${TMPDIR:-/tmp}/uw-e2e.txt" 2>&1; echo $?`（根脚本会先 `turbo run build`，desktop 的 `build` 也在里面）。

**注意事项。**

- 不要在测试里给 desktop 加任何“测试模式”的分支。对话框靠 `app.evaluate` 在运行时替换，这要求 T05 的 `showDialog` 每次调用时才取 `dialog.showMessageBox`。
- `getAppMetrics()` 的 `name` 是 T05 的 `fork` 选项 `serviceName: 'core'` 在 Electron 里的实际字段；`serviceName` 是 `node.mojom.NodeService`。取不到时先确认这一点。
- 第二个实例拿不到单实例锁会立刻退出，`electron.launch` 可能因此直接 reject。把第二次 `launchDesktop` 包在 `try/catch` 里：reject 本身就是预期结果之一；resolve 了就再等它的进程退出。两种情况都要断言第一个应用仍然只有一个窗口。
- 第 3 步的用例比较长，失败时用 `trace: 'retain-on-failure'` 留下的 trace 排查，不要拆掉中间的断言。

**完成判据。**

- `pnpm --filter @unwritten/e2e exec playwright test tests/desktop.spec.ts` 退出码 0，本文件四条用例全部通过。`pnpm e2e` 里旧创作流程的三条失败由 T27 更新旧 spec，T08 不负责。
- 突变一：删掉 `main.ts` 里 `core.onAppearanceChanged(...)` 这一行（不要注释掉，代码里不许写注释），`外观偏好同步到原生主题` 必须红。测完用编辑器把这一行加回来。
- 突变二：把 `main.ts` 的 `requestSingleInstanceLock()` 判断改成恒为真，`第二次启动只聚焦已有窗口` 必须红。
- 突变三：把 `main.ts` 的 `handleCrash` 改成直接 `app.quit()`，`core 意外退出后重启，进度不丢` 必须红。
- 每个突变都要先 `pnpm --filter @unwritten/desktop build`，因为测试跑的是 `dist/main.js`。

---
### T10 contracts：作者设定与游玩的契约

**目的。** B 线的 client 和 core 只通过这里相交。先把全部新类型、新过程、新事件一次定死（只加不删，§2.8），之后 client 任务和 core 任务可以并行。

**依赖。** T00。

**拥有的文件。** `packages/contracts/src/schemas/authoring.ts`、`authoring.test.ts`（新建）；`packages/contracts/src/desktop.ts` 之外的 contracts 入口；`packages/contracts/src/errors.ts`、`schemas/works.ts`、`schemas/play.ts`、`schemas/llm.ts` 的 `PURPOSES`、`schemas/log.ts`、`events.ts`、`procedures/works.ts`、`procedures/play.ts`、`index.ts`；`packages/contracts/tsconfig.json` 的 `types`（测试用 Node 内置模块）；`packages/contracts/src/schemas/llm.test.ts`；`packages/core/src/errors.ts` 的 `HTTP_STATUS`；`packages/core/src/api/router.ts` 的 11 个临时 handler；`packages/core/src/llm/service.ts` 的 `purposeViews`；`apps/client/src/i18n/zh-CN/errors.json`；`apps/client/src/features/settings/labels.ts`、`labels.test.ts` 和 `apps/client/src/i18n/zh-CN/settings.json` 里 `author_chat` 的键。另外，**只为让类型检查通过**，允许在下列位置补新字段的默认值，不改任何逻辑：`packages/core/src/library/service.ts` 的 `getWork`、`packages/core/src/play/service.ts` 的 `turnView` 与 `getRoute`、`packages/core/src/authoring/preview-tool.ts` 的 `parsePreviewArgs` 返回值、`packages/core/src/authoring/service.ts` 的 `adoptPreview` 返回值、`apps/client/src/features/authoring/BackgroundEditor.tsx` 的查询缓存写回，以及 `apps/client/src/features/library/LibraryPage.test.tsx`、`authoring/AuthoringPage.test.tsx`、`play/PlayPage.test.tsx`、`packages/core/src/app.integration.test.ts`、`packages/core/src/library/service.test.ts` 里构造假数据或非空断言的地方。

**先读。** [创作流程 §2–3](../docs/authoring-flow.md#2-写背景只补自己在意的设置)；[数据模型 §2](../docs/data-model.md#2-作品与版本)、[§4](../docs/data-model.md#4-故事事实)；本文 §1.4 D10–D27、§2.1、§2.3；现有 `schemas/works.ts`、`schemas/play.ts`、`schemas/story.ts`、`schemas/common.ts`、`procedures/*.ts`、`events.ts`、`schemas/log.ts`。

**步骤。**

- [ ] 1. 新建 `schemas/authoring.ts`：

  ```ts
  export const SETTING_SECTION_IDS = ['world', 'protagonist', 'cast', 'secrets', 'opening', 'actions', 'scenes', 'status'] as const;
  export const CAST_MODES = ['fixed', 'per_run'] as const;
  export const HINT_MODES = ['actions_only', 'known_consequences'] as const;
  export const OPENING_MODES = ['ai', 'situation', 'author_text'] as const;
  export const WIZARD_STEPS = ['background', 'plan', 'opening'] as const;
  export const PLAN_SOURCES = ['author', 'ai', 'author_confirmed'] as const;
  export const PLAN_ITEM_KINDS = ['summary', 'entity', 'secret', 'state', 'scene', 'ending'] as const;
  export const PLAN_SUMMARY_KEYS = ['identity', 'tone', 'situation', 'world', 'public_setting'] as const;
  export const PLAN_ENTITY_ROLES = ['protagonist', 'cast', 'other'] as const;
  export const STATE_DISPLAYS = ['number', 'stage', 'list', 'text'] as const;
  export const LIST_ITEM_STATUSES = ['open', 'done', 'failed', 'gone'] as const;

  export const SETTING_TEXT_MAX_LENGTH = 10_000;
  export const PROTAGONIST_FIELDS_MAX = 8;
  export const PROTAGONIST_FIELD_NAME_MAX_LENGTH = 20;
  export const PROTAGONIST_VALUE_MAX_LENGTH = 40;
  export const PROTAGONIST_FIELD_NAME_PATTERN = /^[^{}.\s]+$/u;
  export const PLAN_TEXT_MAX_LENGTH = 1_000;
  export const PLAN_NAME_MAX_LENGTH = 40;
  export const PLAN_PROFILE_MAX_LENGTH = 300;
  export const PLAN_STATEMENT_MAX_LENGTH = 200;
  export const STATE_LABEL_MAX_LENGTH = 20;
  export const STATE_UNIT_MAX_LENGTH = 10;
  export const STATE_STAGES_MAX = 12;
  export const STATE_STAGE_NAME_MAX_LENGTH = 20;
  ```

  schema 与类型（每个 schema 都导出 `z.infer` 类型，类型名去掉 `Schema` 后缀）：

  | schema | 形状 |
  | --- | --- |
  | `CastModeSchema`、`HintModeSchema`、`OpeningModeSchema`、`WizardStepSchema`、`PlanSourceSchema`、`StateDisplaySchema`、`ListItemStatusSchema`、`SettingSectionIdSchema` | 对应常量的 `z.enum` |
  | `ProtagonistFieldSchema` | `{ name: string().trim().min(1).max(20).regex(PATTERN), defaultValue: string().trim().min(1).max(40), isName: boolean() }` |
  | `WorkSettingsSchema` | `{ world: { text }, protagonist: { text, fields: array(ProtagonistField).max(8) }, cast: { text, mode: CastMode }, secrets: { text }, opening: { text, mode: OpeningMode }, actions: { text, hints: HintMode }, scenes: { text }, status: { text } }`，`text` 都是 `string().max(SETTING_TEXT_MAX_LENGTH)`。`protagonist` 加 `superRefine`：`fields` 的 `name` 两两不同，`isName` 为真的最多一项 |
  | `DEFAULT_WORK_SETTINGS` | 八节的 `text` 都是 `''`，`fields: []`，`cast.mode: 'fixed'`，`opening.mode: 'ai'`，`actions.hints: 'actions_only'` |
  | `StateConfigSchema` | `{ min: number().finite().nullable(), max: number().finite().nullable(), unit: string().max(10).nullable(), stages: array(string().trim().min(1).max(20)).max(12) }` |
  | `PlanItemSchema` | `z.discriminatedUnion('kind', […])`，六个成员共有 `id: string().min(1).max(64)`、`source: PlanSource`：|
  | · `summary` | `key: enum(PLAN_SUMMARY_KEYS)`、`text: string().min(1).max(PLAN_TEXT_MAX_LENGTH)` |
  | · `entity` | `entityKind: EntityKindSchema`、`role: enum(PLAN_ENTITY_ROLES)`、`name: string().min(1).max(40)`、`knownAs: string().min(1).max(40).nullable()`、`profile: string().max(300)`、`slot: object({ role: string().min(1).max(100), encounter: string().min(1).max(1000) }).nullable()` |
  | · `secret` | `title: string().min(1).max(40)`、`statement: string().min(1).max(200)`、`subjectId: string().min(1).nullable()`、`knowerIds: array(string().min(1)).max(20)`、`reveal: string().max(1000)` |
  | · `state` | `key: string().min(1).max(40)`、`label: string().min(1).max(20)`、`display: StateDisplay`、`config: StateConfig`、`hidden: boolean()`、`reveal: string().max(1000)`、`initial: string().max(200).nullable()` |
  | · `scene` | `condition: string().min(1).max(1000)`、`outcome: string().min(1).max(1000)`、`once: boolean()` |
  | · `ending` | `text: string().min(1).max(1000)` |
  | `PlanConflictSchema` | `{ first: string().min(1).max(500), second: string().min(1).max(500), impact: string().min(1).max(500) }` |
  | `PlanViewSchema` | `{ items: array(PlanItem), conflicts: array(PlanConflict), confirmed: boolean() }` |
  | `PlanJobViewSchema` | `{ id: UuidSchema, status: JobStatusSchema, basedOnContentRev: ContentRevSchema, error: ErrorCodeSchema.nullable(), stale: boolean(), updatedAt: TimestampSchema }` |

  `JobStatusSchema` 在 `works.ts` 里，`authoring.ts` 从 `./works.ts` 导入它会造成循环导入（`works.ts` 也要导入 `authoring.ts`）。所以把 `JobStatusSchema` 挪到 `authoring.ts` 定义，`works.ts` 从 `authoring.ts` 导入并原样再导出（`export { JobStatusSchema, type JobStatus } from './authoring.ts';`），对外名字不变。
- [ ] 2. `schemas/works.ts`：
  - `OptionViewSchema = z.object({ text: z.string(), hint: z.string().nullable().default(null) })`，导出。`PreviewSchema.options` 改用它。
  - `PreviewSchema` 加 `needsReview: z.array(NeedsReviewSchema).default([])` 和 `initialState: z.array(z.object({ label: z.string(), text: z.string(), visible: z.boolean() })).default([])`。`NeedsReviewSchema = z.object({ where: z.enum(['prose', 'option']), index: z.number().int().positive(), text: z.string(), reason: z.enum(['hardcoded_name', 'unknown_placeholder']) })`。
  - `WorkDetailSchema.draft` 加 `settings: WorkSettingsSchema`、`wizardStep: WizardStepSchema`、`plan: PlanViewSchema.nullable()`；`WorkDetailSchema` 加 `latestPlanJob: PlanJobViewSchema.nullable()`。
  - `SaveDraftInputSchema` 加 `settings: WorkSettingsSchema.optional()`。
  - `AdoptPreviewOutputSchema` 改为 `z.object({ routeId: UuidSchema.nullable() })`（采用只发布，D20；T26 不再改它）。
  - 新增输入：`GeneratePlanInputSchema = { workId, jobId, contentRev }`；`AdoptStalePlanInputSchema = { workId, jobId }`；`UpdatePlanItemInputSchema = { workId, baseContentRev, item: PlanItemSchema }`；`RemovePlanItemInputSchema = { workId, baseContentRev, itemId: string().min(1).max(64) }`；`ConfirmPlanInputSchema = { workId, baseContentRev }`；`SetWizardStepInputSchema = { workId, step: WizardStepSchema }`。各自导出类型。
- [ ] 3. `schemas/play.ts`：
  - `TurnViewSchema.options` 改用 `OptionViewSchema`（从 `./works.ts` 导入）。
  - `RouteViewSchema` 加 `ended: z.boolean().default(false)`。
  - 新增：

    | schema | 形状 |
    | --- | --- |
    | `StartInfoSchema` | `{ workId: Uuid, title: string().nullable(), fields: array(ProtagonistField), castMode: CastMode }` |
    | `StartPlaythroughInputSchema` | `{ workId: Uuid, playthroughId: Uuid, protagonist: z.record(z.string().min(1).max(20), z.string().max(40).regex(/^[^\r\n]*$/u)) }`。值不能含换行：占位符替换进开场正文后，换行会多切出段落，开场事实的出处段号就对不上了 |
    | `OpeningRequestViewSchema` | `{ id: Uuid, status: TurnRequestStatusSchema, error: ErrorCodeSchema.nullable(), attempts: int().positive(), updatedAt: Timestamp }` |
    | `PlaythroughViewSchema` | `{ id: Uuid, workId: Uuid, workTitle: string().nullable(), routeId: Uuid.nullable(), opening: OpeningRequestView.nullable() }` |
    | `PlaythroughIdInputSchema` | `{ playthroughId: Uuid }` |
    | `RetryOpeningInputSchema` | `{ requestId: Uuid }` |
    | `StatusHistoryEntrySchema` | `{ turnId: Uuid, depth: int().nonnegative(), text: string() }` |
    | `StatusValueSchema` | `z.discriminatedUnion('display', [number: { value: number(), min: number().nullable(), max: number().nullable(), unit: string().nullable(), previous: number().nullable() }, stage: { stage: string(), step: int().positive(), total: int().positive(), previousStep: int().positive().nullable() }, list: { items: array({ item: string(), status: enum(['open', 'done', 'failed']), change: enum(['new', 'changed']).nullable() }) }, text: { value: string(), previous: string().nullable() }])`，每个成员带 `display: z.literal(...)` |
    | `StatusColumnViewSchema` | `{ id: string().min(1), label: string(), isNew: boolean(), changed: boolean(), value: StatusValue, history: array(StatusHistoryEntry) }` |
    | `StatusViewSchema` | `{ routeId: Uuid, headTurnId: Uuid, columns: array(StatusColumnView), closed: array(StatusColumnView) }` |
- [ ] 4. `schemas/llm.ts`：`PURPOSES` 改为 `['default', 'narrator', 'author_chat', 'background'] as const`。
- [ ] 5. `schemas/log.ts`：在 `client.preview_visible` 后面加一个成员 `{ ...SampleBase, metric: z.literal('client.plan_visible'), workId: UuidSchema.optional(), jobId: UuidSchema }`。
- [ ] 6. `events.ts`：加 `z.object({ type: z.literal('playthrough.updated'), playthroughId: UuidSchema, requestId: UuidSchema, status: TurnRequestStatusSchema })`。
- [ ] 7. `procedures/works.ts` 加：`generatePlan`（`GeneratePlanInput` → `PlanJobView`）、`adoptStalePlan`（→ `SaveDraftOutput`）、`updatePlanItem`（→ `SaveDraftOutput`）、`removePlanItem`（→ `SaveDraftOutput`）、`confirmPlan`（→ `SaveDraftOutput`）、`setWizardStep`（→ `z.object({})`）。`procedures/play.ts` 加：`getStartInfo`（`WorkIdInput` → `StartInfo`）、`start`（`StartPlaythroughInput` → `PlaythroughView`）、`getPlaythrough`（`PlaythroughIdInput` → `PlaythroughView`）、`retryOpening`（`RetryOpeningInput` → `PlaythroughView`）、`getStatus`（`RouteIdInput` → `StatusView`）。
- [ ] 8. `errors.ts` 加 §2.3 的四个码；`packages/core/src/errors.ts` 的 `HTTP_STATUS` 加对应状态；`apps/client/src/i18n/zh-CN/errors.json` 照抄附录 A.1。
- [ ] 8.1 `packages/core/src/api/router.ts` 给十一个新过程各挂一个临时 handler，直接 `throw appError('internal', 'not implemented: <服务>.<方法>')`。`implement(contract).router(...)` 要求全部过程都有 handler，不加这一步 T10 的 `pnpm typecheck` 不会绿。T11 把这些 handler 换成服务调用。
- [ ] 9. `index.ts` 加 `export * from './schemas/authoring.ts';`。
- [ ] 10. `author_chat` 的 client 文案：`labels.ts` 的 `PURPOSE_LABEL_KEYS`、`PURPOSE_HELP_KEYS` 加 `author_chat`；`settings.json` 加附录 A.5 的两个键；`labels.test.ts` 里 `expect(PURPOSES.length).toBe(3)` 改成 `toBe(4)`。
- [ ] 11. 跑 `pnpm typecheck`，按报错在“拥有的文件”允许的位置补默认值：`getWork` 补 `settings: DEFAULT_WORK_SETTINGS`、`wizardStep: 'background'`、`plan: null`、`latestPlanJob: null`；`turnView` 的 `options` 映射成 `{ text, hint: null }`；`getRoute` 补 `ended: false`；`parsePreviewArgs` 的 `preview` 补 `needsReview: []`、`initialState: []`，`options` 补 `hint: null`；`BackgroundEditor` 的查询缓存写回保留 `draft` 的新字段；client 三个测试的假数据函数、`app.integration.test.ts` 的非空断言、`library/service.test.ts` 的草稿期望补同样的默认值。**只补默认值或类型断言**，后续任务会写真实现。
- [ ] 12. 新建 `schemas/authoring.test.ts`：
  - `主角填写项的名字不能含花括号、点和空白`：`'名字'` 通过；`'主角.名'`、`'a b'`、`'{x}'` 失败。
  - `最多一个填写项是主角名`：两项 `isName: true` 失败；一项通过（阳性对照）。
  - `填写项名字不能重复`。
  - `方案项按 kind 区分字段`：`kind: 'entity'` 缺 `role` 失败；`kind: 'secret'` 带 `role` 时多余字段被丢弃（`z.object` 默认剥离），解析结果里没有 `role`。
  - `默认设定能通过校验`：`WorkSettingsSchema.parse(DEFAULT_WORK_SETTINGS)` 不抛错，`cast.mode === 'fixed'`、`actions.hints === 'actions_only'`（字面量）。
  - `状态值视图按显示方式区分`：`display: 'stage'` 缺 `total` 失败。
  - `填写值不能含换行`：`StartPlaythroughInputSchema` 拒绝填写值 `'阿\n\n岚'`，接受 `'阿岚'`（阳性对照）。
  - `用途列表包含 author_chat`：`PURPOSES.includes('author_chat')`，且 `PurposeSchema.parse('author_chat')` 不抛错。

**接线点。** 只定契约。core 的新过程在 T11 挂到路由上；本任务结束时 `pnpm typecheck` 必须是绿的（第 11 步保证）。

**注意事项。**

- 不删任何现有字段。`WorkDetail.routeId`、`PreviewSchema.publicSetting`、`PreviewSchema.cast` 都保留。
- `OptionViewSchema` 用 `.default(null)`，所以旧数据里没有 `hint` 的选项经 oRPC 输出校验时会补成 `null`。core 自己构造的对象要显式写 `hint`。
- 方案项的 `id` 用 `string().min(1)` 而不是 `UuidSchema`：旧数据的公开设定项 id 是 `'public_setting'`（D12）。

**完成判据。**

- `pnpm --filter @unwritten/contracts test` 通过，`pnpm typecheck` 通过。
- 突变一：删掉 `protagonist` 的 `superRefine`，`最多一个填写项是主角名` 必须红。
- 突变二：把 `PURPOSES` 改回三项，`用途列表包含 author_chat` 和 client 的 `labels.test.ts` 都必须红。
- `grep -n "author_chat" apps/client/src/i18n/zh-CN/settings.json` 有两处命中。

### T11 core：服务接口、meta、占位、路由

**目的。** 把 T10 的契约落到 core 的接口层：服务方法签名、`VersionMeta` 的新字段、读旧数据的帮助函数、全部新过程挂上路由。新方法先写占位，后续任务各自替换（§2.9）。

**依赖。** T10。

**拥有的文件。** `packages/core/src/services.ts`；`src/api/router.ts`；`src/store/meta.ts`；`src/store/plan.ts`、`plan.test.ts`（新建）；`src/store/schema.ts` 里 `jobs` 表的 `input`、`result` 两列的类型；为适配 `jobs` 类型而必须改的读取点（`library/service.ts` 的 `previewJobView`、`authoring/service.ts` 里读 `job.input`、`job.result` 的行）；`play/context.ts` 里读公开设定的那一行；`authoring/service.ts`、`library/service.ts`、`play/service.ts` 里新方法的占位。

**先读。** 本文 §2.9；T10 的全部新类型；现有 `services.ts`、`api/router.ts`、`store/meta.ts`、`store/schema.ts` 的 `jobs`。

**步骤。**

- [ ] 1. `services.ts`：

  ```ts
  export interface LibraryService {
    …现有方法…
    setWizardStep(input: SetWizardStepInput): Record<string, never>;
  }
  export interface AuthoringService {
    …现有方法…
    generatePlan(input: GeneratePlanInput): PlanJobView;
    adoptStalePlan(input: AdoptStalePlanInput): SaveDraftOutput;
    updatePlanItem(input: UpdatePlanItemInput): SaveDraftOutput;
    removePlanItem(input: RemovePlanItemInput): SaveDraftOutput;
    confirmPlan(input: ConfirmPlanInput): SaveDraftOutput;
  }
  export interface PlayService {
    …现有方法…
    getStartInfo(input: WorkIdInput): StartInfo;
    start(input: StartPlaythroughInput): PlaythroughView;
    getPlaythrough(input: PlaythroughIdInput): PlaythroughView;
    retryOpening(input: RetryOpeningInput): PlaythroughView;
    getStatus(input: RouteIdInput): StatusView;
  }
  ```

- [ ] 2. `store/meta.ts`：
  - `PlanItemSchema` 改为从 contracts 导入（删掉本文件里的同名定义；`PUBLIC_SETTING_PLAN_ITEM_ID` 保留）。
  - 新增：

    ```ts
    const rev = { rev: z.number().int().nonnegative().default(0) };
    export const StoredSettingsSchema = z.object({
      world: WorkSettingsSchema.shape.world.extend(rev),
      protagonist: WorkSettingsSchema.shape.protagonist.extend(rev),
      …其余六节同样写…
    });
    ```

    `protagonist` 带 `superRefine`，`.shape.protagonist` 拿到的是 `ZodEffects`/管道而不是对象时，改用 `z.object({ text: …, fields: …, rev })` 照 T10 的规则重写一遍，并在 `plan.test.ts` 里加一条测试证明两边接受同样的输入。
  - `StoredPlanSchema = z.object({ items: z.array(PlanItemSchema), conflicts: z.array(PlanConflictSchema).default([]), confirmedRev: z.number().int().nonnegative().nullable().default(null) })`。
  - `CastSlotSchema = z.object({ id: z.string().min(1), role: z.string(), encounter: z.string() })`；`KeySceneSchema = z.object({ id: z.string().min(1), condition: z.string(), outcome: z.string(), once: z.boolean() })`；`OpeningInitialStateSchema = z.object({ stateDefId: z.string().min(1), value: z.string().nullable(), visible: z.boolean() })`。
  - `VersionMetaSchema` 加：`settings: StoredSettingsSchema.optional()`、`plan: StoredPlanSchema.optional()`（替换旧的 `plan`）、`castSlots: z.array(CastSlotSchema).optional()`、`keyScenes: z.array(KeySceneSchema).optional()`、`ending: z.string().optional()`、`wizardStep: WizardStepSchema.optional()`；`opening` 加 `initialState: z.array(OpeningInitialStateSchema).optional()`、`createdIds: z.record(z.string(), z.string()).optional()`、`template: z.boolean().optional()`；`opening.options` 改为 `z.array(z.object({ text: z.string(), hint: z.string().nullable().default(null) }))`。
  - 方案任务：`PlanJobInputSchema = z.object({ contentRev, background, anchors: WorkAnchorsSchema.optional(), settings: WorkSettingsSchema, protectedItems: z.array(PlanItemSchema) })`；`PlanJobResultSchema = z.object({ items: z.array(PlanItemSchema), conflicts: z.array(PlanConflictSchema), language: LanguageTagSchema, stale: z.boolean() })`。
  - `PreviewJobResultSchema.adoption` 改为 `z.object({ versionId: z.string(), routeId: z.string().nullable() }).nullable()`。
  - 联合类型与取用函数：

    ```ts
    export type JobInput = PreviewJobInput | PlanJobInput;
    export type JobResult = PreviewJobResult | PlanJobResult;
    export function previewJobParts(row: { kind: string; input: JobInput; result: JobResult | null }): { input: PreviewJobInput; result: PreviewJobResult | null };
    export function planJobParts(row: …): { input: PlanJobInput; result: PlanJobResult | null };
    ```

    两个函数在 `row.kind` 不对时抛 `Error('job kind mismatch')`，否则按类型返回（内部用 `as`）。
- [ ] 3. `store/schema.ts` 的 `jobs`：`input` 改为 `.$type<JobInput>()`，`result` 改为 `.$type<JobResult>()`。然后跑 `pnpm --filter @unwritten/core typecheck`，把报错的读取点改成经 `previewJobParts(row)` 取值（预计在 `library/service.ts` 的 `previewJobView`、`authoring/service.ts` 的 `runPreviewJob`、`generatePreview`、`adoptPreview`），逻辑不变。
- [ ] 4. 新建 `store/plan.ts`：

  ```ts
  export function readSettings(meta: VersionMeta): StoredSettings;
  export function settingsView(stored: StoredSettings): WorkSettings;
  export function readPlan(meta: VersionMeta): StoredPlan | null;
  export function readPublicSetting(meta: VersionMeta): string;
  export function isPlanConfirmed(meta: VersionMeta, contentRev: number): boolean;
  export function planView(meta: VersionMeta, contentRev: number): PlanView | null;
  ```

  - `readSettings`：`meta.settings` 缺失或某一节缺失时，用 `DEFAULT_WORK_SETTINGS` 对应的节加 `rev: 0` 补齐。用 `StoredSettingsSchema.safeParse`，失败时整体回落到默认值。
  - `settingsView`：去掉每节的 `rev`。
  - `readPlan`：`meta.plan` 缺失返回 `null`。逐项处理 `items`：没有 `kind` 字段的旧项（`{ id, text, source }`）转成 `{ kind: 'summary', key: id === 'public_setting' ? 'public_setting' : 'world', id, text, source }`；其余用 `PlanItemSchema.safeParse`，失败的项丢弃。`conflicts` 缺失为 `[]`，`confirmedRev` 缺失为 `null`。
  - `readPublicSetting`：先找 `kind === 'summary' && key === 'public_setting'` 的项，再找 `key === 'world'` 的项，都没有返回 `''`。
  - `isPlanConfirmed`：`readPlan(meta)?.confirmedRev === contentRev`。
  - `planView`：`{ items, conflicts, confirmed: isPlanConfirmed(...) }`；方案为 `null` 时返回 `null`。
- [ ] 5. `play/context.ts`：`const publicSetting = input.meta.plan?.items.find(…)?.text ?? ''` 改为 `const publicSetting = readPublicSetting(input.meta)`。这是本任务在这个文件里唯一的改动。
- [ ] 6. `authoring/service.ts` 的 `adoptPreview` 里写 `plan: { items: [{ id: PUBLIC_SETTING_PLAN_ITEM_ID, text, source: 'ai' }] }` 的地方，改成新形状：`plan: { items: [{ kind: 'summary', key: 'public_setting', id: PUBLIC_SETTING_PLAN_ITEM_ID, text: preview.publicSetting, source: 'ai' }], conflicts: [], confirmedRev: null }`。T17 会重写整个函数；这里只为通过类型检查。
- [ ] 7. 占位：在 `library/service.ts`、`authoring/service.ts`、`play/service.ts` 返回的对象里，为第 1 步的每个新方法写 `throw appError('internal', 'not implemented: <服务>.<方法>')`，服务名分别是 `library`、`authoring`、`play`。
- [ ] 8. `api/router.ts`：按现有写法挂上 T10 的十一个新过程（`works` 六个、`play` 五个），每个都是一行 `handler` 调对应的服务方法。
- [ ] 9. `store/plan.test.ts`：
  - `旧的公开设定项读作 summary`：`meta.plan = { items: [{ id: 'public_setting', text: '雾港', source: 'ai' }] }`，`readPlan` 返回一项 `kind: 'summary'`、`key: 'public_setting'`；`readPublicSetting` 返回 `'雾港'`。
  - `没有设定时补默认值`：`readSettings({ background: '' })` 的 `cast.mode === 'fixed'`，`world.rev === 0`。
  - `改过草稿后方案不再算确认`：`confirmedRev: 4`，`isPlanConfirmed(meta, 4)` 为真，`isPlanConfirmed(meta, 5)` 为假。
  - `坏掉的方案项被丢弃，其余保留`。
  - 如果第 2 步重写了 `protagonist` 的存储 schema：`存储与契约对填写项的规则一致`（同一组非法输入两边都拒绝，同一组合法输入两边都接受）。

**接线点。** 十一个新过程各一行 handler（T10 已挂临时 handler，本任务把它们换成服务调用，handler 数不再增加）。`grep -c "handler(" packages/core/src/api/router.ts` 与 T10 完成后相同；`grep -rn "not implemented:" packages/core/src/api/router.ts` 零命中。

**注意事项。**

- 只改为接口和类型所必需的行。`generatePreview`、`adoptPreview` 的业务逻辑留给 T17。
- 占位只能出现在本任务第 7 步列出的方法里。

**完成判据。**

- `pnpm --filter @unwritten/core test`、`pnpm typecheck` 通过。
- 突变：把 `readPlan` 里旧项转换的分支删掉（旧项直接走 `PlanItemSchema.safeParse` 被丢弃），`旧的公开设定项读作 summary` 必须红。
- `grep -rn "not implemented:" packages/core/src | wc -l` 等于 11。

### T12 core 存储：状态栏表、事实种类、作者设定的复制、状态值校验

**目的。** 状态栏定义和状态值要能存、能按版本复制（[数据模型 §4](../docs/data-model.md#4-故事事实)）；事实种类加上 `secret`、`scene_hit`；作者设定从草稿复制到发布版本只有一份实现；栏目配置和值的校验只有一份实现，方案、预览、开局、续写共用。

**依赖。** T11。

**拥有的文件。** `packages/core/src/store/schema.ts`（新表与 `facts.kind`）；`src/store/migrations/` 下新生成的两个目录；`src/story/types.ts` 的 `FACT_KINDS`；`src/story/copy.ts`、`copy.test.ts`、`src/story/state.ts`、`state.test.ts`（新建）。

**先读。** [数据模型 §2 “怎样复制”](../docs/data-model.md#2-作品与版本)、[§4](../docs/data-model.md#4-故事事实)；现有 `store/schema.ts`、`store/migrations/20261126090202_story_indexes_fts/migration.sql`（手写迁移的写法）、`drizzle.config.ts`。

**步骤。**

- [ ] 1. `story/types.ts`：`FACT_KINDS` 改为 `['event', 'trait', 'relation', 'promise', 'secret', 'scene_hit'] as const`。
- [ ] 2. `store/schema.ts` 新增两张表，字段按[数据模型 §4](../docs/data-model.md#4-故事事实)：

  ```ts
  export const stateDefs = sqliteTable('state_defs', {
    versionId: text('version_id').notNull().references(() => workVersions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    display: text('display', { enum: STATE_DISPLAYS }).notNull(),
    config: text('config', { mode: 'json' }).$type<StateConfig>().notNull(),
    hidden: integer('hidden').notNull().default(0),
    reveal: text('reveal'),
    originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    rev: integer('rev').notNull().default(0),
  }, (table) => [primaryKey({ columns: [table.versionId, table.id] }), index('state_defs_origin_idx').on(table.versionId, table.originTurnId)]);

  export const stateValues = sqliteTable('state_values', {
    versionId: text('version_id').notNull().references(() => workVersions.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').notNull().references(() => turns.id, { onDelete: 'cascade' }),
    stateDefId: text('state_def_id').notNull(),
    value: text('value'),
    visible: integer('visible').notNull(),
    closed: integer('closed').notNull().default(0),
  }, (table) => [
    primaryKey({ columns: [table.versionId, table.turnId, table.stateDefId] }),
    foreignKey({ columns: [table.versionId, table.stateDefId], foreignColumns: [stateDefs.versionId, stateDefs.id] }).onDelete('cascade'),
  ]);
  ```

  `config` 统一用 `StateConfig` 形状（四个字段都在，不用的为 `null` 或 `[]`）。
- [ ] 3. 生成迁移：`pnpm --filter @unwritten/core db:generate`，得到一个建两张表的目录。再 `pnpm --filter @unwritten/core exec drizzle-kit generate --custom --name=state_indexes`，在生成的 `migration.sql` 里写：

  ```sql
  CREATE UNIQUE INDEX `state_defs_key_by_origin` ON `state_defs` (`version_id`, `key`, ifnull(`origin_turn_id`, ''));
  ```

  这是手写迁移里唯一允许人写的内容，不加注释。
- [ ] 4. 新建 `story/copy.ts`：

  ```ts
  export function copyAuthorSetting(tx: Pick<Database, 'run'>, input: { fromVersionId: string; toVersionId: string }): void;
  export function clearAuthorSetting(tx: Pick<Database, 'run'>, versionId: string): void;
  ```

  - `copyAuthorSetting`：对 `entities`、`entity_names`、`facts`、`knowledge`、`state_defs` 五张表各写一条 `insert into <表> (<全部列>) select <全部列，version_id 换成 :to> from <表> where version_id = :from and origin_turn_id is null`。列名一个个写出来，不用 `select *`。
  - `clearAuthorSetting`：五张表各一条 `delete from <表> where version_id = :v and origin_turn_id is null`，顺序是 `knowledge`、`entity_names`、`facts`、`state_defs`、`entities`。
- [ ] 5. 新建 `story/state.ts`：

  ```ts
  export type StateCheck<T> = { ok: true; value: T } | { ok: false; error: string };
  export function checkStateConfig(display: StateDisplay, config: StateConfig): StateCheck<StateConfig>;
  export function checkStateValue(def: { display: StateDisplay; config: StateConfig }, raw: string): StateCheck<string>;
  export interface ListEntry { item: string; status: ListItemStatus }
  export function parseListValue(value: string | null): ListEntry[];
  export function mergeListItems(previous: string | null, changes: ListEntry[]): string;
  export function stageIndex(config: StateConfig, value: string): number;
  ```

  规则（错误文字给模型看，照抄）：

  | 显示方式 | `checkStateConfig` | `checkStateValue` |
  | --- | --- | --- |
  | `number` | `stages` 必须为空；`min`、`max` 同时给出时 `min < max`，否则“数字栏目的 min 必须小于 max。”；`unit` 不超过 10 个字 | 去掉首尾空白后匹配 `/^-?\d+(\.\d+)?$/`，否则“数字栏目的值必须是十进制数字。”；小于 `min` 或大于 `max` 时“值超出了 min 到 max 的范围。”。返回规范化后的数字字符串（`String(Number(raw))`） |
  | `stage` | `stages` 至少两项、两两不同，否则“阶段栏目至少要有两个不同的阶段名。”；`min`、`max`、`unit` 必须为 `null` | 必须等于 `stages` 中的一项，否则“阶段栏目的值必须是这些阶段之一：<用、连接>。” |
  | `list` | `min`、`max`、`unit` 为 `null`，`stages` 为空 | 不接受直接写值：“清单栏目用 state_item 改条目，不写 value。” |
  | `text` | 同 `list` | 非空，不超过 200 个字，否则“文字栏目的值不能为空，也不能超过 200 个字。” |

  - `parseListValue`：`null` → `[]`；否则 `JSON.parse` 后用 `z.array(z.object({ item, status }))` 校验，失败返回 `[]`。
  - `mergeListItems`：按 `item` 原文合并，已有的条目改状态，没有的追加到末尾；返回 `JSON.stringify` 后的整张清单（[数据模型 §4 “清单按条目合并”](../docs/data-model.md#4-故事事实)）。
  - `stageIndex`：返回 `value` 在 `stages` 里的下标，找不到返回 `-1`。
- [ ] 6. 测试：
  - `copy.test.ts`（临时库，`openDatabase`）：造一个草稿版本，插作者设定的实体、称呼、事实（含一条 `secret`）、知情、栏目各一行，再各插一行 `origin_turn_id` 不为空的行（要先造一个开局和回合）。`copyAuthorSetting` 到一个新版本后：新版本里每张表正好有作者设定那一行，`id` 和原来相同；游玩产生的那一行没有被复制（阳性对照：源版本里它确实存在）。`clearAuthorSetting` 后源版本的作者设定行都没了，游玩产生的行还在。
  - `state.test.ts`：每个显示方式的合法与非法例子各至少一条；`mergeListItems` 的三种情况：追加新条目、改已有条目的状态、`previous` 为 `null`；`数字值按范围拒绝`（`min: 0, max: 10`，`'12'` 拒绝、`'10'` 通过，两个数写字面量）。
  - 迁移：`state_values 随回合删除`：插一个回合和它的一条状态值，删回合后状态值没了。`state_defs 同一来源下 key 唯一`：同一版本、都是作者设定的两条同 key 栏目，第二条插入抛错；一条作者设定、一条来自回合的同 key 栏目可以共存。

**接线点。** 无（T15、T16、T17、T18 调用这些函数）。

**注意事项。**

- `facts.kind` 在 SQLite 里是普通 `TEXT`，改枚举不需要迁移；只有新表需要。
- 迁移文件是 drizzle-kit 生成的，生成部分不要手改；只在 `--custom` 生成的空文件里写那一行索引。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `copyAuthorSetting` 里 `state_defs` 那条的 `and origin_turn_id is null` 删掉，`copy.test.ts` 的阳性对照部分必须红。
- 突变二：在临时新库上去掉 `state_defs_key_by_origin` 索引（直接改那个手写迁移，测完改回），`state_defs 同一来源下 key 唯一` 必须红。
- 突变三：把 `checkStateValue` 的数字范围检查删掉，`数字值按范围拒绝` 必须红。

### T13 core：补充设定保存与向导步骤

**目的。** 草稿除了背景和锚点，还保存八节补充设定（D10），每节有自己的修订号；向导停在哪一步单独保存，不计入 `content_rev`（[数据模型 §2](../docs/data-model.md#2-作品与版本)）。作品详情返回设定、方案和最近一次方案任务；作品库卡片指向最近游玩的路线。

**依赖。** T11。

**拥有的文件。** `packages/core/src/library/service.ts`（`saveDraft`、`getWork`、`setWizardStep`、`summarize`、新增的 `planJobView`）及 `library/service.test.ts`。

**先读。** [数据模型 §2 “未发布的修改”](../docs/data-model.md#2-作品与版本)、[§3 “最近游玩的路线”](../docs/data-model.md#3-经历开局回合树路线存档)；T11 的 `store/plan.ts`；现有 `library/service.ts`。

**步骤。**

- [ ] 1. `saveDraft(input)`：
  1. 现有的 `unchanged` 判断加上设定：`input.settings` 缺省时视为“设定没变”；给了时逐节比较 `JSON.stringify(settingsView 的那一节)` 与 `JSON.stringify(input.settings 的那一节)`，得出 `changedSections: SettingSectionId[]`。
  2. 背景、锚点没变且 `changedSections` 为空 → 返回当前 `contentRev`，不写库，不发事件（现有行为）。
  3. 否则：`input.settings` 先用 `WorkSettingsSchema.parse` 校验（契约已经校验过，这里按 core AGENTS“读写同一 schema”再过一遍），新的 `meta.settings` 是旧的存储值逐节替换：变了的节写新内容、`rev` 加一，没变的节原样保留。
  4. 事件 `work.draft.saved` 的 `data` 加 `sections: changedSections`。
- [ ] 2. `setWizardStep(input)`：一个 `immediate` 事务：作品存在、未发布（已发布时直接返回 `{}`，不报错：发布后创作页只显示已发布面板）；`meta.wizardStep` 已经等于 `input.step` 时返回 `{}`；否则只改 `meta.wizardStep`，**不改** `content_rev` 和 `works.updated_at`。提交后记 `work.wizard_step`（`debug`，`data: { step }`），不发 `works.changed`：步骤不影响作品库，也不影响别的页面。
- [ ] 3. `getWork`：把 T10 补的默认值换成真实值：`draft.settings = settingsView(readSettings(meta))`；`draft.wizardStep = meta.wizardStep ?? 'background'`；`draft.plan = planView(meta, draft.contentRev)`；`latestPlanJob` 取 `kind = 'plan'` 的最近一个任务，用新函数 `planJobView(row)`：`{ id, status, basedOnContentRev: input.contentRev, error, stale: result?.stale ?? false, updatedAt }`（经 `planJobParts`）。
- [ ] 4. `summarize`：`routeId` 改为“发布版本的 `kind = 'play'` 开局下 `updated_at` 最大的路线”，`hasProgress` 为“这条路线的 head 不是它所属开局的根回合”。发布了但还没有任何开局时 `routeId: null`、`hasProgress: false`（client 据此显示「开始故事」，T24）。
- [ ] 5. 测试（`library/service.test.ts` 补）：
  - `保存补充设定只给改了的节加修订号`：先存一次设定，再只改 `cast.mode`；读回 `meta.settings.cast.rev === 1`、`world.rev === 0`；`content_rev` 加一；事件 `work.draft.saved` 的 `data.sections` 等于 `['cast']`。
  - `不带设定的旧请求保留已有设定`：存过设定后，用不带 `settings` 的请求改背景，读回的设定不变。
  - `设定没变不加修订号`。
  - `切换向导步骤不改修订号`：`setWizardStep` 后 `content_rev` 不变，`getWork().draft.wizardStep === 'plan'`（字面量）。
  - `作品库卡片指向最近游玩的路线`：一个发布版本下两个开局，第二个路线的 `updated_at` 更大，`list()` 里该作品的 `routeId` 是第二条。阳性对照：只有一个开局时指向它。
  - `发布了但还没开局时没有路线`。

**接线点。** `setWizardStep` 由 T11 的路由调用；`getWork` 的新字段由 client 读取（T21–T23）。

**注意事项。**

- 改设定会让 `content_rev` 加一，因此已确认的方案自动回到未确认（D16），预览也会过期。这是预期行为，不需要额外代码。
- 不要在 `setWizardStep` 里发 `works.changed`：它会让所有标签页重取作品详情，打断正在编辑的输入。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把第 1 步第 3 小步改成所有节都 `rev` 加一，`保存补充设定只给改了的节加修订号` 必须红。
- 突变二：让 `setWizardStep` 顺带 `contentRev + 1`，`切换向导步骤不改修订号` 必须红。
- `grep -n "not implemented: library" packages/core/src/library/service.ts` 零命中。

---
### T14 core：方案生成任务

**目的。** 「生成故事方案」在后台运行，用 `author_chat` 用途的模型读背景、锚点和补充设定，交出一份分项的方案（[创作流程 §3](../docs/authoring-flow.md#3-确认故事方案再生成开场)、[创作工作站 §9](../docs/author-workstation.md#9-生成任务)）。作者写过的项受保护（D13），冲突原话逐字核对（D14），生成期间草稿改过时不覆盖（D15）。

**依赖。** T12（`story/state.ts`）、T13（`readSettings` 与 `getWork` 的方案字段）。

**拥有的文件。** `packages/core/src/authoring/plan-prompt.ts`、`plan-tool.ts`、`plan-job.ts` 及各自的测试（新建）；`authoring/service.ts` 里 `generatePlan`、`adoptStalePlan` 两个占位换成调用，`recoverInterrupted` 的 SQL，`whenIdle`；`test-support/llm-steps.ts` 的 `proposePlanStep`。

**先读。** [创作工作站 §8–9](../docs/author-workstation.md#8-冲突处理)；本文 §1.4 D12–D16、附录 B.1、C.1、C.2；现有 `authoring/service.ts` 的 `generatePreview`、`runPreviewJob`（照它的结构写）、`authoring/preview-tool.ts` 的 `parsePreviewArgs`（照它的错误收集写法）。

**步骤。**

- [ ] 1. `plan-prompt.ts`：导出附录 B.1 的 `PLAN_SYSTEM_PROMPT`，和

  ```ts
  export function buildPlanPrompt(input: {
    background: string;
    anchors: WorkAnchors;
    settings: WorkSettings;
    protectedItems: PlanItem[];
  }): string;
  ```

  格式见附录 C.2。空的节不出现；`protectedItems` 为空时不出现【作者已确定的项】。
- [ ] 2. `plan-tool.ts`：

  ```ts
  export const PROPOSE_PLAN_TOOL_NAME = 'propose_plan';
  export const PLAN_LIMITS = { entitiesMax: 30, secretsMax: 20, statesMax: 12, scenesMax: 12, conflictsMax: 5 } as const;
  export const PROPOSE_PLAN_PARAMETERS = { …附录 C.1… } as const;
  export type PlanField = 'language' | 'summary' | 'entities' | 'secrets' | 'state' | 'scenes' | 'ending' | 'conflicts';
  export interface PlanParseContext { castMode: CastMode; protectedItems: PlanItem[]; authorTexts: string[]; newId: () => string }
  export type PlanParse =
    | { ok: true; value: { items: PlanItem[]; conflicts: PlanConflict[]; language: string; droppedConflicts: number } }
    | { ok: false; errors: string[]; fields: PlanField[] };
  export function parsePlanArgs(args: Record<string, unknown>, ctx: PlanParseContext): PlanParse;
  ```

  逐个参数解析（每行一个 JSON 用 `text/turn-text.ts` 的 `parseJsonLines`），每条错误写成“第 N 行 <参数>.<字段>：原因”，照附录 C.1 给出的错误文字：
  1. `language`：`LanguageTagSchema` 校验。
  2. `summary`：`key` 只能是 `identity`、`tone`、`situation`、`world`（`public_setting` 由预览产生，这里不接受）；同一个 `key` 最多一行；`text` 1–1000 字；`from` 只能是 `author` 或 `ai`。`identity`、`situation` 两项必须有（来自本次或受保护的项）。
  3. `entities`：字段 `ref`（可选，本次内唯一，不能以 `@` 或 `#` 开头）、`kind`、`role`、`name`、`known_as`（可选）、`profile`（可选）、`slot_role`、`encounter`、`from`。规则：
     - `role: 'protagonist'` 必须是 `character`；本次加受保护的项里**恰好一个**主角。
     - `castMode === 'per_run'` 且 `role: 'cast'`：`slot_role`、`encounter` 必填，存成 `slot: { role, encounter }`；`name` 写成这个人物位置的称呼（例如“旧友”）。
     - `castMode === 'fixed'`：带 `slot_role` 或 `encounter` 时报错“固定主要角色的作品不写 slot_role 和 encounter。”。
     - 同一种 `kind` 里名字不能重复；和受保护的同类实体同名的行直接丢弃，不报错（作者设定优先）。
     - 总数不超过 `PLAN_LIMITS.entitiesMax`（受保护的也算）。
  4. `secrets`：`title`、`statement`、`subject`（可选）、`knowers`（可选，逗号分隔）、`reveal`（可选）、`from`。`subject` 和每个 `knower` 按“本次的 `ref` → 本次的 `name` → 受保护实体的 `name`”的顺序解析成实体项的 `id`；`knower` 必须是 `character`。找不到时报错并列出可用的名字。
  5. `state`：`key`（匹配 `/^[\p{L}\p{N}_]{1,40}$/u`，本次加受保护的项里唯一）、`label`、`display`、`min`、`max`、`unit`、`stages`（用 `|` 分隔）、`hidden`（`"true"` / `"false"`，缺省 `false`）、`reveal`、`initial`、`from`。组装成 `StateConfig` 后调用 `checkStateConfig`；`initial` 非空时，`display` 不是 `list` 就调用 `checkStateValue`，是 `list` 时报错“清单栏目的 initial 留空。”。
  6. `scenes`：`condition`、`outcome`、`once`（`"true"` / `"false"`，缺省 `true`）、`from`。
  7. `ending`：普通字符串，去掉首尾空白后为空表示开放式作品；非空时最多 1000 字，生成一个 `ending` 项。受保护的项里已经有 `ending` 时，忽略本次的值。
  8. `conflicts`：`first`、`second`、`impact`。把作者文本 `ctx.authorTexts` 和两段原话都按“连续空白合成一个空格、去掉首尾空白”规范化，两段都能在某一份作者文本里找到才保留；找不到的计入 `droppedConflicts`，不报错。最多保留 `PLAN_LIMITS.conflictsMax` 条。
  9. 每个新项的 `id` 用 `ctx.newId()`；`source` 是 `from` 映射来的 `author` 或 `ai`。
  10. 结果的 `items` 顺序：受保护的项和本次的项合在一起后，按 `summary`（按 `PLAN_SUMMARY_KEYS` 的顺序）、`entity`（主角在前）、`secret`、`state`、`scene`、`ending` 排。
- [ ] 3. `plan-job.ts`：

  ```ts
  export interface PlanJobs {
    generatePlan(input: GeneratePlanInput): PlanJobView;
    adoptStalePlan(input: AdoptStalePlanInput): SaveDraftOutput;
    recover(): number;
    whenIdle(): Promise<void>;
  }
  export function createPlanJobs(deps: CoreDeps & { llm: LlmService }): PlanJobs;
  export const PLAN_CONCURRENCY = 1;
  export const PLAN_MAX_CORRECTIONS = 2;
  ```

  - `generatePlan(input)`：结构照 `generatePreview`：
    1. 一个 `immediate` 事务：同一 `jobId` 已存在时，`workId` 和 `contentRev` 都相同就返回已有视图，否则 `idempotency_conflict`。作品不存在 → `not_found`；已发布 → `already_published`；草稿 `contentRev` 不等于输入 → `stale_revision`；背景为空 → `background_required`；已有 `running` 的 `plan` 任务 → `job_running`；`deps.llm.resolve('author_chat')` 为空 → `llm_not_configured`。
    2. 冻结输入：`{ contentRev, background, anchors: readAnchors(meta), settings: settingsView(readSettings(meta)), protectedItems: readPlan(meta)?.items.filter((item) => item.source !== 'ai') ?? [] }`，插入 `kind: 'plan'` 的任务。
    3. 提交后发 `job.updated`（`running`），记 `plan.job.started`，把 `runPlanJob` 加进队列。
  - `runPlanJob(jobId, startedAt)`：结构照 `runPreviewJob`，差别：
    - 用途 `author_chat`，系统提示 `PLAN_SYSTEM_PROMPT`，提示 `buildPlanPrompt(job.input)`，工具 `propose_plan`，`requiredToolName: PROPOSE_PLAN_TOOL_NAME`，`sessionId: workId`，`ref: { kind: 'job', id: jobId, attempt: 1, workId }`。
    - 工具的 `execute` 调 `parsePlanArgs(args, { castMode: input.settings.cast.mode, protectedItems: input.protectedItems, authorTexts: [input.background, 三段锚点, 八节的 text], newId: randomUUID })`；记 `plan.validate` 样本；不通过时最多修正 `PLAN_MAX_CORRECTIONS` 次（同预览的写法）。
    - 提交事务（`immediate`）：重读作品和草稿。作品已发布或已删除 → 把任务标为 `failed`、`interrupted`。草稿 `contentRev === input.contentRev`：写 `meta.plan = { items, conflicts, confirmedRev: null }`；`meta.narration` 不存在时写 `{ language }`；`meta.wizardStep = 'plan'`；`content_rev` 加一；任务 `done`，`result = { items, conflicts, language, stale: false }`。否则（作者改过草稿）：草稿不动，任务 `done`，`result = { …, stale: true }`。
    - 提交后：发 `job.updated`（`done`）；`stale: false` 时再发 `works.changed`；记 `plan.job.done`（`data: { items, conflicts, stale }`）和 `plan.commit`、`plan.total` 样本。
    - 失败路径完全照 `runPreviewJob`，事件名换成 `plan.job.failed`，样本换成 `plan.*`。
  - `adoptStalePlan(input)`：`immediate` 事务：任务存在、属于该作品、`kind === 'plan'`、`status === 'done'`、`result.stale === true`，否则 `not_found` 或 `stale_revision`。作品已发布 → `already_published`。读草稿当前方案的受保护项 `protectedNow`；新方案的 `items` = `protectedNow` + 任务结果里与 `protectedNow` 不重复（按 T14 第 2 步第 3、5、7 点的同名规则判断）的项，按第 2 步第 10 点排序；写 `meta.plan`（`confirmedRev: null`）、`wizardStep: 'plan'`，`content_rev` 加一；把任务的 `result.stale` 改成 `false`。提交后发 `works.changed`，记 `plan.adopted_stale`。返回新的 `contentRev`。
  - `recover()`：不在这里写 SQL；见第 4 步。
- [ ] 4. `authoring/service.ts`：
  - 在 `createAuthoringService` 里 `const planJobs = createPlanJobs(deps);`，`generatePlan`、`adoptStalePlan` 两个占位换成 `planJobs.generatePlan(input)`、`planJobs.adoptStalePlan(input)`。
  - `recoverInterrupted` 的 SQL 把 `and kind = 'preview'` 改成 `and kind in ('preview', 'plan')`，`returning` 加上 `kind`；记事件时按 `kind` 用 `preview.job.failed` 或 `plan.job.failed`。
  - `whenIdle` 改成 `Promise.all([queue.onIdle(), planJobs.whenIdle()]).then(() => undefined)`。
- [ ] 5. `test-support/llm-steps.ts` 加：

  ```ts
  export function proposePlanStep(input: {
    language?: string;
    summary?: Array<Record<string, string>>;
    entities?: Array<Record<string, string>>;
    secrets?: Array<Record<string, string>>;
    state?: Array<Record<string, string>>;
    scenes?: Array<Record<string, string>>;
    ending?: string;
    conflicts?: Array<Record<string, string>>;
  }): FakeStep;
  ```

  每个数组用 `changeLines` 拼成每行一个 JSON；缺省时 `language: 'zh-CN'`，`summary` 给 `identity` 和 `situation` 两行（附录 D.1 的文字），`entities` 给一行主角，其余为空字符串。
- [ ] 6. 测试：
  - `plan-tool.test.ts`（纯函数）：
    - `恰好一个主角`：零个、两个都报错，一个通过（阳性对照）。
    - `每局生成的人物位置必须写作用和相遇样例`；`固定人物的作品不写人物位置`。
    - `秘密的知情者必须是人物`：`knowers` 指向一个地点时报错。
    - `栏目配置按显示方式校验`：`display: 'number'`、`min: '10'`、`max: '0'` 报错；`stages: '起点'`（只有一个阶段）报错。
    - `受保护的项优先`：受保护的实体“灯塔看守”和本次同名同类的一行，结果里只有受保护的那一项，`source` 仍是 `author`。
    - `冲突原话逐字核对`：作者背景里有“她从不离开岛”和“她每年冬天去城里”，一条冲突引用这两句（中间多一个空格）保留；另一条引用“她讨厌海”被丢弃，`droppedConflicts === 1`。
    - `重复的 summary key 报错`。
  - `plan-job.test.ts`（`createScriptedLlm`，临时库）：
    - `生成方案写进草稿并进入方案步骤`：`generatePlan` 后 `whenIdle`，`getWork` 的 `draft.plan.items` 里有一个 `role: 'protagonist'` 的实体，`draft.wizardStep === 'plan'`，`contentRev` 比生成前大 1，`scriptedLlm.runs[0].purpose === 'author_chat'`（字面量）。
    - `生成期间改过草稿时不覆盖`：用一个自定义步骤，在返回方案之前调 `saveDraft` 改背景；完成后 `draft.plan` 仍为 `null`，`latestPlanJob.stale === true`。然后 `adoptStalePlan`，`draft.plan` 有内容，`latestPlanJob.stale === false`。
    - `重新生成保留作者改过的项`：先生成一次，用 SQL 把某个 `summary` 项的 `source` 改成 `author`、`text` 改成别的；再生成一次，模型给出同一个 `key` 的新文字；结果里那一项仍是作者的文字。
    - `author_chat 没有配置时拒绝`：`setResolved(null)` 后 `generatePlan` 抛 `llm_not_configured`。
    - `重启时运行中的方案任务标为中断`：插一条 `running` 的 `plan` 任务，调 `authoring.recoverInterrupted()`，任务变为 `failed`、`interrupted`，诊断里有 `plan.job.failed`。
    - `不合格的提案修正两次后失败`：连续三次交只有一行地点、没有主角的 `entities`；任务 `failed`、`invalid_output`，`plan.job.failed` 的 `data.fields` 含 `entities`。

**接线点。** `authoring/service.ts` 两个方法各一行、`recoverInterrupted` 一处、`whenIdle` 一处；路由已由 T11 接好。

**注意事项。**

- 方案只交给作者自己看，所以可以带秘密原文；但诊断只记条数。
- `plan` 任务和 `preview` 任务各有自己的“同一作品同时只运行一个”的检查，互不阻塞。
- `knowers`、`subject` 在方案里存的是实体项的 `id`，不是名字：作者改了人物名字，秘密的指向不会断。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `parsePlanArgs` 里受保护同名实体“直接丢弃”的判断删掉，`受保护的项优先` 必须红（结果里会出现两项，或者同名报错）。
- 突变二：把提交事务里的 `contentRev === input.contentRev` 比较改成恒为真，`生成期间改过草稿时不覆盖` 必须红。
- 突变三：把冲突核对改成只核对 `first`，`冲突原话逐字核对` 必须红。
- `grep -n "not implemented: authoring.generatePlan\|not implemented: authoring.adoptStalePlan" packages/core/src` 零命中。

### T15 core：方案编辑与确认

**目的。** 作者可以直接改方案的一项、删一项（[创作流程 §3 第 3 步](../docs/authoring-flow.md#3-确认故事方案再生成开场)）。确认方案时，一个事务把方案写成草稿里的结构化设定：人物、秘密、状态栏定义进故事事实表，关键场面、结束条件、人物位置进 `meta`（D17）。

**依赖。** T12（`copy.ts` 的 `clearAuthorSetting`、`state.ts`）、T13。

**拥有的文件。** `packages/core/src/authoring/plan-edit.ts`、`plan-edit.test.ts`（新建）；`authoring/service.ts` 里 `updatePlanItem`、`removePlanItem`、`confirmPlan` 三个占位换成调用。

**先读。** [数据模型 §2](../docs/data-model.md#2-作品与版本)、[§4](../docs/data-model.md#4-故事事实)；本文 §1.4 D16、D17；T12 的 `copy.ts`、`state.ts`；现有 `story/writer.ts`（列名写法）。

**步骤。**

- [ ] 1. `plan-edit.ts`：

  ```ts
  export function updatePlanItem(deps: CoreDeps, input: UpdatePlanItemInput): SaveDraftOutput;
  export function removePlanItem(deps: CoreDeps, input: RemovePlanItemInput): SaveDraftOutput;
  export function confirmPlan(deps: CoreDeps, input: ConfirmPlanInput): SaveDraftOutput;
  ```

  三个函数共用的前置检查写成一个内部函数 `loadEditableDraft(tx, workId, baseContentRev)`：作品存在（`not_found`）、未发布（`already_published`）、`contentRev === baseContentRev`（`stale_revision`）、方案存在（`plan_not_confirmed`，因为还没有可编辑的方案）。返回 `{ work, draft, meta, plan }`。
- [ ] 2. `updatePlanItem`：
  1. 找到同 `id` 的项，`kind` 必须相同，否则 `invalid_input`。
  2. 按 `kind` 再校验：`state` 调 `checkStateConfig`，`initial` 非空时调 `checkStateValue`；`secret` 的 `subjectId`、每个 `knowerIds` 必须是方案里现有实体项的 `id`，知情者必须是 `character`；`entity` 改成 `role: 'protagonist'` 时，原来的主角必须就是这一项（主角不能“移交”）；`castMode === 'per_run'` 的 `cast` 实体必须有 `slot`。任何一条不满足 → `invalid_input`。
  3. 新项的 `source` 一律写成 `author`（作者亲手改过的项受保护）。
  4. 写回 `meta.plan.items`（`confirmedRev` 不动，`content_rev` 加一后它自然不再相等，D16），`content_rev` 加一，`works.updated_at` 更新。
  5. 提交后发 `works.changed`，记 `plan.item.updated`（`data: { kind }`）。
- [ ] 3. `removePlanItem`：主角实体项不能删（`invalid_input`）。删实体项时，同时把引用它的秘密的 `subjectId` 置为 `null`、从 `knowerIds` 里去掉它。其余同上，事件 `plan.item.removed`。
- [ ] 4. `confirmPlan`：
  1. 校验：恰好一个主角实体项；`per_run` 时每个 `role: 'cast'` 的实体项都有 `slot`。不满足 → `invalid_input`。
  2. 计算 `nextRev = draft.contentRev + 1`。
  3. `clearAuthorSetting(tx, draft.id)`。
  4. 写实体（`origin_turn_id` 为空，`id` 用方案项的 `id`）：主角（`is_protagonist = 1`）；`fixed` 模式下全部 `cast` 和 `other`；`per_run` 模式下只写 `other`，`cast` 项转成 `meta.castSlots = [{ id: 项.id, role: slot.role, encounter: slot.encounter }]`。`profile` 存 `{ text: 项.profile }`。
  5. 写称呼（`origin_turn_id`、`source_para` 都为空，`holder_id` 为主角 id）：主角自己的名字一条；写进实体表的每个实体，`knownAs` 不为空时一条。
  6. 写秘密：每个 `secret` 项一条 `facts`（`id` 用项的 `id`、`kind: 'secret'`、`subject_id`、`statement`、`data: { title, reveal }`、`key: null`）；每个知情者一条 `knowledge`（`level: 'confirmed'`）。`per_run` 模式下指向人物位置（没写进实体表）的 `subjectId`、知情者跳过，不报错。
  7. 写栏目：每个 `state` 项一条 `state_defs`（`id` 用项的 `id`、`hidden` 写 `1` / `0`）。
  8. `meta.keyScenes = scene 项.map(({ id, condition, outcome, once }) => …)`；`meta.ending = ending 项?.text`（没有就删掉这个键）；`meta.plan.confirmedRev = nextRev`；`meta.wizardStep = 'opening'`；`content_rev = nextRev`。
  9. 提交后发 `works.changed`，记 `plan.confirmed`（四个计数和 `castMode`）与 `plan.confirm` 样本。返回 `{ contentRev: nextRev }`。
- [ ] 5. `authoring/service.ts`：三个占位换成 `updatePlanItem(deps, input)` 等调用。
- [ ] 6. `plan-edit.test.ts`（临时库；用 T14 的 `proposePlanStep` 走一遍 `generatePlan` 得到方案，或直接用 SQL 写 `meta.plan`）：
  - `改一项后来源变成作者，方案回到未确认`：确认后改一项，`getWork().draft.plan.confirmed === false`，该项 `source === 'author'`。
  - `不能删除主角`。
  - `删除人物时清掉秘密里的引用`。
  - `确认方案写出结构化设定`：方案含主角、一个固定人物（`knownAs: '守灯人'`）、一个地点、一个秘密（主角不知情、人物知情）、一个数字栏目、一个关键场面、结束条件。确认后：`entities` 里三行、都是作者设定、`id` 与方案项相同；主角持有“守灯人”这个称呼；`facts` 里一条 `kind = 'secret'`；`knowledge` 里人物有一条 `confirmed`、主角没有；`state_defs` 一条；`meta.keyScenes` 一条、`meta.ending` 为结束条件原文；`meta.wizardStep === 'opening'`。
  - `每局生成的人物写成人物位置`：`castMode: 'per_run'` 时，人物不进 `entities`，`meta.castSlots` 有一项，`role`、`encounter` 与方案一致。
  - `重复确认会重写，不会累加`：确认两次（中间不改），`entities` 仍是三行。
  - `草稿改过后确认被拒`：`baseContentRev` 过期时抛 `stale_revision`。

**接线点。** `authoring/service.ts` 三行。

**注意事项。**

- 确认会删掉草稿里全部作者设定的故事事实行。M1、M2 的作品都已发布，`loadEditableDraft` 会拒绝；所以不会误删已发布作品的设定。
- `confirmPlan` 不启动开场生成。client 收到返回后再调 `generatePreview`（T23）。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：去掉第 4 步第 3 小步的 `clearAuthorSetting`，`重复确认会重写，不会累加` 必须红（会撞主键或变成六行）。
- 突变二：让 `per_run` 模式也把 `cast` 写进 `entities`，`每局生成的人物写成人物位置` 必须红。
- 突变三：把 `updatePlanItem` 写回的 `source` 保持原值，`改一项后来源变成作者` 必须红。
- `grep -n "not implemented: authoring.updatePlanItem\|not implemented: authoring.removePlanItem\|not implemented: authoring.confirmPlan" packages/core/src` 零命中。T14 和本任务都合并后，`grep -n "not implemented: authoring" packages/core/src` 也应零命中（T11 只给五个方案方法写了占位）。

### T16 core story：状态栏、秘密、关键场面、新的 `changes` 类型

**目的。** 故事事实层要认识三样新东西：状态栏（定义与值）、秘密、关键场面的触发。投影能读到它们，`changes` 能写它们，泄露检查覆盖提醒和显示中的状态值，client 能拿到主角视角的状态栏（[数据模型 §4–5](../docs/data-model.md#4-故事事实)、[回合循环 §5–6](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。这些都是纯故事层，不知道模型和接口的存在。

**依赖。** T12。

**拥有的文件。** `packages/core/src/story/types.ts`、`projection.ts`、`changes.ts`、`writer.ts`、`leak.ts`、`journal.ts`、`render.ts`、`status.ts`（新建）及各自测试；`packages/core/src/text/turn-text.ts` 的 `parseOptionLines`；`test-support/story-fixtures.ts`。

**先读。** [数据模型 §4–5](../docs/data-model.md#4-故事事实)；[回合循环 §5–6](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)；本文 §1.4 D24、D26、附录 C.3、C.4；`packages/core/AGENTS.md` §5“新增一种 changes 类型”；现有 `story/` 全部文件。

**步骤。**

- [ ] 1. `types.ts`：

  ```ts
  export interface ProjStateDef { id: string; key: string; label: string; display: StateDisplay; config: StateConfig; hidden: boolean; reveal: string | null; originTurnId: string | null; originDepth: number }
  export interface ProjStateValue { stateDefId: string; turnId: string; depth: number; value: string | null; visible: boolean; closed: boolean }
  ```

  `StoryProjection` 加 `stateDefs: Map<string, ProjStateDef>`、`stateValues: ProjStateValue[]`（链上全部状态值，按 `depth` 升序）。

  `changes` 的新类型：

  ```ts
  export const StateChangeSchema = z.object({ line, stateDef: z.union([z.object({ existing: z.string() }), z.object({ created: z.number().int().positive() })]), value: z.string().nullable(), visible: z.boolean().nullable(), closed: z.boolean().nullable() });
  export const StateItemChangeSchema = z.object({ line, stateDef: 同上, item: z.string().min(1), status: ListItemStatusSchema });
  export const NewStateChangeSchema = z.object({ line, key, label, display: StateDisplaySchema, config: StateConfigSchema, hidden: z.boolean() });
  export const SecretChangeSchema = z.object({ line, subject: EntityRefSchema.nullable(), title, statement, reveal: z.string(), knowers: z.array(EntityRefSchema), para });
  export const SceneHitChangeSchema = z.object({ line, sceneId: z.string().min(1), para });
  ```

  `ValidatedChangesSchema` 加 `states`、`stateItems`、`newStates`、`secrets`、`sceneHits` 五个数组，**每个都 `.default([])`**；`NewEntityChangeSchema` 加 `slot: z.string().nullable().default(null)`。`EMPTY_CHANGES` 补上五个空数组。旧数据里存下的 `changes` 没有这些字段：凡是读 `meta.opening.changes` 或任务结果里 `changes` 的地方，一律先 `ValidatedChangesSchema.parse` 再用（T17、T18 照此写）。
- [ ] 2. `projection.ts`：先让 `loadProjection` 支持 `chain: []`——这时只取作者设定的行（`origin_turn_id` 为空），`headTurnId` 为 `''`。按方案生成开场（T17）和每局生成开局（T18）都要在没有回合的版本上建投影。Drizzle 的 `inArray(列, [])` 在不同版本里可能生成 `false` 也可能抛错：先写测试 `没有回合时只投影作者设定` 跑一下，抛错就在 `chain` 为空时改用 `isNull(…originTurnId)` 作条件。然后 `loadProjection` 加两段查询：`state_defs` 里本版本 `origin_turn_id` 为空或在链上的行；`state_values` 里本版本 `turn_id` 在链上的行。填进新字段。再导出：

  ```ts
  export function stateDefByKey(p: StoryProjection, key: string): ProjStateDef | null;
  export function stateAt(p: StoryProjection, stateDefId: string, depth: number): ProjStateValue | null;
  export function sceneHitIds(p: StoryProjection): Set<string>;
  ```

  - `stateDefByKey`：同 `key` 有多条（作者设定一条、链上新增一条）时取 `originDepth` 最大的。
  - `stateAt`：`depth` 及以前最后一条该栏目的值。
  - `sceneHitIds`：投影里 `kind === 'scene_hit'` 的事实的 `key` 集合。
- [ ] 3. `text/turn-text.ts` 的 `parseOptionLines`：选项对象允许带 `hint`（字符串，去掉首尾空白，最多 100 字），结果的每项是 `{ text, hint: string | null }`。新增一个选项参数 `allowHint: boolean`（默认 `false`）：为 `false` 时带了非空 `hint` 报错“这部作品只显示行动，推荐行动不写 hint。”。现有调用方不传，行为不变（`hint` 为 `null`）。
- [ ] 4. `changes.ts`：
  - `ChangesContext` 加 `keyScenes: Array<{ code: string; id: string; once: boolean }>`（续写时由 T19 传入，开场时传 `[]`）。
  - `TURN_CHANGE_TYPES` 加 `state`、`state_item`、`new_state`、`secret`、`scene_hit`。`OPENING_CHANGE_TYPES` 不加这五种（开场的初始状态走单独的 `state` 参数，T17）。
  - 开场且 `ctx.projection` 不为 `null`（按方案生成的开场：主角已经是作者设定）：**不允许** `protagonist` 行，报错“主角已经在作品设定里，不要再新增。”；主角引用取 `ctx.projection.protagonistId`。`ctx.projection` 为 `null` 时维持现有规则（恰好一行主角），供旧测试使用。
  - 开场模式下 `new_entity` 允许 `"slot": "<人物位置的作用>"`，存进 `slot`；续写模式带 `slot` 报错。
  - 五种新类型的规则（错误文字照抄）：

    | 类型 | 规则 |
    | --- | --- |
    | `new_state` | `key` 匹配 `/^[\p{L}\p{N}_]{1,40}$/u`，不能和投影里已有栏目的 `key`（`stateDefByKey`）或本次另一行 `new_state` 重复：“栏目 <key> 已经存在。”；`label` 1–20 字；`display` 四选一；`min`、`max`、`unit`、`stages`（`|` 分隔）组装成配置后用 `checkStateConfig`；`hidden` 为 `"true"` / `"false"`，缺省 `false`。每回合最多 3 行：“每回合最多新增 3 个栏目。” |
    | `state` | `key` 先找本次的 `new_state`，再找 `stateDefByKey`，都没有：“找不到栏目 <key>。可用的栏目：<key 列表>。”。`value`：清单栏目不能写（`checkStateValue` 会给出错误）；其余栏目写了就用 `checkStateValue` 校验并换成规范化的值。`visible`、`closed` 为 `"true"` / `"false"` 或缺省。幕后栏目（`hidden`）写 `visible: "true"`：“幕后栏目 <key> 不能设为显示。”。同一个栏目每回合最多一行 `state` |
    | `state_item` | 栏目必须是清单：“<key> 不是清单栏目，不能用 state_item。”；`item` 1–100 字；`status` 四选一 |
    | `secret` | `title` 1–40 字、`statement` 1–200 字、`reveal` 最多 1000 字；`subject` 可选；`knowers` 逗号分隔、每个都必须是人物；`para` 同其他事实 |
    | `scene_hit` | `scene` 必须是 `ctx.keyScenes` 里的某个 `code`：“找不到关键场面 <scene>。未触发的场面：<code 列表>。”；`once` 的场面已经在 `sceneHitIds(ctx.projection)` 里：“关键场面 <scene> 只发生一次，已经发生过。”；同一个场面本次最多一行；`para` 必填 |
- [ ] 5. `writer.ts`：
  - `WriteChangesInput` 加 `parentStates: Map<string, { value: string | null; visible: boolean; closed: boolean }>`（由调用方从投影里按 `stateAt(p, id, parentDepth)` 算好传入；开场传空 `Map`）和 `castSlots?: Map<number, string>`（`changes.entities` 的 `line` → 人物位置 id，写进 `entities.cast_slot`）。
  - 写入顺序：实体 → 称呼 → 事实（含秘密、场面）→ 知情（含目击者、秘密知情者）→ 新栏目 → 状态值。
  - 秘密：`facts` 一行（`kind: 'secret'`，`data: { title, reveal }`，`key: null`）；每个知情者一行 `knowledge`（`confirmed`）。
  - 场面：`facts` 一行（`kind: 'scene_hit'`，`key: sceneId`，`statement: '关键场面已经发生。'`，`subject_id`、`object_id` 为空）。
  - 新栏目：`state_defs` 一行（`origin_turn_id: input.turnId`，`id` 用 `randomUUID()`）。
  - 状态值：把本次涉及的栏目（`states` 和 `stateItems` 里出现的）逐个算出新值，写一条 `state_values`：
    - 起点是 `parentStates.get(id)`（新栏目没有起点：`{ value: null, visible: false, closed: false }`）。
    - 清单栏目：`value = mergeListItems(起点.value, 本栏目的全部 stateItems)`。
    - 其他栏目：有 `state.value` 用它，否则沿用起点。
    - `visible`、`closed`：`state` 行给了就用，否则沿用起点（[数据模型 §4](../docs/data-model.md#4-故事事实)“只交了条目、没交 state 时，visible 和 closed 沿用父回合的值；栏目第一次有值时默认不显示”）。
  - 另外导出 `writeStateValues(tx, input: { versionId: string; turnId: string; values: Array<{ stateDefId: string; value: string | null; visible: boolean; closed: boolean }> })`，开局写初始状态时用（T18）。
- [ ] 6. `leak.ts`：`findLeaks` 的输入加 `extras: string[]`（缺省 `[]`），和选项一样逐条检查。调用方传入提醒文字和本回合显示中的状态值文字。
- [ ] 7. `status.ts`（新建）：

  ```ts
  export function buildStatusView(p: StoryProjection, routeId: string): StatusView;
  ```

  - 只处理 `hidden === false` 的栏目。每个栏目取 head 的值 `stateAt(p, id, headDepth)`；没有值，或值的 `visible` 为假，不出现。`closed` 为真的放进 `closed`，其余放进 `columns`。
  - 父回合的值：`stateAt(p, id, headDepth - 1)`，且它当时 `visible` 为真才算“有旧值”；没有旧值时 `isNew: true`，`previous` 一类字段为 `null`。
  - `changed`：head 回合本身写过这个栏目的值（`turnId === headTurnId`），并且显示值和父回合不同。
  - 显示值：`number` → `value: Number(值)`、`min`、`max`、`unit` 来自配置，`previous` 为旧值的数字；`stage` → `stage: 值`、`step: stageIndex + 1`、`total: stages.length`、`previousStep`；`list` → `parseListValue(值)` 去掉 `gone` 的项，每项的 `change` 是 `new`（父回合清单里没有）、`changed`（状态变了）或 `null`；`text` → `value`、`previous`。**未到达的阶段名不出现在任何字段里。**
  - `history`：从链上该栏目的全部值里，取 `visible` 为真的那些，按 `depth` 升序，每条 `{ turnId, depth, text }`，`text` 是那一刻的显示文字：数字带单位（`8 天`）、阶段名、文字原文、清单写成“<条目>：<状态中文>”用“、”连接（状态中文：`open` 进行中、`done` 已完成、`failed` 落空）。**这些中文是给 client 原样显示的内容格式**，写成 `status.ts` 里的常量 `LIST_STATUS_TEXT`；隐藏期间的值不进来历。
- [ ] 8. `journal.ts`：`secret` 事实按 `event` 同样的规则处理（主角知情才收录，确认时用陈述，否则用主角听到的说法），有 `subject_id` 时归到那个实体名下，没有时归到“发生过的事”。
- [ ] 9. `render.ts` 加给模型看的格式（附录 C.4）：`renderStateBlock(p, cb)`、`renderSecretLines(p, cb, presentIds)`、`renderSceneLines(scenes)`。
- [ ] 10. `test-support/story-fixtures.ts`：`SeedSpec` 加 `stateDefs?: Array<{ key: string; label: string; display: StateDisplay; config?: Partial<StateConfig>; hidden?: boolean; originTurn?: number | null }>` 和 `stateValues?: Array<{ state: string; turn: number; value: string | null; visible: boolean; closed?: boolean }>`；`SeededStory.ids` 里加上栏目的 id（键为 `state:<key>`）。附录 D.2 的“灯塔镇”夹具在这里实现为 `seedLighthouseTown(db)`。
- [ ] 11. 测试（夹具用 `seedLighthouseTown`）：
  - `changes.test.ts` 补：每条新规则至少一个拒绝用例和一个通过用例；`幕后栏目不能设为显示`；`只发生一次的场面不能再触发`（夹具里第 2 回合已触发 S1 对应的场面）；`按方案生成的开场不能再新增主角`；`续写时不能写人物位置`。
  - `writer.test.ts` 补：`清单只交一个新条目时保留原来的两项`（[回合循环 §13](../docs/turn-loop.md#13-验收)）；`只交条目时沿用父回合的显示状态`；`秘密的知情者展开成确认知情`。
  - `status.test.ts`：
    - `幕后栏目和隐藏中的栏目不出现`（阳性对照：同一夹具里显示中的栏目出现）。
    - `阶段栏目只给已到达的阶段名`：配置 `['陌生', '相识', '信任', '决裂']`，当前为“相识”；把整个视图 `JSON.stringify` 后不含“信任”“决裂”，`step === 2`、`total === 4`。
    - `数字栏目标出增减`：父回合 `5`、本回合 `3`，`changed: true`、`previous: 5`。
    - `第一次显示的栏目标为新`。
    - `来历不含隐藏期间的值`：一个栏目第 1、2 回合隐藏时改过两次，第 3 回合显示；`history` 只有一条，`depth === 3`。
    - `了结的栏目单独给出`。
  - `journal.test.ts` 补：`主角不知情的秘密不进手记`、`主角得知后进手记`。
  - `leak.test.ts` 补：`提醒里的未知名字被拦下`。
  - `turn-text.test.ts` 补：`只显示行动的作品不接受提醒`、`带提醒的作品保留提醒文字`。

**接线点。** 本任务只改故事层。`grep -rn "buildStatusView\|writeStateValues" packages/core/src` 在本任务结束时只命中定义和测试；T18、T19 接线。`findLeaks`、`parseChanges`、`writeChanges` 的现有调用方（`authoring/preview-tool.ts`、`authoring/service.ts`、`play/service.ts`）因为新参数都有缺省值，不需要改；如果类型检查要求补参数，只补 `keyScenes: []`、`parentStates: new Map()`，不改逻辑。

**注意事项。**

- `story/` 不能导入 `llm/`、`api/`、`play/`、`authoring/`（core AGENTS §1）。
- `LIST_STATUS_TEXT` 是作品内容的格式化（和段落、出处标签一样由 core 产出），不是界面文案。状态视图里其余的界面词（“已了结”“新”“本回合”）由 client 的 i18n 提供。
- 改了 `PROPOSE_TURN_PARAMETERS` 以外的工具说明时，按 core AGENTS §4 更新 token 棘轮；本任务不改工具说明，所以棘轮不应变化。变了就说明误改了，停下来查。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：在 `buildStatusView` 的阶段分支里把 `stages` 整个放进视图，`阶段栏目只给已到达的阶段名` 必须红。
- 突变二：把 writer 里清单的 `mergeListItems` 换成只写本回合的条目，`清单只交一个新条目时保留原来的两项` 必须红。
- 突变三：去掉 `scene_hit` 的 `once` 检查，`只发生一次的场面不能再触发` 必须红。
- 突变四：把 `status.ts` 里 `history` 的 `visible` 过滤去掉，`来历不含隐藏期间的值` 必须红。
- `grep -rnE "from '\.\./(llm|api|play|authoring)/" packages/core/src/story --glob '!*.test.ts'` 零命中。存量测试里的跨模块导入不是本任务引入的，不删。`grep -rnE "from '\.\./(llm|api|play|authoring)/" packages/core/src/story` 在测试里仍有存量命中。

---
### T17 core：按方案生成开场预览，采用只发布

**目的。** 开场预览读的是确认后的方案：作者设定的人物以短编号出现，开场方式决定正文由谁写（D18），主角填写项用占位符（D19），行动提示按作品的选择，初始状态值一并交出。采用时只发布作品，不建开局（D20）；每局生成人物的作品，预览里的具体人物不写成作者设定（D22）。

**依赖。** T15（确认方案写出的草稿设定）、T16（`changes` 的开场规则、`parseOptionLines` 的提醒、`findLeaks` 的 `extras`、`writeStateValues`）。

**拥有的文件。** `packages/core/src/text/placeholders.ts`、`placeholders.test.ts`（新建）；`packages/core/src/story/opening-proposal.ts`、`opening-proposal.test.ts`（新建）；`authoring/preview-tool.ts`、`preview-prompt.ts`、`service.ts` 的 `generatePreview`、`runPreviewJob`、`adoptPreview` 及 `authoring/*.test.ts`；`store/meta.ts` 的 `PreviewJobResultSchema` 两个新字段；`app.integration.test.ts` 里因为“采用不再建开局”而失效的用例（只改成先 `play.start` 再取路线，不加新用例）。

**先读。** [回合循环 §10](../docs/turn-loop.md#10-开场)；[创作工作站 §7](../docs/author-workstation.md#7-受影响范围与开场核对)“开场里出现按设置不该固定的名字时，也要标出”；本文 §1.4 D16、D18–D22、附录 B.2、C.5；现有 `authoring/preview-tool.ts`（整份）、`authoring/service.ts`（`generatePreview`、`runPreviewJob`、`adoptPreview`）。

**步骤。**

- [ ] 1. `text/placeholders.ts`：

  ```ts
  export const PLACEHOLDER_PATTERN = /\{\{protagonist\.([^{}]+)\}\}/gu;
  export function placeholderToken(name: string): string;
  export function placeholderNames(text: string): string[];
  export function unknownPlaceholders(text: string, fieldNames: readonly string[]): string[];
  export function substitutePlaceholders(text: string, values: Readonly<Record<string, string>>): string;
  export function withoutPlaceholders(text: string): string;
  ```

  `placeholderToken('名字')` 返回 `'{{protagonist.名字}}'`；`substitutePlaceholders` 只替换 `values` 里有的名字，其余原样保留；`withoutPlaceholders` 把所有占位符换成空字符串（用于检查写死的名字时排除占位符本身）。
- [ ] 2. `story/opening-proposal.ts`（故事层，供 T17 的预览和 T18 的开局共用）：

  ```ts
  export type OpeningField = 'prose' | 'options' | 'place' | 'time' | 'present' | 'changes' | 'state' | 'leak' | 'placeholder';
  export interface OpeningSlot { index: string; slotId: string; name: string | null }
  export interface OpeningProposalContext {
    projection: StoryProjection;
    codebook: CodeBook;
    hintMode: HintMode;
    fixedProse: string | null;
    fieldNames: readonly string[];
    forbiddenNames: readonly string[];
    placeholderPolicy: 'reject' | 'review';
    slots: OpeningSlot[];
    stateDefaults: Map<string, { value: string | null; visible: boolean }>;
  }
  export interface OpeningProposal {
    prose: string;
    paragraphs: string[];
    options: Array<{ text: string; hint: string | null }>;
    scene: { place: string; time: string; present: EntityRef[] };
    changes: ValidatedChanges;
    initialState: Array<{ stateDefId: string; value: string | null; visible: boolean }>;
    slotOf: Map<number, string>;
    needsReview: NeedsReview[];
  }
  export const OPENING_LIMITS = { proseMax: 6_000, paragraphsMax: 20, optionsMin: 1, optionsMax: 6, optionTextMax: 100, placeMax: 100, timeMax: 100 } as const;
  export function parseOpeningProposal(args: Record<string, unknown>, ctx: OpeningProposalContext): { ok: true; value: OpeningProposal } | { ok: false; errors: string[]; fields: OpeningField[] };
  ```

  按顺序做（错误文字照附录 C.5 末尾的表）：
  1. 正文：`ctx.fixedProse` 不为 `null` 时用它（不读 `args.prose`），否则读 `args.prose`。`normalizeProse` 后段落数 1–20、总长不超过 6000。
  2. 选项：`parseOptionLines(args.options, { min, max, textMax, allowHint: ctx.hintMode === 'known_consequences' })`。
  3. `place`、`time`：必填，各不超过 100 字。
  4. `changes`：`parseChanges(args.changes, { mode: 'opening', projection: ctx.projection, codebook: ctx.codebook, paragraphCount, parentPresentIds: [], keyScenes: [] })`。
  5. 人物位置：`ctx.slots` 不为空时，每个位置必须正好有一行 `new_entity`，`kind` 为 `character`，`slot` 等于位置的 `index`；`slot.name` 不为 `null` 时名字也必须相同。结果写进 `slotOf`（行号 → `slotId`）。`ctx.slots` 为空时出现带 `slot` 的行报错。
  6. `present`：逗号分隔，每个名字先找本次新增的人物，再用 `ctx.codebook.resolveEntity` 找作者设定的人物；都必须是 `character`。
  7. `state`：每行一个 JSON。非清单栏目写 `{"key","value","visible"}`，清单栏目写 `{"key","item","status"}`（可以多行）。`key` 用 `stateDefByKey`；值用 `checkStateValue`，清单用 `mergeListItems(null, …)`；幕后栏目 `visible: "true"` 报错。没写的栏目用 `ctx.stateDefaults` 补；结果 `initialState` 覆盖投影里全部栏目中有值的那些。
  8. 不泄露：`findLeaks({ projection: ctx.projection, changes, paragraphs, options: 选项文字, extras: [提醒文字…, 显示中的初始状态值文字…] })`。
  9. 占位符：在正文、选项、提醒里找 `unknownPlaceholders(…, ctx.fieldNames)`；在 `withoutPlaceholders(…)` 之后的文字里找 `ctx.forbiddenNames` 的每个名字。`placeholderPolicy === 'reject'` 时报错交回模型；`'review'` 时不报错，写进 `needsReview`（`where`、`index` 指出是第几段或第几个选项，`reason` 为 `unknown_placeholder` 或 `hardcoded_name`，`text` 是那一段或那个选项的原文）。
- [ ] 3. `authoring/preview-tool.ts` 改写：
  - `PREVIEW_TOOL_PARAMETERS` 改成函数 `previewToolParameters(mode: OpeningMode, castMode: CastMode)`：在现有参数上加 `state`；`mode === 'author_text'` 时去掉 `prose`；参数说明照附录 C.5。`changes` 的说明换成按方案的版本（不再要求主角行；`per_run` 时说明 `slot`）。
  - `parsePreviewArgs(args, ctx: OpeningProposalContext)`：先校验 `title`、`blurb`、`public_setting`、`language`（规则不变），再调 `parseOpeningProposal`。`PreviewField` 改为 `'title' | 'blurb' | 'public_setting' | 'language' | OpeningField`。
  - 返回的 `preview`：`options` 带 `hint`；`cast` 列出本次新增的人物、地点、事物（主角不再出现在 `cast` 里，它在方案里）；`needsReview`；`initialState` 转成 `{ label, text, visible }`（`text` 的格式同 T16 `history` 的显示文字，写一个本地函数复用 `LIST_STATUS_TEXT`）。
- [ ] 4. `authoring/preview-prompt.ts`：`PREVIEW_SYSTEM_PROMPT` 换成附录 B.2；`buildPreviewPrompt` 改成 `buildPreviewPrompt(input: { meta: VersionMeta; settings: WorkSettings; projection: StoryProjection; codebook: CodeBook })`，格式见附录 C.5。
- [ ] 5. `authoring/service.ts`：
  - `generatePreview`：在现有检查之后加两条：`!isPlanConfirmed(meta, input.contentRev)` → `plan_not_confirmed`；`settings.opening.mode === 'author_text'` 且 `settings.opening.text.trim()` 为空 → `invalid_input`。
  - `runPreviewJob`：开始时读草稿（`work.draftId`）的 `meta`、`readSettings`、`loadProjection(deps.db, { versionId: draft.id, chain: [] })`、`createCodeBook`。组装 `OpeningProposalContext`：`fixedProse` 在 `author_text` 时是 `settings.opening.text`；`fieldNames` 是填写项的名字；`forbiddenNames` 在有 `isName` 填写项时是 `[主角实体名, 该项的 defaultValue]`（去重），否则 `[]`；`placeholderPolicy` 在 `author_text` 时为 `'review'`，否则 `'reject'`；`slots` 在 `per_run` 时是 `meta.castSlots` 按顺序编号 `'1'`、`'2'`…（`name: null`），否则 `[]`；`stateDefaults` 从方案的 `state` 项取 `initial`（`visible: !hidden`）。工具用 `previewToolParameters(...)`。任务结果多存 `initialState`、`slots`（`Object.fromEntries(slotOf)`）。
  - `adoptPreview` 重写（一个 `immediate` 事务）：
    1. 任务存在且属于该作品；`result.adoption` 已存在 → 直接返回 `{ routeId: null }`（幂等）。
    2. 作品存在、未发布；任务 `done`；草稿 `contentRev === job.input.contentRev`，否则 `stale_preview`。
    3. `preview.needsReview.length > 0` → `opening_needs_review`。
    4. `const changes = ValidatedChangesSchema.parse(result.changes)`。给每个**不在 `slots` 里**的 `new_entity` 行分配 id，作为作者设定写进草稿的 `entities`（`origin_turn_id` 为空、`profile: { text }`）。
    5. `nextRev = draft.contentRev + 1`。新的 `meta`：在草稿 `meta` 上，方案里替换或加入 `{ kind: 'summary', key: 'public_setting', id: PUBLIC_SETTING_PLAN_ITEM_ID, text: preview.publicSetting, source: 'ai' }`，`confirmedRev = nextRev`；`narration = { language: preview.language }`；`opening = { prose, options, scene: { place, time, present, presentIds }, changes, createdIds, initialState, template: castMode === 'per_run' }`。`present` 和 `presentIds` 按现有写法解析（新增的用 `createdIds`，已有的用 `existing`）。
    6. 更新草稿的 `meta` 和 `content_rev`；插入发布版本（`meta` 去掉 `wizardStep`，`content_rev` 与 `source_rev` 都是 `nextRev`）；`copyAuthorSetting(tx, { fromVersionId: draft.id, toVersionId: publishedId })`；更新 `works` 的标题、简介、`published_id`。
    7. `result.adoption = { versionId: publishedId, routeId: null }`。
    8. **不插入** `playthroughs`、`turns`、`routes`，也不写根回合的事实和索引。
    9. 提交后发 `works.changed`，记 `work.adopted`（`data: { versionId }`）。返回 `{ routeId: null }`。
- [ ] 6. 测试：
  - `placeholders.test.ts`：替换已知、保留未知；`unknownPlaceholders` 找出写错的名字；`withoutPlaceholders` 之后不含 `{{`。
  - `opening-proposal.test.ts`（夹具：确认过方案的草稿投影，见附录 D.2）：
    - `作者原文模式不读 prose 参数`：`fixedProse` 给定、`args.prose` 是另一段文字，结果的 `prose` 是 `fixedProse`。
    - `写死主角名：起草模式退回模型`：`forbiddenNames: ['新来的邮差', '阿岚']`，正文第 2 段含“阿岚”，`ok: false`、`fields` 含 `placeholder`。阳性对照：改用 `{{protagonist.名字}}` 后通过。
    - `写死主角名：作者原文模式列进待处理`：附录 D.2 的“写死主角名的变体”作 `fixedProse`、`placeholderPolicy: 'review'`，`ok: true`，`needsReview[0]` 的 `where`、`index`、`reason` 分别为 `'prose'`、`2`、`'hardcoded_name'`。
    - `未知占位符`：`{{protagonist.年龄}}` 而填写项只有“名字”。
    - `只显示行动的作品不接受提醒`；`提醒里不能出现主角不知道的名字`。
    - `每个人物位置正好一个人物`：两个位置只写了一个，报错；带 `slot` 但作品是固定人物，报错。
    - `初始状态按栏目校验，没写的用方案的初始值`：数字栏目写 `"value":"12"`（范围 0–10）报错；不写时取方案的 `initial`。
    - `幕后栏目不能设为显示`。
  - `authoring/service.test.ts` 改写预览与采用的用例：
    - `方案没确认时不能生成预览`：抛 `plan_not_confirmed`。
    - `预览带上作者设定的人物编号`：`scriptedLlm.runs[0].prompt` 里有一行同时含林潮的编号和“守灯人”。编号用同一份投影建 `createCodeBook` 后 `entityCode(林潮的 id)` 现取，不手写 `@2`；“守灯人”写字面量。
    - `作者原文开场写死主角名时拒绝采用`：抛 `opening_needs_review`。
    - `采用只发布，不建开局`：采用后 `works.published_id` 不为空，发布版本有和草稿相同 id 的作者设定实体（`copyAuthorSetting` 生效），`playthroughs` 表为空（阳性对照：`work_versions` 里多了一行 `published`）。
    - `每局生成的作品采用时不写预览人物`：`per_run` 时预览里带 `slot` 的人物不在发布版本的 `entities` 里，预览里新增的地点在。
    - `采用两次只发布一次`。
  - `app.integration.test.ts`：把原来“采用后直接 `getRoute(adopted.routeId)`”的用例改成“采用后 `play.start`，再 `getRoute`”。`play.start` 在本任务时还是占位，所以这些用例先用 `it.todo` 标出，并在汇报里列出名单，由 T18 恢复。**不要删用例。**

**接线点。** 预览和采用的路由已有；`generatePreview` 的两个新检查；`runPreviewJob` 的上下文组装；`adoptPreview`。`grep -rn "parseOpeningProposal" packages/core/src` 在本任务结束时命中 `story/opening-proposal.ts`、它的测试、`authoring/preview-tool.ts`。

**注意事项。**

- 预览任务开始后作者又确认了一次方案，草稿的设定行会被重写、`content_rev` 也变了，所以这份预览在采用时会因 `stale_preview` 被拒。这是预期行为。
- 主角不再由预览新增，所以 `PREVIEW_SYSTEM_PROMPT` 里关于“主角一行”的句子必须删掉；附录 B.2 已经改好。
- 改了提示词和工具说明，按 core AGENTS §4 更新预览相关的 token 棘轮（如果有），在汇报里写清涨幅来自哪一段。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `adoptPreview` 里的 `copyAuthorSetting` 删掉，`采用只发布，不建开局` 必须红。
- 突变二：把 `runPreviewJob` 的 `placeholderPolicy` 写死成 `'reject'`，`作者原文开场写死主角名时拒绝采用` 必须红（预览会失败，而不是带着 `needsReview` 完成）。
- 突变三：把 `parseOpeningProposal` 第 5 步的“正好一行”改成“至少一行”，`每个人物位置正好一个人物` 必须红。
- 汇报里列出被标成 `it.todo` 的集成用例名单。

### T18 core：开局（固定人物与每局生成）

**目的。** 玩家点「开始故事」或「重新开局」时建立一次新的开局（[游玩流程 §1](../docs/gameplay-flow.md#1-进入作品找到正确的起点)、[回合循环 §10](../docs/turn-loop.md#10-开场)）。固定人物的作品当场写好根回合；每局生成人物的作品在后台分两步生成，失败时能重试，重试沿用已经生成的人物（D21）。

**依赖。** T17。

**拥有的文件。** `packages/core/src/play/start.ts`、`start.test.ts`、`opening-job.ts`、`opening-job.test.ts`、`cast-tool.ts`、`cast-tool.test.ts`、`opening-tool.ts`、`opening-prompt.ts`（新建）；`play/service.ts` 里 `getStartInfo`、`start`、`getPlaythrough`、`retryOpening` 的接线和 `whenIdle`；`test-support/llm-steps.ts` 的 `proposeCastStep`、`proposeOpeningStep`；`app.integration.test.ts` 里 T17 标成 `it.todo` 的用例（恢复它们）。

**先读。** [回合循环 §2](../docs/turn-loop.md#2-回合请求)、[§10](../docs/turn-loop.md#10-开场)；[数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)；本文 §1.4 D19、D21、附录 B.4、C.6；T17 的 `opening-proposal.ts`、`placeholders.ts`；现有 `play/service.ts` 的 `runTurnRequest`（照它的结构写开局请求）。

**步骤。**

- [ ] 1. `start.ts`：

  ```ts
  export function getStartInfo(deps: CoreDeps, input: WorkIdInput): StartInfo;
  export function startPlaythrough(deps: CoreDeps, input: StartPlaythroughInput): { view: PlaythroughView; enqueue: string | null };
  export function playthroughView(db: Database, playthroughId: string): PlaythroughView;
  ```

  - `getStartInfo`：作品不存在 → `not_found`；没发布 → `not_published`；返回 `{ workId, title, fields: 发布版本 readSettings().protagonist.fields, castMode }`。
  - `startPlaythrough`，一个 `immediate` 事务：
    1. 同一 `playthroughId` 已存在：属于这部作品的发布版本就返回 `{ view: playthroughView(...), enqueue: null }`，否则 `idempotency_conflict`。
    2. 作品存在（`not_found`）、已发布（`not_published`）。读发布版本的 `meta` 和设定。
    3. `input.protagonist` 的每个键都必须是填写项的名字，否则 `protagonist_input_invalid`。每项的值：`trim` 后非空用它，否则用 `defaultValue`。
    4. **固定人物：**
       - `opening = meta.opening`；没有 → `internal`。
       - `prose = substitutePlaceholders(opening.prose, values)`；`options` 的 `text`、`hint` 同样替换；`initialState` 的 `value` 同样替换。
       - `changes = ValidatedChangesSchema.parse(opening.changes ?? EMPTY_CHANGES)`。`createdIds`：有 `opening.createdIds` 就用它（键转成数字）；没有（第二个里程碑留下的作品）就按“开场里 `new_entity` 行的 `kind` 和 `name` 对上发布版本里作者设定的实体，主角行对上 `is_protagonist = 1` 的实体”逐行匹配，有任何一行对不上，`changes` 换成 `EMPTY_CHANGES` 并记事件 `playthrough.legacy_changes_dropped`（`info`）。
       - 插入开局（`protagonist: values`、`root_turn_id` 为根回合 id）、根回合（`depth: 0`、`status: 'committed'`、`scene: opening.scene`）。
       - `writeChanges(tx, { changes, createdIds, turnId: 根回合, versionId, entityVersionIds: [], entityOrigin: 'version', protagonistId: 发布版本的主角, parentPresentIds: [], parentStates: new Map() })`。
       - 有 `isName` 填写项时，再插一条主角自己持有的称呼（名字为玩家这次填写的值，`origin_turn_id` 为根回合，`source_para: 1`），用 `onConflictDoNothing`。
       - `writeStateValues`（初始状态）、`indexTurnProse`、插入第一条路线。
       - 返回 `{ view, enqueue: null }`，`view.routeId` 为新路线。
    5. **每局生成：** 插入开局（`root_turn_id`、`cast` 为空），插入一条回合请求（`id: randomUUID()`、`route_id: null`、`kind: 'opening'`、`status: 'running'`、`attempts: 1`）。返回 `{ view, enqueue: 请求 id }`。
    6. 提交后：记 `playthrough.started`（`mode`、`fields: 填了几项`）；每局生成时发 `playthrough.updated`（`running`）。
  - `playthroughView`：开局、版本、作品；第一条路线（按 `created_at`）；该开局最近一条 `kind = 'opening'` 的请求（没有为 `null`）。
- [ ] 2. `cast-tool.ts`：

  ```ts
  export const PROPOSE_CAST_TOOL_NAME = 'propose_cast';
  export const PROPOSE_CAST_PARAMETERS = { …附录 C.6… } as const;
  export interface CastMember { slotId: string; name: string; knownAs: string | null; profile: string }
  export function parseCastArgs(args: Record<string, unknown>, ctx: { slots: Array<{ index: string; slotId: string }>; takenNames: readonly string[] }): ParseResult<CastMember[]>;
  ```

  `cast` 每行 `{"slot","name","known_as","profile"}`；每个 `slot` 正好一行；名字两两不同，也不能和 `takenNames`（作者设定里全部人物的名字）相同。
- [ ] 3. `opening-tool.ts`：`PROPOSE_OPENING_TOOL_NAME = 'propose_opening'`；参数是预览工具去掉 `title`、`blurb`、`public_setting`、`language` 之后的那些（附录 C.6），解析直接调 `parseOpeningProposal`。`opening-prompt.ts`：附录 B.4 的 `CAST_SYSTEM_PROMPT`、`OPENING_SYSTEM_PROMPT`，以及 `buildCastPrompt`、`buildOpeningPrompt`（附录 C.6）。
- [ ] 4. `opening-job.ts`：

  ```ts
  export interface OpeningJobs {
    enqueue(requestId: string): void;
    retry(input: RetryOpeningInput): PlaythroughView;
    whenIdle(): Promise<void>;
  }
  export function createOpeningJobs(deps: CoreDeps & { llm: LlmService }): OpeningJobs;
  ```

  `run(requestId, startedAt)`，结构照 `runTurnRequest`：
  1. 读请求（`kind = 'opening'`、`running`）、开局、发布版本、`meta`、设定。`deps.llm.resolve('narrator')` 为空 → 失败 `llm_not_configured`。
  2. `projection = loadProjection(deps.db, { versionId, chain: [] })`，`codebook = createCodeBook(projection)`。
  3. **人物：** 开局的 `cast` 为空时，用 `propose_cast` 跑一次（用途 `narrator`、`sessionId: playthroughId`、`ref: { kind: 'turn_request', id: requestId, attempt, workId }`，最多修正 2 次）。通过后在一个事务里 `update playthroughs set cast = ? where id = ? and cast is null`，记 `opening.cast` 样本。`cast` 已有时跳过这一步——这就是“重试沿用已生成的人物”。
  4. **开场：** 用 `propose_opening` 跑一次。`OpeningProposalContext`：`fixedProse: null`；`fieldNames: []`、`placeholderPolicy: 'reject'`（填写值已经替换进模板，不允许再出现占位符）；`forbiddenNames: []`；`slots` 是 `cast` 按位置顺序编号、`name` 为生成的名字；`stateDefaults` 来自 `meta.opening.initialState`（替换过占位符）。
  5. 提交（`immediate` 事务）：开局的 `root_turn_id` 已不为空 → 请求标 `superseded`，不写。否则：插根回合；`createdIds = allocateEntityIds(changes)`；`writeChanges(tx, { …, entityVersionIds: [versionId], entityOrigin: 'turn', castSlots: slotOf })`；主角称呼（同第 1 步）；`writeStateValues`；`indexTurnProse`；插路线；`playthroughs` 的 `root_turn_id` 设为根回合、`cast` 清空；请求 `done`、`result_turn_id`。
  6. 提交后发 `playthrough.updated`（`done`）、`turn.committed`（`routeId`、`turnId`），记 `opening.request.done` 和样本 `opening.commit`、`opening.total`。
  7. 失败：同 `runTurnRequest` 的失败写法，事件 `opening.request.failed`（`stage` 为 `cast`、`opening`、`validation`、`commit` 或 `background`），发 `playthrough.updated`（`failed`）。
  - `retry(input)`：请求存在且 `kind = 'opening'`；`running` 时返回当前视图；不是 `failed` → `request_not_retryable`；否则 `attempts` 加一、改回 `running`，提交后 `enqueue`。
- [ ] 5. `play/service.ts`：`const openingJobs = createOpeningJobs(deps);`；`getStartInfo`、`getPlaythrough` 调 `start.ts`；`start` 调 `startPlaythrough`，`enqueue` 不为空时 `openingJobs.enqueue(...)`；`retryOpening` 调 `openingJobs.retry`；`whenIdle` 合并两个队列。
- [ ] 6. `test-support/llm-steps.ts`：`proposeCastStep(cast: Array<Record<string, string>>)`、`proposeOpeningStep(input: { prose; options: string[]; place; time; present?: string[]; changes?: string; state?: string })`。
- [ ] 7. 测试：
  - `start.test.ts`：
    - `固定人物的开局不调模型，占位符换成玩家填的名字`：附录 D.2 的作品，开场正文含 `{{protagonist.名字}}`；`start({ protagonist: { 名字: '阿岚' } })` 后 `scriptedLlm.runs.length === 0`，根回合正文含“阿岚”、不含 `{{`。
    - `留空的填写项用默认值`。
    - `传了作品没有的填写项被拒`：`protagonist_input_invalid`。
    - `填写值替换后段落数不变`：根回合的段落数等于开场模板的段落数。契约那一侧由 T10 的测试 `填写值不能含换行` 守住。
    - `主角记得自己填的名字`：投影里主角持有“阿岚”这个称呼。
    - `开场的事实和初始状态写进根回合`：根回合上有开场的称呼、事件；状态值表有方案里的初始值。
    - `同一个开局 id 重复提交只建一次`。
    - `没发布的作品不能开局`。
    - `第二个里程碑的作品也能重新开局`：用旧形状的 `meta.opening`（没有 `createdIds`、`changes` 带主角行）造一个发布版本，`start` 成功，根回合有主角的称呼。
  - `cast-tool.test.ts`：每个位置正好一行；不能和作者设定的人物同名。
  - `opening-job.test.ts`：
    - `每局生成：先生成人物再写开场`：`scriptedLlm.runs` 依次用了 `propose_cast`、`propose_opening`（看 `requiredToolName`，字面量）；完成后开局有路线，根回合上有两个 `origin_turn_id` 为根回合、`cast_slot` 不为空的人物；`playthroughs.cast` 已清空。
    - `开场失败后重试沿用已生成的人物`：第二步失败（脚本给 `fail: 'timeout'`）；`playthroughs.cast` 不为空；`retryOpening` 后 `scriptedLlm.runs` 只多了一次 `propose_opening`，最终人物名字和第一次生成的一致。
    - `开局完成时发出 turn.committed 和 playthrough.updated`。
    - `开场里不能再有占位符`。
  - 恢复 T17 标成 `it.todo` 的集成用例。

**接线点。** `play/service.ts` 四个方法和 `whenIdle`。`grep -n "not implemented: play" packages/core/src/play/service.ts` 只剩 `getStatus`（T19 换掉）。

**注意事项。**

- 固定人物的开局全程在一个同步事务里，不调模型，所以 `start` 返回时 `routeId` 已经有值。
- 每局生成的开局请求没有路线，`turn_request.updated` 这个事件要求 `routeId`，所以开局请求只发 `playthrough.updated`。
- core 重启时，`play.recoverInterrupted` 已经会把 `running` 的开局请求改成 `failed`、`interrupted`（它不区分 `kind`），不用另写。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把第 4 步第 3 小步的“`cast` 已有时跳过”改成每次都生成，`开场失败后重试沿用已生成的人物` 必须红。
- 突变二：把 `startPlaythrough` 里替换占位符的那一行删掉，`固定人物的开局不调模型，占位符换成玩家填的名字` 必须红。
- 突变三：把“每个键都必须是填写项的名字”检查删掉，`传了作品没有的填写项被拒` 必须红。
- T17 标成 `it.todo` 的用例全部恢复并通过。

### T19 core：回合循环接上设定，状态栏查询

**目的。** 续写时，模型直接看到在场者相关的秘密、当前状态栏、未触发的关键场面、结束条件和行动提示方式（[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)）；交回合时能改状态栏、创造秘密、触发场面、带提醒、在作品允许时完结（[§5–6](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。client 能查主角视角的状态栏。

**依赖。** T16。

**拥有的文件。** `packages/core/src/play/context.ts`、`narrator-prompt.ts`、`propose-turn-tool.ts` 及测试；`play/service.ts` 的 `runTurnRequest`、`submitAction`、`getRoute`、`getStatus`；`story/tools.test.ts`、`play/context.test.ts` 的 token 棘轮数字。

**先读。** [回合循环 §3、§5、§6](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)；[数据模型 §4](../docs/data-model.md#4-故事事实)“状态栏目显示给谁”；本文 §1.4 D23–D26、附录 B.3、C.3、C.4；T16 的全部新函数；现有 `play/context.ts`、`propose-turn-tool.ts`、`service.ts`。

**步骤。**

- [ ] 1. `context.ts`：
  - `NarratorContextInput` 加 `settings: WorkSettings`。
  - 新增四个约束性块，放在【主角】之后、当前场景之前，按顺序：【行动提示】、【结束条件】、【状态栏】、【和在场者有关的秘密】、【未触发的关键场面】。格式见附录 C.3；空的块（没有栏目、没有秘密、没有场面）不出现，【行动提示】和【结束条件】总是出现。
  - 场面编号：`meta.keyScenes` 里去掉“只发生一次且已触发”（`sceneHitIds`）的，按原顺序编为 `S1`、`S2`…。
  - 这些块都算进 `required`（超出预算时按现有规则失败）。
  - 成功结果加 `sceneCodes: Array<{ code: string; id: string; once: boolean }>`、`secretLines`、`stateLines`、`sceneLines`（行数）。
- [ ] 2. `narrator-prompt.ts`：`NARRATOR_SYSTEM_PROMPT`、`PROPOSE_TURN_DESCRIPTION` 换成附录 B.3。
- [ ] 3. `propose-turn-tool.ts`：
  - `PROPOSE_TURN_PARAMETERS` 的 `options`、`changes`、`ending` 说明换成附录 B.3（`changes` 加五种新类型的示例行）。
  - `parseProposeTurnArgs(args, ctx: { hintMode: HintMode; endingAllowed: boolean })`：选项用 `allowHint: ctx.hintMode === 'known_consequences'`；`ending` 只接受 `"true"` / `"false"`，`"true"` 而 `endingAllowed` 为假时报错“这部作品没有结束条件，ending 只能填 "false"。”。`ProposedTurnDraft` 加 `ending: boolean`，`options` 带 `hint`。
- [ ] 4. `service.ts` 的 `runTurnRequest`：
  - 组装上下文时传 `settings: readSettings(meta)`。
  - `parseProposeTurnArgs(args, { hintMode: settings.actions.hints, endingAllowed: Boolean(meta.ending?.trim()) })`。
  - `parseChanges` 传 `keyScenes: context.sceneCodes`。
  - `findLeaks` 传 `extras`：每个选项的 `hint`，加上本次 `changes.states` 里 `visible` 为真的非清单值、`changes.stateItems` 的 `item`。
  - 提交事务：`turns.ending` 写 `proposal.draft.ending ? 1 : 0`；`writeChanges` 传 `parentStates`：对投影里每个栏目，`stateAt(projection, id, parent.depth)` 有值就放进 `Map`。
  - `turn.context` 样本加 `secretLines`、`stateLines`、`sceneLines`。
- [ ] 5. `submitAction`：head 回合 `ending === 1` 时 `throw appError('invalid_input', 'route ended')`。
- [ ] 6. `getRoute`：`ended` 改成 head 回合的 `ending === 1`；`turnView` 的 `options` 改为原样带出存下的 `hint`（没有时 `null`）。
- [ ] 7. `getStatus(input)`：取路线、开局、祖先链、`loadProjection`，`buildStatusView(projection, route.id)`；记 `story.status` 样本（`data: { columns, closed }`）。
- [ ] 8. 测试：
  - `context.test.ts` 补：
    - `状态栏、秘密、场面、结束条件进入上下文`：夹具有一个数字栏目、一个和在场人物有关的秘密、一个未触发场面、结束条件；`prompt` 含【状态栏】、【和在场者有关的秘密】、`S1`、【结束条件】四个字面量。
    - `已触发的一次性场面不再列出`。
    - `和在场者无关的秘密不直接给`（阳性对照：有关的那条在）。
    - `幕后栏目标明不显示给玩家`：`prompt` 里该栏目那一行含“幕后”。
    - 更新 token 棘轮：先跑一遍拿到新数字，**在汇报里写清**每一段新增文字占了多少；不要只改数字。
  - `propose-turn-tool.test.ts` 补：`没有结束条件时不能完结`、`有结束条件时可以完结`、`只显示行动的作品不接受提醒`。
  - `service.test.ts` 补：
    - `回合提交状态变化，状态栏查询看得到`：模型交 `{"type":"state","key":"潮位","value":"3","visible":"true"}`；`getStatus` 的 `columns[0].value` 为 `{ display: 'number', value: 3, … }`，`changed: true`。
    - `完结后路线显示已完结，不能再提交行动`：交 `ending: "true"`（作品有结束条件）；`getRoute().ended === true`；再 `submitAction` 抛 `invalid_input`。
    - `回合里创造的秘密，主角得知前不进手记`。
    - `触发关键场面后同一路线不能再触发`：第一回合 `scene_hit` S1 成功，第二回合再交 S1 被退回（`turn.changes.rejected` 事件），阳性对照：第一回合确实写进了 `scene_hit` 事实。
    - `提醒被保存并返回给 client`。

**接线点。** `getStatus` 一处（替换占位）；`runTurnRequest` 里四处传参。`grep -rn "not implemented:" packages/core/src` 在本任务结束时零命中（T18 已接完其余的）——如果 T18 还没合并，只剩 T18 的那几个。

**注意事项。**

- 【状态栏】给模型看的是叙述者视角：幕后栏目、隐藏的值、全部阶段名都给出，并标明哪些不显示给玩家。给 client 的 `getStatus` 才是主角视角（T16 的 `buildStatusView`）。两者不要混用。
- 秘密“和在场者有关”的判断：秘密的 `subject` 在场，或任一知情者在场（含主角）。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `endingAllowed` 写死成 `true`，`没有结束条件时不能完结` 必须红。
- 突变二：在 `context.ts` 里不过滤已触发的一次性场面，`已触发的一次性场面不再列出` 必须红。
- 突变三：`writeChanges` 不传 `parentStates`（传空 `Map`），T16 的清单合并在这条路径上会丢旧条目；在 `service.test.ts` 加一条“清单第二回合追加条目，第一回合的条目还在”，它必须红。
- `grep -rn "not implemented:" packages/core/src` 零命中（W5、W6 都合并之后由编排者复核）。

---
### T21 client：补充设定编辑

**目的。** 首屏仍然只要求背景（[创作流程 §2](../docs/authoring-flow.md#2-写背景只补自己在意的设置)）。展开「补充设定」后，作者可以按节填写八节设定和主角填写项，和背景一起自动保存。背景步骤的主按钮变成「生成故事方案」。

**依赖。** T10、T01。

**拥有的文件。** `apps/client/src/features/authoring/SettingsSections.tsx`、`SettingsSections.module.css`、`SettingsSections.test.tsx`、`ProtagonistFieldsEditor.tsx`、`ProtagonistFieldsEditor.module.css`、`ProtagonistFieldsEditor.test.tsx`、`settings-labels.ts`、`settings-labels.test.ts`（新建）；`BackgroundEditor.tsx`、`BackgroundEditor.module.css`、`draft.ts`；`apps/client/src/i18n/zh-CN/authoring.json` 里附录 A.2 标为 T21 的键。

**先读。** [创作流程 §2](../docs/authoring-flow.md#2-写背景只补自己在意的设置)；[apps/client/AGENTS.md](../apps/client/AGENTS.md) 全文；[a11y §9](../docs/a11y.md#9-创作页与工作站)；T01 的截图；现有 `BackgroundEditor.tsx`（自动保存、补充设定的折叠、`client.preview_visible` 样本）、`shared/ui/TextArea.tsx`、`TextField.tsx`、`RadioGroup.tsx`、`OverflowMenu.tsx`、`IconButton.tsx`。

**步骤。**

- [ ] 1. `draft.ts`：`DraftContent` 加 `settings: WorkSettings`；`sameDraft` 再比较 `JSON.stringify(left.settings) === JSON.stringify(right.settings)`。
- [ ] 2. `settings-labels.ts`：四张对照表（§2.4）：`CAST_MODE_LABEL_KEYS: Record<CastMode, string>`、`HINT_MODE_LABEL_KEYS`、`OPENING_MODE_LABEL_KEYS`、`SETTING_SECTION_HEADING_KEYS: Record<SettingSectionId, string>`，值是附录 A.2 的键。`settings-labels.test.ts`：对 `CAST_MODES`、`HINT_MODES`、`OPENING_MODES`、`SETTING_SECTION_IDS` 每一个值都查得到存在的键（先断言数组非空；用 `shared/test/i18n.ts` 的现有写法检查键存在）。
- [ ] 3. `ProtagonistFieldsEditor.tsx`：

  ```ts
  export function ProtagonistFieldsEditor(props: { fields: ProtagonistField[]; onChange: (fields: ProtagonistField[]) => void }): JSX.Element;
  ```

  - 每一项一行：`TextField`（项目名，`label: t('authoring:settings.protagonist.fieldName')`）、`TextField`（默认值）、移除按钮（`IconButton`，`label` 带项目名插值）。
  - 列表下方一个 `RadioGroup`（`label: t('authoring:settings.protagonist.nameField')`），选项是“没有”加每一项的名字，选中的那一项 `isName: true`、其余为 `false`。这样结构上就保证最多一项是主角名。
  - 「添加填写项」按钮，达到 `PROTAGONIST_FIELDS_MAX` 时禁用，并在按钮旁写明原因（`aria-describedby`）。
  - 名字的即时校验：不符合 `PROTAGONIST_FIELD_NAME_PATTERN` 时显示 `authoring:settings.protagonist.nameInvalid`；重名时显示 `nameDuplicate`。有错误的项照样放进草稿（自动保存会因契约校验失败而报错），所以**有错误时不调用 `onChange`**，只在本地显示错误，改对之后再上报。
- [ ] 4. `SettingsSections.tsx`：

  ```ts
  export function SettingsSections(props: {
    settings: WorkSettings;
    onChange: (settings: WorkSettings) => void;
    openingTextRef?: Ref<HTMLTextAreaElement>;
  }): JSX.Element;
  ```

  八节按 `SETTING_SECTION_IDS` 的顺序，每节一个 `h3`（文字来自 `SETTING_SECTION_HEADING_KEYS`）、一段说明、一个 `TextArea`。各节另有：
  - `protagonist`：`ProtagonistFieldsEditor`。
  - `cast`：`RadioGroup`（`appearance: 'segmented'`），选项来自 `CAST_MODES`。
  - `opening`：`RadioGroup`（选项来自 `OPENING_MODES`），`TextArea` 的标签和占位文字随模式变化（附录 A.2 `settings.opening.text.<mode>`）；`author_text` 模式且有填写项时，`TextArea` 下方一个 `OverflowMenu`「插入填写项」，菜单项是每个填写项的名字，选中后在光标处插入 `{{protagonist.<名字>}}`（用 `openingTextRef` 取 `selectionStart`、`selectionEnd`，算出新文本后 `onChange`，再把光标放到插入内容之后）。
  - `actions`：`RadioGroup`，选项来自 `HINT_MODES`。
- [ ] 5. `BackgroundEditor.tsx`：
  - 现有的「补充设定」折叠区里，三处锚点之后接 `SettingsSections`。折叠标题的“已填 N 项”把八节里非空的 `text`、非默认的选择、填写项个数都算进去。
  - `save` 把 `settings: next.settings` 一起交给 `api.works.saveDraft`；写回查询缓存时一并写 `settings`。
  - 主按钮改成「生成故事方案」（`authoring:plan.generate`）；方案已存在时改成「重新生成方案」（`authoring:plan.regenerate`）。props 改为：

    ```ts
    {
      work: WorkDetail;
      draft: DraftContent;
      savedDraft: DraftContent;
      onDraftChange: (draft: DraftContent) => void;
      onGeneratePlan: (contentRev: number) => void;
      generating: boolean;
      planJob: PlanJobView | null;
    }
    ```

  - 把 `client.preview_visible` 的计时整段**删掉**（它挪到开场面板，T23），换成 `client.plan_visible`：点按钮时记起点，`planJob` 不再是 `running` 时上报一次（同一个 `jobId` 只报一次），`outcome` 为 `done → 'ok'`、否则 `'error'`。
  - 宣告区的文字换成方案的三种状态（附录 A.2 `plan.running`、`plan.done`、`plan.failed`）。
- [ ] 6. 测试：
  - `ProtagonistFieldsEditor.test.tsx`：`最多一项是主角名`（选中第二项后第一项的 `isName` 变成 `false`，断言 `onChange` 收到的参数）；`名字不合规时不上报`（输入 `主角.名`，`onChange` 没被调用，页面上有错误文字）；`达到上限后不能再添加`；axe 检查。
  - `SettingsSections.test.tsx`：`切换主要人物模式`（断言 `onChange` 收到 `cast.mode === 'per_run'`）；`作者原文模式可以插入填写项`（在第 3 个字后插入，结果字符串的第 3 位起是 `{{protagonist.名字}}`）；`没有填写项时不显示插入菜单`；axe 检查。
  - `AuthoringPage.test.tsx` 里背景步骤相关的现有用例（这个文件归 T23，本任务只改 `BackgroundEditor` 自己的测试）：如果 `BackgroundEditor` 有单独的测试，补 `保存时带上补充设定`（假 API 记下的 `works.saveDraft` 入参含 `settings.cast.mode`）和 `方案生成结果出现后上报一次 client.plan_visible`（记下的 `log.client` 调用正好一次、`metric` 为字面量 `'client.plan_visible'`）。没有单独的测试文件就新建 `BackgroundEditor.test.tsx`。

**接线点。** `BackgroundEditor` 的调用方是 `AuthoringPage`（T23 改调用处）。本任务结束时 `AuthoringPage.tsx` 还按旧 props 调用会导致类型错误：**本任务允许在 `AuthoringPage.tsx` 里只改 `BackgroundEditor` 那一处调用的 props**（`onGeneratePlan` 先接一个调用 `api.works.generatePlan` 的最小 mutation），其余留给 T23。

**注意事项。**

- 所有标签、说明、占位、按钮文字来自附录 A.2，不自己写。
- 补充设定很长：八节的 `TextArea` 用 `minRows={2}`，不要默认撑满。
- 不在 client 里做契约以外的校验；填写项的规则和 contracts 的 `ProtagonistFieldSchema` 一致，直接用它 `safeParse`。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：把 `ProtagonistFieldsEditor` 的“有错误时不调用 onChange”删掉，`名字不合规时不上报` 必须红。
- 突变二：把 `client.plan_visible` 的“同一个 jobId 只报一次”守卫删掉，对应用例必须红（重渲染一次后上报两次）。
- `grep -n "client.preview_visible" apps/client/src/features/authoring/BackgroundEditor.tsx` 零命中。

### T22 client：方案面板

**目的。** 作者看到 AI 理解的方向：玩家身份、主要人物或人物位置、基调、开场处境，每项标出来源（[创作流程 §3](../docs/authoring-flow.md#3-确认故事方案再生成开场)）。秘密和结局默认折叠（D27）。作者可以直接改一项、删一项；AI 报告的冲突并列显示两段原话。

**依赖。** T10、T01。

**拥有的文件。** `apps/client/src/features/authoring/PlanPanel.tsx`、`PlanItemCard.tsx`、`PlanItemEditor.tsx`、`PlanConflicts.tsx`、`plan-labels.ts`、`placeholder-text.tsx` 及各自的样式和测试（新建）；`authoring.json` 里附录 A.2 标为 T22 的键。

**先读。** [创作流程 §3](../docs/authoring-flow.md#3-确认故事方案再生成开场)；[a11y §9](../docs/a11y.md#9-创作页与工作站)（差异用文字标出、不只靠颜色）；本文 §1.4 D15、D27；T01 的截图；现有 `CastList.tsx`、`PreviewPanel.tsx`（版式参照）、`shared/ui/Badge.tsx`、`Card.tsx`、`ConfirmDialog.tsx`、`GeneratingMarker.tsx`、`ErrorNotice.tsx`。

**步骤。**

- [ ] 1. `plan-labels.ts`：对照表 `PLAN_SOURCE_LABEL_KEYS: Record<PlanSource, string>`、`PLAN_SUMMARY_LABEL_KEYS: Record<PlanSummaryKey, string>`、`STATE_DISPLAY_LABEL_KEYS: Record<StateDisplay, string>`、`PLAN_ENTITY_ROLE_LABEL_KEYS`，加测试（同 T21 第 2 步）。来源徽标一律 `tone: 'neutral'`，文字分别为「作者」「作者确认」「AI 补全」：来源靠文字区分，不靠颜色（T01 稿子 `authoring-plan-light.png`）。
- [ ] 2. `placeholder-text.tsx`：`PlaceholderText({ text }: { text: string })`。用 `PLACEHOLDER_PATTERN` 的同一个正则（在 client 里写一份 `/\{\{protagonist\.([^{}]+)\}\}/gu`，并在测试里用 contracts 的 `PROTAGONIST_FIELD_NAME_PATTERN` 证明合法的名字都能被它匹配）把文本切开，普通部分原样输出，占位符输出成 `<span className={styles.token}>{t('authoring:placeholder.token', { name })}</span>`（显示为「名字」）。纯文本渲染，不用 `dangerouslySetInnerHTML`。
- [ ] 3. `PlanItemCard.tsx`：一项一行，左边是“标题 + 来源徽标”和正文，右边一个铅笔图标按钮（`IconButton`，`label` 为 `plan.item.editLabel` 插值标题）。「删除」不放在行上，放进 `PlanItemEditor` 的编辑表单里（主角项的编辑表单没有「删除」）。按 `kind`：
  - `summary`：标题来自 `PLAN_SUMMARY_LABEL_KEYS`，正文是 `text`。
  - `entity`：名字、角色（主角 / 主要人物 / 其他）、种类、档案；`knownAs` 不为空时一行“主角称作：…”；有 `slot` 时显示“人物位置：<作用>”和“相遇样例：<encounter>”。主角项没有「删除」。
  - `secret`：只在幕后展开时渲染（见第 6 步），标题行写“秘密 · <title>”，正文三行：“真相：…”“知情：<名字，用、连接>”“揭晓条件：…”。
  - `state`：标签、显示方式、配置摘要（数字写范围和单位；阶段写全部阶段名——作者视角能看全部）、`hidden` 时“幕后”徽标、初始值。
  - `scene`：条件、发生什么、“只发生一次”。
  - `ending`：同 `secret`，只在幕后展开时渲染，标题“结束条件”，正文是原文。
- [ ] 4. `PlanItemEditor.tsx`：按 `kind` 的编辑表单（文字用 `TextField` / `TextArea`，选择用 `Select` / `RadioGroup`，数字用 `NumberField`）。「保存」调用 `onSave(item)`，「取消」调用 `onCancel()`，「删除」（危险样式，主角项不显示）调用 `onRemove()`，由 `PlanPanel` 先弹 `ConfirmDialog` 再删。保存前用 contracts 的 `PlanItemSchema.safeParse` 校验，失败时在对应字段下显示附录 A.2 的 `plan.edit.invalid`，不提交。
- [ ] 5. `PlanConflicts.tsx`：每条冲突一个 `article`，标题“两条设定互相矛盾”，下面并列两段原话（`blockquote`，前面分别标“第一条”“第二条”），再一行“影响：…”。
- [ ] 6. `PlanPanel.tsx`：

  ```ts
  export function PlanPanel(props: {
    work: WorkDetail;
    busy: boolean;
    onRegenerate: () => void;
    onAdoptStale: (jobId: string) => void;
    onUpdateItem: (item: PlanItem) => void;
    onRemoveItem: (itemId: string) => void;
    onConfirm: () => void;
  }): JSX.Element;
  ```

  - 区域是一个带 `h2` 的 `section`（「故事方案」），说明文字 `plan.intro`。顺序（照 T01 稿子）：任务状态提示 → 冲突 → 分组「摘要」→「人物与地点」（主角在前）→「状态栏」→「关键场面」→ 幕后控制卡 → 分组「幕后」（只在展开时出现，含秘密和结束条件）→ 底部操作行（「重新生成方案」次按钮 + 「确认方案，生成开场」主按钮，右对齐）。每个分组是一个 `h3` 加一张卡片，卡片里一项一行。
  - 任务状态：`latestPlanJob.status === 'running'` 显示 `GeneratingMarker` 和“正在生成故事方案”；`failed` 显示 `ErrorNotice`（`code`、`diagnosticId` 为任务 id）和「重新生成」；`stale` 为真时显示一张提示卡：图标 `info`、标题 `plan.staleTitle`、说明 `plan.stale`，右边「仍然采用」「重新生成」两个文字按钮。
  - 幕后控制卡：收起时图标 `eye-off`、标题 `plan.secret.foldedTitle`（插值条数：秘密数加上有没有结束条件）、说明 `plan.secret.foldedHelp`，并列出每个秘密的无剧透标题（[创作工作站 §6](../docs/author-workstation.md#6-工具)：折叠时只给标题），右边「查看幕后设定」；展开时图标 `eye`、标题 `plan.secret.expandedTitle`、说明 `plan.secret.expandedHelp`，右边「收起幕后设定」。按钮的 `aria-expanded` 反映状态，`aria-controls` 指向「幕后」分组。状态只存在组件的 `useState` 里，默认收起。
  - 删除用 `ConfirmDialog`（`tone: 'danger'`）。
  - 确认按钮「确认方案，生成开场」：方案为空或任务在运行时禁用，并写明原因；方案已确认时按钮旁显示「方案已确认」徽标。
- [ ] 7. 测试（`PlanPanel.test.tsx`、`PlanItemCard.test.tsx`、`placeholder-text.test.tsx`，用 `createFakeApi` 不需要：组件只通过 props 交互）：
  - `来源用文字标出`：一项 `source: 'ai'`，能 `getByText('AI 补全')`。
  - `秘密默认折叠`：秘密的 `statement` 不在文档里，`title` 在；点「查看幕后设定」后 `statement` 出现，按钮的 `aria-expanded` 为 `true`。阳性对照：同一个测试里 `title` 一直可见。
  - `折叠时只列出秘密的标题`：收起时秘密的 `title` 可见、`statement` 不可见，也没有秘密的编辑按钮。
  - `主角不能删除`：打开主角项的编辑表单，里面没有「删除」；打开另一个人物的编辑表单，有「删除」（阳性对照）。
  - `生成期间改过草稿时给出两个选择`：`latestPlanJob.stale: true`，点「仍然采用」调用 `onAdoptStale` 并带上任务 id。
  - `冲突并列两段原话`。
  - `编辑后交给 onSave 的项通过契约校验`：改一个状态栏栏目的标签后保存，`onUpdateItem` 收到的参数 `PlanItemSchema.safeParse` 成功、`label` 是新值。
  - `占位符显示为标签`：`'你好，{{protagonist.名字}}。'` 渲染出“「名字」”，不出现 `{{`。
  - 每个组件跑 axe。

**接线点。** `PlanPanel` 由 `AuthoringPage` 使用（T23）。本任务不改 `AuthoringPage.tsx`。

**注意事项。**

- 方案里的名字、档案、秘密原文都是 AI 输出或作者内容，纯文本渲染。
- 作者视角可以看到全部阶段名、幕后栏目；只有游玩页的状态栏才走主角视角。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：把秘密折叠的判断改成始终展开，`秘密默认折叠` 必须红。
- 突变二：把来源徽标改成只用颜色（去掉文字），`来源用文字标出` 必须红。

### T23 client：开场面板与创作页装配

**目的。** 创作页按步骤排出背景、方案、开场（[创作工作站 §2](../docs/author-workstation.md#2-页面结构)），当前步骤用 `aria-current="step"` 标出（[a11y §9](../docs/a11y.md#9-创作页与工作站)）。确认方案一次点击即开始生成开场。开场预览显示提醒、初始状态和待处理的句子；采用后「开始故事」进入开局页。

**依赖。** T21、T22。

**拥有的文件。** `apps/client/src/features/authoring/WizardSteps.tsx`、`WizardSteps.module.css`、`WizardSteps.test.tsx`（新建）；`AuthoringPage.tsx`、`AuthoringPage.module.css`、`AuthoringPage.test.tsx`；`PreviewPanel.tsx`、`PreviewPanel.module.css`；`CastList.tsx`；`PublishedPanel.tsx`；`authoring.json` 里附录 A.2 标为 T23 的键。

**先读。** [创作流程 §3–4](../docs/authoring-flow.md#3-确认故事方案再生成开场)；[a11y §3](../docs/a11y.md#3-页面结构)、[§9](../docs/a11y.md#9-创作页与工作站)；T21、T22 的组件 props；现有 `AuthoringPage.tsx`、`PreviewPanel.tsx`、`PublishedPanel.tsx`。

**步骤。**

- [ ] 1. `WizardSteps.tsx`：`<nav aria-label={t('authoring:steps.label')}><ol>…</ol></nav>`，三步「背景」「方案」「开场」。当前步骤的按钮 `aria-current="step"`。可以进入的条件：背景总可以；方案在 `draft.plan` 不为空或有方案任务时可以；开场在 `draft.plan?.confirmed` 为真或已有预览任务时可以。不可进入的步骤按钮禁用。点击调用 `onSelect(step)`。
- [ ] 2. `AuthoringPage.tsx`：
  - 当前步骤：本地 `useState<WizardStep | null>`，为 `null` 时用 `work.draft.wizardStep`。切换时 `setStep(next)` 并调用 `api.works.setWizardStep({ workId, step: next })`（失败不提示：它只影响下次打开停在哪一步）。
  - mutation：`generatePlan`（成功后切到 `plan`）、`adoptStalePlan`、`updatePlanItem`、`removePlanItem`（这两个带 `baseContentRev: 缓存里的 draft.contentRev`）、`confirmPlan`（成功后**立刻**用返回的 `contentRev` 调 `generatePreview`，然后切到 `opening`）、`generatePreview`（开场面板的「重新生成开场」）、`adoptPreview`。每个成功后让 `queryKeys.work(workId)` 失效。错误统一进现有的 `error` 状态，由 `ErrorNotice` 显示。
  - 按步骤渲染：`background` → `BackgroundEditor`；`plan` → `PlanPanel`；`opening` → 开场区：预览任务的状态、`PreviewPanel`、「重新生成开场」。三步都在同一个页面里，`WizardSteps` 放在页面顶部。
  - `client.preview_visible`：从 T21 删掉的那段计时搬到这里，起点是 `confirmPlan` 被点下（或「重新生成开场」被点下），终点是预览任务不再 `running`，同一个 `jobId` 只报一次。
- [ ] 3. `PreviewPanel.tsx`（版式照 T01 稿子 `authoring-opening-review-light.png`）：开场区标题 `opening.heading`、说明 `opening.intro`；依次是「公开设定」卡、「开场里新出现的」卡（`CastList`）、「开局状态」卡、纸面预览、「这些句子需要先改」卡、底部操作行（「重新生成开场」次按钮、采用不可用时的原因文字、「采用开场并存入作品库」，右对齐）。
  - 正文、选项用 T22 的 `PlaceholderText` 渲染。
  - 选项有 `hint` 时，在选项下方一行显示提醒（附录 A.2 `preview.hint`）。
  - `preview.initialState` 不为空时，显示“开局状态”小节，列出 `label`、`text`；`visible` 为假的标“开局时不显示”。
  - `preview.needsReview` 不为空时，在纸面预览之后显示“这些句子需要先改”卡（标题前一个 `triangle-alert` 图标），每条两行：第一行“<位置> · <原因>”（位置为第 N 段 / 第 N 个推荐行动，原因为写死了主角名 / 未知的填写项），第二行是那句原文加引号；并把「采用开场并存入作品库」禁用，禁用原因 `preview.adoptBlocked` 显示在按钮左边，用 `aria-describedby` 关联到这张卡。
- [ ] 4. `CastList.tsx`：标题改用 `authoring:cast.headingOpening`（“开场里新出现的”）；去掉“主角”那一类（主角不再在预览的 `cast` 里），其余不变。
- [ ] 5. `PublishedPanel.tsx`：「开始故事」改成 `Link` 到 `/works/$workId/start`（参数 `workId: work.id`），不再读 `work.routeId`。
- [ ] 6. 测试（`AuthoringPage.test.tsx` 改写；`createFakeApi`）：
  - `只写背景一路点到开场`：背景 → 「生成故事方案」→ 假 API 返回带方案的 `works.get` → 方案面板出现 → 「确认方案，生成开场」→ 假 API 记下的调用依次是 `works.confirmPlan`、`works.generatePreview`，后者的 `contentRev` 等于前者的返回值（从记录现取）。
  - `当前步骤用 aria-current 标出`：切到方案后，方案按钮 `aria-current="step"`，背景按钮没有这个属性。
  - `方案没确认时不能进入开场`。
  - `待处理的句子挡住采用`：预览带一条 `needsReview`，采用按钮禁用，`aria-describedby` 指向的元素含“第 1 段”。
  - `采用后开始故事进入开局页`：`PublishedPanel` 的链接 `href` 以 `/works/<id>/start` 结尾。
  - `确认方案后上报一次 client.preview_visible`。
  - `WizardSteps.test.tsx`：axe；不可进入的步骤禁用。

**接线点。** `AuthoringPage` 的三个子区域；`PublishedPanel` 的链接。`grep -rn "work.routeId\|work\.routeId" apps/client/src/features/authoring` 零命中（T26 要删掉 `WorkDetail.routeId`）。

**注意事项。**

- 确认方案和生成开场是两个请求。中间失败（确认成功、生成失败）时，方案已经确认，停在开场步骤显示错误和「重新生成开场」，不回滚确认（[创作流程 §3 第 4 步](../docs/authoring-flow.md#3-确认故事方案再生成开场)）。
- 路由切换和步骤切换的焦点：切换步骤后把焦点移到新步骤区域的 `h2`。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：确认成功后不调 `generatePreview`，`只写背景一路点到开场` 必须红。
- 突变二：去掉 `aria-current`，`当前步骤用 aria-current 标出` 必须红。

### T24 client：开局页与作品库入口

**目的。** 已可玩的作品第一次进入时，作者留了填写项就先问这些（[游玩流程 §1](../docs/gameplay-flow.md#1-进入作品找到正确的起点)）；每局生成人物的作品显示开场生成中、失败时能「重试这次开局」或返回作品库（[游玩流程 §5 中断与恢复](../docs/gameplay-flow.md#5-离开存档和尝试另一条路)）。作品库卡片提供「开始故事」和「重新开局」。

**依赖。** T10、T01。

**拥有的文件。** `apps/client/src/features/play/StartPage.tsx`、`StartPage.module.css`、`StartPage.test.tsx`、`OpeningPendingPage.tsx`、`OpeningPendingPage.module.css`、`OpeningPendingPage.test.tsx`（新建）；`apps/client/src/app/router.tsx`；`apps/client/src/app/App.tsx` 的事件分发；`apps/client/src/features/library/WorkCard.tsx` 及 `LibraryPage.test.tsx` 里卡片相关的用例；`apps/client/src/shared/api/query.ts` 的三个键；`library.json`、`play.json` 里附录 A.3、A.4 标为 T24 的键。

**先读。** [游玩流程 §1](../docs/gameplay-flow.md#1-进入作品找到正确的起点)；[a11y §3](../docs/a11y.md#3-页面结构)（路由切换时更新标题、移动焦点）；T01 的截图；现有 `router.tsx`、`WorkCard.tsx`、`shared/ui/Page.tsx`、`TextField.tsx`、`GeneratingMarker.tsx`。

**步骤。**

- [ ] 1. `query.ts`：加 `startInfo: (workId: string) => ['startInfo', workId] as const`、`playthrough: (playthroughId: string) => ['playthrough', playthroughId] as const`、`status: (routeId: string) => ['status', routeId] as const`。`status` 由 T25 使用，放在这里是为了让 T25 开工时键已经存在。
- [ ] 2. `App.tsx` 的事件循环加两处：`turn.committed` 时再让 `queryKeys.status(event.routeId)` 失效；`playthrough.updated` 时让 `queryKeys.playthrough(event.playthroughId)` 失效。
- [ ] 3. `router.tsx`：加路由 `/works/$workId/start` → `StartPage`、`/playthroughs/$playthroughId` → `OpeningPendingPage`，写法同现有的 `worksEditRoute`。
- [ ] 4. `StartPage.tsx`（`{ workId }`）：
  - `useQuery(startInfo)`。页面标题是作品标题（没有时用 `play:page.untitled`），工具行起始端是返回作品库。
  - 开局 id 用 `useState(() => crypto.randomUUID())` 生成一次，所以双击、重渲染都提交同一个 id（core 幂等）。
  - 页面内容区一个 `h2`（`start.heading`）和说明 `start.intro`（照 T01 稿子 `start-fields-light.png`）。
  - 有填写项：一个表单，每项一个 `TextField`，`label` 是项目名，`placeholder` 是默认值，`description` 是附录 A.4 `start.fieldHelp`（插值默认值）。值的长度上限用 contracts 的 `PROTAGONIST_VALUE_MAX_LENGTH`。主按钮「开始故事」。
  - 没有填写项：页面挂载后直接提交一次（`useEffect` 里调 `start.mutate`，靠 `mutation.isIdle` 守住只调一次），显示“正在打开故事”。
  - 成功：返回的 `routeId` 不为空 → `navigate({ to: '/play/$routeId', params, replace: true })`；为空 → `navigate({ to: '/playthroughs/$playthroughId', params, replace: true })`。
  - 失败：`ErrorNotice`；`not_published` 时给「返回作品库」。
- [ ] 5. `OpeningPendingPage.tsx`（`{ playthroughId }`）：
  - `useQuery(playthrough)`。
  - `routeId` 不为空 → 立即 `navigate` 到游玩页（`replace: true`）。
  - `opening.status === 'running'`：`h2` 为 `openingRequest.pending`，下面 `GeneratingMarker` 和说明 `openingRequest.pendingHelp`（照 `start-pending-light.png`）。宣告区播报一次。
  - `opening.status === 'failed'`：`h2` 为 `openingRequest.failed`，下面 `ErrorNotice`（`code: opening.error`，`diagnosticId: opening.id`）、一句 `openingRequest.keptCast`、主按钮「重试这次开局」（`rotate-ccw` 图标，`api.play.retryOpening({ requestId: opening.id })`）和文字按钮「返回作品库」（照 `start-failed-light.png`）。
  - 新状态靠事件流里的 `playthrough.updated` 让查询失效（本任务第 2 步），本页不轮询。
- [ ] 6. `WorkCard.tsx`：
  - 可玩且 `routeId` 为空 → 主入口是 `Link` 到 `/works/$workId/start`，文字「开始故事」。
  - 可玩且有 `routeId` → 照旧进游玩页（「继续游玩」或「开始故事」）。
  - 可玩时更多操作里加「重新开局」（`library:card.restart`），导航到 `/works/$workId/start`。
- [ ] 7. 测试：
  - `StartPage.test.tsx`：`有填写项时先填再开始`（假 API 记下的 `play.start` 入参 `protagonist` 为 `{ 名字: '阿岚' }`，字面量）；`留空的项不传空格以外的内容`（不填直接点开始，入参里这一项为 `''`，由 core 补默认值）；`没有填写项时自动开始一次`（`play.start` 只被调用一次）；`固定人物成功后进入游玩页`（`routeId` 有值，路由变成 `/play/<id>`）；`每局生成时进入等待页`（`routeId: null`）；axe。
  - `OpeningPendingPage.test.tsx`：`失败时可以重试这次开局`（点按钮后记下 `play.retryOpening` 且 `requestId` 正确）；`完成后进入游玩页`；axe。
  - `LibraryPage.test.tsx` 补：`可玩但没开过局的作品指向开局页`；`更多操作里有重新开局`。

**接线点。** `router.tsx` 两条路由；`WorkCard` 两处入口。`grep -rn "'/works/\$workId/start'" apps/client/src` 至少命中 `router.tsx`、`WorkCard.tsx`、`PublishedPanel.tsx`（T23）。

**注意事项。**

- 填写项的名字是作者写的内容，直接当标签显示，纯文本渲染。
- 不在 client 里替换占位符或判断人物模式；这些都在 core。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：把开局 id 改成每次点击时生成，`没有填写项时自动开始一次` 或重复点击的用例必须红（在 `StartPage.test.tsx` 里加一条“连点两次只用一个开局 id”，断言两次调用的 `playthroughId` 相同）。
- 突变二：`WorkCard` 在 `routeId` 为空时仍然链接到游玩页，`可玩但没开过局的作品指向开局页` 必须红。

### T25 client：游玩页的状态栏、提醒、完结

**目的。** 最新段落之后是当前状态，再往下是行动（[游玩流程 §2](../docs/gameplay-flow.md#2-读一段决定一步)、[§4](../docs/gameplay-flow.md#4-看当前状态查过去发生的事)）。状态栏按显示方式呈现、标出本回合的变化、能展开来历并跳回原文；推荐行动可以带提醒；路线完结后不再显示行动输入（D25）。

**依赖。** T24（`queryKeys.status` 和 `App.tsx` 里的失效）、T01。

**拥有的文件。** `apps/client/src/features/play/StatusBar.tsx`、`StatusColumn.tsx`、`StatusHistory.tsx`、`EndedPanel.tsx` 及各自的样式和测试（新建）；`OptionList.tsx`、`OptionList.module.css`；`PlayPage.tsx`、`PlayPage.module.css`、`PlayPage.test.tsx`；`play.json` 里附录 A.4 标为 T25 的键。

**先读。** [游玩流程 §2、§4、§6](../docs/gameplay-flow.md#2-读一段决定一步)；[数据模型 §4 栏目的显示方式](../docs/data-model.md#4-故事事实)；[a11y §8](../docs/a11y.md#8-游玩页)；[动效](../docs/motion.md)里状态变化的编排（有就照做，没有就不加动效）；T01 的截图；现有 `PlayPage.tsx`（`jumpToSource`、`turnHeadingId`）、`JournalSheet.tsx`、`OptionList.tsx`、`App.tsx` 的事件循环。

**步骤。**

- [ ] 1. 确认前提：`queryKeys.status` 存在，`App.tsx` 在 `turn.committed` 时让它失效（T24）。不存在就停下来汇报。
- [ ] 2. `StatusColumn.tsx`（一个栏目；版式照 T01 稿子 `play-status-hints-light.png`、`play-status-history-light.png`）：
  - 栏目本身不是按钮：按钮的子元素对读屏是“仅展示”的，里面的 `role="meter"` 会失去数值。第一行是 `label`，右上角一个 `history` 图标按钮（`IconButton`，`label` 为 `status.historyTitle` 插值栏目名，`aria-expanded`）打开来历气泡，有来历的栏目才显示它；本回合变了的栏目整块用 `--uw-*` 的强调底色（和 M2 的“刚变化”高亮同一个 token）。
  - `number`：`value` 加“/ max”（`status.ofMax`）和单位；有增减时紧跟增减标记；`min`、`max` 都有时下面一条进度条，`role="meter"`，`aria-valuemin`、`aria-valuemax`、`aria-valuenow`，宽度用 CSS 自定义属性 `--status-ratio`（`style` 只写自定义属性，[主题与 token §10](../docs/theme.md#10-组件怎样使用-token)）。
  - `stage`：当前阶段名，后面跟 `status.step`（“第 1 步，共 4 步”），下面一排分段（`total` 段，前 `step` 段填满）。
  - `list`：每项一行：状态图标（`circle` 进行中、`circle-check` 已完成、`circle-x` 落空）、条目原文；已完成和落空在条目后写状态文字；进行中只有图标，另加 `VisuallyHidden` 的“进行中”，所以状态不只靠图标。`change` 为 `new` 的条目后加「新」徽标，`changed` 的条目整行用变化高亮。
  - `text`：原文；`changed` 时下面一行“原来：…”。
  - 变化标记都是文字，不只靠颜色：`isNew` → 标题旁「新」徽标；数字写增减（`+2` / `−1`）；文字写“原来：…”；阶段写“原来在第 N 步”。
  - 栏目两列排布（宽窗两列、窄窗一列），清单和阶段栏目占满一行。
- [ ] 3. `StatusHistory.tsx`：用 Base UI 的 `Popover`（`@base-ui/react` 已安装）做来历气泡，锚在栏目的来历图标按钮下方。标题 `status.historyTitle`（插值栏目名）；每条变化一段：第一行“第 N 回合”（`depth === 0` 写“开场”），最新的一条后加「当前」徽标；第二行是那时的显示文字；第三行文字按钮「跳回这一回合」，调用 `onJumpToTurn(turnId)` 并关闭气泡；末尾一行说明 `status.historyNote`。按 Esc 关闭，焦点回到栏目按钮。
- [ ] 4. `StatusBar.tsx`（`{ routeId, onJumpToTurn }`）：`useQuery(status)`；`columns` 为空且 `closed` 为空时什么都不渲染；否则一张卡片样式的 `section`，标题 `h2`「当前状态」，列出 `columns`；`closed` 不为空时末尾一行可展开的“已了结 N 项：<栏目名，用、连接>”（`chevron-right` 图标，`aria-expanded`），展开后同样列出这些栏目。
- [ ] 5. `OptionList.tsx`：`options` 的类型改为 `Array<{ text: string; hint: string | null }>`；有 `hint` 时在选项按钮里、文字下方另起一行显示，按钮用 `aria-describedby` 关联这一行。
- [ ] 6. `EndedPanel.tsx`（`{ workId }`）：一个带 `h2`（「故事到这里结束了」）的 `section`，一段说明，「重新开局」（`Link` 到 `/works/$workId/start`）和「返回作品库」。
- [ ] 7. `PlayPage.tsx`：
  - `showActions` 为真时，在行动区上方渲染 `StatusBar`。`route.data.ended` 为真时不渲染行动区，改为 `StatusBar` 加 `EndedPanel`。
  - `onJumpToTurn(turnId)`：滚到 `turnHeadingId(turnId)` 对应的元素并聚焦，复用 `jumpToSource` 的高亮写法（高亮目标是回合标题）。
  - 宣告区：路线刚变成完结时播报一次「故事到这里结束了」。
- [ ] 8. 测试：
  - `StatusColumn.test.tsx`：`数字栏目给出进度条的可读数值`（`getByRole('meter')` 的 `aria-valuenow` 为 `'3'`）；`阶段栏目只写当前阶段名`（给视图里本来就没有未到达的阶段名，断言渲染出的文字含“第 2 步，共 4 步”）；`变化用文字标出`（`changed`、`previous: 5`、`value: 3` 时有“−2”）；`清单状态不只靠图标`（有“已完成”文字）；axe。
  - `StatusBar.test.tsx`：`没有栏目时不渲染`；`已了结的栏目默认收起`；`来历能跳回回合`（点栏目的来历图标按钮打开气泡，再点「跳回这一回合」，`onJumpToTurn` 收到 `turnId`，气泡关闭）；`进行中的清单条目有可读的状态文字`（`getByText('进行中')` 存在，即使视觉上隐藏）。
  - `OptionList.test.tsx`（新建或补）：`提醒用 aria-describedby 关联`。
  - `PlayPage.test.tsx` 补：`完结后不显示行动输入，提供重新开局`（`ended: true` 时没有 `getByRole('textbox', { name: '你的行动' })`，有链接「重新开局」）；`回合提交后重新读取状态栏`（模拟事件流的 `turn.committed` 后，假 API 记下第二次 `play.getStatus`）。
  - `EndedPanel.test.tsx`：axe。

**接线点。** `PlayPage` 两处（`StatusBar`、`EndedPanel`）。`grep -rn "StatusBar\|EndedPanel" apps/client/src/features/play/PlayPage.tsx` 两处命中。

**注意事项。**

- 状态栏的值、来历文字、清单条目是 AI 输出，纯文本渲染。
- 状态栏只在最新决定点显示（[游玩流程 §2](../docs/gameplay-flow.md#2-读一段决定一步)），生成中、失败时随行动区一起隐藏。
- 变化标记的增减符号用全角减号“−”还是半角，跟随附录 A.4 的文案，不自己选。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：`PlayPage` 在 `ended` 时仍然渲染行动区，`完结后不显示行动输入，提供重新开局` 必须红。
- 突变二：在 `App.tsx` 里删掉让 `status` 失效的那一行（这一行属于 T24，突变只为验证本任务的用例，测完改回），`回合提交后重新读取状态栏` 必须红。
- 突变三：去掉进行中条目的 `VisuallyHidden` 文字，`进行中的清单条目有可读的状态文字` 必须红。

### T26 core 装配、集成测试、过渡字段清理

**目的。** 两条线合到一起后，用伪 OpenAI 服务把作者设定到游玩的全程跑一遍；收紧 §2.8 说的过渡字段；确认占位全部换掉。

**依赖。** T07、T08、T14、T18、T19、T23、T24、T25。

**拥有的文件。** `packages/core/src/app.integration.test.ts`；`packages/contracts/src/schemas/works.ts` 的两处收紧；`packages/core/src/library/service.ts` 删 `routeId` 的那一行；client 里因收紧而要改的调用点。

**先读。** 本文 §2.8；现有 `app.integration.test.ts` 的伪服务写法。

**步骤。**

- [ ] 1. 收紧：`SaveDraftInputSchema.settings` 去掉 `.optional()`；删掉 `WorkDetailSchema.routeId` 和 `getWork` 里对应的一行。跑 `pnpm typecheck`，按报错改 client 的调用点（预计只有测试的假数据）。core 的 `saveDraft` 里“`settings` 缺省时保留原值”的分支随之删除。
- [ ] 2. 集成用例（伪 OpenAI 服务，`startCore`）：
  - `只写背景走完全程`：建作品 → 写一句背景 → `generatePlan`（伪服务给 `proposePlanStep` 的默认值）→ `confirmPlan` → `generatePreview`（`proposePreviewStep`，按方案的新格式）→ `adoptPreview` → `play.start` → `getRoute` 有一个回合 → `submitAction`（`proposeTurnStep`）→ 两个回合。伪服务收到的第一个请求的 `model` 是 `author_chat` 用途的模型（给 `author_chat` 单独配一个模型 id，断言请求体里的字面量）。
  - `作者设定的秘密、栏目、场面在游玩中兑现`：附录 D.2 的方案；一回合里模型交 `state`、`scene_hit`、`knowledge`（主角得知秘密）；`getStatus` 有栏目，`getJournal` 有秘密，第二次 `scene_hit` 被退回。
  - `每局生成人物的作品开两局`：两局的人物名不同（伪服务给不同的名字）；第一局 `propose_opening` 失败一次后重试成功，人物名不变。
  - `有结束条件的作品可以完结`。
  - `独立运行和桌面通道下行为一致`：同一个用例用 `startCore` 跑一遍，再用 T03 的 `attachDesktopChannel` 加一个假 `parentPort` 跑一遍，两边 `works.list()` 的结果形状相同（只比较 `status`、`hasProgress`）。
- [ ] 3. 跑 `grep -rn "not implemented:" packages/core/src`，零命中。

**完成判据。**

- `pnpm typecheck`、`pnpm lint`、`pnpm test` 退出码都是 0。
- 突变：在 `confirmPlan` 里不写 `state_defs`，`作者设定的秘密、栏目、场面在游玩中兑现` 必须红。
- `grep -rn "routeId" packages/contracts/src/schemas/works.ts` 只剩 `WorkSummarySchema` 和 `AdoptPreviewOutputSchema` 两处。

### T27 浏览器端到端

**目的。** 用浏览器打开独立运行的 core，按 [docs/milestone-3.md 的验收](../docs/milestone-3.md#验收)走一遍浏览器能验的条目；旧的端到端用例改成新的创作流程。

**依赖。** T26。

**拥有的文件。** `e2e/tests/milestone-3.spec.ts`（新建）；`e2e/tests/smoke.spec.ts`、`milestone.spec.ts`、`milestone-2.spec.ts`、`acceptance.spec.ts` 里走创作流程的步骤。

**先读。** 现有四个 spec 的写法；`docs/milestone-3.md` 的验收表。

**步骤。**

- [ ] 1. 旧用例：凡是“写背景 → 生成开场预览 → 采用”的步骤，改成“写背景 → 生成故事方案 → 确认方案，生成开场 → 采用 → 开始故事”。伪服务的步骤相应多一个 `proposePlanStep`。只改流程，不改断言的意图；改完逐个跑通。
- [ ] 2. `milestone-3.spec.ts` 用例：
  - `只写一句背景一路点完`。
  - `秘密默认折叠，状态栏显示数字和进度条`（附录 D.2）。
  - `主角姓名留给玩家填写`：作者原文开场插入占位符，玩家填“阿岚”，开场和第一组选项显示“阿岚”。
  - `作者原文写死主角名时不能采用`：采用按钮禁用，列表写明第几段。
  - `每局生成人物开两局`。
  - `完结后提供重新开局`。
  - 每个页面跑一次 axe（`@axe-core/playwright`），零违规。
- [ ] 3. `pnpm e2e > "${TMPDIR:-/tmp}/uw-e2e.txt" 2>&1; echo $?`，退出码 0（含 T08 的 Electron 用例）。

**完成判据。**

- `pnpm e2e` 退出码 0。
- 突变：T23 的 `PreviewPanel` 在有 `needsReview` 时不禁用采用按钮，`作者原文写死主角名时不能采用` 必须红。

### T28 真实模型走查与收口

**目的。** 自动化只能证明材料送达、校验生效，不能证明真实模型交得出合格的方案、开场和状态变化。用真实模型走一遍，再按根目录 AGENTS 的规矩收口。

**依赖。** T27。

**拥有的文件。** 本文 §6 台账；`docs/` 里走查暴露出的设计偏差（先报维护者再改）。

**步骤。**

- [ ] 1. 维护者配置的真实模型（`narrator`、`author_chat` 各一个），在打出的本机安装包里走：附录 D.2 的背景，补齐八节设定，生成方案、改一项、确认、生成开场、采用、开局、玩到触发一次关键场面和一次状态变化、玩到完结。
- [ ] 2. 每一步记：是否一次成功、修正了几次、失败的错误码。方案或开场被退回超过两次的，把校验错误原文和模型的提案贴进汇报（不进仓库）。
- [ ] 3. VoiceOver 走查：创作页的步骤导航、方案的折叠按钮、状态栏的进度条与来历、开局页表单。
- [ ] 4. 按根目录 AGENTS §10 判断有没有值得沉淀进 AGENTS.md 的经验，有就按那里的格式写，交维护者确认。
- [ ] 5. 收口：`git worktree list` 只剩主工作区，`git branch` 只剩 `main`（合并与删除分支要维护者当场授权）。

**完成判据。** 这里没有机器判据：真实模型的表现靠维护者看汇报裁定；读屏走查靠人工。汇报里分开写“机器验不了”和“还没验”。

---
## 附录 A · 中文文案

照抄。键的层级就是 JSON 的嵌套层级。已经存在的键不要改。**对象已经存在时只往里加键，不要整块替换**：例如 `authoring.json` 里已有 `preview`、`cast`、`published`，`play.json` 里已有 `options`；下面各块里同名的对象都是“往里加”。

### A.1 errors（T10）

```json
{
  "plan_not_confirmed": "方案还没有确认，或确认之后又改过设定。请先确认方案。",
  "opening_needs_review": "开场里还有需要先改的句子：写死了主角的名字，或用了作者没留的填写项。",
  "protagonist_input_invalid": "填写的内容不符合要求，请检查后再开始。",
  "not_published": "这部作品还没有存入作品库，暂时不能开始。"
}
```

### A.2 authoring（T21、T22、T23）

**T21：**

```json
{
  "settings": {
    "intro": "每一节都可以留空。写了的部分 AI 会照着写，没写的由 AI 先拟，你在方案里再看。",
    "section": {
      "world": { "heading": "世界", "help": "时代、地点、这个世界的规矩。", "placeholder": "例如：海边小镇，只在夜里通电。" },
      "protagonist": { "heading": "玩家主角", "help": "主角是谁、和谁有什么关系、一开始知道什么。", "placeholder": "例如：刚到镇上的邮差，谁也不认识。" },
      "cast": { "heading": "主要人物", "help": "人物的习惯、关系边界、希望发展的感情线。", "placeholder": "例如：守灯人话少，从不提自己的过去。" },
      "secrets": { "heading": "秘密与知情", "help": "谁知道什么，玩家凭什么能发现。", "placeholder": "例如：守灯人知道上一任邮差为什么离开，拿到旧信才会说。" },
      "opening": { "heading": "开场", "help": "开场可以让 AI 起草，按你写的情境写，或直接用你的原文。" },
      "actions": { "heading": "行动与提示", "help": "行动更偏交谈、观察还是取舍。", "placeholder": "例如：多给交谈的选项，少给打斗。" },
      "scenes": { "heading": "关键场面与结局", "help": "满足什么条件时发生什么，什么时候结束。都可以不写。", "placeholder": "例如：主角第一次独自登上灯塔顶时，守灯人讲起旧事。三封旧信都送到时故事结束。" },
      "status": { "heading": "初始状态栏", "help": "玩家要留意哪些事，每一栏用数字、阶段、清单还是文字。", "placeholder": "例如：潮位用 0 到 10 米的数字；送出的旧信用清单。" }
    },
    "protagonist": {
      "fieldsHeading": "留给玩家填写的项目",
      "fieldsHelp": "开局时会问玩家这些。玩家留空时用默认值。",
      "fieldName": "项目名",
      "defaultValue": "默认值",
      "remove": "删除「{{name}}」",
      "add": "添加填写项",
      "addLimit": "最多 {{count}} 项",
      "nameField": "哪一项是主角的名字",
      "nameFieldNone": "没有",
      "nameInvalid": "项目名不能含空格、句点或花括号",
      "nameDuplicate": "已经有同名的项目"
    },
    "cast": { "modeLabel": "主要人物", "mode": { "fixed": "固定主要角色", "per_run": "每次新开局生成" } },
    "opening": {
      "modeLabel": "开场怎么写",
      "mode": { "ai": "AI 起草", "situation": "按我写的情境", "author_text": "用我的原文" },
      "text": { "ai": "对开场的要求（可选）", "situation": "开场的情境", "author_text": "开场原文" },
      "placeholder": {
        "ai": "例如：从主角下船那一刻写起。",
        "situation": "例如：雨夜，主角站在灯塔门口，门从里面锁着。",
        "author_text": "直接写开场正文，段落之间空一行。"
      },
      "insert": "插入填写项"
    },
    "actions": {
      "hintsLabel": "推荐行动",
      "hints": { "actions_only": "只显示行动", "known_consequences": "提醒已知后果" }
    }
  },
  "plan": {
    "generate": "生成故事方案",
    "regenerate": "重新生成方案",
    "running": "正在生成故事方案",
    "done": "故事方案已生成",
    "failed": "故事方案没有生成成功，请重试"
  }
}
```

**T22**（并进同一个 `plan` 对象，不要覆盖 T21 的五个键）：

```json
{
  "plan": {
    "heading": "故事方案",
    "intro": "这是 AI 对这个故事的理解。标着「AI 补全」的是它替你拟的，可以直接改。",
    "source": { "author": "作者", "ai": "AI 补全", "author_confirmed": "作者确认" },
    "summary": { "identity": "玩家身份", "tone": "基调", "situation": "开场处境", "world": "世界", "public_setting": "公开设定" },
    "group": { "summary": "摘要", "entities": "人物与地点", "secrets": "幕后", "state": "状态栏", "scenes": "关键场面", "ending": "结束条件" },
    "entityKind": { "character": "人物", "place": "地点", "item": "物品", "group": "组织", "other": "其他" },
    "entity": {
      "role": { "protagonist": "主角", "cast": "主要人物", "other": "其他" },
      "knownAs": "主角称作：{{name}}",
      "slot": "人物位置：{{role}}",
      "encounter": "相遇样例：{{text}}"
    },
    "secret": {
      "hiddenBadge": "幕后",
      "knowers": "知情：{{names}}",
      "reveal": "揭晓条件：{{text}}",
      "show": "查看幕后设定",
      "hide": "收起幕后设定",
      "foldedTitle": "幕后已折叠 · {{count}} 条",
      "foldedHelp": "点「查看幕后设定」才会显示具体内容。",
      "expandedTitle": "幕后已展开",
      "expandedHelp": "玩家看不到这些内容，只能在故事里慢慢发现。",
      "titleLine": "秘密 · {{title}}",
      "statement": "真相：{{text}}"
    },
    "state": {
      "display": { "number": "数字", "stage": "阶段", "list": "清单", "text": "文字" },
      "range": "范围 {{min}} 到 {{max}}",
      "unit": "单位：{{unit}}",
      "stages": "阶段：{{stages}}",
      "initial": "开局：{{value}}",
      "hidden": "幕后栏目"
    },
    "scene": { "once": "只发生一次", "repeat": "可以重复发生" },
    "ending": { "folded": "已写结束条件", "none": "开放式，没有结束条件" },
    "item": { "edit": "修改", "editLabel": "修改「{{title}}」", "remove": "删除", "save": "保存", "cancel": "取消" },
    "remove": { "title": "删除这一项？", "description": "删除之后，重新生成方案时 AI 可能会再拟一项。", "confirm": "删除" },
    "edit": { "invalid": "这一项的内容不完整，或超出了长度" },
    "field": {
      "text": "内容", "name": "名字", "knownAs": "主角称作", "profile": "档案", "slotRole": "人物位置", "encounter": "相遇样例",
      "entityKind": "种类", "role": "身份", "title": "标题", "statement": "真相", "reveal": "揭晓条件", "knowers": "知情的人",
      "label": "栏目名", "display": "显示方式", "min": "最小值", "max": "最大值", "unit": "单位", "stages": "阶段（用 | 隔开）",
      "hidden": "幕后栏目", "initial": "开局值", "condition": "条件", "outcome": "发生什么", "once": "只发生一次"
    },
    "conflict": { "heading": "两条设定互相矛盾", "first": "第一条", "second": "第二条", "impact": "影响：{{text}}" },
    "stale": "生成方案的时候你改过设定，这份方案基于修改前的内容。",
    "adoptStale": "仍然采用",
    "confirm": "确认方案，生成开场",
    "confirmed": "方案已确认",
    "staleTitle": "这份方案基于修改前的设定",
    "confirmDisabled": { "empty": "还没有方案", "running": "方案还在生成" }
  },
  "placeholder": { "token": "「{{name}}」" }
}
```

**T23：**

```json
{
  "steps": { "label": "创作步骤", "background": "背景", "plan": "方案", "opening": "开场" },
  "opening": { "heading": "开场", "intro": "按确认后的方案写出的开场。采用后存入作品库，玩家点「开始故事」就从这里读起。" },
  "cast": { "headingOpening": "开场里新出现的" },
  "preview": {
    "regenerate": "重新生成开场",
    "hint": "提醒：{{text}}",
    "initialState": "开局状态",
    "initialHidden": "开局时不显示",
    "review": {
      "heading": "这些句子需要先改",
      "prose": "第 {{index}} 段",
      "option": "第 {{index}} 个推荐行动",
      "hardcoded_name": "写死了主角的名字，改成填写项",
      "unknown_placeholder": "用了作者没留的填写项"
    },
    "adoptBlocked": "先改好上面的句子，才能采用"
  }
}
```

### A.3 library（T24）

```json
{ "card": { "restart": "重新开局" } }
```

### A.4 play（T24、T25）

**T24：**

```json
{
  "start": {
    "heading": "开始故事",
    "intro": "开局前，先告诉故事几件事。留空的项目会用作者给的默认值。",
    "fieldHelp": "留空时用「{{value}}」",
    "submit": "开始故事",
    "opening": "正在打开故事",
    "back": "返回作品库"
  },
  "openingRequest": {
    "pending": "正在为这一局准备人物和开场",
    "pendingHelp": "主要人物每局都不一样。可以离开这一页，生成完成后从作品库继续。",
    "keptCast": "这一局已经确定的人物会保留，重试时沿用。",
    "failed": "这一局的开场没有生成成功",
    "retry": "重试这次开局",
    "back": "返回作品库"
  }
}
```

**T25：**

```json
{
  "status": {
    "heading": "当前状态",
    "new": "新",
    "increase": "+{{delta}}",
    "decrease": "−{{delta}}",
    "previousText": "原来：{{text}}",
    "previousStep": "原来在第 {{step}} 步",
    "step": "第 {{step}} 步，共 {{total}} 步",
    "ofMax": "/ {{max}}",
    "item": { "open": "进行中", "done": "已完成", "failed": "落空", "new": "新", "changed": "变了" },
    "historyTitle": "{{label}}的来历",
    "historyEntry": "第 {{depth}} 回合",
    "historyOpening": "开场",
    "historyCurrent": "当前",
    "historyNote": "只列出这一栏显示以来的变化。",
    "jump": "跳回这一回合",
    "closed": "已了结 {{count}} 项：{{labels}}"
  },
  "options": { "hint": "提醒：{{text}}" },
  "ended": {
    "heading": "故事到这里结束了",
    "description": "可以往上重读，也可以从开场重新开始。",
    "restart": "重新开局",
    "back": "返回作品库"
  }
}
```

`options` 对象已经存在（`label`），把 `hint` 加进去。

### A.5 settings（T10）

在 `purpose.name` 和 `purpose.help` 里各加一个键：

```json
{
  "purpose": {
    "name": { "author_chat": "创作" },
    "help": { "author_chat": "生成故事方案时使用。要求支持工具调用；听从指令、格式稳定比文笔更重要。" }
  }
}
```

### A.6 desktop（T05）

`apps/desktop/src/i18n/zh-CN.json` 的全部内容。`DESKTOP_STRING_KEYS` 按下面的顺序列出每一个叶子键，前缀 `desktop:`。

```json
{
  "app": { "name": "Unwritten" },
  "menu": {
    "about": "关于 Unwritten",
    "hide": "隐藏 Unwritten",
    "hideOthers": "隐藏其他",
    "unhide": "全部显示",
    "quit": "退出 Unwritten",
    "edit": "编辑",
    "undo": "撤销",
    "redo": "重做",
    "cut": "剪切",
    "copy": "拷贝",
    "paste": "粘贴",
    "selectAll": "全选",
    "view": "显示",
    "resetZoom": "实际大小",
    "zoomIn": "放大",
    "zoomOut": "缩小",
    "fullscreen": "进入全屏幕",
    "devTools": "开发者工具",
    "window": "窗口",
    "minimize": "最小化",
    "close": "关闭窗口"
  },
  "startup": {
    "title": "Unwritten 没能启动",
    "reason": {
      "data_locked": "数据目录正被另一个 Unwritten 使用。关掉另一个之后再试。",
      "port_in_use": "需要的端口已经被占用。",
      "data_dir": "数据目录打不开。检查磁盘空间和权限。",
      "startup": "启动时出了错。",
      "timeout": "启动太久没有完成。",
      "exited": "启动过程中意外停止了。"
    },
    "diagnostic": "诊断编号：{{id}}",
    "noDiagnostic": "没有诊断编号。",
    "retry": "重试",
    "quit": "退出"
  },
  "crash": {
    "title": "Unwritten 停止了工作",
    "message": "已经保存的进度都在。正在写的那一段会显示为未完成，可以重试。",
    "detail": "重启后会回到作品库。",
    "restart": "重启",
    "quit": "退出"
  }
}
```

菜单标题用 `menu.edit`、`menu.view`、`menu.window`；macOS 的应用菜单标题用 `app.name`。

---

## 附录 B · 给模型的文字

照抄进对应的常量。改动任何一个字都要更新 token 棘轮（core AGENTS §4）。

### B.1 `PLAN_SYSTEM_PROMPT`（T14）

```
你要读作者的背景、写作要求和补充设定，整理出一份故事方案，交给作者确认。方案回答这几件事：玩家是谁、开场处境如何、故事是什么基调、世界里成立哪些事；有哪些人物、地点和事物；哪些是幕后的秘密、谁本来就知道、玩家凭什么能发现；状态栏跟踪什么；满足什么条件时发生关键场面；故事何时结束。作者写明的内容原样采用，标 "from":"author"；你补全的标 "from":"ai"。不必样样补齐：主角、玩家身份和开场处境一定要有，其余只在背景需要时补。【作者已确定的项】原样保留，不要重复列出，也不要改写。只有一个主角。【主要人物模式】是每次新开局生成时，主要人物写成人物位置：写它在故事里的作用和一次相遇的样例，不写具体的人。两条作者设定确实互相矛盾时，在 conflicts 里逐字引用两段原话，说明受影响的体验，不要自己裁定。作品语言跟随背景所用的语言。调用 `propose_plan` 提交，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。
```

### B.2 `PREVIEW_SYSTEM_PROMPT`（T17）

```
你要按已经确认的故事方案写一部文字冒险的开场。按作者的叙事要求写，不越过内容边界，即兴只在不越出即兴范围的地方展开。方案里的人物、地点和事物用 @编号表示。让玩家清楚自己是谁、身处何地、眼前为什么值得行动；用可读的段落写，停在一个由玩家决定的时刻。为同一处境给出不同且现在可执行的行动。标题、简介和公开设定只使用开场时玩家能知道的信息。主角已经在方案里，不要再新增主角。主角此刻还不知道名字的人物和事物，正文和选项里只写主角看到的样子；要让主角知道一个名字，用 name 登记。开场里第一次出现、方案里没有的人物和事物，用 new_entity 登记。状态栏的开局值写在 state 里。按【开场方式】写：给了作者原文时不写正文，只交其余参数。【主角填写项】里有主角名时，凡是提到主角名字的地方写占位符，不写具体名字。调用 `propose_preview` 提交，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。
```

### B.3 续写（T19）

`NARRATOR_SYSTEM_PROMPT`：在现有字符串末尾原样追加下面这段（中间不加空格）：

```
【状态栏】里的栏目这一回合有变化时，用 state、state_item 写出；幕后栏目永远不设为显示。出现需要持续跟踪的新情况，可以用 new_state 新增栏目。游玩中出现值得保密的真相，用 secret 记下，写明谁本来就知道。满足【未触发的关键场面】的条件时安排那个场面，用 scene_hit 写它的 S 编号和出处段号；条件没满足就不要提前写。【行动提示】要求提醒时，每个推荐行动可以带一句 hint，只用主角已知的信息。只有满足【结束条件】时，ending 才填 "true"。
```

`PROPOSE_TURN_DESCRIPTION` 不变。

`PROPOSE_TURN_PARAMETERS`：

- `options.description` 改为：`推荐行动，每行一个 JSON：{"text":"…"}。作品要求提醒时可以写 {"text":"…","hint":"…"}`
- `changes.description`：在 `{"type":"scene",…}` 那一行之后、“引用本次新写的事实要给它起 "id"”之前，插入：

  ```
  {"type":"state","key":"栏目 key","value":"新值","visible":"true|false","closed":"true|false"}
  {"type":"state_item","key":"清单栏目 key","item":"条目原文","status":"open|done|failed|gone"}
  {"type":"new_state","key":"新栏目 key","label":"显示名","display":"number|stage|list|text","hidden":"false","min":"0","max":"10","unit":"米","stages":"阶段一|阶段二"}
  {"type":"secret","subject":"@3","title":"无剧透的标题","statement":"真相","reveal":"揭晓条件","knowers":"@3","para":"2"}
  {"type":"scene_hit","scene":"S1","para":"3"}
  ```

  并在说明的最后追加一句：`清单栏目不写 value，用 state_item 改条目；state 只在改值、改显示或了结时写。`
- `ending.description` 改为：`作品有结束条件、而且这一回合满足了它时填 "true"，否则填 "false"`

### B.4 每局生成（T18）

`CAST_SYSTEM_PROMPT`：

```
你要为这一局文字冒险确定主要人物。作品为每个人物位置写了作用和一次相遇的样例；按位置各写一个具体的人：名字、主角此刻怎么称呼他、一句话档案。人物要符合作品设定和这个位置的作用，彼此不同，也不要和【已有的人物】同名。调用 `propose_cast` 提交，每个位置一行。收到字段错误时修正后重新提交。
```

`OPENING_SYSTEM_PROMPT`：

```
你要为这一局写开场。作品已经采用了一份开场，它定下了时间、地点和处境；这一局的主要人物也已经确定。以【采用的开场】为准，保留时间、地点和处境，让【这一局的人物】按各自的位置进入开场，其余尽量和采用的开场一致。按作者的叙事要求写，不越过内容边界。主角此刻还不知道名字的人物，正文和选项里只写主角看到的样子。用 new_entity 登记这一局的人物，"slot" 写人物位置的编号，名字和【这一局的人物】一致。调用 `propose_opening` 提交，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。
```

---

## 附录 C · 给模型看的文本格式

### C.1 `propose_plan` 的参数（T14）

全部参数都是必填字符串，没有内容时填空字符串。

| 参数 | `description`（照抄） |
| --- | --- |
| `language` | `作品语言的语言标签，例如 zh-CN` |
| `summary` | `每行一个 JSON：{"key":"identity|tone|situation|world","text":"…","from":"author|ai"}。identity 是玩家身份，situation 是开场处境，这两项必须有` |
| `entities` | `每行一个 JSON：{"ref":"e1","kind":"character|place|item|group|other","role":"protagonist|cast|other","name":"名字","known_as":"主角一开始怎么称呼它，不知道时留空","profile":"一句话档案","from":"author|ai"}。恰好一个 protagonist。主要人物每次新开局生成时，cast 行再写 "slot_role":"它在故事里的作用","encounter":"一次相遇的样例"，name 写这个位置的称呼` |
| `secrets` | `每行一个 JSON：{"title":"无剧透的标题","statement":"真相","subject":"e1 或名字","knowers":"e2,名字","reveal":"玩家凭什么能发现","from":"author|ai"}` |
| `state` | `每行一个 JSON：{"key":"英文或中文的短名","label":"显示名","display":"number|stage|list|text","min":"0","max":"10","unit":"米","stages":"阶段一|阶段二","hidden":"true|false","reveal":"什么时候让玩家看见","initial":"开局值，清单留空","from":"author|ai"}。min、max、unit 只用于数字，stages 只用于阶段` |
| `scenes` | `每行一个 JSON：{"condition":"满足什么条件","outcome":"发生什么","once":"true|false","from":"author|ai"}` |
| `ending` | `结束条件原文；开放式作品填空字符串` |
| `conflicts` | `两条作者设定互相矛盾时，每行一个 JSON：{"first":"第一段原话","second":"第二段原话","impact":"会影响什么体验"}。原话必须逐字摘自作者的输入；没有矛盾时填空字符串` |

错误文字（`<n>` 是行号，`<p>` 是参数名）：

| 情况 | 文字 |
| --- | --- |
| 主角数量不对 | `entities：必须恰好有一行 "role":"protagonist"。` |
| 主角不是人物 | `第 <n> 行 entities：主角必须是 character。` |
| 缺人物位置 | `第 <n> 行 entities：主要人物每次新开局生成，cast 行必须写 slot_role 和 encounter。` |
| 多写了人物位置 | `第 <n> 行 entities：固定主要角色的作品不写 slot_role 和 encounter。` |
| 同名 | `第 <n> 行 entities：和第 <m> 行重复了同一个名字。` |
| 引用找不到 | `第 <n> 行 secrets.<字段>：找不到「<名字>」。可用的人物：<名字列表>。` |
| 知情者不是人物 | `第 <n> 行 secrets.knowers：<名字> 不是人物。` |
| 缺必要摘要 | `summary：必须有 identity 和 situation 两项。` |
| 重复摘要 | `第 <n> 行 summary：key <key> 已经写过。` |
| 栏目问题 | `第 <n> 行 state：` 后接 `checkStateConfig` 或 `checkStateValue` 的错误文字 |
| 数量超限 | `<p>：最多 <上限> 行。` |
| `from` 不对 | `第 <n> 行 <p>.from：只能是 author 或 ai。` |

### C.2 方案生成的提示（T14）

各块之间空一行；空的块不出现，但【主要人物模式】【开场方式】【推荐行动】三行总是出现。

```
【作者背景】
<background>

【叙事要求】
<anchors.narrationDirective>

【内容边界】
<anchors.contentPolicy>

【即兴范围】
<anchors.improvisationScope>

【主要人物模式】固定主要角色 | 每次新开局生成
【开场方式】AI 起草 | 按作者写的情境 | 采用作者原文
【推荐行动】只显示行动 | 提醒已知后果

【补充设定 · 世界】
<settings.world.text>

【补充设定 · 玩家主角】
<settings.protagonist.text>
留给玩家填写：名字（主角名，默认「阿岚」）、职业（默认「邮差」）

【补充设定 · 主要人物】
<settings.cast.text>

【补充设定 · 秘密与知情】
<settings.secrets.text>

【补充设定 · 开场】
<settings.opening.text>

【补充设定 · 行动与提示】
<settings.actions.text>

【补充设定 · 关键场面与结局】
<settings.scenes.text>

【补充设定 · 初始状态栏】
<settings.status.text>

【作者已确定的项】
- 玩家身份：<text>
- 人物「<name>」（主要人物）：<profile>
- 秘密「<title>」：<statement>
- 栏目「<label>」（<显示方式>）：开局 <initial>
- 关键场面：<condition> → <outcome>
- 结束条件：<text>
```

“留给玩家填写”一行只在有填写项时出现，每项写成 `<name>（主角名，默认「<defaultValue>」）` 或 `<name>（默认「<defaultValue>」）`，用“、”连接。

### C.3 续写上下文的新块（T19）

插在【主角】之后、当前场景之前，顺序固定：

```
【行动提示】
只显示行动：推荐行动不写 hint。

【结束条件】
<meta.ending>

【状态栏】
<renderStateBlock 的输出>

【和在场者有关的秘密】
<renderSecretLines 的输出>

【未触发的关键场面】
<renderSceneLines 的输出>
```

- 【行动提示】的正文：`actions_only` 为上面那一句；`known_consequences` 为 `提醒已知后果：每个推荐行动可以带一句 hint，只用主角已知的信息。`
- 【结束条件】没有时正文为 `这部作品没有结束条件，ending 只能填 "false"。`
- 后三块没有内容时整块不出现。

### C.4 状态栏、秘密、场面的行格式（T16）

**`renderStateBlock(p, cb)`**：投影里每个栏目一行（叙述者视角，含幕后栏目），按栏目在方案里的顺序、新增栏目在后：

```
- <label>（key <key>，<显示方式>）= <当前值>[；目前不显示给玩家][；已了结]
```

- `<显示方式>`：数字写 `数字`，有范围时接 ` <min> 到 <max>`，有单位时接 ` <unit>`；阶段写 `阶段 <stages 用 | 连接>`；清单写 `清单`；文字写 `文字`。幕后栏目在后面再接 `，幕后栏目`。
- `<当前值>`：没有值写 `还没有值`；清单写 `<item>：<状态中文>`，用“、”连接，`gone` 的不写，没有条目写 `空`；其余写原值。
- 例：`- 潮位（key 潮位，数字 0 到 10 米）= 3`、`- 旧信（key 旧信，清单）= 第一封：已完成、第二封：进行中`、`- 真名（key 真名，文字，幕后栏目）= 还没有值；目前不显示给玩家`。

**`renderSecretLines(p, cb, presentIds)`**：`subject` 在场、或任一知情者在场（含主角）的秘密，每条一行：

```
- <#编号> 秘密「<title>」：<statement>。知情：<知情者编号用、连接，没有写“无人”>。揭晓：<reveal，没有写“作者没写”>
```

**`renderSceneLines(scenes)`**：

```
- S1：条件：<condition>；发生：<outcome>；只发生一次 | 可以重复发生
```

### C.5 开场预览的提示与参数（T17）

提示，各块之间空一行，空的块不出现：

```
【作者背景】
<background>

【叙事要求】
作品语言：<narration.language，没有时写“跟随背景所用的语言”>。
<anchors.narrationDirective>

【内容边界】
<anchors.contentPolicy>

【即兴范围】
<anchors.improvisationScope>

【故事方案】
- 玩家身份：<identity>
- 基调：<tone>
- 开场处境：<situation>
- 世界：<world>

【主角】
@1 <主角名> · <档案>

【人物与事物】
<每个非主角的作者设定实体一行，用 renderEntityLine>

【人物位置】
- 位置1：作用：<role>；相遇样例：<encounter>

【秘密】
<renderSecretLines，presentIds 传全部实体>

【状态栏】
<renderStateBlock>

【关键场面】
<每个场面一行：- <condition> → <outcome>>

【结束条件】
<ending>

【开场方式】
<见下>

【行动提示】
<同 C.3>

【主角填写项】
- 名字（主角名）：写 {{protagonist.名字}}，玩家留空时是「阿岚」
- 职业：写 {{protagonist.职业}}，玩家留空时是「邮差」
```

【开场方式】的正文：`ai` 且 `opening.text` 为空：`由你起草。`；`ai` 且有文字：`由你起草。作者的要求：<text>`；`situation`：`按作者写的情境起草：<text>`；`author_text`：`采用作者原文，不写正文：\n<text>`。【人物位置】只在每局生成的作品里出现，编号从 1 起，和 `slot` 一致。

`previewToolParameters(mode, castMode)` 的参数：`title`、`blurb`、`public_setting`、`prose`（`author_text` 时没有）、`options`、`place`、`time`、`language`、`present`、`changes`、`state`，全部必填。与现有参数不同的说明：

| 参数 | `description`（照抄） |
| --- | --- |
| `options` | `推荐行动，每行一个 JSON：{"text":"…"}。【行动提示】要求提醒时写 {"text":"…","hint":"…"}` |
| `present` | `开场结束时在场的人物，写 @编号 或本次新增人物的名字，用逗号分隔。只有主角时留空` |
| `changes` | 见下 |
| `state` | `开局时状态栏的值，每行一个 JSON。数字、阶段、文字栏目：{"key":"栏目 key","value":"值","visible":"true|false"}；清单栏目每个条目一行：{"key":"栏目 key","item":"条目","status":"open"}。没写的栏目用方案里的开局值；没有要改的填空字符串` |

`changes` 的说明：

```
每行一个 JSON。引用方案里的人物和事物写 @编号；引用本次新写的事实，先给那行起一个 "id"（如 "f1"），再写这个 id。para 是出处在正文里的段号，从 1 起。主角已经在方案里，不要新增主角。可用的类型：
{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，正文或选项会写到它时必填","profile":"一句话档案","para":"1"}
{"type":"name","entity":"@2","name":"称呼","holder":"@1","para":"2"}
{"type":"event","subject":"@2","object":"@1","statement":"一句话","witnesses":"@1,@2","para":"2"}
{"type":"trait","subject":"@2","key":"特征名","statement":"一句话","para":"2"}
{"type":"relation","subject":"@1","object":"@2","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}
{"type":"promise","subject":"@2","object":"@1","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}
{"type":"knowledge","fact":"f1","holder":"@1","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"@2","para":"3"}
引用本次新写的事实要给它起 "id"，例如 {"type":"event",…,"id":"f1"}；每行的 id 不能重复。
开场里的 event 必须写明 witnesses。
```

`castMode === 'per_run'` 时，在“可用的类型”之前再加一句：`每个人物位置用一行 new_entity 登记一个具体的人，加上 "slot":"位置编号"。`

`parseOpeningProposal` 的新错误文字：

| 情况 | 文字 |
| --- | --- |
| 位置没有人物 | `changes：人物位置 <index> 没有对应的 new_entity（写 "slot":"<index>"）。` |
| 位置重复 | `第 <n> 行 changes.slot：人物位置 <index> 已经在第 <m> 行登记过。` |
| 位置名字不符 | `第 <n> 行 changes.name：人物位置 <index> 这一局的人物叫「<name>」。` |
| 不该有位置 | `第 <n> 行 changes.slot：这部作品的主要人物是固定的，不写 slot。` |
| 未知填写项 | `<位置>：{{protagonist.<名字>}} 不是作者留的填写项。可用的：<名字列表，没有写“无”>。` |
| 写死主角名 | `<位置>：主角的名字留给玩家填写，这里写 {{protagonist.<名字>}}，不要写「<被写死的名字>」。` |
| 栏目找不到 | `第 <n> 行 state：找不到栏目 <key>。可用的栏目：<key 列表>。` |
| 幕后栏目显示 | `第 <n> 行 state：幕后栏目 <key> 不能设为显示。` |

`<位置>` 写成 `第 <k> 段` 或 `第 <k> 个推荐行动`。

### C.6 每局生成的提示与参数（T18）

`buildCastPrompt`：

```
【作品设定】
<background>

【公开设定】
<readPublicSetting>

【叙事要求】
作品语言：<language>。
<anchors.narrationDirective>

【即兴范围】
<anchors.improvisationScope>

【主角】
@1 <主角名，有主角名填写项时用玩家这次填的值> · <档案>

【已有的人物】
<作者设定的人物，每个一行，用 renderEntityLine>

【人物位置】
- 位置1：作用：<role>；相遇样例：<encounter>
```

`PROPOSE_CAST_PARAMETERS`：一个必填字符串参数 `cast`，说明 `每行一个 JSON，每个人物位置一行：{"slot":"位置编号","name":"真名","known_as":"主角此刻的称呼，不知道时留空","profile":"一句话档案"}`。

`buildOpeningPrompt`：C.5 的提示去掉【开场方式】和【主角填写项】，把【人物位置】换成下面两块，放在【结束条件】之后：

```
【采用的开场】
<meta.opening.prose，占位符已替换>
推荐行动：
- <每个选项的 text>

【这一局的人物】
- 位置1（<role>）：<name>，主角称作「<known_as>」，<profile>
```

`known_as` 为空时写 `主角还不知道名字`。`PROPOSE_OPENING_PARAMETERS`：C.5 的参数去掉 `title`、`blurb`、`public_setting`、`language`，`prose` 必填，`changes` 用 `per_run` 版本的说明。

---

## 附录 D · 测试用的虚构素材

### D.1 默认方案（`proposePlanStep` 的缺省值，T14）

- `summary`：`{"key":"identity","text":"刚到灯塔镇的邮差，谁也不认识","from":"ai"}`、`{"key":"situation","text":"最后一班船靠岸时，镇上停了电","from":"ai"}`
- `entities`：`{"ref":"e1","kind":"character","role":"protagonist","name":"新来的邮差","profile":"二十多岁，记性好","from":"ai"}`

### D.2 “灯塔镇”夹具（T16 起的默认夹具）

| 项 | 内容 |
| --- | --- |
| 背景 | 灯塔镇只在夜里通电。新来的邮差要把一袋没有收件人的旧信送出去。 |
| 补充设定 | 主要人物固定；行动提示为「提醒已知后果」；开场为作者原文（见下）；填写项 `名字`（主角名，默认「阿岚」）、`职业`（默认「邮差」） |
| 主角 | 新来的邮差，二十多岁，记性好 |
| 人物 | 林潮：守灯人，五十岁上下，话少。主角一开始称他“守灯人” |
| 地点 | 灯塔；邮局 |
| 秘密 | 标题“上一任邮差的去向”；真相“上一任邮差在灯塔里住过一年，后来乘夜船离开”；主体林潮；知情者林潮；揭晓“主角拿到第三封旧信时” |
| 状态栏 | `潮位`：数字 0 到 10，单位米，开局 3；`信任`：阶段 陌生、相识、信任、决裂，开局陌生；`旧信`：清单，开局空；`真名`：文字，幕后 |
| 关键场面 | 条件“主角第一次独自登上灯塔顶”；发生“林潮讲起上一任邮差”；只发生一次 |
| 结束条件 | 三封旧信都送到收件人手里 |
| 作者原文开场 | 第 1 段：“船靠岸的时候，整座镇子黑着。” 第 2 段：“{{protagonist.名字}}拎着邮袋走下跳板，只看见山顶的灯塔还亮着。” 第 3 段：“一个提着马灯的人站在码头尽头，像是在等谁。” |
| 写死主角名的变体 | 第 2 段换成“阿岚拎着邮袋走下跳板……”，用于 `needsReview` 的用例 |

`seedLighthouseTown(db)` 按上表造好确认过方案的草稿、一个发布版本和一条三回合的路线：T0 开场；T1 主角向守灯人问路（`信任` 变为“相识”，显示）；T2 主角独自登上灯塔顶（触发关键场面，`旧信` 加一条“第一封：已完成”）。

---

## 6. 台账

编排者在每个波次合并后填写。只记执行实况，不写过程叙事（规则见 [tasks/AGENTS.md §7](./AGENTS.md#7-台账)）。

### 6.1 维护者裁定

| 编号 | 裁定 | 理由与何时重估 |
| --- | --- | --- |
| 范围 | M3 = 桌面外壳（本机能跑，不签名、不发布、不做自动更新）+ 作者设定向导全部补充设定 | 维护者在规划时选定；签名与自动更新随发布一起重估 |
| D1–D28 | 按推荐项执行 | 维护者整体确认，未逐项改选；任何一项改选时，先改本文 §1.4，再由 T00 改对应的设计文档 |
| D27 幕后折叠 | 折叠时列出秘密的无剧透标题 | 维护者选定；与[创作工作站 §6](../docs/author-workstation.md#6-工具)一致，不采用 Figma 只显示条数的画法。T22 按标题实现；后续若改回条数，先改设计文档再改 T22 |

### 6.2 波次读数

| 波次 | 集成分支提交 | `pnpm typecheck` | `pnpm lint` | `pnpm test` | 文档链接 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| W0 · T00、T01 | worktree `m3-t00-docs`（未提交） | — | — | — | 通过 | 只改 docs；三遍审计第 1、2 遍零命中，第 3 遍命中 1 处，是契约值 `DESKTOP_LOG_BUFFER_MAX`（64），保留 |
| W1 · T02、T10 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | T10 增加 11 个临时路由 handler；T11 替换为服务调用，handler 数不再增加 |
| W2 · T03、T04、T11 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | Electron 45 无 postinstall，desktop 的 `postinstall` 显式跑 `install-electron`；`allowBuilds` 不再放行 electron |
| W3 · T05、T12、T13、T21、T22、T24 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | T21/T22 共用 `authoring.json`，同一会话顺序实现；T21/T22 最小改了 `AuthoringPage` 的接线，T23 接管 |
| W4 · T06、T14、T15、T16、T23、T25 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | T06 开发模式实测 core/窗口/诊断样本；T14+T15 同一会话顺序做；T16 给 `keyScenes`/`parentStates` 留默认值 |
| W5 · T07、T08、T17、T19 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | T07 包内 core 修复 `noExternal` 后可运行；T08 的 `tests/desktop.spec.ts` 四条全过，根 `pnpm e2e` 仍有三条旧流程待 T27；应用图标与单实例已验 |
| W6 · T18 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | 固定人物/每局生成都接通；`not implemented` 零命中 |
| W7 · T26 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | `SaveDraftInput.settings` 必填、`WorkDetail.routeId` 删除；集成用例 5 条新增 |
| W8 · T27 | worktree `m3-w1`（未合并） | 通过 | 通过 | 通过 | 通过 | `pnpm e2e` 18 passed（含 Electron 4 条、M3 6 条）；axe 前固定等 700ms 避开入场过渡 |
| W9 · T28 | worktree `m3-w1`（未合并） | — | — | — | — | 真实模型走查和 VoiceOver 依赖维护者环境，未运行；包内应用启动与诊断已人工验证 |

### 6.2a W0 · T01 Figma 校准记录

Figma 文件 Prototype 页新增 section “Milestone 3 · 作者设定”和 “Milestone 3 · 开局与状态栏”，都从原型旧稿和 M2 的帧克隆后改成 M3 的范围（三步向导、没有工作站和试玩、没有存档按钮）。深色稿按变量名把 `Theme · Light` 的绑定换成 `Theme · Dark`。

| 截图（`tasks/assets/milestone-3/`） | 来源 | 说明 |
| --- | --- | --- |
| `authoring-settings-light.png` | 新画 | 背景步骤：补充设定展开，三处写作要求、八节逐节排列；主角填写项两行加“哪一项是主角的名字”；主要人物、开场、行动提示的分段控件；开场原文里的「名字」占位符和「插入填写项」 |
| `authoring-plan-light.png`、`authoring-plan-dark.png` | 原型改 | 方案：摘要、人物与地点、状态栏、关键场面四组，来源徽标「AI 补全」「作者」，铅笔按钮修改；幕后已折叠卡；底部重新生成与确认 |
| `authoring-plan-backstage-conflict-light.png` | 新画 | 生成期间改过设定的提示卡（仍然采用 / 重新生成）、两条设定互相矛盾卡、幕后展开（秘密三行、结束条件） |
| `authoring-opening-review-light.png` | M2 改 | 开场步骤：公开设定、开场里新出现的、开局状态、纸面预览（两个选项带提醒）、这些句子需要先改、采用按钮禁用及原因 |
| `start-fields-light.png` | 原型改 | 开局页：两个填写项，占位为默认值，下方“留空时用「…」” |
| `start-pending-light.png`、`start-failed-light.png` | 新画 | 每局生成：正在准备人物和开场（生成中标记）；开场没有生成成功（诊断编号、重试这次开局、返回作品库） |
| `play-status-hints-light.png`、`play-status-hints-dark.png` | 原型改 | 状态栏全貌：两列栏目、数字“7 / 10 +1”加进度条、阶段“第 1 步，共 4 步”加分段条、清单的图标与状态、「新」徽标、已了结；推荐行动下的提醒 |
| `play-status-history-light.png` | 原型改 | 点开栏目后的来历气泡，“跳回这一回合” |
| `play-ended-light.png` | 新画 | 完结：状态栏之后的“故事到这里结束了”，重新开局与返回作品库；不显示推荐行动和输入框 |

**稿子与本文不一致时的处置**（稿子符合设计文档就改本文）：

| 差异 | 处置 |
| --- | --- |
| 方案每项右边是铅笔图标按钮，没有行内「删除」 | 改 T22 第 3、4 步：删除放进编辑表单 |
| 来源徽标都是中性色，只靠文字区分 | 改 T22 第 1 步 |
| 方案按“摘要、人物与地点、状态栏、关键场面、幕后”分组；幕后是一张折叠控制卡 | 改 T22 第 3、6 步，附录 A.2 加 `group.summary`、`secret.foldedTitle` 等键 |
| 稿子折叠时只写“幕后已折叠 · 2 条”，不列标题 | 维护者确认保留本文写法：折叠时列出无剧透标题，因为[创作工作站 §6](../docs/author-workstation.md#6-工具)规定折叠时给标题；稿子是简化画法 |
| 开场步骤的卡片顺序、待改句子卡在预览之后、采用不可用的原因在按钮左边 | 改 T23 第 3、4 步，附录 A.2 加 `opening.intro`、`cast.headingOpening` |
| 开局页、生成中、失败页都有 `h2` 和说明 | 改 T24 第 4、5 步，附录 A.4 加 `start.heading`、`openingRequest.pendingHelp`、`keptCast` |
| 状态栏的来历是锚在栏目上的气泡，整个栏目可点；阶段写“第 1 步，共 4 步”；数字写“7 / 10”；已了结写“已了结 1 项：…”；进行中的清单条目只有图标 | 改 T25 第 2–4 步（来历用 Base UI 的 Popover；进行中加视觉隐藏文字），附录 A.4 改 `step`、`closed`，加 `ofMax`、`historyTitle`、`historyCurrent`、`historyNote` |
| 原型旧稿的补充设定用一排标签切换各节 | 本文和新稿都是逐节排列，不改：共享部件里没有标签页组件，逐节排列不需要新部件 |

### 6.3 突变账

| 任务 | 突变 | 结果（红 / 绿） | 全绿时的归因与处置 |
| --- | --- | --- | --- |
| T02 | `StartMessageSchema` 的 `z.strictObject` 改成 `z.object` | 红 | 缺字段仍被拒；多余字段需要 `strictObject` 才拒 |
| T02 | `desktop.core_exited` 的 `phase` 改成 `z.string()` | 红 | 用例的 `phase: 'stopping'` 被接受 |
| T10 | `protagonist` 的 `isName` 上限从 1 改成 2 | 红 | 两个 `isName` 的设定通过校验 |
| T10 | `PURPOSES` 改回三项 | 红 | contracts 的 `author_chat` 用例与 client 的 `labels.test.ts` 同时红 |
| T03 | 外观转发改成 `if (false)` | 红 | `外观变化转发给 desktop` 失败 |
| T03 | 写 desktop 事件时 `module: 'desktop'` 改成 `'core'` | 红 | 诊断库查询找不到 `module = 'desktop'` |
| T03 | 去掉 `waitForStart` 的 `settled` 守卫 | 绿（未变红） | Promise 只接受第一次 `resolve`；第二次启动消息的解析和计数没有可观测面，也没有第二道守卫。按 §0.6 记录，判据不改 |
| T11 | 删掉 `readPlan` 的旧项转换分支 | 红 | `旧的公开设定项读作 summary` 失败；恢复后 4 passed |
| T04 | `stopping` 退出也调 `onUnexpectedExit` | 红 | `主动停止不算意外退出` 失败 |
| T04 | `attach` 删掉先发 dropped 的分支 | 红 | `缓存满了计数，连接时先发 dropped` 失败 |
| T04 | 删掉 `onExit` 的 `child !== current` 比对 | 红 | `旧子进程的退出不影响新的一次启动` 失败（30 秒超时） |
| T13 | 八节全部无条件 `rev + 1` | 红 | `保存补充设定只给改了的节加修订号` 失败 |
| T13 | `setWizardStep` 顺带 `contentRev + 1` | 红 | `切换向导步骤不改修订号` 失败 |
| T05 | 显示菜单加 `{ role: 'reload' }` | 红 | `菜单里没有原地刷新` 失败 |
| T05 | `decideNavigation` 只排除 `file:` | 红 | `javascript:alert(1)` 被判成 external |
| T05 | 删掉 `startup.reason.data_locked` | 红 | `每个键都能取到文字` 抛未知键 |
| T12 | 删掉 `copyAuthorSetting` 中 `state_defs` 的 `origin_turn_id is null` | 红 | “只复制作者设定的行”失败 |
| T12 | 去掉 `state_defs_key_by_origin` 唯一索引 | 红 | `state_defs 同一来源下 key 唯一` 失败 |
| T12 | 删掉 `checkStateValue` 数字范围检查 | 红 | `数字值按范围拒绝` 失败 |
| T24 | 开局 id 改成每次提交时生成 | 红 | `提交失败后重试沿用同一个开局 id` 失败 |
| T24 | `WorkCard` 在 `routeId` 为空时仍链游玩页 | 红 | `可玩但没开过局的作品指向开局页` 失败 |
| T21 | 去掉“有错误不调用 onChange” | 红 | `名字不合规时不上报`、`重名时不上报并提示` 失败 |
| T21 | 删掉 `plan_visible` 的同一 jobId 守卫 | 红 | 同 jobId 再渲染会重复上报 |
| T22 | 秘密默认展开 | 红 | `秘密默认折叠`、`折叠时只列出秘密的标题` 失败 |
| T22 | 来源徽标只留颜色 | 红 | `来源用文字标出` 等失败 |
| T14 | 受保护同名实体丢弃删掉 | 红 | `受保护的项优先` 失败 |
| T14 | `contentRev` 比较改恒真 | 红 | `生成期间改过草稿时不覆盖` 失败 |
| T14 | 冲突只核对 `first` | 红（调整夹具后） | 第一次夹具把假原话放在 `first` 未变红；移到 `second` 后红 |
| T15 | 去掉 `clearAuthorSetting` | 红 | `重复确认会重写，不会累加` 失败 |
| T15 | `per_run` 也写实体 | 红 | `每局生成的人物写成人物位置` 失败 |
| T15 | `updatePlanItem` 保持原 `source` | 红 | `改一项后来源变成作者` 失败 |
| T16 | 阶段视图塞入全部 stages | 红 | `阶段栏目只给已到达的阶段名` 失败 |
| T16 | writer 清单只写本回合条目 | 红 | `清单只交一个新条目时保留原来的两项` 失败 |
| T16 | 去掉 `scene_hit` once 检查 | 红 | `只发生一次的场面不能再触发` 失败 |
| T16 | history 去掉 `visible` 过滤 | 红 | `来历不含隐藏期间的值` 失败 |
| T23 | 确认后不调 `generatePreview` | 红 | `只写背景一路点到开场` 失败 |
| T23 | 去掉 `aria-current` | 红 | `当前步骤用 aria-current 标出` 失败 |
| T25 | `ended` 时仍渲染行动区 | 红 | `完结后不显示行动输入，提供重新开局` 失败 |
| T25 | 删掉 `App.tsx` 的 status 失效 | 红 | `回合提交后重新读取状态栏` 失败 |
| T25 | 去掉进行中标项的 `VisuallyHidden` | 红 | `进行中的清单条目有可读的状态文字` 失败 |
| T17 | 删掉 `adoptPreview` 的 `copyAuthorSetting` | 红 | `采用只发布，不建开局` 失败 |
| T17 | `placeholderPolicy` 写死 `'reject'` | 红 | `作者原文开场写死主角名时拒绝采用` 失败 |
| T17 | 人物位置“正好一行”改成“至少一行” | 红 | `每个人物位置正好一个人物` 失败 |
| T19 | `endingAllowed` 写死 true | 红 | `没有结束条件时不能完结` 失败 |
| T19 | 不过滤已触发一次性场面 | 红 | `已触发的一次性场面不再列出` 失败 |
| T19 | `writeChanges` 传空 `parentStates` | 红 | `清单第二回合追加条目，第一回合的条目还在` 失败 |
| T08 | 删掉 `core.onAppearanceChanged(...)` | 红 | `外观偏好同步到原生主题` 失败 |
| T08 | 单实例锁判断改恒真 | 红 | 第二次启动没有退出，已有窗口用例失败 |
| T08 | `handleCrash` 改成直接 `app.quit()` | 红 | `core 意外退出后重启，进度不丢` 失败 |
| T07 | 删掉 `stage.mjs` 复制 client 的步骤 | 红 | `run stage` 非 0，stderr 缺 `client/index.html` |
| T18 | 跳过“cast 已有” | 红 | `开场失败后重试沿用已生成的人物` 失败 |
| T18 | 删掉占位符替换 | 红 | `固定人物的开局不调模型，占位符换成玩家填的名字` 失败 |
| T18 | 删掉“每个键必须是填写项”检查 | 红 | `传了作品没有的填写项被拒` 失败 |
| T26 | `confirmPlan` 不写 `state_defs` | 红 | `作者设定的秘密、栏目、场面在游玩中兑现` 失败（失败点在预览校验） |
| T27 | `PreviewPanel` 采用按钮去掉 `blocked` 禁用 | 红 | `作者原文写死主角名时不能采用` 在 `toBeDisabled` 失败 |

### 6.4 欠账与不适用

| 项 | 类型（欠账 / 不适用） | 为什么现在做不了 | 补上需要什么 |
| --- | --- | --- | --- |
| 幕后折叠时只显示条数，还是列出秘密的无剧透标题 | 已处置 | 维护者选定列出标题，见 §6.1 D27 | 不需要改文档 |
| T17 采用每局生成人物的预览时，`meta.opening.presentIds` 会引用未写进发布版本的示例人物 id | 已处置 | `adoptPreview` 只给不带 `slot` 的行分配 id，场景里没有 id 的人物位置被跳过 | `authoring/service.test.ts` 断言每局生成作品的 `presentIds` 为空 |
| T17 没有标出作者原文里写死的“每局生成人物”名字 | 已处置 | `parseOpeningProposal` 在 `review` 模式下把人物位置的名字也列进待处理 | `opening-proposal.test.ts` 的“作者原文写死每局生成的人物也不写成作者设定” |
| T12 的 `grep` 判据包含存量测试里的跨模块导入 | 已处置 | 判据原文写“零命中”，但现有 `*.test.ts` 里有 10 条存量命中；T12 新建文件零命中 | 判据已改为排除 `*.test.ts`；存量测试不动 |
| T22 方案编辑表单不能改秘密的主体和知情者 | 欠账 | `SecretForm` 只编辑标题、真相和揭晓条件，`plan.field.knowers` 因此未使用 | T22 补实体多选，或由维护者确认这次不需要改这两项 |
| T14 `adoptStalePlan` 无法按名字去重秘密/关键场面 | 欠账 | 规范只给实体、栏目、结束条件的同名规则；秘密和场面没有名称身份，生成期间改过它们时可能留下新旧两份 | 维护者定：按 `statement`/`condition` 去重，或接受重复并在界面提示 |
| T21 把 `<h2>` 放进 `<summary>` | 已处置 | 为了过标题大纲测试；HTML 的 `summary` 内容模型不允许标题 | T23 装配步骤 `h2` 后，折叠标题已改回纯文本 |
| Electron 45 不在 `pnpm install` 时下载本体 | 已处置 | 原任务按旧版 postinstall 写；45.2.3 的 npm 包没有 postinstall，首次运行 `electron` 才下载 | desktop 的 `postinstall` 显式运行 `install-electron`；`docs/tech-stack.md`、§2.10、§1.5 和 T04 已同步 |
| core 一次都没启动成功时，desktop 自己的事件留不下 | 已知限制（D3） | desktop 不能导入 core，又不能另写一份诊断库 | 如果要补，另设计一个 desktop 自己的落盘位置，需要维护者裁定是否违反“诊断只进 diagnostics.db” |
| 真实模型能否稳定交出合格的方案、开场和状态变化 | 机器验不了 | 自动化只证明校验和提交 | T28 人工走查 |
| 读屏走查 | 机器验不了 | 同上 | T28 用 VoiceOver |
| 未签名安装包在别的 Mac 上的表现 | 不适用 | 本次只要求本机能用 | 做签名时一起验 |
