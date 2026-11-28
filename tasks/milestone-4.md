# 第四个里程碑 · 实现任务拆解

设计依据是 [docs/milestone-4.md](../docs/milestone-4.md)。主要设计文档：

- [插图与出图服务](../docs/image.md)
- [插件](../docs/plugins.md)
- [ComfyUI 插件](../docs/comfyui-plugin.md)
- [Colab 宿主](../docs/colab-host.md)
- [Colab 启动器](../docs/colab-launcher.md)
- [Strata 自建模型服务](../docs/strata.md)
- 以及它们链接到的回合循环、数据模型、游玩流程、创作流程等章节

本文件把设计拆成可以交给子代理逐个执行的任务。每个任务写明：

- 每一步写在哪个文件，那个文件做什么；
- 具体怎么写，要注意什么；
- 做完怎样验证。

本文件是进度追踪文件，可以勾选。设计本身以 `docs/` 为准；本文件和 `docs/` 冲突时，先停下来汇报，由维护者裁定后改 `docs/`，再改这里。

执行者可能是能力很弱的模型。所以本文把文件名、符号名、函数签名、数据形状、文本格式、文案、测试用例都写死了。**照着写，不要自己发明。** 本文没写到的地方，按 §0.3 停下来汇报。

---

## 0. 给执行者（必读）

### 0.1 怎么用这份文件

1. 先读完 §0、§2、§3，再读分配给你的那一个任务（§5 里的 `Txx`）。“先读”里列出的设计文档章节和现有代码不能跳过。
2. 只改你的任务“拥有的文件”。需要改别的任务拥有的文件时，停下来汇报（§0.3）。
3. 按“步骤”的顺序做，每做完一步把 `- [ ]` 改成 `- [x]`。
4. 全部步骤做完后，逐条跑“完成判据”。每条判据都配了一个“突变”：把哪一行改坏，这条判据必须变红。突变要真的做一遍，看到变红后再改回来（§0.6）。
5. 本文里的路径、类型、接口供任务交接。业务和视觉契约以 `docs/` 为准，库的 API 以安装后的类型声明为准。两者对不上、而且差异会改变交接契约时，按 §0.3 汇报。
6. **本文里的事实断言是线索，不是结论。** “某函数在某文件”“某处已经有某能力”都是规划时读到的，执行时可能已经变了。动手前先用 `grep` 按符号名核一遍；前提不成立就停下来说，不要照着错误前提动手。
7. **每个任务的第一步都是“核对前提”。** 那一步列出的命令要真的跑，读数和本文写的不一样时停下来汇报。

### 0.2 硬性规则（违反即返工）

| 规则 | 说明 |
| --- | --- |
| 不写注释 | 任何代码文件都不写注释，包括 CSS、SQL、shell、Python、`pyproject.toml`、Jupyter 笔记本（笔记本只放代码单元）。lint 抑制指令（`// oxlint-disable…`、`// @ts-expect-error`、`# noqa`、`# type: ignore`）也算注释，同样禁止。工具生成的迁移文件和锁定文件例外，但不要手改生成出来的部分。见根目录 [AGENTS.md §8](../AGENTS.md#8-不写注释) |
| 只用 pnpm 和 uv | TypeScript 一侧不用 npm、yarn、npx，临时执行用 `pnpm exec`。Python 一侧只用 uv（`uv sync`、`uv run`、`uv lock`、`uv export`），不用 pip 直接装开发依赖 |
| 依赖只加本文列出的 | 本里程碑 TypeScript 一侧**不新增任何依赖**（`p-queue` 已经在 core 里）。Python 一侧的依赖只有 §2.10 列出的那几个。其他新依赖停下来汇报 |
| 不 commit、不 push | 改动留在工作树里，由编排者汇总后请维护者授权提交 |
| 相对导入写扩展名 | TypeScript 里的相对导入一律写 `.ts` / `.tsx` 后缀 |
| 只用可擦除语法 | 不写 `enum`、`namespace`、构造函数参数属性、装饰器 |
| 界面文案走 i18n | client 组件里不出现用户能看到的字面字符串，`aria-label`、`placeholder`、`title`、`alt` 也算（插图的 `alt` 用画面说明原文，见 §2.4） |
| 纯文本渲染 | AI 输出、作品内容、玩家输入、画面说明、服务返回的任何文字一律当纯文本渲染。不用 `dangerouslySetInnerHTML`、`innerHTML` |
| 样式只用 token | 视觉属性只能用 `--uw-*` token。见 [apps/client/AGENTS.md §2](../apps/client/AGENTS.md#2-样式只用-token) |
| 测试内容虚构 | 测试和示例里的故事、人物名、对白、外貌全部用附录 D 的虚构素材，或自己另编。不从任何真实作品里摘 |
| 测试数据 | 自动化测试用 `makeTempDataDir()`（`packages/core/src/test-support/temp-dir.ts`）或 Python 的 `tmp_path` 建临时目录，测试结束删除 |
| key 不进仓库 | 测试夹具不能叫 `providers.json`，也不能以它开头。令牌、key 在测试里用一眼能看出是假的值，例如 `test-token-0123456789abcdef0123456789abcdef` |
| 提案工具参数只用字符串 | `propose_turn`、`propose_cast`、`propose_preview`、`propose_opening`、`propose_plan` 的每个参数都是字符串，包括本次新增的 `illustrate` |
| 事务里不 await | SQLite 驱动是同步的。`db.transaction(...)` 的回调里不调用任何异步函数，也不做文件读写以外的 I/O |
| 先提交后发布 | `deps.bus.publish(...)` 一律放在事务提交成功之后，不放在事务回调里 |
| 外发请求只经 `net` | core 里任何发往外部的 HTTP 请求都经 `packages/core/src/net/` 导出的 `fetch` 封装（T01 之后）。不直接用 `globalThis.fetch` |
| 不出现插件名 | `apps/` 和 `packages/` 的源码、测试、文案里不出现 `comfy`、`colab`、`tailscale`、`strata`（大小写都算）。由 T03 的扫描脚本检查。core 不按服务报告的实现名分支 |
| `image/` 不认识故事 | `packages/core/src/image/` 不导入 `story/`、`play/`、`authoring/`、`illustration/`。见 [packages/core/AGENTS.md §1](../packages/core/AGENTS.md#1-模块与依赖方向) |
| 图片字节是信任边界 | 出图服务和本机导入的图片，在写进 `images/` 之前都要过 T07 的 `validateImageBytes`。不按服务声明的 `Content-Type` 或文件扩展名判断类型 |

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
- 每个任务一个 git 工作树（Agent 工具的 `isolation: "worktree"`，或按根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律) 手动建）。工作树里没有 `node_modules`，开工先跑 `pnpm install --frozen-lockfile`。Python 任务另在自己的目录里跑 `uv sync`。
- 每个任务只碰自己拥有的文件。编排者收齐一个波次后，按任务编号顺序合进 `milestone-4` 集成分支，跑一遍 §0.5 第 3 条的全量检查；全绿才开下一个波次。
- `pnpm-workspace.yaml`、各 `package.json` 的依赖段、`pnpm-lock.yaml` 本里程碑不改。根目录 `package.json` 只有 T03 改 `scripts`。

### 0.5 完成一个任务的标准动作

1. 跑本任务的“完成判据”，并按 §0.6 做突变。
2. 用 `code-review-skill` 对本任务的全部 diff 自检（根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律)）。确认成立的问题修掉，再对完整 diff 重新自检；只是“可能”的问题写进汇报。
3. 在仓库根目录跑下面几条。读数重定向进文件再看，不要接 `| tail`：管道会吞掉退出码，也会把失败条数截掉。每个退出码都必须是 0。
   - `pnpm typecheck > "${TMPDIR:-/tmp}/uw-typecheck.txt" 2>&1; echo $?`
   - `pnpm lint > "${TMPDIR:-/tmp}/uw-lint.txt" 2>&1; echo $?`
   - `pnpm test > "${TMPDIR:-/tmp}/uw-test.txt" 2>&1; echo $?`
   - Python 任务另跑 `pnpm test:python > "${TMPDIR:-/tmp}/uw-py.txt" 2>&1; echo $?`（T03 之后才有这条命令）
4. 汇报：
   - 改了哪些文件；
   - 每条完成判据的输出，每个突变是否变红；
   - 自检结论；
   - 还没解决的问题。
5. 出示“不该动的东西”的零差异，证明这次的绿不是靠削弱门禁换来的：`git diff --stat -- pnpm-lock.yaml pnpm-workspace.yaml '*/package.json' .oxlintrc.json stylelint.config.mjs lefthook.yml scripts/` 输出必须为空。T03 例外：它只允许出现本任务写明要改的那几个文件。

### 0.6 怎样做突变

- 突变是“故意把实现改坏一处，确认判据会红”。它是判据唯一的自检：不会红的判据，不知道它在守什么。
- 做法：
  1. 先跑一次判据，确认是绿的；
  2. 把指定的那一行改坏，再跑，确认变红；
  3. **用编辑器把那一行改回去**，再跑一次，确认是绿的。
- **不要用 `git checkout`、`git restore`、`git stash` 还原突变**：工作区里一直压着你还没提交的成果，一次误还原会全部抹掉。
- 突变改动和测试运行不要同时进行；测试跑完再改下一处。
- 突变没变红时，先回答两个问题：这一行在这个跑法下会被执行吗？还有没有第二道守卫把它接住了？答完写进汇报，不要为了变红去改判据。

---

## 1. 范围评估

### 1.1 结论

本里程碑分五条线，在 contracts（T02）落地之后可以大幅并行：

- **A 线：出图基础能力（core 的 `net`、`providers`、`image` 模块）。** 包括：
  - 外发请求出口；
  - `providers.json` 升到版本 2；
  - 出图服务的配置；
  - 两种出图协议的客户端；
  - 返回数据的校验；
  - 按服务排队；
  - 按需启动；
  - 调用记录。

  全部是新代码，和故事无关，最容易并行。
- **B 线：插图与人物参考（core 的 `story`、`play`、`authoring`、`illustration` 模块）。** 包括：
  - 形象和插图标记进入回合循环；
  - 按段落投影；
  - 镜头描述；
  - 人物参考组；
  - 插图流程；
  - 图片存储与清理；
  - 取图。

  这是本里程碑最重、风险最高的一块，也是唯一要改现有回合循环的部分。
- **C 线：client 界面。** 设置页、创作页的人物参考与画风、开局页的插图设置、游玩页的占位与大图、手记缩略图、唤醒提示。都可以先用 `shared/test/fake-api.ts` 对着契约写，不必等 core。
- **D 线：Python 插件与自建服务。** `selfhost/colab`、`plugins/comfyui`、`selfhost/strata`、`plugins/colab-launcher`。它们和 TypeScript 只在协议规范上相交，只依赖 T03 的工具链和 core 的一致性测试。
- **E 线：收口。** 装配、端到端、评测、实机走查。

### 1.2 里程碑没写、但验收离不开的部分（本拆解已纳入）

| 补充项 | 为什么离不开 | 落在哪个任务 |
| --- | --- | --- |
| `providers.json` 的读写从 `llm` 模块里拿出来，由 `llm` 和 `image` 共用一个存储 | 两个模块写同一个文件。各自缓存、各自排队，会互相覆盖对方的改动 | T04 |
| 插图总开关和数据接收方确认的过程 `image.autoIllustration.get` / `.set` | [插图与出图服务 §2](../docs/image.md#2-出图服务的配置)要求「游玩时生成插图」确认后才生效，但 §2 的过程表里没有对应的过程 | T02、T06，由 T00 写进文档 |
| 设置页显示图片占用空间的过程 `image.storage.summary` | [插图与出图服务 §9.5](../docs/image.md#95-体量)要显示体量，过程表里没有 | T02、T15、T13，由 T00 写进文档 |
| 取插图视图的过程 | 回合视图里要有插图（[插图与出图服务 §10](../docs/image.md#10-交给-client)）。本文把插图视图并进 `TurnView`，不另开过程 | T02、T18 |
| 源码扫描脚本 | [插件 §2](../docs/plugins.md#2-边界)要求一条测试扫描 `apps/`、`packages/`。脚本自己要写出这些名字，放在被扫描的目录里会扫到自己，所以放在 `scripts/` 下 | T03 |
| 仓库没有 CI | 设计文档写的是「CI 跑插件测试和一致性测试」，但仓库里没有 `.github/`。本文改用根脚本 `pnpm test:python` 运行全部 Python 测试和对插件的一致性测试，不进 `pnpm test`，免得每台开发机都要装 uv | T03，由 T00 写进文档 |
| 伪出图服务、伪启动器 | core 的一致性测试默认对着伪服务跑（[插件 §3.6](../docs/plugins.md#36-一致性测试)），端到端测试也要用 | T08、T10 |

### 1.3 明确推迟（不做）

下面这些功能在设计文档里和插图有交集，但它们本身**还没有实现**（规划时核过：`packages/contracts/src/procedures/play.ts` 里没有换一种发展、存档、试玩的过程）。本里程碑不为它们写任何代码，只在它们将来实现时按 `docs/image.md` 的规则补上插图那部分。

| 推迟项 | 现状 | 将来要补什么 |
| --- | --- | --- |
| 换一种发展（候选） | `turns.status` 有 `candidate` 值，`turn_requests.kind` 有 `rewrite` 值，但没有任何过程使用 | 候选只记 `illustrate_para`、不登记插图；采用时按启用条件登记（[插图与出图服务 §7.1](../docs/image.md#71-什么时候画)） |
| 手动存档、从存档另开、多条路线 | 只有一条路线 | 重画、取图按原回合和原段号；手记缩略图按当前路线可见的形象 |
| 试玩开局 | `playthroughs.kind` 有 `trial` 值，但没有过程 | 试玩开局走同一套插图规则 |
| 单独删除一局及其图片 | 已在 [docs/milestone-4.md](../docs/milestone-4.md#留给后续的能力) 推迟 | — |
| 游玩页的「保存图片」以外的导出 | 已在 docs 推迟 | — |

这意味着下面几条验收只验证单路线的那一半：

- [插图与出图服务 §14](../docs/image.md#14-验收)里「在存档分出的路线重画」那一行，只验证单路线；
- 「候选里标了插图」那一行，本次不验证。

T00 在 `docs/milestone-4.md` 的验收表里把这两行标成依赖未实现的功能。

### 1.4 设计决定（已确认）

设计文档没写死、但实现必须定下来的地方，采用下表。T00 已把它们写进设计文档。

| 编号 | 问题 | 本文采用 | 其他做法 |
| --- | --- | --- | --- |
| D1 | `providers.json` 由谁读写 | 新建 `packages/core/src/providers/` 模块，拥有文件的 schema（版本 2）、读写、从版本 1 迁移、`.bak` 备份。`llm` 和 `image` 都从它读，经它的写队列写。`llm/providers-schema.ts`、`llm/providers-file.ts` 移进去 | 让 `image` 经 `LlmService` 读写：出图配置要绕道模型服务，接口会长出一堆和模型无关的方法 |
| D2 | 版本 1 的文件什么时候升级 | 读到版本 1 时只在内存里补上 `imageServices: []` 和 `image: { service: null }`，`version` 视为 2。**第一次从界面保存**（任何一个改 `providers.json` 的过程）时，先把磁盘上的原文件按字节复制到同目录的 `providers.json.bak`（权限 0600，已存在就覆盖），再写版本 2 | 启动时就写回：用户没改任何东西，文件就变了 |
| D3 | 插图总开关和确认存在哪 | `app_settings` 加一列 `illustration`（JSON，非空，迁移默认值见 T05），形状是 `IllustrationSettingsStored`：`{ autoEnabled, confirmed, defaults }`。`confirmed` 记确认时的出图服务 id、`openai-images` 的模型 id（`unwritten-image` 为空）和 `background` 用途实际解析到的端点 id 与模型 id。读取时任一项和当前配置对不上，视为未开启 | 单独建表：只有一行，没必要 |
| D4 | 分辨率档位的代码名 | `ImageTier = '720' \| '1k' \| '2k'`。偏好里多一个 `'default'`，表示「服务默认」：`ImageTierPreference = ImageTier \| 'default'`，和[数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)的 `resolutionTier` 一致。界面文案见附录 A。比例的代码名就是比例字符串，例如 `'3:2'` | 用数字像素：不同比例下同一档的像素不同 |
| D5 | 镜头描述的输出格式 | 纯文本，每行 `标签: 内容`，标签固定为 `PROMPT`、`NEGATIVE`、`CAPTION`、`REFS`、`ASPECT`，大小写敏感，标签后跟英文冒号和一个空格。同一标签出现两次算错误。解析规则见附录 C.1 | 让模型输出 JSON：`background` 模型常常写不对 |
| D6 | 镜头描述的场景材料怎样交给模型 | 一段固定格式的文字，分「已发生的正文」「在场的人」「镜头要求」三块，格式见附录 C.2。人物用短编号 `C1`、`C2`… 指代，本次请求内由 core 映射回实体 id | 给实体 id：模型永远不该看到 id |
| D7 | 真名检查怎样做 | 对 `PROMPT` 和 `NEGATIVE` 做大小写无关的子串匹配。名单是在场人物和主角的实体表 `name` 去首尾空白后、长度不少于 2 个字符的值。命中就作为校验错误交回模型重写 | 分词匹配：中文没有可靠的分词，英文名大小写不一 |
| D8 | 画面说明的泄露检查 | 由 T14 的段落投影给出 `unknownNames`：这一刻主角还不知道的名字和称呼。候选集合和 `story/leak.ts` 的 `findLeaks` 相同，都是实体表的名字加全部称呼；已知集合按这一刻计算，长度下限同 `STORY_LIMITS.nameMinLengthForLeakCheck`。画面说明里出现任何一个，就作为校验错误交回模型。不直接调用 `findLeaks`：它按整回合计算已知称呼，同一回合里图所在段之后才知道的称呼会被当成已知 | 直接调用 `findLeaks`：会放过本段之后才揭晓的称呼 |
| D9 | 图片文件放哪 | `<数据目录>/images/blobs/<sha256>.<ext>`，临时文件放 `<数据目录>/images/tmp/<随机名>.part`。`images/tmp/` 启动时整个清空 | 临时文件和正式文件放同一目录：清理时要分辨 |
| D10 | 写入和清理怎样互斥 | `illustration/storage.ts` 里一个进程内的串行锁 `imageWriteLock`（`p-queue`，并发 1）。§9.3 的第 3 步、`gc()` 都在锁里执行。跨进程不需要：数据目录本来就有单实例锁（`DataDirLockedError`，按符号名找） | 用 SQLite 事务当锁：文件改名不在事务里 |
| D11 | 参考组的位置名 | `PortraitSlot = 'front' \| 'three_quarter' \| 'full_body'` | — |
| D12 | 本机导入怎样上传 | `portrait.upload` 的输入是 oRPC 的 multipart：`{ requestId, setId, slot, expectedRev, file: File }`。core 在 Hono 层用 `bodyLimit` 限制 `/api/portrait/upload` 的请求体不超过 `PORTRAIT_UPLOAD_MAX_BODY_BYTES`（默认 `PORTRAIT_IMPORT_MAX_BYTES + 64 KiB`），超出返回 413，不进 oRPC 解析 | base64 进 JSON：体积多三分之一，还要另写解码 |
| D13 | `image.file` 返回什么 | oRPC 的 `File` 输出（`File.type` 取校验时得到的媒体类型），响应头加 `X-Content-Type-Options: nosniff`。HTTP 层由 oRPC 的 `File` 编码决定，client 用 `blob()` 拿字节，再 `URL.createObjectURL` | 返回 base64：大图在 JSON 里 |
| D14 | 新增的事件 | 在 `CoreEventSchema` 里加四个：`illustration.updated { routeId, turnId, illustrationId }`、`portrait.updated { workId }`、`image.config_changed`、`image.service_state { serviceId }`。事件只带标识，详情由查询返回 | 事件里带完整状态：client 会有两份真相 |
| D15 | 插图视图放哪 | `TurnViewSchema` 加 `illustration: IllustrationViewSchema.nullable().default(null)`。`play.getRoute` 返回时带上。`illustration.updated` 让 client 失效 `queryKeys.route(routeId)` | 单独的过程：client 要按回合再查一遍 |
| D16 | 插图任务放在哪个队列 | `illustration/worker.ts` 一个后台循环，从库里按 `created_at` 取 `queued` 行，每次一行，并发 1。出图请求本身再进 `image` 模块按服务的队列（并发 1） | 每张插图一个 Promise：进程重启后丢失 |
| D17 | 测试镜头描述用什么模型 | 单元测试用 `createScriptedLlm` 的 `complete` 步骤；集成测试用伪 OpenAI 服务的非工具回复 | — |
| D18 | Python 版本 | `plugins/comfyui`、`selfhost/colab`、`selfhost/strata`：`requires-python = ">=3.11"`。`plugins/colab-launcher`：`">=3.12"`（Colab CLI 要求 3.12 以上） | 统一 3.12：Colab 运行时的 Python 版本以运行时为准，可能更低 |
| D19 | `pnpm test:python` 做什么 | 依次在四个 Python 目录里跑 `uv run --frozen pytest`；再用伪 ComfyUI 启动包装、用伪 colab 命令启动启动器，对着它们跑 core 的两组一致性测试。任一步失败就以非零退出 | 并进 `pnpm test`：没装 uv 的机器跑不了 |
| D20 | 源码扫描的名单 | `comfy`、`colab`、`tailscale`、`strata`，大小写无关。不含 `qwen`：core 的思考写法里本来就有 `qwen`、`qwen-chat-template`（按 `THINKING_FORMATS` 找，规划时在 `contracts/src/schemas/llm.ts`），它们指模型的请求写法，不是插件。扫描范围是 `apps/`、`packages/` 下被 git 跟踪的文件（`git ls-files apps packages`），跳过 `pnpm-lock.yaml` | 扫描工作区全部文件：会扫到 `node_modules` |
| D21 | 主角形象的 AI 补写什么时候发生 | 在插图流程的第 1 步（[插图与出图服务 §7.2](../docs/image.md#72-一张插图的流程)），以及开局页「按设定写一个」（`play.suggestAppearance`）。开局时不补写 | 开局时同步补写：固定人物开场会被一次模型调用挡住 |
| D22 | 插图记录里 `format` 的形状 | 统一用 `OutputPreferences` 的字段名：`format_preference` 是 `{ aspectPreference: 'auto' \| string, resolutionTier: ImageTierPreference }`，`format` 是 `{ aspectPreference, resolutionTier, size: { width, height } \| null }`。`resolutionTier` 为 `'default'` 时 `size` 为空，请求里不带 `size`。重画以已有 `format` 为基准，`formatOverride` 只在用户另选规格时覆盖 | — |
| D23 | 回合循环文档里的一处矛盾 | [回合循环 §6](../docs/turn-loop.md#6-校验与保存)的校验表写的是「`illustrate` 不合格就丢弃标记」「形象不合格就丢弃形象、保留人物」，形象可选；但同一文档验收表里「narrator 新增一个人物，没写 `appearance`」那一行写的是「返回修正，要求补上形象」。本文按校验表和[插图与出图服务 §6.1](../docs/image.md#61-形象)写：形象可选，不合格的形象和插图标记直接丢弃，不返回修正。T00 改掉验收表那一行 | 按验收表返回修正：和维护者修订后的「形象可选」矛盾 |
| D24 | `play.suggestAppearance` 和作者默认画风由哪个服务实现 | 契约路径照设计写：`play.suggestAppearance`，以及新增的 `works.setIllustrationStyle`。路由把两者都交给 `IllustrationService`（`suggestAppearance`、`setWorkStyle`）。这样 `PlayService`、`LibraryService` 的接口不变，占位不会和改回合循环的任务抢同一个文件 | 加到 `PlayService`、`LibraryService`：T06 和 T12 会在同一波次改 `play/service.ts` |
| D25 | 新的伪服务放哪、怎样导入 | 放在 `packages/core/src/test-support/` 下各自的文件里，**不加进 `test-support/index.ts`**，测试按路径导入。这样同一波次的几个任务不会同时改 `index.ts` | 都加进 `index.ts`：并行任务改同一行，合并冲突 |
| D26 | 作者默认画风怎样保存 | 新过程 `works.setIllustrationStyle({ workId, style })`，直接写 `works.illustration_style`，不碰草稿、不改 `content_rev`（[插图与出图服务 §6.3](../docs/image.md#63-画风)）。`style` 为 `null` 时清空，回到 `DEFAULT_ILLUSTRATION_STYLE` | 并进 `saveDraft`：会让画风改动计入草稿修订号，违反设计 |
| D27 | 段落投影里「这一刻在场的人」从哪里找 | 在场候选取三种来源的并集：上一回合 `scene.present` 里的人；目标回合里出处段号不晚于这一段的新登记人物；主角此刻已知的称呼（长度不少于 2 个字符）出现在截至这一段的正文里的人物。只取人物。不用目标回合结束时的 `scene`（[数据模型 §5](../docs/data-model.md#5-可见性规则)）。候选再走 D28 的亲见守卫。T00 把这条写进数据模型 §5。登记段号从 `entities.source_para` 读取，缺出处的旧记录不据此列为本段新人物 | 让模型判断谁在场：可见性边界不能交给模型 |
| D28 | 形象变化如何成为段落里可用的可见事实 | T12 已禁止模型用 `knowledge` 引用形象特征。T14 将有明确出处的 `appearance` 特征作为呈现事实，按本路线和目标段投影，只在有已见过的知情状态和当场证据时采用。当场证据来自上一回合的在场记录，或截至该段明确登记的相遇。形象特征本身、只听说过的称呼和未确认的知情都不能证明亲眼看见。现有的基础人物档案也只在目标场景已经见到该人物时使用。`data.same_visible_identity` 在提案里写字符串 `"true"`，存储为数字 `1`，T12 和 T14 都按 `1` 判断 | 等待模型另填 `knowledge` 会和提案契约冲突；只按 `trait` 的存在或旁人提及推断会泄露形象 |

### 1.5 已验证的前提

规划时实测或读源码核过。执行者不必重做，但写判据时可以依赖：

| 前提 | 核法 | 读数 |
| --- | --- | --- |
| `p-queue` 已是 core 的依赖 | `sed -n '/"dependencies"/,/}/p' packages/core/package.json` | 列出 `"p-queue": "catalog:"`，catalog 版本 10.0.0 |
| 不跟随重定向的 `fetch` 封装现在在 `llm` 模块里 | `rg -n "createGuardedFetch\|installGlobalFetchGuard\|unguardedFetch" packages/core/src` | 定义在 `llm/fetch-guard.ts`；`llm/run.ts`、`llm/test-connection.ts` 调用；`main.ts` 第一行导入 `llm/fetch-guard-install.ts` |
| `providers.json` 的读写在 `llm` 模块内部 | `rg -n "createProvidersStore" packages/core/src` | 只有 `llm/service.ts` 调用 `createProvidersStore(join(deps.dataDir, 'providers.json'), …)` |
| 读到版本号大于 1 的文件会报 `too_new` | 读 `llm/providers-file.ts` 的 `load` | `if (typeof version === 'number' && version > 1)` |
| 实体档案只有一个字段 | `rg -n "EntityProfileSchema" packages/core/src/story/types.ts` | `z.object({ text: z.string() })` |
| `propose_turn` 有四个参数 | 读 `play/propose-turn-tool.ts` 的 `PROPOSE_TURN_PARAMETERS` | `prose`、`options`、`changes`、`ending`，`additionalProperties: false` |
| 回合提交的事务位置 | `rg -n "transaction\(" packages/core/src/play --glob '!*.test.ts'` | 续写在 `play/service.ts`（规划时第 422 行），开局在 `play/opening-job.ts`（第 338 行）和 `play/start.ts`（第 162 行） |
| client 的事件订阅集中在一处 | `rg -n "events.subscribe" apps/client/src --glob '!*.test.*'` | 只有 `app/App.tsx` |
| 仓库没有 CI 配置 | `ls -a .github` | `No such file or directory` |
| oRPC 的 fetch 适配器处理 multipart | `rg -c "multipart/form-data\|FormData" node_modules/.pnpm/@orpc+standard-server-fetch@1.16.6/node_modules/@orpc/standard-server-fetch/dist/index.mjs` | 命中 3 处。T02 仍要先做 §5 T02 第 1 步的小实验，确认 `File` 能在输入和输出里往返 |
| Node 自带 `File`、`Blob`、`FormData` | `node -e "console.log(typeof File, typeof Blob, typeof FormData)"` | `function function function` |

---

## 2. 贯穿全局的约定

### 2.1 命名

领域词按 [docs/AGENTS.md §4.1](../docs/AGENTS.md#41-术语对照表)。本里程碑新增的代码名：

| 概念 | 代码名 |
| --- | --- |
| 出图协议 | `ImageProtocol = 'unwritten-image' \| 'openai-images'` |
| 出图服务（配置里的一项） | `ImageServiceEntry`（文件里的形状）、`ImageServiceView`（给 client 的形状） |
| 能力 | `ImageCapabilities` |
| 比例 | 比例字符串，例如 `'3:2'`；比例偏好 `AspectPreference = 'auto' \| string` |
| 分辨率档位 | `ImageTier = '720' \| '1k' \| '2k'`；偏好 `ImageTierPreference = ImageTier \| 'default'` |
| 质量档 | `ImageQuality = 'fast' \| 'best'` |
| 出图请求、结果 | `ImageGenerateInput`、`ImageGenerateResult`（`image` 模块内部） |
| 启动器 | `ImageLauncherEntry`、`LauncherState = 'stopped' \| 'starting' \| 'needs_action' \| 'running' \| 'stopping' \| 'failed'` |
| 服务的唤醒状态（给 client） | `ImageServiceState = 'ready' \| 'offline' \| 'waking' \| 'needs_action' \| 'wake_failed' \| 'unknown'` |
| 画风 | `IllustrationStyle = { kind: 'preset', preset: StylePreset } \| { kind: 'custom', text: string }`；预设 `StylePreset = 'watercolor' \| 'ink' \| 'anime' \| 'painterly' \| 'cinematic'` |
| 本局插图设置 | `PlaythroughIllustration`（存在 `playthroughs.illustration`） |
| 插图记录 | 表 `illustrations`；`IllustrationStatus = 'queued' \| 'running' \| 'done' \| 'failed' \| 'cancelled' \| 'dismissed'`；`IllustrationStage = 'wake' \| 'appearance' \| 'shot' \| 'portrait' \| 'generate' \| 'save'`；视图 `IllustrationView` |
| 人物参考组 | 表 `portrait_sets`；`PortraitScope = 'work' \| 'pending' \| 'playthrough'`；`PortraitState = 'draft' \| 'active' \| 'retired'`；`PortraitSlot = 'front' \| 'three_quarter' \| 'full_body'`；视图 `PortraitSetView` |
| 文件引用 | `ImageFileRef = { hash, mime, width, height, bytes }` |
| 镜头描述 | `ShotDescription`（解析后的结构）、`ShotInput`（交给模型的材料） |
| 段落投影 | `SceneMaterials`（`story/scene-projection.ts`） |
| 出图调用记录 | 表 `image_calls` |
| 启动器协议客户端 | `LauncherClient`（`image/launcher-client.ts`） |

- core 新模块：`packages/core/src/net/`、`packages/core/src/providers/`、`packages/core/src/image/`、`packages/core/src/illustration/`。
- 文件名：TypeScript 模块用 kebab-case，React 组件用 PascalCase，CSS Module 和组件同名，hook 用 camelCase。Python 模块用 snake_case。

### 2.2 id、时间、JSON、哈希

- id 一律 `crypto.randomUUID()`（core 里 `import { randomUUID } from 'node:crypto'`）。出图服务的 id 例外，格式是 `image-<名称简写>-<6 位十六进制>`，取法同自定义端点的 `newEndpointId`（按符号名找，规划时在 `llm/endpoint-id.ts`）。
- 时间一律存毫秒整数 `Date.now()`。**协议里**的时间（启动器的 `since`、`expiresAt`）是 Unix 秒，进 core 后乘 1000 再用。
- JSON 列用 Drizzle 的 `text(..., { mode: 'json' })`。形状由 Zod schema 定义，写入前用同一个 schema 校验（[packages/core/AGENTS.md §2](../packages/core/AGENTS.md#2-契约与错误)）。
- 图片哈希一律是文件字节的 SHA-256，小写十六进制，64 个字符：`createHash('sha256').update(bytes).digest('hex')`。
- 令牌：`randomBytes(32).toString('base64url')`，长度 43。

### 2.3 错误码

全部错误码只在 `packages/contracts/src/errors.ts` 的 `ERROR_CODES` 里列一次。加一个错误码要同时改三处：

1. `contracts/src/errors.ts` 的 `ERROR_CODES`；
2. `core/src/errors.ts` 的 `HTTP_STATUS`；
3. `client/src/i18n/zh-CN/errors.json`。

`keys.test.ts` 会检查第三处，TypeScript 会检查第二处。本里程碑新增的全部错误码由 T02 一次加齐，文案见附录 A.1：

| 码 | HTTP 状态 | 什么时候 |
| --- | --- | --- |
| `image_not_configured` | 409 | 要出图，但 `image.service` 为空，或选中的服务已被删除 |
| `image_unauthorized` | 502 | 出图服务返回 401、403 |
| `image_quota` | 502 | OpenAI 图像接口返回 `insufficient_quota` |
| `image_rate_limited` | 502 | 429，重试一次后仍然 429 |
| `image_offline` | 502 | 连不上出图服务 |
| `image_not_ready` | 503 | 服务在线但未就绪 |
| `image_busy` | 503 | 服务队列已满，等过 `Retry-After` 重试一次后仍然满 |
| `image_refused` | 502 | 服务拒绝出图（`refused`、`moderation_blocked`） |
| `image_timeout` | 504 | 超过 `IMAGE_JOB_TIMEOUT_MS` 或 `OPENAI_IMAGE_TIMEOUT_MS` |
| `image_server` | 502 | 服务返回 5xx，或任务以 `internal` 失败 |
| `image_outcome_unknown` | 502 | 请求可能已提交，响应丢失（[插图与出图服务 §4.4](../docs/image.md#44-错误)） |
| `image_invalid_request` | 502 | 服务说请求不合格（`invalid_request`、`idempotency_conflict`、OpenAI 的其他 400） |
| `image_invalid_response` | 502 | 返回的图片不合格（§5 T07） |
| `image_redirected` | 502 | 服务返回重定向 |
| `image_out_of_memory` | 502 | 服务报告显存不足 |
| `image_workflow_error` | 502 | 服务报告模板跑不通 |
| `image_interrupted` | 409 | 任务被中断、结果过期，或 core 重启时任务还在跑 |
| `image_file_missing` | 404 | 记录有图，`images/` 里却没有这个文件 |
| `image_invalid_upload` | 400 | 本机导入的图片不合格 |
| `image_reference_too_large` | 409 | 参考组里每一张都超过服务的单张上限 |
| `image_output_format_unavailable` | 409 | 选定的比例、档位或尺寸当前服务不支持 |
| `image_launcher_offline` | 502 | 连不上启动器 |
| `image_launcher_unauthorized` | 502 | 启动器返回 401 |
| `image_wake_failed` | 502 | 启动器报告 `failed`，或启动器返回的状态不合格（见 T11）。服务自检报告 `out_of_memory`、`workflow_error` 时不用这个码，用对应的 `image_out_of_memory`、`image_workflow_error` |
| `image_wake_timeout` | 504 | 唤醒超过 `IMAGE_WAKE_TIMEOUT_MS` |
| `illustration_not_enabled` | 409 | 对一局纯文字的开局，或在自动出图未确认时，调用插图的重试或重画 |

服务返回的 `message`、启动器返回的 `reason` 原文都不当作错误码，也不显示给用户（[插件 §3.5](../docs/plugins.md#35-错误)）。`image_wake_failed` 的 `detail` 放启动器的 `reason` 枚举值（`quota`、`not_signed_in`、`action_expired`、`start_error`），client 按 `play:wake.reason.<值>` 显示（附录 A.4）。

### 2.4 i18n

**client。** 规则同第三个里程碑：

- 调用时写完整键，例如 `t('play:illustration.waking')`；不拼接；动态键只允许 `errors:${code}`，以及本文明确写出的几处枚举对照表。
- 作品内容、AI 输出、画面说明、模型 id、服务名、服务地址原样显示。
- **插图 `<img>` 的 `alt` 用画面说明原文**，这是作品内容，不走 i18n（[a11y §8](../docs/a11y.md#8-游玩页)）。画面说明为空时 `alt` 用 `t('play:illustration.altFallback')`。
- **不新增命名空间**：
  - 设置页的出图服务、按需启动、自动出图确认、用量放 `settings`；
  - 创作页的画风、人物参考放 `authoring`；
  - 开局页的插图设置、游玩页的插图、大图、唤醒提示、手记缩略图放 `play`；
  - 几处共用的按钮文字放 `common`。
- 全部新文案见附录 A，照抄。
- 枚举值的显示文案用“枚举值 → 键”的对照表，表旁边写一个测试：对 contracts 里枚举的每一个值都能查到一个存在的键（从枚举现取，先断言枚举非空）。本里程碑要建对照表的枚举有：`StylePreset`、`ImageTier`、`PortraitSlot`、`ImageServiceState`、启动器失败原因、`IllustrationStage`。

**给模型的文字**写在 core 的常量里，不走 i18n。包括：

- 镜头描述的提示词；
- 主角形象补写的提示词；
- 画风预设的英文片段；
- 固定要避开的内容；
- 返回给模型的校验错误。

**Python 插件**的日志和错误 `message` 只给开发者看，用英文，不进 i18n。

### 2.5 运行诊断与性能记录

规则同第三个里程碑，以[运行诊断与性能记录](../docs/diagnostics.md)为准。

- `deps.logger.record(...)` 记事件，`deps.logger.sample(...)` 记计时。
- `data` 里只放枚举、计数、布尔和 id。**不放**：
  - 提示词、画面说明、形象原文、正文；
  - 服务地址、key、令牌、文件路径、哈希；
  - 启动器给的授权地址。
- logger 会按键名拦掉 `url`、`token`、`message`、`content` 等键（`BLOCKED_DATA_KEYS`，按符号名找，规划时在 `log/logger.ts`），但不要依赖它：键名起成 `prompt`、`caption`、`appearance` 也不会被拦，写进去就是泄露。
- **关键路径成功也要记，不只记失败。**

本里程碑新增的事件和样本（`module` 一栏是 `LogEvent.module` 的值）：

| 名字 | 类型 | module | 级别 | data 字段 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| `providers.migrated` | 事件 | providers | info | `from`（1）、`to`（2）、`backup`（布尔，是否写了 `.bak`） | T04 |
| `image.config.loaded` | 事件 | image | info | `services`（个数）、`selected`（布尔） | T06 |
| `image.service.created` / `.updated` / `.removed` | 事件 | image | info | `protocol`、`hasLauncher`（布尔） | T06 |
| `image.auto_illustration.set` | 事件 | image | info | `enabled`（布尔） | T06 |
| `image.service.probe` | 事件 | image | debug；失败时 info | `serviceId`、`protocol`、`result`（`ready` / `not_ready` / `offline` / `unauthorized` / `invalid`）、`reason`（未就绪原因枚举，没有时不写） | T11 |
| `image.generate` | 样本 | core | — | `callId`；`data`：`protocol`、`quality`、`references`（张数）、`code`（失败时的错误码） | T11 |
| `image.wake.started` | 事件 | image | info | `serviceId`、`trigger`（`prewarm` / `demand`） | T11 |
| `image.wake.done` | 事件 | image | info | `serviceId`、`trigger`、`userAction`（布尔）、`durationMs` | T11 |
| `image.wake.failed` | 事件 | image | warn | `serviceId`、`trigger`、`code`（错误码）、`reason`（启动器的原因枚举，没有时不写） | T11 |
| `image.wake` | 样本 | core | — | `data`：`trigger`、`userAction` | T11 |
| `illustration.flagged` | 事件 | illustration | info | `routeId`、`depth`、`para` | T18 |
| `illustration.done` | 事件 | illustration | info | `illustrationId`、`references`、`portraitsGenerated`（本次现画了几张参考图）、`reroll`（布尔） | T18 |
| `illustration.failed` | 事件 | illustration | warn | `illustrationId`、`stage`、`code` | T18 |
| `illustration.dismissed` | 事件 | illustration | info | `illustrationId`、`hadImage`（布尔） | T18 |
| `illustration.cancelled` | 事件 | illustration | info | `count`（本次取消的记录数）、`reason`（`disabled` / `service_changed` / `no_material`） | T18 |
| `illustration.queue` | 样本 | core | — | 入队到开始处理；`data`：`para` | T18 |
| `illustration.shot` | 样本 | core | — | 开始写镜头描述到校验通过或失败；`data`：`corrections`（重写次数）、`refs`（参考人物数）、`autoAspect`（布尔） | T16 |
| `illustration.total` | 样本 | core | — | 开始处理到写入并提交、失败或中断；`data`：`references`、`portraitsGenerated` | T18 |
| `portrait.done` / `portrait.failed` | 事件 | illustration | info / warn | `setId`、`slot`、`source`（`generate` / `import`）、失败时 `code` | T17 |
| `portrait.adopted` | 事件 | illustration | info | `setId`、`scope`、`slots`（已复核的位置数） | T17 |
| `image.gc` | 事件 | illustration | info | `sets`（回收的组数）、`files`（删除的文件数）、`bytes`（释放的字节数） | T15 |
| `image.gc` | 样本 | core | — | `data`：`files`、`bytes` | T15 |
| `image.gc.failed` | 事件 | illustration | warn | `trigger`（`startup` / `work_deleted`）；`code` 取 `diagnosticFault(error).systemCode ?? 'internal'` | T29 |
| `image.settings.invalid` | 事件 | image | warn | 无 | T06 |
| `image.store.mismatch` | 事件 | illustration | warn | `expectedBytes`、`actualBytes` | T15 |
| `illustration.interrupted` | 事件 | illustration | warn | `requestId` 为插图 id；`data` 有 `stage`、`code` | T18 |
| `portrait.interrupted` | 事件 | illustration | warn | `requestId` 为本次尝试 id；`data` 有 `setId`、`slot`、`code` | T17 |
| `image.store.failed` | 事件 | illustration | error | `stage`（`temp_write` / `rename` / `commit`）、`code`（系统错误码，例如 `ENOSPC`） | T15 |
| `client.illustration_visible` | 样本 | client | — | 插图记录出现到图片在屏幕上解码完成；带 `requestId` 为插图 id | T02（契约）、T24（上报） |

T00 把这张表的新增行写进 `docs/diagnostics.md` §2 的事件约定和 §3 的样本表。

### 2.6 安全

规则同第三个里程碑。新增的注意点：

- **key 和令牌**（出图服务的 `apiKey`、启动器的 `apiKey`）的规则照搬模型服务：只存在 `providers.json` 和 core 的内存里；给 client 的视图只有 `hasKey` 和 `keySource`；新生成的令牌只在 `generateToken` 那一次响应里出现。它们不进诊断、不进 stdout、不进错误的 `detail`。
- **出图服务和启动器的返回是信任边界。** 逐字段按 Zod schema 校验，不合格的当作 `image_invalid_response`（服务）或 `image_wake_failed`（启动器）。图片字节必须过 T07 的校验。
- **启动器给的授权地址**只接受 `https:` 协议（`new URL(value).protocol === 'https:'`），其余一律当作唤醒失败，不交给 client。client 只用它打开系统浏览器（`window.open(url, '_blank', 'noopener,noreferrer')`，desktop 会把它交给系统浏览器）。
- **`image.file` 是唯一的取图入口。** 它按视图来源核对归属（[插图与出图服务 §10](../docs/image.md#10-交给-client)）：游玩只能取本路线可见的插图和手记里实际返回的参考图位置，创作页只能取本作品的参考组。核对不过返回 `not_found`，不区分“没有”和“不许看”。
- **提示词、画面说明、形象原文是作品内容。** 只存在 `library.db`，诊断只记条数和枚举。
- **Python 服务**只监听 `127.0.0.1`；令牌用 `hmac.compare_digest` 比较；日志不记请求体、提示词、图片、令牌（[插件 §4](../docs/plugins.md#4-插件的义务)）。

### 2.7 测试

| 层 | 工具 | 放哪里 | 命名 |
| --- | --- | --- | --- |
| contracts、core 单元与集成 | Vitest（Node 环境） | 和被测文件放在一起 | `*.test.ts` |
| core 协议一致性测试 | Vitest | `packages/core/src/image/conformance/`、`packages/core/src/image/launcher/conformance/` | `*.conformance.test.ts`；默认对着伪服务跑，设了环境变量时对着真服务跑 |
| client 纯逻辑 | Vitest（项目名 `unit`） | 同上 | `*.test.ts` |
| client 组件 | Vitest 浏览器模式（项目名 `browser`）+ `vitest-browser-react` + axe-core | 同上 | `*.test.tsx` |
| 端到端 · 浏览器 | Playwright，浏览器打开独立运行的 core，出图服务和启动器用伪服务 | `e2e/tests/milestone-4.spec.ts` | `*.spec.ts` |
| Python | pytest（`pytest-aiohttp` 起伪服务） | 各 Python 目录的 `tests/` | `test_*.py` |

写判据的规矩同第三个里程碑（[tasks/AGENTS.md §4](./AGENTS.md#4-判据)）：

- 每条判据配一个最小突变；
- 断言钉产物，不回抄自己的声明；
- 否定命题要配阳性对照；
- 扫描得到的集合先断非空；
- 会启动后台队列的测试，动作后用 `whenIdle()` 等完再断言；
- 查元素用 `getByRole` 和可读名称。

**图片夹具。** 测试需要的图片字节一律在测试里现造，不提交二进制文件：

- TypeScript 一侧由 T07 在 `packages/core/src/test-support/image-bytes.ts` 提供 `pngBytes`、`TINY_WEBP`、`webpHeaderBytes`、`jpegHeaderBytes`，造出最小但合法的文件头或能解码的小图；
- client 浏览器测试用 `OffscreenCanvas` 现画；
- Python 一侧用 Pillow 现画。

需要模型的测试一律用伪服务：core 单元测试用 `createScriptedLlm`，core 集成测试和端到端测试用伪 OpenAI 服务（`packages/core/src/test-support/fake-openai-server.ts`）。需要出图的测试一律用 T08 的伪出图服务或 T09 的伪 OpenAI 图像服务。

### 2.8 契约变更“只加不删”

为了让每个波次合并后 `pnpm typecheck` 都能过，contracts 的变更只加不删：

- 新字段在输出 schema 上带 `.default(...)` 或 `.nullable().default(null)`，以便解析缺字段的数据。同时在 T02 给现有生产者和类型化夹具填默认值。Zod 解析后的输出字段在 TypeScript 中是必填的。
- 输入 schema 只放宽，不收紧。例如 `StartPlaythroughInputSchema` 新加的 `illustration` 是可选的，core 收到缺省时按「本局纯文字」处理。

本里程碑结束时不收紧，因为没有要删的旧字段。

### 2.9 接口先行与占位实现

T02 扩展公开契约时，在同一任务中给新增过程接临时路由，旧过程照常运行。T06 接上 `services.ts` 的 `ImageService`、`IllustrationService`，把每个临时路由换成服务调用。由后续任务实现的服务方法在 T06 写占位：

```ts
throw appError('internal', 'not implemented: <服务名>.<方法名>');
```

后续任务把占位换成真实现。T29 的判据之一是 `grep -rn "not implemented:" packages/core/src` 零命中。占位只允许出现在本文明确要求的位置。

### 2.10 依赖与版本

**TypeScript 一侧不新增依赖。** 用到的都已经在仓库里：

- `p-queue`：按服务排队、写入锁；
- `zod`、`@orpc/*`：契约与 multipart；
- Node 自带的 `fetch`、`FormData`、`Blob`、`File`、`crypto`；
- 浏览器自带的 `createImageBitmap`、`OffscreenCanvas`、`HTMLCanvasElement.toBlob`。

**Python 一侧**由 T03 一次写进四个 `pyproject.toml`，其他任务不改依赖段：

| 目录 | 运行依赖 | 开发依赖 |
| --- | --- | --- |
| `selfhost/colab` | 无（只用标准库和 Colab 自带的 `google.colab`） | `pytest`、`ruff` |
| `plugins/comfyui` | `aiohttp`、`Pillow` | `pytest`、`pytest-aiohttp`、`ruff` |
| `selfhost/strata` | `aiohttp` | `pytest`、`pytest-aiohttp`、`ruff` |
| `plugins/colab-launcher` | `aiohttp` | `pytest`、`pytest-aiohttp`、`ruff` |

- 版本由 T03 在写 `pyproject.toml` 时，按“发布满两周的最新版”选定（`uv pip index versions <包名>` 或 PyPI 页面核对发布日期），写成精确版本（`==`），并记进台账。
- `plugins/comfyui` 的 `aiohttp`、`Pillow` 版本必须满足 ComfyUI `requirements.txt` 的下限（规划时是 `aiohttp>=3.11.8`、`Pillow>=10.1.0`，[ComfyUI 插件 §6.1](../docs/comfyui-plugin.md#61-依赖)）。
- `docs/tech-stack.md` 已经写了 uv、ruff、pytest、Colab CLI，不用改。

---

## 3. 任务依赖与并行波次

同一波次里的任务互不依赖、拥有的文件互不重叠，可以同时派给不同的子代理。每个波次结束时，编排者按编号顺序合并，跑全量检查，全绿才开下一波。

| 波次 | 任务 | 依赖 | 线 |
| --- | --- | --- | --- |
| W0 | T00 设计补洞 | 维护者确认 §1.4 | — |
| W1 | T01 core：`net` 模块 | — | A |
| W1 | T02 contracts：插图与出图的全部契约 | — | 全部 |
| W1 | T03 仓库：Python 工具链、`pnpm test:python`、插件名扫描 | — | D |
| W2 | T04 core：`providers` 模块与版本 2 | T02 | A |
| W2 | T05 core：库表与迁移 | T02 | B |
| W2 | T07 core：图片字节校验与测试夹具 | T02 | A |
| W2 | T20 client：插图共用的基础件 | T02 | C |
| W2 | T25 selfhost/colab：Colab 宿主 | T03 | D |
| W3 | T08 core：Unwritten 图像协议客户端、伪服务、一致性测试 | T01、T02、T07 | A |
| W3 | T09 core：OpenAI 图像接口与伪服务 | T01、T02、T07 | A |
| W3 | T10 core：启动器协议客户端、伪启动器、一致性测试 | T01、T02、T07 | A |
| W3 | T12 core：形象与插图标记进入回合循环和创作 | T02、T05 | B |
| W3 | T15 core：图片存储、写入锁与清理 | T05、T07 | B |
| W3 | T21 client：设置页的出图服务 | T20 | C |
| W3 | T22 client：创作页的画风与人物参考组 | T20 | C |
| W3 | T24 client：游玩页的插图、大图与唤醒提示 | T20 | C |
| W4 | T06 core：`image` 服务的配置、视图与接口占位 | T04、T05、T09 | A |
| W4 | T14 core：按段落投影场景材料 | T12 | B |
| W4 | T23 client：开局页的插图设置 | T20、T22 | C |
| W4 | T26 plugins/comfyui：ComfyUI 插件 | T03、T08、T25 | D |
| W4 | T27 selfhost/strata：Strata 网关 | T03、T25 | D |
| W4 | T28 plugins/colab-launcher：Colab 启动器 | T03、T10、T25 | D |
| W5 | T11 core：`image` 引擎：探测、排队、生成、唤醒、调用记录 | T06、T08、T09、T10 | A |
| W5 | T13 core：开局的插图设置、主角形象与作者画风 | T06、T12、T15 | B |
| W6 | T16 core：镜头描述 | T13、T14 | B |
| W6 | T17 core：人物参考组 | T11、T13、T15 | B |
| W7 | T18 core：插图流程 | T11、T12、T13、T15、T16、T17 | B |
| W8 | T19 core：取图、手记缩略图与内容安全策略 | T15、T17、T18 | B |
| W9 | T29 core：装配、恢复、清理时机与集成测试 | T11、T17、T18、T19 | E |
| W10 | T30 端到端与评测 | T21、T22、T23、T24、T29 | E |
| W11 | T31 实机走查与收口（编排者与维护者） | T26、T27、T28、T30 | E |

**并行度。** W3 有五个 core 任务和三个 client 任务，可并行。W4 在接好 core 配置、段落投影和开局页的同时，可以执行三个 Python 部署任务。

**关键路径。** W0 裁定后，T02 → T07 → T09 → T06 → T11 → T17 → T18 → T19 → T29 → T30 → T31 是其中一条最长路径。T19 排在 T18 之后，是因为两者都要改 `play/service.ts`（手记缩略图的接线）。T12 和 T16 改给模型的提示，要跑 token 棘轮测试，最容易返工，派给能力最强的执行者。

**同一个文件跨波次改动的顺序。** 下面这些文件会被不止一个任务改，必须按这里的顺序，后面的任务在前面的成果上改：

| 文件 | 顺序 |
| --- | --- |
| `packages/core/src/services.ts` | T04 → T06 → T13（play 加 `image`）→ T18（增加 `kick`）→ T29（启动准备、删除回调） |
| `packages/core/src/app.ts`、`main.ts` 和装配测试 | T01（只改 `main.ts` 的导入）→ T04 → T06 → T13 → T18 → T29 |
| `packages/core/src/library/service.ts` | T02（`WorkDetail` 默认值）→ T13（读作者画风）→ T29（删除提交后接清理） |
| `packages/core/src/api/router.ts` | T02（临时路由）→ T06（改调服务，清掉临时处理函数） |
| `packages/core/src/api/http-app.ts` 及测试 | T02（路由基线测试）→ T06（补服务夹具与上传体积上限）→ T18（夹具补 `kick`）→ T19（取图响应头）→ T29（夹具补启动方法） |
| `packages/core/src/api/file-roundtrip.test.ts` | T02（`File` 往返） |
| `packages/core/src/desktop/channel.test.ts` | T06（补工厂夹具）→ T13、T18、T29（工厂接口有变化时同步） |
| `packages/core/src/llm/types.ts` | T13（`LlmRunRef.kind`、`LlmCompleteInput` 守卫） |
| `packages/core/src/llm/run.ts` | T01（迁移 fetch 导入）→ T13（`complete` 固定接收方） |
| `packages/core/src/api/client-assets.ts` | T19（`img-src` 加 `blob:`） |
| `packages/core/src/play/service.ts` | T02（回合、路线默认字段）→ T12（`illustrate`、`RouteView.playthroughId`）→ T13（开局传入 `image`）→ T18（登记插图、插图视图）→ T19（手记缩略图） |
| `packages/core/src/play/start.ts` | T02（`StartInfo` 缺省）→ T13（插图设置）→ T18（开场图） |
| `packages/core/src/play/start.test.ts`、`play/service.test.ts`、`play/opening-job.test.ts` | T12（形象与标记）→ T13（对齐直接构造 play 的参数）→ T18（对齐回调并验证插图接线） |
| `packages/core/src/play/opening-job.ts` | T12（`propose_opening` 的形象）→ T18（开场图） |
| `packages/core/src/story/journal.ts` | T02（`portrait: null`）→ T19（实际缩略图） |
| `packages/core/src/authoring/plan-tool.ts`、方案生产者和相应测试 | T02（`appearance: null`）→ T12（解析、保存形象） |
| client 类型化的视图与方案夹具 | T02（补默认值）→ T21–T24 按各自页面使用实际字段 |
| `packages/core/src/illustration/service.ts` | T06（骨架与占位）→ T13（接入 T15 的存储）→ T17 → T18 → T19 → T29 |
| `packages/core/src/image/service.ts` | T06 → T11 |
| `apps/client/src/i18n/zh-CN/play.json` | T20 → T24 → T23 |
| `apps/client/src/i18n/zh-CN/common.json` | T20 |
| `apps/client/src/i18n/zh-CN/settings.json` | T21 |
| `apps/client/src/i18n/zh-CN/authoring.json` | T22 |
| `apps/client/src/i18n/zh-CN/errors.json` | T02 |
| `apps/client/src/shared/lib/log.ts` | T24（接插图可见样本） |

---

## 4. 文件总表

“新建”表示文件现在不存在；“改”表示在现有文件上改。每个文件只属于一个任务，按 §3 的顺序表跨波次的例外除外。

### 4.1 根目录、文档、脚本

| 文件 | 任务 | 做什么 |
| --- | --- | --- |
| `docs/*.md`（只改 §1.4、§2.5 要求的地方） | T00 | 把设计决定写进设计文档 |
| `package.json`（只改 `scripts`） | T03 | 加 `test:python`；`test` 里加插件名扫描 |
| `lefthook.yml` | T03 | 加 ruff 那一步 |
| `scripts/check-plugin-names.mjs`（新建） | T03 | 扫描 `apps/`、`packages/` 里的插件专属名字 |
| `scripts/check-plugin-names.test.mjs`（新建） | T03 | 扫描脚本自己的测试 |
| `scripts/test-python.mjs`（新建） | T03 | `pnpm test:python` 的实现 |
| `tasks/milestone-4.md` | 编排者 | 勾选进度、写台账 |

### 4.2 `packages/contracts`

| 文件 | 任务 | 做什么 |
| --- | --- | --- |
| `src/schemas/image.ts`（新建） | T02 | 出图服务、能力、比例、档位、启动器、用量、体量的 schema |
| `src/schemas/illustration.ts`（新建） | T02 | 画风、本局插图设置、插图视图、人物参考组、取图输入的 schema |
| `src/schemas/image.test.ts`、`src/schemas/illustration.test.ts`（新建） | T02 | schema 的边界测试 |
| `src/procedures/image.ts`、`src/procedures/illustration.ts`、`src/procedures/portrait.ts`（新建） | T02 | 新过程 |
| `src/procedures/play.ts`、`src/procedures/works.ts`（改） | T02 | `play.suggestAppearance`、`works.setIllustrationStyle` |
| `src/schemas/play.ts`、`works.ts`、`authoring.ts`、`story.ts`、`log.ts`（改） | T02 | 只加字段：插图视图、开局的插图设置、作者画风、方案人物的形象、手记缩略图、新的样本名 |
| `src/events.ts`、`src/errors.ts`、`src/index.ts`（改） | T02 | 四个事件、新错误码、导出 |

### 4.3 `packages/core`

| 文件 | 任务 | 做什么 |
| --- | --- | --- |
| `src/api/router.ts`、`src/api/http-app.test.ts`（改）、`src/api/file-roundtrip.test.ts`（新建） | T02 | 新契约的临时路由、真实路由回归和 `File` 往返 |
| `src/play/service.ts`、`src/play/start.ts`、`src/library/service.ts`、`src/story/journal.ts`、现有方案生产者及其测试（改） | T02 | 为新增输出字段补齐默认值，具体清单见 T02 第 4 步 |
| `src/api/router.ts`、`src/api/http-app.ts`、`src/api/http-app.test.ts`、`src/desktop/channel.test.ts` 及装配测试（改） | T06 | 临时路由改调服务、上传上限、必填服务夹具 |
| `src/net/fetch.ts`、`src/net/fetch.test.ts`、`src/net/install.ts`、`src/net/url.ts`、`src/net/url.test.ts`（新建） | T01 | 外发请求的统一出口和地址整理，从 `llm/fetch-guard*.ts`、`llm/url.ts` 移来 |
| `src/llm/fetch-guard.ts`、`fetch-guard.test.ts`、`fetch-guard-install.ts`（删除） | T01 | 移走后删除 |
| `src/llm/run.ts`、`src/llm/test-connection.ts`、`src/main.ts`（改导入） | T01 | 改为从 `net/` 导入 |
| `src/providers/schema.ts`、`file.ts`、`migrate.ts`、`keys.ts`、`ids.ts` 及测试（新建） | T04 | `providers.json` 版本 2 的 schema、读写、迁移、备份；key 与 id 的规则（从 `llm/` 移来） |
| `src/llm/providers-schema.ts`、`providers-file.ts` 及测试（删除） | T04 | 移进 `providers/` |
| `src/llm/service.ts`（改） | T04 | 改用共用的存储 |
| `src/services.ts`（改） | T04、T06、T13、T18、T29 | 共用存储、出图和插图接口、play 与 library 工厂交接 |
| `src/store/schema.ts`、`src/store/migrations/<新目录>`（改、生成） | T05 | 新列、新表 |
| `src/store/illustration-types.ts`（新建） | T05 | JSON 列的 Zod schema：本局插图设置、插图的规格与尝试、参考组的位置与任务、作者画风、`app_settings.illustration` |
| `src/image/limits.ts`、`validate.ts`、`validate.test.ts`、`errors.ts`、`conformance/target.ts`（新建） | T07 | 常量、图片字节校验、出图模块的错误类型、一致性测试的目标选择 |
| `src/test-support/image-bytes.ts`（新建） | T07 | 现造 PNG、JPEG、WebP 字节 |
| `src/image/unwritten-client.ts` 及测试（新建） | T08 | Unwritten 图像协议客户端 |
| `src/image/info.ts`（新建） | T08 | `/v1/info` 的 schema 与能力校验 |
| `src/image/conformance/*.conformance.test.ts`（新建） | T08 | 协议一致性测试 |
| `src/test-support/fake-image-server.ts`（新建） | T08 | 伪出图服务 |
| `src/image/openai-client.ts` 及测试（新建） | T09 | OpenAI 图像接口客户端 |
| `src/image/openai-capabilities.ts`（新建） | T09 | 按模型 id 预填能力、尺寸预设 |
| `src/test-support/fake-openai-images.ts`（新建） | T09 | 伪 OpenAI 图像服务 |
| `src/image/launcher-client.ts` 及测试（新建） | T10 | 启动器协议客户端 |
| `src/image/launcher/conformance/*.conformance.test.ts`（新建） | T10 | 启动器协议一致性测试 |
| `src/test-support/fake-launcher.ts`（新建） | T10 | 伪启动器 |
| `src/image/service.ts`、`config.ts`、`token.ts`、`engine-types.ts`、`capability-cache.ts`、`settings.ts` 及测试（新建） | T06 | 出图服务的配置、视图、令牌、自动出图开关、默认规格 |
| `src/image/engine.ts`、`queue.ts`、`probe.ts`、`wake.ts`、`calls.ts` 及测试（新建） | T11 | 探测、排队、生成、唤醒、调用记录、用量 |
| `src/illustration/service.ts`（新建） | T06、T13、T17、T18、T19、T29 | 先建骨架，后续按 §3 的顺序替换占位，接启动准备 |
| `src/illustration/storage.ts`、`gc.ts` 及测试（新建） | T15 | 文件写入、写入锁、清理、体量 |
| `src/story/types.ts`、`story/changes.ts`、`story/writer.ts`、`story/projection.ts`、`story/render.ts`（改） | T12 | 形象字段、`trait` 的形象语义 |
| `src/play/propose-turn-tool.ts`、`play/context.ts`、`play/narrator-prompt.ts`、`play/cast-tool.ts`、`play/opening-tool.ts`、`play/opening-prompt.ts`、`play/opening-job.ts`、`play/service.ts`（改） | T12 | `illustrate`、形象进上下文 |
| `src/story/opening-proposal.ts`、`authoring/plan-tool.ts`、`authoring/plan-edit.ts`、`authoring/plan-prompt.ts`、`authoring/preview-prompt.ts`、`authoring/service.ts`、`test-support/llm-steps.ts`（改） | T12 | 方案和预览里的人物形象 |
| `src/play/start.ts`（改）、`src/illustration/appearance.ts`、`src/illustration/style.ts`、`src/illustration/suggest.ts`（新建） | T13 | 开局的插图设置、主角形象补写、画风预设 |
| `src/story/scene-projection.ts` 及测试（新建） | T14 | 按段落投影 |
| `src/illustration/shot.ts`、`shot-prompt.ts`、`shot-parse.ts`、`shot-compose.ts` 及测试（新建） | T16 | 镜头描述 |
| `src/illustration/portraits.ts`、`portrait-prompt.ts`、`portrait-views.ts`、`portrait-runner.ts` 及测试（新建） | T17 | 人物参考组 |
| `src/illustration/worker.ts`、`pipeline.ts`、`enqueue.ts`、`views.ts`、`references.ts`、`cancel.ts` 及测试（新建） | T18 | 插图流程 |
| `src/illustration/file-access.ts`、`journal-portraits.ts` 及测试（新建）、`src/story/journal.ts`、`src/api/client-assets.ts`（改） | T19 | 取图的归属核对、手记缩略图、CSP |
| `src/services.ts`、`src/app.ts`、`src/main.ts`、`src/app.test.ts`、`src/app.integration.test.ts`、`src/library/service.ts`、`src/library/service.test.ts`、`src/illustration/service.ts`（改） | T29 | 装配、启动和删除后清理、恢复与集成测试 |

### 4.4 `apps/client`

| 文件 | 任务 | 做什么 |
| --- | --- | --- |
| `src/features/play/`、`src/features/authoring/`、`src/features/library/` 中的类型化视图夹具 | T02 | 补默认值，具体文件见 T02 第 4 步 |
| `src/shared/api/query.ts`、`src/app/App.tsx`（改） | T20 | 查询键与事件失效，测试沿用已有伪接口 |
| `src/shared/hooks/useImageBlob.ts`、`src/shared/ui/WakePrompt.tsx`、`src/shared/lib/image-import.ts` 及测试（新建） | T20 | 带令牌取图、唤醒提示、本机导入的整理 |
| `src/features/settings/ImageServiceSection.tsx` 等（新建）、`SettingsPage.tsx`、`SettingsNav.tsx`（改） | T21 | 设置页的出图服务 |
| `src/features/authoring/IllustrationStyleSection.tsx`（新建）、`SettingsSections.tsx`、`PlanItemEditor.tsx`、`PlanItemCard.tsx`（改） | T22 | 作者画风、方案人物的形象、人物参考组入口 |
| `src/shared/ui/illustration/StylePicker.tsx`、`StylePreview.tsx`、`PortraitSetEditor.tsx`、`PortraitSlotCard.tsx` 及测试（新建） | T22 | 作者和玩家共用的人物参考组与画风选择 |
| `src/features/play/StartIllustrationPanel.tsx` 等（新建）、`StartPage.tsx`（改） | T23 | 开局页的插图设置 |
| `src/features/play/IllustrationFrame.tsx`、`IllustrationLightbox.tsx` 等（新建）、`TurnArticle.tsx`、`PlayPage.tsx`、`JournalSubject.tsx`（改）；`packages/tokens/tokens.json`（加 `image-dim`） | T24 | 游玩页的插图、大图、唤醒提示、手记缩略图 |

### 4.5 Python 目录（全部新建）

| 目录 | 任务 | 做什么 |
| --- | --- | --- |
| `selfhost/colab/` | T03（`pyproject.toml`、`uv.lock`）→ T25（其余） | Colab 宿主 |
| `plugins/comfyui/` | T03 → T26 | ComfyUI 插件 |
| `selfhost/strata/` | T03 → T27 | Strata 网关 |
| `plugins/colab-launcher/` | T03 → T28 | Colab 启动器 |

### 4.6 `e2e`

| 文件 | 任务 | 做什么 |
| --- | --- | --- |
| `e2e/tests/milestone-4.spec.ts`、`e2e/tests/support/milestone-4.ts`（新建） | T30 | 浏览器端到端及隔离环境 |
| `evals/illustration.md`（新建） | T30 | 真实模型评测 |

---

## 5. 任务

### T00 设计补洞：把 §1.4、§1.2、§2.5 写进 docs（编排者执行）

**目的。** 设计文档是单源。本文为了能落地补的决定，先由维护者确认，再写进 `docs/`，免得实现和文档各说各话。

**依赖。** 维护者确认 §1.4。确认有改动时，先改本文 §1.4，再做这个任务。

**拥有的文件。** `docs/image.md`、`docs/data-model.md`、`docs/turn-loop.md`、`docs/diagnostics.md`、`docs/plugins.md`、`docs/milestone-4.md`、`docs/colab-host.md`、`docs/comfyui-plugin.md`、`docs/strata.md`、`docs/colab-launcher.md`。

**先读。** [docs/AGENTS.md](../docs/AGENTS.md) 全文；本文 §1.2、§1.4、§2.5。

**步骤。**

- [x] 1. **核对前提。** 对照 §6.1 的当次裁定，逐条核对 D1–D28 的状态。运行 `node scripts/check-doc-links.mjs` 留下基线。用 `rg -n "autoIllustration|storage.summary|setIllustrationStyle|portrait.get" docs/image.md` 核查缺口，已有条目改原处。裁定缺失或与 §1.4 不同，按依赖说明处理。
- [x] 2. `docs/image.md` §2 的过程表加三行：
  - `image.autoIllustration.get`、`image.autoIllustration.set`：读取或修改「游玩时生成插图」和数据接收方确认（D3）；
  - `image.storage.summary`：插图和人物参考合计占用的空间（§9.5）。
- [x] 3. `docs/image.md` §10 的过程表加：
  - `portrait.get`：按组 id 取一组参考或一张画风预览；
  - `works.setIllustrationStyle`：作者默认画风（D26）。

  §6.3 第二条写明默认画风由这个过程保存。
- [x] 4. `docs/image.md` §10 的「回合视图里的插图」一条，写明插图视图随 `play.getRoute` 返回的每个回合一起给出（D15）。
- [x] 5. `docs/image.md` §9.1 写明临时文件放在 `images/tmp/`，启动时清空（D9）；§9.3 第 3 步写明写入区间是一个进程内的串行锁（D10）。
- [x] 5a. `docs/image.md` §5.1 把 `image` 对 `illustration` 的入口列全：`selectedServiceId`、`activeTarget`、`capabilities`、`prepareGeneration`、`assertFormat`、`generate`、`wake`。§8 的真名规则改成「在场人物的真名和主角的名字」。§9.2 的 `format_preference` 和 `format` 改成 `OutputPreferences` 的字段名（D22）。
- [x] 6. `docs/data-model.md`：
  - `works.illustration_style` 的注释改成 `{"kind":"preset","preset":"<预设 id>"}` 或 `{"kind":"custom","text":"<画风原文>"}`；
  - 如果有 `app_settings` 的表定义，加 `illustration` 列，说明见 D3。
  - 在实体表登记可空的 `source_para`。回合内登记的人物用已校验的 `new_entity.para`，作者设定和缺少出处的旧记录留空。
- [x] 6a. `docs/data-model.md` §5「插图按段落投影」写明 D27 的在场候选、D28 的亲见与形象规则和 D8 的「这一刻还不知道的名字」。§4 的 `same_visible_identity` 写成提案里是字符串 `"true"`、存储为数字 `1`。
- [x] 6b. `docs/colab-host.md` §8 第 4 步改成把认证 key 写进权限 `0600` 的临时文件，用 `--auth-key=file:<临时文件>`，执行完删除；不把 key 放进命令行参数。
- [x] 7. `docs/turn-loop.md` §12 验收表里「narrator 新增一个人物，没写 `appearance`」那一行改成：
  - **从什么情况开始：** narrator 新增一个人物，没写 `appearance`，并把 `illustrate` 写成正文里不存在的段号；
  - **操作：** 提交 `propose_turn`；
  - **应当看到的结果：** 回合照常提交，人物登记成功、没有形象，回合没有插图标记。

  （D23）
- [x] 8. `docs/diagnostics.md` §2、§3 加本文 §2.5 表里的新事件和新样本。只写名字、时机和 `data` 字段，不写任务号。
- [x] 9. `docs/plugins.md` §6「CI 对每个插件做两件事」一条改成：
  - 用 `pnpm test:python` 跑插件自己的测试；
  - 启动插件（对外部引擎用伪实现替代），再对着它运行这种协议的一致性测试；
  - 写明这条命令不进 `pnpm test`，因为要求本机装有 uv（D19）。

  `docs/colab-host.md` §11、`docs/comfyui-plugin.md` §10、`docs/strata.md` §11、`docs/colab-launcher.md` §7 里「CI 跑……」的说法同步改。
- [x] 10. `docs/milestone-4.md` 的「留给后续的能力」和验收表：把依赖「换一种发展」「从存档另开」的行标成「依赖未实现的功能，本里程碑不验」（§1.3）。设计总验收保留其完整行为。将 M4 的组合用例写成单路线实际可操作的步骤。规划时核到的行：
  - `image.md` §14 的「narrator 在一次换一种发展的候选里标了插图」；
  - 「第 2 段图已生成…再在存档分出的路线重画」。
  - 体验表写明作者可以从已发布作品另开一局验证画风和人物参考。试玩入口由相应任务补上。

  执行时用 `rg -n "换一种发展|存档" docs/image.md docs/milestone-4.md` 重新核对一遍。
- [x] 11. 运行 `node scripts/check-doc-links.mjs`，再按 [docs/AGENTS.md §3](../docs/AGENTS.md#3-审计) 对新增的行跑三遍审计扫描。

**接线点。** 无（只改文档）。

**注意事项。**

- 文档只写系统应有的样子。不写「本里程碑」「新增」「D3」这类过程词。
- 改了标题或章节编号就跑链接检查。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `node scripts/check-doc-links.mjs` 退出码 0 | 把 `docs/image.md` 里一个指向 `#94-清理` 的链接改成 `#94-清理x`，必须报失效链接 |
| `rg -n "autoIllustration\|storage.summary\|setIllustrationStyle\|portrait.get" docs/image.md` 每个名字至少命中一次 | 删掉第 2、3 步加的对应过程，对应名字命中 0 次 |
| 三遍审计扫描对新增行没有命中，或命中都已逐条判断并写进汇报 | — |

---

### T01 core：`net` 模块

**目的。** core 的外发请求只有一个出口，由它强制「不跟随重定向」（[LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)、[插图与出图服务 §5.2](../docs/image.md#52-外发请求)）。现在这个封装在 `llm` 模块里，`image` 模块不能去导入 `llm` 的内部文件，所以把它挪进独立的 `net` 模块。**行为一点都不变。**

**依赖。** 无。

**拥有的文件。**

- 新建：`packages/core/src/net/fetch.ts`、`packages/core/src/net/fetch.test.ts`、`packages/core/src/net/install.ts`、`packages/core/src/net/url.ts`、`packages/core/src/net/url.test.ts`。
- 删除：`packages/core/src/llm/fetch-guard.ts`、`packages/core/src/llm/fetch-guard.test.ts`、`packages/core/src/llm/fetch-guard-install.ts`、`packages/core/src/llm/url.ts`、`packages/core/src/llm/url.test.ts`。
- 改导入：`packages/core/src/llm/run.ts`、`packages/core/src/llm/test-connection.ts`、`packages/core/src/main.ts`，以及 `rg` 出来的其他导入方（第 1 步）。

**先读。**

- [LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)（「core 的外发请求一律不跟随重定向」那一条）；
- `packages/core/src/llm/fetch-guard.ts` 全文；
- `packages/core/src/llm/fetch-guard.test.ts` 全文。

**步骤。**

- [x] 1. **核对前提。**
  - 运行 `rg -n "fetch-guard" packages/core apps e2e --glob '!node_modules'`，把命中的每个文件和行号记进汇报。规划时的命中是：`llm/run.ts`、`llm/test-connection.ts`、`main.ts`、`llm/fetch-guard-install.ts`、`llm/fetch-guard.test.ts`。多出别的文件时，它们也属于本任务要改的导入方。
  - 运行 `rg -n "^export" packages/core/src/llm/fetch-guard.ts`，确认导出的正好是 `REDIRECT_STATUSES`、`RedirectBlockedError`、`FetchRecorder`、`createFetchRecorder`、`createGuardedFetch`、`installGlobalFetchGuard`、`unguardedFetch` 七个。
- [x] 2. **新建 `packages/core/src/net/fetch.ts`。** 把 `llm/fetch-guard.ts` 的内容原样复制过来，导出名一个不改。再在文件末尾加一个函数，供 `image` 模块用：

  ```ts
  export function createNetFetch(recorder?: FetchRecorder): typeof fetch {
    return createGuardedFetch(unguardedFetch(), recorder);
  }
  ```

  它等价于 `llm/run.ts` 里现在的写法 `createGuardedFetch(unguardedFetch(), recorder)`。
- [x] 3. **新建 `packages/core/src/net/install.ts`。** 内容和 `llm/fetch-guard-install.ts` 一样，只改导入路径：

  ```ts
  import { installGlobalFetchGuard } from './fetch.ts';

  installGlobalFetchGuard();
  ```
- [x] 4. **把测试移过去。** 把 `llm/fetch-guard.test.ts` 复制成 `net/fetch.test.ts`，只改导入路径。再加一个测试：
  - 测试名：`createNetFetch 拒绝跟随重定向`；
  - 做法：用 `node:http` 起一个本机服务，对任意请求回 `302`、`Location: http://127.0.0.1:1/x`；
  - 断言：`await expect(createNetFetch()(url)).rejects.toBeInstanceOf(RedirectBlockedError)`，并断言 `error.status === 302`。
- [x] 5. **改导入方。**
  - `llm/run.ts`、`llm/test-connection.ts`：`from './fetch-guard.ts'` 改成 `from '../net/fetch.ts'`。
  - `main.ts` 第一行：`import './llm/fetch-guard-install.ts';` 改成 `import './net/install.ts';`。**它必须仍然是第一行**，原因见 [LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)：ESM 先执行被导入的模块，晚了 SDK 可能已经拿走原始的 `fetch`。
  - 第 1 步多出的导入方同样改。
- [x] 6. **删除** `llm/fetch-guard.ts`、`llm/fetch-guard.test.ts`、`llm/fetch-guard-install.ts`。
- [x] 6a. **把地址整理也搬进 `net/`。** `llm/url.ts`（`normalizeBaseUrl`，按符号名找）出图服务也要用，`image` 模块不能导入 `llm` 的内部文件。把它原样移成 `net/url.ts`，测试 `llm/url.test.ts` 移成 `net/url.test.ts`，只改导入路径。导入方规划时是 `llm/service.ts`、`llm/test-connection.ts`，执行时用 `rg -n "from '\./url\.ts'" packages/core/src/llm` 重新核对。
- [x] 7. 在 `packages/core/AGENTS.md` §1 的判据里**不用改**（它已经写了 `net/`）。

**接线点。**

| 调用方 | 改成 |
| --- | --- |
| `llm/run.ts` 里两处 `createGuardedFetch(unguardedFetch(), recorder)`（按符号名找，规划时在第 193、320 行） | 保持调用不变，只改导入路径 |
| `llm/test-connection.ts` 里的 `createGuardedFetch(unguardedFetch(), recorder)`（规划时第 75 行） | 同上 |
| `main.ts` 第一行 | `import './net/install.ts';` |

**注意事项。**

- 这是纯搬家，不改任何逻辑。`git diff -M` 应当把 `fetch-guard.ts` → `net/fetch.ts` 识别为重命名，相似度在 90% 以上（多了一个函数）。
- 不要把 `createNetFetch` 用到 `llm` 模块里去，`llm` 保持原样调用。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `rg -n "fetch-guard" packages/core/src` 零命中；`ls packages/core/src/llm/url.ts` 报不存在 | 在 `llm/run.ts` 里留一处 `from './fetch-guard.ts'`：typecheck 失败（文件已删）|
| `net/fetch.test.ts` 里原有的重定向测试和新加的 `createNetFetch` 测试全绿 | 把 `net/fetch.ts` 里 `redirect: 'manual'` 改成 `redirect: 'follow'`：至少 `createNetFetch 拒绝跟随重定向` 变红 |
| `head -1 packages/core/src/main.ts` 输出 `import './net/install.ts';` | 把这一行挪到第二行：本判据红 |
| `pnpm --filter @unwritten/core test` 全绿，其中 `llm/run.test.ts` 里已有的重定向用例照常通过 | 把 `net/install.ts` 里的 `installGlobalFetchGuard();` 删掉：`app.integration.test.ts` 或 `llm` 里依赖全局守卫的用例变红；不红时如实写进汇报，说明哪一道守卫接住了 |

---

### T02 contracts：插图与出图的全部契约

**目的。** client 和 core 之间的单源。本任务把本里程碑全部新的 schema、过程、事件、错误码一次定死，后面的任务都照着它写：

- core 各任务按它实现；
- client 各任务按它写界面，并用伪接口测试。

**依赖。** 无。

**拥有的文件。**

- 新建：
  - `packages/contracts/src/schemas/image.ts`、`packages/contracts/src/schemas/image.test.ts`；
  - `packages/contracts/src/schemas/illustration.ts`、`packages/contracts/src/schemas/illustration.test.ts`；
  - `packages/contracts/src/procedures/image.ts`、`procedures/illustration.ts`、`procedures/portrait.ts`；
  - `packages/core/src/api/file-roundtrip.test.ts`（第 1 步的实验，保留为测试）。
- 改：
  - `packages/contracts/src/schemas/play.ts`、`works.ts`、`authoring.ts`、`story.ts`、`log.ts`；
  - `packages/contracts/src/procedures/play.ts`、`works.ts`；
  - `packages/contracts/src/events.ts`、`errors.ts`、`index.ts`；
  - `packages/core/src/errors.ts`（只改 `HTTP_STATUS`）；
  - `apps/client/src/i18n/zh-CN/errors.json`；
  - 第 4 步列出的 core 生产者与类型化夹具，只补字段默认值；
  - `packages/core/src/api/router.ts` 和 `api/http-app.test.ts`，限临时路由和相应回归。

**先读。**

- [插图与出图服务 §2](../docs/image.md#2-出图服务的配置)、§3.2、§5.4、§6.2、§10、§12.2；
- [数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)里 `playthroughs.illustration` 的字段；
- 现有的 `packages/contracts/src/schemas/llm.ts`。新 schema 的写法照抄它：`KeyStatusSchema`、`KeyChangeSchema`、`ConfigProblemSchema` 直接复用，不重新定义。

**步骤。**

- [x] 1. **核对前提：`File` 能在 oRPC 的输入和输出里往返。** 新建 `packages/core/src/api/file-roundtrip.test.ts`：
  1. 用 `@orpc/contract` 的 `oc` 定义两个过程：`up: oc.input(z.object({ name: z.string(), file: z.file() })).output(z.object({ size: z.number() }))`，`down: oc.input(z.object({})).output(z.file())`。
  2. 用 `@orpc/server` 的 `implement` 实现它们：`up` 返回 `{ size: input.file.size }`；`down` 返回 `new File([new Uint8Array([1, 2, 3])], 'x.webp', { type: 'image/webp' })`。
  3. 用 `@orpc/server/fetch` 的 `RPCHandler` 处理请求，客户端用 `@orpc/client/fetch` 的 `RPCLink`，`fetch` 选项直接调用 `handler.handle(request, { prefix: '/api' })` 拿响应（不起真的 HTTP 服务）。
  4. 断言 `up` 收到的 `size` 是上传的字节数；`down` 返回的值 `instanceof Blob`，`type === 'image/webp'`，字节是 `[1, 2, 3]`。

  用 core 已安装的 `@orpc/server` 和 `@orpc/client`。这条测试留在仓库，供 T06、T17、T19 复用。失败时按 §0.3 汇报。
- [x] 2. **新建 `packages/contracts/src/schemas/image.ts`。** 照抄下面的代码。常量的含义见注明的设计章节：

  ```ts
  import { z } from 'zod';
  import { ErrorCodeSchema } from '../errors.ts';
  import { TimestampSchema, UuidSchema } from './common.ts';
  import { ConfigProblemSchema, KeyChangeSchema, KeyStatusSchema } from './llm.ts';

  export const IMAGE_PROTOCOLS = ['unwritten-image', 'openai-images'] as const;
  export const ImageProtocolSchema = z.enum(IMAGE_PROTOCOLS);

  export const IMAGE_TIERS = ['720', '1k', '2k'] as const;
  export const ImageTierSchema = z.enum(IMAGE_TIERS);
  export const IMAGE_TIER_PREFERENCES = ['720', '1k', '2k', 'default'] as const;
  export const ImageTierPreferenceSchema = z.enum(IMAGE_TIER_PREFERENCES);

  export const IMAGE_QUALITIES = ['fast', 'best'] as const;
  export const ImageQualitySchema = z.enum(IMAGE_QUALITIES);

  export const AspectSchema = z.string().regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/u);
  export const AspectPreferenceSchema = z.union([z.literal('auto'), AspectSchema]);

  export const ImageSizeSchema = z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  });

  export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
  export const IMAGE_MAX_PIXELS = 32_000_000;
  export const PORTRAIT_IMPORT_MAX_EDGE = 1536;
  export const PORTRAIT_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
  export const PORTRAIT_UPLOAD_MAX_BODY_BYTES = PORTRAIT_IMPORT_MAX_BYTES + 64 * 1024;

  export const ImageCapabilitiesSchema = z.object({
    maxReferences: z.number().int().nonnegative(),
    maxReferenceBytes: z.number().int().positive().nullable(),
    maxPromptLength: z.number().int().positive().nullable(),
    seed: z.boolean(),
    negativePrompt: z.boolean(),
    qualities: z.array(ImageQualitySchema).min(1),
    aspects: z.array(AspectSchema).min(1),
    resolutions: z.record(z.string(), z.record(z.string(), ImageSizeSchema)),
  });

  export const OPENAI_SIZE_MODES = ['fixed', 'custom'] as const;
  export const OpenAiImageOptionsSchema = z.object({
    maxReferences: z.number().int().min(0).max(16),
    sizes: z.enum(OPENAI_SIZE_MODES),
  });

  export const IMAGE_SERVICE_STATES = ['ready', 'offline', 'waking', 'needs_action', 'wake_failed', 'unknown'] as const;
  export const ImageServiceStateSchema = z.enum(IMAGE_SERVICE_STATES);

  export const LAUNCHER_STATES = ['stopped', 'starting', 'needs_action', 'running', 'stopping', 'failed'] as const;
  export const LauncherStateSchema = z.enum(LAUNCHER_STATES);
  export const LAUNCHER_FAILURE_REASONS = ['quota', 'not_signed_in', 'action_expired', 'start_error'] as const;
  export const LauncherFailureReasonSchema = z.enum(LAUNCHER_FAILURE_REASONS);

  export const IDLE_MINUTES_MIN = 5;
  export const IDLE_MINUTES_MAX = 720;
  export const IMAGE_IDLE_MINUTES = 30;
  export const IdleMinutesSchema = z.number().int().min(IDLE_MINUTES_MIN).max(IDLE_MINUTES_MAX);

  export const PROBE_RESULTS = ['ready', 'not_ready', 'offline', 'unauthorized', 'invalid'] as const;

  const ImplementationSchema = z.object({ name: z.string(), version: z.string() });

  export const ImageServiceViewSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    protocol: ImageProtocolSchema,
    baseUrl: z.string(),
    key: KeyStatusSchema,
    model: z.string().nullable(),
    openai: OpenAiImageOptionsSchema.nullable(),
    launcher: z.object({ baseUrl: z.string(), key: KeyStatusSchema }).nullable(),
    idleMinutes: IdleMinutesSchema,
    capabilities: ImageCapabilitiesSchema.nullable(),
    probe: z
      .object({
        at: TimestampSchema,
        result: z.enum(PROBE_RESULTS),
        notReadyReason: z.string().nullable(),
        implementation: ImplementationSchema.nullable(),
        model: z.string().nullable(),
      })
      .nullable(),
    lastSuccessAt: TimestampSchema.nullable(),
    state: ImageServiceStateSchema,
    action: z.object({ url: z.string(), expiresAt: TimestampSchema }).nullable(),
    wakeFailure: z.object({ code: ErrorCodeSchema, reason: LauncherFailureReasonSchema.nullable() }).nullable(),
  });

  export const ImageConfigViewSchema = z.object({
    status: z.enum(['ok', 'missing', 'invalid', 'too_new']),
    revision: z.string(),
    problem: ConfigProblemSchema.nullable(),
    services: z.array(ImageServiceViewSchema),
    selectedServiceId: z.string().nullable(),
  });

  const ServiceNameSchema = z.string().trim().min(1).max(60);
  const BaseUrlInputSchema = z.string().trim().min(1).max(2048);
  const ApiKeyValueSchema = z.string().trim().min(1).max(4096);
  const ModelIdSchema = z.string().trim().min(1).max(200);

  export const CreateImageServiceInputSchema = z.object({
    requestId: UuidSchema,
    baseRevision: z.string(),
    name: ServiceNameSchema,
    protocol: ImageProtocolSchema,
    baseUrl: BaseUrlInputSchema,
    apiKey: ApiKeyValueSchema.nullable(),
    model: ModelIdSchema.nullable(),
    openai: OpenAiImageOptionsSchema.nullable(),
    launcher: z.object({ baseUrl: BaseUrlInputSchema, apiKey: ApiKeyValueSchema.nullable() }).nullable(),
    idleMinutes: IdleMinutesSchema.nullable(),
  });
  export const CreateImageServiceOutputSchema = z.object({ serviceId: z.string(), config: ImageConfigViewSchema });

  export const LauncherChangeSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('keep'), key: KeyChangeSchema }),
    z.object({ action: z.literal('set'), baseUrl: BaseUrlInputSchema, apiKey: ApiKeyValueSchema.nullable() }),
    z.object({ action: z.literal('remove') }),
  ]);

  export const UpdateImageServiceInputSchema = z.object({
    baseRevision: z.string(),
    serviceId: z.string().min(1),
    name: ServiceNameSchema,
    key: KeyChangeSchema,
    model: ModelIdSchema.nullable(),
    openai: OpenAiImageOptionsSchema.nullable(),
    launcher: LauncherChangeSchema,
    idleMinutes: IdleMinutesSchema,
  });

  export const RemoveImageServiceInputSchema = z.object({ baseRevision: z.string(), serviceId: z.string().min(1) });
  export const SelectImageServiceInputSchema = z.object({
    baseRevision: z.string(),
    serviceId: z.string().min(1).nullable(),
  });
  export const GeneratedTokenSchema = z.object({ token: z.string().min(43) });

  export const TestImageServiceInputSchema = z.object({
    serviceId: z.string().min(1),
    target: z.enum(['service', 'launcher']),
    paid: z.boolean().default(false),
  });
  export const TestImageServiceResultSchema = z.object({
    ok: z.boolean(),
    code: ErrorCodeSchema.nullable(),
    service: z
      .object({
        implementation: ImplementationSchema.nullable(),
        model: z.string().nullable(),
        ready: z.boolean(),
        notReadyReason: z.string().nullable(),
        capabilities: ImageCapabilitiesSchema.nullable(),
      })
      .nullable(),
    launcher: z
      .object({
        implementation: ImplementationSchema,
        ready: z.boolean(),
        notReadyReason: z.string().nullable(),
        state: LauncherStateSchema,
      })
      .nullable(),
    generated: ImageSizeSchema.nullable(),
  });

  export const OutputPreferencesSchema = z.object({
    aspectPreference: AspectPreferenceSchema,
    resolutionTier: ImageTierPreferenceSchema,
  });
  export const DEFAULT_OUTPUT_PREFERENCES = { aspectPreference: 'auto', resolutionTier: '1k' } as const;
  export const OutputOptionsViewSchema = z.object({
    preferences: OutputPreferencesSchema,
    aspects: z.array(AspectSchema),
    tiers: z.array(z.object({ tier: ImageTierPreferenceSchema, sizes: z.record(z.string(), ImageSizeSchema) })),
    preferenceAvailable: z.boolean(),
  });

  export const AutoIllustrationTargetSchema = z.object({
    serviceId: z.string().min(1),
    model: z.string().nullable(),
    background: z.object({ endpointId: z.string().min(1), modelId: z.string().min(1) }),
  });
  export const AutoIllustrationViewSchema = z.object({
    enabled: z.boolean(),
    current: AutoIllustrationTargetSchema.nullable(),
    confirmed: AutoIllustrationTargetSchema.nullable(),
  });
  export const SetAutoIllustrationInputSchema = z.object({
    enabled: z.boolean(),
    confirm: AutoIllustrationTargetSchema.nullable(),
  });

  const UsageWindowSchema = z.object({
    images: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  });
  export const ImageUsageSummarySchema = z.object({
    services: z.array(
      z.object({
        serviceId: z.string(),
        name: z.string().nullable(),
        last7Days: UsageWindowSchema,
        last30Days: UsageWindowSchema,
      }),
    ),
  });
  export const ImageStorageSummarySchema = z.object({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  });

  export const PrewarmInputSchema = z.object({ playthroughId: UuidSchema });
  export const ContinueWakeInputSchema = z.object({ serviceId: z.string().min(1), requestId: UuidSchema });
  ```

  文件末尾为每个 schema 导出 `z.infer` 类型，名字去掉 `Schema` 后缀，例如 `export type ImageServiceView = z.infer<typeof ImageServiceViewSchema>;`。常量数组另导出联合类型，例如 `export type ImageTier = (typeof IMAGE_TIERS)[number];`。
- [x] 3. **新建 `packages/contracts/src/schemas/illustration.ts`。** 照抄：

  ```ts
  import { z } from 'zod';
  import { ErrorCodeSchema } from '../errors.ts';
  import { TimestampSchema, UuidSchema } from './common.ts';
  import {
    AspectPreferenceSchema,
    AspectSchema,
    ImageSizeSchema,
    ImageTierPreferenceSchema,
    OutputPreferencesSchema,
  } from './image.ts';

  export const STYLE_PRESETS = ['watercolor', 'ink', 'anime', 'painterly', 'cinematic'] as const;
  export const StylePresetSchema = z.enum(STYLE_PRESETS);
  export const ILLUSTRATION_STYLE_TEXT_MAX_LENGTH = 200;
  export const IllustrationStyleSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'), preset: StylePresetSchema }),
    z.object({
      kind: z.literal('custom'),
      text: z.string().trim().min(1).max(ILLUSTRATION_STYLE_TEXT_MAX_LENGTH).regex(/^[^\r\n]*$/u),
    }),
  ]);
  export type IllustrationStyle = z.infer<typeof IllustrationStyleSchema>;
  export const DEFAULT_ILLUSTRATION_STYLE: IllustrationStyle = { kind: 'preset', preset: 'painterly' };

  export const APPEARANCE_MAX_LENGTH = 300;
  export const AppearanceTextSchema = z.string().trim().min(1).max(APPEARANCE_MAX_LENGTH).regex(/^[^\r\n]*$/u);

  export const StartIllustrationInputSchema = z.object({
    enabled: z.boolean(),
    style: IllustrationStyleSchema,
    aspectPreference: AspectPreferenceSchema,
    resolutionTier: ImageTierPreferenceSchema,
    protagonistInFrame: z.boolean(),
    protagonistAppearance: AppearanceTextSchema.nullable(),
    protagonistSnapshotId: UuidSchema.nullable(),
  });

  export const StartIllustrationInfoSchema = z.object({
    available: z.boolean(),
    autoEnabled: z.boolean(),
    authorStyle: IllustrationStyleSchema,
    lastStyle: IllustrationStyleSchema.nullable(),
    defaults: OutputPreferencesSchema,
    protagonistEntityId: z.string().nullable(),
  });
  export const DEFAULT_START_ILLUSTRATION_INFO = {
    available: false,
    autoEnabled: false,
    authorStyle: DEFAULT_ILLUSTRATION_STYLE,
    lastStyle: null,
    defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
    protagonistEntityId: null,
  } as const;

  export const ILLUSTRATION_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled', 'dismissed'] as const;
  export const IllustrationStatusSchema = z.enum(ILLUSTRATION_STATUSES);
  export const ILLUSTRATION_STAGES = ['wake', 'appearance', 'shot', 'portrait', 'generate', 'save'] as const;
  export const IllustrationStageSchema = z.enum(ILLUSTRATION_STAGES);

  export const IllustrationFormatSchema = z.object({
    aspectPreference: AspectSchema,
    resolutionTier: ImageTierPreferenceSchema,
    size: ImageSizeSchema.nullable(),
  });

  export const IllustrationViewSchema = z.object({
    id: UuidSchema,
    updatedAt: TimestampSchema,
    status: IllustrationStatusSchema,
    rerolling: z.boolean(),
    para: z.number().int().nonnegative(),
    format: IllustrationFormatSchema.nullable(),
    image: ImageSizeSchema.nullable(),
    caption: z.string().nullable(),
    error: ErrorCodeSchema.nullable(),
    stage: IllustrationStageSchema.nullable(),
    serviceId: z.string().nullable(),
  });

  export const IllustrationActionInputSchema = z.object({
    requestId: UuidSchema,
    illustrationId: UuidSchema,
    format: OutputPreferencesSchema.nullable().default(null),
  });
  export const DismissIllustrationInputSchema = z.object({ requestId: UuidSchema, illustrationId: UuidSchema });

  export const PORTRAIT_SLOTS = ['front', 'three_quarter', 'full_body'] as const;
  export const PortraitSlotSchema = z.enum(PORTRAIT_SLOTS);
  export const PORTRAIT_SCOPES = ['work', 'pending', 'playthrough'] as const;
  export const PortraitScopeSchema = z.enum(PORTRAIT_SCOPES);
  export const PORTRAIT_STATES = ['draft', 'active', 'retired'] as const;
  export const PortraitStateSchema = z.enum(PORTRAIT_STATES);

  export const PortraitSlotViewSchema = z.object({
    slot: PortraitSlotSchema,
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
    source: z.enum(['import', 'generate']).nullable(),
    needsReview: z.boolean(),
    task: z.object({ status: z.enum(['running', 'failed']), error: ErrorCodeSchema.nullable() }).nullable(),
  });

  export const PortraitSetViewSchema = z.object({
    id: UuidSchema,
    workId: UuidSchema,
    scope: PortraitScopeSchema,
    entityId: z.string().nullable(),
    state: PortraitStateSchema,
    draftRev: z.number().int().nonnegative(),
    appearance: z.string(),
    slots: z.array(PortraitSlotViewSchema).length(3),
    updatedAt: TimestampSchema,
  });

  export const PortraitTargetSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('entity'), entityId: z.string().min(1) }),
    z.object({ kind: z.literal('protagonist') }),
  ]);

  export const PortraitDraftInputSchema = z.object({
    workId: UuidSchema,
    scope: z.enum(['work', 'pending']),
    target: PortraitTargetSchema,
    appearance: AppearanceTextSchema.nullable(),
  });
  export const PortraitDraftViewSchema = z.object({
    draft: PortraitSetViewSchema,
    activeSetId: UuidSchema.nullable(),
  });
  export const PortraitGetInputSchema = z.object({ setId: UuidSchema });

  export const PortraitUploadInputSchema = z.object({
    requestId: UuidSchema,
    setId: UuidSchema,
    slot: PortraitSlotSchema,
    expectedRev: z.number().int().nonnegative(),
    file: z.file(),
  });
  export const PortraitGenerateInputSchema = z.object({
    requestId: UuidSchema,
    setId: UuidSchema,
    slot: PortraitSlotSchema,
    expectedRev: z.number().int().nonnegative(),
    format: OutputPreferencesSchema.nullable().default(null),
  });
  export const PortraitUpdateInputSchema = z.object({
    requestId: UuidSchema,
    setId: UuidSchema,
    expectedRev: z.number().int().nonnegative(),
    action: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('remove'), slot: PortraitSlotSchema }),
      z.object({ kind: z.literal('confirm'), slot: PortraitSlotSchema }),
    ]),
  });
  export const PortraitAdoptInputSchema = z.object({
    requestId: UuidSchema,
    setId: UuidSchema,
    expectedRev: z.number().int().nonnegative(),
    mode: z.enum(['adopt', 'retire']),
    expectedActiveSetId: UuidSchema.nullable(),
  });
  export const PortraitPreviewInputSchema = z.object({
    requestId: UuidSchema,
    workId: UuidSchema,
    style: IllustrationStyleSchema,
  });

  export const ImageFileInputSchema = z.object({
    view: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('work'), workId: UuidSchema }),
      z.object({ kind: z.literal('route'), routeId: UuidSchema }),
    ]),
    image: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('illustration'), illustrationId: UuidSchema }),
      z.object({ kind: z.literal('portrait'), setId: UuidSchema, slot: PortraitSlotSchema }),
    ]),
  });

  export const SuggestAppearanceInputSchema = z.object({ workId: UuidSchema });
  export const SuggestAppearanceOutputSchema = z.object({ appearance: z.string() });
  export const SetIllustrationStyleInputSchema = z.object({
    workId: UuidSchema,
    style: IllustrationStyleSchema.nullable(),
  });
  ```

  同样在文件末尾导出 `z.infer` 类型和常量数组的联合类型。
- [x] 4. **改现有 schema（只加不删，§2.8）。**
  - `schemas/play.ts`：
    - `TurnViewSchema` 加 `illustration: IllustrationViewSchema.nullable().default(null)`；
    - `StartInfoSchema` 加 `illustration: StartIllustrationInfoSchema.default(DEFAULT_START_ILLUSTRATION_INFO)`；
    - `StartPlaythroughInputSchema` 加 `illustration: StartIllustrationInputSchema.optional()`；
    - `RouteViewSchema` 加 `playthroughId: UuidSchema.nullable().default(null)`：游玩页进入时要用它预热（T24）；
    - 从 `./illustration.ts` 导入这几个。
  - `schemas/works.ts`：`WorkDetailSchema` 顶层（和 `title`、`blurb` 同级，**不在 `draft` 里**）加 `illustrationStyle: IllustrationStyleSchema.nullable().default(null)`。
  - `schemas/authoring.ts`：`kind: z.literal('entity')` 那一支（按 `PLAN_PROFILE_MAX_LENGTH` 找）加 `appearance: AppearanceTextSchema.nullable().default(null)`。
  - `schemas/story.ts`：
    - 在 `JournalSubjectSchema` 前面新定义 `export const JournalPortraitSchema = z.object({ setId: UuidSchema, updatedAt: TimestampSchema });`（需要从 `./common.ts` 加导入 `TimestampSchema`）；
    - 给 `JournalSubjectSchema` 加 `portrait: JournalPortraitSchema.nullable().default(null)`。
    - **不要**从 `illustration.ts` 导入，免得 `story.ts` 和 `illustration.ts` 互相依赖。
  - `schemas/log.ts`：`ClientLogInputSchema` 的 `discriminatedUnion('metric', …)` 加一支：

    ```ts
    z.strictObject({
      ...SampleBase,
      metric: z.literal('client.illustration_visible'),
      workId: UuidSchema.optional(),
      requestId: UuidSchema,
    }),
    ```
  **同一步补齐生产者与夹具。** .default 处理运行时旧数据，以下对象同时满足新输出类型。只填缺省值，读取实际值交给后续任务。

  | 文件 | 补什么 |
  | --- | --- |
  | `packages/core/src/play/service.ts`、`apps/client/src/features/play/PlayPage.test.tsx` | `turnView`、`makeTurn` 填 `illustration: null`；路线生产者填实际的 `routes.playthrough_id`，`makeRoute` 夹具填 `playthroughId: null` |
  | `packages/core/src/play/start.ts`、`apps/client/src/features/play/StartPage.test.tsx` | 两处 `getStartInfo` / `startInfo` 填 `DEFAULT_START_ILLUSTRATION_INFO` |
  | `packages/core/src/library/service.ts`、client 的 `AuthoringPage.test.tsx`、`PlanPanel.test.tsx`、`BackgroundEditor.test.tsx`、`LibraryPage.test.tsx` | 每个 `WorkDetail` 构造处填 `illustrationStyle: null` |
  | `packages/core/src/story/journal.ts`、`apps/client/src/features/play/PlayPage.test.tsx` | 每个 `JournalSubject` 构造处填 `portrait: null` |
  | `packages/core/src/authoring/plan-tool.ts`、已有的方案构造器及测试，client 的 `PlanItemEditor.tsx`、`PlanItemCard.test.tsx`、`PlanPanel.test.tsx` | `kind === 'entity'` 的 `PlanItem` 补 `appearance: null`。编辑从已有项复制时用 `item.appearance ?? null` |

  用 `rg -n 'WorkDetail|TurnView|RouteView|StartInfo|JournalSubject|PlanItem' apps/client/src packages/core/src` 找符号，运行全仓 `pnpm typecheck` 定位上下文推断出的漏项。只补读取或构造新字段所需的行，现有生产者和类型化夹具的这些改动都归 T02。对存量方案沿用 Zod 解析默认值。

- [x] 5. **`events.ts` 加四个事件**，放在 `settings.changed` 前面：

  ```ts
  z.object({
    type: z.literal('illustration.updated'),
    routeId: UuidSchema,
    turnId: UuidSchema,
    illustrationId: UuidSchema,
  }),
  z.object({ type: z.literal('portrait.updated'), workId: UuidSchema }),
  z.object({ type: z.literal('image.config_changed') }),
  z.object({ type: z.literal('image.service_state'), serviceId: z.string().min(1) }),
  ```
- [x] 6. **`errors.ts` 的 `ERROR_CODES` 末尾**按 §2.3 表格的顺序加 26 个码。`packages/core/src/errors.ts` 的 `HTTP_STATUS` 同步加，状态码照 §2.3。`apps/client/src/i18n/zh-CN/errors.json` 照附录 A.1 加文案。
- [x] 7. **新建三个过程文件。**

  `procedures/image.ts`：

  ```ts
  import { oc } from '@orpc/contract';
  import { z } from 'zod';
  import {
    ContinueWakeInputSchema,
    CreateImageServiceInputSchema,
    CreateImageServiceOutputSchema,
    GeneratedTokenSchema,
    ImageConfigViewSchema,
    ImageStorageSummarySchema,
    ImageUsageSummarySchema,
    OutputOptionsViewSchema,
    OutputPreferencesSchema,
    PrewarmInputSchema,
    RemoveImageServiceInputSchema,
    SelectImageServiceInputSchema,
    SetAutoIllustrationInputSchema,
    AutoIllustrationViewSchema,
    TestImageServiceInputSchema,
    TestImageServiceResultSchema,
    UpdateImageServiceInputSchema,
  } from '../schemas/image.ts';
  import { ImageFileInputSchema } from '../schemas/illustration.ts';

  export const imageContract = {
    services: {
      list: oc.output(ImageConfigViewSchema),
      create: oc.input(CreateImageServiceInputSchema).output(CreateImageServiceOutputSchema),
      update: oc.input(UpdateImageServiceInputSchema).output(ImageConfigViewSchema),
      remove: oc.input(RemoveImageServiceInputSchema).output(ImageConfigViewSchema),
      generateToken: oc.output(GeneratedTokenSchema),
      test: oc.input(TestImageServiceInputSchema).output(TestImageServiceResultSchema),
    },
    select: oc.input(SelectImageServiceInputSchema).output(ImageConfigViewSchema),
    outputPreferences: {
      get: oc.output(OutputOptionsViewSchema),
      set: oc.input(OutputPreferencesSchema).output(OutputOptionsViewSchema),
    },
    autoIllustration: {
      get: oc.output(AutoIllustrationViewSchema),
      set: oc.input(SetAutoIllustrationInputSchema).output(AutoIllustrationViewSchema),
    },
    usage: { summary: oc.output(ImageUsageSummarySchema) },
    storage: { summary: oc.output(ImageStorageSummarySchema) },
    file: oc.input(ImageFileInputSchema).output(z.file()),
    prewarm: oc.input(PrewarmInputSchema).output(z.object({})),
    wake: { continue: oc.input(ContinueWakeInputSchema).output(z.object({})) },
  };
  ```

  `procedures/illustration.ts`：

  ```ts
  export const illustrationContract = {
    retry: oc.input(IllustrationActionInputSchema).output(IllustrationViewSchema),
    reroll: oc.input(IllustrationActionInputSchema).output(IllustrationViewSchema),
    dismiss: oc.input(DismissIllustrationInputSchema).output(IllustrationViewSchema),
  };
  ```

  `procedures/portrait.ts`：

  ```ts
  export const portraitContract = {
    draft: oc.input(PortraitDraftInputSchema).output(PortraitDraftViewSchema),
    get: oc.input(PortraitGetInputSchema).output(PortraitSetViewSchema),
    upload: oc.input(PortraitUploadInputSchema).output(PortraitSetViewSchema),
    generate: oc.input(PortraitGenerateInputSchema).output(PortraitSetViewSchema),
    update: oc.input(PortraitUpdateInputSchema).output(PortraitSetViewSchema),
    adopt: oc.input(PortraitAdoptInputSchema).output(PortraitDraftViewSchema),
    preview: oc.input(PortraitPreviewInputSchema).output(PortraitSetViewSchema),
  };
  ```

  每个文件按需从 `@orpc/contract`、`zod` 和 schema 文件导入。
- [x] 8. **改现有过程文件。**
  - `procedures/play.ts` 加 `suggestAppearance: oc.input(SuggestAppearanceInputSchema).output(SuggestAppearanceOutputSchema)`；
  - `procedures/works.ts` 加 `setIllustrationStyle: oc.input(SetIllustrationStyleInputSchema).output(z.object({}))`。
- [x] 9. **`index.ts`。**
  - `contract` 对象加 `image: imageContract, illustration: illustrationContract, portrait: portraitContract`；
  - 末尾加 `export * from './schemas/image.ts';` 和 `export * from './schemas/illustration.ts';`。
- [x] 10. **`packages/core/src/api/router.ts`，同波接临时路由。** 在 `base.router` 中为第 7–9 步注册的每个叶子绑定对应的 `base.<路径>.handler`，包括 `play.suggestAppearance`、`works.setIllustrationStyle`。临时处理函数抛 `appError('internal', 'not implemented: rpc.<路径>')`，不调用服务。旧过程保留既有 handler。T06 逐一改调服务并删临时函数。
- [x] 11. **测试。** `api/http-app.test.ts` 经现有鉴权入口对 `works.list`、`image.services.list` 各发一个有效请求。旧过程成功；新过程进到临时 handler，应用错误码为 `internal`，诊断里记录过程路径。T06 接真实服务后把后者改为真实列表结果。`schemas/image.test.ts`、`schemas/illustration.test.ts` 至少覆盖下表。每一行用 `safeParse` 断言 `success` 的布尔值：

  | schema | 输入 | 期望 |
  | --- | --- | --- |
  | `AspectSchema` | `'3:2'`、`'16:9'`、`'1:1'` | 通过 |
  | `AspectSchema` | `'0:1'`、`'3:2:1'`、`'a:b'`、`'1000:1'`、`' 3:2'` | 不通过 |
  | `ImageTierPreferenceSchema` | `'default'` | 通过 |
  | `IdleMinutesSchema` | `4`、`721`、`30.5` | 不通过；`5`、`720` 通过 |
  | `IllustrationStyleSchema` | `{ kind: 'custom', text: '' }`、`{ kind: 'custom', text: 'a\nb' }`、201 个字符 | 不通过 |
  | `AppearanceTextSchema` | 300 个字符 | 通过；301 个字符、含 `\n` 的不通过 |
  | `PortraitSetViewSchema` | `slots` 只有两项 | 不通过 |
  | `TurnViewSchema` | 不带 `illustration` 的旧对象 | 通过，并且 `illustration` 解析为 `null`（证明只加不删） |
  | `StartPlaythroughInputSchema` | 不带 `illustration` 的旧输入 | 通过 |
  | `CoreEventSchema` | `{ type: 'image.service_state', serviceId: '' }` | 不通过 |

  另写一条：`STYLE_PRESETS`、`IMAGE_TIERS`、`PORTRAIT_SLOTS` 的字面量和设计文档一致。这一条直接写死期望数组，不从被测常量派生（[tasks/AGENTS.md §4](./AGENTS.md#4-判据) 第 5 条）。

**接线点。**

| 契约 | 实现它的任务 | client 使用它的任务 |
| --- | --- | --- |
| `image.services.*`、`image.select`、`image.outputPreferences.*`、`image.autoIllustration.*` | T06 | T21 |
| `image.usage.summary`、`image.prewarm`、`image.wake.continue` | T11 | T21、T24 |
| `image.storage.summary` | T15 | T21 |
| `image.file` | T19 | T20 |
| `illustration.*` | T18 | T24 |
| `portrait.*` | T17 | T22、T23 |
| `play.suggestAppearance`、`works.setIllustrationStyle` | T13 | T23、T22 |
| `TurnView.illustration` | T18 | T24 |
| `StartInfo.illustration`、`StartPlaythroughInput.illustration` | T13 | T23 |
| `WorkDetail.illustrationStyle` | T13 | T22 |
| `JournalSubject.portrait` | T19 | T24 |
| 四个新事件 | T11、T17、T18、T06 | T20 |

**注意事项。**

- `z.file()` 是 zod 4 的 API。版本对不上（例如没有 `z.file`）时，用 `z.instanceof(File)`，并在汇报里写明。
- 不要在 `illustration.ts` 里导入 `play.ts`、`works.ts`、`authoring.ts`、`story.ts`，只能单向依赖，否则 ESM 会出现循环导入。
- `ImageServiceViewSchema.action.url` 用 `z.string()`，不用 `z.url()`：协议是否为 `https:` 由 core 判断（§2.6）。client 不再校验它。
- 新的错误码**同时**改三处。漏了 core 的 `HTTP_STATUS`，typecheck 会红；漏了 `errors.json`，client 的 `keys.test.ts` 会红。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 第 1 步的往返测试绿 | 把 `down` 返回的 `type` 改成 `'image/png'`：`type === 'image/webp'` 那条断言变红 |
| 第 11 步的表格全部按期望通过或不通过 | 把 `AspectSchema` 的正则改成 `/^\d+:\d+$/u`：`'0:1'`、`'1000:1'` 两行变红 |
| W1 各自及集成后 `pnpm typecheck` 全绿 | 删掉 `base.router` 的 `image` 分支，或删掉 `turnView` 自带的 `illustration: null`，各自出现缺少属性的类型错误 |
| `pnpm --filter @unwritten/contracts test`、`pnpm typecheck` 全绿 | 从 core 的 `HTTP_STATUS` 删掉 `image_wake_timeout`：typecheck 变红 |
| client 的 `pnpm --filter @unwritten/client test`（`keys.test.ts`）绿 | 从 `errors.json` 删掉 `image_offline`：`keys.test.ts` 变红 |
| `rg -n "import .*from '\./(play\|works\|authoring\|story)\.ts'" packages/contracts/src/schemas/illustration.ts packages/contracts/src/schemas/image.ts` 零命中 | — |

---

### T03 仓库：Python 工具链、`pnpm test:python`、插件名扫描

**目的。** 给四个 Python 目录建好统一的工具链，让后续 Python 任务只写代码：

- 依赖锁定；
- ruff 的提交前检查；
- 一条命令跑全部 Python 测试和对插件的一致性测试。

同时落地「`apps/`、`packages/` 里不出现插件专属名字」的扫描（[插件 §2](../docs/plugins.md#2-边界)）。

**依赖。** 无。

**拥有的文件。**

- 新建：
  - `scripts/check-plugin-names.mjs`、`scripts/check-plugin-names.test.mjs`；
  - `scripts/test-python.mjs`；
  - `scripts/ruff-staged.mjs`；
  - 四个 `pyproject.toml`：`selfhost/colab/pyproject.toml`、`plugins/comfyui/pyproject.toml`、`selfhost/strata/pyproject.toml`、`plugins/colab-launcher/pyproject.toml`；
  - 由 uv 生成的四个 `uv.lock`；
  - `plugins/comfyui/requirements.txt`、`selfhost/strata/requirements.txt`，由 uv 导出。
- 改：根目录 `package.json`（只改 `scripts`）、`lefthook.yml`、`.gitignore`。

**先读。**

- [插件 §6](../docs/plugins.md#6-仓库里的插件)；
- [技术选型 §3](../docs/tech-stack.md#3-仓库与工具链)里 uv、ruff、pytest、lefthook 的几行；
- `scripts/check-doc-links.mjs`：新脚本的写法照它，接收一个可选的仓库根目录参数；
- `scripts/dev.test.mjs`：用 `node:test` 写测试的方式。

**步骤。**

- [x] 1. **核对前提。**
  - `uv --version` 能运行。不能运行时停下来汇报，请维护者先装 uv。
  - `git ls-files apps packages | xargs rg -il "comfy|colab|tailscale|strata"` 零命中。规划时零命中；有命中时停下来汇报命中的文件。
  - `ls plugins selfhost` 两个目录都不存在。
- [x] 2. **`scripts/check-plugin-names.mjs`。**
  - **扫哪些文件：** 运行 `git -C <根目录> ls-files apps packages`，跳过：
    - 文件名是 `pnpm-lock.yaml` 的；
    - 扩展名是 `.png`、`.jpg`、`.jpeg`、`.webp`、`.icns`、`.ico`、`.woff2` 的二进制文件。
  - **怎样匹配：** 逐行用 `/comfy|colab|tailscale|strata/i` 匹配。
  - **输出：** 命中时打印 `文件:行号: 那一行`，最后打印 `发现 N 处插件专属名字`，以退出码 1 结束；没有命中时打印 `插件名扫描通过（N 个文件）`，退出码 0。
  - **根目录：** 默认是脚本所在目录的上一级；可以用第一个命令行参数传入另一个目录。
  - 名单写成一个导出的常量 `PLUGIN_NAMES = ['comfy', 'colab', 'tailscale', 'strata']`，`qwen` 不在名单里（D20）。
- [x] 3. **`scripts/check-plugin-names.test.mjs`**（`node:test`）。每个测试：
  1. 在 `os.tmpdir()` 下建临时目录，`git init`；
  2. 写入 `apps/a.ts`、`packages/b.ts`；
  3. `git add -A`；
  4. 用 `execFileSync(process.execPath, [脚本路径, 临时目录])` 运行脚本；
  5. 删除临时目录。

  四个测试：
  - 两个文件都干净：退出码 0，输出含 `插件名扫描通过（2 个文件）`。这是阳性对照，证明确实扫到了文件。
  - `packages/b.ts` 里写 `const x = 'ComfyUI';`：退出码 1，输出含 `packages/b.ts:1:`。
  - `plugins/c.py` 里写 `comfy`、但 `apps/`、`packages/` 干净：退出码 0。证明 `plugins/` 不在扫描范围内。
  - 未被 git 跟踪的 `apps/untracked.ts` 里写 `colab`：退出码 0。证明只扫跟踪的文件。
- [x] 4. **`scripts/test-python.mjs`。**
  1. **检查 uv。** 先运行 `uv --version`，失败时打印 `需要先安装 uv：https://docs.astral.sh/uv/` 并以退出码 1 结束。
  2. **跑各目录的 pytest。** 依次处理 `selfhost/colab`、`plugins/comfyui`、`selfhost/strata`、`plugins/colab-launcher`：
     - 目录下没有 `tests/` 时打印 `跳过 <目录>：还没有测试`，继续下一个；
     - 有 `tests/` 时运行 `uv run --frozen --directory <目录> pytest -q`，继承 stdio；
     - 任一个退出码非 0，记下失败，继续跑完其余的。
  3. **跑一致性测试。** 依次处理下面两组：

     | 插件目录 | 启动脚本 | 环境变量前缀 | core 测试目录 |
     | --- | --- | --- | --- |
     | `plugins/comfyui` | `tests/serve_with_fakes.py` | `UNWRITTEN_IMAGE_CONFORMANCE` | `src/image/conformance` |
     | `plugins/colab-launcher` | `tests/serve_with_fakes.py` | `UNWRITTEN_LAUNCHER_CONFORMANCE` | `src/image/launcher/conformance` |

     对每一组：
     - 启动脚本不存在时打印 `跳过 <目录> 的一致性测试：还没有启动脚本`；
     - 存在时，用 `spawn('uv', ['run', '--frozen', '--directory', 目录, 'python', 启动脚本])` 启动它，读它的 stdout，等到出现两行 `UNWRITTEN_CONFORMANCE_URL=<地址>` 和 `UNWRITTEN_CONFORMANCE_TOKEN=<令牌>`，最多等 60 秒；
     - 然后运行 `pnpm --filter @unwritten/core exec vitest run <core 测试目录>`，环境变量设 `<前缀>_URL` 和 `<前缀>_TOKEN`；
     - 测试结束后给启动脚本发 `SIGTERM`，最多等 5 秒，再 `SIGKILL`。

     启动脚本的约定写进 T26、T28：它只打印这两行，令牌每次随机生成。
  4. **汇总。** 打印每一步的结果。有任何失败时以退出码 1 结束。
- [x] 5. **`scripts/ruff-staged.mjs`。** 参数是暂存的 `.py` 文件路径。
  - 按文件所在的 Python 目录（四个目录之一）分组。不在这四个目录里的 `.py` 文件：打印出来，以退出码 1 结束。
  - 对每一组依次运行 `uv run --frozen --directory <目录> ruff check --fix <相对路径…>` 和 `uv run --frozen --directory <目录> ruff format <相对路径…>`。路径要换成相对于该目录的路径。
  - 任一命令失败以它的退出码结束。
- [x] 6. **根目录 `package.json` 的 `scripts`。**
  - `test` 的开头改成 `node scripts/check-tokens.mjs && node scripts/check-plugin-names.mjs && node --test packages/tokens/build-css.test.mjs scripts/dev.test.mjs scripts/check-plugin-names.test.mjs && turbo run test`；
  - 加 `"test:python": "node scripts/test-python.mjs"`。
- [x] 7. **`lefthook.yml`。** 在 `prettier` 那一项**前面**加：

  ```yaml
      - name: ruff
        glob: "{plugins,selfhost}/**/*.py"
        run: node scripts/ruff-staged.mjs {staged_files}
        stage_fixed: true
  ```
- [x] 8. **四个 `pyproject.toml`。** 结构照下面这个模板，按 §2.10 的依赖表填：

  ```toml
  [project]
  name = "unwritten-comfyui"
  version = "0.1.0"
  requires-python = ">=3.11"
  dependencies = ["aiohttp==<版本>", "Pillow==<版本>"]

  [dependency-groups]
  dev = ["pytest==<版本>", "pytest-aiohttp==<版本>", "ruff==<版本>"]

  [tool.uv]
  package = false

  [tool.ruff]
  line-length = 120
  target-version = "py311"

  [tool.ruff.lint]
  select = ["E", "F", "W", "I", "B", "UP", "S"]

  [tool.pytest.ini_options]
  testpaths = ["tests"]
  pythonpath = ["."]
  asyncio_mode = "auto"
  ```

  - **名字：** 分别是 `unwritten-colab-host`、`unwritten-comfyui`、`unwritten-strata-gateway`、`unwritten-colab-launcher`。
  - **`requires-python`：** 按 D18 填，`plugins/colab-launcher` 写 `">=3.12"`，`target-version` 相应写 `py312`。
  - **`selfhost/colab`：** `dependencies = []`，开发依赖只有 `pytest` 和 `ruff`，没有 `asyncio_mode` 那一行。
  - **版本：** 按 §2.10 选「发布满两周的最新版」，记进台账。
  - **不写注释**（§0.2）。
  - `S` 规则（安全）会拦掉 `subprocess` 的 shell 调用和 `assert` 等。测试目录要放宽 `S101`（允许 `assert`）：在 `[tool.ruff.lint.per-file-ignores]` 里写 `"tests/**" = ["S101"]`。这是配置，不是代码里的抑制指令，符合 [AGENTS.md §8](../AGENTS.md#8-不写注释)。
- [x] 9. **生成锁定文件和导出文件。**
  - 在每个目录里运行 `uv lock`；
  - 在 `plugins/comfyui`、`selfhost/strata` 里运行 `uv export --no-dev --format requirements-txt -o requirements.txt`（带哈希，供 Colab 上的 `pip install --require-hashes` 用）；
  - 检查生成的 `requirements.txt` 里没有以 `#` 开头的注释行。有的话，加 `--no-header` 重新导出；仍有注释时，停下来汇报。
- [x] 10. **`.gitignore`。** 加 `.venv/`、`__pycache__/`、`.pytest_cache/`、`.ruff_cache/`（四行，不带注释）。加之前先 `rg -n "^\.venv|__pycache__" .gitignore`，已有的不重复加。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| 插件名扫描 | 根 `package.json` 的 `test` 第二条命令 |
| 扫描脚本的测试 | 根 `package.json` 的 `test` 里 `node --test` 的文件列表 |
| Python 测试 | 根 `package.json` 的 `test:python` |
| ruff | `lefthook.yml` 的 `ruff` 一项 |

**注意事项。**

- `check-plugin-names.mjs` 自己写着这些名字，它在 `scripts/` 下，不在扫描范围内，所以不会扫到自己。
- `test-python.mjs` 不进 `pnpm test`（D19）。
- 本任务是 §0.5 第 5 条的例外：允许改 `package.json` 的 `scripts`、`lefthook.yml`、`scripts/`。其余“不该动的东西”仍然零差异。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `node --test scripts/check-plugin-names.test.mjs` 四个测试全绿 | 把 `PLUGIN_NAMES` 里的 `'comfy'` 删掉：第二个测试变红 |
| `node scripts/check-plugin-names.mjs` 在当前仓库上退出码 0，输出的文件数大于 0 | 在 `packages/core/src/app.ts` 末尾临时加一行 `const tmp = 'strata';`：退出码 1，输出指向这一行。改回后重新跑 |
| `pnpm test:python` 退出码 0，输出四行 `跳过 …：还没有测试` 和两行 `跳过 … 的一致性测试` | 临时在 `selfhost/colab/tests/test_fail.py` 写 `def test_x(): assert False`：退出码 1。删掉后重新跑 |
| `git diff --stat -- pnpm-lock.yaml pnpm-workspace.yaml '*/package.json' .oxlintrc.json stylelint.config.mjs` 为空 | — |
| `rg -n "^\s*#" plugins/*/pyproject.toml selfhost/*/pyproject.toml` 零命中 | — |

---

### T07 core：图片字节校验与测试夹具

**目的。** 出图服务的返回和本机导入的图片都是信任边界（[插图与出图服务 §5.3](../docs/image.md#53-校验返回的数据)、§6.2）。本任务写一个纯函数，只看字节，判断：

- 类型（只收 PNG、JPEG、WebP）；
- 宽高；
- 像素数；
- 是否为动图；
- 是否带 EXIF、XMP 或文本块。

后续所有写图片的地方都调用它。另外提供现造图片字节的测试夹具，全仓不提交二进制图片。

**依赖。** T02（从 contracts 导入图片字节和像素上限）。

**拥有的文件。** 新建：`packages/core/src/image/limits.ts`、`packages/core/src/image/validate.ts`、`packages/core/src/image/validate.test.ts`、`packages/core/src/image/errors.ts`、`packages/core/src/image/conformance/target.ts`、`packages/core/src/image/conformance/target.test.ts`、`packages/core/src/test-support/image-bytes.ts`、`packages/core/src/test-support/image-bytes.test.ts`。后两个 `image/` 文件是 W3 三个协议任务（T08、T09、T10）共用的，放在这里，免得它们在同一波次里抢同一个文件。

**先读。**

- [插图与出图服务 §5.3](../docs/image.md#53-校验返回的数据)、§6.2 的「导入」一条；
- 文件格式只需要读到文件头为止：
  - PNG：[W3C PNG §5](https://www.w3.org/TR/png-3/#5DataRep)；
  - WebP：[RIFF 容器](https://developers.google.com/speed/webp/docs/riff_container)；
  - JPEG 的段结构：每段 `FF xx` 加两字节长度。

**步骤。**

- [x] 1. **核对前提。** T02 已合入，`rg -n "IMAGE_MAX_BYTES|IMAGE_MAX_PIXELS" packages/contracts/src/schemas/image.ts` 有两项常量，`index.ts` 导出该 schema。`ls packages/core/src/image` 不存在；`node -e "console.log(typeof require('node:zlib').crc32)"` 输出 `function`。不是 `function` 时，第 4 步的 PNG 夹具改用自己写的 CRC32 表，并在汇报里写明。
- [x] 2. **`image/limits.ts`。**

  ```ts
  export { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS } from '@unwritten/contracts';
  export const IMAGE_ASPECT_TOLERANCE = 0.02;
  export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
  export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];
  export const IMAGE_EXTENSION: Record<ImageMime, 'png' | 'jpg' | 'webp'> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  ```
- [x] 3. **`image/validate.ts`。** 导出：

  ```ts
  export type ImageRejectReason =
    | 'too_large'
    | 'unknown_type'
    | 'svg'
    | 'truncated'
    | 'bad_dimensions'
    | 'too_many_pixels'
    | 'animated'
    | 'metadata';

  export interface ValidatedImage {
    mime: ImageMime;
    ext: 'png' | 'jpg' | 'webp';
    width: number;
    height: number;
    bytes: number;
  }

  export type ImageValidation = { ok: true; image: ValidatedImage } | { ok: false; reason: ImageRejectReason };

  export function validateImageBytes(
    bytes: Uint8Array,
    options?: { maxBytes?: number; rejectMetadata?: boolean },
  ): ImageValidation;

  export function aspectMatches(width: number, height: number, aspect: string, tolerance?: number): boolean;
  ```

  **规则，按顺序判断，先命中先返回：**

  1. `bytes.length > (options.maxBytes ?? IMAGE_MAX_BYTES)` → `too_large`。
  2. 跳过开头的 UTF-8 BOM 和空白，第一个字节是 `<` → `svg`。
  3. 按文件头分派：
     - `89 50 4E 47 0D 0A 1A 0A` → PNG；
     - `FF D8 FF` → JPEG；
     - `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`（`RIFF....WEBP`）→ WebP。
     - 都不是 → `unknown_type`。
  4. **PNG**：从偏移 8 开始逐块读取，每块是 4 字节长度（大端）、4 字节类型、数据、4 字节 CRC。
     - 任何一块的长度越过文件末尾 → `truncated`；
     - 第一块必须是 `IHDR`，宽高是它数据的前 8 字节（两个大端 uint32）；
     - 遇到 `acTL` → `animated`；
     - 遇到 `tEXt`、`zTXt`、`iTXt`、`eXIf` → 记下「有元数据」；
     - 读到 `IEND` 结束；读完都没有 `IEND` → `truncated`；
     - `iCCP`、`sRGB`、`gAMA`、`cHRM`、`pHYs` 是标准色彩信息，允许。
     - 不校验 CRC：它只防传输损坏，不是信任边界。
  5. **JPEG**：从偏移 2 开始逐段读取。
     - 段标记是 `FF xx`；`xx` 为 `D8`、`01`、`D0`–`D7` 的段没有长度，其余段跟两字节大端长度（含长度本身）。
     - `C0`–`C3`、`C5`–`C7`、`C9`–`CB`、`CD`–`CF` 是帧头，数据的第 2–3 字节是高、第 4–5 字节是宽（都是大端）。
     - 下面三种段算元数据：
       - `E1`（APP1），数据以 `Exif\0\0` 开头；
       - `E1`，数据以 `http://ns.adobe.com/xap/1.0/\0` 开头；
       - `FE`（注释）。
     - `E2`（APP2，ICC 色彩）允许。
     - 读到 `DA`（扫描开始）就停止，不再往后读。
     - 没读到帧头就到了 `DA` 或文件末尾 → `truncated`。
  6. **WebP**：从偏移 12 开始逐块读取，每块是 4 字节 FourCC、4 字节小端长度、数据，长度为奇数时补一个字节。
     - `VP8X`：数据第 0 字节的 `0x02` 位是动图，`0x08` 位是 EXIF，`0x04` 位是 XMP。画布宽减一是数据偏移 4–6 的 24 位小端数，高减一是偏移 7–9。
     - `VP8 `（有空格）：数据偏移 3–5 必须是 `9D 01 2A`，偏移 6–7 的小端 16 位取低 14 位是宽，偏移 8–9 取低 14 位是高。
     - `VP8L`：数据第 0 字节必须是 `0x2F`，接下来 4 字节是小端 32 位 `v`：宽 = `(v & 0x3FFF) + 1`，高 = `((v >> 14) & 0x3FFF) + 1`。
     - 块 `ANIM`、`ANMF` → `animated`；块 `EXIF`、`XMP ` → 有元数据。
     - 有 `VP8X` 时用它的画布尺寸，否则用 `VP8 ` 或 `VP8L` 的尺寸。都没有 → `truncated`。
  7. 宽或高不是正整数 → `bad_dimensions`；`宽 × 高 > IMAGE_MAX_PIXELS` → `too_many_pixels`。
  8. 有元数据，并且 `options.rejectMetadata` 为 true → `metadata`。
  9. 返回 `ok`。

  `aspectMatches`：`aspect` 是 `"a:b"`，算 `|w/h − a/b| ÷ (a/b) ≤ tolerance`（默认 `IMAGE_ASPECT_TOLERANCE`）。`aspect` 格式不对时返回 `false`。

  **所有读取都先检查下标不越界。** 越界一律当 `truncated`，绝不抛异常。这个函数的输入是不可信的，写成「任何字节序列都不会让它抛错」。
- [x] 4. **`test-support/image-bytes.ts`。** 导出：
  - `pngBytes(width, height, options?: { textChunk?: string; exif?: boolean; animated?: boolean }): Uint8Array`
    - 生成**真正能解码的** PNG：8 位 RGB，每行开头一个过滤字节 0，像素全 0；`IDAT` 数据用 `zlib.deflateSync` 压缩；每块的 CRC 用 `zlib.crc32(类型 + 数据)`。
    - `textChunk` 在 `IEND` 前插一个 `tEXt` 块，内容是 `Comment\0<文字>`；`exif` 插一个空的 `eXIf` 块；`animated` 在 `IHDR` 后插一个 `acTL` 块。
  - `TINY_WEBP: Uint8Array`：一张能解码的 1×1 无损 WebP。写死它的 base64：`UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==`，用 `Buffer.from(…, 'base64')` 转出。
  - `webpHeaderBytes(width, height, options?: { exif?: boolean; xmp?: boolean; animated?: boolean }): Uint8Array`：只有文件头的 WebP（`RIFF` 加一个 `VP8X` 块，加一个长度为 0 的 `VP8L` 块）。浏览器解不开，只给 core 的头部校验用。
  - `jpegHeaderBytes(width, height, options?: { exif?: boolean; xmp?: boolean; comment?: boolean }): Uint8Array`：依次是：
    1. `FF D8`；
    2. 按选项插入的 APP1 或注释段；
    3. 一个 `FF C0` 帧头；
    4. `FF DA` 段；
    5. 两个数据字节；
    6. `FF D9`。
- [x] 5. **`test-support/image-bytes.test.ts`。** 用 `validateImageBytes` 反向验证夹具：
  - `pngBytes(3, 2)` 校验得 `image/png`、宽 3、高 2；
  - `TINY_WEBP` 得 `image/webp`、1×1；
  - `webpHeaderBytes(1536, 1024)` 得 1536×1024；
  - `jpegHeaderBytes(640, 480)` 得 640×480。

  另用 `zlib.inflateSync` 解压 `pngBytes(3, 2)` 的 `IDAT` 数据，断言长度是 `(1 + 3 × 3) × 2 = 20`，证明夹具真的能解码。
- [x] 6. **`image/validate.test.ts`。** 至少这些用例，每一条断言 `ok` 和 `reason` 的字面量：

  | 输入 | 期望 |
  | --- | --- |
  | `pngBytes(1536, 1024)` | ok，`image/png`，1536×1024，`ext` 为 `png` |
  | `pngBytes(1, 1, { textChunk: 'prompt' })`，`rejectMetadata: true` | `metadata` |
  | 同上，不传 `rejectMetadata` | ok（证明只有要求时才拒） |
  | `pngBytes(1, 1, { animated: true })` | `animated` |
  | `pngBytes(1, 1)` 截掉最后 10 个字节 | `truncated` |
  | `webpHeaderBytes(2, 2, { exif: true })`，`rejectMetadata: true` | `metadata` |
  | `webpHeaderBytes(2, 2, { animated: true })` | `animated` |
  | `jpegHeaderBytes(4, 4, { exif: true })`，`rejectMetadata: true` | `metadata` |
  | `jpegHeaderBytes(4, 4, { comment: true })`，`rejectMetadata: true` | `metadata` |
  | `new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')` | `svg` |
  | `new TextEncoder().encode('﻿  <svg/>')` | `svg` |
  | `new Uint8Array([0x47, 0x49, 0x46, 0x38])`（GIF） | `unknown_type` |
  | 长度为 `IMAGE_MAX_BYTES + 1` 的全 0 数组 | `too_large`（证明大小先于类型判断） |
  | `webpHeaderBytes(8000, 8000)` | `too_many_pixels` |
  | `pngBytes(0, 5)`，夹具直接写宽 0 | `bad_dimensions` |
  | 1000 次随机长度（0–64）、随机内容的字节 | 不抛异常，结果都是 `ok: false` 或合法的 `ok: true`（模糊测试，种子固定） |

  `aspectMatches`：`(1536, 1024, '3:2')` 为 true；`(1024, 1360, '3:4')` 为 true（误差约 0.4%）；`(1000, 1000, '3:2')` 为 false；`(1, 1, 'x')` 为 false。

- [x] 7. **`image/errors.ts`。** 出图模块内部统一的错误类型，T08、T09、T10、T11 共用：

  ```ts
  import type { ErrorCode } from '@unwritten/contracts';

  export type ImageErrorKind = 'final' | 'capability' | 'format' | 'busy' | 'transport';

  export class ImageError extends Error {
    readonly code: ErrorCode;
    readonly kind: ImageErrorKind;
    readonly retryAfterMs: number | null;
    readonly submitted: boolean;
    constructor(code: ErrorCode, kind: ImageErrorKind, options?: { retryAfterMs?: number; submitted?: boolean; cause?: unknown }) {
      super(code, { cause: options?.cause });
      this.name = 'ImageError';
      this.code = code;
      this.kind = kind;
      this.retryAfterMs = options?.retryAfterMs ?? null;
      this.submitted = options?.submitted ?? false;
    }
  }
  ```

  `kind` 的含义：
  - `capability`：参考图超出能力，要刷新能力后重做；
  - `format`：规格不可用；
  - `busy`：按 `retryAfterMs` 等待后重试一次；
  - `transport`：可以按同一个幂等键重发；
  - `final`：不重试。

  `message` 只放错误码，不放服务返回的原文。
- [x] 8. **`image/conformance/target.ts`。** 两组一致性测试（T08、T10）共用的目标选择。导出：

  ```ts
  export async function conformanceTarget(
    prefix: 'UNWRITTEN_IMAGE' | 'UNWRITTEN_LAUNCHER',
    startFake: () => Promise<{ url: string; token: string; close(): Promise<void> }>,
  ): Promise<{ url: string; token: string; real: boolean; close(): Promise<void> }>;
  ```

  - 设了 `${prefix}_CONFORMANCE_URL` 和 `${prefix}_CONFORMANCE_TOKEN` 两个环境变量时，用它们，`real: true`，`close` 什么也不做。
  - 两个都没设时，调用 `startFake()`。
  - 只设了一个时抛错，提示两个都要设。
  再写一个 `image/conformance/target.test.ts`：三种环境变量组合各一个用例。用 `vi.stubEnv` 设环境变量，测完 `vi.unstubAllEnvs()`。

**接线点。** 本任务只提供函数。调用方：

| 调用方 | 任务 |
| --- | --- |
| Unwritten 图像协议的取图 | T08 |
| OpenAI 图像接口的解码结果 | T09 |
| 引擎里出图结果的统一校验 | T11 |
| 本机导入的参考图 | T17 |
| 写进 `images/` 前的最后一道 | T15 |

**注意事项。**

- 不用任何图像库。core 不装 sharp（[技术选型的不选的方案](../docs/tech-stack.md)）。
- 不做解码，不重新编码：服务返回的合格文件原样保存（[插图与出图服务 §5.3](../docs/image.md#53-校验返回的数据)）。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 第 6 步表格全部按期望 | 把 PNG 分支里 `tEXt` 从元数据清单里删掉：`textChunk` 那一行变红 |
| 同上 | 把第 1 条（大小）挪到第 3 条之后：`too_large` 那一行变成 `unknown_type`，变红 |
| 模糊测试不抛异常 | 去掉 JPEG 分支里读长度前的越界检查：模糊测试抛 `RangeError` 或返回错误宽高，变红；不红时把种子换一次再试，仍不红就如实写进汇报 |
| `image-bytes.test.ts` 绿 | 把 `pngBytes` 的过滤字节从 0 改成不写：`inflateSync` 长度断言变红 |
| `rg -n "from '\.\./(story\|play\|authoring\|illustration)/" packages/core/src/image` 零命中 | — |

---

### T04 core：`providers` 模块与版本 2

**目的。** `providers.json` 要同时装模型服务和出图服务（[插图与出图服务 §2](../docs/image.md#2-出图服务的配置)）。两个模块写同一个文件，必须共用一个存储：

- 一份缓存；
- 一个写队列；
- 一套校验。

否则两边会互相覆盖对方的改动。本任务把存储从 `llm` 模块里拿出来，升到版本 2，并实现从版本 1 迁移和 `.bak` 备份（D1、D2）。

**依赖。** T02（`IMAGE_PROTOCOLS`、`OpenAiImageOptionsSchema`、`IdleMinutesSchema`）。

**拥有的文件。**

- 新建：
  - `packages/core/src/providers/schema.ts`、`packages/core/src/providers/file.ts`、`packages/core/src/providers/migrate.ts`；
  - `packages/core/src/providers/file.test.ts`、`packages/core/src/providers/migrate.test.ts`。
- 删除：`packages/core/src/llm/providers-schema.ts`、`packages/core/src/llm/providers-file.ts`、`packages/core/src/llm/providers-file.test.ts`，以及移走的 `llm/keys.ts`、`llm/keys.test.ts`、`llm/endpoint-id.ts`、`llm/endpoint-id.test.ts`。
- 新建（移来）：`packages/core/src/providers/keys.ts`、`providers/keys.test.ts`、`providers/ids.ts`、`providers/ids.test.ts`。
- 改：
  - `packages/core/src/llm/service.ts`、`packages/core/src/llm/params.ts`、`packages/core/src/llm/test-connection.ts`、`packages/core/src/llm/test-connection.test.ts`：只改导入路径和存储的来源；
  - `packages/core/src/services.ts`：`CoreDeps` 加一个字段；
  - `packages/core/src/app.ts`：创建共用存储。

**先读。**

- [LLM 端点 §2](../docs/llm-endpoints.md#2-providersjson)；
- [插图与出图服务 §2](../docs/image.md#2-出图服务的配置)，包括配置示例和「文件版本是 2」那一条；
- `llm/providers-file.ts`、`llm/providers-schema.ts`、`llm/providers-file.test.ts` 全文；
- `llm/service.ts` 里用到 `store` 的地方：`rg -n "store\." packages/core/src/llm/service.ts`。

**步骤。**

- [x] 1. **核对前提。**
  - 运行 `rg -n "providers-file|providers-schema" packages/core/src`。规划时命中这几个文件：`llm/service.ts`、`llm/params.ts`、`llm/providers-file.ts`、`llm/providers-file.test.ts`、`llm/test-connection.ts`、`llm/test-connection.test.ts`。多出来的文件同样要改导入。
  - 运行 `rg -n "createProvidersStore\(" packages/core/src --glob '!*.test.ts'`，确认生产代码只有 `llm/service.ts` 一处调用。
- [x] 2. **`providers/schema.ts`。**
  1. 把 `llm/providers-schema.ts` 的内容移过来；
  2. `PROVIDERS_FILE_VERSION` 改成 `2`；
  3. 加下面两段，插在 `ProvidersFileSchema` 之前：

  ```ts
  export const ImageServiceEntrySchema = z.looseObject({
    id: z.string().min(1),
    name: z.string().min(1),
    protocol: z.enum(IMAGE_PROTOCOLS),
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    model: z.string().min(1).optional(),
    capabilities: OpenAiImageOptionsSchema.optional(),
    launcher: z.looseObject({ baseUrl: z.string().min(1), apiKey: z.string().optional() }).optional(),
    idleMinutes: IdleMinutesSchema.optional(),
  });
  export type ImageServiceEntry = z.infer<typeof ImageServiceEntrySchema>;
  ```

  `ProvidersFileSchema` 里：
  - `version` 改成 `z.literal(PROVIDERS_FILE_VERSION)`；
  - 加 `imageServices: z.array(ImageServiceEntrySchema).default([])`；
  - 加 `image: z.object({ service: z.string().min(1).nullable() }).default({ service: null })`。

  `emptyProvidersFile()` 返回值加 `imageServices: []`、`image: { service: null }`。

  文件名里的 `capabilities` 是 OpenAI 图像接口的手填能力（`maxReferences`、`sizes`），和 [插图与出图服务 §2](../docs/image.md#2-出图服务的配置) 的示例一致。
- [x] 3. **`providers/migrate.ts`。** 导出：

  ```ts
  export function upgradeProvidersObject(parsed: unknown): { value: unknown; fromVersion: 1 | 2 | null };
  ```

  - `parsed` 是对象，且 `version === 1`：返回一个**新对象**，在原对象的基础上设 `version: 2`；没有 `imageServices` 时补 `[]`，没有 `image` 时补 `{ service: null }`。`fromVersion: 1`。
  - `version === 2`：原样返回，`fromVersion: 2`。
  - 其他情况：原样返回，`fromVersion: null`。由调用方照旧按 schema 报错。
  - 不修改传入的对象。
- [x] 4. **`providers/file.ts`。** 把 `llm/providers-file.ts` 移过来，做四处改动：
  1. `ProvidersState` 的 `ok` 分支加 `migratedFrom: 1 | null`。
  2. `load()` 里：
     - 判 `too_new` 的条件从 `version > 1` 改成 `version > PROVIDERS_FILE_VERSION`；
     - 判完之后、`safeParse` 之前，调用 `upgradeProvidersObject(parsed)`，用返回的 `value` 去校验；
     - `fromVersion === 1` 时 `migratedFrom: 1`，否则为 `null`。
  3. 签名改成：

     ```ts
     export function createProvidersStore(
       filePath: string,
       options?: { onMigrated?: (backup: boolean) => void },
     ): ProvidersStore;
     ```

     `ProvidersStore` 加 `subscribe(listener: (state: ProvidersState) => void): () => void`。原来构造参数里的 `onRevisionChange`，改为对所有订阅者逐个调用；订阅者抛异常时，捕获它并继续通知下一个。
  4. `write(file)`：如果最近一次 `load()` 的状态是 `ok`，并且 `migratedFrom === 1`，写新文件之前：
     - 先把磁盘上当前的文件按字节复制到 `<filePath>.bak`：`copyFileSync`，然后 `chmodSync(…, 0o600)`。`.bak` 已存在时覆盖。
     - 复制成功后调用 `options.onMigrated?.(true)`；复制失败时调用 `onMigrated(false)` 并抛出原错误，**不写新文件**。不能在没有备份的情况下覆盖用户的版本 1 文件。
     - 写入前用 `ProvidersFileSchema.parse(file)` 校验一次（[packages/core/AGENTS.md §2](../packages/core/AGENTS.md#2-契约与错误)：读的时候校验什么，写的时候就校验什么）。
- [x] 4a. **把 key 和 id 的规则也搬进 `providers/`。** 出图服务的 key 规则和 id 格式照搬模型服务（[插图与出图服务 §2](../docs/image.md#2-出图服务的配置)），`image` 模块不能导入 `llm` 的内部文件。
  - `llm/keys.ts`（`envVarOf`、`resolveApiKey`、`keyStatus`）原样移成 `providers/keys.ts`。
  - `llm/endpoint-id.ts`（`endpointSlug`、`newEndpointId`）移成 `providers/ids.ts`，再加一个函数：

    ```ts
    export function newImageServiceId(name: string, requestId: string): string {
      return newEndpointId(name, requestId).replace(/^custom-/u, 'image-');
    }
    ```

    先核对 `newEndpointId` 返回的确实以 `custom-` 开头（`rg -n "custom-" packages/core/src/llm/endpoint-id.ts`），不是时停下来汇报。
  - 两个测试文件一起移。导入方用 `rg -n "from '\./(keys|endpoint-id)\.ts'" packages/core/src/llm` 找，改成从 `../providers/` 导入。
- [x] 5. **`services.ts`。** `CoreDeps` 加 `providers?: ProvidersStore;`，从 `./providers/file.ts` 导入类型。
  - **为什么可选：** 现有的几十个测试直接手写 `CoreDeps`。可选字段让它们不用改。
  - 生产装配必须传。由第 7 步和 T29 的判据守住。
- [x] 6. **`llm/service.ts`。**
  1. 把 `createProvidersStore(join(deps.dataDir, 'providers.json'), (state) => { … })` 改成：

     ```ts
     const store = deps.providers ?? createProvidersStore(join(deps.dataDir, 'providers.json'));
     store.subscribe((state) => { … });
     ```

     回调里的代码不变，仍然是 `llm.config.loaded` 事件和 `llm.config_changed` 发布。
  2. `view()`、`resolvedFor()` 等用到 `state.file` 的地方不用改：版本 2 的文件只是多了两个字段。
  3. `ProvidersState` 的 `ok` 分支多了 `migratedFrom`，按需补上类型。
  4. 其余文件里的 `from './providers-schema.ts'`、`from './providers-file.ts'` 改成 `from '../providers/schema.ts'`、`from '../providers/file.ts'`。
- [x] 7. **`app.ts`。** 在 `const bus = createEventBus();` 之后：

  ```ts
  const providers = createProvidersStore(join(options.dataDir, 'providers.json'), {
    onMigrated: (backup) =>
      logger.record({ level: 'info', module: 'providers', event: 'providers.migrated', data: { from: 1, to: 2, backup } }),
  });
  ```

  把 `providers` 放进 `deps` 对象。
- [x] 8. **测试。** 把 `llm/providers-file.test.ts` 移成 `providers/file.test.ts`，原有用例保留，按版本 2 调整期望。再加：
  - **版本 1 读取：** 写一个版本 1 的文件，里面有一个自定义端点和一个用途分配。`load()` 得 `ok`、`migratedFrom: 1`，`file.imageServices` 为 `[]`，`file.image.service` 为 `null`，端点原样保留。断言磁盘上的文件字节没变：读文件前后各取一次 `sha256`，两者相等。
  - **第一次写入时备份：** 接上一条，调用 `write(新文件)`：
    - `.bak` 的字节等于原版本 1 文件；
    - `.bak` 的权限是 `0o600`（`statSync(...).mode & 0o777`）；
    - 新文件的 `version` 是 2；
    - `onMigrated` 被调用一次，参数为 `true`。
  - **只备份一次：** 再 `write` 一次，`.bak` 的内容不变（仍是版本 1 原文），`onMigrated` 仍只调用过一次。
  - **备份失败时不写：** 让 `.bak` 的路径是一个已存在的**目录**，复制会失败。`write` 抛错，原文件字节不变。
  - **太新：** `version: 3` 得 `too_new`，`problem.version === 3`。
  - **保留未知字段：** 版本 2 的文件里 `imageServices[0]` 带一个未知字段 `"x-note": "keep"`，`load` 后再 `write`，新文件里仍有它（`looseObject`）。
  - **共用订阅：** 同一个 store 上 `subscribe` 两个监听者，外部改写文件后 `load()`，两个都被调用一次；第一个监听者抛异常时，第二个仍被调用。

  `providers/migrate.test.ts`：三种 `fromVersion` 各一条；传入对象没有被修改（`structuredClone` 一份，调用后 `toEqual` 原样）。

**接线点。**

| 位置 | 改成 |
| --- | --- |
| `app.ts` 的 `deps` | 带上共用的 `providers` |
| `llm/service.ts` 里的存储 | `deps.providers ?? createProvidersStore(...)` |
| T06 的 `image/service.ts` | 同样用 `deps.providers ?? …`，由 T06 写 |

**注意事项。**

- `.bak` 也以 `providers.json` 开头，已被 `.gitignore` 忽略（[根目录 AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律)），不用改。
- 现有的 `llm` 测试读到的配置文件，按测试自己写的 `version` 走。写着 `version: 1` 的测试读取仍然正常（迁移在内存里），不用改。
- 不要在 `load()` 里写盘：只有界面上的保存才升级文件（D2）。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 第 8 步的用例全绿 | 删掉 `write` 里的备份逻辑：「第一次写入时备份」变红 |
| 同上 | 把备份条件从 `migratedFrom === 1` 改成恒真：「只备份一次」里 `.bak` 内容变成版本 2，变红 |
| 同上 | 把 `too_new` 的条件改回 `version > 1`：「版本 1 读取」变红 |
| `rg -n "providers-file\|providers-schema" packages/core/src` 零命中 | — |
| `pnpm --filter @unwritten/core test` 全绿（`llm` 原有测试照常通过） | — |
| `rg -n "createProvidersStore\(" packages/core/src/app.ts` 命中 1 处 | — |

---

### T05 core：库表与迁移

**目的。** 一次加齐本里程碑全部的列和表，并生成迁移：

- 插图记录；
- 人物参考组；
- 出图调用记录；
- 作者画风；
- 本局插图设置；
- 回合的插图标记；
- 应用的插图设置。

同时为 JSON 列定死 Zod schema（读写都用它）。

**依赖。** T02（`IllustrationStyleSchema`、`OutputPreferencesSchema`、`AutoIllustrationTargetSchema`、`ImageQualitySchema` 等）。

**拥有的文件。**

- 改：`packages/core/src/store/schema.ts`。
- 生成：`packages/core/src/store/migrations/<drizzle-kit 生成的新目录>/`。
- 新建：`packages/core/src/store/illustration-types.ts`、`packages/core/src/store/illustration-types.test.ts`、`packages/core/src/store/migration-m4.test.ts`。

**先读。**

- [插图与出图服务 §9.2](../docs/image.md#92-表)（两张表的 SQL 和下面的说明）、§11（`image_calls`）；
- [数据模型 §2](../docs/data-model.md#2-作品与版本)（`works.illustration_style`）、§3（`playthroughs.illustration`、`turns.illustrate_para`，以及「从没有插图设置的库迁移时」那一段）；
- 现有的 `store/schema.ts` 全文；
- 一个现有迁移目录的结构：`ls packages/core/src/store/migrations/*`。

**步骤。**

- [x] 1. **核对前提。**
  - `rg -n "illustration|portrait|image_calls" packages/core/src/store/schema.ts` 零命中。
  - `ls packages/core/src/store/migrations` 列出现有迁移目录，记下最新的一个。
  - `pnpm --filter @unwritten/core exec drizzle-kit --version` 能运行。
- [x] 2. **`store/illustration-types.ts`。** 照抄下面的定义，每个都导出 schema 和类型：

  ```ts
  import { z } from 'zod';
  import {
    AppearanceTextSchema,
    AspectSchema,
    AutoIllustrationTargetSchema,
    ErrorCodeSchema,
    IllustrationFormatSchema,
    IllustrationStageSchema,
    IllustrationStyleSchema,
    ImageQualitySchema,
    OutputPreferencesSchema,
    PortraitSlotSchema,
    UuidSchema,
  } from '@unwritten/contracts';

  export const ImageFileRefSchema = z.object({
    hash: z.string().regex(/^[0-9a-f]{64}$/u),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
  });

  export const PlaythroughIllustrationSchema = z.object({
    enabled: z.boolean(),
    style: IllustrationStyleSchema,
    aspectPreference: OutputPreferencesSchema.shape.aspectPreference,
    resolutionTier: OutputPreferencesSchema.shape.resolutionTier,
    protagonistInFrame: z.boolean(),
    protagonistAppearance: AppearanceTextSchema.nullable(),
    authorPortraitSetIds: z.record(z.string(), UuidSchema),
    protagonistPortraitSetId: UuidSchema.nullable(),
  });

  export const TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION = {
    enabled: false,
    style: { kind: 'preset', preset: 'painterly' },
    aspectPreference: 'auto',
    resolutionTier: '1k',
    protagonistInFrame: false,
    protagonistAppearance: null,
    authorPortraitSetIds: {},
    protagonistPortraitSetId: null,
  } as const;

  export const IllustrationSettingsSchema = z.object({
    autoEnabled: z.boolean(),
    confirmed: AutoIllustrationTargetSchema.nullable(),
    defaults: OutputPreferencesSchema,
  });
  export const DEFAULT_ILLUSTRATION_SETTINGS = {
    autoEnabled: false,
    confirmed: null,
    defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
  } as const;

  export const ShotCapabilitySchema = z.object({
    aspects: z.array(AspectSchema),
    maxReferences: z.number().int().nonnegative(),
    negativePrompt: z.boolean(),
  });
  export const ShotRefSchema = z.object({ entityId: z.string().min(1), view: PortraitSlotSchema });
  export const ReferenceFileSchema = z.object({
    setId: UuidSchema,
    slot: PortraitSlotSchema,
    file: ImageFileRefSchema,
  });
  export const ShotRecordSchema = z.object({
    prompt: z.string().min(1),
    negativePrompt: z.string().nullable(),
    caption: z.string().min(1),
    refs: z.array(ShotRefSchema),
    capability: ShotCapabilitySchema,
  });

  export const AttemptDataSchema = z.object({
    attemptId: UuidSchema,
    kind: z.enum(['first', 'retry', 'reroll']),
    formatOverride: OutputPreferencesSchema.nullable(),
    format: IllustrationFormatSchema.nullable(),
    shot: ShotRecordSchema.nullable(),
    referenceFiles: z.array(ReferenceFileSchema).nullable(),
    seed: z.number().int().nonnegative().nullable(),
    serviceId: z.string().nullable(),
    completed: z.array(IllustrationStageSchema),
  });

  export const PortraitSlotStoredSchema = z.object({
    file: ImageFileRefSchema.nullable(),
    source: z.enum(['import', 'generate']).nullable(),
    needsReview: z.boolean(),
  });
  export const PortraitSlotsStoredSchema = z.object({
    front: PortraitSlotStoredSchema,
    three_quarter: PortraitSlotStoredSchema,
    full_body: PortraitSlotStoredSchema,
  });
  export const EMPTY_PORTRAIT_SLOTS = {
    front: { file: null, source: null, needsReview: false },
    three_quarter: { file: null, source: null, needsReview: false },
    full_body: { file: null, source: null, needsReview: false },
  } as const;

  export const PortraitTaskSchema = z.object({
    attemptId: UuidSchema,
    status: z.enum(['running', 'failed']),
    error: ErrorCodeSchema.nullable(),
    format: IllustrationFormatSchema.nullable(),
    quality: ImageQualitySchema,
    inputFiles: z.array(ImageFileRefSchema),
    appearanceHash: z.string().nullable().default(null),
  });
  export const PortraitTasksSchema = z.object({
    front: PortraitTaskSchema.nullable(),
    three_quarter: PortraitTaskSchema.nullable(),
    full_body: PortraitTaskSchema.nullable(),
  });
  export const EMPTY_PORTRAIT_TASKS = { front: null, three_quarter: null, full_body: null } as const;
  ```

  - `PortraitTaskSchema.inputFiles` 记生成这个位置时用作参考的文件（补齐视角时是正面）。`appearanceHash` 记登记时的形象哈希。两个字段供 T17 在提交前核对生成输入是否过期。清理时把文件算作「已登记的任务输入」（[插图与出图服务 §9.4](../docs/image.md#94-清理)）。
  - `TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION`、`DEFAULT_ILLUSTRATION_SETTINGS` 必须能通过各自的 schema，第 6 步测试这一点。
- [x] 3. **`store/schema.ts` 加列。**
  - `works` 加 `illustrationStyle: text('illustration_style', { mode: 'json' }).$type<IllustrationStyle>()`（可空）。
  - `playthroughs` 加：

    ```ts
    illustration: text('illustration', { mode: 'json' })
      .$type<PlaythroughIllustration>()
      .notNull()
      .default(sql`'{"enabled":false,"style":{"kind":"preset","preset":"painterly"},"aspectPreference":"auto","resolutionTier":"1k","protagonistInFrame":false,"protagonistAppearance":null,"authorPortraitSetIds":{},"protagonistPortraitSetId":null}'`),
    ```

    默认值是 `TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION` 的 JSON，键的顺序一致。它就是[数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)写的迁移默认值：已有开局设为纯文字、作品默认画风、自动比例和 1K、主角不入画、参考为空。现有作品都还没有 `illustration_style`，所以「作品默认画风」就是 `painterly`。
  - `turns` 加 `illustratePara: integer('illustrate_para')`（可空）。
  - `entities` 加 `sourcePara: integer('source_para')`（可空）。旧记录保持 `null`；写入出处由 T12 负责。
  - `appSettings` 加：

    ```ts
    illustration: text('illustration', { mode: 'json' })
      .$type<IllustrationSettings>()
      .notNull()
      .default(sql`'{"autoEnabled":false,"confirmed":null,"defaults":{"aspectPreference":"auto","resolutionTier":"1k"}}'`),
    ```
- [x] 4. **`store/schema.ts` 加三张表。** 列名、可空性、外键、CHECK 照 [插图与出图服务 §9.2](../docs/image.md#92-表) 和 §11 的 SQL 逐列翻成 Drizzle。

  **`illustrations`：**
  - 列：`id`、`turnId`（唯一，引用 `turns.id`，`onDelete: 'cascade'`）、`playthroughId`（引用 `playthroughs.id`，级联删除）、`para`、`formatPreference`（json，非空）、`format`（json）、`status`、`stage`、`caption`、`prompt`、`negativePrompt`、`shotCapability`（json）、`refs`（json）、`referenceFiles`（json）、`seed`、`serviceId`、`model`、`file`（json）、`error`、`attempts`（非空，默认 0）、`activeAttemptId`、`attemptData`（json）、`createdAt`、`updatedAt`。
  - `status` 用 `text('status', { enum: ILLUSTRATION_STATUSES })`，`stage` 用 `text('stage', { enum: ILLUSTRATION_STAGES })`。
  - `formatPreference` 的 `$type` 是 `OutputPreferences`；`format` 的 `$type` 是 `IllustrationFormat`。其余 JSON 列的 `$type` 用第 2 步的类型。
  - 索引：
    - `index('illustrations_queue_idx').on(table.status, table.createdAt)`：工作循环按它取队首；
    - `index('illustrations_playthrough_idx').on(table.playthroughId)`。

  **`portraitSets`：**
  - 列：`id`、`workId`（引用 `works.id`，级联删除）、`scope`、`playthroughId`（引用 `playthroughs.id`，级联删除，可空）、`entityId`、`appearanceFactId`、`appearanceHash`、`appearance`、`style`（json，非空）、`state`、`draftRev`（非空，默认 0）、`slots`（json，非空）、`task`（json）、`createdAt`、`updatedAt`。
  - 两个 `check`，SQL 照 §9.2 原文：
    - `portrait_sets_state` 管 `state` 的取值；
    - `portrait_sets_scope` 管三种 `scope` 各自的列约束。
  - 索引：
    - `uniqueIndex('portrait_sets_active_work').on(table.workId, table.entityId, table.appearanceHash).where(sql\`scope = 'work' and state = 'active'\`)`；
    - `uniqueIndex('portrait_sets_playthrough_identity')`，列是 `(playthrough_id, entity_id, ifnull(appearance_fact_id, ''))`，条件 `scope = 'playthrough'`。Drizzle 的 `.on()` 不接受表达式时，见第 5 步的退路。
    - 另加普通索引 `index('portrait_sets_work_idx').on(table.workId, table.scope)`。

  **`imageCalls`：** 照 §11 的 SQL。另加 `index('image_calls_created_idx').on(table.createdAt)`，`created_at` 非空。
- [x] 5. **生成迁移。** `pnpm --filter @unwritten/core db:generate`。
  - 生成后打开新目录的 `migration.sql`，逐条核对：
    1. 核对第 3 步的五列。两个 JSON 默认值需逐字对应第 3 步；`works.illustration_style`、`turns.illustrate_para`、`entities.source_para` 都可空；
    2. 两个 CHECK 都在；
    3. `illustrations.turn_id` 有无条件唯一约束，两个参考组唯一索引各带第 4 步的 `WHERE`。
  - **退路：** 如果 Drizzle 生成不了 `ifnull(...)` 那个表达式索引：
    1. 先从 schema 里去掉它，生成一次；
    2. 再运行 `pnpm --filter @unwritten/core exec drizzle-kit generate --custom --name portrait_identity_index`，在生成的空迁移里手写 `CREATE UNIQUE INDEX portrait_sets_playthrough_identity ON portrait_sets (playthrough_id, entity_id, ifnull(appearance_fact_id, '')) WHERE scope = 'playthrough';`。

    这是唯一允许手写的迁移内容，写进汇报。
  - **不要手改**生成的 `snapshot.json`。
- [x] 6. **测试。**

  `store/illustration-types.test.ts`：
  - `TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION`、`DEFAULT_ILLUSTRATION_SETTINGS`、`EMPTY_PORTRAIT_SLOTS`、`EMPTY_PORTRAIT_TASKS` 各自通过 schema。
  - 把 schema.ts 里两段 `.default(sql\`'…'\`)` 的 JSON 文本 `JSON.parse` 出来，分别和这两个常量 `toEqual`。这条防止默认值和常量漂移。做法：用 `readFileSync` 读 `schema.ts`，正则提取。
  - `ImageFileRefSchema` 拒收大写十六进制的哈希、63 个字符的哈希。

  `store/migration-m4.test.ts`：
  1. 用上一个迁移之前的状态建库：用 `drizzle-orm/node-sqlite/migrator` 的 `migrate`，`migrationsFolder` 指向一个临时目录，里面只复制到上一个迁移为止。
  2. 插入一个作品、版本、开局、回合和一个 `origin_turn_id` 指向该回合的旧人物（照 `test-support/story-fixtures.ts` 的 `seedStory` 所需字段），再插入一行 `app_settings`。
  3. 再跑完整迁移。
  4. 断言：
     - 开局的 `illustration` 解析后等于 `TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION`；
     - 回合的 `illustrate_para` 和旧人物的 `source_para` 均为 `null`，旧人物仍保有原 `origin_turn_id`；
     - `app_settings.illustration` 等于 `DEFAULT_ILLUSTRATION_SETTINGS`；
     - 三张新表存在：`SELECT name FROM sqlite_master WHERE type = 'table'`。
  5. 再插两行 `scope = 'work'`、`state = 'active'`、`work_id`、`entity_id`、`appearance_hash` 都相同的参考组，第二行抛 `UNIQUE constraint failed`。
  6. 插一行 `scope = 'playthrough'` 但 `playthrough_id` 为空的参考组，抛 `CHECK constraint failed`。

**接线点。** T12 写入、投影 `entities.sourcePara`，T14 消费该字段。其他读写这些表的任务是 T06、T11、T13、T15、T17、T18、T19。

**注意事项。**

- **不改 `story/types.ts`。** 实体档案的 `appearance` 字段在 JSON 里，不需要迁移，由 T12 改 schema。
- `illustrations.turn_id` 是唯一的：一个回合最多一张插图（§9.2）。
- 不要给 `illustrations` 加 `route_id` 列。插图属于回合，路线可见性由回合的祖先链决定。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `migration-m4.test.ts` 绿 | 把 `playthroughs.illustration` 默认值里的 `"enabled":false` 改成 `true` 并重新生成迁移：迁移测试和 `illustration-types.test.ts` 的漂移断言都变红。改回后再生成一次，确认迁移目录里只剩一个新迁移 |
| 同上 | 把 `portrait_sets_active_work` 的 `.where(...)` 删掉并重新生成：两行 active 冲突的断言照样红（同一个 hash），但再插一行 `state = 'retired'` 的同 hash 组也会冲突。在测试里补这一条：`retired` 的同 hash 组可以插入 |
| 旧人物仍无登记段号 | 临时把新列的迁移默认值改成 `1`：旧人物的 `source_para` 断言变红 |
| `illustration-types.test.ts` 绿 | 改 `DEFAULT_ILLUSTRATION_SETTINGS.defaults.resolutionTier` 为 `'2k'`：漂移断言变红 |
| `pnpm --filter @unwritten/core test` 全绿（`store/db.test.ts` 等现有测试照常） | — |

---

### T08 core：Unwritten 图像协议客户端、伪服务、一致性测试

**目的。** 实现 core 一侧的 `unwritten-image/1`：

- 读 `/v1/info` 并校验能力；
- 提交任务、查询、取图、取消；
- 把协议错误映射成 core 的错误码。

同时提供两样东西，供 T11、T26、T30 共用：

- 一个伪服务，所有测试都用它；
- 一组一致性测试，能对着任何 URL 运行（[插图与出图服务 §3](../docs/image.md#3-unwritten-图像协议)、[插件 §3](../docs/plugins.md#3-协议的共同规则)）。

**依赖。** T01（`createNetFetch`）、T02（类型）、T07（`validateImageBytes`、测试夹具）。

**拥有的文件。** 新建：

- `packages/core/src/image/info.ts`、`packages/core/src/image/info.test.ts`；
- `packages/core/src/image/unwritten-client.ts`、`packages/core/src/image/unwritten-client.test.ts`；
- `packages/core/src/test-support/fake-image-server.ts`；
- `packages/core/src/image/conformance/unwritten-image.conformance.test.ts`。

**先读。**

- [插图与出图服务 §3](../docs/image.md#3-unwritten-图像协议) 全部小节、§5.1 的「自动重试最多一次」「自家协议的单个任务」两条、§5.3；
- [插件 §3](../docs/plugins.md#3-协议的共同规则)；
- `packages/core/src/test-support/fake-openai-server.ts`：伪服务的写法照它，用 `node:http`，记录收到的请求，`close()` 时销毁所有连接。

**步骤。**

- [x] 1. **核对前提。** T01、T07 已合入：`ls packages/core/src/net/fetch.ts packages/core/src/image/validate.ts` 都存在。
- [x] 2. **错误类型。** 用 T07 提供的 `image/errors.ts`（`ImageError`、`ImageErrorKind`），不要另写。
- [x] 3. **`image/info.ts`。** 导出：

  ```ts
  export const SERVICE_INFO_PROTOCOL = 'unwritten-image/1';
  export const NOT_READY_REASONS = ['starting', 'out_of_memory', 'workflow_error'] as const;
  export interface ServiceInfo {
    implementation: { name: string; version: string };
    model: string | null;
    ready: boolean;
    notReadyReason: string | null;
    capabilities: ImageCapabilities;
  }
  export function parseServiceInfo(raw: unknown): { ok: true; info: ServiceInfo } | { ok: false; issue: string };
  ```

  **规则（[插图与出图服务 §3.2](../docs/image.md#32-get-v1info)）：**
  - 必填字段：
    - `protocol` 必须等于 `'unwritten-image/1'`；
    - `implementation.name`、`implementation.version` 是字符串；
    - `ready` 是布尔；
    - `notReadyReason` 是字符串或 null；
    - `capabilities` 是对象。
  - 能力必须满足：
    - `maxReferences` 是非负整数；
    - `maxReferenceBytes`、`maxPromptLength` 是正整数；
    - `seed`、`negativePrompt` 是布尔；
    - `qualities` 非空，并且包含 `best`；
    - `aspects` 非空、不重复，并且包含 `3:2` 和 `3:4`；
    - 每个比例的两个数互质（写一个 `gcd` 函数）。
  - `resolutions` 可省略。有它时：
    - 键必须是 `aspects` 里的比例；
    - 每个比例下只认识 `720`、`1k`、`2k` 三个键，其余键忽略（只增不改）；
    - 认识的档位，短边和目标 720、1024、2048 的差不超过 16；
    - 宽高比和该比例的相对误差不超过 `IMAGE_ASPECT_TOLERANCE`（用 T07 的 `aspectMatches`）；
    - 像素数不超过 `IMAGE_MAX_PIXELS`；
    - 同一个比例下，档位的总像素随 `720`、`1k`、`2k` 严格递增。
  - 不认识的顶层字段和能力字段一律忽略。
  - `model` 缺省时为 null。
  - 返回的 `capabilities` 里 `resolutions` 缺省为 `{}`。
  - 不合格时 `issue` 写**一句英文**，说明哪个字段不合格，只给测试和诊断用，不显示给用户。
- [x] 4. **`image/unwritten-client.ts`。** 导出：

  ```ts
  export interface UnwrittenJobRequest {
    idempotencyKey: string;
    prompt: string;
    negativePrompt: string | null;
    references: Array<{ mime: string; bytes: Uint8Array }>;
    aspect: string;
    size: { width: number; height: number } | null;
    quality: 'fast' | 'best';
    seed: number | null;
  }
  export interface UnwrittenJobResult {
    bytes: Uint8Array;
    seed: number | null;
    width: number | null;
    height: number | null;
  }
  export interface UnwrittenImageClient {
    info(signal: AbortSignal): Promise<ServiceInfo>;
    run(request: UnwrittenJobRequest, options: { signal: AbortSignal; pollIntervalMs: number; jobTimeoutMs: number; beforeSubmit?: () => void }): Promise<UnwrittenJobResult>;
  }
  export function createUnwrittenImageClient(options: {
    baseUrl: string;
    token: string | undefined;
    fetch?: typeof fetch;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  }): UnwrittenImageClient;
  ```

  - `fetch` 默认 `createNetFetch()`。`sleep` 默认用 `node:timers/promises` 的 `setTimeout(ms, undefined, { signal })`，测试里换成假的。
  - 每个请求都带 `authorization: Bearer <token>`。`token` 为空时不带这个头。
  - **`info`：**
    1. `GET {baseUrl}/v1/info`；
    2. 先按 §3.6 处理错误状态；
    3. 200 时解析 JSON，交给 `parseServiceInfo`；
    4. 不合格抛 `new ImageError('image_invalid_response', 'final')`。
  - **`run`，按顺序：**
    1. **提交：** 每次 `POST {baseUrl}/v1/jobs`（包括网络重发、队列满后重发）前调用 `beforeSubmit?.()`。它抛出的 `AbortError` 直接退出，不进入网络重试。查询、取图及中断时的清理不走该回调。请求体为：

       ```json
       {
         "idempotencyKey": "…",
         "prompt": "…",
         "references": [{ "mime": "…", "data": "<base64>" }],
         "aspect": "…",
         "quality": "…"
       }
       ```

       另外三个字段按条件带：`size` 不为空时带；`seed` 不为空时带；`negativePrompt` 不为空时带。是否发送 `size`、`seed`、`negativePrompt` 由调用方（T11）按能力决定，这里只是不为空就发。
       - 网络错误（`fetch` 抛出、不是 `AbortError`）时，用**同一个请求体和同一个幂等键**再发一次。再失败抛 `image_offline`，`kind: 'transport'`。
       - 收到 429 `busy` 时，按 `Retry-After` 秒数等待（缺省 5 秒，最多 60 秒），用同一个请求体再发一次；还是 429 时抛 `image_busy`。
    2. **轮询：** 拿到 `id` 后，每隔 `pollIntervalMs` 发 `GET {baseUrl}/v1/jobs/{id}`，直到 `status` 是 `done`、`failed` 或 `cancelled`。
       - 从提交开始超过 `jobTimeoutMs` 时，发一次 `DELETE`（忽略它的结果），抛 `image_timeout`。
       - `failed` 时按 §3.6 的任务错误码映射：

         | 任务错误码 | 映射成 |
         | --- | --- |
         | `out_of_memory` | `image_out_of_memory` |
         | `workflow_error` | `image_workflow_error` |
         | `refused` | `image_refused` |
         | `interrupted` | `image_interrupted` |
         | `internal` 和其他值 | `image_server` |

       - `cancelled` 抛 `image_interrupted`。
       - 收到 404 抛 `image_interrupted`。
    3. **取图：** `GET {baseUrl}/v1/jobs/{id}/image`。读响应体时累计字节数，超过 `IMAGE_MAX_BYTES` 就取消读取并抛 `image_invalid_response`（用 `response.body.getReader()` 逐块读，不用 `arrayBuffer()`）。
    4. **释放：** `DELETE {baseUrl}/v1/jobs/{id}`。失败时忽略。
    5. 返回字节，以及状态里的 `seed`、`width`、`height`（缺省为 null）。**这里不校验图片**，由 T11 统一调用 `validateImageBytes`。
  - **`signal` 中止时：** 已经拿到任务 id 就发一次 `DELETE`（不带这个 signal，独立的 5 秒超时），然后抛出 `AbortError`。
  - **HTTP 错误的统一映射**（[插图与出图服务 §3.6](../docs/image.md#36-错误码)）。先读 `{ error: { code } }`，读不到时按状态码：

    | 情况 | 抛出 |
    | --- | --- |
    | `RedirectBlockedError` | `image_redirected`，`final` |
    | 401 或 `unauthorized` | `image_unauthorized`，`final` |
    | `too_many_references`、`reference_too_large` | `image_invalid_request`，`capability` |
    | `unsupported_aspect`、`unsupported_size`、`unsupported_quality` | `image_output_format_unavailable`，`format` |
    | `invalid_request`、`idempotency_conflict`、其他 400 | `image_invalid_request`，`final` |
    | `not_ready`、503 | `image_not_ready`，`final` |
    | 5xx | `image_server`，`final` |
    | 200 但 JSON 不合格 | `image_invalid_response`，`final` |
- [x] 5. **`test-support/fake-image-server.ts`。** 导出：

  ```ts
  export interface FakeImageServerOptions {
    token?: string;
    capabilities?: Partial<ImageCapabilities>;
    output?: 'tiny-webp' | 'png';
    jobDelayMs?: number;
    implementation?: { name: string; version: string };
  }
  export interface FakeImageRequest {
    method: string;
    path: string;
    authorization: string | null;
    body: unknown;
  }
  export interface FakeImageServer {
    url: string;
    token: string;
    requests: FakeImageRequest[];
    setReady(ready: boolean, reason?: string | null): void;
    holdNextJob(): () => void;
    failNextJob(code: 'out_of_memory' | 'workflow_error' | 'refused' | 'interrupted' | 'internal'): void;
    respondNext(status: number, body: unknown, headers?: Record<string, string>): void;
    setCapabilities(capabilities: Partial<ImageCapabilities>): void;
    close(): Promise<void>;
  }
  export function startFakeImageServer(options?: FakeImageServerOptions): Promise<FakeImageServer>;
  ```

  - **默认值：**
    - 令牌：`'fake-image-token-0123456789abcdef0123456789'`（不少于 32 个字符）；
    - 能力：`maxReferences: 4`、`maxReferenceBytes: 8 MiB`、`maxPromptLength: 4000`、`seed: true`、`negativePrompt: false`、`qualities: ['fast', 'best']`、`aspects: ['1:1', '3:2', '2:3', '3:4', '4:3']`；
    - `resolutions`：照 [插图与出图服务 §3.2](../docs/image.md#32-get-v1info) 示例里的 `1:1`、`3:2`、`3:4` 三项，另加 `2:3`、`4:3` 两项，取前三项的转置；
    - `output: 'png'`，`jobDelayMs: 20`；
    - `implementation`：`{ name: 'Fake', version: '0.0.0' }`。
  - **实现协议的全部接口：**
    - 缺令牌或令牌错：401，`{ error: { code: 'unauthorized', message } }`。
    - `POST /v1/jobs`：
      - 校验必填字段和各项上限，按 §3.6 返回对应的错误码；
      - `size` 不在 `resolutions[aspect]` 的取值里时返回 400 `unsupported_size`；
      - 按幂等键记住请求体：同一个键、同一个请求体返回同一个 id；同一个键、不同请求体返回 409 `idempotency_conflict`。
    - 任务在 `jobDelayMs` 后完成。`holdNextJob` 让下一个成功登记的任务保持运行，返回的释放函数解除阻塞。被取消的任务在释放后仍保持取消；需要模拟迟到的测试用可控图片响应阻塞客户端收到字节。用例结束前调用释放函数，`close` 销毁残余连接。
    - **取图返回的图片尺寸：**
      - `output: 'png'`：返回 `pngBytes(宽, 高)`，宽高取请求的 `size`；没有 `size` 时取该比例 `1k` 的尺寸；也没有时用 `1024×1024`。
      - `output: 'tiny-webp'`：返回 `TINY_WEBP`。
    - 未就绪时，`/v1/info` 照常返回 `ready: false`，`POST /v1/jobs` 返回 503 `not_ready`。
    - `DELETE` 之后，取图返回 404 `not_found`。
    - 响应**不带任何 `access-control-*` 头**。
  - 记录每个请求：方法、路径、`authorization` 头、解析后的 JSON 请求体。参考图的 `data` 也原样记下，测试要断言参考图的顺序。
- [x] 6. **一致性测试的目标选择。** 用 T07 提供的 `image/conformance/target.ts`（`conformanceTarget`），不要另写。
- [x] 7. **`image/conformance/unwritten-image.conformance.test.ts`。** 对 `conformanceTarget('UNWRITTEN_IMAGE', startFakeImageServer)` 逐条测下面这些。用裸 `fetch`（`createNetFetch()`），不用第 4 步的客户端：一致性测试要能看出协议本身的问题，不能被客户端的容错盖住。

  | 用例 | 断言 |
  | --- | --- |
  | 不带令牌请求 `/v1/info` | 401，响应体 `error.code === 'unauthorized'` |
  | 带错的令牌 | 401 |
  | 带正确令牌请求 `/v1/info` | 200，`parseServiceInfo` 返回 `ok`；响应没有 `access-control-allow-origin` 头 |
  | 响应都不是重定向 | 本测试里收到的所有响应，状态码都不在 301、302、303、307、308 里（用 `redirect: 'manual'`） |
  | `POST /v1/jobs` 缺 `prompt` | 400，`invalid_request` |
  | 参考图张数是 `maxReferences + 1` | 400，`too_many_references` |
  | 一张参考图解码后比 `maxReferenceBytes` 大 1 字节 | 413，`reference_too_large`。`maxReferenceBytes` 很大时（大于 16 MiB），跳过这一条并注明 |
  | `aspect` 是 `'7:5'`（不在列表里） | 400，`unsupported_aspect` |
  | 同一个幂等键、同一个请求体提交两次 | 两次的 `id` 相同 |
  | 同一个幂等键、不同的 `prompt` | 409，`idempotency_conflict` |
  | 一个正常任务：`quality` 取 `qualities` 里的第一项；有 `resolutions` 时取像素最少的那一档的尺寸，否则不带 `size` | 轮询到 `done`；取到的字节用 `validateImageBytes(bytes, { rejectMetadata: true })` 校验为 `ok`；带了 `size` 时宽高与之相等；`seed` 能力为 true 时状态里有整数 `seed` |
  | 上一条的任务 `DELETE` 后再取图 | 404，`not_found` |
  | 每个错误响应 | 形状是 `{ error: { code: string, message: string } }` |

  文件开头用 `describe.skipIf` 之外的普通 `describe`，不跳过任何用例。`real` 为 true 时把超时放宽到 300 秒，因为真的插件要画图。
- [x] 8. **`unwritten-client.test.ts`。** 对伪服务测：
  - `info` 解析能力；
  - `run` 的正常路径：伪服务记录到的请求依次是 `POST /v1/jobs`、若干 `GET /v1/jobs/<id>`、`GET …/image`、`DELETE …`；
  - `size`、`seed`、`negativePrompt` 为 null 时，请求体里没有这些键；
  - 提交时第一次 `respondNext` 一个连接错误：模拟办法是先 `close` 再起一个，或用注入的 `fetch` 第一次抛 `TypeError('fetch failed')`。断言第二次提交的请求体与第一次逐字节相同，幂等键相同；
  - 429 带 `Retry-After: 1`：注入的 `sleep` 被调用，参数为 1000；
  - `failNextJob('out_of_memory')`：抛 `ImageError`，`code === 'image_out_of_memory'`；
  - 超过 `jobTimeoutMs`：抛 `image_timeout`，伪服务收到了 `DELETE`；
  - 取图时响应体超过 `IMAGE_MAX_BYTES`：用 `respondNext` 返回一个流式响应，持续写到超过上限。抛 `image_invalid_response`，并且读取在超过上限后停止：记录服务端实际写出的字节数，不到上限的两倍；
  - 302：抛 `image_redirected`；
  - `signal` 中止：伪服务收到 `DELETE`，`run` 以 `AbortError` 结束。

  `info.test.ts`：`parseServiceInfo` 的每一条规则各一个反例（缺 `3:4`、比例不互质、重复比例、`1k` 的短边是 1100、档位像素不递增、`protocol` 是 `unwritten-image/2`），另加一个只报告 `aspects`、没有 `resolutions` 的老服务，解析为 `ok`，`resolutions` 为 `{}`。

**接线点。** T11 的 `engine.ts` 调用 `createUnwrittenImageClient`。T26 和 `pnpm test:python` 对着真插件跑第 7 步。

**注意事项。**

- base64 用 `Buffer.from(bytes).toString('base64')`，不要手写。
- 不要在客户端里缓存能力；缓存由 T11 管。
- 一致性测试是协议的守卫：不要为了让真插件通过去放宽断言。真插件不通过时停下来汇报（[插件 §3.6](../docs/plugins.md#36-一致性测试)：插件能不能接入，只看能不能通过这组测试）。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 一致性测试对伪服务全绿 | 让伪服务对 `/v1/info` 加一个 `access-control-allow-origin: *` 头：「响应没有 CORS 头」变红 |
| 同上 | 让伪服务不检查令牌：前两条变红 |
| `unwritten-client.test.ts` 全绿 | 把重发时的幂等键改成 `randomUUID()`：「请求体逐字节相同」变红 |
| 同上 | 把取图改成 `await response.arrayBuffer()`：「读取在超过上限后停止」变红 |
| `info.test.ts` 全绿 | 删掉互质检查：「比例不互质」那一条变红 |

---

### T09 core：OpenAI 图像接口与伪服务

**目的。** 实现 `openai-images` 协议：

- 文生图；
- 带参考图的编辑；
- 尺寸与能力预填；
- 错误映射。

见[插图与出图服务 §4](../docs/image.md#4-openai-图像接口)。

**依赖。** T01、T02、T07。

**拥有的文件。** 新建：

- `packages/core/src/image/openai-client.ts`、`packages/core/src/image/openai-client.test.ts`；
- `packages/core/src/image/openai-capabilities.ts`、`packages/core/src/image/openai-capabilities.test.ts`；
- `packages/core/src/test-support/fake-openai-images.ts`。

**先读。** [插图与出图服务 §4](../docs/image.md#4-openai-图像接口) 全部小节、§5.3 第二条（base64 长度上限）。T07 的 `image/errors.ts`。

**步骤。**

- [x] 1. **核对前提。** T01、T07 已合入：`ls packages/core/src/net/fetch.ts packages/core/src/image/errors.ts` 都存在。
- [x] 2. **`image/openai-capabilities.ts`。** 导出：

  ```ts
  export function prefillOpenAiOptions(modelId: string): { maxReferences: number; sizes: 'fixed' | 'custom' };
  export function openAiCapabilities(options: { maxReferences: number; sizes: 'fixed' | 'custom' }): ImageCapabilities;
  export function openAiSizeFor(sizes: 'fixed' | 'custom', aspect: string, tier: ImageTierPreference): { width: number; height: number } | null;
  ```

  - **`prefillOpenAiOptions`**，照 §4.3：
    - 以 `gpt-image-2` 开头 → `{ 16, 'custom' }`；
    - 正好是 `gpt-image-1.5`、`gpt-image-1-mini`、`chatgpt-image-latest` → `{ 16, 'fixed' }`；
    - 其他 → `{ 0, 'fixed' }`。
  - **`openAiCapabilities`**：
    - `seed: false`、`negativePrompt: false`、`qualities: ['fast', 'best']`；
    - `maxReferenceBytes: null`、`maxPromptLength: null`；
    - `aspects` 和 `resolutions` 由尺寸表推出：
      - `fixed`：`aspects` 是 `['1:1', '3:2', '2:3']`，每个比例只有 `1k` 一档：1024×1024、1536×1024、1024×1536。
      - `custom`：照 §4.2 的表，加上转置。`aspects` 是 `['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16']`。720 档没有 `1:1`。
  - **`openAiSizeFor`**：`tier` 为 `'default'` 时返回该比例的 `1k` 尺寸；表里没有时返回 `null`。

  **规划时 `custom` 尺寸表全部满足这几条约束：** 宽高都是 16 的倍数、长边不超过 3840、长短边之比不超过 3:1、总像素在 655,360 到 8,294,400 之间（[OpenAI 图像生成指南](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output)）。测试里用这几条约束逐项验证表格，常量写死在测试里，不从被测代码派生。
- [x] 3. **`image/openai-client.ts`。** 导出：

  ```ts
  export interface OpenAiImageRequest {
    prompt: string;
    references: Array<{ mime: string; bytes: Uint8Array }>;
    size: { width: number; height: number };
    quality: 'fast' | 'best';
  }
  export interface OpenAiImageResult {
    bytes: Uint8Array;
    inputTokens: number | null;
    outputTokens: number | null;
  }
  export interface OpenAiImageClient {
    generate(request: OpenAiImageRequest, signal: AbortSignal): Promise<OpenAiImageResult>;
    listModels(signal: AbortSignal): Promise<void>;
  }
  export const OPENAI_IMAGE_TIMEOUT_MS = 180_000;
  export function createOpenAiImageClient(options: {
    baseUrl: string;
    apiKey: string | undefined;
    model: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  }): OpenAiImageClient;
  ```

  - **提示词：** 把 `{{ref:N}}` 换成 `input image N`。用正则 `/\{\{ref:(\d+)\}\}/gu`。
  - **没有参考图：** `POST {baseUrl}/images/generations`，JSON：

    ```json
    {
      "model": "…",
      "prompt": "…",
      "n": 1,
      "size": "1536x1024",
      "quality": "low",
      "output_format": "webp",
      "moderation": "auto"
    }
    ```

    `quality`：`fast` 对应 `low`，`best` 对应 `high`。
  - **有参考图：** `POST {baseUrl}/images/edits`，用 `FormData`。
    - 字段：`model`、`prompt`、`n`（`'1'`）、`size`、`quality`、`output_format`（`'webp'`）。
    - 每张参考图 `form.append('image[]', new Blob([bytes], { type: mime }), 'ref-<N>.<扩展名>')`，按数组顺序。
    - **不要**手动设置 `content-type`，交给 `fetch`。
  - `authorization: Bearer <apiKey>`；`apiKey` 为空时不带。
  - **时间上限：** 用 `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])`。超时和调用方中止要分清：超时抛 `image_timeout`，调用方中止重新抛出 `AbortError`。
  - **响应体上限：** 逐块读，累计超过 `Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 64 * 1024` 字节就停止并抛 `image_invalid_response`。读完后 `JSON.parse`，取 `data[0].b64_json`，用 `Buffer.from(b64, 'base64')` 解码。解码后长度超过 `IMAGE_MAX_BYTES` 同样抛错。
  - **用量：** `usage.input_tokens`、`usage.output_tokens` 是数字时返回，否则为 null。
  - **错误映射**（§4.4）。读 `{ error: { code, type } }`：

    | 情况 | 抛出 |
    | --- | --- |
    | `RedirectBlockedError` | `image_redirected`，`final` |
    | 401、403 | `image_unauthorized`，`final` |
    | 429 且 `code === 'insufficient_quota'` | `image_quota`，`final` |
    | 其他 429 | `image_rate_limited`，`busy`，`retryAfterMs` 取 `Retry-After`，缺省 2000 |
    | 400 且 `code === 'moderation_blocked'` | `image_refused`，`final` |
    | 400 且错误里提到 `size`（`code` 或 `param` 等于 `'size'`） | `image_output_format_unavailable`，`format` |
    | 其他 400 | `image_invalid_request`，`final` |
    | 5xx | `image_outcome_unknown`，`final`，`submitted: true` |
    | 连接阶段的失败 | `image_offline`，`transport`，`submitted: false` |
    | 发出之后的失败（包括超时） | `image_outcome_unknown`，`final`，`submitted: true` |

    怎样区分连接阶段：`fetch` 抛出的 `TypeError` 的 `cause.code` 属于 `ECONNREFUSED`、`ENOTFOUND`、`EAI_AGAIN`、`UND_ERR_CONNECT_TIMEOUT` 之一时算连接阶段，其余都算已经发出。
  - **本模块不重试。** 重试一次的逻辑在 T11（`transport` 和 `busy` 各重试一次）。
  - **`listModels`：** `GET {baseUrl}/models`，2xx 即成功，其余按上表抛错。
- [x] 4. **`test-support/fake-openai-images.ts`。** 导出 `startFakeOpenAiImages(options?: { apiKey?: string })`，返回 `{ baseUrl, requests, enqueue(step), close() }`。
  - `baseUrl` 以 `/v1` 结尾。
  - `requests` 记录：路径、`authorization`、`content-type`、JSON 请求体，或 multipart 的字段。multipart 用 `new Request(url, { method, headers, body }).formData()` 解析，记下每个 `image[]` 的类型、文件名和字节长度。
  - **`step` 的种类：**
    - `{ kind: 'image', width, height, usage? }`：返回 `pngBytes(width, height)` 的 base64；
    - `{ kind: 'error', status, code? }`；
    - `{ kind: 'redirect' }`；
    - `{ kind: 'hang' }`：不响应，直到连接被关；
    - `{ kind: 'oversize' }`：持续写出超过上限的 JSON。
  - 没有排队的 `step` 时，`GET /v1/models` 返回 `{ data: [] }`，其余请求返回 500。
- [x] 5. **测试。**

  `openai-capabilities.test.ts`：
  - 三类模型 id 的预填；
  - `custom` 表的每个尺寸满足第 2 步的四条约束；
  - `openAiSizeFor('custom', '1:1', '720')` 为 null；
  - `fixed` 只有 `1k`。

  `openai-client.test.ts`：
  - 没有参考图时走 `/images/generations`，请求体逐键核对（`quality: 'high'`、`output_format: 'webp'`、`moderation: 'auto'`、`n: 1`）；
  - 有两张参考图时走 `/images/edits`：`content-type` 以 `multipart/form-data` 开头，两个 `image[]` 的顺序和类型与输入一致，提示词里的 `{{ref:2}}` 变成 `input image 2`；
  - `usage` 解析；
  - 每一行错误映射一个用例；
  - `oversize` 抛 `image_invalid_response`；
  - 超时：`timeoutMs: 50` 配 `hang`，抛 `image_timeout`；
  - 调用方中止：抛 `AbortError`，不是 `image_timeout`；
  - 连接被拒：`baseUrl` 指向 `http://127.0.0.1:<一个刚关掉的端口>`，抛 `image_offline`，`submitted === false`。

**接线点。** T11 的 `engine.ts` 调用 `createOpenAiImageClient`、`openAiCapabilities`、`openAiSizeFor`；T06 在添加服务时调用 `prefillOpenAiOptions`，给 client 预填。

**注意事项。**

- 不用 JSON 的 `images` 数组（§4.1 写明了原因）。
- 不要把 `prompt` 或 base64 写进任何错误的 `message`。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `openai-client.test.ts` 全绿 | 把 `fast` 对应的 `low` 改成 `medium`：请求体核对变红 |
| 同上 | 把连接阶段的错误码列表清空：「连接被拒」变成 `image_outcome_unknown`，变红 |
| 同上 | 把参考图的追加顺序反过来：顺序断言变红 |
| `openai-capabilities.test.ts` 全绿 | 把 `16:9` 的 1K 改成 `1820x1024`：「16 的倍数」约束变红 |

---

### T10 core：启动器协议客户端、伪启动器、一致性测试

**目的。** 实现 core 一侧的 `unwritten-launcher/1`（[插图与出图服务 §12.2](../docs/image.md#122-启动器协议-unwritten-launcher1)），并提供一个状态可编排的伪启动器和一组一致性测试。唤醒流程本身在 T11。

**依赖。** T01、T02、T07。

**拥有的文件。** 新建：

- `packages/core/src/image/launcher-client.ts`、`packages/core/src/image/launcher-client.test.ts`；
- `packages/core/src/test-support/fake-launcher.ts`；
- `packages/core/src/image/launcher/conformance/unwritten-launcher.conformance.test.ts`。

**先读。** [插图与出图服务 §12.2](../docs/image.md#122-启动器协议-unwritten-launcher1)；[Colab 启动器 §4](../docs/colab-launcher.md#4-状态与-colab-cli-命令)（真启动器怎样转换状态，伪启动器要模拟同样的转换）；T07 的 `image/conformance/target.ts`（`conformanceTarget`）和 `image/errors.ts`。

**步骤。**

- [x] 1. **核对前提。** T01、T07 已合入：`ls packages/core/src/net/fetch.ts packages/core/src/image/conformance/target.ts` 都存在。
- [x] 2. **`image/launcher-client.ts`。** 导出：

  ```ts
  export const LAUNCHER_PROTOCOL = 'unwritten-launcher/1';
  export interface LauncherInfo { implementation: { name: string; version: string }; ready: boolean; notReadyReason: string | null }
  export interface LauncherSnapshot {
    state: LauncherState;
    reason: LauncherFailureReason | null;
    action: { url: string; expiresAt: number } | null;
    since: number;
  }
  export interface LauncherClient {
    info(signal: AbortSignal): Promise<LauncherInfo>;
    state(signal: AbortSignal): Promise<LauncherSnapshot>;
    start(input: { idempotencyKey: string; idleMinutes: number }, signal: AbortSignal): Promise<LauncherSnapshot>;
    continue(input: { idempotencyKey: string }, signal: AbortSignal): Promise<LauncherSnapshot>;
    stop(input: { idempotencyKey: string }, signal: AbortSignal): Promise<void>;
  }
  export function createLauncherClient(options: {
    baseUrl: string;
    token: string | undefined;
    fetch?: typeof fetch;
    requestTimeoutMs?: number;
  }): LauncherClient;
  ```

  - 每个请求带 Bearer 令牌，单个请求的时间上限是 `requestTimeoutMs`，默认 10 秒。
  - **`state` 的 JSON 校验：**
    - `state` 在 `LAUNCHER_STATES` 里；
    - `reason` 是 `LAUNCHER_FAILURE_REASONS` 之一或 null；
    - `since` 是非负整数（Unix 秒）；
    - `action` 为 null，或者是 `{ url, expiresAt }`：`url` 必须 `new URL(url).protocol === 'https:'`，`expiresAt` 是正整数（Unix 秒）。
  - 返回的 `since`、`expiresAt` **乘以 1000** 换成毫秒（§2.2）。
  - **错误映射：**

    | 情况 | 抛出 |
    | --- | --- |
    | 连接失败、超时 | `image_launcher_offline` |
    | 401 | `image_launcher_unauthorized` |
    | 409 `invalid_state` | `ImageError('image_wake_failed', 'final')`，`cause` 里带 `invalid_state` |
    | 重定向 | `image_redirected` |
    | JSON 不合格，或 `action.url` 不是 https | `image_wake_failed` |
    | 其他非 2xx | `image_wake_failed` |

  - `info` 的 `protocol` 必须等于 `LAUNCHER_PROTOCOL`，否则抛 `image_wake_failed`。
- [x] 3. **`test-support/fake-launcher.ts`。** 导出 `startFakeLauncher(options?)`，返回：

  ```ts
  interface FakeLauncher {
    url: string;
    token: string;
    requests: Array<{ method: string; path: string; body: unknown }>;
    script(steps: FakeLauncherStep[]): void;
    setState(state: LauncherState, extra?: { reason?: string; action?: { url: string; expiresAt: number } }): void;
    startCalls(): number;
    close(): Promise<void>;
  }
  type FakeLauncherStep = { state: LauncherState; afterMs: number; reason?: string; actionUrl?: string };
  ```

  - **默认行为：** 初始状态是 `stopped`。收到 `start` 后进入 `starting`，再按 `script` 依次转换。默认脚本是 `[{ state: 'needs_action', afterMs: 30, actionUrl: 'https://accounts.example.test/consent' }]`：停在 `needs_action`，收到 `continue` 后进入 `starting`，再过 30 毫秒进入 `running`。
  - `start` 在 `starting`、`needs_action`、`running` 时什么也不做，返回 202 和当前状态。
  - `continue` 不在 `needs_action` 时返回 409 `invalid_state`。
  - `idleMinutes` 不在 5 到 720 之间返回 400 `invalid_request`。
  - `stop` 进入 `stopping`，10 毫秒后进入 `stopped`。
  - `expiresAt` 是收到 `start` 时的 Unix 秒加 600。
  - 令牌校验、错误格式、不返回 CORS 头，都同 T08 的伪服务。
- [x] 4. **一致性测试**（`conformanceTarget('UNWRITTEN_LAUNCHER', startFakeLauncher)`），用裸 `fetch`：

  | 用例 | 断言 |
  | --- | --- |
  | 不带令牌、带错的令牌请求 `/v1/info` | 都是 401 |
  | `/v1/info` | `protocol === 'unwritten-launcher/1'`，有 `implementation`、`ready`、`notReadyReason`、`capabilities` |
  | `/v1/state` | 状态 JSON 合格（复用第 2 步的校验函数，把它从 `launcher-client.ts` 导出成 `parseLauncherState`） |
  | `start` 时 `idleMinutes: 4` | 400，`invalid_request` |
  | 状态不是 `needs_action` 时 `continue` | 409，`invalid_state` |
  | `start` 两次 | 第二次返回的状态和第一次之后的状态一致，不是又一次全新启动。断言 `since` 没有变小 |
  | 轮询状态，最多 120 秒 | 先看到 `needs_action` 时：`action.url` 以 `https://` 开头，`continue` 返回 202；最终到达 `running`。直接到达 `running` 时，跳过 `needs_action` 的断言，并在测试输出里写明（伪启动器默认会经过 `needs_action`） |
  | `stop` | 202；随后状态到达 `stopped` |
  | 所有响应 | 没有 `access-control-*` 头，不是 3xx |
- [x] 5. **`launcher-client.test.ts`。** 对伪启动器测：
  - 秒到毫秒的换算（`since * 1000`）；
  - `action.url` 为 `http://…` 时抛 `image_wake_failed`：用 `setState` 注入；
  - 401 映射；
  - 连接被拒映射成 `image_launcher_offline`；
  - `continue` 在错误状态下抛 `image_wake_failed`，`cause` 里是 `invalid_state`。

**接线点。** T11 的 `wake.ts` 调用 `createLauncherClient`；T06 的「测试启动器」调用 `info` 和 `state`；T28 和 `pnpm test:python` 对着真启动器跑第 4 步。

**注意事项。**

- 一致性测试对着真启动器运行时，会开一个真的运行时、消耗计算单元。`pnpm test:python` 用的是 T28 的伪 colab 命令，不消耗。
- `action.url` 不进诊断，也不进任何错误的 `message`。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 一致性测试对伪启动器全绿 | 让伪启动器在 `start` 时总是重置为全新的 `starting`：「`start` 两次」变红 |
| `launcher-client.test.ts` 全绿 | 去掉 https 检查：「`http://` 抛错」那一条变红 |
| 同上 | 去掉乘 1000：换算断言变红 |

---

### T20 client：插图共用的基础件

**目的。** 给 client 的几个插图任务（T21–T24）准备共用的东西，让它们各自只写自己的页面：

- 查询键；
- 新事件的失效；
- 带令牌取图并转成 blob URL 的 hook；
- 本机导入图片的整理；
- 唤醒提示组件；
- 服务状态的 hook。

**依赖。** T02。

**拥有的文件。**

- 改：`apps/client/src/shared/api/query.ts`、`apps/client/src/app/App.tsx`、`apps/client/src/i18n/zh-CN/common.json`、`apps/client/src/i18n/zh-CN/play.json`（只加附录 A.4 里标「T20」的键）。
- 新建：
  - `apps/client/src/shared/hooks/useImageBlob.ts`、`useImageBlob.test.tsx`；
  - `apps/client/src/shared/hooks/useImageServiceState.ts`；
  - `apps/client/src/shared/lib/image-import.ts`、`image-import.test.tsx`；
  - `apps/client/src/shared/ui/WakePrompt.tsx`、`WakePrompt.module.css`、`WakePrompt.test.tsx`；
  - `apps/client/src/shared/lib/image-labels.ts`、`image-labels.test.ts`。

**先读。**

- [插图与出图服务 §10](../docs/image.md#10-交给-client)、§12.3 的「等待用户操作」一条；
- [a11y §8](../docs/a11y.md#8-游玩页)的插图部分、§10 宣告区；
- [i18n](../docs/i18n.md) 的命名空间规则；
- 现有代码：
  - `shared/api/query.ts`；
  - `app/App.tsx` 的事件循环（按 `for await (const event of iterator)` 找）；
  - `shared/ui/LiveRegion.tsx`、`shared/ui/Button.tsx`；
  - `shared/test/fake-api.ts`：伪接口按过程路径注册处理函数，**不用改它**。

**步骤。**

- [x] 1. **核对前提。** T02 已合入：`rg -n "imageContract|IllustrationViewSchema" packages/contracts/src` 有命中。
- [x] 2. **`shared/api/query.ts`** 的 `queryKeys` 加：

  ```ts
  imageConfig: ['image', 'config'] as const,
  imageOutput: ['image', 'output'] as const,
  autoIllustration: ['image', 'auto'] as const,
  imageUsage: ['image', 'usage'] as const,
  imageStorage: ['image', 'storage'] as const,
  portraits: (workId: string) => ['portrait', workId] as const,
  portraitDraft: (workId: string, scope: string, target: string) => ['portrait', workId, 'draft', scope, target] as const,
  portraitSet: (workId: string, setId: string) => ['portrait', workId, 'set', setId] as const,
  ```

  - `portraitDraft` 的 `target` 传 `entity:<id>` 或 `protagonist`。
  - 同一作品的参考组都以 `['portrait', workId]` 开头，事件来时按前缀一次失效。
- [x] 3. **`app/App.tsx` 的事件循环**加四个分支：

  | 事件 | 失效 |
  | --- | --- |
  | `illustration.updated` | `queryKeys.route(event.routeId)` |
  | `portrait.updated` | `queryKeys.portraits(event.workId)`、`queryKeys.work(event.workId)` |
  | `image.config_changed` | `queryKeys.imageConfig`、`queryKeys.imageOutput`、`queryKeys.autoIllustration`、`['startInfo']` 前缀 |
  | `image.service_state` | `queryKeys.imageConfig`、`queryKeys.imageOutput`（就绪或探测结果变化可能带来新的能力） |
  | `llm.config_changed` | 保留原模型配置失效，同时失效 `queryKeys.autoIllustration` 和 `['startInfo']` 前缀，接收方变化会让确认过期 |
- [x] 4. **`shared/hooks/useImageBlob.ts`。**

  ```ts
  export type ImageBlobState =
    | { status: 'idle'; url: null }
    | { status: 'loading'; url: null }
    | { status: 'ready'; url: string; mime: string }
    | { status: 'error'; url: null; code: ErrorCode };

  export function useImageBlob(input: ImageFileInput | null, version: string | number): ImageBlobState;
  export const IMAGE_BLOB_CACHE_SIZE = 64;
  ```

  - **缓存：** 模块级的 LRU 缓存，键是 `JSON.stringify([input.view, input.image, version])`。值是 `{ url, mime, refs }`，`refs` 是正在使用它的组件数。
  - **加载：** 组件挂载、并且 `input` 不为空时：
    - 命中缓存：`refs` 加一，直接 `ready`。
    - 没命中：同一个键共享一个待完成的请求和 URL。调用 `api.image.file(input)`，保留 `Blob.type`，用 `URL.createObjectURL`，将 URL 和类型放进缓存。每个仍在使用当前键的调用方各加一次引用。请求完成或失败时从待完成表移除这个键。
  - **释放：** 组件卸载、`input` 或 `version` 变化时，旧键的 `refs` 减一。
  - **淘汰：** 缓存超过 `IMAGE_BLOB_CACHE_SIZE` 时，淘汰最久没用、并且 `refs` 为 0 的项，对它调用 `URL.revokeObjectURL`。`refs` 不为 0 的项永远不淘汰。
  - **出错：** 请求失败时 `status: 'error'`，`code` 用 `shared/api/errors.ts` 的 `errorCode(error)`（按符号名找）。
  - **竞态：** 请求还没回来，`input` 就变了的话，丢弃旧请求的结果。如果该键已无人等候，释放旧结果生成的 URL。另一个组件还在等同一个键时，它仍能收到结果。
  - 导出一个只给测试用的 `resetImageBlobCacheForTests()`，revoke 全部项并清空缓存。
- [x] 5. **`shared/hooks/useImageServiceState.ts`。**

  ```ts
  export function useImageServiceState(serviceId: string | null): {
    state: ImageServiceState;
    action: { url: string; expiresAt: number } | null;
    wakeFailure: { code: ErrorCode; reason: LauncherFailureReason | null } | null;
  };
  ```

  - 用 `useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() })`。
  - 找到 `id === serviceId` 的服务，返回它的三个字段。
  - `serviceId` 为空，或服务不存在时，返回 `{ state: 'unknown', action: null, wakeFailure: null }`。
- [x] 6. **`shared/lib/image-import.ts`**（[插图与出图服务 §6.2](../docs/image.md#62-人物参考组)「导入」一条）。

  ```ts
  export type ImportProblem = 'type' | 'too_large' | 'too_many_pixels' | 'decode' | 'encode';
  export type PreparedImport =
    | { ok: true; file: File; width: number; height: number }
    | { ok: false; problem: ImportProblem };
  export async function prepareImportedImage(file: File): Promise<PreparedImport>;
  export const PORTRAIT_UPLOAD_FILE_NAME = { webp: 'portrait.webp', png: 'portrait.png' } as const;
  ```

  按顺序：
  1. **类型。** 读文件的前 12 个字节，判断是不是 PNG、JPEG、WebP。判断规则同 T07 第 3 步的文件头，**不信** `file.type` 和扩展名。都不是 → `type`。
  2. **大小。** `file.size > IMAGE_MAX_BYTES` → `too_large`。
  3. **解码。** `createImageBitmap(file, { imageOrientation: 'from-image' })`，失败 → `decode`。`宽 × 高 > IMAGE_MAX_PIXELS` → `too_many_pixels`。
  4. **缩放。** 长边超过 `PORTRAIT_IMPORT_MAX_EDGE` 时等比缩小到正好等于它，四舍五入取整。
  5. **画到画布上。** 用 `OffscreenCanvas`，用完对位图 `close()`。
  6. **编码。** `canvas.convertToBlob({ type: 'image/webp', quality })`，`quality` 依次试 `0.9`、`0.8`、`0.7`，直到结果不超过 `PORTRAIT_IMPORT_MAX_BYTES`。都超过 → `too_large`。
     - 浏览器返回的 `blob.type` 不是 `image/webp` 时，按 PNG 处理：`blob.type` 必须是 `image/png`，否则 → `encode`；PNG 只编码一次，没有质量参数。
  7. 返回 `new File([blob], PORTRAIT_UPLOAD_FILE_NAME.webp 或 .png, { type: blob.type })`，以及缩放后的宽高。

  - 重新编码会丢掉 EXIF、XMP 和原始文件名，这正是目的：原图和原始文件名不出本机（§6.2）。
  - 不读 `file.name`，也不把它传给任何接口。
- [x] 7. **`shared/lib/image-labels.ts`。** 枚举到文案键的对照表（§2.4）：

  ```ts
  export const STYLE_PRESET_LABEL_KEYS: Record<StylePreset, string> = { watercolor: 'play:style.watercolor', … };
  export const IMAGE_TIER_LABEL_KEYS: Record<ImageTierPreference, string> = { '720': 'play:tier.720', … };
  export const PORTRAIT_SLOT_LABEL_KEYS: Record<PortraitSlot, string> = { … };
  export const SERVICE_STATE_LABEL_KEYS: Record<ImageServiceState, string> = { … };
  export const WAKE_REASON_LABEL_KEYS: Record<LauncherFailureReason, string> = { … };
  export const ILLUSTRATION_STAGE_LABEL_KEYS: Record<IllustrationStage, string> = { … };
  ```

  键名照附录 A.4 的 `play:style.*`、`play:tier.*`、`play:slot.*`、`play:serviceState.*`、`play:wake.reason.*`、`play:stage.*`，文案照抄附录。`image-labels.test.ts` 对每张表：
  - 从 contracts 的常量数组现取（`STYLE_PRESETS` 等），先断言数组非空；
  - 再断言每个值都有键，并且这个键在 `play.json` 里存在。
- [x] 8. **`shared/ui/WakePrompt.tsx`。**

  ```tsx
  export function WakePrompt(props: { serviceId: string | null }): JSX.Element | null;
  ```

  - 用 `useImageServiceState`。
  - `state === 'needs_action'` 并且 `action` 不为空时，显示：
    - 一段文字：`t('common:wake.needsAction')`；
    - 按钮「打开授权页」用 `common:wake.open`：`window.open(action.url, '_blank', 'noopener,noreferrer')`；
    - 按钮「继续」用 `common:wake.continue`：调 `api.image.wake.continue({ serviceId, requestId: crypto.randomUUID() })`。
      - 调用期间按钮禁用，文字换成 `t('common:wake.continuing')`。
      - 成功后不做别的，事件会让服务状态刷新。
      - 失败时，在按钮下方用 `ErrorNotice` 显示 `errors:<code>`。
  - `state === 'waking'` 时显示一行 `t('common:wake.waking')`。
  - `state === 'wake_failed'` 时显示 `t('common:wake.failed')`，后面接原因：`wakeFailure.reason` 不为空时用 `WAKE_REASON_LABEL_KEYS`，否则用 `errors:<code>`。
  - 其他状态返回 `null`。
  - **无障碍：** 整个提示包在 `<section aria-labelledby=…>` 里，标题是 `t('common:wake.heading')`（视觉上可以隐藏）。进入 `needs_action` 时，用 `LiveRegion` 礼貌播报一次 `t('common:wake.needsAction')`；同一个 `action.url` 只播报一次（[a11y §10](../docs/a11y.md#10-宣告区)）。**不抢焦点。**
  - 样式只用 token：背景 `--uw-color-surface`、边框 `--uw-border-width` 加 `--uw-color-border`、圆角 `--uw-radius-md`、内边距 `--uw-space-3`、按钮间距 `--uw-space-2`、文字 `--uw-typography-body-*`。这些 token 规划时都在用（`rg -o "\-\-uw-[a-z0-9-]+" apps/client/src`）。需要别的 token 时只从已有的里选，取不到合适的时停下来汇报，不要自己编 token。
  - 本组件不自己挂载，由 T22、T23、T24 放进各自的页面。
- [x] 9. **i18n。** 照附录 A.3（`common.json`）和附录 A.4 里标「T20」的键加文案。
- [x] 10. **测试。**

  `useImageBlob.test.tsx`（浏览器项目）。伪接口的 `image.file` 返回 `new Blob([…], { type: 'image/png' })`，用 `vi.spyOn(URL, 'createObjectURL')` 和 `revokeObjectURL` 观察：
  - 两个组件用同一个输入，`image.file` 只被调用一次；
  - `version` 变了，重新取；
  - 挂载 65 个不同的输入再全部卸载，然后挂第 66 个：`revokeObjectURL` 至少被调用一次；被淘汰的 URL 不是任何一个仍挂着的组件正在用的；
  - 请求失败返回 `image_file_missing`：`status === 'error'`，`code === 'image_file_missing'`。

  `image-import.test.tsx`（浏览器项目）：
  - 用 `OffscreenCanvas` 画一张 3000×2000 的图，导出 PNG，包成 `File`：结果 `ok`，宽 1536，高 1024；
  - 结果文件名是 `portrait.webp` 或 `portrait.png`，和原文件名无关：原文件名用 `secret-name.png`，断言结果里没有 `secret`；
  - 一个内容是 `<svg/>` 的 `File`，`type` 写成 `image/png`：`problem === 'type'`；
  - `size` 超过上限：用一个声明了很大 `size` 的对象替身，或真的造一个 20 MiB 加 1 字节的 `File`：`problem === 'too_large'`。

  `WakePrompt.test.tsx`（浏览器项目）：
  - 伪接口返回一个 `needs_action` 的服务：能按可读名称找到「打开授权页」「继续」两个按钮；点「继续」后伪接口记到一次 `image.wake.continue`，`serviceId` 正确；
  - `stubGlobal('open', vi.fn())` 后点「打开授权页」：`open` 收到 `action.url` 和 `'noopener,noreferrer'`；
  - `state === 'ready'` 时组件渲染为空：容器里没有按钮；
  - axe 没有违规（`shared/test/axe.ts`）。

**接线点。**

| 功能 | 谁挂上它 |
| --- | --- |
| `WakePrompt` | T24 的 `PlayPage.tsx`、T22 的 `AuthoringPage.tsx`、T23 的 `StartPage.tsx`。共 3 处，判据由各任务写 |
| `useImageBlob` | T22 的参考组与画风预览、T23 复用的画风和参考组件、T24 的插图与手记缩略图 |
| `prepareImportedImage` | T22、T23 的本机导入 |
| 事件失效 | 本任务的 `App.tsx` |

**注意事项。**

- blob URL 用完不 revoke 会泄漏内存；revoke 了还在用会让图片变空白。按上面的引用计数规则来，两头都不能错。
- `useImageBlob` 的伪接口测试里，`image.file` 返回 `Blob` 就够了；真实的 oRPC 返回 `File`（`File` 是 `Blob` 的子类）。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `useImageBlob.test.tsx` 全绿 | 把淘汰条件里的 `refs === 0` 去掉：「被淘汰的 URL 不是正在用的」变红 |
| 同上 | 去掉缓存命中，每次都请求：「只被调用一次」变红 |
| `image-import.test.tsx` 全绿 | 类型判断改成看 `file.type`：SVG 那一条变红 |
| `WakePrompt.test.tsx` 全绿 | 把 `'noopener,noreferrer'` 删掉：对应断言变红 |
| `image-labels.test.ts` 全绿 | 从 `play.json` 删掉 `play:tier.2k`：变红 |
| `rg -n "image.config_changed\|illustration.updated\|portrait.updated\|image.service_state" apps/client/src/app/App.tsx` 四个都命中 | — |

---

### T25 selfhost/colab：Colab 宿主

**目的。** 实现 [Colab 宿主](../docs/colab-host.md)：一套 Python 模块，替服务做好所有部署上的事，并支持两种启动方式（手动运行笔记本、由启动器启动）：

- 检查资源；
- 搬运文件、卸载 Drive；
- 接入 Tailscale；
- 看护进程、空闲释放。

服务（T26、T27）只写自己的「准备」和「启动」。

**依赖。** T03（`selfhost/colab/pyproject.toml`、`uv.lock`）。

**拥有的文件。** `selfhost/colab/` 下除 `pyproject.toml`、`uv.lock` 以外的全部文件，都是新建：

```
selfhost/colab/
  README.md
  unwritten_colab/
    __init__.py
    service.py
    paths.py
    resources.py
    secrets.py
    drive.py
    models.py
    tailscale.py
    state.py
    watchdog.py
    status_line.py
    run.py
  tests/
    conftest.py
    fake_bin/            伪 nvidia-smi、tailscaled、tailscale（可执行的 Python 脚本）
    fake_colab/          伪 google.colab 包
    test_resources.py
    test_secrets.py
    test_drive.py
    test_models.py
    test_tailscale.py
    test_watchdog.py
    test_run.py
```

**先读。** [Colab 宿主](../docs/colab-host.md) 全文，尤其是：

- §4 宿主与服务的约定、状态文件；
- §6 Drive；
- §7 Secrets；
- §8 笔记本的步骤和 §8.1 由启动器启动；
- §9 访问控制；
- §10 看护循环与空闲释放。

**步骤。**

- [x] 1. **核对前提。** T03 已合入：`cat selfhost/colab/pyproject.toml` 能看到 `requires-python = ">=3.11"`，`uv sync --directory selfhost/colab` 成功。
- [x] 2. **`service.py`：宿主与服务的约定**（§4）。

  ```python
  from collections.abc import Callable
  from dataclasses import dataclass
  from pathlib import Path
  import subprocess

  from .paths import Paths


  @dataclass(frozen=True)
  class HostedService:
      name: str
      hostname: str
      tag: str
      token_secret: str
      authkey_secret: str
      min_vram_gib: float
      min_ram_gib: float | None
      port: int
      models_lock: Path | None
      prepare: Callable[[Paths], None]
      start: Callable[[Paths, str], list[subprocess.Popen]]
  ```

  - `start` 的第二个参数是服务令牌。服务把它经环境变量交给自己的进程，**不放进命令行参数**。
  - 状态文件路径不进 `HostedService`，固定是 `Path(f"/tmp/unwritten-{name}.state")`，由 `paths.py` 给出。
- [x] 3. **`paths.py`。** 一个 `@dataclass(frozen=True) class Paths`，字段：
  - `local_root = Path("/content/unwritten")`；
  - `service_dir`：本地的服务代码目录；
  - `models_dir`：本地模型目录 `local_root / name / "models"`；
  - `tailscale_dir`：本地 tailscaled 状态目录 `local_root / name / "tailscale"`；
  - `drive_root`：Drive 上的 `unwritten/` 目录，可能为 `None`；
  - `state_file = Path("/tmp/unwritten-<name>.state")`。

  再提供 `Paths.for_service(name, drive_root, local_root=…)`。**测试里所有根目录都通过参数换成 `tmp_path`**，代码里不能写死 `/content` 以外的绝对路径。
- [x] 4. **`resources.py`**（§8 第 2 步）。
  - **读数：**
    - `read_vram_gib()`：运行 `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`，取第一行的 MiB 数除以 1024。
    - `read_ram_gib()`：读 `/proc/meminfo` 的 `MemTotal`（kB）。
    - `free_disk_gib(path)`：用 `shutil.disk_usage(path).free`。
  - **`check_resources(service, models_total_bytes, readings)`**：返回不足项的列表，每项是 `(项目, 需要, 实有)`，项目取 `vram`、`ram`、`disk` 之一。
    - 磁盘的需要量 = `models_total_bytes / 2**30 + DISK_HEADROOM_GIB`，`DISK_HEADROOM_GIB = 20` 是模块常量。
    - `min_ram_gib` 为 `None` 时不检查内存。
  - **读不到时：** 没有 `nvidia-smi` 时 `read_vram_gib` 抛 `ResourceError("nvidia-smi not found")`，由 `run.py` 当作显存不足处理。
- [x] 5. **`secrets.py`**（§7）。
  - **`read_notebook_secret(name, userdata)`：**
    - `userdata` 是注入的 `google.colab.userdata` 模块。
    - 抛 `SecretNotFoundError` → `SecretProblem(name, "missing")`；抛 `NotebookAccessError` → `SecretProblem(name, "no_access")`。
    - 按异常类的**名字**判断，因为测试里的伪模块没有真类。
  - **`read_launch_file(path)`**（§8.1）：
    - 读 `/content/unwritten/launch.json`，读完立即 `unlink`；
    - 返回 `{"token": …, "tailscaleAuthKey": … 或 None, "idleMinutes": int}`；
    - 文件不存在或字段缺失时抛 `SecretProblem("launch.json", "missing")`。
  - **`SecretProblem`** 的 `__str__` 只写名字和种类，**不写值**。
  - **任何函数都不打印密钥**，也不把它放进异常信息。
- [x] 6. **`drive.py`**（§6）。
  - `find_drive_root(mount=Path("/content/drive"))`：依次看 `mount / "MyDrive"`、`mount / "My Drive"`，返回存在的那个下面的 `unwritten/`；都不存在返回 `None`。
  - `is_mounted(mount)`：`find_drive_root(mount)` 是否不为 `None`。
  - `copy_tree(src, dst)`：`shutil.copytree(src, dst, dirs_exist_ok=True)`。
  - `unmount(drive_module)`：调用 `drive_module.flush_and_unmount()`。调用后再检查一次 `is_mounted`，仍挂载时抛 `DriveError("still mounted")`。**这一条要在服务启动之前成立**（§6）。
- [x] 7. **`models.py`**（§8 第 3 步）。
  - **锁定文件：** `load_lock(path)` 读 `models.lock.json`，形状是 `{"files": [{"repo", "commit", "path", "size", "sha256", "dest"}]}`。`dest` 是相对于模型目录的路径。
  - **`ensure_models(lock, drive_models, local_models, opener=urllib.request.urlopen)`**，对每个文件：
    1. **Drive 上的文件。** Drive 上有这个文件，并且有标记 `<dest>.verified.json`，记下的 `size` 和 `mtime_ns` 都和文件当前的一致：跳过校验。
       Drive 上有文件但没有标记，或标记对不上：计算 sha256，相符就写标记，不相符就删掉这个文件，按缺失处理。
    2. **缺失的文件。** 从 `https://huggingface.co/{repo}/resolve/{commit}/{path}` 下载到 `local_models/<dest>.part`。
       - 边下边算 sha256，块大小 8 MiB。
       - 下完核对 `size` 和 `sha256`，不符就删掉并抛 `ModelError(dest)`。
       - 相符就改名成正式文件，再复制一份到 Drive，并写标记。
    3. **Drive 上已有、本地没有的文件**，用 `shutil.copyfile` 顺序复制到本地。
  - **`models_total_bytes(lock)`** 返回 `size` 之和，供第 4 步用。
  - **下载地址里必须带 `commit`，** 不能用分支名（§8 第 3 步）。
- [x] 8. **`tailscale.py`**（§8 第 4 步、§9）。
  - `install()`：`subprocess.run(["sh", "-c", "curl -fsSL https://tailscale.com/install.sh | sh"], check=True)`。
  - `start_tailscaled(statedir)`：用 `subprocess.Popen` 启动：

    ```
    tailscaled --tun=userspace-networking --statedir=<statedir> --socket=/tmp/tailscaled.sock
    ```

    然后等 `/tmp/tailscaled.sock` 出现，最多 30 秒。返回进程。
  - `has_identity(statedir)`：`statedir / "tailscaled.state"` 存在且不为空。
  - **`up(hostname, tag, authkey)`：**
    - `authkey` 不为 `None` 时，先写进一个权限 `0o600` 的临时文件，命令带 `--auth-key=file:<临时文件路径>`，执行完删掉文件。**认证 key 不出现在命令行参数里**：命令行参数在 `ps` 里人人可见。
    - 完整命令：`tailscale --socket=/tmp/tailscaled.sock up --hostname=<hostname> --advertise-tags=<tag> [--auth-key=file:…]`。
  - `serve(port)`：`tailscale --socket=/tmp/tailscaled.sock serve --bg --https=443 http://127.0.0.1:<port>`。
  - `dns_name()`：运行 `tailscale --socket=/tmp/tailscaled.sock status --json`，取 `Self.DNSName`，去掉末尾的点，拼成 `https://<DNSName>`。
  - 每个命令失败时抛 `TailscaleError(命令名)`，**不带命令行原文**，因为可能含路径。
- [x] 9. **`state.py`。**
  - `read_state(path)`：读状态文件（§4 的 JSON），返回 `ServiceState(ready, not_ready_reason, in_flight, last_activity_at)`。文件不存在、或 JSON 不合格时返回 `None`。
  - 只读，不写：状态文件由服务自己写。
- [x] 10. **`status_line.py`**（§8.1）。
  - 导出 `emit(phase, **extra)`，打印一行 `unwritten-host ` 加 `json.dumps({"phase": phase, **extra}, ensure_ascii=True)`，然后 flush。
  - `phase` 必须是 `copying`、`preparing`、`models`、`tailscale`、`starting`、`serving`、`exiting` 之一，否则抛 `ValueError`。
  - `extra` 只允许 `reason`、`step` 两个键，值必须是 `str`，否则抛 `ValueError`。这样状态行里不可能混进地址和用户内容。
- [x] 11. **`watchdog.py`**（§10）。

  ```python
  def watch(*, processes, state_path, idle_minutes, clock, sleep, unassign, log, status=None) -> str
  ```

  所有外部动作都经参数注入，测试里换成假的：
  - `clock` 返回秒；
  - `sleep(seconds)` 等待；
  - `unassign()` 释放运行时；
  - `log(text)` 输出给人看；
  - `status(phase, **extra)` 输出状态行，可以为 `None`。

  每 60 秒一轮：
  1. **读状态文件。**
  2. **检查进程。** 对 `processes` 逐个 `poll()`：第一次发现某个进程退出时，`log` 一行 `<进程名> exited with code <退出码>`，之后记住它已经退出，不再重复打印。
  3. **算空闲时长。** `in_flight > 0` 时空闲时长为 0；否则从 `last_activity_at` 算起，`last_activity_at` 为空时从 `watch` 开始的时刻算起。
  4. **打印。** `log` 一行就绪状态、未就绪原因、空闲分钟数。
  5. **到时释放。** 空闲时长 ≥ `idle_minutes × 60` 时：
     1. 有 `status` 时调用 `status("exiting", reason="idle" 或 "process_exit")`：有进程已退出就是 `process_exit`，否则是 `idle`；
     2. 调用 `unassign()`；
     3. 返回这个原因。
  - 进程退出**不会让循环停下**（§10）。
- [x] 12. **`run.py`。** 把前面的模块按 §8 的 8 步串起来：

  ```python
  def run(service: HostedService, *, mode: Literal["notebook", "launcher"], idle_minutes: int, deps: RunDeps | None = None) -> None
  ```

  `RunDeps` 是一个 dataclass，装着 `google.colab` 的 `drive`、`userdata`、`runtime` 三个模块，以及第 4–11 步的可替换函数。默认值从真模块取，测试里整体替换。

  **按顺序执行：**
  1. **复制到本地**（`emit("copying")`）。
     - 由启动器启动时，代码已经解包在本地，只复制 tailscaled 状态；手动运行笔记本时，复制宿主代码、服务代码和 tailscaled 状态。
     - Drive 未挂载时：手动运行笔记本就抛 `HostError("drive not mounted")`；由启动器启动也同样抛这个错（启动器在调用前已经用 `colab drivemount` 挂好，§8.1）。
  2. **读取 Secrets，检查资源。**
     - 令牌每次都读。认证 key 只在本地副本里还没有节点身份时才读（§8 第 2 步）。
     - 手动运行笔记本时用 `read_notebook_secret`，由启动器启动时用 `read_launch_file`。
     - 资源不够时打印不足项（只有数字，没有密钥），抛 `HostError("insufficient resources")`。
  3. **准备并放好模型**（`emit("preparing")`，接着 `emit("models")`）：先调用 `service.prepare(paths)`，再在 `service.models_lock` 不为空时调用 `ensure_models`。
  4. **接入 Tailscale**（`emit("tailscale")`）：`install`、`start_tailscaled`、`up`，然后把本地状态目录复制回 Drive。
  5. **卸载 Drive**：调用 `drive.unmount`。
  6. **启动服务**（`emit("starting")`）：调用 `service.start(paths, token)`，等状态文件出现，最多 60 秒。
  7. **对外开放**：调用 `serve(service.port)`，打印 `dns_name()`，然后 `emit("serving")`。
  8. **看护**：调用 `watch(...)`。由启动器启动时把 `emit` 传给它的 `status` 参数。

  - **`emit` 只在由启动器启动时调用**，手动运行笔记本时为空操作。
  - **出错时：** 任一步抛出 `HostError`、`TailscaleError`、`ModelError`、`DriveError`、`SecretProblem` 时，由启动器启动就 `emit("exiting", reason="error", step=<步骤名>)`，步骤名取 `copying`、`secrets`、`resources`、`preparing`、`models`、`tailscale`、`unmount`、`starting`、`serving` 之一；然后重新抛出。
- [x] 13. **`__init__.py`。** `from . import drive, models, paths, resources, run, secrets, service, state, status_line, tailscale, watchdog`。
  - **为什么要在这里全部导入：** 宿主从 Drive 导入后，Drive 会被卸载；之后再导入的子模块就找不到了（§8）。全部在包导入时加载完，卸载后不再需要文件。
  - 导出 `HostedService`、`Paths`、`run`。
- [x] 14. **测试。**

  **`conftest.py` 提供的夹具：**
  - 伪 `google.colab` 包，放进 `sys.modules`：
    - `drive.flush_and_unmount()` 把伪挂载点目录删掉；
    - `userdata.get(name)` 按字典返回值，或抛名为 `SecretNotFoundError`、`NotebookAccessError` 的异常类；
    - `runtime.unassign()` 记一次调用。
  - 把 `tests/fake_bin` 放到 `PATH` 前面。里面的伪命令把自己收到的参数逐行追加写进 `$FAKE_BIN_LOG` 文件。伪 `tailscaled` 建出 socket 文件，并一直运行到被杀掉。

  **用例：**

  | 文件 | 用例 |
  | --- | --- |
  | `test_resources.py` | 显存、内存、磁盘各自不足时返回对应的项；`min_ram_gib=None` 时不检查内存；磁盘需要量 = 模型合计 + 20 GiB |
  | `test_secrets.py` | 两种异常各映射成对应的种类；`read_launch_file` 读完后文件不存在；`str(SecretProblem)` 不含密钥的值。用一个特征值 `sk-test-SECRET-123`，断言它不在 `str()` 里 |
  | `test_drive.py` | `MyDrive` 和 `My Drive` 两种目录名都能找到；`unmount` 后 `is_mounted` 为假；伪 `flush_and_unmount` 不删目录时，`unmount` 抛 `DriveError` |
  | `test_models.py` | 用本机 `http.server` 起一个伪 Hugging Face：缺失的文件被下载，下载地址里有 `commit`；sha256 不符时抛 `ModelError`，不留 `.part` 文件；第二次运行时有标记，伪服务没收到任何请求（阳性对照：第一次运行时收到了）；标记的 `size` 对不上时重新校验 |
  | `test_tailscale.py` | 有身份时 `up` 的参数里没有 `--auth-key`；首次时有 `--auth-key=file:`，并且 `$FAKE_BIN_LOG` 里**找不到**认证 key 的值（阳性对照：临时文件在命令运行期间确实含有这个值，由伪命令读出并记下它的长度） |
  | `test_watchdog.py` | `in_flight=1` 时一直不释放（时钟前进 2 倍空闲时长）；空闲到时调用 `unassign` 一次，返回 `idle`；进程退出后照样计时，返回 `process_exit`，退出信息只打印一次；`status` 收到 `exiting` |
  | `test_run.py` | **顺序：** 用伪 `RunDeps` 走完整流程，记录每个动作的顺序，断言 `unmount` 在 `service.start` 之前、tailscaled 状态复制回 Drive 在 `unmount` 之前。**读密钥：** 由启动器启动时 `emit` 依次输出 `copying`、`preparing`、`models`、`tailscale`、`starting`、`serving`；手动运行笔记本时 stdout 里没有任何 `unwritten-host` 开头的行；再次部署（本地已有 `tailscaled.state`）时，伪 `userdata` 没有被要过认证 key（断言 `get` 的调用参数里没有它）。**失败：** 资源不足时在复制模型前停下（`ensure_models` 没被调用），状态行是 `exiting`、`reason=error`、`step=resources`。**泄露：** 整个过程的 stdout 里找不到令牌的值 |
- [x] 15. **`README.md`。** 按[根目录 AGENTS.md §9](../AGENTS.md#9-源码目录的-readme) 只写四件事：
  1. 宿主负责什么；
  2. 不归它管的（服务的协议、模型、启动参数）；
  3. 服务接入时先看 `unwritten_colab/service.py` 的 `HostedService`；
  4. 状态文件和状态行的约定（链接到 `docs/colab-host.md` §4、§8.1）。

  另写一节「在 Colab 上使用」的操作步骤，内容对应 `docs/colab-host.md` §2、§7、§9、§10 的用户操作：Secrets 怎样存、访问控制怎样写、每次怎样运行。笔记本只放代码，操作说明放在这里。不超过 150 行。

**接线点。**

| 调用方 | 用什么 |
| --- | --- |
| T26 的 `plugins/comfyui/colab_service.py` 和 `colab.ipynb` | `HostedService`、`run` |
| T27 的 `selfhost/strata/colab_service.py` 和 `colab.ipynb` | 同上 |
| T28 启动器上传后执行的 `bootstrap.py` | `run(..., mode="launcher")` |

**注意事项。**

- 宿主只用标准库，不 `import` 任何第三方包（§3）。
- **不写注释**，Python 文件和 README 以外的任何文件里都不写。ruff 的 `S` 规则会对 `subprocess` 报警：用参数列表、不用 `shell=True`。唯一的例外是 `install()` 里的 `sh -c`：它是 Tailscale 官方的安装方式。在 `pyproject.toml` 的 `per-file-ignores` 里给 `unwritten_colab/tailscale.py` 放宽 `S602`、`S605`、`S607`，这是配置，不是代码里的抑制指令。改 `pyproject.toml` 的这一段属于本任务，依赖段不动。
- 所有往外打印的内容，过一遍：没有令牌、认证 key、URL 以外的地址、路径以外的用户内容。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `uv run --frozen --directory selfhost/colab pytest -q` 全绿 | 把 `run.py` 里的 `unmount` 挪到 `service.start` 之后：`test_run.py` 的顺序断言变红 |
| 同上 | 把 `up` 改成直接 `--auth-key=<值>`：`test_tailscale.py` 的泄露断言变红 |
| 同上 | 把 `watch` 里 `in_flight > 0` 的判断去掉：「一直不释放」变红 |
| 同上 | 把认证 key 改成每次都读：再次部署那条断言变红 |
| `uv run --frozen --directory selfhost/colab ruff check` 和 `ruff format --check` 都通过 | — |
| `rg -n "^\s*#" selfhost/colab --glob '*.py'` 零命中 | — |
| `pnpm test:python` 的输出里有 `selfhost/colab` 的 pytest 结果，不再是「跳过」 | — |

---

### T06 core：`image` 服务的配置、视图与接口占位

**目的。** 本任务分三部分：

1. **定死接口，接好路由。** 写下 `ImageService`、`IllustrationService` 两个服务接口，把全部新过程接上路由；还没实现的方法先写占位（§2.9）。这样 client 和后续 core 任务都有了稳定的落点。
2. **实现出图服务的配置。** 读写 `providers.json` 的 `imageServices` 和 `image`，key 规则照搬模型服务，令牌由 core 生成（[插图与出图服务 §2](../docs/image.md#2-出图服务的配置)、[插件 §3.2](../docs/plugins.md#32-鉴权)）。
3. **实现应用级的插图设置。** 默认出图规格，以及「游玩时生成插图」的确认（D3）。

**依赖。** T04（共用存储、`providers/keys.ts`、`providers/ids.ts`）、T05（`app_settings.illustration`）、T09（`openAiCapabilities`、`prefillOpenAiOptions`）。

**拥有的文件。**

- 新建：
  - `packages/core/src/image/service.ts`、`image/config.ts`、`image/token.ts`、`image/capability-cache.ts`、`image/settings.ts`、`image/engine-types.ts`；
  - 上面几个文件的 `*.test.ts`；
  - `packages/core/src/illustration/service.ts`（骨架与占位）。
- 改：`packages/core/src/services.ts`、`packages/core/src/api/router.ts`、`packages/core/src/api/http-app.ts`、`packages/core/src/app.ts`、`packages/core/src/main.ts`、`packages/core/src/app.test.ts`、`packages/core/src/app.integration.test.ts`、`packages/core/src/api/http-app.test.ts`、`packages/core/src/desktop/channel.test.ts`。

**先读。**

- [插图与出图服务 §2](../docs/image.md#2-出图服务的配置) 全文、§12.3；
- [LLM 端点 §3](../docs/llm-endpoints.md#3-key-的来源与保护)、§10（过程的写法：`baseRevision`、`config_conflict`）；
- 现有的 `llm/service.ts`：`createEndpoint`、`updateEndpoint`、`removeEndpoint` 三个方法。本任务的增删改照它的写法，包括 `store.enqueue`、`baseRevision` 校验、`config_conflict`、`invalid_url`。

**步骤。**

- [x] 1. **核对前提。**
  - T04、T05 已合入：`ls packages/core/src/providers/file.ts packages/core/src/providers/keys.ts` 都存在；`rg -n "illustration" packages/core/src/store/schema.ts` 有命中。
  - `rg -n "createEndpoint\(input" packages/core/src/llm/service.ts` 找到参照实现。
- [x] 2. **`services.ts` 加两个接口。** 签名照抄。类型都从 `@unwritten/contracts` 导入，`ImageDispatchGuard`、`ImageGenerateInput`、`ImageGenerateResult` 从 `./image/engine-types.ts` 导入，这个文件也由本任务新建，内容见第 3 步。

  ```ts
  export interface ImageService {
    listServices(): ImageConfigView;
    createService(input: CreateImageServiceInput): Promise<CreateImageServiceOutput>;
    updateService(input: UpdateImageServiceInput): Promise<ImageConfigView>;
    removeService(input: RemoveImageServiceInput): Promise<ImageConfigView>;
    generateToken(): GeneratedToken;
    testService(input: TestImageServiceInput): Promise<TestImageServiceResult>;
    select(input: SelectImageServiceInput): Promise<ImageConfigView>;
    getOutputOptions(): OutputOptionsView;
    setOutputPreferences(input: OutputPreferences): OutputOptionsView;
    getAutoIllustration(): AutoIllustrationView;
    setAutoIllustration(input: SetAutoIllustrationInput): AutoIllustrationView;
    activeTarget(): AutoIllustrationTarget | null;
    prepareGeneration(serviceId: string, input: { manual: boolean; signal: AbortSignal; onWaiting?: () => void; guard?: ImageDispatchGuard }): Promise<ImageCapabilities>;
    selectedServiceId(): string | null;
    capabilities(serviceId: string): ImageCapabilities | null;
    assertFormat(capabilities: ImageCapabilities, format: Pick<ImageGenerateInput, 'aspect' | 'size' | 'quality'>): void;
    generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
    wake(serviceId: string, trigger: 'prewarm' | 'demand'): void;
    continueWake(input: ContinueWakeInput): Promise<Record<string, never>>;
    usageSummary(): ImageUsageSummary;
    pruneCalls(): number;
    whenIdle(): Promise<void>;
  }

  export interface IllustrationService {
    retry(input: IllustrationActionInput): IllustrationView;
    reroll(input: IllustrationActionInput): IllustrationView;
    dismiss(input: DismissIllustrationInput): IllustrationView;
    portraitDraft(input: PortraitDraftInput): PortraitDraftView;
    portraitGet(input: PortraitGetInput): PortraitSetView;
    portraitUpload(input: PortraitUploadInput): Promise<PortraitSetView>;
    portraitGenerate(input: PortraitGenerateInput): PortraitSetView;
    portraitUpdate(input: PortraitUpdateInput): PortraitSetView;
    portraitAdopt(input: PortraitAdoptInput): PortraitDraftView;
    portraitPreview(input: PortraitPreviewInput): PortraitSetView;
    file(input: ImageFileInput): Promise<File>;
    storageSummary(): ImageStorageSummary;
    prewarm(input: PrewarmInput): Record<string, never>;
    suggestAppearance(input: SuggestAppearanceInput): Promise<SuggestAppearanceOutput>;
    setWorkStyle(input: SetIllustrationStyleInput): Record<string, never>;
    recoverInterrupted(): number;
    collectGarbage(): Promise<void>;
    whenIdle(): Promise<void>;
  }
  ```

  - `Services` 加 `image: ImageService; illustration: IllustrationService;`。
  - `services.ts` 同时从 `./image/engine-types.ts` re-export `ImageDispatchGuard`、`ImageGenerateInput`、`ImageGenerateResult`，从 `./image/errors.ts` re-export `ImageError`，从 `./story/writer.ts` re-export `StoryTx`。T16–T19 和 `play` 从 `services.ts` 导入这些类型，不直接导入 `image/`、`story/` 的内部文件。
  - `IllustrationService` 再加三个给 `play` 用的同步入口：
    - `enqueue(tx: StoryTx, input: IllustrationQueueInput): string`：按 T18 第 2 步登记一条插图。
    - `forRoute(routeId: string): Map<string, IllustrationView>`：按回合 id 返回这条路线上的插图视图；`play.getRoute` 直接用它挂到 `TurnView.illustration`。
    - `journalPortraits(input: JournalPortraitsInput): Map<string, { setId: string; updatedAt: number }>`：T19 的手记缩略图查询。
  - 在 `services.ts` 定义 `IllustrationQueueInput`、`JournalPortraitsInput` 和 `StoryService` 不新增；这些输入类型的字段照 T18、T19 的签名写。
  - `ServiceFactories` 加：
    - `image(deps: CoreDeps & { llm: LlmService }): ImageService;`
    - `illustration(deps: CoreDeps & { llm: LlmService; image: ImageService }): IllustrationService;`
- [x] 3. **`image/engine-types.ts`。** T11 照它实现 `generate`：

  ```ts
  export interface ImageDispatchGuard {
    model: string | null;
    assertCurrent(): void;
  }
  export interface ImageGenerateInput {
    serviceId: string;
    guard?: ImageDispatchGuard;
    prompt: string;
    negativePrompt: string | null;
    references: Array<{ mime: string; bytes: Uint8Array }>;
    aspect: string;
    size: { width: number; height: number } | null;
    quality: 'fast' | 'best';
    seed: number | null;
    signal: AbortSignal;
    ref: { workId: string | null; kind: 'illustration' | 'portrait' | 'test'; id: string | null };
    manual: boolean;
  }
  export interface ImageGenerateResult {
    bytes: Uint8Array;
    mime: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    seed: number | null;
    serviceId: string;
    model: string | null;
    callId: string;
  }
  ```

  `guard` 只由游玩任务提供，包括玩家对正文插图的重试、重画及其按需生成的参考图。`model` 是本次确认的出图模型，Unwritten 图像协议取 `null`。`assertCurrent` 同步检查尝试和接收方，失效时抛 `AbortError`。作者参考、画风预览、付费测试按原手动契约调用。

  `manual` 为 true 表示玩家手动点了重试、重画、预览，不看离线记录（[插图与出图服务 §5.1](../docs/image.md#51-调用入口)）。
- [x] 4. **`image/capability-cache.ts`。** 进程内的能力缓存，T11 写入，本任务读：

  ```ts
  export interface ProbeRecord {
    at: number;
    result: 'ready' | 'not_ready' | 'offline' | 'unauthorized' | 'invalid';
    notReadyReason: string | null;
    implementation: { name: string; version: string } | null;
    model: string | null;
    capabilities: ImageCapabilities | null;
  }
  export function createCapabilityCache(): {
    get(serviceId: string): ProbeRecord | null;
    set(serviceId: string, record: ProbeRecord): void;
    delete(serviceId: string): void;
  };
  ```
- [x] 5. **`image/config.ts`。** 纯函数，不读写文件：
  - **`serviceView(entry, env, probe, wake, lastSuccessAt)`：** 把 `ImageServiceEntry` 转成 `ImageServiceView`。
    - `key` 和 `launcher.key` 用 `keyStatus`（`providers/keys.ts`）；
    - `idleMinutes` 缺省为 `IMAGE_IDLE_MINUTES`；
    - `capabilities`：
      - `openai-images`：由 T09 的 `openAiCapabilities(entry.capabilities ?? prefillOpenAiOptions(entry.model ?? ''))` 算出；
      - `unwritten-image`：取 `probe?.capabilities ?? null`；
    - `state`、`action`、`wakeFailure` 取 `wake` 参数，T11 之前调用方传 `{ state: 'unknown', action: null, wakeFailure: null }`。
  - **`validateBaseUrl(raw)`：** 用 `net/url.ts` 的 `normalizeBaseUrl`，返回 `null` 时抛 `invalid_url`。启动器地址同样用它。
  - **`createEntry(input)`：** 按 `CreateImageServiceInput` 建 `ImageServiceEntry`：
    - `id` 用 `newImageServiceId(input.name, input.requestId)`；
    - `openai-images` 时 `model` 必填，缺了抛 `invalid_input`；`capabilities` 取 `input.openai ?? prefillOpenAiOptions(input.model)`；
    - `unwritten-image` 时忽略 `model` 和 `openai`；
    - `launcher` 只在 `unwritten-image` 时写入，`openai-images` 带了 `launcher` 抛 `invalid_input`（§12.1）；
    - `idleMinutes` 只在有 `launcher` 时写入。
  - **`applyUpdate(entry, input)`：**
    - **地址不能改。** 更新输入里没有 `baseUrl` 字段，所以服务地址天然改不了。启动器地址也不能改：`launcher.action === 'set'` 而原来已有启动器时，地址变了就抛 `invalid_input`；要换地址，先 `remove` 再 `set`。
    - key 按 `KeyChange` 的三种动作处理，写法同 `llm/service.ts` 的 `updateEndpoint`。
- [x] 6. **`image/token.ts`。** `export function generateServiceToken(): string { return randomBytes(32).toString('base64url'); }`。测试：长度 43；1000 次不重复；只含 `[A-Za-z0-9_-]`。
- [x] 7. **`image/settings.ts`。** 读写 `app_settings.illustration`：
  - **读写：** 读时用 T05 的 `IllustrationSettingsSchema` 解析；不合格时当作 `DEFAULT_ILLUSTRATION_SETTINGS`，并记一条 `warn` 事件 `image.settings.invalid`。写时先用同一个 schema 校验。
  - **`currentTarget(state, llm)`：**
    - `image.service` 为空、或指向的服务不存在 → `null`；
    - `llm.resolve('background')` 为 `null` → `null`；
    - 否则返回 `{ serviceId, model, background: { endpointId, modelId } }`：`model` 在 `unwritten-image` 时为 `null`；`background` 取 `ResolvedModel` 里的端点 id 和模型 id，按 `ResolvedModel` 的字段名找，规划时在 `llm/types.ts`。
  - **`autoView(settings, current)`：** `enabled = settings.autoEnabled && settings.confirmed !== null && current !== null && 深相等(settings.confirmed, current)`。
  - **`setAuto(input, current)`：**
    - `enabled: true` 时，`input.confirm` 必须深相等于 `current`，否则抛 `config_conflict`：用户确认的是旧的接收方，要重新确认；`current` 为 `null` 时抛 `image_not_configured`。通过后写 `{ autoEnabled: true, confirmed: input.confirm }`。
    - `enabled: false` 时写 `{ autoEnabled: false, confirmed: null }`。
    - 每次写都记 `image.auto_illustration.set` 事件。
  - **`outputOptions(settings, capabilities)`：** 算 `OutputOptionsView`（§2「默认出图规格」）：
    - `aspects`：`capabilities?.aspects ?? []`；
    - `tiers`：对 `720`、`1k`、`2k` 三档，收集 `resolutions[比例][档位]` 存在的比例和尺寸；至少有一个比例有这档时列出这档。`default` 档总是列出，`sizes` 为 `{}`；
    - `preferenceAvailable`：
      - `aspectPreference === 'auto'`：选中的档位是 `default`，或至少有一个比例有这档；
      - 固定比例：比例在 `aspects` 里，并且选中的档位是 `default` 或这个比例有这档。
  - **`setOutputPreferences(input)`：** 只写 `defaults`，不校验能力，因为能力可能稍后才探测到。
- [x] 8. **`image/service.ts`：`createImageService(deps)`。**
  - **存储：** 用 `deps.providers ?? createProvidersStore(...)`（同 T04 第 6 步），`subscribe` 存储变化。变化后，`imageServices` 或 `image` 部分的 JSON 和上次不同时，发布 `image.config_changed`。比较用 `JSON.stringify(file.imageServices) + JSON.stringify(file.image)`。
  - **`listServices`：** 状态不是 `ok` 时，返回 `services: []` 和对应的 `status`、`problem`，写法同 `llm/service.ts` 的 `view`。
  - **`createService`、`updateService`、`removeService`、`select`：**
    - 都在 `store.enqueue` 里执行：先 `load()`，核对 `baseRevision`（不符抛 `config_conflict`），改 `file`，再 `write`；
    - 删除的服务正好是 `image.service` 时，把它清空；
    - 记 `image.service.created`、`.updated`、`.removed` 事件，`data` 只有 `protocol` 和 `hasLauncher`。
  - **`generateToken`：** 返回 `{ token: generateServiceToken() }`，**不存储**。保存时由 `createService` 的 `apiKey` 写入（§2 第 4 条）。
  - **`getOutputOptions`、`setOutputPreferences`、`getAutoIllustration`、`setAutoIllustration`：** 用第 7 步的函数。能力从 `capabilities(selectedServiceId)` 取。写了之后发布 `image.config_changed`。
  - **`activeTarget()`：** 自动出图已确认并生效（`autoView(...).enabled`）时返回完整的 `currentTarget`，否则返回 `null`。插图流程（T18）逐步对比本次固定的服务、出图模型和 background 端点与模型（§7.1）。
  - **`selectedServiceId()`：** 返回 `image.service`，服务不存在时为 `null`。画风预览、作者生成参考图只要求选了服务，不要求自动出图（§2「`image.service` 是用于出图的服务」）。
  - **`capabilities(id)`：**
    - `openai-images`：由配置算；
    - `unwritten-image`：取能力缓存。
  - **占位：** `testService`、`prepareGeneration`、`assertFormat`、`generate`、`wake`、`continueWake`、`usageSummary` 写 §2.9 的占位，由 T11 实现。`pruneCalls` 返回 0，`whenIdle` 返回 `Promise.resolve()`，T11 替换。
- [x] 9. **`illustration/service.ts`：`createIllustrationService(deps)`。** 每个方法都写 §2.9 的占位，`recoverInterrupted` 返回 0，`collectGarbage`、`whenIdle` 返回 `Promise.resolve()`。后续任务逐个替换，见 §3 的顺序表。
- [x] 10. **`api/router.ts` 把 T02 的临时路由改为全部真实服务调用。**

  | 契约路径 | 调用 |
  | --- | --- |
  | `image.services.list` / `create` / `update` / `remove` / `generateToken` / `test` | `services.image.listServices()` / `createService` / `updateService` / `removeService` / `generateToken()` / `testService` |
  | `image.select` | `services.image.select` |
  | `image.outputPreferences.get` / `set` | `services.image.getOutputOptions()` / `setOutputPreferences` |
  | `image.autoIllustration.get` / `set` | `services.image.getAutoIllustration()` / `setAutoIllustration` |
  | `image.usage.summary` | `services.image.usageSummary()` |
  | `image.storage.summary` | `services.illustration.storageSummary()` |
  | `image.file` | `services.illustration.file` |
  | `image.prewarm` | `services.illustration.prewarm` |
  | `image.wake.continue` | `services.image.continueWake` |
  | `illustration.retry` / `reroll` / `dismiss` | `services.illustration.retry` / `reroll` / `dismiss` |
  | `portrait.draft` / `get` / `upload` / `generate` / `update` / `adopt` / `preview` | `services.illustration.portraitDraft` / `portraitGet` / `portraitUpload` / `portraitGenerate` / `portraitUpdate` / `portraitAdopt` / `portraitPreview` |
  | `play.suggestAppearance` | `services.illustration.suggestAppearance` |
  | `works.setIllustrationStyle` | `services.illustration.setWorkStyle` |

  写法照现有的 `base.<路径>.handler(({ input, context }) => …)`。替换全部后删掉临时处理函数，用 `rg -n "not implemented: rpc\."` 核对 `api/router.ts` 零命中。把 T02 的临时路由用例改成鉴权后收到真实 `ImageConfigView`，检查旧过程仍成功。
- [x] 11. **`api/http-app.ts`。** 在 `app.all('/api/*', …)` 之前加：

  ```ts
  app.post('/api/portrait/upload', bodyLimit({ maxSize: PORTRAIT_UPLOAD_MAX_BODY_BYTES, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }));
  ```

  - `bodyLimit` 从 `hono/body-limit` 导入；
  - 先核对 oRPC 的路径确实是 `/api/portrait/upload`：在测试里发一次，看路由命中；
  - 这个上限在 oRPC 解析 multipart 之前生效（D12）。
- [x] 12. **`app.ts`、`main.ts`。**
  - `app.ts`：在 `const play = …` 之后加 `const image = factories.image({ ...deps, llm });` 和 `const illustration = factories.illustration({ ...deps, llm, image });`，放进 `services` 对象；`waitForTasks` 加上 `image.whenIdle()`、`illustration.whenIdle()`；恢复阶段加 `illustration.recoverInterrupted()` 和 `image.pruneCalls()`。启动时的清理由 T29 加。
  - `main.ts`：`factories` 加 `image: (deps) => createImageService(deps)`、`illustration: (deps) => createIllustrationService(deps)`。
  - `app.test.ts`、`app.integration.test.ts`、`desktop/channel.test.ts` 的 `ServiceFactories` 补两个新工厂。用 `rg -n "ServiceFactories|: Services" packages/core/src --glob '*.test.ts'` 核对显式声明，通过 `pnpm typecheck` 找出上下文推断的工厂。
  - `app.test.ts` 和 `api/http-app.test.ts` 的 `fakeServices` 也要给 `Services.image`、`Services.illustration` 填值。已有真实装配的测试用真实工厂；已有类型化替身的测试用同形替身，HTTP 列表用例返回完整 `ImageConfigView`。
- [x] 13. **测试。**

  `image/service.test.ts`：
  - **新建：** 建一个 `unwritten-image` 服务，再 `listServices`：
    - `key.source === 'file'`，`hasKey === true`；
    - 视图里**没有** key 原文：`JSON.stringify(view)` 不含 key；
    - id 匹配 `/^image-[a-z0-9-]+-[0-9a-f]{6}$/`；
    - 同一个 `requestId` 重发，得到同一个 id。
  - **`$ENV`：** key 写成 `$TEST_IMAGE_KEY` 时 `source === 'env'`。
  - **`baseRevision`：** 过期的 `baseRevision` 抛 `config_conflict`。
  - **删除选中的服务：** `selectedServiceId` 变成 `null`，磁盘上 `image.service` 为 `null`。
  - **启动器：** `openai-images` 带启动器时抛 `invalid_input`；启动器的 `set` 换地址抛 `invalid_input`，先 `remove` 再 `set` 可以。
  - **事件：** 改 `imageServices` 发布一次 `image.config_changed`；只改模型用途（`llm.purposes`）**不发布**。阳性对照：同一个测试里，改出图服务时确实发布了。
  - **版本 1 文件：** 版本 1 的 `providers.json` 上建一个出图服务，`.bak` 出现，新文件 `version === 2`。这一条证明本任务确实用了 T04 的共用存储。

  `image/settings.test.ts`：
  - **未确认：** `enabled` 为 false。
  - **确认：** `confirm` 与 `current` 一致时开启成功。
  - **接收方变了：** 开启后换掉 `background` 用途的模型，`enabled` 变为 false，`confirmed` 仍是旧值（§2「任一项变化后，设置页恢复关闭」）。
  - **旧确认：** `confirm` 和 `current` 不一致时抛 `config_conflict`。
  - **`outputOptions`：** 能力只有 `3:2` 有 `2k` 时，`tiers` 里有 `2k`；固定 `3:4` 加 `2k` 时 `preferenceAvailable` 为 false；`default` 档总在。

  `api/http-app.test.ts` 加一条：上传请求体超过 `PORTRAIT_UPLOAD_MAX_BODY_BYTES` 返回 413，并且 `services.illustration.portraitUpload` 没被调用（用一个记录调用的替身）。阳性对照：小于上限时它被调用了一次（这时占位会抛 `internal`，不影响断言）。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| 两个新服务 | `app.ts` 的装配、`main.ts` 的 `factories`、测试里的 `factories`（第 12 步 `rg` 出的每一处） |
| 全部新过程 | `api/router.ts`，共 28 个 handler（`image` 16 个、`illustration` 3 个、`portrait` 7 个、`play` 和 `works` 各 1 个）。判据按契约逐个数，见下表 |
| 上传的请求体上限 | `api/http-app.ts` |

**注意事项。**

- **不要**在本任务里实现探测、生成、唤醒。测试连接也由 T11 写。
- `config.ts` 要从 T09 导入 `openAiCapabilities`、`prefillOpenAiOptions`。T09 在 W3，本任务在 W4，所以已经合入。
- 视图里的 `baseUrl` 原样给 client（[插件 §2](../docs/plugins.md#2-边界)：设置页可查看配置地址），key 和令牌永远不给。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `image/service.test.ts`、`image/settings.test.ts` 全绿 | 把 `serviceView` 里的 `key: keyStatus(...)` 换成 `apiKey: entry.apiKey`：「视图里没有 key 原文」变红（typecheck 也会红，先改类型再试） |
| 同上 | 把 `autoView` 里的深相等去掉：「接收方变了」变红 |
| 同上 | 去掉删除时清空 `image.service` 的逻辑：对应用例变红 |
| `rg -c "handler\(" packages/core/src/api/router.ts` 比改动前多 28 | 少接一个过程：typecheck 会因 `implement(contract)` 缺键报错 |
| 上传 413 那条测试绿 | 删掉 `bodyLimit` 那一行：413 断言变红 |
| `grep -rn "not implemented:" packages/core/src` 的命中，正好是本任务列出的占位 | — |

---

### T12 core：形象与插图标记进入回合循环和创作

**目的。** 让故事数据里有「看得见的样子」和「这一回合值得画哪一段」：

- 人物在登记时可以带形象；
- 形象变化写成 `appearance` 特征；
- narrator 能标出要插图的段落，并在上下文里看到主角和在场人物当前的样子；
- 作者方案、预览、每局生成的人物也能带形象。

这些都是**可选**的：模型漏填、填错，正文照常提交（[回合循环 §6](../docs/turn-loop.md#6-校验与保存)、D23）。本任务不画任何图。

**依赖。** T02（`AppearanceTextSchema`、方案人物的 `appearance`）、T05（`turns.illustrate_para`、`playthroughs.illustration`）。

**拥有的文件**（全部是改，测试文件可以新建）：

- `packages/core/src/story/types.ts`、`story/changes.ts`、`story/writer.ts`、`story/projection.ts`、`story/render.ts`，以及它们的测试；
- `packages/core/src/play/propose-turn-tool.ts`、`play/narrator-prompt.ts`、`play/context.ts`、`play/service.ts`、`play/cast-tool.ts`、`play/opening-tool.ts`、`play/opening-prompt.ts`、`play/opening-job.ts`，以及它们的测试；
- `packages/core/src/story/opening-proposal.ts`、`authoring/plan-tool.ts`、`authoring/plan-prompt.ts`、`authoring/preview-prompt.ts`、`authoring/plan-edit.ts`、`authoring/service.ts`，以及它们的测试；
- `packages/core/src/story/tools.test.ts`、`play/context.test.ts`：只改 token 棘轮的数字和新增用例；
- `packages/core/src/test-support/llm-steps.ts`：只加参数。

**先读。**

- [回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)、§5（`illustrate` 参数、`new_entity`、`trait`）、§6 的校验表、§11 叙述约定；
- [插图与出图服务 §6.1](../docs/image.md#61-形象)；
- [游玩流程 §2.1](../docs/gameplay-flow.md#21-插图)：哪些瞬间适合配图，narrator 的指引要和它一致；
- [数据模型 §4](../docs/data-model.md#4-故事事实)「人物的样子变了」那一行；
- [packages/core/AGENTS.md §5](../packages/core/AGENTS.md#5-新增时要登记的地方)「新增一种 `changes` 类型」：本任务不新增类型，但改了 `new_entity`、`trait` 的字段，登记的地方相同。

**步骤。**

- [x] 1. **核对前提**，记下读数：
  - `rg -n "EntityProfileSchema = " packages/core/src/story/types.ts`：规划时是 `z.object({ text: z.string() })`。
  - `rg -n "profile: \{ text:" packages/core/src --glob '!*.test.ts' --glob '!test-support/**'`：规划时三处，`story/writer.ts`、`authoring/service.ts`、`authoring/plan-edit.ts`。这三处都要改，第 4 步。
  - `rg -n "tx.insert\(turns\)" packages/core/src --glob '!*.test.ts'`：规划时三处，`play/service.ts`、`play/start.ts`、`play/opening-job.ts`。本任务只改 `play/service.ts` 那一处；开场图由 T18 处理。
  - `rg -n "工具说明的 token 棘轮|上下文的 token 棘轮" packages/core/src`：两个棘轮测试的位置。
- [x] 2. **`story/types.ts`。**
  - `EntityProfileSchema` 改成 `z.object({ text: z.string(), appearance: AppearanceTextSchema.optional() })`。
  - `NewEntityChangeSchema` 加 `appearance: z.string().nullable().default(null)`。
  - `ProjEntity` 加 `appearance: string | null` 和 `sourcePara: number | null`。
  - 加一个常量 `APPEARANCE_TRAIT_KEY = 'appearance'`。
  - `ValidatedChangesSchema` 加 `droppedAppearances: z.number().int().nonnegative().default(0)`。`EMPTY_CHANGES` 同步加 `droppedAppearances: 0`。
- [x] 3. **`story/changes.ts`：解析和校验**（`parseChanges`，按符号名找）。
  - **`new_entity` 的 `appearance`：**
    - 只对 `kind === 'character'` 读；
    - 用 `AppearanceTextSchema.safeParse(原值)`：通过就保留去首尾空白后的值；不通过，或者原值不是字符串，就记为 `null`，并让 `droppedAppearances` 加一；
    - 字段缺省时直接记为 `null`，**不算**丢弃。
    - 这一条**不产生校验错误**（D23）。
  - **`trait` 且 `key === 'appearance'`：**
    - `statement` 用 `AppearanceTextSchema` 校验，不通过就**整行丢弃**，`droppedAppearances` 加一，不产生错误；
    - `same_visible_identity` 为字符串 `"true"` 时，写进 `data: { same_visible_identity: 1 }`，其他值忽略。
  - **`knowledge` 引用了一个形象特征**（本次的行或已有事实，`kind === 'trait'` 并且 `key === 'appearance'`）时，产生一条校验错误，文字见附录 B.3（[回合循环 §5](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)：形象特征不能作为 `knowledge` 的引用）。
  - 开场预览、开场、每局生成共用这同一套解析，不另写。用 `rg -n "parseChanges\(" packages/core/src --glob '!*.test.ts'` 核对调用方，都会自动得到新行为。
- [x] 4. **写入实体档案的三处**都带上形象：
  - `story/writer.ts`（规划时第 59 行）：`profile: { text: entity.profile, ...(entity.appearance ? { appearance: entity.appearance } : {}) }`。同一行实体的 `sourcePara` 在 `entityOrigin === 'turn'` 时取已校验的 `entity.para`，否则为 `null`。不依赖 `known_as`。
  - `authoring/service.ts`（规划时第 396 行，采用开场预览时写入新实体）：同样写；
  - `authoring/plan-edit.ts`（规划时第 178 行，确认方案时写入方案人物）：用方案项的 `appearance`，`null` 时不写这个键。
  - 写入前用 `EntityProfileSchema.parse` 校验（[packages/core/AGENTS.md §2](../packages/core/AGENTS.md#2-契约与错误)）。
- [x] 5. **`story/projection.ts`。**
  - `loadProjection` 读实体时，填 `appearance: row.profile.appearance ?? null` 和 `sourcePara: row.sourcePara`，旧记录的 `null` 原样传下去。
  - 新增两个函数：

    ```ts
    export function currentAppearance(p: StoryProjection, entityId: string): string | null;
    export function appearanceFacts(p: StoryProjection, entityId: string): ProjFact[];
    ```

    - `appearanceFacts`：返回投影里 `subjectId === entityId`、`kind === 'trait'`、`key === APPEARANCE_TRAIT_KEY` 的事实，按 `depth`、再按 `para` 升序。
    - `currentAppearance`：取 `appearanceFacts` 的最后一条的 `statement`；没有就用实体的 `appearance`；都没有返回 `null`。
    - 这是 **narrator 视角**的当前形象，不按主角可见性过滤。主角视角的形象由 T14 按段落另算。
- [x] 6. **`story/render.ts`。** 新增 `renderAppearanceBlock(input: { protagonistAppearance: string | null; present: Array<{ code: string; appearance: string | null }> }): string`。输出格式见附录 C.3：
  - 都没有形象时返回空字符串；
  - 没有形象的人物不列出。
- [x] 7. **`play/propose-turn-tool.ts`。**
  - `PROPOSE_TURN_PARAMETERS.properties` 加 `illustrate: { type: 'string', description: <附录 B.1 的说明> }`，**不加进 `required`**（可省略）。
  - `changes` 的说明里：
    - `new_entity` 那一行的示例加 `"appearance":"此刻看得见的样子，只写长相、身形、衣着"`；
    - `trait` 那一行后面加一句 `appearance` 的用法，文字照附录 B.1。
  - 新增解析函数：

    ```ts
    export function parseIllustrate(raw: unknown, paragraphCount: number): number | null;
    ```

    - `raw` 不是字符串，或去空白后为空 → `null`；
    - 去空白后必须是 `^[1-9]\d*$`，并且值 ≤ `paragraphCount`，否则 → `null`。
  - `ProposedTurnDraft` 加 `illustratePara: number | null`。在解析草稿的函数里（按 `ProposedTurnDraft` 的构造处找）用 `parseIllustrate(args.illustrate, paragraphs.length)` 填。
  - **不合格的 `illustrate` 不产生错误**（D23）。
- [x] 8. **`play/narrator-prompt.ts`。** `NARRATOR_SYSTEM_PROMPT` 加两段，文字照附录 B.2：插图标记的选法；形象只写看得见的样子。
- [x] 9. **`play/context.ts`。**
  - `NarratorContextInput` 加 `protagonistAppearance: string | null`。
  - 在在场人物那一块之后，插入 `renderAppearanceBlock(...)` 的结果，空字符串时不插：
    - `present` 取 `presentIdsAtHead(p)` 里的人物（不含主角），`code` 用 codebook 的短编号，`appearance` 用 `currentAppearance`；
    - 主角的形象用 `input.protagonistAppearance`；
    - 位置按现有的块顺序找「在场」那一块，按函数名找，规划时用的是 `renderSceneBlock`。
  - 返回值加 `appearanceLines: number`，并加进 `turn.context` 样本的 `data`。
- [x] 10. **`play/service.ts`。**
  - 构建上下文时，读开局行的 `illustration`，用 T05 的 `PlaythroughIllustrationSchema.safeParse`：
    - 通过，并且 `protagonistInFrame` 为 true：传 `protagonistAppearance`；
    - 否则传 `null`，因为主角不入画时，narrator 不需要主角的样子。
  - 续写提交事务里的 `tx.insert(turns).values({...})`（规划时第 450 行）加 `illustratePara: draft.illustratePara`。
  - `getRoute` 返回的 `RouteView` 填上 `playthroughId`（路线所属的开局 id，`routes.playthrough_id`）。
- [x] 11. **`play/cast-tool.ts`（`propose_cast`）。**
  - 每个人物那一行的 JSON 加可选的 `appearance`，说明文字照附录 B.4；
  - 解析时同第 3 步：不合格就丢弃，不报错；
  - 在 `play/opening-job.ts` 将本局人物传给 `writeChanges` 的地方带上解析后的形象，确保后台开场成功时写入实体档案。`playthroughs.cast` 里暂存的形状也加这个字段（按 `cast-tool.ts` 里人物类型的定义找，规划时第 24 行附近有 `profile: string`）。
- [x] 12. **`play/opening-tool.ts`、`play/opening-prompt.ts`、`story/opening-proposal.ts`、`authoring/preview-prompt.ts`。**
  - 开场和预览里的 `new_entity` 已经由第 3 步的解析带上形象，这里只改给模型的说明：`new_entity` 的示例加 `appearance`，文字照附录 B.4。
  - `story/opening-proposal.ts` 里转换预览新实体的地方，按 `NewEntityChange` 的用法找，把 `appearance` 原样带过去，`authoring/service.ts` 采用时才写得进去（第 4 步）。
- [x] 13. **`authoring/plan-tool.ts`、`authoring/plan-prompt.ts`、`authoring/plan-edit.ts`。**
  - `propose_plan` 的人物行（`kind: 'entity'`）加可选的 `appearance`，说明照附录 B.4。
  - 解析时：
    - `entityKind === 'character'` 时用 `AppearanceTextSchema` 校验，不通过就记为 `null`，不报错；
    - 非人物一律为 `null`。
  - `updatePlanItem`（`plan-edit.ts`）接受人物项的 `appearance`：contracts 的 schema 已经校验过长度，这里只确认非人物不能带，带了抛 `invalid_input`。
  - 方案生成的提示词里加一句：人物的形象只写看得见的样子，写法同附录 B.2 第二段。
- [x] 14. **token 棘轮。**
  - 两个棘轮测试（`story/tools.test.ts` 的「工具说明的 token 棘轮」、`play/context.test.ts` 的「上下文的 token 棘轮」）**先跑一次，记下变红时报出的新数字**。
  - 把上限改成「新数字向上取整到 50 的倍数」。
  - 在汇报里逐段写明涨幅来自哪里：`illustrate` 参数说明、`new_entity` 示例、`trait` 说明、系统提示的两段、形象块（[packages/core/AGENTS.md §4](../packages/core/AGENTS.md#4-模型调用)）。
  - **不要**为了通过直接把数字调大一大截。
- [x] 15. **`test-support/llm-steps.ts`。** `proposeTurnStep` 的输入加可选的 `illustrate?: string`，有值时放进参数。不改其他函数的行为。
- [x] 16. **测试。** 新用例写在对应文件的测试里：

  | 文件 | 用例 |
  | --- | --- |
  | `story/changes.test.ts` | `new_entity` 人物带 300 字形象：保留；301 字：形象为 `null`，`droppedAppearances === 1`，**没有错误**；带换行：同上；地点带 `appearance`：为 `null`；`trait` 的 `appearance` 不合格：这一行不在结果里，其他行照常；`same_visible_identity: "true"` 写进 `data`；`knowledge` 引用本次的形象特征：有一条错误，文字等于附录 B.3 |
  | `story/writer.test.ts` | 写入后读库，`profile` 有 `appearance`；没有形象时 `profile` 里没有这个键（用 `Object.keys` 断言）。`new_entity` 无称呼且 `para: '3'` 时，实体行和投影的 `sourcePara` 都是 3，作者设定仍为 `null`。把写入的 `sourcePara` 改成 `null`，前两处断言变红 |
  | `story/projection.test.ts` | `currentAppearance`：没有特征时取档案；两条特征时取较深的那条；同一回合两条时取段号较大的那条 |
  | `play/propose-turn-tool.test.ts` | `parseIllustrate`：`'2'`、正文 3 段 → 2；`'0'`、`'4'`（3 段）、`'1.5'`、`' '`、`2`（数字类型）、`undefined` → `null` |
  | `play/service.test.ts` | 用 `proposeTurnStep({ …, illustrate: '2' })` 走一回合：`turns.illustrate_para === 2`；`illustrate: '9'`：回合照常提交，`illustrate_para` 为 `null`；新人物没写形象：照常提交，没有修正轮。阳性对照：伪模型只被调用一次，证明没有因为缺形象回去修正 |
  | `play/context.test.ts` | 在场人物有形象时，上下文里出现附录 C.3 的块，用的是短编号、**不是**实体 id，也不是名字；主角入画并有形象时，块里有主角那一行；主角不入画时没有 |
  | `authoring/plan-tool.test.ts`、`plan-edit.test.ts` | 方案人物行带形象，解析后在方案项里；确认方案后实体档案里有它 |

**接线点。**

| 功能 | 落点 | 挂上去的地方 |
| --- | --- | --- |
| `illustrate` 参数 | `PROPOSE_TURN_PARAMETERS` | 续写的工具定义（按 `PROPOSE_TURN_PARAMETERS` 的引用找）|
| `illustratePara` 写库 | `play/service.ts` 的 `tx.insert(turns)` | 续写提交，1 处 |
| 形象块 | `renderAppearanceBlock` | `play/context.ts`，1 处 |
| 档案的 `appearance` | 第 4 步三处 | 三处写入，判据逐一覆盖 |

**注意事项。**

- **形象的规则不在这里判断「是不是只写了看得见的」。** 那靠提示词和评测保证（[插图与出图服务 §6.1](../docs/image.md#61-形象)）。core 只校验长度和换行。
- 不要把形象写进 `entity_names` 或别的表。
- 改了系统提示和工具说明，就要更新棘轮测试。这是硬规定。
- 本任务不读 `illustrations` 表，也不登记插图。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 第 16 步全部绿 | 在 `parseChanges` 里让 301 字的形象产生一条错误：`changes.test.ts` 的「没有错误」和 `service.test.ts` 的「伪模型只被调用一次」都变红 |
| 同上 | 把 `parseIllustrate` 的上界检查去掉：`'4'`（3 段）那一条变红 |
| 同上 | 去掉 `play/service.ts` 里 `illustratePara` 的写入：`illustrate_para === 2` 变红 |
| 同上 | 把 `authoring/plan-edit.ts` 的形象写入去掉：确认方案那一条变红 |
| 两个 token 棘轮测试绿，新上限 = 实测值向上取整到 50 | 把 `illustrate` 的说明加长 200 字：工具说明的棘轮变红 |
| `rg -n "profile: \{ text:" packages/core/src --glob '!*.test.ts' --glob '!test-support/**'` 的每一处都带了 `appearance` | — |

---

### T15 core：图片存储、写入锁与清理

**目的。** 实现[插图与出图服务 §9](../docs/image.md#9-存储)：

- 按内容哈希存一份；
- 「临时文件 → 改名 → 提交数据库」的写入顺序，与清理互斥；
- 按引用回收；
- 统计占用空间。

插图、参考组、导入（T17、T18）都经它写文件，T19 经它读文件。

**依赖。** T05（三张表和 JSON 列的 schema）、T07（`validateImageBytes`、`IMAGE_EXTENSION`）。

**拥有的文件。**

- 新建：`packages/core/src/illustration/storage.ts`、`storage.test.ts`、`illustration/gc.ts`、`gc.test.ts`、`illustration/constants.ts`。
- 服务接线由 T13 执行，本任务只改上列存储文件和测试。

**先读。** [插图与出图服务 §9.1–9.5](../docs/image.md#91-目录)；D9、D10。

**步骤。**

- [x] 1. **核对前提。** T05、T07 已合入。用 `rg -n "portraitSets|illustrations|imageCalls" packages/core/src/store/schema.ts` 核对三张表，再核对 `image/validate.ts` 与 `image/limits.ts` 的图片校验和扩展名。
- [x] 2. **`illustration/constants.ts`。** 本模块的常量都放在这里，后续任务也往这里加：

  ```ts
  export const IMAGE_GC_GRACE_MS = 10 * 60 * 1000;
  export const PORTRAIT_PREVIEW_TTL_DAYS = 7;
  export const ILLUSTRATION_MAX_REFERENCES = 4;
  ```
- [x] 3. **`illustration/storage.ts`。** 导出：

  ```ts
  export interface StagedImage {
    ref: ImageFileRef;
    tempPath: string;
  }
  export interface ImageStore {
    readonly root: string;
    stage(bytes: Uint8Array, options?: { rejectMetadata?: boolean; maxBytes?: number }): Promise<StagedImage>;
    commit<T>(staged: StagedImage[], transaction: () => T, assertCurrent?: () => void): Promise<T>;
    read(ref: ImageFileRef): Promise<Uint8Array | null>;
    pathOf(ref: ImageFileRef): string;
    exclusive<T>(task: () => Promise<T> | T): Promise<T>;
    clearTemp(): void;
  }
  export function createImageStore(dataDir: string): ImageStore;
  export class ImageStoreError extends Error {
    readonly stage: 'validate' | 'temp_write' | 'rename' | 'commit';
    readonly systemCode: string | null;
  }
  ```

  - **目录：** `root = <dataDir>/images`；`blobs/`、`tmp/` 在第一次用到时 `mkdirSync({ recursive: true })`。
  - **`stage`（§9.3 第 1、2 步）：**
    1. 先 `validateImageBytes(bytes, { rejectMetadata, maxBytes })`，不合格时抛 `ImageStoreError('validate')`，`message` 是拒收原因的枚举值；
    2. 算 sha256，得到 `ref = { hash, mime, width, height, bytes: bytes.length }`；
    3. 写到 `tmp/<randomUUID()>.part`，权限 0600，失败抛 `ImageStoreError('temp_write', 系统错误码)`。
    - 这一步**不在锁里**，可以和别的任务并行（§9.3 第 2 步）。
  - **`commit`（§9.3 第 3 步）：** 在 `exclusive` 锁里先运行可选的同步 `assertCurrent`。失败时删掉本次的临时文件，再原样抛出，不改正式文件和数据库。从守卫到正式文件就位、同步事务提交之间没有 `await`。每个 `staged` 按以下步骤处理：
    - 正式文件 `blobs/<hash>.<ext>` **已经存在**：删掉临时文件。相同内容只存一份。
    - 不存在：`renameSync(temp, 正式路径)`，失败抛 `ImageStoreError('rename', …)`。
    - 然后调用 `transaction()`。它是一个**同步**函数，内部执行 `db.transaction(...)`，返回值原样返回。
    - `transaction` 抛错时**不删**已就位的正式文件：可能有别的记录引用同一个哈希，由清理回收。错误原样抛出。
  - **`exclusive`：** 一个 `p-queue`，并发 1（D10）。`commit` 和第 4 步的清理都在它里面执行。
  - **`read`：**
    - 读 `pathOf(ref)`，文件不存在（`ENOENT`）时返回 `null`，由调用方返回 `image_file_missing`；
    - 读出的字节长度和 `ref.bytes` 不一致时，同样返回 `null`，并记 `warn` 事件 `image.store.mismatch`，因为文件被人换过。
  - **`clearTemp`：** 删掉 `tmp/` 下全部文件，启动时调用（D9）。
- [x] 4. **`illustration/gc.ts`。**

  ```ts
  export interface GcResult {
    sets: number;
    files: number;
    bytes: number;
  }
  export function collectGarbage(deps: { db: Database; store: ImageStore; now: number; logger: Logger }): Promise<GcResult>;
  export function referencedFiles(db: Database): Map<string, ImageFileRef>;
  export function storageSummary(db: Database): { files: number; bytes: number };
  ```

  **`collectGarbage` 整个在 `store.exclusive` 里执行，按顺序：**
  1. **删过期且未引用的预览。** 候选是 `scope = 'pending'` 的画风预览（`entity_id IS NULL`）和选定后等待开局的主角快照（`entity_id IS NOT NULL AND state = 'active'`）。只有超过预览保留期，并且开局、未移除插图及当前任务都未引用时才删除。主角的编辑草稿走下一小步：
     - 开局行引用参考组的两个地方是 `playthroughs.illustration` 的 `protagonistPortraitSetId` 和 `authorPortraitSetIds` 的值；
     - 用 `json_extract`、`json_each` 查，SQL 见下面的说明。
  2. **删不再需要的参考组。** 参考组保留的条件，满足任一条就留（§9.4「参考组」）：
     - 被开局行引用；
     - `state = 'active'`，并且 `scope = 'work'`，并且 `entity_id` 是现有人物：草稿或发布版本的 `entities` 里有这个 id，或者草稿 `meta.plan.items` 里有 `kind = 'entity'` 且 `id` 等于它的项；
     - `scope = 'playthrough'`：开局按需生成的基础参考组随开局保留，删除开局时由外键级联删除；
     - `state = 'draft'`，或上一步仍保留的画风预览、主角快照；
     - 被未移除的插图记录的 `reference_files` 或 `attempt_data.referenceFiles` 引用。未移除指 `status` 不是 `dismissed`、`cancelled`。

     其余的（主要是 `retired` 组和失去主人的组）删掉，计入 `sets`。
  3. **算仍被引用的文件**（`referencedFiles`），收集下面这些位置的 `hash`：
     - 留下的参考组：每个位置的 `file`，以及 `task` 里每个任务的 `inputFiles`；
     - 未移除的插图：`file`、`reference_files[*].file`、`attempt_data.referenceFiles[*].file`。
  4. **删文件。** 遍历 `blobs/`：文件名里的哈希不在引用里，并且 `mtime` 早于 `now - IMAGE_GC_GRACE_MS` 的，删掉，累计 `files` 和 `bytes`。
  5. **记录。** 记事件 `image.gc` 和样本 `image.gc`（§2.5）。

  - **SQL 写法：** JSON 列用 SQLite 的 `json_each`，例如 `SELECT value FROM playthroughs, json_each(playthroughs.illustration, '$.authorPortraitSetIds')`。不要把整张表读进内存再解析大 JSON：开局多了以后会慢。
  - **`storageSummary`：** `referencedFiles` 的结果按哈希去重后，累加 `bytes`（§9.5：无引用的待清理文件不计入）。
- [x] 5. **检查交接。** 核对 `storage.ts` 和 `gc.ts` 导出与第 3、4 步一致。T13 使用同一个 `createImageStore` 实例接 `storageSummary` 和 `collectGarbage`。
- [x] 6. **测试。** 用 `makeTempDataDir()` 和真的 `openDatabase`。造数据时照 `test-support/story-fixtures.ts` 的 `seedStory` 建作品、版本、开局、回合，再直接插 `portrait_sets`、`illustrations` 行。

  `storage.test.ts`：
  - `stage` 一张 `pngBytes(4, 4)`：`tmp/` 下有一个 `.part` 文件，`blobs/` 为空；`commit` 后 `blobs/<hash>.png` 存在，`tmp/` 为空，`transaction` 的返回值原样返回。
  - **相同内容只存一份：** 两次 `stage` 同样的字节再分别 `commit`，`blobs/` 下只有一个文件。
  - **事务失败：** `transaction` 抛错时，正式文件仍在，错误原样抛出。
  - **元数据：** `stage(pngBytes(1, 1, { textChunk: 'x' }), { rejectMetadata: true })` 抛 `ImageStoreError`，`stage === 'validate'`，`tmp/` 下没有残留。
  - **`read`：** 文件被删后返回 `null`；文件被换成不同长度的字节后返回 `null`，并记了 `image.store.mismatch`。
  - **互斥：** 用一个可控的 Promise，让一个 `exclusive` 任务卡住，同时调用 `commit`。在卡住的任务放行之前，`assertCurrent` 和 `transaction` 都没被调用。等待期间撤销权限后放行，守卫必须拒绝，临时文件消失，正式文件和数据库写入均为零。再用有效守卫提交一张图作阳性对照。

  `gc.test.ts`：
  - **引用的种类：** 七种引用各一条用例，都要被保留：开局引用的组、现有人物的 `active` 组、`draft` 组、未过期预览、插图的 `file`、插图的 `reference_files`、任务的 `inputFiles`。
  - **回收：** 一个没人引用的 `retired` 组被删；它独有的文件在超过保护期后被删。
  - **保护期：** 没人引用、但 `mtime` 在保护期内的文件不删。用 `utimesSync` 设置 `mtime`。
  - **主角快照：** 一组未引用的 `pending + active` 快照，在预览保留期内清理后仍能读取。超过保留期时回收；同样过期但被开局锁定的快照仍能读取。去掉未过期快照的保留条件，第一条变红。
  - **共享文件：** 两部作品的参考组引用同一个哈希，删掉其中一部作品（`DELETE FROM works`，级联删除它的参考组），清理后文件仍在；两部都删并超过保护期后，文件被删。这一条对应 [插图与出图服务 §14](../docs/image.md#14-验收) 的「两部作品分别引用同一图片」。
  - **方案人物：** 方案里还没确认的人物（只在 `meta.plan.items` 里）的 `active` 组被保留。
  - **`storageSummary`：** 同一个哈希被三处引用只算一次；孤儿文件不计入。

**接线点。** T13 在 `illustration/service.ts` 建立每个服务实例唯一的 `ImageStore`。调用方如下。

| 调用方 | 用什么 |
| --- | --- |
| T17 的导入、生成参考图 | `stage`、`commit` |
| T18 的插图保存 | `stage`、`commit` |
| T19 的取图 | `read` |
| T29 的启动清理 | `clearTemp`、`collectGarbage` |

**注意事项。**

- `transaction` 必须同步，里面不能 `await`（§0.2「事务里不 await」）。
- 清理和 `commit` 共用一把锁。漏掉这一点会出现 §9.3 说的「检查哈希文件就位之后、引用提交之前，清理把文件删了」，造出悬空引用。
- 本任务不决定**什么时候**清理。启动时和删除作品后的调用由 T29 加。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `storage.test.ts`、`gc.test.ts` 全绿 | 把 `commit` 改成不走 `exclusive`，或者把 `assertCurrent` 移到拿锁之前；等待期间撤销的用例分别变红 |
| 同上 | 去掉保护期判断：「保护期」那一条变红 |
| 同上 | 不把任务的 `inputFiles` 算作引用：「任务的 `inputFiles`」那一条变红 |
| 同上 | 不把方案项算作现有人物：「方案人物」那一条变红 |
| 两个存储导出供 T13 接线 | 删除任一个被测试直接导入的导出，类型检查变红 |

---

### T21 client：设置页的出图服务

**目的。** 设置页新增「出图服务」一节，见[插图与出图服务 §2](../docs/image.md#2-出图服务的配置)的操作表、§12 的按需启动：

- 添加、测试、选择、删除服务；
- 生成令牌；
- 按需启动的配置；
- 默认出图规格；
- 「游玩时生成插图」的确认；
- 用量和体量。

**依赖。** T20。

**拥有的文件。**

- 新建（在 `apps/client/src/features/settings/` 下）：
  - `ImageServiceSection.tsx`、`ImageServiceCard.tsx`、`AddImageServiceForm.tsx`、`TokenReveal.tsx`、`AutoIllustrationPanel.tsx`、`OutputDefaultsPanel.tsx`、`ImageUsagePanel.tsx`；
  - 对应的 `*.module.css`；
  - `ImageServiceSection.test.tsx`、`AutoIllustrationPanel.test.tsx`、`OutputDefaultsPanel.test.tsx`。
- 改：`SettingsPage.tsx`、`SettingsNav.tsx`、`apps/client/src/i18n/zh-CN/settings.json`。

**先读。**

- [插图与出图服务 §2](../docs/image.md#2-出图服务的配置) 全文、§12.1、§12.3；
- [插件 §3.2](../docs/plugins.md#32-鉴权)：令牌只显示一次；
- [设计准则](../docs/design-guidelines.md) 里设置页的部件；
- 现有的 `EndpointSection.tsx`、`EndpointCard.tsx`、`AddEndpointForm.tsx`：本任务的结构、表单写法、`baseRevision` 的传法、错误显示都照它们；
- `SettingsNav.tsx` 的 `SETTINGS_SECTION_IDS`；
- [a11y §9](../docs/a11y.md#9-创作页与工作站) 里表单的规则。

**步骤。**

- [x] 1. **核对前提。** T20 已合入：`rg -n "imageConfig" apps/client/src/shared/api/query.ts` 有命中。
- [x] 2. **`SettingsNav.tsx`。**
  - `SETTINGS_SECTION_IDS` 加 `images: 'settings-images'`；
  - 导航列表在 `models` 之后加 `{ id: SETTINGS_SECTION_IDS.images, labelKey: 'settings:nav.images' }`。
- [x] 3. **`SettingsPage.tsx`。** 在模型那一节之后加 `<ImageServiceSection />`。它自己发起查询，和模型那一节互不影响。
- [x] 4. **`ImageServiceSection.tsx`。**
  - 用 `useQuery(queryKeys.imageConfig, () => api.image.services.list())`。
  - `status` 不是 `ok` 时，复用 `ConfigProblem` 显示问题，并禁用所有写操作。写法同 `SettingsPage` 里的 `writesDisabled`。
  - **结构，从上到下：**
    1. 标题 `settings:images.heading`、说明 `settings:images.description`；
    2. 「用于出图」的选择：`RadioGroup`，选项是每个服务的名字，外加一项「不出图」。改选调用 `api.image.select({ baseRevision, serviceId })`；
    3. 每个服务一张 `ImageServiceCard`；
    4. `AddImageServiceForm`；
    5. `AutoIllustrationPanel`；
    6. `OutputDefaultsPanel`；
    7. `ImageUsagePanel`。
  - 没有任何服务时，只显示说明和添加表单。
- [x] 5. **`ImageServiceCard.tsx`。** 一张卡显示一个服务（`ImageServiceView`）。
  - **显示：**
    - 名字；
    - 协议：`settings:images.protocol.unwritten-image` 或 `.openai-images`；
    - 地址原样；
    - key 的状态，写法同 `EndpointCard` 的 key 显示；
    - `openai-images` 的模型 id；
    - 能力摘要：最多几张参考图；负面提示词是否生效；`maxReferences` 为 0 时显示 `settings:images.noReferences`（「只靠形象文字保持人物一致」，§4.3）；
    - **状态：** 最近一次探测的结果和时间，用 `shared/lib/format.ts` 的相对时间（按导出名找）；未就绪时显示原因，原因用 `settings:images.notReady.<原因>`，三个已知原因有文案，其他值显示 `settings:images.notReady.other`；最近成功出图的时间。
    - **实现名和版本：** 只在探测结果里有时显示（[插件 §2](../docs/plugins.md#2-边界)：只用来核对版本）。
  - **操作：**
    - 「测试连接」：调用 `api.image.services.test({ serviceId, target: 'service' })`，结果显示在卡内，失败时用 `ErrorNotice`。
    - 「生成测试图」：只对 `openai-images` 显示。先弹 `ConfirmDialog`，文案是 `settings:images.paidConfirm`（可能产生费用），确认后调用 `test({ …, paid: true })`；成功显示 `settings:images.testImageDone`。
    - 「编辑」：改名字、key、模型 id、OpenAI 能力、按需启动。地址只读显示，不能改。
    - 「删除」：`ConfirmDialog`。正在使用的服务，文案用 `settings:images.removeSelectedConfirm`（写明删除后会停止出图）。
  - **按需启动**（只对 `unwritten-image`）：
    - 子块标题 `settings:images.launcher.heading`；
    - 显示启动器地址和 key 状态、空闲分钟数；
    - 「测试启动器」：`test({ target: 'launcher' })`，显示实现名、版本、就绪状态、当前状态。状态用 `settings:images.launcherState.<状态>`。
    - 编辑时可以加上、移除启动器，改它的 key 和空闲分钟数。空闲分钟数用 `shared/ui/NumberField`，范围 `IDLE_MINUTES_MIN`–`IDLE_MINUTES_MAX`，从 contracts 取。
    - 生成启动器令牌同样用 `TokenReveal`。
- [x] 6. **`TokenReveal.tsx`。**
  - 一个按钮「生成令牌」，点了调用 `api.image.services.generateToken()`，在只读文本框里显示结果，旁边一个「复制」按钮（`navigator.clipboard.writeText`）。
  - 提示文案 `settings:images.tokenOnce`：只显示这一次，请复制到服务一侧。
  - **令牌只存在本次表单的 React state 里。** `TokenReveal` 以当前值和 `onChange` 接表单，生成后把值填进对应输入框。提交时直接传给 `create` 或 `update`，避免让 React Query 变更缓存持有含密钥的输入。提交成功或取消时清空，没有挂载的表单不保留该值（§2 第 4 条）。
- [x] 7. **`AddImageServiceForm.tsx`。**
  - **字段：**
    - 协议：两个选项；
    - 名称；
    - 地址；
    - key：`unwritten-image` 时旁边有 `TokenReveal`，也可以手填；
    - `openai-images` 时多一个模型 id。
  - **能力预填：** 模型 id 改变时，按 `gpt-image-2*` → 16 张、`custom`；`gpt-image-1.5`、`gpt-image-1-mini`、`chatgpt-image-latest` → 16 张、`fixed`；其他 → 0 张、`fixed`，预填「最多参考图」和「尺寸方式」两项，用户可以改。
    - 这张对照表和 core 的 `prefillOpenAiOptions` 重复。为了不让两处漂移，把它写成 `features/settings/openai-prefill.ts` 的纯函数，测试里用 core 那张表的同一组用例逐条核对，期望值写死。
    - 本任务新建 `openai-prefill.ts` 和 `openai-prefill.test.ts`，列进拥有的文件。
  - **可选的按需启动：** 一个复选框「通过启动器按需开关」，勾上后出现启动器地址、key（带 `TokenReveal`）、空闲分钟数（默认 `IMAGE_IDLE_MINUTES`）。
  - **地址警告：** 用明文 `http` 填非本机地址时，显示 `settings:images.plainHttpWarning`，同模型服务的警告。判断「本机」照 `AddEndpointForm` 现有的写法。
  - **提交：** 调用 `api.image.services.create({ requestId, baseRevision, … })`，`requestId` 在表单打开时生成一次，同一次提交重发时不变。
- [x] 8. **`AutoIllustrationPanel.tsx`**（§2「游玩时生成插图」）。
  - 查询 `api.image.autoIllustration.get()`，键是 `queryKeys.autoIllustration`。
  - **一个开关「游玩时生成插图」：**
    - **打开时**不直接开启，而是弹出 `ConfirmDialog`。确认框里分两段，接收方的名字从 `queryKeys.imageConfig`（服务名）和 `queryKeys.llm`（端点名、模型 id）取：
      - `settings:auto.backgroundReceives`：哪个 `background` 端点和模型接收正文片段、人物形象和镜头约束；
      - `settings:auto.serviceReceives`：哪个出图服务接收提示词和参考图，并提示「一张插图可能先生成多张参考图」。
    - 确认后调用 `set({ enabled: true, confirm: view.current })`。
    - **关闭时**直接调用 `set({ enabled: false, confirm: null })`。
  - `view.current === null` 时，开关禁用，下面写 `settings:auto.unavailable`（没选出图服务，或 `background` 用途没配好）。
  - `view.confirmed` 不为空、但 `enabled` 为 false 时，下面写 `settings:auto.reconfirm`：接收方变了，需要重新确认。
- [x] 9. **`OutputDefaultsPanel.tsx`**（§2「默认出图规格」）。
  - 查询 `api.image.outputPreferences.get()`。
  - 比例：「自动」或固定为 `aspects` 里的某一项。
  - 分辨率：`tiers` 里的每一档，文案用 `IMAGE_TIER_LABEL_KEYS`（T20），后面显示该档的实际宽×高：
    - 固定比例时只显示那个比例的尺寸；
    - 自动时显示「多个尺寸」，可以展开看每个比例的尺寸。
  - 只有一档时显示这一档，并写明 `settings:output.onlyTier`。
  - `preferenceAvailable` 为 false 时，提示 `settings:output.unavailable`。
  - 改动立即调用 `set`。字段名、自动比例和宽高用附录 A.4 的 `play:format.*`。
- [x] 10. **`ImageUsagePanel.tsx`。**
  - 查询 `api.image.usage.summary()` 和 `api.image.storage.summary()`。
  - 按服务列出最近 7 天、30 天的张数和 token，不显示费用（§11）。
  - 显示「插图和人物参考共占用 X」，`X` 用 `shared/lib/format.ts` 里已有的字节格式化函数；没有的话在本文件里写一个，只用 `Intl.NumberFormat`。
  - 隐私说明 `settings:images.privacy` 放在这一节末尾（§2 的「隐私说明」一行）。
- [x] 11. **i18n。** 照附录 A.2 加 `settings.json` 的键。
- [x] 12. **测试**（浏览器项目，`shared/test/render.tsx` 渲染，`createFakeApi` 注册处理函数）。

  `ImageServiceSection.test.tsx`：
  - **服务卡：** 伪接口返回两个服务，一个 `unwritten-image`、一个 `openai-images`。两张卡都能按服务名找到；`openai-images` 卡上有「生成测试图」，另一张没有。
  - **令牌：** 点「生成令牌」后，文本框里是伪接口返回的令牌；提交添加表单后，伪接口记到的 `create` 输入里 `apiKey` 等于这个令牌；表单关闭后，页面上找不到这个令牌（`queryByText` 为空）。
  - **地址只读：** 编辑表单里地址是只读的，`update` 的输入里没有 `baseUrl` 键。
  - **删除选中的服务：** 删除正在使用的服务时，确认框的文案是 `removeSelectedConfirm` 那一条。
  - **测试启动器：** 伪接口返回 `launcher.state: 'needs_action'`，显示对应的状态文案。
  - axe 没有违规。

  `AutoIllustrationPanel.test.tsx`：
  - 打开开关先出确认框，取消后伪接口**没有**收到 `set`；确认后收到 `set`，`confirm` 等于 `current`；
  - `current === null` 时开关禁用；
  - `confirmed` 不为空而 `enabled` 为 false 时，显示重新确认的提示。

  `OutputDefaultsPanel.test.tsx`：
  - 能力只有 `3:2` 的 `2k` 时，选「自动」能看到「非常高 · 2K」；固定 `3:4` 时看不到；
  - 改档位后伪接口收到 `set`。

  `openai-prefill.test.ts`：三类模型 id 各一条，期望值写死。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| `ImageServiceSection` | `SettingsPage.tsx`，1 处 |
| 导航项 | `SettingsNav.tsx` |
| 查询失效 | T20 的 `App.tsx` 已经处理 `image.config_changed`、`image.service_state` |

**注意事项。**

- 出图服务和模型服务的表单长得像，但**不要**把 `AddEndpointForm` 改成通用组件：那是改别的任务的文件，也是需求之外的抽象。照着写一份。
- 状态文字、原因文字、协议名都走 i18n；服务名、地址、模型 id、实现名原样显示。
- 本任务不显示唤醒提示：`WakePrompt` 由游玩页和创作页挂载。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 四个测试文件全绿 | 把令牌写进 `queryClient.setQueryData`。关闭表单后，直接遍历查询和变更缓存的值，断言独有的伪令牌不在其中。阳性对照是在同一个用例里先看到令牌显示、成功提交和实际配置缓存；重新打开表单后再检查界面 |
| 同上 | 打开开关时直接调用 `set`，不弹确认框：「取消后没有收到 `set`」变红 |
| 同上 | 编辑时把 `baseUrl` 也传给 `update`：typecheck 变红（契约里没有这个字段），记为突变通过 |
| `pnpm --filter @unwritten/client test` 全绿（含 `keys.test.ts`） | 删掉 `settings.json` 里一个用到的键：`keys.test.ts` 变红 |

---

### T22 client：创作页的画风与人物参考组

**目的。** 作者在创作页能：

- 在补充设定的「插图」里选默认画风并预览（[创作流程 §2](../docs/authoring-flow.md#2-写背景只补自己在意的设置)、[插图与出图服务 §6.3](../docs/image.md#63-画风)）；
- 在方案的人物项里写形象；
- 为固定人物导入或生成正面，按需补齐其他视角，然后采用（[插图与出图服务 §6.2](../docs/image.md#62-人物参考组)、[创作流程 §3](../docs/authoring-flow.md#3-确认故事方案再生成开场)）。

**依赖。** T20。

**拥有的文件。**

- 新建（在 `apps/client/src/features/authoring/` 下）：
  - `IllustrationStyleSection.tsx`、对应的 `*.module.css` 和 `*.test.tsx`。
- 新建（在 `apps/client/src/shared/ui/illustration/` 下）：
  - `StylePicker.tsx`、`StylePreview.tsx`、`PortraitSetEditor.tsx`、`PortraitSlotCard.tsx`，以及对应的 `*.module.css` 和 `*.test.tsx`。
  - 这四个组件 T23 也会复用，所以放在 `shared/ui/illustration/` 并导出，T23 从这里导入。
- 改：`SettingsSections.tsx`（在八节之后加「插图」）、`PlanItemEditor.tsx`（人物表单加形象）、`PlanItemCard.tsx`（显示形象和参考组入口）、`AuthoringPage.tsx`（挂 `WakePrompt`）、`apps/client/src/i18n/zh-CN/authoring.json`。

**先读。**

- [创作流程 §2–3](../docs/authoring-flow.md#2-写背景只补自己在意的设置)：作者看到的行为，这是本任务的验收依据；
- [插图与出图服务 §6.2](../docs/image.md#62-人物参考组)：位置、生成、导入、采用、复核；
- [a11y](../docs/a11y.md) 里「人物参考组的每个位置都有可读的名称和状态」那一段；
- 现有的 `SettingsSections.tsx`、`PlanItemEditor.tsx` 的 `EntityForm`、`PlanItemCard.tsx`、`AuthoringPage.tsx`。

**步骤。**

- [x] 1. **核对前提。** T20 已合入：`ls apps/client/src/shared/lib/image-import.ts apps/client/src/shared/ui/WakePrompt.tsx` 存在。
- [x] 1a. **文件位置。** 第 2、3、8、9 步的 `StylePicker`、`StylePreview`、`PortraitSetEditor`、`PortraitSlotCard` 放在 `apps/client/src/shared/ui/illustration/`；`IllustrationStyleSection` 留在 `features/authoring/`。
- [x] 2. **`StylePicker.tsx`。**

  ```tsx
  export function StylePicker(props: {
    value: IllustrationStyle;
    onChange: (style: IllustrationStyle) => void;
    authorDefault?: IllustrationStyle;
  }): JSX.Element;
  ```

  - `RadioGroup` 列出五个预设，文案用 `STYLE_PRESET_LABEL_KEYS`，外加一项「自己写」。选「自己写」时出现 `TextField`，上限 `ILLUSTRATION_STYLE_TEXT_MAX_LENGTH`，不能换行。
  - 传了 `authorDefault` 时（开局页用），多一个按钮「恢复作者默认」。
- [x] 3. **`StylePreview.tsx`。**

  ```tsx
  export function StylePreview(props: { workId: string; style: IllustrationStyle; viewWorkId: string }): JSX.Element;
  ```

  - 按钮「预览画风」：调用 `api.portrait.preview({ requestId, workId, style })`，拿到参考组 id 后用 `useQuery(queryKeys.portraitSet(workId, setId), () => api.portrait.get({ setId }))` 跟踪。`portrait.updated` 会让它失效。
  - 正面位置有图时，用 `useImageBlob({ view: { kind: 'work', workId: viewWorkId }, image: { kind: 'portrait', setId, slot: 'front' } }, set.updatedAt)` 显示。
  - 生成中显示 `GeneratingMarker`（按导出名找）；失败显示 `errors:<code>`。
  - 没有选出图服务（`queryKeys.imageConfig` 里 `selectedServiceId === null`）时，按钮禁用，旁边写 `authoring:style.noService`。
  - 示例图的 `alt` 用 `t('authoring:style.previewAlt')`：它是固定题材，不是作品内容。
- [x] 4. **`IllustrationStyleSection.tsx`。** 补充设定里的「插图」节（[创作流程 §2](../docs/authoring-flow.md#2-写背景只补自己在意的设置)那张表的「插图」一行）。
  - 只在配了出图服务时出现：`imageConfig.services.length > 0`。
  - 默认收起，用和其他节相同的折叠写法。
  - 内容：
    - `StylePicker`，值来自 `work.illustrationStyle ?? DEFAULT_ILLUSTRATION_STYLE`；
    - `StylePreview`。
  - **画风不随草稿保存。** 改动后立即调用 `api.works.setIllustrationStyle({ workId, style })`，成功后失效 `queryKeys.work(workId)`。不计入草稿的修订号（D26），所以不走 `useAutosave`。
  - 文案说明 `authoring:style.description`：作为新开局的默认值，玩家开局时可以改。
- [x] 5. **`SettingsSections.tsx`。**
  - 在八节之后渲染 `<IllustrationStyleSection work={…} />`。现在这个组件只拿到 `settings`，所以给它加一个可选 prop `work?: WorkDetail`，由 `AuthoringPage` 传入；没传时不渲染插图节。
  - 不改八节的现有行为。
- [x] 6. **`PlanItemEditor.tsx` 的 `EntityForm`。**
  - 人物（`entityKind === 'character'`）多一个 `TextArea`「形象」：
    - 上限 `APPEARANCE_MAX_LENGTH`，不能换行，回车不插入换行：用 `onKeyDown` 拦下 `Enter`；
    - 说明文字 `authoring:plan.appearanceHint`：只写此刻看得见的样子，不写身份和秘密；
    - 空字符串保存为 `null`。
  - 非人物不显示这个字段。
- [x] 7. **`PlanItemCard.tsx`。**
  - 人物卡显示形象。没有时显示 `authoring:plan.noAppearance`，这是作者可以选择不写的提示，不是错误。
  - 显示参考组入口「人物参考」，展开后渲染 `PortraitSetEditor`。
- [x] 8. **`PortraitSetEditor.tsx`。**

  ```tsx
  export function PortraitSetEditor(props: {
    workId: string;
    scope: 'work' | 'pending';
    target: PortraitTarget;
    appearance: string | null;
    mode: 'author' | 'player';
    onSnapshot?: (setId: string) => void;
  }): JSX.Element;
  ```

  - **数据：** `useQuery(queryKeys.portraitDraft(workId, scope, targetKey), () => api.portrait.draft({ workId, scope, target, appearance }))`。
  - **三个位置：** 用 `PortraitSlotCard` 渲染 `front`、`three_quarter`、`full_body`，位置名用 `PORTRAIT_SLOT_LABEL_KEYS`，每个位置下面的说明用 `authoring:portrait.slotHint.<位置>`，文字照 §6.2 表格的「内容」一列。
  - **按钮：**
    - 「补齐视角」：只在正面有图、并且选了出图服务时可用。依次对 `three_quarter`、`full_body` 调用 `api.portrait.generate`。
    - 「采用」：
      - `mode === 'author'`：调用 `api.portrait.adopt({ requestId, setId, expectedRev: draft.draftRev, mode: 'adopt', expectedActiveSetId: activeSetId })`；
      - `mode === 'player'`：按钮文字是「用作本局参考」，`expectedActiveSetId: null`，成功后调用 `onSnapshot(结果里的 activeSetId)`。
    - 「撤下」（只有作者）：`mode: 'retire'`。
  - **采用的条件：** 正面有图才可用，没有时禁用并写 `authoring:portrait.needFront`。
  - **待复核：** 有待复核的视角时，提示 `authoring:portrait.reviewHint`：替换正面后，其他视角要确认一下再采用。
  - **出错时：** `stale_revision` 时显示 `errors:stale_revision`，并重取草稿。其他错误用 `ErrorNotice`。
  - **生成设置：** 一个可折叠的「生成设置」，内容是比例和档位，选项取自 `queryKeys.imageOutput`。初次打开时比例用可用的竖图比例，优先 `3:4`，档位优先 `1k`（§6.2「默认使用可用的竖图比例，优先用 1K」）。生成时把选择作为 `format` 传给 `generate`。
- [x] 9. **`PortraitSlotCard.tsx`。**
  - **有图时：** `useImageBlob(…, set.updatedAt)` 显示缩略图，`alt` 是 `t('authoring:portrait.slotAlt', { slot: 位置名 })`。
  - **状态，用文字说明：**
    - 空；
    - 生成中，用 `GeneratingMarker`；
    - 失败，写原因，旁边有「重试」；
    - 待复核，旁边有「确认」，调用 `portrait.update` 的 `confirm`。
  - **操作按钮，按钮名里写明是哪个位置**（[a11y](../docs/a11y.md)）：
    - **「选择图片」：** 一个隐藏的 `<input type="file" accept="image/png,image/jpeg,image/webp">`，由按钮触发，键盘可用。选好后：
      1. `prepareImportedImage(file)`；
      2. 不合格时，在这个位置下面显示 `authoring:portrait.importProblem.<problem>`，**保留**已有的图；
      3. 合格时**先预览**，用 `URL.createObjectURL(prepared.file)` 显示，并在卸载或确认后 revoke；预览下面有「使用这张」「取消」；
      4. 点「使用这张」才调用 `api.portrait.upload({ requestId, setId, slot, expectedRev, file: prepared.file })`。
    - 「生成」：`portrait.generate`。正面没图时，非正面的位置不能生成，按钮禁用。
    - 「移除」：`portrait.update` 的 `remove`。
  - 导入错误用 `aria-describedby` 关联到这个位置（[a11y](../docs/a11y.md)「导入错误与对应位置关联」）。
- [x] 10. **`AuthoringPage.tsx`。** 在页面顶部工具栏下面挂 `<WakePrompt serviceId={imageConfig.selectedServiceId} />`；`imageConfig` 用 `useQuery(queryKeys.imageConfig, …)` 取。
- [x] 11. **i18n。** 照附录 A.5 加 `authoring.json` 的键。在补齐视角和生成主角参考的操作旁用 `portrait.sendNotice` 列出当前出图服务。三个位置的说明、导入错误和按钮名走静态键或固定枚举映射。
- [x] 12. **测试**（浏览器项目）。

  `IllustrationStyleSection.test.tsx`：
  - 没有出图服务时这一节不渲染；
  - 选「水彩」后伪接口收到 `works.setIllustrationStyle`，`style` 是 `{ kind: 'preset', preset: 'watercolor' }`；
  - **没有**调用 `works.saveDraft`。阳性对照：改背景时确实调用了 `saveDraft`，这一条在现有测试里已有，本测试只断言本次操作没有调用。

  `PortraitSetEditor.test.tsx`：
  - 三个位置都能按可读名称找到，名称里有位置名；
  - **导入：** 用 `OffscreenCanvas` 现画一张 PNG 包成 `File`，通过「选择图片」的 `input` 设置文件（`userEvent.upload`）。先出现预览，伪接口**没有**收到 `upload`；点「使用这张」后收到 `upload`，`slot` 正确，`file.name` 是 `portrait.webp` 或 `portrait.png`；
  - **导入不合格：** 内容是 `<svg/>`、`type` 写成 `image/png` 的文件：位置下面出现 `importProblem.type` 的文案，这个位置原来的图（伪接口返回有图）仍在；
  - 正面没图时「采用」禁用；
  - `mode='player'` 时按钮文字是「用作本局参考」，成功后 `onSnapshot` 收到参考组 id；
  - 伪接口对 `adopt` 返回 `stale_revision`：显示错误，并且重新调用了 `portrait.draft`；
  - axe 没有违规。

  `PlanItemEditor` 的现有测试加一条：人物表单有「形象」字段，输入后保存，`updatePlanItem` 的输入里 `appearance` 正确；在「形象」里按回车，值里没有 `\n`。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| `IllustrationStyleSection` | `SettingsSections.tsx`，由 `AuthoringPage` 传 `work` |
| `PortraitSetEditor` | `PlanItemCard.tsx`（作者）、T23 的开局页（玩家） |
| `WakePrompt` | `AuthoringPage.tsx`，1 处 |
| 形象字段 | `PlanItemEditor.tsx` 的 `EntityForm` |

**注意事项。**

- 不读 `file.name`，不显示原文件名（§6.2）。
- 参考图的 `alt` 不是作品内容，走 i18n；人物的称呼要放进 `alt` 时，按 `t(key, { name })` 插值。
- 正文、形象原文按纯文本渲染。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 选好文件后直接上传、跳过预览：「先出现预览，没有收到 `upload`」变红 |
| 同上 | 导入不合格时清掉这个位置的图：「原来的图仍在」变红 |
| 同上 | 画风改动走 `saveDraft`：「没有调用 `saveDraft`」变红 |
| `rg -n "WakePrompt" apps/client/src/features/authoring/AuthoringPage.tsx` 命中 1 处 | — |

---

### T24 client：游玩页的插图、大图与唤醒提示

**目的。** 玩家在游玩页看到插图，见[游玩流程 §2.1](../docs/gameplay-flow.md#21-插图)「读到插图」那张时刻表，以及[设计准则](../docs/design-guidelines.md)的插图部件、[动效](../docs/motion.md)、[a11y §8](../docs/a11y.md#8-游玩页)：

- 占位、到图、失败、重试；
- 大图、重画、保存、移除；
- 唤醒提示；
- 手记里的参考图缩略图。

**依赖。** T20。

**拥有的文件。**

- 新建（在 `apps/client/src/features/play/` 下）：
  - `IllustrationFrame.tsx`、`IllustrationLightbox.tsx`、`IllustrationFailed.tsx`、`useIllustrationActions.ts`、`illustration-layout.ts`；
  - 对应的 `*.module.css` 和测试；
  - `JournalPortrait.tsx`。
- 改：
  - `TurnArticle.tsx`、`PlayPage.tsx`、`JournalSubject.tsx`；
  - `apps/client/src/i18n/zh-CN/play.json`：只加附录 A.4 里标「T24」的键；
  - `apps/client/src/shared/lib/log.ts`：给 `ClientSample` 加插图可见样本变体；
  - `packages/tokens/tokens.json`：加 `--uw-color-image-dim`，见第 9 步。

**先读。**

- [游玩流程 §2.1](../docs/gameplay-flow.md#21-插图) 全文；
- [设计准则](../docs/design-guidelines.md) 的「插图」「参考图缩略图」两行部件；
- [动效](../docs/motion.md) 里插图的编排：占位呼吸、到图淡入、减少动态效果；
- [a11y §8](../docs/a11y.md#8-游玩页) 的「插图」；
- [主题](../docs/theme.md) 的 `--uw-color-image-dim`；
- 现有的 `TurnArticle.tsx`、`PlayPage.tsx`、`JournalSubject.tsx`、`anchors.ts`（`paragraphAnchorId`）。

**步骤。**

- [x] 1. **核对前提。**
  - T20 已合入。
  - `rg -n "image-dim" packages/tokens/tokens.json` 规划时零命中，由本任务加。
  - `rg -n "pulse" packages/tokens/tokens.json` 有命中：占位的呼吸用已有的 `--uw-motion-duration-pulse`。
- [x] 2. **`illustration-layout.ts`**（纯函数）。
  - `frameAspect(view)`：
    - 有完成图时用 `view.image` 的宽高；
    - 否则用 `view.format.size` 的宽高；
    - 再没有时用 `view.format.aspectPreference` 解析出的比例；
    - 都没有返回 `null`，表示自动比例尚未确定，只显示一行状态，不留画框。
  - `placementOf(turn)`：返回插图要插在哪一段之后。`para === 0` 时在第一段之前，`para === n` 时在第 n 段之后。
  - 测试：上面每种情况各一条。
- [x] 3. **`TurnArticle.tsx`。**
  - `turn.illustration` 不为空，并且 `status` 不是 `dismissed`、`cancelled` 时，在 `placementOf` 给出的位置插入 `<IllustrationFrame illustration={…} turnId={…} routeId={…} paraAnchorId={…} />`。
  - 为此 `TurnArticle` 加一个 prop `routeId: string`，`PlayPage` 传入。
  - 段落的 `id` 和 `tabIndex` 不变。
- [x] 4. **`IllustrationFrame.tsx`。** 按状态显示：

  | 状态 | 显示 |
  | --- | --- |
  | `queued`，服务状态是 `waking` | 有画框时框里写 `play:illustration.waking`；比例未定时写同一行状态文字 |
  | `queued`，服务状态是 `needs_action` | 有画框时框里写 `play:illustration.waitingAuth`；比例未定时写同一行状态文字 |
  | `queued` 或 `running`，`frameAspect` 为 `null` | 一行状态文字 `play:illustration.composing` |
  | `queued`，其他服务状态 | 画框，框里写 `play:illustration.queued` |
  | `running` | 画框，框里写 `play:illustration.drawing` |
  | `done` | 图片，见下 |
  | `failed` | `IllustrationFailed` |

  - 服务状态用 `useImageServiceState(illustration.serviceId)`。
  - **画框：**
    - `aspect-ratio` 用 `frameAspect`；
    - 宽度至多等于正文列，高度至多占阅读区可见高度的一半，超出时等比缩小并居中（[设计准则](../docs/design-guidelines.md)「插图」）；
    - 占位设 `aria-busy="true"`，状态文字放在框里，读屏能读到。
  - **完成图：**
    - 用 `useImageBlob({ view: { kind: 'route', routeId }, image: { kind: 'illustration', illustrationId } }, illustration.updatedAt)`；
    - 包在一个按钮里，按钮名称 `play:illustration.open`（「放大查看插图」）；
    - `<img alt={caption ?? t('play:illustration.altFallback')}>`；
    - 图片解码完成（`img.decode()` 或 `onLoad`）后淡入。
  - **取图失败**，`code === 'image_file_missing'` 时：显示 `play:illustration.missing`（「图片找不到了」）和「重画」按钮（§7.4）。
  - **深色主题**下图片上叠一层 `--uw-color-image-dim`，用伪元素或叠一个 `div`，不影响点击。
  - **画面说明**只在大图里显示，这里不显示（[设计准则](../docs/design-guidelines.md)）。
  - **阅读位置：** 画框出现或展开、图到达、收起、移除时，正在读的正文留在原处。用 `useFollowLatest`（按导出名找）现有的锚定办法；没有现成办法时，在改变高度前后各量一次锚点段落的 `getBoundingClientRect().top`，用 `scrollBy` 补偿差值。
  - **上报：** 在 `shared/lib/log.ts` 的 `ClientSample` 加与 T02 契约同形的 `client.illustration_visible` 变体。用 `performance.now()` 从本次挂载首次观察插图记录计到解码完成，调用 `reportSample(api, { metric: 'client.illustration_visible', durationMs, outcome: 'ok', requestId: illustration.id })`。用当前阅读页内的插图 id 记已上报状态，重画或渲染刷新时不会再报同一个 id。测试模拟两次解码，伪 `log.client` 只收到一条，类型检查覆盖契约。
- [x] 5. **`IllustrationFailed.tsx`。** 收成一行：
  - 原因：`errors:<code>`；`stage` 不为空时前面加 `ILLUSTRATION_STAGE_LABEL_KEYS[stage]`。
  - 按钮「重试」「不要这张图」，名称里写明是第几回合的插图：`t('play:illustration.retryNamed', { turn })`。
  - `code === 'image_output_format_unavailable'` 时，「重试」先打开一个小对话框，让玩家选这一次的比例和档位（选项取自 `queryKeys.imageOutput`），确认后调用 `retry` 并带上 `format`（§7.4「规格不可用」）。
- [x] 6. **`useIllustrationActions.ts`。** 封装 `api.illustration.retry`、`reroll`、`dismiss`：
  - 每次调用生成新的 `requestId`；
  - 成功后失效 `queryKeys.route(routeId)`；
  - 调用期间返回 `pending` 状态，供按钮禁用。
- [x] 7. **`IllustrationLightbox.tsx`。** Base UI 的 `Dialog`。
  - **内容：**
    - 大图；
    - 画面说明，作为对话框的描述（`Dialog.Description`）；
    - 实际分辨率：`t('play:illustration.resolution', { width, height })`。
  - **按钮：**
    - 「重画」：`reroll`。重画中，大图保持旧图，显示 `play:illustration.rerolling`；重画失败时，在大图里显示原因，旧图不变（§7.4）。
    - 「保存图片」：`<a href={blobUrl} download={…}>`，文件名 `illustration-<回合号>.<扩展名>`，扩展名按 `useImageBlob` 返回的 `mime` 从 PNG、JPEG、WebP 的固定对照表取。
    - 「不要这张图」：`dismiss`，关闭对话框。
  - **焦点：**
    - Esc 关闭后焦点回到插图按钮；
    - 移除插图后，焦点回到该图所属的段落；移除开场图后，焦点回到第一段（[a11y §8](../docs/a11y.md#8-游玩页)）。
- [x] 8. **`PlayPage.tsx`。**
  - 给 `TurnArticle` 传 `routeId`；
  - 顶部挂 `<WakePrompt serviceId={…} />`，`serviceId` 取页面上任一条未完成插图的 `serviceId`，没有时取 `imageConfig.selectedServiceId`；
  - **进入页面时预热：** 页面挂载、并且路线已加载时，调用一次 `api.image.prewarm({ playthroughId })`。失败时静默：预热失败不打扰阅读，诊断由 core 记。
    - `playthroughId` 取 `route.playthroughId`（T02 加、T12 填）。为 `null` 时不预热。
- [x] 9. **`packages/tokens/tokens.json`。** 加两个 token：
  - `color.image-dim`：浅色主题 `transparent`，深色主题在纯黑上取低透明度，例如 `rgb(0 0 0 / 12%)`；
  - `size.image-max-block`：数值 `50`，按视口高度的百分比用于“画框不超过阅读区可见高度的一半”；同时更新 `docs/theme.md`。
  - 然后跑 `node packages/tokens/build-css.mjs`（按现有的构建方式）、`node scripts/check-tokens.mjs` 和 token 契约测试。
  - 这是本任务唯一改 `packages/` 的地方。
- [x] 10. **`JournalSubject.tsx`、`JournalPortrait.tsx`。**
  - `subject.portrait` 不为空时，条目起始端显示一个小方块缩略图：
    - 用 `useImageBlob({ view: { kind: 'route', routeId }, image: { kind: 'portrait', setId, slot: 'front' } }, portrait.updatedAt)`；
    - `alt` 是 `subject.name`，即人物在主角口中的称呼，这是作品内容，原样用（[a11y §8](../docs/a11y.md#8-游玩页)）；
    - 小圆角，裁成正面头肩像（[设计准则](../docs/design-guidelines.md)「参考图缩略图」）。
  - `portrait` 为空时不显示，也不留空位。
- [x] 11. **动效。** 按[动效](../docs/motion.md)：
  - 占位呼吸用 `--uw-motion-duration-pulse`；
  - 到图淡入用 `--uw-motion-duration-fast` 加 `--uw-motion-ease-standard`；
  - **不做位移。**
  - `prefers-reduced-motion: reduce` 时占位不呼吸，图片直接出现或只做淡入（[docs/milestone-4.md](../docs/milestone-4.md) 验收「系统开启减少动态效果」）。
- [x] 12. **i18n。** 照附录 A.4 加标「T24」的键。
- [x] 13. **测试**（浏览器项目）。

  `IllustrationFrame.test.tsx`，每种状态一条：
  - `queued` 加 `waking`：框里有「正在唤醒出图服务」，`aria-busy="true"`；
  - `done`：有名为「放大查看插图」的按钮，`img` 的 `alt` 等于画面说明原文；
  - `done` 但取图返回 `image_file_missing`：显示「图片找不到了」和「重画」；
  - `failed` 加 `stage: 'generate'`：一行原因，「重试」按钮名称里有回合号；点「重试」后伪接口收到 `illustration.retry`；
  - `image_output_format_unavailable`：点「重试」先出现规格选择，确认后 `retry` 的输入里有 `format`；
  - `format` 为空的 `queued`：只有一行「正在构思画面」，没有画框元素。

  `IllustrationLightbox.test.tsx`：
  - 打开大图，`Dialog` 的描述是画面说明；
  - Esc 关闭后焦点回到插图按钮；
  - 点「不要这张图」后，伪接口收到 `dismiss`，焦点落在所属段落（`document.activeElement.id === paragraphAnchorId(turnId, para)`）；
  - 开场图（`para: 0`）移除后，焦点落在第一段。

  `TurnArticle` 现有测试加两条：
  - `para: 2` 的插图出现在第 2 段之后、第 3 段之前（比较 DOM 顺序）；
  - `status: 'dismissed'` 时不渲染。

  `JournalSubject` 加一条：有 `portrait` 时出现 `alt` 等于称呼的图片；没有时不出现。

  axe 在 `done`、`failed`、`queued` 三种状态下都没有违规。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| `IllustrationFrame` | `TurnArticle.tsx`，1 处 |
| `WakePrompt`、预热 | `PlayPage.tsx` |
| 缩略图 | `JournalSubject.tsx` |
| 样本上报 | `IllustrationFrame.tsx` |

**注意事项。**

- 插图画好或画失败都**不经宣告区播报**（[a11y §8](../docs/a11y.md#8-游玩页)），只有授权提示播报，由 `WakePrompt` 负责。
- `caption` 是 AI 输出，当纯文本放进 `alt` 和对话框描述，不当 HTML。
- 不在 client 里判断「这一局开没开插图」：没有插图记录就什么也不显示。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 把 `alt` 换成固定文案：「`alt` 等于画面说明原文」变红 |
| 同上 | 移除后不移焦点：焦点断言变红 |
| 同上 | 把插图插在第 `para + 1` 段之后：DOM 顺序断言变红 |
| `rg -n "image.prewarm\|WakePrompt" apps/client/src/features/play/PlayPage.tsx` 两个都命中 | — |
| `node scripts/check-tokens.mjs` 通过，`rg -n "image-dim" packages/tokens/tokens.json` 有命中 | — |

---

### T26 plugins/comfyui：ComfyUI 插件

**目的。** 实现 [ComfyUI 插件](../docs/comfyui-plugin.md)：一层包装服务，把 ComfyUI 接到 `unwritten-image/1` 上。另外三样：

- 工作流模板与参数绑定；
- 对 Colab 宿主的约定和笔记本；
- 伪 ComfyUI 与 pytest，以及给 `pnpm test:python` 用的启动脚本。

**依赖。** T03（`pyproject.toml`、`uv.lock`、`requirements.txt`）、T08（core 的一致性测试）、T25（`unwritten_colab`）。

**拥有的文件。** `plugins/comfyui/` 下除 T03 生成的三个文件以外的全部文件，都是新建：

```
plugins/comfyui/
  README.md
  comfyui.lock                ComfyUI 的仓库地址和 commit，两行：repo=…、commit=…
  models.lock.json            四个模型文件（格式同 T25 第 7 步）
  workflows/
    manifest.json             四份模板的参数绑定、默认尺寸、按 GPU 型号的分辨率清单
    t2i-best.json  t2i-fast.json  edit-best.json  edit-fast.json
  server/
    __init__.py
    app.py                    aiohttp 应用：鉴权中间件、路由
    config.py                 环境变量、上限、常量
    manifest.py               读 manifest.json、按 GPU 型号选清单、拼 /v1/info
    jobs.py                   任务表、幂等、队列、保留期
    comfy.py                  调 ComfyUI 的 /prompt、/history、/interrupt
    workflow.py               按绑定填模板、删掉没用的参考图槽位
    images.py                 校验参考图、重新编码成 WebP
    selftest.py               启动自检
    state_file.py             写 /tmp/unwritten-comfyui.state
    __main__.py               python -m server 的入口
  colab_service.py            对 Colab 宿主的约定（ComfyUI 插件 §8.1）
  colab.ipynb                 只放代码的笔记本
  tests/
    conftest.py
    fake_comfy.py             伪 ComfyUI
    serve_with_fakes.py       给 pnpm test:python 用的启动脚本
    test_auth.py  test_jobs.py  test_workflow.py  test_images.py  test_selftest.py  test_manifest.py  test_state_file.py
```

**先读。**

- [ComfyUI 插件](../docs/comfyui-plugin.md) 全文；
- [插图与出图服务 §3](../docs/image.md#3-unwritten-图像协议)：协议的字段和错误码以这里为准；
- [插件 §3–4](../docs/plugins.md#3-协议的共同规则)；
- [Colab 宿主 §4](../docs/colab-host.md#4-宿主与服务的约定)。

**步骤。**

- [x] 1. **核对前提。**
  - T03、T25 已合入：`uv sync --directory plugins/comfyui` 成功；`ls selfhost/colab/unwritten_colab/run.py` 存在。
  - T08 已合入：`ls packages/core/src/image/conformance/unwritten-image.conformance.test.ts` 存在。
- [ ] 2. **模板与锁定文件。**
  - **`workflows/*.json`：** 从 ComfyUI 官方的 Qwen-Image-2.1 模板用「导出（API）」导出（§5），按 §5 的表调整采样参数。
    - **这一步要在一台装了 ComfyUI 的机器上做。** 执行者做不了时，停下来汇报，由维护者导出后放进来。**不要凭空编写节点图。**
    - 拿到模板之前，后面的代码和测试照样能写：测试用 `tests/` 里的最小模板（第 10 步）。
  - **`manifest.json`：**

    ```json
    {
      "templates": {
        "t2i-best": {
          "file": "t2i-best.json",
          "prompt": ["<节点 id>", "<输入名>"],
          "seed": ["…", "…"],
          "width": ["…", "…"],
          "height": ["…", "…"],
          "references": [],
          "negativePromptEffective": false
        }
      },
      "defaultSizes": {
        "best": { "3:2": [2528, 1696] },
        "fast": { "3:2": [1264, 848] }
      },
      "resolutions": {
        "NVIDIA A100-SXM4-40GB": { "3:2": { "1k": [1536, 1024] } }
      },
      "maxReferences": 10,
      "maxReferenceBytes": 8388608,
      "maxPromptLength": 4000,
      "queueMax": 8
    }
    ```

    - `edit-*` 模板的 `references` 是长度 10 的数组，每项 `{ "loadImage": "<节点 id>", "encoderInput": ["<编码节点 id>", "image_N"] }`。
    - **`defaultSizes`：**
      - `best` 照 §4 的原生尺寸，`fast` 是它的宽高减半后取最近的 16 的倍数（§5），覆盖 §4 列出的七个比例；
      - 两者都覆盖的这七个比例就是 `/v1/info` 的 `aspects`，必须包含 `3:2` 和 `3:4`。
    - **`resolutions`：** 规划时没有任何 GPU 型号验证过，**先留空对象 `{}`**。等 T31 实机验证后，由维护者填（§5「分辨率档按 GPU 型号写在 `manifest.json` 里」）。
  - **`models.lock.json`：**
    - 四个文件的 `repo` 是 `Comfy-Org/Qwen-Image-2.1`，`path` 照 §4 的表；
    - `commit`、`size`、`sha256` 要从 Hugging Face 上核对后填：用 `curl -sI https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/<commit>/<path>` 看 `x-linked-size` 和 `x-linked-etag`，etag 就是 sha256；
    - 核不到时停下来汇报，**不要编造哈希**。
  - **`comfyui.lock`：** 写 ComfyUI 仓库地址和一个发布满两周的 commit，记进台账。
- [x] 3. **`server/config.py`。**
  - 从环境变量读：
    - `UNWRITTEN_IMAGE_TOKEN`：必填，短于 32 个字符时 `sys.exit` 并打印 `token too short`，**不打印令牌**；
    - `UNWRITTEN_IMAGE_PORT`：默认 8190；
    - `COMFY_URL`：默认 `http://127.0.0.1:8188`；
    - `COMFY_INPUT_DIR`、`COMFY_OUTPUT_DIR`；
    - `UNWRITTEN_GPU_NAME`：测试用，覆盖 `nvidia-smi` 的读数。
  - 常量：
    - `RESULT_RETENTION_S = 600`；
    - `WEBP_QUALITY = 92`；
    - `MAX_REFERENCE_EDGE = 4096`；
    - `POLL_INTERVAL_S = 1`。
- [x] 4. **`server/app.py`**（§6.2 的表）。
  - **启动：** aiohttp 应用，`client_max_size = maxReferences × ceil(maxReferenceBytes × 4 / 3) + 65536`，只监听 `127.0.0.1`。
  - **鉴权中间件：**
    - 拦在所有路由前面，用 `hmac.compare_digest` 比较 `Authorization: Bearer <令牌>`；
    - 不匹配返回 401 和 `{"error": {"code": "unauthorized", "message": "unauthorized"}}`。
  - **所有响应**：不加任何 `Access-Control-*` 头，不返回 3xx。
  - **路由：**

    | 方法和路径 | 处理 |
    | --- | --- |
    | `GET /v1/info` | `manifest.info(ready, reason, queue)` |
    | `POST /v1/jobs` | `jobs.submit` |
    | `GET /v1/jobs/{id}` | `jobs.status` |
    | `GET /v1/jobs/{id}/image` | `jobs.image`，`Content-Type: image/webp` |
    | `DELETE /v1/jobs/{id}` | `jobs.cancel`，返回 204 |

  - **错误响应**全部用 `{"error": {"code", "message"}}`，`message` 用英文短句，不带用户内容。
- [x] 5. **`server/manifest.py`。**
  - **GPU 型号：** 运行 `nvidia-smi --query-gpu=name --format=csv,noheader`，取第一行，`UNWRITTEN_GPU_NAME` 可以覆盖它；用这个型号在 `resolutions` 里查清单，查不到时 `resolutions` 为空。
  - **`info()` 返回 `/v1/info` 的 JSON**（[插图与出图服务 §3.2](../docs/image.md#32-get-v1info)）：
    - `protocol`：`unwritten-image/1`；
    - `implementation`：`{ "name": "ComfyUI", "version": <pyproject 的 version> }`，版本用 `tomllib` 读 `pyproject.toml`；
    - `model`：`Qwen-Image-2.1`；
    - `ready`、`notReadyReason`、`queue`；
    - `capabilities` 里：
      - `qualities`：`["fast", "best"]`；
      - `aspects`：`defaultSizes.best` 的键；
      - `resolutions`：本机型号的清单；
      - `seed`：`true`；
      - `negativePrompt`：四份模板的 `negativePromptEffective` 全为 true 时才是 true（§5）；
      - `maxReferences`、`maxReferenceBytes`、`maxPromptLength`：照 manifest。
  - `size_allowed(aspect, width, height)`：尺寸在本机清单里有才算允许。
- [x] 6. **`server/jobs.py`**（§6.2 的「`POST /v1/jobs`」「执行」「保留期」「幂等」）。
  - **`submit` 按顺序校验，任一条不过就返回对应的错误码，并且不入队：**
    1. 字段类型和必填，不过返回 `invalid_request`；
    2. `prompt` 不超过 `maxPromptLength`；
    3. 参考图张数，超过返回 `too_many_references`；
    4. 每张 base64 解码后的大小，超过返回 413 `reference_too_large`；
    5. `aspect`，不支持返回 `unsupported_aspect`；
    6. `quality`，不支持返回 `unsupported_quality`；
    7. `size` 不在本机清单里返回 `unsupported_size`；
    8. 用 `images.load_reference` 校验每张参考图。
  - **幂等：** 键是 `idempotencyKey`，值是「请求体的规范化 JSON 的 sha256」和任务 id。规范化 JSON 用 `json.dumps(…, sort_keys=True, separators=(",", ":"))`：
    - 同一个键、同一个哈希，返回原任务；
    - 同一个键、不同哈希，返回 409 `idempotency_conflict`。
  - **队列：** 容量 `queueMax`，满了返回 429 `busy`，带 `Retry-After: 5`。
  - **执行：** 一个后台任务，**一次只跑一个**：
    1. 按 `quality` 和有没有参考图选模板：没参考图用 `t2i-*`，有参考图用 `edit-*`；
    2. 填好模板；
    3. 用 `comfy.py` 提交、轮询、读输出；
    4. 用 `images.encode_result` 重新编码；
    5. 删掉输入和输出目录里这个任务的文件；
    6. 把结果放进内存。
  - **保留期：** 结果完成 `RESULT_RETENTION_S` 后丢弃，幂等键随之失效。
  - **状态文件：** 每次任务开始、结束时，用 `state_file.write` 更新 `inFlight` 和 `lastActivityAt`。
  - **日志：** 只记任务 id、状态和耗时，不记提示词和图片。用 `logging`，格式里不放请求体。
- [x] 7. **`server/workflow.py`**（§5 的绑定、删除没用的槽位、`{{ref:N}}`）。
  - **`fill(template, binding, request, ref_files)`** 返回填好的副本，不修改传入的 `template`：
    - 把 `{{ref:N}}` 换成 `<imageN>`；
    - 填进提示词、seed、宽、高。seed 为空时用 `secrets.randbelow(2**31)`，并把实际值返回给调用方；
    - 第 1 到 `len(ref_files)` 个槽位的 `LoadImage` 节点填文件名；
    - 其余槽位：删掉对应的 `LoadImage` 节点，并从编码节点的输入里删掉那个 `image_N` 键（§5）。
  - **输出尺寸：** 请求有 `size` 时用它；没有时用 `defaultSizes[quality][aspect]`。
- [x] 8. **`server/images.py`。**
  - **`load_reference(data_bytes)`：**
    - 用 Pillow 的 `Image.open` 打开，`verify()`；
    - 再重新打开并 `convert("RGB")`；
    - 宽或高超过 `MAX_REFERENCE_EDGE` 时拒绝，返回 `invalid_request`；
    - 打不开时返回 `invalid_request`。
  - **`encode_result(path)`：**
    - 打开 ComfyUI 的输出，用 `img.save(buf, "WEBP", quality=WEBP_QUALITY)`；
    - **不传 `exif`、`icc_profile`、`xmp` 参数**，所以不带元数据（§6.2「结果」）；
    - 返回字节。
- [x] 9. **`server/selftest.py`、`state_file.py`、`__main__.py`。**
  - **`selftest.run()`**（§6.4）：
    - 用固定的英文提示词 `a plain ceramic cup on a wooden table, soft daylight` 和默认尺寸，先跑两份文生图，再拿文生图的结果当参考图跑两份编辑；
    - 四份都成功才 `ready = True`；
    - 失败时 `notReadyReason` 是 `out_of_memory` 或 `workflow_error`（§6.3 的映射），进程不退出。
  - **`state_file.write(path, *, ready, reason, in_flight, last_activity_at)`：** 先写到同目录的临时文件，再 `os.replace` 覆盖。路径固定 `/tmp/unwritten-comfyui.state`，测试里用环境变量 `UNWRITTEN_STATE_FILE` 覆盖。
  - **`__main__.py`：** 读配置，启动 aiohttp，后台跑自检，状态是 `starting`，结束后写状态文件。
- [x] 10. **测试。**
  - **`tests/fake_comfy.py`：** aiohttp 写的伪 ComfyUI（§10），实现：
    - `POST /prompt`：记下收到的图，返回 `prompt_id`；可配置成返回节点错误；
    - `GET /history/{id}`：几次轮询后出现输出；可配置成执行出错，信息里有 `CUDA out of memory`；
    - `POST /interrupt`；
    - `GET /system_stats`；
    - 输出：往输出目录写一张带 `tEXt` 元数据的 PNG。
  - **`tests/` 里的最小模板：** 测试不用真的官方模板，自带一个最小的模板目录 `tests/workflows/`，四份模板各几个节点，加一份对应的 `manifest.json`。
  - **用例：**

    | 文件 | 用例 |
    | --- | --- |
    | `test_auth.py` | 不带令牌、错的令牌都是 401；所有响应没有 `access-control-*` 头；令牌短于 32 个字符时进程退出，退出信息里不含令牌 |
    | `test_jobs.py` | §3.6 的每个请求级错误码各一条；幂等的两种情况；队列满返回 429 并带 `Retry-After`；尺寸不在清单里时返回 `unsupported_size`，并且伪 ComfyUI **没收到**任何 `/prompt`（阳性对照：合法请求时收到了）；完成后 `/image` 是 WebP；`DELETE` 后取图 404；保留期过后取图 404（用可注入的时钟）；任务结束后输入和输出目录里没有这个任务的文件；伪 ComfyUI 返回显存不足时，任务以 `out_of_memory` 失败 |
    | `test_workflow.py` | 两张参考图时，只剩两个 `LoadImage` 节点，编码节点上只有 `image_1`、`image_2`；`{{ref:2}}` 变成 `<image2>`；传入的模板对象没被修改 |
    | `test_images.py` | 输出 PNG 带 `tEXt`，重新编码后的 WebP 没有 EXIF、XMP 和文本：用 Pillow 打开后 `img.info` 里没有 `exif`、`xmp`，再用 T07 同样的规则查 RIFF 块里没有 `EXIF`、`XMP ` |
    | `test_manifest.py` | `UNWRITTEN_GPU_NAME` 设成清单里有的型号时报告 `resolutions`，设成没有的型号时 `resolutions` 为 `{}`；`negativePromptEffective` 有一份为 false 时，`negativePrompt` 为 false |
    | `test_selftest.py` | 四份都成功时 `ready`；把一份模板的输入名改坏，伪 ComfyUI 返回节点错误：`ready` 为 false，原因是 `workflow_error`，`/v1/info` 照常可读 |
    | `test_state_file.py` | 任务开始时 `inFlight` 为 1，结束后为 0，`lastActivityAt` 更新 |
- [x] 11. **`tests/serve_with_fakes.py`**（T03 第 4 步的约定）。
  1. 起伪 ComfyUI；
  2. 用随机令牌启动包装：`secrets.token_urlsafe(32)`，端口用 0 让系统分配，`UNWRITTEN_GPU_NAME` 设成测试清单里的型号；
  3. 等自检完成；
  4. 打印两行 `UNWRITTEN_CONFORMANCE_URL=http://127.0.0.1:<端口>`、`UNWRITTEN_CONFORMANCE_TOKEN=<令牌>`，`flush`；
  5. 一直运行到收到 `SIGTERM`。

  它用 `tests/workflows/` 的最小模板，所以 `pnpm test:python` 不需要 GPU。
- [x] 12. **`colab_service.py`**（§8.1、§8.2）。定义 `SERVICE = HostedService(...)`：
  - `name="comfyui"`、`hostname="unwritten-image"`、`tag="tag:unwritten-image"`；
  - `token_secret="UNWRITTEN_IMAGE_TOKEN"`、`authkey_secret="TS_AUTHKEY_IMAGE"`；
  - `min_vram_gib=24`、`min_ram_gib=None`、`port=8190`；
  - `models_lock=Path(__file__).parent / "models.lock.json"`。
  - **`prepare(paths)`：**
    1. 按 `comfyui.lock` 浅克隆 ComfyUI 到 `/content/ComfyUI`，先 `git clone --filter=blob:none`，再 `git checkout <commit>`；
    2. `pip install -r requirements.txt`，再 `pip install --require-hashes -r plugins 的 requirements.txt`；
    3. 写 `extra_model_paths.yaml`，指向 `paths.models_dir`。
  - **`start(paths, token)`：** 用 §3 的参数启动 ComfyUI，等 `/system_stats`；再用 `python -m server` 启动包装，令牌经环境变量 `UNWRITTEN_IMAGE_TOKEN` 传入。返回两个进程。
- [x] 13. **`colab.ipynb`。** 只有两个代码单元格，**没有 markdown 单元格，也没有注释**：
  1. `IDLE_SHUTDOWN_MINUTES = 30`，挂载 Drive，把 Drive 上 `unwritten/colab` 加进 `sys.path`，`import unwritten_colab`；
  2. 把 Drive 上 `unwritten/comfyui/code` 加进 `sys.path`，`from colab_service import SERVICE`，然后 `unwritten_colab.run(SERVICE, mode="notebook", idle_minutes=IDLE_SHUTDOWN_MINUTES)`。

  用 `json` 模块生成这个文件，不要手写 JSON；`cells` 里的每个单元格 `cell_type` 都是 `"code"`，`outputs` 为空。
- [x] 14. **`README.md`。** 第一段链接 [Qwen Research License](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)（§4「许可」）。然后是入口地图，以及「在 Colab 上运行」「在本机运行」「按需启动」三节操作步骤，内容对应 §8.3、§9、§8.4。不超过 150 行。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| 一致性测试 | `pnpm test:python` 经 `tests/serve_with_fakes.py` 对着包装运行 core 的 T08 测试 |
| Colab 部署 | `colab.ipynb` 调用 `unwritten_colab.run` |
| 由启动器启动 | T28 的 `bootstrap.py` 导入 `colab_service.SERVICE` |

**注意事项。**

- 不装 ComfyUI-Manager，不装任何自定义节点（§7）。
- 只用 safetensors（§4）。
- 包装和 ComfyUI 都只监听 `127.0.0.1`。
- **不写注释**，笔记本也一样。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `uv run --frozen --directory plugins/comfyui pytest -q` 全绿 | `encode_result` 里加 `exif=img.info.get("exif", b"")`，再让伪 ComfyUI 的 PNG 带 `eXIf`：`test_images.py` 变红 |
| 同上 | 把尺寸校验挪到入队之后：「伪 ComfyUI 没收到 `/prompt`」变红 |
| 同上 | 去掉删除没用槽位的逻辑：`test_workflow.py` 变红 |
| `pnpm test:python` 的一致性测试对包装全绿 | 让包装的鉴权中间件放过 `/v1/info`：一致性测试的前两条变红 |
| `ruff check`、`ruff format --check` 通过；`rg -n "^\s*#" plugins/comfyui --glob '*.py'` 零命中 | — |
| `python -c "import json;nb=json.load(open('plugins/comfyui/colab.ipynb'));print({c['cell_type'] for c in nb['cells']})"` 输出 `{'code'}` | — |

---

### T27 selfhost/strata：Strata 网关

**目的。** 实现 [Strata 自建模型服务](../docs/strata.md) 的网关：

- 校验令牌；
- 只放行两个接口；
- 限制输入；
- 原样转发流式响应；
- 写状态文件；
- 反复自检。

另外加上对 Colab 宿主的约定和笔记本。Strata 本身不在仓库里，按版本安装。

**依赖。** T03、T25。

**拥有的文件。** `selfhost/strata/` 下除 T03 生成的三个文件以外的全部文件，都是新建：

```
selfhost/strata/
  README.md
  strata.lock.json            发布版本、发布目录地址、引擎版本（Strata §4）
  models.lock.json            Qwen3.8-Flash-Next Q2_0 的文件（格式同 T25 第 7 步）
  gateway/
    __init__.py  app.py  config.py  forward.py  selftest.py  health.py  state_file.py  __main__.py
  colab_service.py
  colab.ipynb
  tests/
    conftest.py  fake_strata.py
    test_auth.py  test_allowlist.py  test_body.py  test_forward.py  test_cancel.py  test_selftest.py  test_health.py  test_logging.py
```

**先读。** [Strata 自建模型服务](../docs/strata.md) 全文，尤其是 §3、§5、§6 的表、§7、§8。

**步骤。**

- [x] 1. **核对前提。** T03、T25 已合入。
- [x] 2. **锁定文件。**
  - **`strata.lock.json`：** `{ "version": "<版本>", "feed": "https://github.com/Niko1221/Strata/releases/download/v<版本>", "engine": "<配套的引擎版本>" }`。版本照 [Strata §4](../docs/strata.md#4-strata-与模型)，从发布页核对，写进台账。
  - **`models.lock.json`：** 列出 `ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF` 里 Q2_0 那一组文件，以及 Strata 首次启动时另外下载的附属文件（§4「模型文件钉版本」）。`commit`、`size`、`sha256` 的核对方法同 T26 第 2 步，核不到时停下来汇报。
- [x] 3. **`gateway/config.py`。**
  - **环境变量：**
    - `UNWRITTEN_LLM_TOKEN`：必填，至少 32 个字符；
    - `STRATA_INTERNAL_KEY`：必填；
    - `UNWRITTEN_LLM_PORT`：默认 8191；
    - `STRATA_URL`：默认 `http://127.0.0.1:8080`。
  - **常量：**
    - `LLM_GATEWAY_MAX_BODY_BYTES = 8 * 1024 * 1024`；
    - `STRATA_HEALTH_INTERVAL_S = 60`；
    - `STRATA_LOAD_TIMEOUT_S = 1800`。
- [x] 4. **`gateway/app.py`**（§6 的表）。
  - aiohttp，`client_max_size = LLM_GATEWAY_MAX_BODY_BYTES`，只监听 `127.0.0.1`。
  - **鉴权中间件：** 同 T26 第 4 步。错误格式用 OpenAI 的 `{"error": {"message", "type", "code"}}`（§6「错误格式」）。
  - **路由只有两个：** `GET /v1/models`、`POST /v1/chat/completions`。其余方法和路径一律 404，**不转给 Strata**。用一个兜底路由 `app.router.add_route("*", "/{tail:.*}", not_found)`。
  - **请求体检查**（只对 `POST /v1/chat/completions`）：
    - 必须是 JSON 对象，不是时返回 400；
    - `messages` 里每条消息的 `content` 是字符串，或者是数组且每一项的 `type` 都是 `"text"`；有图片、音频、文件内容块时返回 400（§6「请求体」）；
    - **不检查**顶层的其他字段（§12 已知限制「网关不限制请求体的顶层字段」）。
  - **就绪闸门：** 自检通过之前，这两个接口返回 503。
- [x] 5. **`gateway/forward.py`**（§6「转发」「取消」「重定向与 CORS」）。
  - 用 `aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=10))`：**显式关掉总时长上限**，因为默认的 300 秒会截断长回答。
  - **请求头：** 只带 `Content-Type`、`Accept`，再加 `Authorization: Bearer <内部 key>`。不转发调用方的其他头。
  - `allow_redirects=False`。上游返回 3xx 时以 502 回应。
  - **响应：**
    - 去掉所有 `Access-Control-*` 头；
    - 用 `web.StreamResponse` 按块转发：上游每收到一块就 `await resp.write(chunk)`，**不缓冲**；
    - 调用方断开（`asyncio.CancelledError`，或 `request.transport.is_closing()`）时，立即关闭到上游的响应和连接。
  - **日志：** 只记方法、路径、状态码和耗时（§6「日志」）。
  - **状态文件：** 请求开始和结束时更新 `inFlight`、`lastActivityAt`。
- [x] 6. **`gateway/selftest.py`**（§7）。
  - 固定请求：
    - `messages` 只有一条 user 消息 `Call the ping tool with the word ok.`；
    - `tools` 里有一个 `ping` 工具，只有一个字符串参数 `word`；
    - `tool_choice` 设成要求调用它；
    - `stream: true`，`reasoning_effort: "none"`。
  - 直接调用 `forward.py` 的转发函数，**不经过对外的就绪闸门**。
  - **成功的标准：** 流式结果里拼出一个 `ping` 调用，`arguments` 能 `json.loads` 成 `{"word": <字符串>}`。
  - **反复尝试：** 每 `STRATA_HEALTH_INTERVAL_S` 一次，每次最多等这么久。
  - **超时：** 超过 `STRATA_LOAD_TIMEOUT_S` 停止重试。最后一次拿到了完整回答、但没有合法的 `ping` 调用时，原因是 `self_test_failed`；否则是 `load_timeout`。
- [x] 7. **`gateway/health.py`**（§6「就绪」）。
  - 从启动起每 `STRATA_HEALTH_INTERVAL_S` 请求一次 `GET {STRATA_URL}/health`。
  - 连不上时，原因设成 `engine_down`，优先于 `starting`（§7）。
  - 重新连上后：自检还没通过就回到 `starting`，已经通过就回到就绪。
- [x] 8. **`state_file.py`、`__main__.py`。** 写法同 T26 第 9 步，路径 `/tmp/unwritten-strata.state`。`__main__` 同时启动网关、自检循环、健康检查循环。
- [x] 9. **测试。**
  - **`tests/fake_strata.py`：** aiohttp 写的伪 Strata（§11）。
    - 实现 `/health`、`/v1/models`、`/v1/chat/completions`：流式和非流式，带工具调用；
    - 记下收到的请求，包括请求头；
    - 可配置：加载中（前 N 次请求返回 503）；不调用工具；流式时每块之间停一段时间；返回 302；响应带 `Access-Control-Allow-Origin`。
  - **用例：**

    | 文件 | 用例 |
    | --- | --- |
    | `test_auth.py` | 缺令牌、错令牌返回 401；令牌短于 32 个字符时进程退出，信息里不含令牌 |
    | `test_allowlist.py` | `/health`、`/settings`、`/config`、`/load`、`/mcp`、`/v1/messages`、`/`、`PUT /v1/models` 都返回 404，伪 Strata 一个都没收到（阳性对照：`/v1/models` 收到了） |
    | `test_body.py` | 超过上限返回 413；不是 JSON 对象返回 400；`image_url` 内容块返回 400，伪 Strata 没收到；纯文本数组内容放行；未知顶层字段放行 |
    | `test_forward.py` | 伪 Strata 收到的 `Authorization` 是内部 key，**不是**调用方的令牌；调用方的 `X-Custom` 头没被转发；伪 Strata 返回的 CORS 头被去掉；302 变成 502；流式时第一块在伪 Strata 写出第二块**之前**就到达调用方：伪 Strata 写完第一块后等一个 `asyncio.Event`，测试收到第一块后才放行这个 `Event` |
    | `test_cancel.py` | 调用方读到第一块后断开连接，伪 Strata 那边的写操作随后失败，或者它记录到连接关闭 |
    | `test_selftest.py` | 伪 Strata 前三次返回 503、之后正常：自检最终通过，状态文件变成就绪；伪 Strata 一直不调用工具：超时后原因是 `self_test_failed`；伪 Strata 一直 503：原因是 `load_timeout`。用可注入的时钟和睡眠，不真等 30 分钟 |
    | `test_health.py` | `/health` 连不上时原因是 `engine_down`，恢复后回到就绪 |
    | `test_logging.py` | 带一个特征字符串 `SENTINEL-PROMPT-42` 发请求，捕获日志（`caplog`），日志里找不到它；阳性对照：日志里有这一次请求的路径和状态码 |
- [x] 10. **`colab_service.py`**（§8）。
  - `SERVICE`：`name="strata"`、`hostname="unwritten-llm"`、`tag="tag:unwritten-llm"`、`token_secret="UNWRITTEN_LLM_TOKEN"`、`authkey_secret="TS_AUTHKEY_LLM"`、`min_vram_gib=12`、`min_ram_gib=48`、`port=8191`、`models_lock`。
  - **`prepare(paths)`：**
    1. `pip install --require-hashes -r requirements.txt`；
    2. 下载 `strata.lock.json` 指定版本的安装脚本，用 `STRATA_FEED=<feed>` 运行（§4「安装」）。
  - **`start(paths, token)`：**
    1. 生成内部 key：`secrets.token_urlsafe(32)`；
    2. 用 §5 的完整参数运行 `strata launch`，`STRATA_UPDATE_CHECK=0` 和内部 key 经环境变量传；返回非零时抛错，并打印 Strata 的输出；
    3. 用 `python -m gateway` 启动网关，令牌和内部 key 经环境变量传；
    4. 返回网关进程。
- [x] 11. **`colab.ipynb`、`README.md`。** 写法同 T26 第 13、14 步。README 写 §9 的「在 Unwritten 里接上」步骤，以及 §12 已知限制里需要部署者知道的几条：日志、思考档位、单槽位。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| Colab 部署 | `colab.ipynb` 调用 `unwritten_colab.run` |
| core 一侧 | 无代码。用户在设置页添加自定义端点（[Strata §9](../docs/strata.md#9-在-unwritten-里接上)） |

**注意事项。**

- 这个目录**不是插件**（[Colab 宿主 §1](../docs/colab-host.md#1-定位)），没有一致性测试。
- 内部 key 和用户的令牌是两把不同的 key，网关绝不能把用户的令牌转给 Strata。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `uv run --frozen --directory selfhost/strata pytest -q` 全绿 | 把转发改成先 `await upstream.read()` 再整体写回：`test_forward.py` 的流式断言变红 |
| 同上 | 转发时原样带上调用方的 `Authorization`：「是内部 key」变红 |
| 同上 | 去掉兜底 404，改成全部转发：`test_allowlist.py` 变红 |
| 同上 | `ClientTimeout(total=None)` 改成默认：用一个持续 2 秒的流、把默认总时长打桩为 1 秒的测试变红。这一条写进 `test_forward.py` |
| `ruff` 通过；没有注释行；笔记本只有代码单元格 | — |

---

### T28 plugins/colab-launcher：Colab 启动器

**目的。** 实现 [Colab 启动器](../docs/colab-launcher.md)：一个常驻在 Mac 上的 aiohttp 服务，实现 `unwritten-launcher/1`，用 Colab CLI 按需开关运行时。另外两样：

- `bootstrap.py`：交给 `colab exec`，在运行时里调用宿主；
- 伪 colab 命令与 pytest，以及给 `pnpm test:python` 用的启动脚本。

**依赖。** T03、T10（core 的一致性测试）、T25（宿主的状态行和 `run(..., mode="launcher")`）。

**拥有的文件。** `plugins/colab-launcher/` 下除 T03 生成的两个文件以外的全部文件，都是新建：

```
plugins/colab-launcher/
  README.md
  colab-cli.lock              一行：google-colab-cli==<版本>
  launcher/
    __init__.py  app.py  config.py  machine.py  cli.py  packaging.py  status_lines.py  __main__.py
  bootstrap.py
  launchd/
    unwritten-colab-launcher.plist.template
  tests/
    conftest.py
    fake_colab.py             伪 colab 命令（可执行的 Python 脚本）
    serve_with_fakes.py
    test_auth.py  test_machine.py  test_cli.py  test_drivemount.py  test_packaging.py  test_status_lines.py  test_restart.py  test_secrets.py
```

**先读。**

- [Colab 启动器](../docs/colab-launcher.md) 全文；
- [插图与出图服务 §12.2](../docs/image.md#122-启动器协议-unwritten-launcher1)；
- [Colab 宿主 §8.1](../docs/colab-host.md#81-由启动器启动)。

**步骤。**

- [x] 1. **核对前提。** T03、T10、T25 已合入。`uv tool list` 里有没有 `google-colab-cli` 不重要：测试全部用伪 colab 命令。
- [x] 2. **`launcher/config.py`**（§3）。
  - 读 `~/.config/unwritten/colab-launcher.json`，路径可以用环境变量 `UNWRITTEN_LAUNCHER_CONFIG` 覆盖。
  - **权限：** 文件权限不是 `0o600` 时拒绝启动，打印 `config file must be 0600`。
  - **`$变量名` 写法：** 三个密钥都支持，规则同 core 的 `resolveApiKey`：以 `$` 开头就从环境变量读。
  - **缺项时**不退出：进程照常启动，`/v1/info` 报告 `ready: false`、`notReadyReason: "not_configured"`。
  - **监听地址：** 配置里 `listen` 缺省为 `127.0.0.1`，只能是回环地址，否则拒绝启动。
  - **令牌**短于 32 个字符时拒绝启动，信息里不含令牌。
- [x] 3. **`launcher/cli.py`。** 每个 Colab CLI 命令一个函数，全部用 `asyncio.create_subprocess_exec`，**参数列表里不放任何密钥**（§6）：

  | 函数 | 命令 | 返回 |
  | --- | --- | --- |
  | `version()` | `colab version` | 版本号，和 `colab-cli.lock` 比较 |
  | `sessions()` | `colab sessions` | 会话名的集合。按 [Colab 启动器 §4](../docs/colab-launcher.md#4-状态与-colab-cli-命令) 引用的输出格式逐行解析 `[name] …`；空输出时是空集合；401 映射成 `NotSignedIn` |
  | `new(session, gpu, high_mem)` | `colab new` | 失败时返回码和 stderr 的分类：400 → `Quota`，401 → `NotSignedIn`，其他 → `CliError` |
  | `upload(session, local, remote)` | `colab upload` | — |
  | `drivemount(session)` | `colab drivemount` | 返回一个句柄，可以读到「Please visit:」后面的地址，可以往标准输入写换行 |
  | `exec(session, file)` | `colab exec -s <会话> --timeout 0 -f <file>` | 返回一个句柄，可以逐行读 stdout，可以 `terminate()` |
  | `stop(session)` | `colab stop -s <会话>` | 会话不存在时的退出码 1 也算成功（§4「宿主的入口结束」） |

  - `colab` 可执行文件的路径用环境变量 `UNWRITTEN_COLAB_BIN` 覆盖，测试指向伪命令。
- [x] 4. **`launcher/packaging.py`**（§5 第 2 步）。
  - **`pack(host_dir, service_dir) -> Path`：** 打一个 tar 包，内容是 `colab/` 和 `<名称>/code/` 两个目录。
    - 不含 `tests/`、`.venv/`、`__pycache__/`、`.pytest_cache/`、`.ruff_cache/`、`*.ipynb`；
    - 放在临时目录。
  - **`write_launch_file(token, authkey, idle_minutes) -> Path`：** 写一个权限 `0o600` 的临时 `launch.json`，内容是 `{"token", "tailscaleAuthKey", "idleMinutes"}`。上传后由调用方立即删除。
- [x] 5. **`launcher/status_lines.py`。**
  - `parse(line) -> dict | None`：只解析以 `unwritten-host ` 开头的行，后面必须是 JSON 对象，并且有 `phase` 字符串；其余行返回 `None`。
  - 解析出的对象只取 `phase`、`reason`、`step` 三个键，其余键丢掉。
- [x] 6. **`launcher/machine.py`：状态机**（§4 的表、§5 的步骤）。
  - **状态：** `stopped`、`starting`、`needs_action`、`running`、`stopping`、`failed`；`since` 是进入当前状态的 Unix 秒。
  - **`start(idle_minutes)`：**
    - 在 `starting`、`needs_action`、`running` 时什么也不做；
    - 在 `stopping` 时，等关闭完成再启动；
    - 否则开一个后台任务，按顺序：
      1. `sessions()`：同名会话还在，就先 `stop`；
      2. `new`；
      3. 打包、写 `launch.json`、两次 `upload`，然后删掉本地的 `launch.json`；
      4. `drivemount`：读到授权地址时，地址必须以 `https://` 开头，主机名是 `google.com` 或以 `.google.com` 结尾，否则当作 `start_error`。合格时进入 `needs_action`，`action = { url, expiresAt: now + 600 }`；等 `continue`，或者等 600 秒后变成 `failed`、`action_expired`。没读到地址就成功退出时，直接下一步；
      5. `exec bootstrap.py`：逐行读，`status_lines.parse` 得到 `serving` 时进入 `running`；得到 `exiting` 时进入 `stopping`，然后 `stop`，进入 `stopped`；
      6. `exec` 进程结束时，如果还在 `running`，同样 `stop`，然后进入 `stopped`。
  - **`continue_()`：** 不在 `needs_action` 时抛 `InvalidState`。在的话，往 `drivemount` 的标准输入写 `\n`，进入 `starting`。
  - **`stop()`：** `terminate` 掉 `exec`，`stop`，进入 `stopped`。已经停止时什么也不做。
  - **失败：** 任一步失败时，按 §4 的映射进入 `failed`，`reason` 取 `quota`、`not_signed_in`、`action_expired`、`start_error` 之一，然后执行一次 `stop` 释放运行时（§4「失败后」）。
  - **会话检查：** 在 `running` 时，每 `LAUNCHER_SESSION_CHECK_S`（60）调用一次 `sessions()`，会话不在了就进入 `stopped`。
  - **启动器重启：** 启动时调用一次 `sessions()`，会话在就进入 `running`，只靠会话检查跟踪；不在就是 `stopped`。
- [x] 7. **`launcher/app.py`**（[插图与出图服务 §12.2](../docs/image.md#122-启动器协议-unwritten-launcher1)）。
  - aiohttp，只监听 `127.0.0.1`。鉴权同 T26。
  - **路由：**
    - `GET /v1/info`：`protocol: "unwritten-launcher/1"`、`implementation`、`ready`、`notReadyReason`、`capabilities: {}`；
    - `GET /v1/state`；
    - `POST /v1/start`：`idleMinutes` 在 5 到 720 之间，否则返回 400 `invalid_request`；
    - `POST /v1/continue`：`InvalidState` 时返回 409 `invalid_state`；
    - `POST /v1/stop`：返回 202。
  - **幂等键：** 按 [插件 §3.4](../docs/plugins.md#34-有副作用的请求)记住 `idempotencyKey`：同一个键、同一个请求体，返回同一个结果；同一个键、不同请求体，返回 409 `idempotency_conflict`。
  - **日志：** 只记状态变化、CLI 命令名、退出码、耗时，不记 CLI 的完整输出（§6）。
- [x] 8. **`bootstrap.py`**（[Colab 宿主 §8.1](../docs/colab-host.md#81-由启动器启动)）。在运行时里执行：
  1. 解包 `/content/unwritten/upload.tar` 到 `/content/unwritten/`；
  2. 把 `colab/`、`<名称>/code/` 加进 `sys.path`；
  3. 读 `launch.json` 的 `idleMinutes`：只读这一个字段，密钥留给宿主读，读完由宿主删；
  4. `from colab_service import SERVICE`；
  5. `unwritten_colab.run(SERVICE, mode="launcher", idle_minutes=…)`。

  服务名从 tar 包里唯一的那个 `<名称>/code/` 目录得出，不硬编码。
- [x] 9. **`launchd/…plist.template`、`README.md`。**
  - plist 模板里的路径用 `{{UV}}`、`{{REPO}}` 占位，README 写明怎样替换后放进 `~/Library/LaunchAgents/`（§3「常驻」）。plist 是 XML，**不写注释**。
  - README 写：
    1. 安装 Colab CLI：`uv tool install google-colab-cli==<colab-cli.lock 里的版本>`；
    2. 运行一次 `colab sessions` 登录；
    3. 写配置文件并 `chmod 600`；
    4. 在 Unwritten 设置页填启动器地址和令牌。
- [x] 10. **测试。**
  - **`tests/fake_colab.py`：** 伪 colab 命令，状态存在 `$FAKE_COLAB_DIR` 里。
    - 每次调用把参数追加写进 `calls.log`，**连同环境变量的键名**（不写值）；
    - `sessions` 列出已建的会话；
    - `new` 按 `$FAKE_COLAB_NEW` 返回成功、400 或 401；
    - `upload` 把文件复制进伪运行时目录；
    - `drivemount` 按 `$FAKE_COLAB_CONSENT` 决定是否打印 `Please visit:\n\nhttps://accounts.google.com/o/oauth2/x\n`，然后等标准输入的一行；
    - `exec` 按 `$FAKE_COLAB_EXEC_SCRIPT` 输出一串行，包括普通行和状态行，每行之间停一段时间，最后退出；
    - `stop` 删掉会话。
  - **用例：**

    | 文件 | 用例 |
    | --- | --- |
    | `test_auth.py` | 缺令牌、错令牌返回 401；地址不是回环地址时拒绝启动；配置文件权限不是 0600 时拒绝启动 |
    | `test_machine.py` | 正常路径：`start` → `needs_action`（地址正确）→ `continue` → `running` → 伪 `exec` 输出 `exiting` → `stopped`，并且伪 colab 收到了 `stop`；两次 `start` 只调用一次 `new`；`new` 返回 400 时进入 `failed`、`quota`，并且调用了 `stop`；600 秒没有 `continue` 时进入 `action_expired`（时钟可注入）；授权地址是 `http://` 或主机不是 `google.com` 时进入 `start_error` |
    | `test_cli.py` | `sessions` 能解析多行输出和「No active sessions」；`stop` 的退出码 1 算成功 |
    | `test_drivemount.py` | `continue` 往伪 `drivemount` 的标准输入写了一行；伪命令不打印地址时直接进入下一步 |
    | `test_packaging.py` | tar 包里没有 `tests/`、`.venv/`、`*.ipynb`；`launch.json` 的权限是 0600，上传后本地文件已被删除 |
    | `test_status_lines.py` | 只认 `unwritten-host ` 开头的行；额外的键被丢掉；不合格的 JSON 返回 `None` |
    | `test_restart.py` | 伪 colab 里已有同名会话时，新的启动器进程一启动状态就是 `running`；会话被删掉后，一个检查周期内变成 `stopped` |
    | `test_secrets.py` | 用特征值做令牌和认证 key，跑完正常路径后：`calls.log` 里的参数找不到它们；日志找不到它们（阳性对照：伪运行时目录里上传的 `launch.json` 内容里有它们） |
- [x] 11. **`tests/serve_with_fakes.py`**（T03 第 4 步的约定）：
  1. 设好伪 colab 的环境变量，默认要授权；
  2. 写一份临时配置，权限 0600；
  3. 用随机令牌启动启动器；
  4. 打印两行 `UNWRITTEN_CONFORMANCE_URL=…`、`UNWRITTEN_CONFORMANCE_TOKEN=…`；
  5. 一直运行到收到 `SIGTERM`。

  T10 的一致性测试对着它跑时，会经过 `needs_action`。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| 一致性测试 | `pnpm test:python` 经 `tests/serve_with_fakes.py` 对着启动器运行 core 的 T10 测试 |
| 运行时里的入口 | `bootstrap.py` 调用 `unwritten_colab.run(..., mode="launcher")` |
| core 一侧 | 用户在设置页给出图服务填启动器地址和令牌（T21） |

**注意事项。**

- **密钥只经 `launch.json` 上传**，不进命令行参数，不进 `exec` 的代码（§6）。`bootstrap.py` 本身不含任何密钥。
- 启动器不访问授权地址，只转交（§6）。
- **不写注释**，plist 也一样。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `uv run --frozen --directory plugins/colab-launcher pytest -q` 全绿 | 把令牌作为命令行参数传给 `exec`：`test_secrets.py` 变红 |
| 同上 | 去掉授权地址的主机检查：`test_machine.py` 的 `start_error` 那一条变红 |
| 同上 | 失败后不调用 `stop`：`quota` 那一条变红 |
| `pnpm test:python` 的启动器一致性测试全绿 | 让启动器在 `start` 时总是重新 `new`：一致性测试的「`start` 两次」变红 |
| `ruff` 通过；没有注释行 | — |

---

### T11 core：`image` 引擎：探测、排队、生成、唤醒、调用记录

**目的。** 把三个协议客户端组装成 `image` 模块对外的能力（[插图与出图服务 §5](../docs/image.md#5-image-模块)、§11、§12.3）：

- `capabilities`、`generate`：探测、离线快速失败、按服务排队、自动重试一次、返回校验、调用记录；
- 按需唤醒；
- 测试连接；
- 用量汇总。

**依赖。** T06（服务骨架、能力缓存、`engine-types.ts`）、T08、T09、T10。

**拥有的文件。**

- 新建：`packages/core/src/image/engine.ts`、`image/queue.ts`、`image/probe.ts`、`image/wake.ts`、`image/calls.ts`、`image/test-service.ts`，以及它们的 `*.test.ts`。
- 改：`packages/core/src/image/service.ts`，替换 T06 留下的占位，并把引擎接进视图。

**先读。**

- [插图与出图服务 §3.6](../docs/image.md#36-错误码)、§4.4、§5.1–5.3、§11、§12.2–12.4；
- T06 的 `image/service.ts`、`capability-cache.ts`、`engine-types.ts`；
- T08、T09、T10 三个客户端的导出。

**步骤。**

- [x] 1. **核对前提。** T06、T08、T09、T10 已合入：
  - `rg -n "not implemented: image\." packages/core/src/image/service.ts` 列出七个占位：`testService`、`prepareGeneration`、`assertFormat`、`generate`、`wake`、`continueWake`、`usageSummary`；
  - `ls packages/core/src/image/unwritten-client.ts packages/core/src/image/openai-client.ts packages/core/src/image/launcher-client.ts` 都存在。
- [x] 2. **常量**放在 `image/engine.ts` 顶部并导出（[插图与出图服务 §5.1](../docs/image.md#51-调用入口)、§12.3）：

  ```ts
  export const IMAGE_POLL_INTERVAL_MS = 2_000;
  export const IMAGE_JOB_TIMEOUT_MS = 600_000;
  export const IMAGE_OFFLINE_TTL_MS = 60_000;
  export const IMAGE_WAKE_POLL_MS = 5_000;
  export const IMAGE_WAKE_TIMEOUT_MS = 1_800_000;
  export const IMAGE_CALL_RETENTION_DAYS = 90;
  ```
- [x] 3. **`image/queue.ts`。** 每个服务一个 `PQueue({ concurrency: 1 })`，按 `serviceId` 懒建。`run(serviceId, priority, task)` 把任务加进去，`priority` 用 `p-queue` 的 `priority` 选项：`quality === 'fast'` 的预览给 1，其余给 0（§5.1：开局页的预览优先）。`onIdle()` 等所有队列空闲。
- [x] 4. **`image/probe.ts`。**
  - **`probe(entry)`：**
    - `unwritten-image`：用 `createUnwrittenImageClient(...).info(signal)`，单次时间上限 10 秒，得到 `ProbeRecord`；
    - `openai-images`：不探测，返回 `null`，能力来自配置。
  - **结果写进能力缓存，** 并记 `image.service.probe` 事件。`result` 的取值：

    | 情况 | `result` |
    | --- | --- |
    | 就绪 | `ready` |
    | `ready === false` | `not_ready`，并带 `notReadyReason` |
    | `image_offline` | `offline` |
    | `image_unauthorized` | `unauthorized` |
    | 其他错误 | `invalid` |

  - **离线记录：** `offlineSince(serviceId)` 返回最近一次 `offline` 的时刻；在 `IMAGE_OFFLINE_TTL_MS` 以内时，算作「最近连不上过」。
- [x] 5. **`image/calls.ts`。**
  - `recordCall(db, row)`：往 `image_calls` 插一行，返回 `id`。
  - `usageSummary(db, entries, now)`：按 `service_id` 统计最近 7 天、30 天：
    - `status = 'ok'` 的行数是张数；
    - `input_tokens`、`output_tokens` 求和，`null` 当 0。
    - `name` 从当前配置里找；服务已删除时为 `null`。
  - `pruneCalls(db, now)`：删掉 90 天以前的行，返回行数。
  - `lastSuccessAt(db)`：返回 `Map<serviceId, 最近一次 ok 的 created_at>`。
- [x] 6. **`image/wake.ts`**（§12.3）。导出 `createWaker(deps)`：

  ```ts
  ensureAwake(serviceId: string, trigger: 'prewarm' | 'demand'): Promise<void>
  continueWake(serviceId: string): Promise<void>
  stateOf(serviceId: string): { state: ImageServiceState; action: …; wakeFailure: … }
  whenIdle(): Promise<void>
  ```

  - **单飞：** 同一个服务同时只有一个唤醒 Promise，后来的调用共用它。
  - **流程：**
    1. 记 `image.wake.started`；
    2. `start({ idempotencyKey: randomUUID(), idleMinutes })`；
    3. 每隔 `IMAGE_WAKE_POLL_MS` 读一次 `state`，按下表转换。

    | 启动器状态 | 唤醒怎样处理 |
    | --- | --- |
    | `needs_action` | 服务状态设成 `needs_action`，记下 `action`（毫秒），发布 `image.service_state` |
    | `starting` | 服务状态设成 `waking`（已经是就不重复发布） |
    | `running` | 改为探测服务（第 4 步）：`ready` 就成功；`not_ready` 且原因是 `starting`，继续等；`not_ready` 且原因是别的，就以对应的码失败：`out_of_memory` → `image_out_of_memory`，`workflow_error` → `image_workflow_error`，其他 → `image_wake_failed` |
    | `failed` | 以 `image_wake_failed` 失败，`reason` 取启动器的原因 |
    | `stopped` 或 `stopping` | 再发一次 `start`；整个唤醒里最多重发 3 次，之后按 `failed` 处理 |

  - **超时：** 超过 `IMAGE_WAKE_TIMEOUT_MS` 时，发一次 `stop`，以 `image_wake_timeout` 失败。
  - **成功：** 服务状态设成 `ready`，记 `image.wake.done`（`userAction`：途中有没有出现过 `needs_action`），记样本 `image.wake`。
  - **失败：** 服务状态设成 `wake_failed`，`wakeFailure = { code, reason }`，记 `image.wake.failed`。
  - **每次状态变化**都发布 `image.service_state`。
  - **启动器连不上**时抛 `image_launcher_offline`，401 时抛 `image_launcher_unauthorized`，这两个来自 T10 客户端的映射。
  - **`continueWake`：** 调用启动器的 `continue`，`idempotencyKey` 是 `ContinueWakeInput.requestId`。
- [x] 7. **`image/engine.ts`：`generate`。** 对一个 `ImageGenerateInput`，在该服务的队列里，按顺序：
  1. **找配置并固定本次实际出图目标。** 出队后，以及每次调用出图客户端前，运行 `input.guard?.assertCurrent()`。服务存在且守卫有效时，取当前配置，与守卫的 `model` 比较（Unwritten 图像协议取 `null`）。不符按 `AbortError` 中断。客户端由刚核对过的同一个配置对象构造，之后直接发请求。技术重试、能力刷新之后再次经过相同检查。没有守卫的手动调用沿用现有配置检查。
  2. **共用 `prepareGeneration`（`image/engine.ts`）。** 插图需要先得知当前能力再调用镜头模型，手动画图同样走这个方法。OpenAI 兼容服务返回配置的能力。Unwritten 图像协议按以下步骤走：
     - 入口和任何探测或唤醒等待返回后，若传了守卫，运行 `assertCurrent()`，并用该次取到的配置检查模型。已有唤醒时加入同一个等待。否则，自动请求遇到 TTL 内的离线记录且没有启动器时立即返回 `image_offline`。手动请求仍探测。
     - 使用第 4 步的 `probe` 检查就绪。已就绪返回能力；未就绪映射该原因；身份或响应错误原样按协议映射。连不上且没有启动器时返回 `image_offline`。
     - 连不上且有启动器时，先调一次 `onWaiting`，再等待单飞的 `ensureAwake(id, 'demand')`。已经有唤醒时也通知当前调用者。唤醒以就绪探测结束，从该结果取能力。调用者的 `signal` 中断时退出该调用者的等待，共用唤醒仍按运行时规则结束。core 的 shutdown 信号中止服务自身的等待和探测。
     - 生成在队列里也调此方法。队列入口以当前服务状态为准，上一阶段检查后仍可能断线。遇到服务已确认离线的调用记录走第 7 小步，已有错误码和调用前失败时机保留。
  3. **按能力整理请求：**
     - 在 `image/engine.ts` 共用一个 `assertGenerationFormat(capabilities, input)`。检查 `aspect`、`quality` 以及非空 `size` 的逐像素匹配。非空 `size` 是用户或调用方已经确定的尺寸；当前能力不再支持时抛 `image_output_format_unavailable`。通过检查后按原规格请求。`size === null` 时使用协议规定的默认尺寸；画风预览的 `fast` 调用方明确传 `null`。
     - `seed` 只在能力 `seed` 为 true 时保留；
     - `negativePrompt` 只在能力 `negativePrompt` 为 true 时保留；
     - `references` 超过 `maxReferences` → 抛 `image_invalid_request`：参考图由调用方按能力挑，这里不截断。
  4. **调用协议：**
     - `unwritten-image` 调 `client.run(request, { signal, pollIntervalMs, jobTimeoutMs, beforeSubmit })`。请求为本次固定的幂等键和规格。游玩任务的 `beforeSubmit` 运行第 1 小步的接收方核对。重发经此守卫，清理已经提交的任务沿用原客户端；
     - `openai-images`：`size` 用 `input.size ?? openAiSizeFor(sizes, aspect, 'default')`，没有尺寸时抛 `image_output_format_unavailable`；然后 `client.generate`。
  5. **重试最多一次**（§5.1）：
     - 错误的 `kind` 是 `transport` 或 `busy` 时，等 `retryAfterMs`（缺省 0）后再调一次。`unwritten-image` 的重发在客户端内部已经做了，所以这里只对 `openai-images` 生效；
     - `kind` 是 `capability` 或 `format` 时，先 `probe` 刷新能力，重新用第 3 步检查原规格。原规格仍可用才按能力整理其余参数并重试一次。无法维持原规格时按该守卫抛错，出图接口不会再收到请求。
  6. **校验结果：**
     - `validateImageBytes(bytes, { rejectMetadata: input.ref.kind === 'portrait' })`：参考图不许带元数据（§5.3），插图只要求格式正确。不合格时抛 `image_invalid_response`；
     - 请求里有 `size`：结果宽高必须完全相同，否则抛 `image_invalid_response`；
     - 没有 `size`：用 `aspectMatches` 核对比例，不符同样抛错。
  7. **记录：**
     - `recordCall`：带协议、模型、质量档、参考图张数、tokens、耗时、状态、错误码；
     - 样本 `image.generate`；
     - 成功时返回 `ImageGenerateResult`。
  - **`signal` 中止时，** 调用记录的状态是 `aborted`，然后重新抛出 `AbortError`。
  - **任何错误的 `message` 里都不放提示词。**
- [x] 8. **`image/test-service.ts`：`testService`**（§2「测试连接」「生成测试图」）。
  - `target: 'service'`：
    - `unwritten-image`：`probe`，返回 `service`；
    - `openai-images`：`paid` 为 false 时调用 `listModels`；为 true 时用附录 B.6 的固定提示词，走 `generate`（`ref.kind: 'test'`、`manual: true`、`quality: 'fast'`、`aspect: '1:1'`），返回 `generated` 的宽高。
  - `target: 'launcher'`：调用启动器的 `info` 和 `state`，返回 `launcher`。服务没配启动器时返回 `ok: false`、`code: 'image_launcher_offline'`。
  - 出错时 `ok: false`，`code` 是错误码，**不抛出**：测试结果要显示给用户，不当作接口错误。
- [x] 9. **改 `image/service.ts`。**
  - 用引擎替换七个占位。服务的 `assertFormat` 调用引擎的 `assertGenerationFormat`，T18 通过该接口提前检查已确定规格；
  - `whenIdle` 改成等队列和唤醒都空闲；
  - `pruneCalls` 调用 `calls.pruneCalls`。
  - **`listServices` 的视图填上：**
    - `probe`：取能力缓存；
    - `state`、`action`、`wakeFailure`：有启动器时取 `waker.stateOf`；没有时按探测结果推出：`ready` → `ready`，`offline` → `offline`，没有记录 → `unknown`；
    - `lastSuccessAt`：取 `calls.lastSuccessAt`。
  - **`wake(serviceId, trigger)`：** 先检查该服务存在并且配置了启动器，再用与 `prepareGeneration` 相同的探测入口。已在线时直接结束；连接失败才启动或加入单飞，用实际触发方作 `trigger`。预热入口返回 `void`，内部任务纳入 `whenIdle`，失败由第 6 步的诊断记一次。`IllustrationService.prewarm` 用它（T18）。
  - **`prepareGeneration`：** 转交引擎。给 T18 返回本次取得的能力；没有可用服务时按前两个步骤的错误码失败。
- [x] 10. **测试。** 用 T08 的伪出图服务、T09 的伪 OpenAI 图像服务、T10 的伪启动器。

  `engine.test.ts`：
  - **正常路径：** `unwritten-image` 出一张图，`image_calls` 多一行 `ok`，返回的宽高等于请求的尺寸。
  - **能力不支持的字段：** 能力 `seed: false` 时，伪服务收到的请求体里没有 `seed`；`negativePrompt: false` 时没有 `negativePrompt`。
  - **`fast` 不带尺寸：** `quality: 'fast'` 时请求体里没有 `size`。
  - **离线快速失败：** 伪服务关掉后先失败一次，60 秒内（时钟可注入）第二次 `manual: false` 的请求**没有发出任何网络请求**就以 `image_offline` 失败。阳性对照：`manual: true` 的同样请求会先探测一次。
  - **离线时唤醒：** 配了伪启动器时，离线触发唤醒；唤醒成功后出图成功。伪启动器的 `startCalls()` 为 1。
  - **单飞：** 三个任务同时到达，`startCalls()` 仍为 1。
  - **按服务排队：** 两个服务各一个慢任务，同时开始；同一个服务的两个任务依次执行。用伪服务的 `jobDelayMs` 和时间戳断言。
  - **尺寸变化：** 伪服务对第一次提交 `respondNext(400, unsupported_size)`，刷新后的同一比例只保留另一尺寸。断言引擎返回 `image_output_format_unavailable`，且生成请求只有原尺寸的一次。另测取队首时尺寸已消失，生成请求为零。阳性对照保留原尺寸，重试仍发送同一宽高。把规格守卫替换成省略尺寸，两条断言变红。
  - **出队接收方：** 用一个受控任务占住队列，排入守卫固定的游玩任务，同服务 id 改绑兼容接口的模型后放行。断言只收到占住队列的请求，新模型收到零次生成。让此用例的 `assertCurrent` 保持通过，单验 T11 对实际配置和固定模型的比较。另保留原模型作为阳性对照。删掉共用配置核对中对固定模型的比较，断言变红。
  - **结果的元数据：** `ref.kind: 'portrait'` 时，结果带文本块就以 `image_invalid_response` 失败；`ref.kind: 'illustration'` 时同样的结果通过。
  - **尺寸不符：** 结果宽高和请求不同，以 `image_invalid_response` 失败（§14「让服务返回不同的像素尺寸」）。
  - **OpenAI 重试：** 连接被拒，重试一次后仍失败，伪服务收到 0 次请求，最终 `image_offline`；5xx 不重试，伪服务收到 1 次，`image_outcome_unknown`。

  `wake.test.ts`：
  - **转换顺序：** 伪启动器默认脚本 `needs_action` → `continue` → `running`，服务探测 `ready` 后成功；服务状态依次发布 `waking`、`needs_action`、`waking`、`ready`。
  - **启动器失败：** `failed`、`quota` → `image_wake_failed`，`wakeFailure.reason === 'quota'`。
  - **超时：** 伪启动器一直 `starting`，超时后伪启动器收到一次 `stop`，抛 `image_wake_timeout`。
  - **自检失败：** `running` 后服务报告 `out_of_memory`，立即以 `image_out_of_memory` 结束，不等到超时。
  - **启动器离线：** 伪启动器关掉时抛 `image_launcher_offline`。
  - **分开取消唤醒等待：** 两个请求共用唤醒并停在 `needs_action`，只中止第一个请求。第一个在授权前以 `AbortError` 结束，第二个继续等待，可以授权后取到能力。用调用者的中止 Promise 与共享唤醒竞争，结束时移除监听器，已有中止信号立即结束。移除调用者中止分支，第一个请求不能及时结束，断言变红。

  `calls.test.ts`：7 天、30 天的边界；被删的服务 `name` 为 `null`；90 天的清理。

  `test-service.test.ts`：
  - `paid: false` 的 OpenAI 测试**没有**调用出图接口，只调用 `/models`；
  - 启动器测试返回状态。

**接线点。**

| 功能 | 调用方 |
| --- | --- |
| `generate` | T17（参考图、画风预览）、T18（插图），以及本任务的 `testService` |
| `wake` | T18 的 `prewarm` |
| `prepareGeneration`、`assertFormat` | T18 的镜头前检查、本任务的出图队列 |
| 服务状态 | T06 的视图、T20 的 `useImageServiceState` |

**注意事项。**

- **重试只在一层做**（[packages/core/AGENTS.md §4](../packages/core/AGENTS.md#4-模型调用)）。T17、T18 不再对 `generate` 重试，失败就交给用户点「重试」。
- **唤醒期间排队的任务在队列里等着**，不占用其他服务的队列。
- 本任务不决定画什么、用哪张参考图。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 去掉离线快速失败：「没有发出任何网络请求」变红 |
| 同上 | 去掉单飞：`startCalls()` 为 3，变红 |
| 同上 | 不按能力去掉 `seed`：对应断言变红 |
| 同上 | 结果不核对尺寸：「尺寸不符」变红 |
| 同上 | 超时后不发 `stop`：「伪启动器收到一次 `stop`」变红 |
| `grep -n "not implemented: image\." packages/core/src/image/service.ts` 零命中 | — |

---

### T13 core：开局的插图设置、主角形象与作者画风

**目的。** 落地开局页需要的 core 能力：

- `StartInfo.illustration`；
- `play.start` 保存本局插图设置，并锁定作者参考组、主角参考快照（[插图与出图服务 §6.2](../docs/image.md#62-人物参考组)「开局复用」、[数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)）；
- 「按设定写一个」的主角形象起草；
- 作者默认画风的保存；
- 画风预设的英文片段和形象哈希，T16、T17 共用。

**依赖。** T06（`IllustrationService` 骨架、`image.activeTarget`、`selectedServiceId`）、T12（`play/` 下已加形象）、T15（图片存储与清理）。

**拥有的文件。**

- 新建：`packages/core/src/illustration/style.ts`、`illustration/appearance.ts`、`illustration/suggest.ts`，以及它们的测试。
- 改：
  - `packages/core/src/play/start.ts` 及其测试；
  - `packages/core/src/illustration/service.ts`：接 T15 的存储，替换 `suggestAppearance`、`setWorkStyle`、`storageSummary`、`collectGarbage` 四个占位；
  - `packages/core/src/play/service.ts`、`library/service.ts`、`services.ts`、`app.ts`、`main.ts`，以及 app、desktop 装配测试和直接构造 play 的测试（规划时为 `play/start.test.ts`、`play/service.test.ts`、`play/opening-job.test.ts`），限第 4、7 步的接线；
  - `packages/core/src/llm/types.ts`：`LlmRunRef.kind` 加 `'illustration' | 'portrait'`；`LlmCompleteInput` 加可选的接收方守卫。
  - `packages/core/src/llm/run.ts` 及现有调用测试：只补 `createCompleter` 的接收方守卫。

**先读。**

- [插图与出图服务 §6.1](../docs/image.md#61-形象)、§6.2「开局复用」、§6.3；
- [数据模型 §3](../docs/data-model.md#3-经历开局回合树路线存档)的 `playthroughs.illustration`；
- [游玩流程 §2.1](../docs/gameplay-flow.md#21-插图)「开局时选本局的样子」；
- 现有的 `play/start.ts`：`getStartInfo`、`startPlaythrough`，按符号名找。

**步骤。**

- [x] 1. **核对前提。** T06、T12 已合入：`rg -n "illustratePara" packages/core/src/play/service.ts` 有命中；`rg -n "suggestAppearance" packages/core/src/illustration/service.ts` 是占位。
- [x] 2. **`illustration/style.ts`。**
  - `STYLE_PRESET_PROMPTS: Record<StylePreset, string>`：英文片段，照附录 B.7。
  - `styleFragment(style)`：预设返回片段，自定义返回 `null`，自定义画风由镜头描述写进提示词，见 T16。
  - `styleRecord(style)`：存进 `portrait_sets.style` 的形状，就是 `IllustrationStyle` 本身。
  - `effectiveStyle(stored)`：`stored ?? DEFAULT_ILLUSTRATION_STYLE`。
- [x] 3. **`illustration/appearance.ts`。**
  - `appearanceHash(text)`：`sha256(text.trim().normalize('NFC'))`，小写十六进制（[插图与出图服务 §9.2](../docs/image.md#92-表)：去首尾空白、NFC 规范化）。
  - 测试：
    - 首尾空白不同、哈希相同；
    - 组合字符和预组字符（`'é'` 与 `'é'`）的哈希相同；
    - 内容不同、哈希不同。
- [x] 4. **`play/start.ts` 的 `getStartInfo`。** 返回值加 `illustration`：
  - `available`：`image.selectedServiceId() !== null`；
  - `autoEnabled`：`image.activeTarget() !== null`；
  - `authorStyle`：`effectiveStyle(works.illustration_style)`；
  - `lastStyle`：这部作品最近一个 `illustration.enabled === true` 的开局所用的 `style`，没有时为 `null`；
  - `defaults`：`app_settings.illustration.defaults`；
  - `protagonistEntityId`：发布版本里 `is_protagonist = 1` 的实体 id。

  `getStartInfo` 拿不到 `image` 服务时（现有调用方只传了 `CoreDeps`），给它加一个参数 `image: Pick<ImageService, 'selectedServiceId' | 'activeTarget'>`，调用方是 `play/service.ts` 的 `getStartInfo` 方法。`PlayService` 的工厂在 `main.ts` 里拿不到 `image`，所以 `ServiceFactories.play` 的依赖加上 `image`，`app.ts` 里 `play` 的创建挪到 `image` 之后。装配和测试夹具改动归本任务。用 `rg -n "createPlayService\(|getStartInfo\(|ServiceFactories" packages/core/src` 列出直接调用和工厂。生产使用真实 `image` 服务，其他调用沿用 T06 的测试服务默认值（不选出图服务）。
- [x] 5. **`play/start.ts` 的 `startPlaythrough`。** 在建开局行的事务里，把输入转成 `PlaythroughIllustration` 写进 `playthroughs.illustration`：
  - **输入没有 `illustration`：** 写纯文字，`style` 取 `authorStyle`，其余同 `TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION`。
  - **有：** `enabled`、`style`、`aspectPreference`、`resolutionTier`、`protagonistInFrame`、`protagonistAppearance` 原样写入。`protagonistInFrame` 为 false 时，`protagonistAppearance` 写 `null`。
  - **`authorPortraitSetIds`：** 对发布版本里每个人物实体，查 `portrait_sets` 中 `scope = 'work'`、`state = 'active'`、`entity_id = 实体 id`、`appearance_hash = appearanceHash(实体当前档案的 appearance)` 的组，有就记下 `实体 id → 组 id`（§6.2：按实际选用的版本匹配已采用的作者参考组，锁定组 id）。
  - **`protagonistPortraitSetId`：** 输入带了 `protagonistSnapshotId` 时校验，下面的校验都通过才写这个 id，否则写 `null`，**开局照常**（§10：预览快照已过期或条件变化时，开局照常）：
    - 组存在，`work_id` 是这部作品；
    - `scope = 'pending'`、`state = 'active'`；
    - `entity_id` 是主角的实体 id；
    - `appearance_hash` 等于 `appearanceHash(输入的 protagonistAppearance)`，主角形象为空时不要求；
    - 正面已就绪、且未超过预览保留期；实际打开已锁定这份引用的旧局时遵守 §9.4 的保留规则。
  - **全部写入前**用 `PlaythroughIllustrationSchema.parse` 校验。
  - 不调用任何模型：主角形象的补写在插图流程里（D21）。
- [x] 6. **给自动插图固定背景模型。** 在 `llm/types.ts` 的 `LlmCompleteInput` 加 `guard?: { endpointId: string; modelId: string; assertCurrent: () => void }`。在 `llm/run.ts` 的 `createCompleter` 拿到 `targetFor(input.purpose)` 的结果后，核对实际的 `RuntimeTarget.endpointId`、`modelId` 和守卫一致。每次调用 `completeOnce` 前（包括传输重试）运行 `assertCurrent()`，将已核对的 `target` 直接传给 `completeOnce`。目标不符、确认失效或尝试取消时以 `AbortError` 结束，放在吞掉或重试传输异常的逻辑之外。其他 `complete` 调用仍按原用途解析。

  **`illustration/suggest.ts`：`suggestAppearance(deps, { workId }, options?)`**（§6.1、[游玩流程 §2.1](../docs/gameplay-flow.md#21-插图)「按设定写一个」）。
  1. 取发布版本的主角实体档案 `text`。公开材料有两份：`store/plan.ts` 的 `readPublicSetting(meta)`（公开设定或世界），以及 `readSettings(meta).protagonist.text`（作者写的主角设定）。**不取**幕后设定、秘密和 `settings.secrets`。
  2. 用 `deps.llm.complete`：`purpose: 'background'`；`system` 和 `prompt` 照附录 B.5；`ref: { kind: 'illustration', id: workId, attempt: 1, workId }`；`maxOutputTokens: 200`。自动补写时，T18 从 `options` 传入 `signal`、`LlmCompleteInput['guard']`，第一次调用和每次重写都传相同值。开局页手动补写沿用不传守卫的调用。
  3. 结果去首尾空白，取第一行，用 `AppearanceTextSchema` 校验：
     - 不通过时，把错误附在提示词后面，再调一次，最多重写 2 次；
     - 仍不通过时抛 `invalid_output`。
  4. 返回 `{ appearance }`。**不写库**：玩家在开局页看了再决定用不用。
  - **为什么只用 `complete()`：** `background` 用途不要求工具调用（[LLM 端点 §7](../docs/llm-endpoints.md#7-用途分配)）。
- [x] 7. **`illustration/service.ts`。**
  - 建一个 `const store = createImageStore(deps.dataDir, deps.logger)` 放在服务实例的闭包里。用 `storageSummary(deps.db)` 和 `collectGarbage({ db: deps.db, store, now: Date.now(), logger: deps.logger })` 替换占位。T17、T18、T19 复用这个存储。测 `storageSummary` 返回实际去重占用、`collectGarbage` 删除测试目录里已超过保护期的孤儿文件；删掉任一接线相应断言变红。
  - **`suggestAppearance`：** 调用第 6 步。作品不存在或没发布时抛 `not_found`、`not_published`。
  - **`setWorkStyle`：**
    - 校验作品存在；
    - 在一个事务里 `UPDATE works SET illustration_style = ?, updated_at = ?`，写入前用 `IllustrationStyleSchema.nullable().parse`；
    - **不碰** `work_versions`，不改 `content_rev`；
    - 提交后发布 `works.changed`。
  - **`WorkDetail.illustrationStyle`：** 切换 T02 填下的默认值，改 `library/service.ts` 的 `get`。这一行属于本任务：在 `library/service.ts` 读作品时带上 `illustration_style`。改动只限这一处，执行时用 `rg -n "blurb" packages/core/src/library/service.ts` 找到组装 `WorkDetail` 的地方。
- [x] 8. **测试。**

  `play/start.test.ts` 加：
  - 不带 `illustration` 开局：开局行是纯文字，`style` 等于作品的默认画风；
  - 带 `illustration` 开局：原样保存；`protagonistInFrame: false` 时形象为 `null`；
  - **作者参考组：** 作者为人物 A 采用了一组参考、人物 B 没有，开局后 `authorPortraitSetIds` 只有 A；把 A 的档案形象改掉、重新发布再开局，`authorPortraitSetIds` 里没有 A（哈希对不上）；
  - **主角快照：** 快照的形象和输入一致时写入；形象不一致时写 `null`，开局成功；快照属于另一部作品时写 `null`。另外建一个符合条件且尚未被开局引用的快照，运行 T15 的清理再开局，锁定的 id 仍是它。T17 完成选择流程后的端到端用例见 T30。
  - **`StartInfo.illustration`：** 没选服务时 `available: false`；上一局用了水彩时 `lastStyle` 是水彩。

  `illustration/suggest.test.ts`，用 `createScriptedLlm` 的 `complete` 步骤：
  - 一次就合格；
  - 第一次 301 字、第二次合格：`complete` 被调用两次，第二次的提示词里有附录 B.5 的修正说明；
  - 自动补写两次调用收到同一守卫；在 `llm/run` 的调用测试里用两个伪端点改变当前解析目标，错配时两个端点都收不到补写。阳性对照恢复目标后原端点收到一次；去掉端点／模型核对断言变红。
  - 三次都不合格：抛 `invalid_output`；
  - 发给模型的提示词里**没有**幕后设定：造一个秘密，断言它的原文不在提示词里，阳性对照是公开设定的原文在里面。

  `illustration/service.test.ts`：`setWorkStyle` 后作品的 `content_rev` 不变；`WorkDetail.illustrationStyle` 是新值；发布了 `works.changed`。

**接线点。**

| 功能 | 调用方 |
| --- | --- |
| `StartInfo.illustration`、开局保存 | T23 的开局页 |
| `suggestAppearance` | `play.suggestAppearance`，T06 已接路由 |
| `setWorkStyle` | `works.setIllustrationStyle`，T06 已接路由 |
| `styleFragment`、`appearanceHash` | T16、T17、T18 |

**注意事项。**

- 开局时不调用模型（D21）。
- 主角形象写入后不再改（§6.1：补写只发生一次）。补写在 T18，本任务只保存玩家写的。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 作者参考组只按 `entity_id` 匹配、不看哈希：「哈希对不上」那条变红 |
| 同上 | 快照不核对形象：「形象不一致时写 `null`」变红 |
| 同上 | `setWorkStyle` 改了 `content_rev`：对应断言变红 |
| 同上 | `suggest` 不限制重写次数：「三次都不合格」变成无限循环，测试超时变红 |

---

### T14 core：按段落投影场景材料

**目的。** 镜头描述只能用「图所在段落那一刻」主角能确认的内容（[数据模型 §5](../docs/data-model.md#5-可见性规则)「插图按段落投影」）：

- 截至该段的正文；
- 已知的称呼；
- 在场人物当时可见的形象；
- 可见身份的起点；
- 地点。

本任务在 `story` 模块里实现这个投影，T16 拿它写提示词，T18 拿它选参考组。

**依赖。** T12（`ProjEntity.appearance`、`appearanceFacts`）。

**拥有的文件。** 新建 `packages/core/src/story/scene-projection.ts`、`story/scene-projection.test.ts`。

**先读。**

- [数据模型 §5](../docs/data-model.md#5-可见性规则) 全文，尤其是「插图按段落投影」两段；
- [插图与出图服务 §6.1](../docs/image.md#61-形象)「当前形象」、§6.2「路线上的可见身份」、§8「场景材料」；
- 现有的 `story/projection.ts`（`loadProjection`、`protagonistKnowledge`、`currentNameHeldBy`、`presentIdsAtHead`）和 `story/types.ts`。

**步骤。**

- [x] 1. **核对前提。** T12 已合入：`rg -n "export function appearanceFacts" packages/core/src/story/projection.ts` 有命中。
- [x] 2. **导出的形状。**

  ```ts
  export interface ScenePerson {
    code: string;
    entityId: string;
    knownAs: string | null;
    appearance: string | null;
    identityFactId: string | null;
    isProtagonist: boolean;
  }
  export interface SceneMaterials {
    skip: boolean;
    paragraphs: string[];
    earlierText: string | null;
    place: string | null;
    people: ScenePerson[];
    bannedNames: string[];
    unknownNames: string[];
  }
  export const SCENE_EARLIER_TEXT_MAX_CHARS = 2_000;
  export function sceneMaterials(
    db: Database,
    input: {
      versionId: string;
      turnId: string;
      para: number;
      protagonistAppearance: string | null;
      protagonistInFrame: boolean;
    },
  ): SceneMaterials;
  ```

  - `code` 是本次请求内的短编号 `C1`、`C2`…，按 `people` 的顺序编号，主角如果在列表里，总是 `C1`（D6）。
- [x] 3. **规则。** 以下「这一刻」指 `(目标回合的深度, para)`。
  - **正文：**
    - `paragraphs` 是目标回合第 1 段到第 `para` 段；
    - `earlierText` 是上一回合的全部正文，按段拼接、超出 `SCENE_EARLIER_TEXT_MAX_CHARS` 时从**开头**截掉，保留最近的部分；
    - 都只取正文，不取幕后栏目。
  - **事实、称呼、知情：** 只取出处严格早于这一刻、或者在同一回合且段号 ≤ `para` 的记录。同一回合里没有段号（出处缺失）的记录不取。
  - **在场的人**，下面三种来源的并集，去重：
    1. 上一回合 `scene.present` 里的人。目标回合是开场时没有这一项。
    2. `ProjEntity.originTurnId === turnId` 且 `sourcePara !== null && sourcePara <= para` 的人物。用 T12 写入的登记段号。缺段号时该条来源不命中，仍可采用其他两条来源和 D28 的亲见证据。
    3. 主角这一刻已知的称呼，出现在 `paragraphs` 里的人物：子串匹配，称呼长度不少于 2 个字符。
    - **不用**目标回合结束时的 `scene` 推断（数据模型 §5）。
    - 只取 `kind === 'character'` 的实体。
  - **主角：** `protagonistInFrame` 为 true 时加进 `people`，`appearance` 用 `protagonistAppearance`；为 false 时不加。
  - **每个人的 `knownAs`：** 这一刻主角对他的称呼，用 `currentNameHeldBy` 的同样规则，但只看这一刻之前的称呼记录。
  - **亲见守卫和 `appearance`（D28）：**
    1. 新建 `isWitnessedAt(projection, entityId, turnId, para)`。从当时可见的 `relation/acquaintance` 中找主角与该人物最近一条，双向匹配主体和对象，按回合深度和段号取最新。接受 `met`、`familiar`。沿用到上一回合明确在场的人；人物只在称呼名单里、或者上一回合缺少在场证据时，再要求本回合目标段前有明确的相遇事实。用出处回合和段号取值，文中提到称呼只提供在场候选。相遇记录缺失时保留正文可见线索。
    2. 对当场人物，从 `appearanceFacts` 里滤掉超出目标段的记录，然后对其各自的出处调用 `isWitnessedAt`。取剩下的最新形象；没有时只取该人物当场可见的基础档案。传到镜头的 `people` 只包含通过守卫的人。主角按上条单独处理。
    3. 用同一组可见特征回溯 `identityFactId`。T12 禁止用 `knowledge` 引用形象特征，形象与身份判定都以第 1 步的相遇和出处为证据。一条新形象、一个未来的相遇和一条只有听闻的记录各自不能单独解锁参考。在测试里分别准备一个当场相遇且可见的阳性对照。
  - **`identityFactId`**（§6.2「可见身份」）：从这一刻往回找可见的 `appearance` 特征：
    - 最新一条可见特征的 `data.same_visible_identity === 1` 时，继续往前找，直到一条不是 1 的，它的 id 就是起点；
    - 都是 1、或者没有可见特征时，为 `null`，表示基础形象。
  - **`place`：** 非开场用上一回合结束时的场景地点。目标回合的 `scene` 是结束时状态，不用于段内推断；正文明确写出地点变化时只作为文字线索。开场只取所选版本在开场前明确公开的处境文字，地点未单独给出时为 `null`。
  - **`bannedNames`：** `people` 里每个人的实体表 `name`，加上主角的实体表 `name`，去首尾空白后长度 ≥ 2 的（D7）。主角不入画时也包含主角的名字。
  - **`unknownNames`**（D8）：候选是版本里全部实体的 `name` 和全部称呼，已知是这一刻主角知道的称呼和名字，用 `protagonistKnownStrings` 的同样规则、只看这一刻之前的记录；取「候选减已知」中长度 ≥ `STORY_LIMITS.nameMinLengthForLeakCheck` 的。
  - **`para === 0`（开场图）：**
    - `paragraphs` 为空，从所选版本的 `readPlan(meta)` 里找 `kind: 'summary', key: 'situation'` 的公开开场处境，按 `opening-prompt.ts` 的 `planSummary` 所用字段读取。规划时 `readPublicSetting` 只读 `public_setting` 或 `world`，它不提供开场处境；
    - 入画时只加已有公开形象的主角；直接取公开处境文字作为 `earlierText`，并按上条处理地点；
    - 缺公开初始处境时 `skip: true`（§7.1）。测试让开场首段及结束场景都有另一个地点，断言两处均未进入第 0 段材料。
- [x] 4. **测试。** 用 `test-support/story-fixtures.ts` 的 `seedNorthCape` 或 `seedStory` 造一条路线，必要时在测试里补插事实。用例对应 [插图与出图服务 §14](../docs/image.md#14-验收)和 [docs/milestone-4.md](../docs/milestone-4.md#验收) 的几条：
  - **后来才揭晓的不进来：** 第 2 段的图，第 5 段才揭晓人物身份并出现新地点。`people` 里那个人的 `knownAs` 是第 2 段时的称呼（伪装），`place` 不是新地点，`bannedNames` 里有他的真名，`unknownNames` 里也有他的真名。
  - **同一回合里后来才知道的称呼：** 第 4 段主角才得知一个称呼，`para: 2` 时 `unknownNames` 里有它，`para: 4` 时没有。
  - **同一回合里的先后：** 第 1 段的相遇事实给出亲见阳性对照，第 3 段记录登记，目标人物没有 `known_as`、也不在上一回合场景。段落投影在第 2 段排除该人物，在第 3 段纳入。另复制成 `sourcePara: null` 的旧记录，第 3 段也不会因登记这一来源被纳入。
  - **出处缺失：** 同一回合里出处缺失的称呼不被采用。
  - **换装：** 形象特征带 `same_visible_identity: 1`，`identityFactId` 是更早那条特征的 id；不带时是这一条自己的 id。
  - **主角不知道的形象：** 一条 `appearance` 特征只有别人知情、主角不知情时，不被采用，回落到档案形象。
  - **开场：** 公开开场处境为空、`place` 也为空时，`skip` 为 true；有开场处境时，`earlierText` 是它。
  - **不按回合结束的场景推断：** 目标回合结束时 `scene.present` 里新加的人，如果在前 `para` 段的正文里没有出现、也不是本段之前登记的，就不在 `people` 里。

**接线点。** T16 的 `shot.ts`、T18 的 `pipeline.ts` 调用 `sceneMaterials`。

**注意事项。**

- **本模块只依赖 `store/` 和 `text/`**（[packages/core/AGENTS.md §1](../packages/core/AGENTS.md#1-模块与依赖方向)），不导入 `illustration/`。
- 规则里「称呼出现在正文里」是确定性的子串匹配，不调用模型。
- **这是可见性边界。** 每条规则都有一个用例；判据的突变一条一条做。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 用目标回合的 `scene.present` 代替上一回合的：「不按回合结束的场景推断」变红 |
| 同上 | 取事实时把 `para` 条件改成 `<=` 回合末：「同一回合里的先后」变红 |
| 同上 | 形象不看主角知情：「主角不知道的形象」变红 |
| 同上 | `bannedNames` 漏掉被伪装的人：「后来才揭晓的」变红 |
| `rg -n "from '\.\./(llm\|api\|play\|authoring\|illustration\|image)/" packages/core/src/story/scene-projection.ts` 零命中 | — |

---

### T23 client：开局页的插图设置

**目的。** 开局页的「插图」块（[游玩流程 §2.1](../docs/gameplay-flow.md#21-插图)「开局时选本局的样子」）：

- 本局插图或纯文字；
- 画风、比例、分辨率；
- 主角形象、主角是否入画；
- 「按设定写一个」；
- 画风预览；
- 主角参考的导入或生成，以及「用作本局参考」。

**依赖。** T20、T22（`StylePicker`、`StylePreview`、`PortraitSetEditor`）。

**拥有的文件。**

- 新建：`apps/client/src/features/play/StartIllustrationPanel.tsx`、`StartIllustrationPanel.module.css`、`StartIllustrationPanel.test.tsx`、`start-illustration.ts`、`start-illustration.test.ts`。
- 改：`apps/client/src/features/play/StartPage.tsx`、`apps/client/src/i18n/zh-CN/play.json`（只加附录 A.4 里标「T23」的键）。

**先读。**

- [游玩流程 §2.1](../docs/gameplay-flow.md#21-插图) 的开局部分和那张「项 / 玩家可以做什么」表；
- [插图与出图服务 §6.2](../docs/image.md#62-人物参考组)「开局复用」；
- 现有的 `StartPage.tsx`：主角填写项和「开始故事」怎样提交 `play.start`。

**步骤。**

- [x] 1. **核对前提。** T22 已合入：`rg -n "export function PortraitSetEditor|export function StylePicker" apps/client/src/shared/ui/illustration` 都有命中。
- [x] 2. **`start-illustration.ts`**（纯函数）。
  - **`initialChoice(info: StartIllustrationInfo): StartIllustrationInput`：**
    - `enabled`：`info.available && info.autoEnabled`。自动出图开着时，新开局默认有插图；
    - `style`：`info.lastStyle ?? info.authorStyle`；
    - `aspectPreference`、`resolutionTier`：`info.defaults`；
    - `protagonistInFrame: false`；
    - `protagonistAppearance: null`；
    - `protagonistSnapshotId: null`。
  - **`summaryText(choice, t)`：** 摘要，例如 `本局插图 · 水彩 · 自动比例 · 1K`，或 `本局纯文字`（§2.1「插图默认收起，摘要显示…」）。各片段用 i18n 键拼成列表后，用 `t('play:start.illustration.summary', { parts })` 显示，`parts` 的连接符也来自文案，**不在代码里写死**。
  - **`toStartInput(choice)`：** `enabled` 为 false 时，其余字段照传，core 会忽略。`protagonistInFrame` 为 false 时，`protagonistAppearance` 和 `protagonistSnapshotId` 都置为 `null`。
- [x] 3. **`StartIllustrationPanel.tsx`。**
  - 只在 `info.illustration.available` 时渲染。
  - 默认收起，标题行显示摘要，用 Base UI 的 `Collapsible`。
  - **展开后，从上到下：**
    1. 「本局插图」「本局纯文字」两个选项。自动出图没开（`autoEnabled` 为 false）时，「本局插图」禁用，并说明 `play:start.illustration.autoOff`（要先在设置里开启）。
    2. 画风：`StylePicker`，传 `authorDefault = info.illustration.authorStyle`。
    3. `StylePreview`：`viewWorkId` 是作品 id。
    4. 比例和分辨率：选项来自 `api.image.outputPreferences.get()`。文案和每档的像素显示同 T21 的 `OutputDefaultsPanel`。这里照着写一份，不导入设置页的组件：两处的上下文不同，开局页的选择只管这一局。
    5. 「画进插图」「用主角视角，不画主角」两个选项。
    6. 选了「画进插图」时：
       - 主角形象 `TextArea`：上限 `APPEARANCE_MAX_LENGTH`，不能换行；
       - 「按设定写一个」按钮：调用 `api.play.suggestAppearance({ workId })`，结果填进文本框，**不自动提交**；生成中按钮禁用，并显示 `GeneratingMarker`；
       - `PortraitSetEditor`：`scope: 'pending'`，`target: { kind: 'protagonist' }`，`appearance` 用当前文本框的值，`mode: 'player'`，`onSnapshot` 记下 `protagonistSnapshotId`。
  - 说明文字 `play:start.illustration.styleLocked`：画风开局后锁定。
  - **离线时**（服务状态是 `offline`），预览和生成显示离线原因，但「开始故事」照常可用（§2.1：服务离线时，仍可选本机图片，预览生成显示离线原因，开局照常）。
- [x] 4. **`StartPage.tsx`。**
  - 在主角填写项之后渲染 `StartIllustrationPanel`，选择存在页面的 state 里；
  - 提交 `play.start` 时带上 `illustration: toStartInput(choice)`；
  - 页面顶部挂 `<WakePrompt serviceId={imageConfig.selectedServiceId} />`。用 T20 的 `queryKeys.imageConfig` 查询 `api.image.services.list()`，未返回时传 `null`。
- [x] 5. **i18n。** 照附录 A.4 加标「T23」的键。
- [x] 6. **测试。**

  `start-illustration.test.ts`：
  - `initialChoice` 在四种 `available × autoEnabled` 组合下的 `enabled`；
  - `lastStyle` 优先于 `authorStyle`；
  - `toStartInput` 在不入画时清掉形象和快照。

  `StartIllustrationPanel.test.tsx`：
  - `available: false` 时整个块不渲染；
  - **默认收起：** 摘要文字正确；
  - **按设定写一个：** 点了以后文本框里是伪接口返回的形象；伪接口**没有**收到 `play.start`；
  - **用作本局参考：** 在 `PortraitSetEditor` 里「用作本局参考」后，点「开始故事」，`play.start` 的输入里 `protagonistSnapshotId` 是那个组 id；
  - **不入画：** 切到「用主角视角，不画主角」再开始，`protagonistAppearance` 和 `protagonistSnapshotId` 都是 `null`；
  - **离线：** 服务状态 `offline` 时「开始故事」可用；
  - axe 没有违规。

**接线点。**

| 功能 | 挂在哪 |
| --- | --- |
| `StartIllustrationPanel` | `StartPage.tsx`，1 处 |
| `play.start` 的 `illustration` | `StartPage.tsx` 的提交，1 处 |
| `WakePrompt` | `StartPage.tsx`，1 处 |

**注意事项。**

- 主角形象是玩家输入，按纯文本处理。
- 不要在 client 里校验「快照还有没有效」，由 core 在开局时判断（T13）。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 「按设定写一个」后自动提交开局：「没有收到 `play.start`」变红 |
| 同上 | `toStartInput` 不清快照：「不入画」那条变红 |
| `rg -n "StartIllustrationPanel\|WakePrompt\|illustration:" apps/client/src/features/play/StartPage.tsx` 三个都命中 | — |

---

### T16 core：镜头描述

**目的。** 实现[插图与出图服务 §8](../docs/image.md#8-镜头描述)：用 `background` 用途、经 `complete()` 不带工具，让模型按固定格式写出一张图的镜头。core 做四件事：

- 解析；
- 校验：引用、比例、真名、画面说明的泄露；
- 不合格时最多重写 2 次；
- 拼上 core 固定的内容：画风片段、避开文字、主角不入画（§7.3）。

**依赖。** T14（`SceneMaterials`）、T13（`styleFragment`、`LlmRunRef` 的 `'illustration'`）。

**拥有的文件。** 新建 `packages/core/src/illustration/shot.ts`、`shot-prompt.ts`、`shot-parse.ts`、`shot-compose.ts`，以及它们的 `*.test.ts`。

**先读。**

- [插图与出图服务 §7.2](../docs/image.md#72-一张插图的流程) 第 2–3 步、§7.3、§8 全文；
- 附录 B.8（系统提示）、C.1（输出格式）、C.2（输入格式）；
- [LLM 端点 §7](../docs/llm-endpoints.md#7-用途分配)：`background` 不要求工具调用。

**步骤。**

- [x] 1. **核对前提。** T13、T14 已合入：`rg -n "export function sceneMaterials" packages/core/src/story/scene-projection.ts`、`rg -n "'illustration'" packages/core/src/llm/types.ts` 都有命中。
- [x] 2. **`shot-parse.ts`**（附录 C.1、D5）。

  ```ts
  export type ShotLabel = 'PROMPT' | 'NEGATIVE' | 'CAPTION' | 'REFS' | 'ASPECT';
  export function parseShotText(text: string): { ok: true; fields: Partial<Record<ShotLabel, string>> } | { ok: false; errors: string[] };
  ```

  - 按行切分，忽略空行。
  - 每行必须匹配 `/^(PROMPT|NEGATIVE|CAPTION|REFS|ASPECT):(?: (.*))?$/u`，捕获缺省时用空字符串：
    - 不匹配的非空行算一条错误（附录 B.8 的「格式不对」）；
    - 同一标签出现两次算一条错误。
  - 值去首尾空白，空值记为空字符串。
  - 输入首尾有成对的 Markdown 围栏时去掉这一对，留下断开的围栏由格式校验报错，见附录 C.1。
- [x] 3. **`shot-prompt.ts`。**
  - `SHOT_SYSTEM_PROMPT`：附录 B.8 原文。
  - `buildShotPrompt(input: ShotInput): string`：按附录 C.2 拼出给模型的用户提示。`ShotInput`：

    ```ts
    export interface ShotInput {
      materials: SceneMaterials;
      language: string;
      style: IllustrationStyle;
      protagonistInFrame: boolean;
      aspects: string[];
      fixedAspect: string | null;
      referenceViews: Record<string, PortraitSlot[]>;
      maxReferences: number;
      negativePrompt: boolean;
      contentPolicy: string;
    }
    ```

    - `referenceViews` 的键是 `ScenePerson.code`，值是这个人可用的参考位置，由 T18 按参考组算好传进来；
    - `maxReferences` 是 `Math.min(ILLUSTRATION_MAX_REFERENCES, 能力的 maxReferences)`。
  - `buildCorrectionPrompt(original, previousOutput, errors)`：原提示加上「你上一次的输出」和逐条的错误，格式见附录 C.2 末尾。
- [x] 4. **`shot.ts`：`describeShot(deps, input, ref, { signal, guard })`。** `guard` 使用 T13 的 `NonNullable<LlmCompleteInput['guard']>`。

  ```ts
  export interface ShotResult {
    prompt: string;
    negative: string | null;
    caption: string;
    refs: Array<{ code: string; view: PortraitSlot }>;
    aspect: string;
    corrections: number;
  }
  ```

  1. 调用 `deps.llm.complete({ purpose: 'background', system: SHOT_SYSTEM_PROMPT, prompt, sessionId, ref, maxOutputTokens: 800, signal, guard })`。`sessionId` 用 `illustration-<插图 id>`。
  2. 解析，再按下面的规则校验；有错误时用 `buildCorrectionPrompt` 再调一次，仍传第一次的 `guard` 和 `signal`，由 T13 的 `createCompleter` 防止修正发往新端点。最多重写 2 次，仍不通过时抛 `LlmRunError('invalid_output', null)`。守卫失效直接中止。

  **校验规则（[插图与出图服务 §8](../docs/image.md#8-镜头描述)「校验」）：**
  - `PROMPT`、`CAPTION` 必填，不能为空。
  - `REFS` 为空时没有参考。否则按逗号切分，每项必须是 `C<数字>:<位置>`，并且：
    - 编号在 `materials.people` 里；
    - 这个人在 `referenceViews` 里有这个位置；
    - 编号不重复；
    - 数量不超过 `maxReferences`。
  - `PROMPT` 里每个 `{{ref:N}}` 的 `N` 都在 1 到 `refs.length` 之间。
  - **比例：**
    - `fixedAspect` 为空并且 `aspects.length > 1` 时，`ASPECT` 必填，并且在 `aspects` 里；
    - 其他情况下忽略模型写的 `ASPECT`，用 `fixedAspect ?? aspects[0]`（§8：比例已确定时，模型多写的 `ASPECT` 不参与校验）。
  - **真名：** `PROMPT` 和 `NEGATIVE` 里不出现 `materials.bannedNames` 的任何一个。大小写无关、子串匹配（D7）。
  - **泄露：** `CAPTION` 里不出现 `materials.unknownNames` 的任何一个（D8）。
  - `CAPTION` 不超过 `SHOT_CAPTION_MAX_LENGTH = 200` 个字符，不含换行。
  - `negativePrompt` 为 false 时，忽略 `NEGATIVE` 的内容，不算错误。

  3. **结束时**在 `finally` 用同一单调时钟记 `illustration.shot`，按结果写 `ok`、`error` 或 `interrupted`，`data` 只有 `corrections`、`refs` 个数和 `autoAspect`。
  - 每条错误的文字照附录 B.8 的错误清单，**写死在常量里**。
- [x] 5. **`shot-compose.ts`**（§7.3），纯函数：

  ```ts
  export function composeFinalPrompt(input: {
    shot: ShotResult;
    style: IllustrationStyle;
    protagonistInFrame: boolean;
    negativePrompt: boolean;
  }): { prompt: string; negativePrompt: string | null };
  export function dropReference(prompt: string, refs: ShotResult['refs'], index: number, replacement: string): { prompt: string; refs: ShotResult['refs'] };
  ```

  - **`composeFinalPrompt`：**
    - 正面提示词依次是：
      1. 预设画风的英文片段；自定义画风不加片段，因为它已经由模型写进 `PROMPT`；
      2. `shot.prompt`；
      3. 主角不入画时的固定句；
      4. `negativePrompt` 为 false 时，加避开文字的固定句。
    - 用 `', '` 连接，固定句的原文见附录 B.7。
    - `negativePrompt` 为 true 时：负面提示词是 `shot.negative` 加上固定要避开的词，用 `', '` 连接。
    - `negativePrompt` 为 false 时，负面提示词为 `null`。
  - **`dropReference`**（§8「某个人物改用文字时」）：把 `{{ref:<index+1>}}` 换成 `replacement`（这个人这一刻可见的外貌文字），后面的引用序号依次减一，并从 `refs` 里删掉这一项。T18 在某个人选不到合格参考图时用它（§7.2 第 3 步）。
- [x] 6. **测试。** 用 `createScriptedLlm`。

  `shot-parse.test.ts`：
  - 五个标签都在；
  - 标签重复；
  - 有一行不是标签；
  - 包在代码围栏里；
  - `REFS:` 后面是空值。

  `shot.test.ts`：
  - **一次合格：** 结果的 `refs` 映射正确，样本里 `corrections === 0`。
  - **真名：** 第一次 `PROMPT` 里有真名（大小写不同也算），第二次改好：`complete` 被调用两次；第二次的提示词里有「你上一次的输出」和真名那条错误的原文。两个调用记录的 `guard` 和 `signal` 都与传入值相同。去掉修正调用的守卫参数，第二次调用的断言变红。
  - **泄露：** `CAPTION` 里出现 `unknownNames` 的一个，返回修正。
  - **比例：** 自动、有多个比例、`ASPECT` 不在列表里时返回修正；固定比例时模型写了别的 `ASPECT`，结果用固定比例、不修正，对应 [插图与出图服务 §14](../docs/image.md#14-验收)「用户固定竖图，镜头模型多返回了横图的 `ASPECT`」。
  - **引用：** `REFS` 里的编号不在场、视角不可用、重复、超过上限，各一条；`{{ref:3}}` 但只有两个参考，一条。
  - **三次都不合格：** 抛 `invalid_output`。
  - **称呼不在禁止之列：** 「撑伞的女人」这类称呼在 `PROMPT` 里，不算真名，不返回修正（§8）。

  `shot-compose.test.ts`：
  - 能力 `negativePrompt: false` 时，正面提示词以附录 B.7 的避开文字句结尾，负面为 `null`；
  - 能力为 true 时，负面里有固定词，正面里没有那一句；
  - 主角不入画时有那一句；
  - `dropReference(…, 0, '一个高个子男人')`：原来的 `{{ref:2}}` 变成 `{{ref:1}}`，`refs` 少一项。

**接线点。** T18 的 `pipeline.ts` 调用 `describeShot`、`composeFinalPrompt`、`dropReference`。

**注意事项。**

- **不用工具调用**，`background` 模型可能不支持工具（[插图与出图服务 §14](../docs/image.md#14-验收)「`background` 用途配的是一个不支持工具调用的模型」）。
- 提示词、画面说明不进诊断，只记次数和枚举。
- **重写次数和回合循环的修正次数相同**（§8），都是 2。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 真名检查改成大小写敏感：「大小写不同也算」变红 |
| 同上 | 去掉泄露检查：「泄露」那条变红 |
| 同上 | 比例已确定时也校验 `ASPECT`：对应用例变红 |
| 同上 | `dropReference` 不调整后面的序号：变红 |
| `rg -n "tools:" packages/core/src/illustration/shot.ts` 零命中 | — |

---

### T17 core：人物参考组

**目的。** 实现[插图与出图服务 §6.2](../docs/image.md#62-人物参考组)：

- 作者的参考组草稿、导入、生成、补齐视角、复核、采用、撤下；
- 玩家的主角预览和快照；
- 画风预览；
- 插图流程按需为本局人物生成基础组（T18 调用）；
- `portrait.updated` 事件和日志。

**依赖。** T11（`image.generate`）、T13（`appearanceHash`、`styleFragment`）、T15（`ImageStore`）。

**拥有的文件。**

- 新建：`packages/core/src/illustration/portraits.ts`、`portrait-prompt.ts`、`portrait-views.ts`、`portrait-runner.ts`，以及它们的 `*.test.ts`。
- 改：`packages/core/src/illustration/service.ts`，替换 `portraitDraft`、`portraitGet`、`portraitUpload`、`portraitGenerate`、`portraitUpdate`、`portraitAdopt`、`portraitPreview` 七个占位。

**先读。**

- [插图与出图服务 §6.2](../docs/image.md#62-人物参考组) 全文、§9.2 两张表下面的说明、§9.3、§10 的过程表；
- [创作流程 §3](../docs/authoring-flow.md#3-确认故事方案再生成开场)；
- T05 的 `illustration-types.ts`（`PortraitSlotsStoredSchema`、`PortraitTasksSchema`）。

**步骤。**

- [x] 1. **核对前提。** T11、T13、T15 已合入：
  - `rg -n "not implemented: image\." packages/core/src/image/service.ts` 零命中；
  - `ls packages/core/src/illustration/storage.ts packages/core/src/illustration/appearance.ts` 都存在。
- [x] 2. **`portrait-prompt.ts`**（附录 B.9）。
  - `frontPrompt(appearance, style)`：用形象文字里的稳定外貌特征加画风，固定构图是平视的头肩像、放松表情、简单衣着、素净背景。
  - `viewPrompt(view, style)`：`three_quarter`、`full_body` 的固定构图，用 `{{ref:1}}` 指代正面图。
  - `previewPrompt(style)`：画风预览用固定题材，附录 B.10。
  - 预设画风用 `styleFragment`；自定义画风的原文直接放进提示词，标为 `style: <原文>`。自定义画风可能是中文，出图模型对它的理解不保证，写进 `docs` 的已知限制由 T00 负责，本任务不处理。
- [x] 3. **`portrait-views.ts`。** `toView(row)`：把一行 `portrait_sets` 转成 `PortraitSetView`。
  - `slots` 按 `front`、`three_quarter`、`full_body` 的顺序；
  - 每个位置的 `task` 从 `task` 列取，`status: 'running' | 'failed'`；
  - 没有任务时为 `null`。
- [x] 4. **`portrait-runner.ts`。** 后台执行生成任务：
  - `run(task: () => Promise<void>)` 把任务放进一个集合，`whenIdle()` 等集合清空。
  - 生成请求本身经 `image.generate` 进入按服务的队列，这里不另外限制并发。
- [x] 5. **`portraits.ts`。** 每个导出函数对应一个过程，参数是 `deps`（`db`、`bus`、`logger`、`image`、`store`、`runner`）加输入。`ImageDispatchGuard` 从 `services.ts` 导入，不直接导入 `image/` 的内部文件。

  **`draft`：**
  - **`scope: 'work'`，`target.kind` 必须是 `entity`：**
    1. 校验这个 id 是草稿里的人物实体，或者草稿方案里 `kind = 'entity'`、`entityKind = 'character'` 的项，否则抛 `not_found`；
    2. `appearance` 取方案项或实体档案的形象，忽略输入的 `appearance`；
    3. 找这个人 `state = 'draft'` 的组：有就返回；没有就新建，`slots` 从当前 `active` 组复制，没有 `active` 组时用 `EMPTY_PORTRAIT_SLOTS`；
    4. 返回 `{ draft, activeSetId }`。
  - **`scope: 'pending'`、`target.kind: 'protagonist'`：**
    1. `entity_id` 是发布版本的主角实体 id，`appearance` 用输入的值，可以为 `null`，存为空字符串；
    2. 找这部作品这个主角的 `pending` 草稿：有就返回，形象和输入不同时更新 `appearance`、`appearance_hash`，`draft_rev` 加一；没有就新建；
    3. `activeSetId` 恒为 `null`。
  - **`style`：**
    - 作者草稿用作品画风 `effectiveStyle(works.illustration_style)`；
    - 主角预览也用作品画风：开局页选的画风不进草稿，镜头提示词会写明本局画风（§6.2：参考可以跨画风取用）。

  **`get`：** 按 id 返回视图，没有时抛 `not_found`。

  **`upload`**（§6.2「导入」）：
  1. 组必须是 `draft`，`expectedRev === draft_rev`，否则抛 `stale_revision`；
  2. 读出 `File` 的字节；
  3. 用 `store.stage(bytes, { rejectMetadata: true, maxBytes: PORTRAIT_IMPORT_MAX_BYTES })`；
  4. 长边超过 `PORTRAIT_IMPORT_MAX_EDGE` 时抛 `image_invalid_upload`，`stage` 抛 `ImageStoreError('validate')` 时也抛它；
  5. `store.commit([staged], () => 事务)`：事务里再次核对 `draft_rev`，然后：
     - 写这个位置：`file`、`source: 'import'`、`needsReview: false`；
     - 换的是正面时，把其他有图的位置设成 `needsReview: true`；
     - `draft_rev` 加一；
     - 这个位置正在跑的任务清掉：它的结果到了也作废。
  6. 提交后发布 `portrait.updated { workId }`，记 `portrait.done`，`source: 'import'`。
  - 原文件名不入库（§6.2）：不读 `File.name`。

  **`generate`：**
  1. `image.selectedServiceId()` 为 `null` 时抛 `image_not_configured`；
  2. 组必须是 `draft`，并核对修订号；
  3. 正面要求 `appearance` 非空，否则抛 `invalid_input`；
  4. 其他位置要求正面有图，否则抛 `invalid_input`；
  5. **规格**（§6.2「默认使用可用的竖图比例，优先用 1K」）：
     - `format` 不为空时用它；
     - 否则比例取能力 `aspects` 里第一个高大于宽的，优先 `3:4`；档位优先 `1k`，没有时用 `default`；
     - 解析出实际尺寸；
  6. **登记任务**，写进 `task[位置]`：`attemptId`、`status: 'running'`、`format`、`quality: 'best'`、`appearanceHash`（当前 `appearance_hash`）、`inputFiles`（非正面时是正面的 `file`）。`draft_rev` 加一，发布 `portrait.updated`。
  7. **在 `runner` 里异步执行：**
     1. 调用 `image.generate`：参考图是正面的字节，`ref.kind: 'portrait'`、`manual: true`；
     2. 结果 `stage`；
     3. 用 T15 的 `store.commit` 写入守卫重读草稿。核对组仍为 `draft`、位置任务 id 仍是本次的、形象哈希未变。非正面位置再核对当前正面的文件哈希等于本次 `inputFiles[0].hash`。任一不符，丢弃暂存文件。只有库里该位置仍归本次尝试时才清掉它的任务并发布变更，保留现有图片和待复核状态。其他视角完成所推进的整组修订号不使输入仍相同的任务过期；
     4. 写入位置：`source: 'generate'`、`needsReview: false`；生成的是正面时，其他位置设为待复核；
     5. 清掉任务，`draft_rev` 加一，发布事件，记 `portrait.done`。
     - **失败时：** 用同样的任务 id、形象和正面引用核对。仍属于当前输入时才改成 `status: 'failed'`、`error: <码>`，记 `portrait.failed`，发布事件。输入已换时沿用第 3 小步的过期处理。
  - 返回登记后的视图，**不等生成完成**。

  **`update`：** 核对修订号。
  - `remove`：清掉这个位置；清的是正面时，其他位置设为待复核。
  - `confirm`：`needsReview: false`。
  - `draft_rev` 加一，发布事件。

  **`adopt`**（§6.2「采用」、§9.2 说明第二条）：
  1. 组必须是 `draft`，`expectedRev` 相符，否则抛 `stale_revision`；
  2. **作者（`scope: 'work'`）：**
     - 当前 `active` 组的 id 必须等于 `expectedActiveSetId`，两个都是 `null` 也算相等，否则抛 `stale_revision`；
     - `mode: 'adopt'`：正面有图并且不是待复核，否则抛 `invalid_input`。在一个事务里：把旧的 `active` 组改为 `retired`；插入新行：`state: 'active'`，`slots` 只含有图、并且不是待复核的位置（其余位置置空），`appearance`、`appearance_hash`、`style` 复制自草稿。草稿保持 `draft`，`draft_rev` 加一。
     - `mode: 'retire'`：把当前 `active` 组改为 `retired`。
  3. **玩家（`scope: 'pending'`）：** 只有 `mode: 'adopt'`，不核对 `expectedActiveSetId`。核对正面存在且已通过复核后才创建快照。插入一个 `scope: 'pending'`、`state: 'active'` 的快照，内容同上；返回的 `activeSetId` 是快照 id。
  4. 提交后发布事件，记 `portrait.adopted`。
  5. 返回 `{ draft, activeSetId }`。

  **`preview`**（画风预览，§6.2 最后一段）：
  1. 新建一个 `scope: 'pending'`、`entity_id: null`、`appearance: ''`、`state: 'draft'` 的组，`style` 是输入的画风；
  2. 立即登记正面的生成任务：`quality: 'fast'`，不带 `size`，用服务默认尺寸；
  3. 提示词是 `previewPrompt(style)`，没有参考图；
  4. 其余同 `generate`；
  5. 返回视图。

  **`ensurePlaythroughFront`**（T18 用，§9.2 说明第一条「开局按人物和可见身份起点只登记一组基础参考。并发请求共用同一组和正在生成的正面」）：

  ```ts
  export function ensurePlaythroughFront(deps, input: {
    playthroughId: string;
    workId: string;
    entityId: string;
    serviceId: string;
    guard: ImageDispatchGuard;
    identityFactId: string | null;
    appearance: string;
    style: IllustrationStyle;
    signal: AbortSignal;
  }): Promise<{ setId: string; front: ImageFileRef }>;
  ```

  - 按 `(playthroughId, entityId, identityFactId)` 找 `scope: 'playthrough'` 的组：
    - 有正面就直接返回；
    - 组在、但正面还在生成：等同一个进程内的 Promise。用一个 `Map<键, Promise>` 单飞，键是这三个值拼起来；
    - 没有组：插入一行 `state: 'draft'`，唯一索引挡住并发插入，插入冲突时重新查一次；然后生成正面，成功后设成 `active`。
  - 组没有正面而需要生成时，把调用方固定的 `serviceId`、`guard` 和 `signal` 传给 `image.generate`。生成完经 T15 的写入守卫提交，在锁内再运行 `guard.assertCurrent()`。生成失败由 T18 记录；失效时按 `AbortError` 中断。
- [x] 6. **`illustration/service.ts`。** 把七个占位换成第 5 步的函数。`whenIdle` 改成等 `runner`。`recoverInterrupted` 在 T18 统一实现，本任务先在 `portraits.ts` 导出 `failInterruptedPortraitTasks(db, logger)`。把所有 `running` 任务改成 `failed`、`image_interrupted`，提交后按 §2.5 给每个改动的任务记一条恢复事件，返回改了几个。
- [x] 7. **测试。** 用 T08 的伪出图服务做出图后端。T06、T11 已经合入，用真的 `createImageService` 加伪服务的配置，不用替身。

  | 用例 | 断言 |
  | --- | --- |
  | 作者草稿 | 方案里还没确认的人物也能建草稿（§9.4：方案项也算现有人物）；非人物的方案项抛 `not_found` |
  | 导入正面 | 视图里正面有图；`portrait.updated` 被发布一次，并且是在事务提交之后：订阅回调里查库，能看到新图 |
  | 导入带 EXIF 的 JPEG | 抛 `image_invalid_upload`，位置不变 |
  | 替换正面 | 已有的斜侧脸、全身变成待复核；采用时它们不进新的 `active` 组，对应 [插图与出图服务 §14](../docs/image.md#14-验收)「同一个草稿正在重画正面」那一行 |
  | 迟到的生成结果 | 生成正面时让伪服务慢一点，期间导入一张新正面；生成结果到达后，正面仍是导入的那张 |
  | 侧脸基于旧正面 | 阻塞用旧正面生成的侧脸任务，导入新正面后释放。当时侧脸位置为空，结果返回后它仍为空，采用快照里也没有旧侧脸。阳性对照用新正面生成，侧脸可保存和采用 |
  | 两页并发 | 作者在一页采用新组后，另一页用旧的 `expectedActiveSetId` 撤下：抛 `stale_revision`，新组仍是 `active`（§14「两个页面都看到同一个已采用组」） |
  | 修订号 | 用过期的 `expectedRev` 调用任一写操作：抛 `stale_revision` |
  | 玩家快照 | `pending` 草稿采用后得到快照 id；快照只含当时就绪的位置，之后补完的视角不会写进快照 |
  | 画风预览 | 伪服务收到 `quality: 'fast'`、没有 `size`、没有参考图 |
  | `ensurePlaythroughFront` 并发 | 同一个键同时调用三次，伪服务只收到一次出图请求，三个调用拿到同一个 `setId` |
  | 生成失败 | 伪服务 `failNextJob('out_of_memory')`：这个位置的任务是 `failed`、`image_out_of_memory`，记了 `portrait.failed` |
  | 中断的任务 | 一个 `running` 任务，调用 `failInterruptedPortraitTasks` 后变成 `failed`、`image_interrupted`，草稿里已有的图保留 |

**接线点。**

| 功能 | 调用方 |
| --- | --- |
| 七个过程 | T06 已接好的路由 |
| `ensurePlaythroughFront` | T18 的插图流程 |
| `failInterruptedPortraitTasks` | T18 的 `recoverInterrupted` |

**注意事项。**

- 写文件一律经 `store.stage` 和 `store.commit`（T15），不直接写 `images/`。
- 事务里不 `await`：`commit` 的 `transaction` 回调是同步的。
- 发布事件在 `commit` 返回之后。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 生成结果提交时不核对 `attemptId`：「迟到的生成结果」变红 |
| 同上 | 删掉提交守卫对正面文件哈希的核对：「侧脸基于旧正面」变红，旧侧脸进入采用组 |
| 同上 | 采用时不排除待复核的位置：「替换正面」变红 |
| 同上 | `ensurePlaythroughFront` 去掉单飞：伪服务收到三次请求，变红 |
| 同上 | 撤下时不核对 `expectedActiveSetId`：「两页并发」变红 |
| `grep -n "not implemented: illustration.portrait" packages/core/src/illustration/service.ts` 零命中 | — |

---

### T18 core：插图流程

**目的。** 把前面的零件串成[插图与出图服务 §7](../docs/image.md#7-插图)的完整流程：

- 回合提交时登记插图，开场图标为第 0 段；
- 后台工作循环按步骤处理：唤醒、主角形象、镜头描述、参考图、出图、保存；
- 重试、重画、不要这张图；
- 停用时取消；
- 重启时恢复；
- 回合视图里的插图；
- 进入开局时预热。

**依赖。** T11、T12、T13、T15、T16、T17。

**拥有的文件。**

- 新建：
  - `packages/core/src/illustration/enqueue.ts`、`illustration/worker.ts`、`illustration/pipeline.ts`、`illustration/references.ts`、`illustration/views.ts`、`illustration/cancel.ts`；
  - 它们的 `*.test.ts`；
  - `packages/core/src/illustration/pipeline.integration.test.ts`。
- 改：
  - `packages/core/src/illustration/service.ts`：替换 `retry`、`reroll`、`dismiss`、`prewarm`、`recoverInterrupted`、`whenIdle`；
  - `packages/core/src/play/service.ts`：登记插图、插图视图；
  - `packages/core/src/play/opening-job.ts`、`packages/core/src/play/start.ts`：开场图；
  - `packages/core/src/services.ts`、`app.ts`、`main.ts`、既有装配测试、`api/http-app.test.ts` 与直接构造 play 的三个测试，限工作循环回调及夹具的 `kick`。

**先读。**

- [插图与出图服务 §7](../docs/image.md#7-插图) 全文、§9.2 的 `illustrations` 和它下面的说明、§10 的「回合视图里的插图」；
- [回合循环 §10](../docs/turn-loop.md#10-开场) 第 4 步（开场以 `illustrate_para = 0` 标记）；
- T14、T16、T17 的导出。

**步骤。**

- [x] 1. **核对前提。** T11、T12、T13、T15、T16、T17 已合入：
  - `rg -n "export function describeShot|export function ensurePlaythroughFront|export function sceneMaterials" packages/core/src` 三个都有；
  - `rg -n "not implemented: illustration\.(retry|reroll|dismiss|prewarm)" packages/core/src/illustration/service.ts` 列出四个占位。
- [x] 2. **`enqueue.ts`。**

  ```ts
  export function illustrationEnabled(
    settings: PlaythroughIllustration,
    activeTarget: { serviceId: string } | null,
  ): boolean;
  export function enqueueIllustration(
    tx: StoryTx,
    input: { turnId: string; playthroughId: string; para: number; settings: PlaythroughIllustration; now: number },
  ): string;
  ```

  - `illustrationEnabled`：`settings.enabled && activeTarget !== null`（§7.1「启用条件」）。
  - `enqueueIllustration`：插入一行 `status: 'queued'`，`format_preference` 取本局的 `{ aspectPreference, resolutionTier }`，`attempts: 0`，返回新行的 id。
  - **只在事务里调用，** 由调用方传入 `tx`。
- [x] 3. **回合提交时登记**（§7.1）。
  - **`play/service.ts` 的续写提交**（T12 加了 `illustratePara` 的同一个 `tx.insert(turns)`）：
    - 事务之前，读开局行的 `illustration` 和 `image.activeTarget()`。`activeTarget` 是同步的，取一次传进事务；
    - 事务里，`draft.illustratePara !== null` 并且 `illustrationEnabled(...)` 时，调用 `services.illustration.enqueue(tx, { turnId, playthroughId, para, settings, now })`；
    - 提交后：
      - 有登记时记 `illustration.flagged`，`data: { routeId, depth, para }`；
      - 调用 `worker.kick()`；
      - 发布 `illustration.updated`。
    - 没有启用时，`illustrate_para` 照样写，但不登记。这个值以后给「换一种发展」的采用用（§7.1「候选不画」），本里程碑没有候选。
  - **开场图**（[回合循环 §10](../docs/turn-loop.md#10-开场) 第 4 步）：
    - `play/start.ts` 的固定人物开场，和 `play/opening-job.ts` 的每局生成开场，在写根回合的 `tx.insert(turns)` 里：`illustrationEnabled(...)` 为真时，`illustratePara: 0`，并在同一个事务里调用 `services.illustration.enqueue(tx, { para: 0, ... })`；
    - 两处的写法相同，规划时分别在 `start.ts` 第 246 行、`opening-job.ts` 第 351 行附近；
    - 提交后同样 `kick` 并发布事件。
  - **`play` 拿不到 `image` 服务时：** `ServiceFactories.play` 在 T13 已经加了 `image`；`illustration` 服务的 `worker.kick` 要通知过去，所以 `play` 还需要一个回调。在 `ServiceFactories.play` 的依赖里再加 `illustration: IllustrationService; onIllustrationQueued: () => void`，`app.ts` 里在建好 `illustration` 之后接上 `illustration.kick`。
    - **先后关系：** `illustration` 只依赖已有的 image、llm 和 CoreDeps，先创建它，再把 `() => illustration.kick()` 交给 play。三个提交点使用同一个回调。
    - `IllustrationService` 接口加 `kick(): void`。
    - 这些装配和类型化夹具改动都归本任务。用 `rg -n "createPlayService\(|ServiceFactories|: Services" packages/core/src` 核对调用与夹具，真实装配传实际回调，已有纯文字替身用空回调。
- [x] 4. **`references.ts`：选参考组和参考图**（§6.2「路线上的可见身份」、§7.2 第 3 步）。

  ```ts
  export function referenceViewsFor(db, input: {
    people: ScenePerson[];
    settings: PlaythroughIllustration;
    playthroughId: string;
    maxReferences: number;
  }): Record<string, PortraitSlot[]>;

  export async function pickReferenceFiles(deps, input: {
    refs: ShotResult['refs'];
    people: ScenePerson[];
    settings: PlaythroughIllustration;
    playthroughId: string;
    workId: string;
    serviceId: string;
    guard: ImageDispatchGuard;
    maxReferenceBytes: number;
    signal: AbortSignal;
  }): Promise<Array<{ code: string; setId: string; slot: PortraitSlot; file: ImageFileRef } | { code: string; drop: string }>>;
  ```

  - **每个人的参考组，按顺序找：**
    1. 主角：本局的 `protagonistPortraitSetId`（开局时选的快照）。
    2. 其他人，`identityFactId === null`：本局的 `authorPortraitSetIds[entityId]`，即开局时锁定的作者组。
    3. 找不到时：`scope = 'playthrough'` 的组，`(playthroughId, entityId, identityFactId)` 对应的那一组。
  - **`referenceViewsFor`：** 一个人能用的位置是：他的组里有图的位置；如果还没有组、但这个人有可见形象，并且能力 `maxReferences > 0`，就算 `['front']`，因为可以现画（§6.2「没有参考组时，第一次需要入画再生成正面」）。
  - **`pickReferenceFiles`，对镜头选中的每个人：**
    - **还没有组：** 调用 `ensurePlaythroughFront`，形象用这个人此刻可见的形象，服务、守卫和信号沿用本次插图。
    - **按顺序选一张：** 镜头要的视角、正面、同组其他视角；取第一张不超过 `maxReferenceBytes` 的（§7.2 第 3 步）。
    - **组里每一张都超过上限：** 抛 `ImageError('image_reference_too_large', 'final')`。
    - **这个人没有可见形象、也没有组：** 返回 `{ drop: <这个人此刻的称呼或「一个人」> }`。调用方用 `dropReference` 把引用换成文字（§8）。
- [x] 5. **`pipeline.ts`：一次尝试**（§7.2）。`ImageError`、`ImageDispatchGuard` 从 `services.ts` 导入，不直接导入 `image/` 的内部文件。

  ```ts
  export async function runAttempt(deps, row: IllustrationRow, signal: AbortSignal): Promise<void>
  ```

  - 在 `pipeline.ts` 由本次尝试创建一个同步的 `assertCurrent`，检查 `signal`，并复核以下条件。失败时抛 `AbortError`，由工作循环按取消路径退出。步骤入口、实际外发边界、结果写入都调用同一个守卫。
    - 本次尝试的 `attemptId` 仍等于库里的 `active_attempt_id`；
    - `illustrationEnabled(...)` 仍为真，`activeTarget()` 的服务 id、出图模型和 background 端点与模型仍逐字段等于开始时固定的接收方。

    守卫失效时，同一次尝试的结果作废（§7.1、§7.2）。把固定的 background 端点和模型加上这一个函数，传给 T13/T16 的 `LlmCompleteInput.guard`；把固定的出图模型加上同一个函数，传给 T11/T17 的 `ImageDispatchGuard`。游玩任务每个实际调用点都使用对应守卫。
  - **步骤，按顺序：**
    0. **固定目标与就绪：** 从 `activeTarget()` 保存本次确认的完整接收方，先用已有能力校验可以提前发现的规格问题，再调 `image.prepareGeneration(serviceId, { manual, signal, onWaiting, guard: imageGuard })` 取得服务当前能力。工作循环取到该记录时，将 `attempt_data.serviceId` 写为当前服务 id，并发布事件，让 client 能看到唤醒状态。之前只登记未开始的尝试，其 `serviceId` 保持空。未完成图等待唤醒时保持 `queued`，重画保持 `done` 和旧图。工作循环持有本尝试，等就绪后复核尝试 id、完整接收方和实际能力，再将未完成图改为 `running`。失败记在 `wake`。等待唤醒时如果进程中断，下次启动后有尝试 id 且已写入尝试服务 id 的 `queued` 按中断恢复，尚未取到的 `queued` 继续执行。
    1. **规格**（§7.2 第 2 步、§7.4「规格不可用」）：
       - 偏好取 `attempt_data.formatOverride ?? row.format ?? format_preference`。`row.format` 存在时，它的比例、档位和显式宽高是这次重试或重画的基准；只有 `formatOverride` 不为空时才按用户新选择覆盖。
       - 偏好是 `'default'` 档时，可用比例是全部 `aspects`；否则是 `resolutions` 里有这一档的比例；
       - 偏好是固定比例时，可用比例只有它自己（必须在可用比例里）；
       - 可用比例为空 → 以 `image_output_format_unavailable` 失败，`stage: 'shot'`，**本次不发模型或出图请求**；
       - 只有一个可用比例时，比例在这里就确定。
       - 普通重试和重画沿用已确定的比例、档位和显式宽高，调用 `image.assertFormat(capabilities, { aspect, size, quality: 'best' })` 确认仍可用。不可用就提示另选规格。只有 `formatOverride` 不为空时才按这次新选择解规格，按新的比例构图。
    2. **主角形象**（`stage: 'appearance'`）：本局 `protagonistInFrame` 为真、形象为空时，调用 T13 的 `suggestAppearance`，传同一个背景模型守卫和信号。写前重新运行 `assertCurrent()`，并且 `json_extract(illustration, '$.protagonistAppearance') IS NULL` 时才写（§6.1：补写只发生一次）。
    3. **镜头**（`stage: 'shot'`）：
       - `sceneMaterials(...)`；`skip` 时把这一行改成 `cancelled`，记 `illustration.cancelled`、`reason: 'no_material'`，结束；
       - 有可复用的镜头时跳过模型调用：`attempt_data.shot` 存在，并且它的 `capability` 和当前能力一致（比例列表、`maxReferences`、`negativePrompt` 都一样）；
       - 否则调用 `describeShot`，传固定的背景模型守卫、信号及 `referenceViewsFor` 和 `buildShotPrompt` 需要的材料；比例在第 1 步已经确定时，作为 `fixedAspect` 传入。
       - 镜头写进 `attempt_data`。
       - 比例在这一步才确定时，把 `format` 写进 `attempt_data` 和记录，并发布 `illustration.updated`，client 据此展开画框（§7.1「占位」）。
    4. **参考图**（`stage: 'portrait'`）：
       - `pickReferenceFiles` 传固定服务 id、出图守卫和信号；对 `drop` 项依次 `dropReference`；
       - 选中的文件在出图**之前**写进 `attempt_data.referenceFiles`，然后提交，这样清理不会删掉它们（§9.4「已登记的任务输入」）。
    5. **出图**（`stage: 'generate'`）：
       - `composeFinalPrompt`，再 `image.generate`，传固定服务 id、出图守卫和信号。参考图字节由 `store.read` 取；`quality: 'best'`；`size` 用 `format.size`；
       - `seed`：重画时取 `randomInt(0, 2 ** 31)`；其他时候为 `null`；
       - `manual`：尝试的 `kind` 不是 `first` 时为 true；
       - `ref: { workId, kind: 'illustration', id }`。
    6. **保存**（`stage: 'save'`）：
       - `store.stage(bytes)`，然后 `store.commit([staged], 事务, assertCurrent)`。写入锁内、正式文件就位前复核启用条件、接收方及尝试 id。守卫和事务之间没有异步操作。
       - 事务用同一个 `active_attempt_id` 作为更新条件，然后写：`status: 'done'`、`file`、`caption`、`prompt`、`negative_prompt`、`refs`（实体 id 和视角）、`reference_files`、`shot_capability`、`seed`、`service_id`、`model`、`format`，`error` 和 `stage` 清空，`attempts` 加一，`active_attempt_id` 和 `attempt_data` 清空。
       - 提交后发布 `illustration.updated`，记 `illustration.done`，以及样本 `illustration.total`。
  - **失败**（任一步抛出，并且不是中止）：
    - **这一行还没有完成图：** `status: 'failed'`，`stage` 是当前步骤，`error` 是错误码。把已完成的步骤留在 `attempt_data.completed` 里，`active_attempt_id` 清空。
      - 错误码怎样取：`ImageError`、`LlmRunError` 用它的 `code`；唤醒类的码（`image_wake_*`、`image_launcher_*`）一律把 `stage` 记成 `wake`；其他异常记 `internal`。
    - **这一行已有完成图**（重画失败）：`status` 保持 `done`，旧图和它的规格、说明、宽高、参考文件**全部不变**；`error` 记错误码，`active_attempt_id` 清空（§7.4、§9.2 说明第三条）。
    - 记 `illustration.failed`，发布事件。
- [x] 6. **`worker.ts`：工作循环**（D16）。
  - `kick()`：没在跑且 `deps.shutdown` 未中止时开始一轮。
  - **每轮：** 取 `status = 'queued'`，或者 `status = 'done' AND active_attempt_id IS NOT NULL` 的行（后者是待处理的重画），按 `created_at, id` 取队首（D16）。
    - 先核对开局仍在、开关和当前确认均有效。无效时把排队图标为 `cancelled`，已完成图只清除当前重画登记，提交后发布事件再取下一行，避免反复取到同一行。
    - 这一行没有 `active_attempt_id` 时，生成一个，写进去；
    - 固定比例的占位从行里的比例偏好给出。未完成图进入镜头流程时的状态切换由第 5 步统一写入，工作循环持有同一行到这次尝试结束；
    - 记样本 `illustration.queue`：入队到开始处理；
    - 然后 `runAttempt`。
  - 一次只处理一行，处理完再取下一行，直到取不到为止。
  - **中止：** 每行一个 `AbortController`，按插图 id 记在表里，供取消用。`AbortSignal.any` 合并行和 core 的 shutdown 信号。关停后退出循环，未取到的队列记录留库给下次启动。
  - `whenIdle()` 等当前这一轮结束。
- [x] 7. **`cancel.ts`：停用时取消**（§7.1 最后一条）。
  - 订阅 `deps.bus` 的 `image.config_changed` 和 `llm.config_changed`，订阅生命周期用 `deps.shutdown` 收回。收到后比较上一次和当前的完整已确认目标。确认失效或任一接收方改变时执行取消，单纯改分辨率偏好不取消：
    1. 在事务里收集受影响记录及它们各自的 `active_attempt_id`。把 `queued`、`running` 改成 `cancelled`，清掉尝试。带待处理重画的 `done` 只清尝试，保留完成数据。
    2. 提交后在工作循环持有的控制器表按插图 id 和尝试 id 找本次控制器并中止。已经开始的 `queued`（含正在等待授权）、`running` 和 `done` 重画都走这里，仅登记的行没有控制器。找到旧尝试时不能误中止同一张图的下一次尝试。
    3. 队列等待以及按需参考图使用这个尝试的信号。它中断本次对唤醒结果的等待，T11 的共享唤醒按原有生命周期继续。工作循环从中断中返回后继续取队，关停除外。
  - 记 `illustration.cancelled`，`reason: 'disabled'` 或 `'service_changed'`。
  - 给每一条受影响的插图发布 `illustration.updated`。
  - **重新开启后不补画**被取消的（§7.1）：被取消的行就停在 `cancelled`，不会再被工作循环取到。
- [x] 8. **`views.ts`。** `illustrationView(row): IllustrationView`：
  - `rerolling`：`status === 'done' && active_attempt_id !== null`；
  - `format`：已确定的规格；没有完成图时，取 `attempt_data.format ?? row.format`；
  - `image`：`file` 的宽高；
  - 等待或生成中的第一次出图，`serviceId` 取 `attempt_data.serviceId`。已有完成图保留已落库服务标识。还在初始队列并且比例固定时，`format` 可由比例、档位偏好给出，`size` 暂空。
  - 其余字段一一对应。
- [x] 9. **`play/service.ts` 的 `getRoute`。** 调用 `services.illustration.forRoute(routeId)` 取得这条路线上的插图视图，按回合挂到 `TurnView.illustration`。没有插图的回合为 `null`（D15）。
- [x] 10. **`illustration/service.ts`。**
  - **`retry(input)`**（§7.2「失败后不再自动重试」）：
    - 这一行必须是 `failed`，否则抛 `request_not_retryable`；
    - 启用条件不满足时抛 `illustration_not_enabled`；
    - 改成 `queued`，写 `active_attempt_id`、`attempt_data.kind: 'retry'`、`formatOverride: input.format`，保留已完成的步骤；
    - `kick`，返回视图。
  - **`reroll(input)`**（§7.4「重画」）：
    - 这一行必须是 `done`；
    - 写 `active_attempt_id`、`attempt_data.kind: 'reroll'`、`formatOverride`；
    - `formatOverride` 为空时以 `row.format` 为基准，沿用已确定的比例、档位和显式宽高；`row.format` 也为空时才回到 `format_preference`。镜头描述在能力一致时沿用，第 5 步第 3 小步的规则已经覆盖。
  - **`dismiss(input)`**（§7.4「不要这张图」）：
    - 任何状态都可以；
    - 改成 `dismissed` 并清掉 `active_attempt_id`。提交后调用和停用相同的控制器中止入口，以 id 匹配被撤销的尝试，包括等待授权或重画；
    - 记 `illustration.dismissed`，`hadImage` 表示有没有完成图。
  - **以上三个**都带 `requestId`：同一个 `requestId` 重发时返回同样的结果。用一个进程内的 `Map<requestId, 结果>` 记住，保留 10 分钟（[架构总览 §3](../docs/architecture.md#3-client-与-core-的通信)：双击和重发只生效一次）。
  - **`prewarm(input)`**（§12.3）：开局存在，并且 `illustrationEnabled(...)` 时，调用 `image.wake(activeTarget.serviceId, 'prewarm')`。不满足时什么也不做，返回 `{}`。
  - **`recoverInterrupted()`**（§9.4「重启」）：
    - `running` 或已开始尝试、正在等待唤醒的 `queued` 改成 `failed`、`image_interrupted`。等待唤醒用 `stage: 'wake'`；其余取 `attempt_data` 中第一个未完成的步骤，缺省 `generate`。只登记未开始的手动重试时保留排队，工作循环取到后才写入尝试服务 id；
    - 带待处理重画的 `done` 行，清掉 `active_attempt_id`，`error: 'image_interrupted'`；
    - 每张确实恢复过的插图写一次 `illustration.interrupted`，`requestId` 传插图 id；
    - 再调用 T17 的 `failInterruptedPortraitTasks`，每个恢复的参考位置记 `portrait.interrupted`；
    - 返回改了的总行数。
  - **`whenIdle()`**：等工作循环和 T17 的 `runner`。
  - **`kick()`**：交给工作循环。
- [x] 11. **测试。**

  **`enqueue.test.ts`、`views.test.ts`：** 纯函数的每种情况。

  **`pipeline.integration.test.ts`**，用真的服务装配：伪出图服务、伪 OpenAI 服务做 `background` 模型、`seedNorthCape` 的故事。每条用例对应 [插图与出图服务 §14](../docs/image.md#14-验收) 的一行：

  | 用例 | 断言 |
  | --- | --- |
  | 开场和标记的回合 | 开局后玩到 narrator 标了第 2 段的回合：两行插图，`para` 分别是 0 和 2；`whenIdle` 后都是 `done`，`TurnView.illustration` 有值 |
  | 纯文字开局 | 本局纯文字时，标记照写进 `turns.illustrate_para`，但没有插图行，伪出图服务收到 0 次请求 |
  | 自动出图未确认 | 同上 |
  | 自动比例的状态 | 自动比例、有多个比例时，`format` 在镜头那一步之后才有值；之前 `illustrationView` 的 `format` 为 `null` |
  | 规格不可用 | 选 `2k`，伪服务的能力里没有 `2k`：以 `image_output_format_unavailable` 失败，伪 OpenAI 模型收到 0 次调用，伪出图服务收到 0 次生成 POST。允许必要的能力探测（§14「开局表单打开后服务移除了 2K」） |
  | 重试从失败处继续 | 伪出图服务 `failNextJob`：`stage: 'generate'`；`retry` 后伪 OpenAI 服务**没有**再收到镜头描述的请求，只多了一次出图（§14「复用镜头描述和参考图」） |
  | 参考图顺序 | 两人入画，第一位没有可见参考、第二位有：伪出图服务收到的 `references` 只有一张，是第二位的图；提示词里第一位的引用被换成了文字（§14 那一行） |
  | 重画失败不动旧图 | 一张 `done` 的图 `reroll`，让出图失败：`status` 仍是 `done`，`file`、`caption`、`format` 和之前逐字段相等，`error` 有值 |
  | 迟到的结果 | 正在画时 `dismiss`，再放行伪服务：这一行仍是 `dismissed`，没有 `file`。另测锁内的尝试 id 核对，在结果已经暂存时替换库内尝试 id，保持旧信号未中止，放行后旧结果没有就位。合法尝试能写文件作阳性对照 |
  | 停用时取消 | 一张在画、一张排队、一张完成，关闭自动出图：排队的变 `cancelled`，伪服务没收到它的请求；在画的被中止；完成的仍是 `done`（§14「一张正在画、一张排队、一张已完成」） |
  | 授权等待期间停用 | 让伪启动器保持 `needs_action`，待插图写入尝试服务 id 后停用。重新开启并确认另一个已就绪服务，提交新图。旧启动器未完成授权且未收到 `stop` 时，新图已画成，旧图没有真正生成 |
  | 修正时更改背景模型 | 第一次镜头响应由旧端点阻塞，期间换背景模型，放行不合格响应。断言新端点没收到原镜头材料或修正请求；配置不变时旧端点确实收到修正作为阳性对照 |
  | 写入锁等待时换接收方 | 持有图片写入锁，等结果进入暂存后变更确认。在用例里控制事件处理时机，让取消订阅尚未清掉尝试 id 再放行锁。仍无正式文件、完成状态和成功事件。配置不变时同一路径能提交 |
  | 重启 | 手动把一行设成 `running`，调用 `recoverInterrupted`：变成 `failed`、`image_interrupted` |
  | 预热 | 服务配了伪启动器，开局存在并启用：`prewarm` 让伪启动器收到一次 `start`；纯文字开局时收到 0 次 |
  | 不用工具的模型 | 伪 OpenAI 服务的模型不支持工具调用（只回文本）：镜头描述照常写成（§14「`background` 用途配的是一个不支持工具调用的模型」） |

  **`worker.test.ts`：** 一次只处理一行：两行同时排队，第二行的开始时间晚于第一行的结束时间。

**接线点。**

| 功能 | 落点 | 挂上去的地方 |
| --- | --- | --- |
| 续写时登记 | `services.illustration.enqueue` | `play/service.ts` 的续写提交事务，1 处 |
| 开场图 | `services.illustration.enqueue(tx, { para: 0, ... })` | `play/start.ts`、`play/opening-job.ts` 的根回合事务，2 处 |
| 唤醒工作循环 | `kick` | 上面 3 处提交之后，加上 `retry`、`reroll` |
| 回合视图 | `services.illustration.forRoute` | `play/service.ts` 的 `getRoute`，1 处 |
| 停用时取消 | `cancel.ts` 的订阅 | `createIllustrationService` 里订阅一次 |

**注意事项。**

- 守卫失效进入取消路径。在修改旧尝试的失败或取消状态前，再用尝试 id 确认它仍归本次处理。诊断结果用 §2.5 的 `illustration.cancelled` 和已有计时样本，只记录原因枚举、尝试结果和计数。
- **重试只有一层**，在 T11（[packages/core/AGENTS.md §4](../packages/core/AGENTS.md#4-模型调用)）；镜头描述的重写在 T16。本任务不另加重试。
- 不要在事务里调用 `image.generate` 或 `describeShot`。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 续写时不检查 `illustrationEnabled`：「纯文字开局」变红 |
| 同上 | 重试时不复用镜头描述：「重试从失败处继续」变红 |
| 同上 | 重画失败时把 `status` 改成 `failed`：「重画失败不动旧图」变红 |
| 同上 | 删掉写入锁内守卫对尝试 id 的核对：「迟到的结果」里未中止的旧尝试会留下正式文件，断言变红 |
| 同上 | 取消时只中止 `running`：「授权等待期间停用」的新图完成断言变红 |
| 同上 | 删除写入锁内的接收方核对：「写入锁等待时换接收方」变红 |
| 同上 | 调用镜头修正时省略背景模型守卫：T16 用伪 `complete` 断言每次输入带同一守卫，变红；T13 用真实 `complete` 验证错配时不会外发 |
| 同上 | 参考图不先登记到 `attempt_data`：在 `pickReferenceFiles` 之后、出图之前插入一次 `collectGarbage`，并把保护期打桩为 0，参考文件被删，出图失败，变红。这一条写进集成测试 |
| `rg -n "\.enqueue\(" packages/core/src --glob '!*.test.ts'` 正好 3 处 | — |
| `grep -n "not implemented:" packages/core/src/illustration/service.ts` 只剩 `file` 一处，由 T19 替换 | — |

---

### T19 core：取图、手记缩略图与内容安全策略

**目的。** 三件事，见[插图与出图服务 §10](../docs/image.md#10-交给-client)、[架构总览 §2.1](../docs/architecture.md#21-本机接口的安全)：

- 实现唯一的取图入口 `image.file`：按视图来源核对归属，返回字节和类型；
- 手记里给主角见过的人物附上可见基础组的正面缩略图；
- 内容安全策略的 `img-src` 加上 `blob:`。

**依赖。** T15、T17、T18。

**拥有的文件。**

- 新建：`packages/core/src/illustration/file-access.ts`、`file-access.test.ts`、`illustration/journal-portraits.ts`、`journal-portraits.test.ts`。
- 改：
  - `packages/core/src/illustration/service.ts`：替换 `file`；
  - `packages/core/src/story/journal.ts`：`buildJournal` 加一个可选参数；
  - `packages/core/src/play/service.ts`：`getJournal` 传缩略图；
  - `packages/core/src/api/http-app.ts`：响应头；
  - `packages/core/src/api/client-assets.ts`：CSP；
  - 以及这几处的测试。

**先读。**

- [插图与出图服务 §10](../docs/image.md#10-交给-client) 前四条、§14 最后一行（两条路线的手记）；
- [数据模型 §5](../docs/data-model.md#5-可见性规则)；
- [架构总览 §2.1](../docs/architecture.md#21-本机接口的安全) 的 CSP；
- 现有的 `story/journal.ts`、`api/client-assets.ts` 的 `contentSecurityPolicy`（按函数名找）。

**步骤。**

- [x] 1. **核对前提。** T18 已合入：`grep -n "not implemented:" packages/core/src/illustration/service.ts` 只剩 `file`。
- [x] 2. **`journal-portraits.ts`。**

  ```ts
  export function journalPortraits(db: Database, input: {
    routeId: string;
    projection: StoryProjection;
    settings: PlaythroughIllustration;
    playthroughId: string;
  }): Map<string, { setId: string; updatedAt: number }>;
  ```

  - **只给主角见过的人物。** 判断「见过」：人物和主角之间的 `acquaintance` 阶段是 `met` 或 `familiar`，用 `acquaintanceStage`，按符号名找（§10「主角见过的人物才可能返回」）。
  - **用哪一组：** 当前路线可见的形象身份，用 T14 的同一套规则，以路线 head 的最后一段为「这一刻」，算出 `identityFactId`。然后按 T18 第 4 步的顺序找参考组：本局锁定的作者组，或本局的 `playthrough` 组。组里的正面有图才算数。
  - 欠缺可见参考时，不给这个人缩略图（§10）。
- [x] 3. **`story/journal.ts`。** `buildJournal(p, routeId, portraits?)`：`portraits` 是一个 `Map<entityId, { setId, updatedAt }>`，有时给对应的 `JournalSubject` 填 `portrait`。不传时都是 `null`。**`story` 不导入 `illustration`**：缩略图由调用方算好传进来。
- [x] 4. **`play/service.ts` 的 `getJournal`。** 读开局行的 `illustration`，调用 `services.illustration.journalPortraits(...)`，把结果传给 `buildJournal`。`play` 不直接导入 `illustration/` 的内部文件。用 `rg -n "from '\.\./illustration/" packages/core/src/play` 确认零命中。
- [x] 5. **`file-access.ts`：`resolveImageFile(db, store, input)`**（§10 第一条）。
  - **`view.kind: 'work'`：**
    - 只允许 `image.kind: 'portrait'`；
    - 组的 `work_id` 必须等于 `view.workId`，`scope` 是 `work` 或 `pending`。作品编辑看作品的组，开局预览看预览所属作品的组。
  - **`view.kind: 'route'`：**
    - `illustration`：插图的 `turn_id` 必须在这条路线的祖先链上，`status` 是 `done`，`file` 不为空；
    - `portrait`：这个组和位置必须正是 `journalPortraits` 为这条路线返回的某一项，并且 `slot === 'front'`。
  - **核对不过**一律抛 `not_found`，不区分「没有」和「不许看」（§2.6）。
  - **读文件：** `store.read(ref)`，返回 `null` 时抛 `image_file_missing`（§7.4「文件找不到了」）。
  - **返回：** `new File([bytes], `${id}.${ext}`, { type: ref.mime })`。文件名里只用记录 id，不用哈希（§10：存储哈希留在 core）。
- [x] 6. **`illustration/service.ts`。** `file(input)` 调用 `resolveImageFile`。
- [x] 7. **`api/http-app.ts`。** 给取图的响应加 `X-Content-Type-Options: nosniff`：

  ```ts
  app.use('/api/image/file', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
  });
  ```

  放在 `app.all('/api/*', …)` 之前。先在测试里确认 oRPC 对 `image.file` 的路径是 `/api/image/file`。
- [x] 8. **`api/client-assets.ts`。** `img-src 'self' data:` 改成 `img-src 'self' data: blob:`，其他指令不变。`api/http-app.test.ts` 里断言 CSP 的用例同步改。
- [x] 9. **测试。**

  `file-access.test.ts`：
  - **作品视图：** 能取本作品的组；取另一部作品的组抛 `not_found`；作品视图取插图抛 `not_found`。
  - **路线视图：** 能取本路线上已完成的插图；取另一个开局的插图抛 `not_found`；`failed` 的插图抛 `not_found`。
  - **文件被删：** 抛 `image_file_missing`。
  - **返回值：** 类型和记录一致，字节逐字节相等。
  - **两条路线**（[插图与出图服务 §14](../docs/image.md#14-验收)最后一行）：同一个开局的两条路线。现在只有一条路线的过程，测试里直接插第二条 `routes` 行，指向同一个根回合下的另一个回合。路线 A 的主角见过某人、路线 B 只听说过：A 的手记有这个人的缩略图，B 的没有；用 A 返回的组 id 和位置从 B 取图，抛 `not_found`。

  `journal-portraits.test.ts`：
  - 只听说过的人没有缩略图（[docs/milestone-4.md](../docs/milestone-4.md#验收)「手记里有一位只听说过的人物」）；
  - 有作者组的见过的人有缩略图；
  - 换装（`same_visible_identity: 1`）后仍是原基础组的正面。

  `http-app.test.ts`：
  - `image.file` 的响应有 `x-content-type-options: nosniff`，`content-type` 是图片类型；
  - 首页的 CSP 含 `img-src 'self' data: blob:`。

**接线点。**

| 功能 | 落点 | 挂上去的地方 |
| --- | --- | --- |
| 取图 | `resolveImageFile` | `illustration.file`，T06 已接路由 |
| 缩略图 | `services.illustration.journalPortraits` | `play/service.ts` 的 `getJournal`，1 处 |
| `nosniff` | `http-app.ts` | 1 处 |
| CSP | `client-assets.ts` | 1 处 |

**注意事项。**

- **这是取图的唯一入口**，归属核对就是安全边界。每一条「不许看」都要有用例。
- 不在响应里带哈希、路径。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| 本任务的测试全绿 | 路线视图取插图时不检查祖先链：「取另一个开局的插图」变红 |
| 同上 | 取参考图时不核对它是不是本路线手记返回的那一项：「两条路线」变红 |
| 同上 | 去掉 `blob:`：CSP 断言变红 |
| `grep -rn "not implemented:" packages/core/src/illustration` 零命中 | — |

---

### T29 core：装配、恢复、清理时机与集成测试

**目的。** 让独立运行和 desktop 共用同一套插图服务。每次启动时先恢复中断任务、清理临时文件和无引用图片，再接收请求。删除作品后清理一次，关停时等正在清理的文件处理完。

**依赖。** T11、T17、T18、T19。T18 已将三处回合提交接到插图工作循环，T19 已接取图授权。

**拥有的文件。**

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/services.ts` | 声明启动准备方法和删除提交后的回调 |
| `packages/core/src/illustration/service.ts` | 用 T15 已有的同一个图片存储准备启动 |
| `packages/core/src/library/service.ts`、`library/service.test.ts` | 在真实删除提交后发出清理通知，验证删除和重复删除 |
| `packages/core/src/app.ts`、`app.test.ts` | 在两个运行入口共用的装配里接上恢复、清理、关停和启动失败 |
| `packages/core/src/api/http-app.test.ts`、`desktop/channel.test.ts` | 同步必填启动方法及工厂夹具 |
| `packages/core/src/main.ts` | 核对生产工厂，有缺口时只补工厂绑定 |
| `packages/core/src/app.integration.test.ts` | 通过真实 RPC、数据库和文件系统验证跨模块路径 |

**先读。** [插图与出图服务 §9.4](../docs/image.md#94-清理)、[§11](../docs/image.md#11-调用记录与诊断)、[运行诊断 §3](../docs/diagnostics.md#3-性能样本)、[core 约定](../packages/core/AGENTS.md)。在源码里按 `startCore`、`stopRuntime`、`waitForTasks`、`recoverInterrupted`、`createLibraryService`、`work.deleted` 找现有接线。规划时，独立运行和 desktop 都在 `main.ts` 调 `startCore`，删除事务在 library 服务的 `delete`。

**步骤。**

- [x] 1. **核对前提。** 用 `rg -n 'startCore\(|createLibraryService\(|onIllustrationQueued|recoverInterrupted|collectGarbage|clearTemp' packages/core/src --glob '!*.test.ts'` 列出调用点。定位 T15 建的图片存储、T18 接的三处登记和 T19 接的取图。检查 `ServiceFactories` 在生产和测试的构造点。任一前提不成立，按 §0.3 汇报。
- [x] 2. **`services.ts`、`illustration/service.ts`，准备存储。** 在 `IllustrationService` 加 `prepareStorage(): Promise<void>`。实现先在 T15 建的存储上执行 `store.clearTemp()`，然后等待同一服务的 `collectGarbage()`。`app.ts` 只调服务接口。这样启动清理与正常写图仍走同一个存储和写入锁。用 `rg -n ": Services|ServiceFactories" packages/core/src --glob '*.test.ts'` 核对 T06 的测试夹具，给仍使用替身的 `IllustrationService` 补 `prepareStorage`；真实工厂直接用投产实现。
- [x] 3. **`library/service.ts`，从删除提交准确触发。** 给 `ServiceFactories.library` 和 `createLibraryService` 的依赖加 `onWorkDeleted?: () => void`，由 `startCore` 在生产装配一定传入。保留 `delete` 的同步返回和既有事件。在删除事务成功、受影响行数大于零时调回调一次，位置与 `works.changed` 同在提交之后。`library/service.test.ts` 用 spy 验证回调里已查不到作品，第二次删同一个 id 时计数仍为 1。作品保存、发布和画风更新共用 `works.changed`，所以清理触发点落在删除方法里。
- [x] 4. **`app.ts`，接生命周期。**
  1. 按依赖顺序创建共用的 providers 存储、llm、image、illustration，再创建依赖它们的 play 和 library。把 `illustration` 服务和 `onIllustrationQueued: () => illustration.kick()` 一起传给 play，删掉 T18 如果留下的占位闭包。确认其他工厂仍能拿到原来的依赖。
  2. 删除回调调 `illustration.collectGarbage()`。用一个进程内 `Set<Promise<void>>` 跟踪还在跑的删除清理，任务结束后移出。每次成功删除都提交一次清理，由 T15 的写入锁串行执行。用 `catch` 记录 §2.5 的 `image.gc.failed`，处理为已结束的任务，避免未处理的 Promise 拒绝。删除已经提交，RPC 继续返回成功。
  3. 在现有恢复阶段调用 `illustration.recoverInterrupted()` 和 `image.pruneCalls()`，将恢复数量加入现有 `recovery.interrupted` 的 `data.illustrations`。随后等 `illustration.prepareStorage()` 结束，再继续启动 HTTP。此时可用的暂存文件只来自上一次进程。准备失败同样记 `image.gc.failed`，保留正常开局和正文路径。
  4. 恢复和清理结束、HTTP 监听成功后调用一次 `illustration.kick()`。工作循环接续仍在排队的记录。T18 恢复过的任务保持显式失败，等待玩家按张重试。
  5. 保留 `stopRuntime` 的顺序：发出 shutdown 信号、关 HTTP、等服务和清理、关库。把 images、illustrations 的 `whenIdle()` 和删除清理集合纳入 `waitForTasks`。开始等待清理之前 HTTP 已关闭，避免漏等最后一次删除。logger 在数据库和任务处置完才关闭，沿用现有的启动失败和退出处理。
- [x] 5. **`main.ts`，核对两个入口。** 独立运行和 desktop 分别传同一份 `factories` 给 `startCore`。实际工厂用 `createLibraryService`、`createImageService`、`createIllustrationService`、`createPlayService`。保留 T01 放在第一行的外发请求入口安装。两个入口都走第 4 步的流程。
- [x] 6. **`app.test.ts`，验证清理失败与关停。** 用服务替身让 `prepareStorage` 拒绝，验证 core 仍能处理作品列表查询。再让删除清理由一个可控 Promise 阻塞，经真实 library 删除后调用 `core.close()`，确认关闭未完成，放行后才完成。最后从 `diagnostics.db` 读取该次运行的事件，断言 `image.gc.failed` 的 `data.trigger`、`data.code`。在错误对象里塞入虚构原始文字，断言诊断库没有它。测试结束要放行 Promise 并关闭 core，即使用例中间失败也执行清理。
- [x] 7. **`app.integration.test.ts`，验证磁盘上的结果。** 用该文件现有的 `boot`、`configureModels`、`publishDefaultWork` 搭出真实服务，目录用 `makeTempDataDir()`。读库的方式照本文件已有的 `DatabaseSync` 用例。读取新增诊断前调用 `core.services.logger.flush()`，用动作前后计数锁定本次记录。启动前写入测试数据时，先关掉用 `openDatabase` 打开的连接，再启动 core。

  | 用例 | 输入与动作 | 断言 |
  | --- | --- | --- |
  | 从旧配置进入纯文字 | 用版本 1 的模型配置和伪模型服务，发布、开局、提交一次带越界标记和缺省形象的行动 | 有新回合且选项可读，插图为 `null`，版本 1 文件字节未变。随后开启有插图的独立用例，确认同一套伪出图服务能收到请求 |
  | 重启接好真实服务 | 预置一张 `running` 插图、一张 `queued` 插图、一组含已就绪正面和运行中视角的参考、一个带旧图的待重画记录。放入一个 `.part`、一个超过保护期的孤儿文件和一条超过调用保留期的记录。注册伪镜头和伪出图请求，再启动 core | `running` 变成 `image_interrupted`，运行中的参考位置失败且已有正面仍可取。重画恢复后旧图可取且尺寸、说明和字节一致。原 `queued` 完成且只它发出出图请求。临时文件、孤儿文件和过期调用都已移除。诊断里能按记录 id 找到恢复事件 |
  | 删除后清理且共享图可读 | 两部虚构作品通过正常服务引用同一张图片，将文件 mtime 调到超过保护期。经经过鉴权的 `works.delete` 删第一部，再删第二部 | 第一次删除后另一部通过 `image.file` 还能取到同样字节。第二次完成后等 `image.gc` 对应运行结束，文件消失。全过程都有真实删除和清理读数 |
  | 取图的真实接线 | 完成一张插图；同一个取图请求依次使用该路线、另一条无权路线、无令牌 | 合法请求取到已知字节和 MIME，带 `nosniff`；无权路线为 `not_found`；无令牌请求在鉴权层被拒绝 |

  从 `app.integration.test.ts` 现有读取诊断库的方式取 `image.gc`、`image.generate` 和恢复事件。按动作前后的计数差确认新增记录。轮询可观察的状态，使用明确的超时。进程、数据库、伪服务和临时目录由 `finally` 释放，重启用例复用同一数据目录至全部断言结束。
- [x] 8. **最终核对。** `rg -n 'not implemented:' packages/core/src --glob '!*.test.ts'` 零命中。先运行本任务三处测试，再跑 §0.5。对照 §2.5 核对诊断名和字段。复测旧配置。在 `main.ts` 核对两个入口都调用第 4 步这套装配。

**接线点。**

| 功能 | 落点 | 挂上去的地方 |
| --- | --- | --- |
| 获取共用的图片存储 | `prepareStorage` | `app.ts` 恢复后、监听前，1 处 |
| 删除后清理 | `onWorkDeleted`、`collectGarbage` | `library.delete` 提交后、`app.ts` 的 library 工厂参数，各 1 处 |
| 恢复、裁剪用量、接续排队 | `recoverInterrupted`、`pruneCalls`、`kick` | `startCore`，每项 1 处 |
| 等待清理和后台任务 | `waitForTasks` | `stopRuntime` 关数据库前，1 处 |
| 生产服务 | `factories` | `main.ts` 的 CLI 和 desktop 入口，各 1 处 |

**注意事项。** 恢复旧工作之前先完成清理。恢复事件只带记录标识、停止阶段和错误码，使用诊断现有的标识字段。清理失败的错误对象用 `diagnosticFault` 提取系统码，任何路径和原始错误文字留在进程内。没有新增用户可见状态，本任务不增加 i18n 键。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| `library/service.test.ts` 的删除回调断言通过 | 把回调移到删除事务前，回调中查不到作品的断言变红 |
| 清理失败后仍能查询，且有诊断 | 删掉清理异常处理，启动失败或诊断断言变红 |
| 关停等待删除清理 | 从 `waitForTasks` 移除清理集合，阻塞期间关闭未完成的断言变红 |
| 重启接好真实服务 | 分别移除启动的 `prepareStorage`、`recoverInterrupted`、`image.pruneCalls`、`kick` 调用。临时文件、中断状态、过期调用、排队图完成四条断言各自变红 |
| 删除后共享图仍可读，最终回收 | 去掉生产装配里的 `onWorkDeleted`，第二次删除后文件消失的断言变红 |
| 取图的真实接线 | 去掉 `image.file` 路由映射，合法请求的字节断言变红 |
| 全量检查与占位扫描通过 | 把任一插图方法临时改回 `not implemented:`，扫描命中。同一次改动不能保留到全量检查 |

---

### T30 端到端与评测

**目的。** 用伪服务从浏览器验证作者和玩家的实际操作，再给真实模型和实机验收准备固定的虚构故事与记录方法。

**依赖。** T21、T22、T23、T24、T29。

安装包、GPU、Colab 和外部模型的实测由 T31 执行。

**拥有的文件。** 新建 `e2e/tests/milestone-4.spec.ts`、`e2e/tests/support/milestone-4.ts`、`evals/illustration.md`。前两个文件分别放浏览器用例和进程、夹具、运行控制。评测文件放真实模型的输入、人工判据和记录表。

**先读。** [M4 验收](../docs/milestone-4.md#验收)、[插图与出图服务 §14](../docs/image.md#14-验收)、[可访问性约定](../docs/a11y.md)、本文附录 A–D。`e2e/playwright.config.ts` 的浏览器配置、`milestone-3.spec.ts` 的真实进程及页面操作、T08/T09/T10 的伪服务、core 测试中的 `llm-steps.ts`。

**步骤。**

- [x] 1. **核对前提。** 用 `rg --files e2e` 和 `rg -n 'startFakeImageServer|startFakeLauncher|startFakeOpenAiImages' packages/core/src/test-support` 核对文件和导出。规划时没有 `evals/`，Playwright 用 Desktop Chrome、单 worker。核对 `pnpm --filter @unwritten/e2e e2e --list` 可以列出 M1–M3 与 desktop 用例。任一前提不成立，按 §0.3 汇报。
- [x] 2. **`e2e/tests/support/milestone-4.ts`，提供隔离的环境。**
  1. 按 `milestone-3.spec.ts` 的 `startApp` 用 `mkdtempSync` 建目录，起伪文本模型、伪图片服务，需要时另起伪启动器。启动构建后的 `packages/core/dist/main.js`，使用临时数据目录与 `info` 日志等级。读取 `UNWRITTEN_CORE_URL` 后把 URL 交给测试。失败时给出超时或退出码，不把含令牌的启动行写入汇报。保持默认浏览器只与 core 通信。
  2. 支持三种配置：只有版本 1 模型配置、版本 2 选中出图服务且尚未确认、版本 2 含启动器。配置流程本身用 UI 保存；与它无关的用例可用固定配置减少重复。narrator 和镜头模型使用不同的模型 id。保留原有伪文本模型的工具步骤，镜头步骤输出附录 C.1 的纯文本，不发工具调用。
  3. 按 T08/T10 的接口用 `setReady`、`holdNextJob` 或请求记录推进状态。需要等待外部请求时用 `expect.poll`，记录具体方法和路径，区分探测、付费生成和取图。把 `jobDelayMs` 设到足够浏览器观察占位的值；测试等待占位和完成条件，不睡固定时长。恢复自动状态前核对已经观察到失败或授权。
  4. 每个用例在 `finally` 关 core 再关伪服务，最后删临时目录。启动半途失败时同样清理。使用自有虚构域名的授权地址，测试只检查链接目标或拦截新页，避免发外网请求。
- [x] 3. **`milestone-4.spec.ts`，按下面的编号写独立用例。** 使用角色和可读名称定位。文案从附录 A 取，至少一条用例写死产品名称验证 i18n 接线。每条涉及读图的用例都等 `img` 解码完成，验证 `naturalWidth > 0`，避免把空框当成功。验证缺失时同时确认正文、按钮、网络或其他图片已实际出现。

  | 编号 | 在浏览器里做什么 | 最终断言 |
  | --- | --- | --- |
  | E01 纯文字、升级与确认 | 用版本 1 开局加一次行动，模型省略形象且给越界段号；再从设置页添加出图服务、生成并保存令牌；尚未确认时再开一局，最后完成确认并选择插图开局 | 前两次文字都可继续且生成请求为零。保存后旧配置备份字节一致。令牌首次出现、离开设置再回来只见「已配置」。确认分别列出两个数据接收方，确认后的开局有图。已经配置时另明确选择「本局纯文字」，一整个回合仍无生成请求 |
  | E02 导入、采用与快照 | 无图片服务时导入人物正面，先取消一次，再预览确认并采用；重开作品查看。配置服务后生成或导入另一张正面，先开一局锁定旧组，再采用新组并开新局。开局页另选主角正面为本局参考，让非正面视角保持生成中。另一页面删除一部无关作品，等 core 完成清理，再从原开局页开始 | 本机导入有真实可读的正面且无外发生成，处理后的文件名与原名无关。新局与旧局重画实际发送不同的参考字节。玩家开局在其他视角完成前已经呈现正文，清理后的主角首次入画用了选定的正面 |
  | E03 规格、布局与减少动态 | 自动比例选 1K，给横图和竖图镜头；固定同一比例分别选 720 和 2K；再分别试旧插件只报告比例和只支持固定尺寸的兼容服务 | 伪服务的比例和像素匹配夹具，完成图的自然宽高与请求一致，旧协议请求省略 `size`。选 9:16 时在窄视口检查画框高度至多为阅读区一半。用 `page.emulateMedia({ reducedMotion: 'reduce' })` 重跑占位到填图，检查相关元素的计算样式里没有呼吸或位移动画 |
  | E04 可见段落与阅读位置 | 附录 D 的第 2 段标图、第 5 段揭晓。一张在上方、另一张在附近。向上读并将键盘焦点留在锚点段落，依次放行填图和失败，再按张重试 | 图在第 2 段之后。实际发出的镜头材料、图请求与说明只用第 2 段可见内容。选定锚点的视口纵坐标在每次状态变化前后误差不超过 2 CSS 像素，焦点仍在同一段，正文可选可读 |
  | E05 离线、恢复与取消 | 离线时推进两个带标记的回合，上线后只重试一张。另准备完成、排队和在画各一张，关自动出图后释放在画任务 | 正文新增。重试只多出所选图的一次生成，其余失败仍在。关闭后排队图没有发出生成，在画图迟到结果没有出现在新 GET 路线视图，已完成图仍可放大、保存 |
  | E06 大图、下载与手记 | 键盘打开大图、Esc、再打开、保存后移除；打开手记，夹具包含见过和只听说过的两人 | 大图可读名称与说明正确，下载的字节为伪图片内容，Esc 回按钮，移除后回原段。手记里已见者可解码，只听说过的条目没有图片。对开局、设置、创作、游玩、展开的大图和授权提示分别跑 Axe |
  | E07 支持参考的兼容接口 | 缓存有作者参考的局中画一张，再令下一张编辑被服务拒绝 | 请求到实际编辑路径，包含正确参考字节，完整呈现返回图片。下一张显示映射后的拒绝说明，正文可继续 |
  | E08 按需唤醒 | 伪服务离线，开带启动器的插图局，等授权状态；用键盘走「打开授权页」「继续」，让伪服务就绪 | 启动请求一次，带设置的空闲分钟数；授权期间正文一直可读；继续请求一次，随后提示消失、开场图可解码。用另一个用例选纯文字，确认正文成功且启动计数为零 |

  E04 结束后用 T29 的诊断库读法核对产出的插图 id，至少一条 `client.illustration_visible` 有对应 `request_id` 和 `outcome: ok`，同一 mount 中同一 id 的样本只有一条。按 §2.5、附录 D.2 验证敏感样本值没有进入诊断库。

  用 9:16 能力时显式配置对应比例。窄视口与减少动态由浏览器自动化覆盖，200% 系统放大和读屏发声留给 T31。E02、E05 用 `holdNextJob` 阻塞已登记任务，观察按钮、请求或占位后再释放。
- [x] 4. **`evals/illustration.md`，定好真实评测。** 按附录 D 写五个可重复的场景：多人交接钥匙、同一人物换装、未选择与已选择后的照明、线索近景、遮面到揭晓。每个场景写清开局设置、在第几段截取、需要观察的画面动作以及不应期待的后续信息。用同一段正文、同一画风、同一档位对照「正面＋全身」和「加斜侧脸」；服务支持 seed 时固定 seed。记录明确结果与证据，不从单次样本推总成功率。

  每次留一行，填场景、模型和服务版本、GPU、比例、档位及实际宽高、选择的段号、参考位置、镜头修正次数、出图和总耗时、判定、依据。另记开场后仍可提交行动的读数。用 §2.5 已有样本取时间，用诊断 id 串起记录；真实提示词、正文、图片、授权页和 URL 都不进版本控制。逐项核对谁递钥匙、谁收手、钥匙还在哪里。图像质量、角色能否辨认由 T31 人工观看，不把关键词命中当作画质合格。
- [x] 5. **跑门禁。** 先跑 `pnpm build`，再跑 `pnpm --filter @unwritten/e2e e2e milestone-4.spec.ts`，最后跑根目录 `pnpm e2e`，含之前所有里程碑和 desktop。按 §0.5 保存退出码和输出。评测文件只产生走查方案；真实结果由 T31 写台账。

**接线点。** Playwright 由现有 `testDir: './tests'` 发现 spec，`milestone-4.spec.ts` 通过 support 文件启动已有 core 入口。`evals/illustration.md` 由 T31 使用。客户端在 E01/E06/E08 的可读名称和提示来自约定的 i18n 键，性能数据沿 T24 与 core 的日志路径进入诊断库。

**注意事项。** E2E 操作经界面提交；只有建夹具可以预置配置和故事数据。开着真实服务的本机目录不进测试。等待断言以可见状态或实际协议请求为准。旧局重画需要在原路线打开；存档分支和候选采用按 §1.3 留到对应功能。

**完成判据。**

| 判据 | 突变 |
| --- | --- |
| E01、E02 通过 | 删除开启前的确认或预览确认，分别使生成计数或取消无上传的断言变红 |
| E03、E04 通过 | 固定把选好的尺寸换成另一档，实际请求尺寸变红；移除锚点补偿，E04 位移断言变红。移除 `reportSample` 调用，E04 的样本断言变红 |
| E05、E06 通过 | 跳过队列停用守卫，排队请求计数变红；移除大图关闭时的焦点归还，E06 焦点断言变红 |
| E07、E08 通过 | 所有兼容请求都走生成接口，编辑路径断言变红；移除继续按钮的 RPC 调用，继续请求断言变红 |
| `pnpm e2e` 通过 | 临时让 E01 的完成图断言定位一个不存在的名称，指定 spec 和根检查都报告失败 |
| 五个真实评测场景有记录模板 | 画质、构图和角色辨认由维护者人工评定，浏览器自动化没有这项判据 |

---

### T31 实机走查与收口

**目的。** 用维护者的 Mac、真实模型、GPU 和 Colab 证明这条路径可部署，在实际阅读中验证画面、重连和可访问性，保存可复核的验收记录。

**依赖。** T26、T27、T28、T30。真实环境、登录、Drive 授权和付费额度由维护者安排。

**拥有的文件。** `tasks/milestone-4.md` §6 台账。GPU 档位实测合格后由维护者填 `plugins/comfyui/workflows/manifest.json`；其他发现先按 §0.3 交回持有对应文件的任务修正。

**先读。** [M4 验收](../docs/milestone-4.md#验收)、[Colab 宿主 §14](../docs/colab-host.md#14-验收)、[ComfyUI 插件 §13](../docs/comfyui-plugin.md#13-验收)、[Colab 启动器 §10](../docs/colab-launcher.md#10-验收)、[Strata 自建模型服务 §14](../docs/strata.md#14-验收)；T30 的 `evals/illustration.md`；`scripts/app.mjs` 的本机打包入口。

**步骤。**

- [ ] 1. **核对前提。** `rg -n '"package"|"app"|"test:python"' apps/desktop/package.json package.json` 核对命令，核实四份部署文档的前提，核对本机、网络、GPU、账户和授权。材料缺哪一项就在台账点明哪几条验收暂缺证据。先跑不依赖缺失条件的其他检查。
- [ ] 2. **装包并验证本机路径。** 跑 `pnpm --filter @unwritten/desktop package`，用打出的 `Unwritten.app` 打开。开发模式用 `pnpm dev` 再走一次设置、创作、开局和仍可续写的纯文字路径。记录开发与安装包使用的版本、启动结果和退出结果。走查用虚构作品，手动数据留在维护者能复用的 `.data/`。
- [ ] 3. **测出图，填写真实档位。** 在满足条件的 GPU 跑 ComfyUI 自检；按 T26 的真实一致性试法验证四份工作流，至少覆盖无参考、单参考和多人参考，并检查实际宽高、成功解码与耗时。在 `plugins/comfyui/workflows/manifest.json` 只填写已实测通过的对应 GPU、比例和档位。更新后再探测能力，并按该能力选一张显式尺寸跑完协议。再走一次配置好的 OpenAI 兼容端点的文生图与编辑，费用操作在维护者授权后执行。
- [ ] 4. **走 Colab 接入与恢复。**
  - **宿主和网络。** 分别启动出图服务、模型服务，逐行记录宿主验收。服务就绪后检查两边的 Drive 均已卸载。由 Mac 访问两个服务；按宿主验收核对匿名请求以及节点之间的访问限制，记录结果码和服务就绪状态。
  - **出图按需启动。** 先让运行时关闭。进入插图开局，观察等待、授权、继续、服务就绪和首图。配置本次测试的空闲分钟数，等运行时实际释放，选下一回合的有效标记，让任务再次唤醒并出图。记录两次启动到就绪的秒数、动作状态和对应诊断 id。
  - **Strata。** 从设置页添加普通自定义端点，分给 narrator，完成开场与至少一个使用工具提交的续写回合。释放运行时后提交行动，确认显示离线，由维护者重新运行笔记本再重试，核对同一行动只产生一次成功的新回合。
- [ ] 5. **真实评测和可访问性。** 按 `evals/illustration.md` 跑两组参考对照并逐图判定。特别看递钥匙和收手的主体、换装前后是否认得出同一人物、近景线索有没有提前揭晓。用 VoiceOver 和纯键盘走设置的接收方确认、人物参考位置和导入错误、授权提示、大图关闭与移除的焦点。用 200% 放大和减少动态效果再读一次占位到填图，核对可见正文、阅读锚点和实际显示的尺寸。
- [ ] 6. **记证据，走收口。** 把 §0.5、`node scripts/check-doc-links.mjs`、`pnpm test:python`、`pnpm e2e` 的最终读数写 §6，登记真实结果和欠账。按根 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律) 取得当次授权后再提交、合回 `main`。确认合并成功后才移除已经收口的任务工作树与分支。把根 [AGENTS.md §10](../AGENTS.md#10-沉淀方法) 的核对结论一并记录。

**接线点。** 本机包与开发模式共用 T29 的装配。真实插件走同一套协议测试，维护者填的档位经 `/v1/info`、设置和开局表单、实际出图请求回读。浏览器授权后由原应用发 `continue`，空闲释放后由下一张图重新唤醒。

**注意事项。** 台账可以记模型版本、GPU、时间区间、错误码和诊断 id。令牌、Secret、服务和授权地址、用户作品正文、模型提示、原始图片留在各自的本机或宿主环境。实机付费、授权、合并沿用维护者的权限。

**完成判据。**

| 判据 | 复核方式 |
| --- | --- |
| 最终自动化门禁通过 | 沿用 T29、T30 和各协议任务已通过的突变记录，在最终集成树重跑原实现 |
| GPU 能力与实机读数一致 | 对照 `/v1/info`、`manifest.json` 与实际取图宽高。每一档都要有对应 GPU 的通过证据 |
| 部署、读屏与图像质量验收 | 这三项没有机器突变判据。维护者按第 3–5 步记录可复现的动作和实际表现，分别填写未执行的环境项 |
| 收口完成 | 授权后检查 `git worktree list`、`git branch` 和主工作区 `git status --short`，确认本轮任务已合入且工作树、分支已清理 |

---

## 附录 A · 中文文案

按键合并进 `apps/client/src/i18n/zh-CN/` 下对应的 JSON 文件。表中点号表示嵌套层级，`{{…}}` 是插值。已有对象逐键追加。复用 `common:action.cancel`、`common:action.retry` 和 `common:action.close`。地址、服务名、模型 id、形象及画面说明是运行数据，作为插值或纯文本节点渲染。

### A.1 errors（T02）

| 键 | 文案 |
| --- | --- |
| `image_not_configured` | 还没有选好出图服务。请在设置里选择一个服务。 |
| `image_unauthorized` | 出图服务拒绝了连接。请检查设置里的令牌或密钥。 |
| `image_quota` | 出图额度不足。请检查服务的额度和账单。 |
| `image_rate_limited` | 出图请求太多。请稍后重试。 |
| `image_offline` | 连不上出图服务。服务恢复后可以重试。 |
| `image_not_ready` | 出图服务还在准备。请稍后重试。 |
| `image_busy` | 出图服务的队列已满。请稍后重试。 |
| `image_refused` | 出图服务拒绝了这张图。 |
| `image_timeout` | 等待出图超时。你可以重试这张图。 |
| `image_server` | 出图服务发生错误。请稍后重试。 |
| `image_outcome_unknown` | 没收到出图结果。这次请求可能已经计费，请确认后再重试。 |
| `image_invalid_request` | 出图服务不接受这次请求。请检查服务的能力和设置。 |
| `image_invalid_response` | 出图服务返回的图片不符合要求。 |
| `image_redirected` | 出图服务把请求转到了另一个地址。请检查设置里的地址。 |
| `image_out_of_memory` | 出图服务的显存不足。请检查服务的运行环境。 |
| `image_workflow_error` | 出图服务没能运行出图工作流。请检查服务的配置。 |
| `image_interrupted` | 这次出图中断了。你可以重试。 |
| `image_file_missing` | 图片找不到了。 |
| `image_invalid_upload` | 这张参考图不符合要求。请重新选择图片。 |
| `image_reference_too_large` | 参考图超过了出图服务允许的大小。 |
| `image_output_format_unavailable` | 出图服务已不支持这组比例和分辨率。请为这张图另选规格。 |
| `image_launcher_offline` | 连不上出图服务的启动器。请确认启动器已运行。 |
| `image_launcher_unauthorized` | 启动器拒绝了连接。请检查启动器的令牌。 |
| `image_wake_failed` | 没能唤醒出图服务。请检查启动器，再重试。 |
| `image_wake_timeout` | 等待出图服务启动超时。你可以重试这张图。 |
| `illustration_not_enabled` | 这局的自动出图没有开启。 |

### A.2 settings（T21）

| 键 | 文案 |
| --- | --- |
| `nav.images`、`images.heading` | 出图服务 |
| `images.description` | 连接一个出图服务，用来画故事插图和人物参考。 |
| `images.selected` | 用于出图 |
| `images.disabled` | 不出图 |
| `images.add` | 添加出图服务 |
| `images.name` | 服务名称 |
| `images.address` | 服务地址 |
| `images.protocolLabel` | 协议 |
| `images.protocol.unwritten-image` | Unwritten 图像协议 |
| `images.protocol.openai-images` | OpenAI 图像接口 |
| `images.model` | 模型 ID |
| `images.token` | 令牌 |
| `images.newToken` | 新令牌 |
| `images.apiKey` | API 密钥 |
| `images.generateToken` | 生成令牌 |
| `images.copyToken` | 复制令牌 |
| `images.tokenOnce` | 令牌只在这里显示一次。请复制到服务一侧。 |
| `images.plainHttpWarning` | 这个地址使用明文 HTTP。发送的密钥和图片可能被网络上的其他人看到。 |
| `images.references` | 最多使用 {{count}} 张参考图 |
| `images.noReferences` | 只靠形象文字保持人物一致。 |
| `images.separator` | ` · `（两侧各一个空格） |
| `images.negativeSupported` | 支持负面提示词 |
| `images.negativeUnsupported` | 不支持负面提示词 |
| `images.referenceLimit` | 最多参考图 |
| `images.sizeMode` | 尺寸方式 |
| `images.sizeModes.fixed` | 固定尺寸 |
| `images.sizeModes.custom` | 自定义尺寸 |
| `images.lastProbe` | 最近探测于 {{time}} |
| `images.lastSuccess` | 最近一次出图于 {{time}} |
| `images.test` | 测试连接 |
| `images.testRunning` | 正在测试连接 |
| `images.testReady` | 已连接，服务就绪。 |
| `images.testNotReady` | 已连接，服务还未就绪。 |
| `images.testImage` | 生成测试图 |
| `images.paidConfirm` | 生成测试图可能产生费用。要继续吗？ |
| `images.testImageDone` | 测试图已生成，尺寸为 {{width}} × {{height}}。 |
| `images.edit` | 编辑 |
| `images.save` | 保存出图服务 |
| `images.remove` | 删除出图服务 |
| `images.removeConfirm` | 删除「{{name}}」的出图服务配置？ |
| `images.removeSelectedConfirm` | 删除正在使用的「{{name}}」后，新的插图将停止生成。已经完成的图仍可查看。 |
| `images.notReady.starting` | 出图服务正在启动。 |
| `images.notReady.out_of_memory` | 出图服务的显存不足。 |
| `images.notReady.workflow_error` | 出图服务没能运行出图工作流。 |
| `images.notReady.other` | 出图服务还未就绪。 |
| `images.launcher.heading` | 按需启动 |
| `images.launcher.enabled` | 通过启动器按需开关 |
| `images.launcher.address` | 启动器地址 |
| `images.launcher.token` | 启动器令牌 |
| `images.launcher.idleMinutes` | 连续空闲多少分钟后关闭 |
| `images.launcher.test` | 测试启动器 |
| `images.launcher.notConfigured` | 还没有配置启动器。 |
| `images.launcherState.stopped` | 已关闭 |
| `images.launcherState.starting` | 正在启动 |
| `images.launcherState.needs_action` | 等待授权 |
| `images.launcherState.running` | 已启动 |
| `images.launcherState.stopping` | 正在关闭 |
| `images.launcherState.failed` | 启动失败 |
| `images.privacy` | 镜头模型会收到正文片段、人物形象和镜头约束。出图服务会收到提示词和选中的参考图，其中可能包含本机导入处理后的图片。 |
| `auto.heading` | 游玩时生成插图 |
| `auto.confirmTitle` | 开启自动出图？ |
| `auto.confirm` | 确认开启 |
| `auto.backgroundReceives` | 「{{endpoint}}」的 {{model}} 会收到正文片段、人物形象和镜头约束。 |
| `auto.serviceReceives` | 「{{service}}」会收到提示词和选中的参考图。一张插图可能先用到几张生成的参考图。 |
| `auto.unavailable` | 请先选择出图服务，并为镜头描述配置 background 用途。 |
| `auto.reconfirm` | 数据接收方变了。请重新确认后开启。 |
| `output.heading` | 默认出图规格 |
| `output.multipleSizes` | 多个尺寸 |
| `output.onlyTier` | 当前只有这一档可用。 |
| `output.unavailable` | 当前服务不支持已选规格，请重新选择。 |
| `usage.heading` | 出图用量 |
| `usage.last7Days` | 最近 7 天 |
| `usage.last30Days` | 最近 30 天 |
| `usage.images` | {{count}} 张 |
| `usage.tokens` | {{input}} 输入 token，{{output}} 输出 token |
| `usage.noTokens` | 服务未报告 token 用量 |
| `usage.storage` | 插图和人物参考共占用 {{size}} |

`images.notReady` 由固定对照表和 `other` 回落显示。`images.launcherState` 从 contracts 的 `LAUNCHER_STATES` 校验覆盖。T21 核对按实际角色显示的文案，同时检查提交记录里只出现本次表单所需的密钥字段。付费测试图的返回契约只有尺寸，成功提示用该尺寸。

### A.3 common（T20）

| 键 | 文案 |
| --- | --- |
| `wake.heading` | 出图服务启动状态 |
| `wake.needsAction` | 出图服务需要你在浏览器里完成授权。 |
| `wake.open` | 打开授权页 |
| `wake.continue` | 继续 |
| `wake.continuing` | 正在继续 |
| `wake.waking` | 正在唤醒出图服务 |
| `wake.failed` | 没能唤醒出图服务 |

### A.4 play（T20、T23、T24）

每行归一个任务。T20 先建共用枚举，T24 加 `illustration`，T23 再往已有的 `start` 对象添加 `illustration`。

| 任务 | 键 | 文案 |
| --- | --- | --- |
| T20 | `style.watercolor` | 水彩 |
| T20 | `style.ink` | 水墨 |
| T20 | `style.anime` | 赛璐璐 |
| T20 | `style.painterly` | 厚涂 |
| T20 | `style.cinematic` | 写实电影感 |
| T20 | `tier.default` | 服务默认 |
| T20 | `tier.720` | 标准 · 720 |
| T20 | `tier.1k` | 高 · 1K |
| T20 | `tier.2k` | 非常高 · 2K |
| T20 | `format.aspect` | 画面比例 |
| T20 | `format.automatic` | 自动比例 |
| T20 | `format.tier` | 分辨率 |
| T20 | `format.dimensions` | {{width}} × {{height}} |
| T20 | `slot.front` | 正面 |
| T20 | `slot.three_quarter` | 斜侧脸 |
| T20 | `slot.full_body` | 全身 |
| T20 | `serviceState.ready` | 已就绪 |
| T20 | `serviceState.offline` | 离线 |
| T20 | `serviceState.waking` | 正在唤醒 |
| T20 | `serviceState.needs_action` | 等待授权 |
| T20 | `serviceState.wake_failed` | 唤醒失败 |
| T20 | `serviceState.unknown` | 尚未探测 |
| T20 | `wake.reason.quota` | 运行额度不足。 |
| T20 | `wake.reason.not_signed_in` | 请在启动器所在的电脑上登录。 |
| T20 | `wake.reason.action_expired` | 授权已超时。请重试，打开新的授权页。 |
| T20 | `wake.reason.start_error` | 启动器没能启动运行时。 |
| T20 | `stage.wake` | 唤醒出图服务时 |
| T20 | `stage.appearance` | 准备主角形象时 |
| T20 | `stage.shot` | 构思画面时 |
| T20 | `stage.portrait` | 准备人物参考时 |
| T20 | `stage.generate` | 生成图片时 |
| T20 | `stage.save` | 保存图片时 |
| T24 | `illustration.composing` | 正在构思画面 |
| T24 | `illustration.waking` | 正在唤醒出图服务 |
| T24 | `illustration.waitingAuth` | 等待完成授权 |
| T24 | `illustration.queued` | 插图在排队 |
| T24 | `illustration.drawing` | 正在画插图 |
| T24 | `illustration.open` | 放大查看插图 |
| T24 | `illustration.altFallback`、`illustration.lightboxTitle` | 插图 |
| T24 | `illustration.missing` | 图片找不到了 |
| T24 | `illustration.named` | 第 {{turn}} 回合的插图 |
| T24 | `illustration.opening` | 开场插图 |
| T24 | `illustration.failedAt` | {{stage}}，{{reason}} |
| T24 | `illustration.retryFormat` | 为这张图选择规格 |
| T24 | `illustration.reroll` | 重画 |
| T24 | `illustration.rerolling` | 正在重画 |
| T24 | `illustration.save` | 保存图片 |
| T24 | `illustration.dismiss` | 不要这张图 |
| T24 | `illustration.resolution` | {{width}} × {{height}} 像素 |
| T23 | `start.illustration.heading` | 插图 |
| T23 | `start.illustration.enabled` | 本局插图 |
| T23 | `start.illustration.textOnly` | 本局纯文字 |
| T23 | `start.illustration.summary` | {{parts}} |
| T23 | `start.illustration.separator` | ` · `（两侧各一个空格） |
| T23 | `start.illustration.autoOff` | 请先在设置里开启「游玩时生成插图」。 |
| T23 | `start.illustration.styleLocked` | 画风会沿用到本局结束。 |
| T23 | `start.illustration.modeLabel` | 正文配图 |
| T23 | `start.illustration.protagonistLabel` | 主角入画 |
| T23 | `start.illustration.inFrame` | 画进插图 |
| T23 | `start.illustration.outOfFrame` | 用主角视角，不画主角 |
| T23 | `start.illustration.appearance` | 主角形象 |
| T23 | `start.illustration.suggest` | 按设定写一个 |
| T23 | `start.illustration.suggesting` | 正在起草形象 |

T21–T24 的比例和档位字段复用 T20 的 `play:format.*` 和 `play:tier.*`。开场和普通回合各自使用对应的可读按钮名。出图完成与失败由玩家读到当前位置时发现，沿用 T24 的宣告规则。

### A.5 authoring（T22）

| 键 | 文案 |
| --- | --- |
| `style.heading` | 插图 |
| `style.label` | 画风 |
| `style.description` | 这是新开局的默认画风。玩家可以在开局时另选。 |
| `style.custom` | 自己写 |
| `style.customLabel` | 自定义画风 |
| `style.resetToAuthor` | 恢复作者默认 |
| `style.preview` | 预览画风 |
| `style.previewing` | 正在生成画风预览 |
| `style.previewAlt` | 画风示例，窗边放着一盏纸灯和一枝白花。 |
| `style.noService` | 请先在设置里选择出图服务。 |
| `plan.appearance` | 形象 |
| `plan.appearanceHint` | 只写此刻看得见的样子。身份和秘密留在设定里。 |
| `plan.noAppearance` | 还没有写形象。 |
| `plan.entity.appearance` | 形象：{{text}} |
| `portrait.heading` | 人物参考 |
| `portrait.slotHint.front` | 平视的头肩像，能看清五官、发际线和左右不对称的特征 |
| `portrait.slotHint.three_quarter` | 四分之三角度的头肩像，可看清鼻梁、下颌和侧面轮廓 |
| `portrait.slotHint.full_body` | 自然站立、完整入画，能看出身形和比例 |
| `portrait.slotAlt` | 人物参考 · {{slot}} |
| `portrait.empty` | 这里还没有图片。 |
| `portrait.generating` | 正在生成 |
| `portrait.needsReview` | 待复核 |
| `portrait.reviewHint` | 正面已换过。请查看其他视角，确认还能用的图片再采用。 |
| `portrait.needFront` | 请先准备一张正面图。 |
| `portrait.generateSettings` | 生成设置 |
| `portrait.fillViews` | 补齐视角 |
| `portrait.adopt` | 采用 |
| `portrait.useForPlaythrough` | 用作本局参考 |
| `portrait.retire` | 撤下 |
| `portrait.choose` | 选择图片 |
| `portrait.chooseNamed` | 为{{slot}}选择图片 |
| `portrait.useImage` | 使用这张 |
| `portrait.generate` | 生成 |
| `portrait.remove` | 移除 |
| `portrait.confirm` | 确认可用 |
| `portrait.sendNotice` | 生成图片时，出图服务「{{service}}」会收到提示词和本次选用的参考图。 |
| `portrait.importProblem.type` | 请选择 PNG、JPEG 或 WebP 图片。 |
| `portrait.importProblem.too_large` | 图片文件太大。请选择一张更小的图。 |
| `portrait.importProblem.too_many_pixels` | 图片的像素太多。请缩小后再选。 |
| `portrait.importProblem.decode` | 这张图片打不开。请换一张。 |
| `portrait.importProblem.encode` | 没能处理这张图片。请换一张。 |

---

## 附录 B · 给模型的文字

模板参数用 `<…>` 标出。常量放所列 core 文件，程序替换参数时只读对应输入。这里的文字属于模型协议，不放 client i18n。

### B.1 `propose_turn` 字段说明（T12）

`play/propose-turn-tool.ts` 的 `illustrate`。

> 可选。若这一回合有值得画的已发生瞬间，填正文段号，从 1 起数，只填一个数字字符串。可以选关键动作、人物互动、行动的可见结果、首次露出的线索或明显环境变化。没有合适的瞬间时留空。不要标记尚未被选择的行动或未来结果。

接在 `changes` 的 `trait` 示例后。

> 人物出现可见形象变化时，写一条 trait，key 填 "appearance"，statement 只写这一段已看到的外貌，para 填该段号。主角前后能认出同一人时可填 "same_visible_identity":"true"。这种特征只供呈现，不能作为 knowledge 的引用。

### B.2 narrator 提示（T12）

`play/narrator-prompt.ts` 放在现有的叙述约定后，按原提示的格式加两段。

> 一回合最多标一个已发生、可以定格的画面。优先选明确的动作、互动、玩家行动的可见后果、线索首次露出的细节或环境明显变化。人物与物件有互动时，正文交代谁在做什么、物件此刻在谁手里。普通过渡可以留空。不要为配图改写事件，也不要提前写出尚未发生的结果。
>
> 人物形象可省略。有确证时只写主角此刻能看到的长相、身形、衣着与显眼特征。伪装还没揭开时只写可见的伪装。揭开时在揭开的段落记录新的形象。形象里不写身份、来历、秘密或人物尚未表露的内心。

### B.3 形象引用的修正文案（T12）

`story/changes.ts` 的校验错误。

> 形象特征只用于呈现，不能作为 knowledge 的引用。删去这条引用，再提交。

### B.4 人物行的 `appearance`（T12）

供 `propose_cast`、`propose_opening`、`propose_preview`、`propose_plan` 的人物行说明使用。参数仍为字符串，行内的字段仍按原 JSON Lines 格式提交。

> 人物行可以带 appearance。用一行写此刻能看到的长相、身形、衣着或显眼特征，最多 300 字。看不清时省略。形象里不写真名、身份、来历和秘密。

示例字段为 `"appearance":"短卷发，左眉有一道浅缺口，穿深色短外套"`。计划、每局生成人物和开场预览的地方只加人物字段，地点、组织、物件的格式照旧。

### B.5 主角形象补写（T13、T18）

`illustration/suggest.ts` 放系统提示。T18 复用同一个提示构造和输出校验，分别传入发布版本的公开材料或该段能确认的主角材料。

> 写一行主角的可见形象，供画面保持一致。用作品语言。只用已提供的公开外貌线索，可以补足日常外貌细节。写长相、身形、衣着或显眼特征，最多 300 字。只交形象文字，不写名字、身份、来历、秘密、标题或说明。

用户提示按三行拼接，材料为空时保留标签。

```text
作品语言：<语言>
公开的主角档案：<档案文字>
公开的主角设定：<设定文字>
```

修正时在原提示末尾追加一行。

> 上一次的形象不符合要求。请重写为一行不超过 300 字的外貌文字，只交形象本身。

### B.6 付费测试图（T11）

`image/engine.ts` 的固定英文正面提示，测试只验证协议和尺寸。

```text
A single white ceramic cup on a blue tabletop, soft daylight, centered still life, no text or logos.
```

### B.7 画风片段与固定约束（T13、T16）

| 预设 | 英文片段 |
| --- | --- |
| `watercolor` | watercolor illustration, transparent washes, soft pigment edges, paper grain |
| `ink` | ink wash illustration, expressive brushwork, restrained tonal washes, open negative space |
| `anime` | cel animation illustration, clean contours, flat color shapes, precise cel shading |
| `painterly` | painterly illustration, textured brushstrokes, layered color, soft edges and deliberate focal detail |
| `cinematic` | cinematic realism, natural textures, motivated lighting, clear foreground and background separation |

`illustration/shot-compose.ts` 里的固定片段。

| 用处 | 英文 |
| --- | --- |
| 主角不入画 | first-person viewpoint, the viewpoint character is outside the frame |
| 服务无负面提示词 | keep the picture free of lettering, subtitles, labels, logos and watermarks |
| 固定负面提示词 | text, lettering, subtitles, labels, logos, watermarks |

### B.8 镜头描述与校验错误（T16）

`illustration/shot-prompt.ts` 的系统提示。

> 给故事画一个定格镜头。只用提供的正文、当时可见的人物形象和场景线索。先找这一刻值得画的动作或细节，再选能看清它的构图。写清谁在做什么、朝向谁、手里有什么，以及东西在这一刻的位置或状态。用空间安排和视线区分多人；需要时用近景表现线索，用横图表现人物并排和地形关系，用竖图表现高度。尚未选择的行动、稍后才发生的结果、未揭晓的身份和内心留在画外。
>
> 正面提示用英文。自定义画风只转成画面风格。内容边界只作为约束，不把其中的事实带进提示词或说明。使用提供的当时外貌，人物真名不进入正面或负面提示。选用参考人物时，按画面主次排 REF，把对应的 `{{ref:N}}` 放进正面提示，N 从 1 开始。人物在实际镜头中的朝向另写。没有参考时写可见外貌。主角是否入画照镜头要求。
>
> 画面说明用作品语言，只描述画面上的动作、互动或细节，最多 200 字。明确比例时沿用它。自动比例有多个候选时，从给定的列表里选一个。按给定标签逐行输出，保持每项一行，不另写说明。

`illustration/shot-parse.ts` 与 `shot.ts` 共用这组错误文案，按遇到的顺序去重。每一行标签、编号和可用比例用程序给定的白名单插值。

| 情况 | 文案 |
| --- | --- |
| 格式不对 | 每个字段单独占一行，使用规定的英文标签、冒号和空格。 |
| 标签重复 | 每个标签只写一次。 |
| 正面提示空 | 请在 PROMPT 写一行非空的英文画面提示。 |
| 画面说明空 | 请在 CAPTION 写一行非空的画面说明。 |
| 画面说明过长 | CAPTION 最多 200 字，只写一行。 |
| 参考非法 | REFS 只填在场人物可用的编号和视角，按画面主次排列，每个人只出现一次。 |
| 参考过多 | REFS 超过本次可用的参考图数量，请减少。 |
| 引用越界 | PROMPT 里的参考序号必须从 1 起，且对应 REFS 里的某一项。 |
| 自动比例无效 | 请在 ASPECT 填一个给定的比例。 |
| 提示词有真名 | 从英文提示词中删去人物真名，改用可见外貌或对应参考。 |
| 画面说明泄露 | CAPTION 只用这一段主角已经知道的称呼，去掉后来才揭晓的内容。 |

### B.9 人物参考（T17）

`illustration/portrait-prompt.ts` 用下列英文模板。末尾拼同一份 B.7 预设片段。自定义画风用 `style: <画风原文>`，只附画风本身。

| 函数或位置 | 正面提示 |
| --- | --- |
| `frontPrompt` | Eye-level, straight-on head-and-shoulders portrait of one person. Show the face, hairline and distinctive asymmetries. Relaxed expression, simple clothing, plain background. Visible appearance: <形象> |
| `three_quarter` | The same person as {{ref:1}}, head and shoulders at a three-quarter angle. Make the nose bridge, jawline and side contour clear. Preserve the facial features and hairline. Relaxed expression, simple clothing, plain background. |
| `full_body` | The same person as {{ref:1}}, standing naturally with the whole figure visible from head to feet. Show the build and proportions clearly. Relaxed expression, simple clothing, plain background. |

### B.10 画风预览（T17）

`illustration/portrait-prompt.ts` 的 `previewPrompt`。用与 B.9 相同的画风拼接规则，取固定题材。

```text
A small paper lantern and a single white flower on a wooden windowsill, soft afternoon light, a quiet still life, no people, no lettering.
```

---

## 附录 C · 给模型看的文本格式

### C.1 镜头输出（T16）

`shot-parse.ts` 先去首尾空白行；成对出现的首尾 Markdown 代码围栏去掉，再逐行读取。大小写固定，标签后的英文冒号须接一个空格。空值允许写成标签加冒号，或标签、冒号和一个空格。空白行忽略；同一标签重复或出现其他非空行报错。`PROMPT`、`CAPTION` 由 `describeShot` 校验非空；`NEGATIVE`、`REFS` 可空，未出现时按空值处理。只有多比例自动选择需要非空的 `ASPECT`。

附录 D 的第 2 段可以用以下虚构输出。夹具提供 `C1`、`C2` 及对应参考位置时才使用示例的 `REFS`。

```text
PROMPT: Medium two-shot. The short-haired figure {{ref:1}} extends an open palm with a brass key still resting on it. The figure in a light raincoat {{ref:2}} draws their empty hand back and turns slightly away.
NEGATIVE:
CAPTION: 短发的修表匠把钥匙递到半空，穿浅色雨衣的守门人缩回了手。
REFS: C1:full_body,C2:three_quarter
ASPECT: 3:2
```

同一段没有参考图时，`REFS:` 留空，`PROMPT` 用该段可见外貌替换两个引用。比例已确定或只有一个候选时，输出允许省略 `ASPECT`。所有引用都用从 1 起算的十进制序号。

### C.2 镜头输入与修正（T16）

`buildShotPrompt` 依次填以下三个块，每块之间空一行。布尔用 `是`、`否`。列表按输入顺序以英文逗号分隔，无内容时填 `无`。正文段每段用 `[段 N] ` 开头，开场第 0 段的投影只有公开处境时，它放在「此前正文或开场处境」，`[段 N]` 行省略。可见称呼、形象缺省时填空。

```text
【已发生的正文】
地点：<此刻可确认的地点>
此前正文或开场处境：<earlierText>
[段 1] <第一段>
[段 2] <第二段，直到目标段>

【在场的人】
C1 | 称呼=<已知称呼> | 形象=<可见形象> | 主角=<是或否> | 可用参考=<位置列表>

【镜头要求】
作品语言：<语言>
画风：<B.7 预设片段或自定义原文>
主角入画：<是或否>
比例：<固定比例，或按候选列表自动选择>
最多参考图：<数目>
负面提示词：<支持或留空>
内容边界（只作约束）：<边界文字或无>
输出标签：PROMPT, NEGATIVE, CAPTION, REFS<自动选择时追加 , ASPECT>
```

人物行逐个输出，不另加姓名、实体 id、幕后字段和判断用的禁名清单。正文块只取 T14 的投影，不追加完整回合。将 `place`、`people`、画风及约束里的换行归一成空格，保留正文的分段。作品语言从目标版本的语言取，按 T16 的 `ShotInput.language` 显式传入。

`buildCorrectionPrompt` 先放原提示，空一行，按下面追加。错误逐条换行输出，错误文案见附录 B.8。上一份输出只发回同一个背景模型供修正。

```text
【你上一次的输出】
<上一份输出>

【请修正】
- <错误一>
- <错误二>
按原格式重写完整结果。
```

### C.3 narrator 视角的形象块（T12）

`story/render.ts` 的 `renderAppearanceBlock` 只列已有形象。顺序是已入场且有形象的主角、`present` 里其他有形象的人，后者保持现有的短编号。分别省略缺失的行，整块为空时连标题也省略。主角若也在 `present` 里，由构造上下文时排除重复。

```text
【人物当前形象】
主角：<主角形象>
<现有短编号>：<形象>
```

---

## 附录 D · 测试用的虚构素材

### D.1 候船厅（T12–T19、T29–T31）

| 项 | 夹具值 |
| --- | --- |
| 作品和语言 | 《候船厅的纸灯》，`zh-CN` |
| 公开的开场处境 | 暮色刚落，候船厅停电，主角在可以望见闸杆的长椅旁。闸杆还没扳下。 |
| C1 的真名、称呼、形象 | 榆既白、短发的修表匠、短卷发，左眉有一道浅缺口，穿深色短外套。 |
| C2 的真名、称呼、形象 | 岑雾行、穿浅色雨衣的守门人、浅色雨衣的兜帽遮住脸，窄肩，右手戴浅色手套。 |
| 只听说过的人 | 传信人「蒲泊」。主角只听过称呼，本路线没有亲眼相遇。 |
| 揭晓后的新形象与地点 | 守门人摘下兜帽，露出左侧颧骨的一块月牙形胎记，随后走入信号室。 |
| 换装对照 | 修表匠改穿白围裙，短卷发与左眉缺口仍可见。形象变化的 `same_visible_identity` 用字符串 `"true"`。 |
| 行动意图 | 「扳下闸杆」是可选行动，玩家提交前候船厅保持昏暗。 |
| 线索 | 怀表盖只开了一条缝，露出一小截齿轮。零件来自何处留给之后的回合。 |

同一回合的五段正文。夹具用双换行隔开，插图标记写成字符串 `"2"`。

1. 候船厅的灯没亮，短发的修表匠站在长椅一端，穿浅色雨衣的守门人站在另一端。
2. 修表匠摊开手掌，把一把黄铜钥匙递向守门人。守门人把戴手套的右手缩回胸前。钥匙还躺在修表匠的掌心里。
3. 守门人再伸出手，把钥匙接过去。
4. 守门人翻开一只怀表，表盖缝里露出一小截齿轮。
5. 守门人摘下兜帽，左侧颧骨上露出一块月牙形胎记。「我叫岑雾行。」说完走进信号室。

第 1 段登记的称呼与形象供第 2 段使用。第 5 段新增真名称呼、可确认的形象和地点，目标为第 2 段时三个都不得外发。测试直接断言黄铜钥匙仍在修表匠手中；第 3 段的接过和第 5 段的揭晓作为同一条路径上的阳性对照。单独造相遇路线和只听闻路线验证手记与取图权限。身体朝向、视线或动作未写清时，用例可以检查可见材料的边界，真实画质交给 T31。

### D.2 规格、参考和失败用例

- T07 的 `pngBytes` 提供能实际解码的字节。需要两张参考不同时，用不同宽高的合法图片，直接比较字节数组。导入夹具用虚构原名 `fixture-original-name.jpg`，检查处理后的文件名及实际字节。只有做本机导入的用例才留原图在浏览器。
- 横竖对照用 `3:2` 的 1536×1024 与 `2:3` 的 1024×1536，窄屏另配 `9:16` 的 1024×1824。所有尺寸由伪服务实际报告，测试硬写预期宽高，用来发现 core 交换宽高或错档。固定比例的 720 与 2K 取同一比例下的两组不同尺寸。
- 选择结果对照用「指尖刚碰到尚未扳下的闸杆」和「闸杆已落下，候船厅的三盏灯亮起」。多人和换装取同一组已采用正面。对照正面＋全身、再加斜侧脸时，其余输入一致。
- 日志测试放入本用例独有的虚构字串，比如 `fixture-caption-private-4`，分别作为画面说明、原始错误或地址的值。先断言真实产生事件和样本，再查字串未入库。临时放开写入后应能查到该字串，用来验证拦截和查询本身。

---

## 6. 台账

按 [tasks/AGENTS.md §7](./AGENTS.md#7-台账) 填写。上文的勾选项由执行者逐步更新。完成判据与执行证据放在各自位置。

### 6.1 维护者裁定

| 编号 | 状态 | 维护者裁定、理由与何时重估 |
| --- | --- | --- |
| D1–D28 | 已确认 | 按推荐项通过；D7 的主角名始终进入 `bannedNames`，D22 统一用 `OutputPreferences` 字段名并以已有 `format` 为重画基准，D28 的 `same_visible_identity` 存储为 `1`。维护者确认。重估：实现中发现与设计文档冲突时，先改文档再改代码。 |
| 客户端共用组件 | 已确认 | `StylePicker`、`StylePreview`、`PortraitSetEditor`、`PortraitSlotCard` 下沉到 `apps/client/src/shared/ui/illustration/`，由 T22 实现，T23 从共享层导入。理由：`apps/client/AGENTS.md §7` 禁止 feature 之间互相导入 |
| core 公共接口 | 已确认 | 扩 `services.ts` 的 `ImageService`、`IllustrationService`，`image` 的错误和守卫类型、`story` 的 `StoryTx` 由 `services.ts` re-export；`play` 通过 `IllustrationService` 使用登记、路线插图视图和手记缩略图 |
| 开局基础参考组的清理 | 已确认 | 收口 review 发现 T15 的保留清单漏了 `scope = 'playthrough'`：唯一引用它的插图被移除后，清理会删掉该组，下一张图要重新付费生成另一张脸，手记缩略图也会消失。改为随开局保留，由外键级联删除。维护者确认。重估：开局里的参考组体量成为问题时。 |
| §1.3 推迟项 | 待确认 | 候选采用、存档分支、试玩入口由对应功能的任务接入。 |

### 6.2 波次读数

| 波次 | 执行情况 | typecheck | lint | test | Python / E2E / 文档 |
| --- | --- | --- | --- | --- | --- |
| W0–W1 | 完成 | 0 | 0 | 0 | 文档链接通过；T01/T02 独立 review 无确认问题 |
| W2–W9 | 完成 | 0 | 0 | 0（core 798、client 327、contracts 42、desktop 43） | `pnpm test:python` 全过；两组一致性测试 15/15、9/9 |
| W10 | 完成 | 0 | 0 | 0 | `pnpm e2e` 32/32（含 M4 14 个用例） |
| W11 | 部分执行 | 0 | 0 | 0 | 本机 DMG 与 `Unwritten.app` 已打出；真实 GPU、Colab、VoiceOver、200% 放大待维护者 |

每波另起一行。Python 锁定版本、模型和工作流锁定值、真实 GPU 档位由各自任务给出可复核来源和实际读数。

### 6.3 突变账

| 任务与判据 | 运行方式 | 原实现读数 | 突变位置与失败读数 | 改回后的读数 |
| --- | --- | --- | --- | --- |
| T01–T30 | 各任务定向测试与突变 | 均绿 | 见各任务执行汇报；每条判据都有对应突变读数 | 逐条改回后复绿 |

### 6.4 实机与欠账

| 验收项 | 执行环境 | 结果与证据 | 负责裁定 | 何时重估 |
| --- | --- | --- | --- | --- |
| ComfyUI 生产工作流模板 | 本机 | T26 包装、测试和一致性测试完成；`workflows/` 四份官方 API 模板与 `manifest.json` 尚未取得，未伪造。真实插件启动与 T31 验收待模板 | 维护者 | 维护者在装了 ComfyUI 的机器上导出后 |
| Strata MTP 缓存 | 本机 | `artifacts`、31 个源张量清单、打包文件大小/sha256 已在本地由 Strata 0.2.23 工具验证；Drive 缓存与宿主磁盘统计已接入。真实 Colab 冷启动未跑 | 维护者 | T31 |
| 真实 GPU、OpenAI 兼容端点与插图评测 | 待实机 | 待走查 | 维护者 | T31 |
| Colab 接入、启动、释放、重新唤醒与 Strata 重连 | 待实机 | 待走查 | 维护者 | T31 |
| 安装包、VoiceOver、200% 放大 | 本机 DMG 已打出 | 待人工走查 | 维护者 | T31 |
| 已发布作品编辑人物参考的界面路径 | 本机 | E02 通过 RPC 完成替换；当前已发布作品只显示发布面板，未提供方案/参考组编辑入口 | 维护者 | 对应作者编辑入口实现时 |
| 候选采用、存档分支与试玩入口 | 对应能力推迟 | §1.3 记录验收范围 | 维护者 | 对应能力进入实现时 |
