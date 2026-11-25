# 第二个里程碑 · 实现任务拆解

设计依据是 [docs/milestone-2.md](../docs/milestone-2.md)。本文件把它拆成可以交给子代理逐个执行的任务：每一步写在哪个文件、那个文件做什么、具体怎么写、要注意什么、做完怎样验证。

本文件是进度追踪文件，可以勾选。设计本身以 `docs/` 为准；本文件和 `docs/` 冲突时，先停下来汇报，由维护者裁定后改 `docs/`，再改这里。

执行者可能是能力较弱的模型。所以本文把接口、文件名、函数签名、文本格式、文案、测试用例都写死了。**照着写，不要自己发明。** 本文没写到的地方，按 §0.3 停下来汇报。

---

## 0. 给执行者（必读）

### 0.1 怎么用这份文件

1. 先读完 §0、§2、§3，再读分配给你的那一个任务（§5 里的 `Txx`）。“先读”里列出的设计文档章节不能跳过。
2. 只改你的任务“拥有的文件”。需要改别的任务拥有的文件时，停下来汇报（§0.3）。
3. 按“步骤”的顺序做，每做完一步把 `- [ ]` 改成 `- [x]`。
4. 全部步骤做完后，逐条跑“完成判据”。每条判据都配了一个“突变”：把哪一行改坏，这条判据必须变红。突变要真的做一遍，看到变红后再改回来（§0.6）。
5. 本文里的路径、类型、接口供任务交接。业务和视觉契约以 `docs/` 为准，库的 API 以安装后的类型声明为准。两者对不上、而且差异会改变交接契约时，按 §0.3 汇报。
6. **本文里的事实断言是线索，不是结论。** “某函数在某文件”“某处已经有某能力”都是规划时读到的，执行时可能已经变了。动手前先用 `grep` 按符号名核一遍；前提不成立就停下来说，不要照着错误前提动手。

### 0.2 硬性规则（违反即返工）

| 规则 | 说明 |
| --- | --- |
| 不写注释 | 任何代码文件都不写注释，包括 CSS、SQL、shell、`tsconfig.json`。lint 抑制指令（`// oxlint-disable…`、`// @ts-expect-error`、`/* stylelint-disable */`）也算注释，同样禁止。工具生成的迁移文件例外，但不要手改生成出来的部分。见根目录 [AGENTS.md §8](../AGENTS.md#8-不写注释) |
| 只用 pnpm | 不用 npm、yarn、npx。临时执行用 `pnpm exec` |
| 不加依赖 | 本里程碑用到的库都已安装：`@base-ui/react`、`lucide-react`、`@tanstack/react-query`、`@tanstack/react-router`、`drizzle-orm`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`。需要新依赖时停下来汇报 |
| 不 commit、不 push | 改动留在工作树里，由编排者汇总后请维护者授权提交 |
| 相对导入写扩展名 | TypeScript 里的相对导入一律写 `.ts` / `.tsx` 后缀 |
| 只用可擦除语法 | 不写 `enum`、`namespace`、构造函数参数属性、装饰器 |
| 界面文案走 i18n | 组件里不出现用户能看到的字面字符串，`aria-label`、`placeholder`、`title`、`alt` 也算。见 §2.4 |
| 纯文本渲染 | AI 输出、作品内容、玩家输入、模型返回的错误信息一律当纯文本渲染。不用 `dangerouslySetInnerHTML`、`innerHTML` |
| 样式只用 token | 视觉属性只能用 `--uw-*` token。见 [apps/client/AGENTS.md §2](../apps/client/AGENTS.md#2-样式只用-token) |
| 测试内容虚构 | 测试和示例里的故事、人物名、对白全部用附录 D 的虚构素材，或自己另编。不从任何真实作品里摘 |
| 测试数据 | 自动化测试用 `fs.mkdtempSync(path.join(os.tmpdir(), "unwritten-"))` 建临时目录，测试结束删除 |
| key 不进仓库 | 测试夹具不能叫 `providers.json`，也不能以它开头 |
| 提案工具参数只用字符串 | `propose_turn`、`propose_preview` 和全部只读工具的每个参数都是字符串 |
| 事务里不 await | SQLite 驱动是同步的。`db.transaction(...)` 的回调里不调用任何异步函数 |
| 先提交后发布 | `deps.bus.publish(...)` 一律放在事务提交成功之后，不放在事务回调里 |
| 工具不写库 | 只读工具（§5 T11）只读不写。故事事实只在 `propose_turn` / 采用开场的提交事务里写入 |

### 0.3 遇到这些情况，停下来汇报

- 本文没写、设计文档也没写的设计决定。不要自己发明，写清楚“缺什么、有哪几种做法、各自代价”。
- 库的 API 和本文描述的差别大到改变了做法（不只是改个名字）。
- 需要改别的任务拥有的文件，或需要新依赖。
- 完成判据里的某条跑不通，而且你判断问题不在自己的代码里。
- 发现设计文档前后矛盾，或本文和设计文档矛盾。
- 本文的事实断言（某个符号、某个文件、某个现有行为）和代码对不上。

汇报格式：**卡在哪一步 / 看到了什么（原始输出）/ 你认为的原因 / 可选做法**。

### 0.4 并行与工作树

- 编排者按 §3 的波次派发任务。同一波次的任务互不依赖，可以同时执行。
- 每个任务一个 git 工作树（Agent 工具的 `isolation: "worktree"`，或按根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律) 手动建）。工作树里没有 `node_modules`，开工先跑 `pnpm install --frozen-lockfile`。
- 每个任务只碰自己拥有的文件。编排者收齐一个波次后，按任务编号顺序合进 `milestone-2` 集成分支，跑一遍 §0.5 第 3 条的全量检查；全绿才开下一个波次。
- `pnpm-workspace.yaml`、各 `package.json`、`pnpm-lock.yaml` 本里程碑不改。

### 0.5 完成一个任务的标准动作

1. 跑本任务的“完成判据”，并按 §0.6 做突变。
2. 用 `code-review-skill` 对本任务的全部 diff 自检（根目录 [AGENTS.md §7](../AGENTS.md#7-贯穿性硬纪律)）。确认成立的问题修掉，再对完整 diff 重新自检；只是“可能”的问题写进汇报。
3. 在仓库根目录跑：`pnpm typecheck > "${TMPDIR:-/tmp}/uw-typecheck.txt" 2>&1; echo $?`、`pnpm lint > "${TMPDIR:-/tmp}/uw-lint.txt" 2>&1; echo $?`、`pnpm test > "${TMPDIR:-/tmp}/uw-test.txt" 2>&1; echo $?`。读数重定向进文件再看，不要接 `| tail`：管道会吞掉退出码，也会把失败条数截掉。三个退出码都必须是 0。
4. 汇报：改了哪些文件、每条完成判据的输出、每个突变是否变红、自检结论、还没解决的问题。
5. 出示“不该动的东西”的零差异：`git diff --stat -- pnpm-lock.yaml package.json '*/package.json' .oxlintrc.json stylelint.config.mjs lefthook.yml scripts/` 输出为空。它证明这次的绿不是靠削弱门禁换来的。

### 0.6 怎样做突变

- 突变是“故意把实现改坏一处，确认判据会红”。它是判据唯一的自检：不会红的判据，不知道它在守什么。
- 做法：先跑一次判据，确认是绿的；把指定的那一行改坏；再跑，确认变红；**用编辑器把那一行改回去**，再跑一次确认绿。
- **不要用 `git checkout`、`git restore`、`git stash` 还原突变**：工作区里一直压着你还没提交的成果，一次误还原会全部抹掉。
- 突变改动和测试运行不要同时进行；测试跑完再改下一处。
- 突变没变红时，先回答两个问题：这一行在这个跑法下会被执行吗？还有没有第二道守卫把它接住了？答完写进汇报，不要为了变红去改判据。

---

## 1. 范围评估

### 1.1 结论

范围合理，三件事都建在第一个里程碑的地基上，彼此只在契约层相交：

- **故事事实与推送、拉取**是本里程碑最重的一块。数据模型、可见性规则、上下文分工、只读工具、校验规则都已在 `docs/` 设计完整，本次是兑现，不是设计。风险在实现量和校验的细节，所以拆得最细（T08–T12）。
- **界面打磨**依赖 Figma 校准（T02）。共享部件（T07）先于页面，页面任务（T13–T15）彼此独立。
- **按用途的生成参数**改动集中在 `llm` 模块和设置页。真正的难点是“思考”在不同服务端上的写法不同（§1.5 D2–D4），这一点设计文档原先没有覆盖，本拆解补上了。

### 1.2 里程碑没写、但验收离不开的部分（本拆解已纳入）

| 补充项 | 为什么离不开 | 落在哪个任务 |
| --- | --- | --- |
| 模型的“思考写法”能力字段 | pi-ai 按服务端的约定发思考参数（`reasoning_effort`、`enable_thinking`、`thinking: {type}` 等）。自定义端点认不出是哪一种，不让用户指定，“关闭思考”在很多服务上根本发不出去 | T00、T03、T05、T13 |
| 模型的“支持思考”能力字段可编辑 | 设计要求“能力为否时不能选思考档位”，而 M1 的设置页没有这个字段的编辑入口 | T03、T05、T13 |
| `LlmService.complete()`：不带工具的单次调用 | 后台摘要不要求工具调用（[LLM 端点 §7](../docs/llm-endpoints.md#7-用途分配)），而 M1 的 `run()` 必须有一个“必调工具” | T03、T05 |
| 主角实体 | 知情记录的持有者永远是实体，主角也是实体（[数据模型 §4](../docs/data-model.md#4-故事事实)）。没有主角实体，什么事实都挂不上 | T04、T10 |
| 旧数据补齐 | M1 留下的作品没有主角实体，也没有全文索引。不补，旧作品续玩时事实和搜索都会出错 | T04 |
| 段落编号由 core 给出 | 事实的出处是“第几段”，手记要跳回那一段。段落切分必须只有一份实现，所以 `TurnView` 直接给出段落数组 | T03、T08、T15 |
| `settings.changed` 事件 | 外观偏好存在 core，多个标签页要同步（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)） | T03、T06 |
| 工具说明的 token 棘轮 | 7 个只读工具的说明会占用每回合的上下文预算。改一个字就涨预算，要有测试钉住 | T11 |
| 契约过渡字段的清理 | 为了让每个波次合并后都能通过类型检查，契约变更先做成“只加不删”（§2.8），最后统一删掉旧字段 | T16 |

### 1.3 建议加入的能力（维护者确认后才做）

维护者问“除了这些还要包含哪些功能”。下面四项是打磨体验时绕不开的，本拆解按“加入”写好了任务。维护者否决哪一项，就跳过对应的任务或步骤。

| 编号 | 能力 | 为什么建议加入 | 代价 | 任务 |
| --- | --- | --- | --- | --- |
| A1 | 一个端点下多个模型，可删除端点和模型 | 按用途分配模型以后，同一个服务商常常一个模型写正文、一个便宜模型写摘要。M1 一个端点只能有一个模型，用户只能把同一个地址和 key 重复填两遍 | contracts 加 3 个过程，设置页多一层列表 | T03、T05、T13 |
| A2 | 生成失败后“改写行动” | [游玩流程 §5](../docs/gameplay-flow.md#5-离开存档和尝试另一条路) 要求失败后“允许重试或改写”，M1 只做了重试 | 只改 client | T15 |
| A3 | 删除作品 | 打磨作品库时，测试作品和废稿没法清掉。删除规则在[数据模型 §8](../docs/data-model.md#8-删除) 已经设计好 | contracts 加 1 个过程，作品卡加一个菜单和确认对话框 | T03、T06、T14 |
| A4 | 采样参数与思考同时设置时的提示 | 很多服务在开启思考时会忽略或拒绝 `temperature`、`top_p`。不提示，用户会以为参数生效了 | 设置页一行提示文字 | T13 |

不建议加入：用量查看界面（诊断库可以直接查）、长剧情虚拟化（M2 的路线长度用不上）、未发送输入的草稿（维护者已决定推迟）。

### 1.4 明确推迟（不做）

| 推迟项 | 理由 |
| --- | --- |
| 状态栏、秘密、关键场面，以及对应的 `changes` 类型（`state`、`state_item`、`new_state`、`secret`、`scene_hit`） | 维护者已决定只做人物关系主干。`state_defs`、`state_values` 两张表本次不建 |
| `ask_clarification` | 同上 |
| `author_chat` 用途的界面 | 没有调用方。`providers.json` 里的这一项照旧读写，不删 |
| 自定义透传参数、按用途配置最大输出和上下文窗口 | 维护者没有选 |
| 换一种发展、存档、重新开局、作者设定向导、试玩 | 里程碑已推迟 |
| 长剧情虚拟化 | 路线长度用不上 |
| 未发送输入的草稿（`routes.draft_input`） | 维护者已决定推迟 |
| `anthropic-messages` 端点的创建 | M1 的 `pi.ts` 只接了 `openAICompletionsApi()`，设置页也只能建 OpenAI 兼容端点。本次不扩 |

### 1.5 设计决定（本文先按推荐项写）

| 编号 | 问题 | 本文采用 | 其他做法 |
| --- | --- | --- | --- |
| D1 | 一个端点几个模型（见 A1） | 多个；`llm.models.add/update/remove` 管理模型，`llm.endpoints.remove` 删端点 | 保持一个：设置页简单，但同一服务商要重复填地址和 key |
| D2 | 思考参数怎样发出去 | 每个模型有一个能力字段 `thinkingFormat`：`auto`、`openai`、`qwen`、`qwen-chat-template`、`deepseek`、`openrouter`、`zai`。`auto` 交给 pi-ai 按地址识别，识别不出时按 `openai` 发 `reasoning_effort` | 不给选择、全用 `auto`：多数自建服务（vLLM、llama.cpp、DashScope 兼容口）上“关闭思考”发不出去 |
| D3 | “没设置”和“关闭”的区别 | 用途没设 `thinking` 时，请求里不带任何思考字段，由服务端决定。设了 `off` 时，按写法明确发出关闭：`openai` 写法发 `reasoning_effort: "none"`，`qwen` 写法发 `enable_thinking: false`，以此类推 | 两者合一：用户无法让默认思考的模型（如 qwen3）停止思考 |
| D4 | 思考预算发给谁 | 只对 `qwen` 写法发，字段名 `thinking_budget`。其他写法在设置页把预算栏置灰，并写明原因 | 对所有写法都发 `thinking_token_budget`：大多数服务不认，测试连接会报 400 |
| D5 | 开场里出现的人物归谁 | 预览 `changes` 里的 `new_entity` 是作品设定（`origin_turn_id` 为空），同时写进草稿和发布版本，`id` 相同。称呼、事件、关系、特征、知情、场景挂在根回合上 | 全部挂在根回合：将来“重新开局”时，固定人物模式会找不到人物 |
| D6 | M1 旧数据怎样补 | 迁移之后运行一段幂等的 TypeScript 补齐（`store/backfill.ts`）：为缺主角的版本补主角实体，为缺索引的回合补全文索引。摘要由启动时的补排队列补 | 写进 SQL 迁移：段落切分和 UUID 生成在 SQL 里写不清楚 |
| D7 | 回合正文怎样给 client | `TurnView` 加 `paragraphs: string[]`，由 core 按唯一的切分函数切好。过渡期保留 `prose`，T16 删掉 | client 自己切：段号会和事实的出处对不上 |
| D8 | 手记收录谁 | 主角持有称呼的每个实体（主角自己除外）是一个条目；条目下列出主角知情的、提到该实体的事实。另列一组“事件”：主角知情的全部事件，按回合先后 | 收录所有已出场实体：主角不知道名字的人会以真名出现在手记里，直接泄露 |
| D9 | 推荐行动的快捷键 | ⌘1–⌘9（Windows、Linux 上为 Ctrl），按 [a11y §4](../docs/a11y.md#4-键盘与焦点)。**已知限制：** 在浏览器里，这组按键被浏览器用来切换标签页，页面收不到；M2 在浏览器里交付，所以这组快捷键要到桌面版才真正可用。推荐行动的按钮仍是主入口，快捷键只是加速。端到端测试里 Playwright 直接向页面派发按键，可以覆盖 | 改用 ⌥1–⌥9：浏览器不拦截，但 macOS 上 ⌥ 加数字在输入框里会打出特殊符号，要额外处理；裸数字键：违反 WCAG 2.1.4 |
| D10 | 借鉴 Looma 的编码规范 | 按 T01 落进三份 AGENTS.md（client 补充、core 新建、tasks 新建） | 不落：本次拆解的判据写法和 client 数据流规则只存在于这份任务文件，下一个里程碑会丢 |

T00 在维护者确认后把 D1–D9 写进设计文档，T01 落 D10。

---

## 2. 贯穿全局的约定

### 2.1 命名

- 领域词按 [docs/AGENTS.md §4.1](../docs/AGENTS.md#41-术语对照表)。本里程碑新增的代码名：

  | 概念 | 代码名 |
  | --- | --- |
  | 实体（人物、地点、物品、组织、其他） | `entity`，种类 `EntityKind = 'character' \| 'place' \| 'item' \| 'group' \| 'other'` |
  | 称呼 | `name`（表 `entity_names`） |
  | 事实 | `fact`，种类 `FactKind = 'event' \| 'trait' \| 'relation' \| 'promise'` |
  | 知情 | `knowledge`，程度 `KnowledgeLevel = 'heard' \| 'suspects' \| 'confirmed' \| 'misled'` |
  | 投影（某条路线此刻能看见的全部故事事实） | `StoryProjection` |
  | 短编号簿 | `CodeBook` |
  | 已校验的变化 | `ValidatedChanges` |
  | 手记 | `journal` |
  | 摘要 | `summary` |
  | 生成参数 | `GenerationParams` |
  | 思考档位、思考写法 | `ThinkingLevel`、`ThinkingFormat` |
  | 外观与阅读偏好 | `Appearance`（已存在于 contracts） |

- core 新模块：`story/`（故事事实的读写，不依赖 `llm/`、`api/`、`play/`、`authoring/`）、`summary/`（后台摘要队列）、`settings/`（外观偏好）。
- 文件名：TypeScript 模块用 kebab-case，React 组件用 PascalCase，CSS Module 和组件同名，hook 用 camelCase。

### 2.2 id、时间、JSON、段落

- id 一律 `crypto.randomUUID()`（core 里用 `import { randomUUID } from 'node:crypto'`）。
- 时间一律存毫秒整数 `Date.now()`。
- JSON 列用 Drizzle 的 `text(..., { mode: 'json' })`。写进 JSON 列的对象，形状由 `packages/core/src/store/meta.ts` 或 `packages/core/src/story/types.ts` 的 Zod schema 定义。
- **段落切分只有一份实现：** `splitParagraphs(prose)`，放在 `packages/core/src/text/turn-text.ts`（T03 加）。规则：`normalizeProse(prose).split(/\n{2,}/).filter((p) => p.length > 0)`。段号从 1 开始。事实的 `para`、全文索引的 `para`、`TurnView.paragraphs` 的下标 +1、手记的跳转目标，全部用这一份。
- **短编号：** 人物和其他实体 `@n`，事实 `#n`，回合 `T<depth>`。`@1` 永远是主角。编号只在一次请求内有效（[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)）。

### 2.3 错误码

- 全部错误码只在 `packages/contracts/src/errors.ts` 的 `ERROR_CODES` 里列一次。本里程碑新增两个，由 T03 加：

  | 码 | HTTP 状态 | 什么时候 |
  | --- | --- | --- |
  | `thinking_unsupported` | 400 | 给“支持思考”为“否”的模型设置了非 `off` 的思考档位；或给非 `qwen` 写法的模型设置了思考预算 |
  | `last_model` | 409 | 删除端点下最后一个模型 |

- 加一个错误码要同时改三处：`contracts/src/errors.ts` 的 `ERROR_CODES`、`core/src/errors.ts` 的 `HTTP_STATUS`、`client/src/i18n/zh-CN/errors.json`。`keys.test.ts` 会检查第三处，TypeScript 会检查第二处。
- 校验 `changes` 的错误不是错误码，是返回给模型的中文说明（§5 T09）。

### 2.4 i18n

- 规则同第一个里程碑：调用时写完整键 `t('play:journal.open')`；不拼接；动态键只允许 `errors:${code}`；作品内容、AI 输出、模型 id、端点名原样显示。
- 本里程碑不新增命名空间。手记的文案放在 `play`，外观偏好的文案放在 `settings`，共享部件的文案放在 `common`。
- 全部新文案见附录 A，照抄，不自己改写措辞。附录 A 之外需要新键时，按[设计准则 §8](../docs/design-guidelines.md#8-文案语气)的语气写，并在汇报里列出。
- 枚举值的显示文案用一张“枚举值 → 键”的对照表，不在组件里写 `if` 分支拼文案。例如 `THINKING_LEVEL_LABEL_KEYS: Record<ThinkingLevel, string>`。对照表旁边写一个测试：对 contracts 里枚举的每一个值，都能查到一个存在的键（从枚举现取，不手抄枚举值）。
- 给模型的提示词、工具说明、返回给模型的校验错误都写在 core 的常量里，不走 i18n。

### 2.5 运行诊断与性能记录

规则同第一个里程碑，以[运行诊断与性能记录](../docs/diagnostics.md)为准。`deps.logger.record(...)` 记事件，`deps.logger.sample(...)` 记计时。`data` 里只放枚举、计数、布尔和 id，**不放正文、名字、陈述、玩家输入、key**。logger 会按键名拦掉 `content`、`prose`、`input`、`output`、`detail`、`message` 等键，但不要依赖它，自己就不要往里放。

**关键路径成功也要记，不只记失败。** 新增或改动用户能感知的等待（模型调用、上下文构建、工具调用、摘要、设置保存）时，完成样本必须带：稳定的样本名、耗时、结果、能解释耗时的规模字段（条数、token 估算数），以及已有的请求 ID、任务 ID 或作品 ID。

本里程碑新增的事件和样本：

| 名字 | 类型 | module | 级别 | data 字段 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| `settings.changed` | 事件 | settings | info | `appearance`、`proseSize`、`proseFont`、`proseLeading`（都是枚举） | T06 |
| `story.backfill` | 事件 | core | info | `protagonists`（补了几个主角）、`ftsTurns`（补了几个回合的索引） | T04 |
| `work.deleted` | 事件 | library | info | 无；`workId` 放在关联 ID 上 | T06 |
| `summary.done` / `summary.failed` | 事件 | summary | info / warn | `turnId`、失败时 `code` | T12 |
| `turn.changes.rejected` | 事件 | play | info | `requestId` 放关联 ID；`attempt`、`errorCount`（这次校验报了几条错） | T11 |
| `llm.call` | 事件（已有） | llm | info | 新增 `thinking`：本次实际使用的思考档位，没设时为 `null` | T05 |
| `turn.context` | 样本（已有） | — | — | 在已有字段上新增 `contextTokens`（估算的上下文 token 数）、`indexEntities`（索引列了几个实体）、`summaryLines`（摘要行数） | T11 |
| `story.projection` | 样本 | — | — | `entities`、`facts`、`knowledge`（投影里各几条）；带 `requestId` | T11（调用 T08 的 `loadProjection` 时记录） |
| `story.tool` | 样本 | — | — | `tool`（工具名）、`records`（返回了几条记录）、`ok`；带 `requestId`、`attempt` | T11 |
| `summary.total` | 样本 | — | — | `turnId`；带 `workId` | T12 |
| `settings.update` | 样本 | — | — | 无 | T06 |

T00 把这张表的新增行写进 `docs/diagnostics.md` §3 的样本表和事件约定。

### 2.6 安全

- 规则同第一个里程碑。新增的注意点：
  - `turn_requests.log` 可以存工具参数和返回的记录 id，因为它只留在本机作品库里（[回合循环 §2](../docs/turn-loop.md#2-回合请求)）。诊断库只存工具名和条数。
  - 手记、索引、工具结果里的名字和陈述都是 AI 输出，client 一律按纯文本渲染。
  - `settings.update` 的输入按 `AppearanceSchema` 校验后才写库、才写进 HTML（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）。

### 2.7 测试

| 层 | 工具 | 放哪里 | 命名 |
| --- | --- | --- | --- |
| contracts、core 单元与集成 | Vitest（Node 环境） | 和被测文件放在一起 | `*.test.ts` |
| client 纯逻辑 | Vitest（项目名 `unit`） | 同上 | `*.test.ts` |
| client 组件 | Vitest 浏览器模式（项目名 `browser`）+ `vitest-browser-react` + axe-core | 同上 | `*.test.tsx` |
| 端到端 | Playwright，浏览器打开独立运行的 core | `e2e/tests/` | `*.spec.ts` |

写判据的规矩（借鉴 Looma 的 `tasks/AGENTS.md`，T01 会落成仓库规范）：

1. **每条判据配一个最小突变**（§0.6）。本文给每个任务的判据都写了突变。
2. **断言钉产物，不回抄自己的声明。** 期望值不能从被测代码里取。比如测“思考档位发出去了”，断言的是伪服务收到的请求体里的 `reasoning_effort`，不是 `params.thinking`。固定的协议字段名、字段值、上限，至少有一条断言直接写字面量。
3. **否定命题要配阳性对照。** “不泄露”“没写入事实”“不带思考字段”这类断言，在同一个测试里还要证明：同一条路径上，该产出的东西确实产出了（例如同一次请求里 `temperature` 确实出现了，所以“`reasoning_effort` 没出现”才有意义）。
4. **扫描、反射得到的集合先断非空。** 例如“每个枚举值都有文案键”，先断枚举值的个数大于 0。
5. **控件状态不是保存成功的信号。** client 测试里判断“保存了”，要断言请求参数或重新读回的服务端值，不要只断言按钮变成可用。
6. **会启动后台队列的测试**（回合、摘要），动作前的状态只断言“处于可执行状态”，动作后的结果用 `whenIdle()` 等完再断言唯一值。
7. 查元素用 `getByRole` 和可读名称。

需要模型的测试一律用伪服务：core 单元测试用 `createScriptedLlm`，core 集成测试和端到端测试用伪 OpenAI 服务。

### 2.8 契约变更“只加不删”，最后清理

为了让每个波次合并后 `pnpm typecheck` 都能过，contracts 的变更分两步：

- **T03 只加不删。** 新字段加上，旧字段保留；输入 schema 只放宽，不收紧。例如 `TurnView` 加 `paragraphs`，`prose` 仍在；`LlmConfigView` 加 `purposes`，`defaultModel` 仍在。
- **T16 删除过渡字段。** 等所有消费方都改用新字段后，删掉：`TurnView.prose`、`LlmConfigView.defaultModel`、`LlmConfigView.defaultModelUsable`、`UpdateEndpointInput.modelId`、`SetPurposeInput` 里对旧形状的兼容。

### 2.9 接口先行与占位实现

core 各模块之间的新接口（`services.ts`、`llm/types.ts`、`story/types.ts`）在本文里写死，由 T03、T04 先落地。新增的服务方法先写占位实现：

```ts
throw appError('internal', 'not implemented: <服务名>.<方法名>');
```

后续任务把占位换成真实现。T16 的判据之一是 `grep -rn "not implemented:" packages/core/src` 零命中。占位只允许出现在本文明确要求的位置。

---

## 3. 任务依赖与并行波次

```
W0   T00 设计补洞（docs）            ┐
     T01 落地借鉴的编码规范（AGENTS）  ├ 互不依赖，可同时
     T02 Figma 校准（编排者执行，持续到 W3 前）┘
      │
W1   T03 契约与接口先行（依赖 T00）
      │
W2   ├─ T04 存储：新表、迁移、旧数据补齐（依赖 T03）
     ├─ T05 llm：生成参数、思考写法、多模型、complete()（依赖 T03）
     └─ T07 client 共享部件与外壳（依赖 T03、T02）
      │
W3   ├─ T06 core 外观偏好与删除作品（依赖 T04）
     ├─ T08 story 读侧：投影、短编号、文本渲染、手记、搜索（依赖 T04）
     ├─ T09 story 写侧：解析校验 changes、泄露检查、写入（依赖 T04）
     ├─ T12 后台摘要队列（依赖 T04、T05）
     ├─ T13 设置页（依赖 T07）
     ├─ T14 作品库与创作页（依赖 T07）
     └─ T15 游玩页与手记（依赖 T07）
      │
W4   ├─ T10 开场写入初始事实（依赖 T08、T09）
     └─ T11 回合的推送与拉取（依赖 T05、T08、T09、T12）
      │
W5   T16 core 装配、集成测试、过渡字段清理（依赖 T06、T10、T11、T12、T13、T14、T15）
      │
W6   T17 端到端测试（依赖 T16）
      │
W7   T18 真实模型走查与收口（依赖 T17）
```

| 任务 | 依赖 | 可同时执行的任务 | 规模 |
| --- | --- | --- | --- |
| T00 | 维护者确认 §1.3、§1.5 | T01、T02 | 中 |
| T01 | 维护者确认 D10 | T00、T02 | 中 |
| T02 | 无 | T00、T01、T03–T06、T08、T09、T12 | 大（编排者） |
| T03 | T00 | T02 | 大 |
| T04 | T03 | T05、T07 | 中 |
| T05 | T03 | T04、T07 | 大 |
| T06 | T04 | T08、T09、T12–T15 | 小 |
| T07 | T03、T02 | T04、T05 | 大 |
| T08 | T04 | T06、T09、T12–T15 | 大 |
| T09 | T04 | T06、T08、T12–T15 | 大 |
| T10 | T08、T09 | T11 | 中 |
| T11 | T05、T08、T09、T12 | T10 | 大 |
| T12 | T04、T05 | T06、T08、T09、T13–T15 | 中 |
| T13 | T07 | W3 的其他任务 | 大 |
| T14 | T07 | W3 的其他任务 | 中 |
| T15 | T07 | W3 的其他任务 | 大 |
| T16 | 上表所列 | 无 | 中 |
| T17 | T16 | 无 | 大 |
| T18 | T17 | 无 | 小 |

关键路径：T00 → T03 → T04 → T08 / T09 → T11 → T16 → T17。

**client 任务不等 core。** T13–T15 只依赖 T03 定下的契约。core 还没实现的过程，在 client 的组件测试里用假的 API 客户端代替（T07 提供 `createFakeApi()`）。

**波次闸门。** 每个波次合并后，编排者在集成分支上跑 §0.5 第 3 条的三项检查和 `node scripts/check-doc-links.mjs`，读数写进 §6 台账。没全绿不开下一个波次。

---

## 4. 文件总表

“归属”指哪个任务创建或改动这个文件。只有归属任务能改它。标了“→”的表示先由前一个任务改，后一个任务接着改（前一个任务写的是占位或第一部分）。

### 4.1 根目录与文档

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `docs/llm-endpoints.md`、`docs/turn-loop.md`、`docs/data-model.md`、`docs/diagnostics.md`、`docs/architecture.md`、`docs/milestone-2.md`、`docs/gameplay-flow.md` | 把 §1.3、§1.5 的决定写进设计 | T00 |
| `apps/client/AGENTS.md` | client 规范：补“模块边界”“状态与数据流”“加载、空、错误”“滚动与浮层”“测试”五节 | T01 |
| `packages/core/AGENTS.md` | 新建：core 规范 | T01 |
| `tasks/AGENTS.md` | 新建：任务文件的写作规范 | T01 |
| `AGENTS.md`（根） | §开头的目录列表加上两份新 AGENTS.md | T01 |
| `tasks/milestone-2.md` | 本文件；§6 台账由编排者写 | 编排者 |

### 4.2 `packages/contracts`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `src/errors.ts` | 加 `thinking_unsupported`、`last_model` | T03 |
| `src/schemas/llm.ts` | 思考档位、思考写法、生成参数、用途视图、多模型过程的输入输出 | T03 → T16（删过渡字段） |
| `src/schemas/story.ts` | 新建：实体种类、知情程度、手记视图 | T03 |
| `src/schemas/works.ts` | 预览加 `cast`；删除作品的输入 | T03 |
| `src/schemas/play.ts` | `TurnView` 加 `paragraphs` | T03 → T16 |
| `src/events.ts` | 加 `settings.changed` | T03 |
| `src/procedures/llm.ts`、`works.ts`、`play.ts`，新建 `procedures/settings.ts` | 新过程 | T03 |
| `src/index.ts` | 导出新 schema 和 `settings` 契约 | T03 |
| `src/schemas/*.test.ts` | 新 schema 的边界测试 | T03 |

### 4.3 `packages/core`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `src/errors.ts` | `HTTP_STATUS` 加两个码 | T03 |
| `src/services.ts` | 新服务接口：`SettingsService`、`LlmService` 的新方法、`PlayService.getJournal`、`LibraryService.delete`；`ServiceFactories` 加 `settings`、`summary` | T03 |
| `src/llm/types.ts` | `LlmCompleteInput`、`LlmRunRef.kind` 加 `'turn'`、`ResolvedModel` 不变 | T03 |
| `src/api/router.ts` | 挂上全部新过程 | T03 |
| `src/app.ts` | 构造新服务；启动时补齐与补排 | T03 → T04 → T12 → T16 |
| `src/api/http-app.ts` | `index.html` 用 core 里存的外观偏好 | T06 |
| `src/settings/service.ts` | 新建：外观偏好读写 | T03（占位）→ T06 |
| `src/library/service.ts` | `delete` | T03（占位）→ T06 |
| `src/store/schema.ts` | 新表：`entities`、`entity_names`、`facts`、`knowledge`、`turn_summaries`、`app_settings` | T04 |
| `src/store/migrations/<生成>/` | drizzle-kit 生成的建表迁移 | T04 |
| `src/store/migrations/<自定义>/` | 手写：表达式唯一索引、`prose_fts` 虚表与触发器 | T04 |
| `src/store/meta.ts` | `StoredScene.presentIds`、`opening.changes`、`TurnRequestLog` 扩展、预览任务结果带 `changes` | T04 |
| `src/store/backfill.ts` | 新建：旧数据补齐 | T04 |
| `src/store/prose-index.ts` | 新建：把一个回合的段落写进全文索引（补齐和提交共用） | T04 |
| `src/store/db.ts` | 迁移后调用补齐 | T04 |
| `src/text/turn-text.ts` | 加 `splitParagraphs` | T03 |
| `src/story/types.ts` | 新建：故事模块的全部类型与 `ValidatedChanges` 的 Zod schema | T04 |
| `src/story/projection.ts` | 新建：按路线算可见的实体、称呼、事实、知情 | T08 |
| `src/story/codebook.ts` | 新建：短编号簿 | T08 |
| `src/story/render.ts` | 新建：给模型看的文本格式（索引行、档案、工具结果） | T08 |
| `src/story/journal.ts` | 新建：主角视角的手记 | T08 |
| `src/story/search.ts` | 新建：全文检索与短查询的子串扫描 | T08 |
| `src/story/changes.ts` | 新建：解析并校验 `changes` | T09 |
| `src/story/leak.ts` | 新建：不泄露检查 | T09 |
| `src/story/writer.ts` | 新建：在提交事务里写入故事事实和全文索引 | T09 |
| `src/story/tools.ts` | 新建：7 个只读工具 | T11 |
| `src/llm/params.ts` | 新建：生成参数 → pi-ai 选项 | T05 |
| `src/llm/providers-schema.ts` 里模型条目的 `thinkingFormat` 一行 | 让 T03 的视图能读到这个字段 | T03 → T05 |
| `src/main.ts` | 注入新的服务工厂 | T03 |
| `src/summary/queue.ts` | 摘要服务（T03 先写占位） | T03 → T12 |
| `src/authoring/preview-tool.ts` 里预览结果的 `cast: []` | 让预览满足新契约 | T03 → T10 |
| `src/llm/providers-schema.ts`、`providers-file.ts`、`service.ts`、`pi.ts`、`run.ts`、`test-connection.ts` | 生成参数、思考写法、多模型、`complete()` | T05 |
| `src/test-support/fake-openai-server.ts`、`llm-steps.ts` | 伪服务加“先思考再调工具”的步骤；构造 `changes` 行的帮助函数 | T05 → T09 |
| `src/test-support/scripted-llm.ts` | 加 `complete()` 的脚本化实现 | T03 |
| `src/test-support/story-fixtures.ts` | 新建：在临时库里造作品、回合、事实的帮助函数 | T08 |
| `src/test-support/fake-summary.ts` | 新建：记录型的假摘要服务 | T03 |
| `src/app.test.ts`、`src/api/http-app.test.ts`、`src/app.integration.test.ts`、`src/play/service.test.ts` | 跟上新的服务接口（只补构造参数，不改断言） | T03 |
| `src/authoring/preview-tool.ts`、`preview-prompt.ts`、`service.ts` | 预览带 `changes`；采用时写入初始事实 | T10 |
| `src/play/context.ts`、`narrator-prompt.ts`、`propose-turn-tool.ts`、`service.ts` | 推送、拉取、`changes`、手记查询 | T11 |
| `src/summary/queue.ts`、`summary/prompt.ts` | 新建：后台摘要 | T12 |
| `src/app.integration.test.ts` | 补 M2 的集成用例 | T16 |

### 4.4 `apps/client`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `src/i18n/zh-CN/errors.json` | 加两个错误码的文案 | T03 |
| `src/i18n/zh-CN/common.json` | 共享部件的文案 | T07 |
| `src/i18n/zh-CN/settings.json`、`library.json`、`authoring.json`、`play.json` | 各页文案 | T13、T14、T14、T15 |
| `src/theme/appearance.ts`、`appearance.test.tsx` | `applyAppearance(appearance: Appearance)` 写全部根属性 | T07 |
| `src/app/App.tsx`、`router.tsx`、`app.module.css` | 外壳：去掉全局导航条、⌘, 快捷键、`settings.changed` 分发、页面切换动效 | T07 → T16（删除 `app.module.css` 里不再使用的规则） |
| `src/shared/ui/*` | 共享部件（见 T07 列表） | T07 |
| `src/shared/ui/logo-paths.json` | 标志的 SVG 路径数据 | T02 |
| `src/shared/hooks/useShortcut.ts`、`useAutosave.ts`、`useFollowLatest.ts`、`useEnterToSubmit.ts` | 快捷键、自动保存、跟随最新、回车提交 | T07 |
| `src/shared/lib/css-time.ts` | 从 CSS token 读时长 | T07 |
| `src/shared/api/query.ts` | 加 `settings`、`journal` 查询键 | T07 |
| `src/shared/test/fake-api.ts`、`render.tsx`、`axe.ts`、`heading-outline.ts` | 组件测试的公共夹具 | T07 |
| `src/features/settings/*` | 设置页 | T13 |
| `src/features/library/*` | 作品库 | T14 |
| `src/features/authoring/*` | 创作页 | T14 |
| `src/features/play/*` | 游玩页与手记 | T15 |

### 4.5 `e2e`

| 文件 | 作用 | 归属 |
| --- | --- | --- |
| `tests/milestone.spec.ts`、`acceptance.spec.ts`、`smoke.spec.ts` | 按新界面更新选择器 | T17 |
| `tests/milestone-2.spec.ts` | 新建：M2 的验收用例 | T17 |
| `fixtures/*` | 公共夹具（核对 M1 实际有没有这个目录；没有就新建） | T17 |

---

## 5. 任务

每个任务的固定结构：**目的 / 依赖 / 拥有的文件 / 先读 / 步骤 / 注意事项 / 完成判据（每条带突变）**。涉及接线的任务另有“接线点”一栏：功能写好了不等于被调用了，接线点要逐个列出、逐个验证。

### T00 设计补洞：把 §1.3、§1.5 的决定写进 docs

**目的。** 设计以 `docs/` 为准（[AGENTS.md §6](../AGENTS.md#6-项目事实)）。思考写法、“没设置”和“关闭”的区别、多模型端点、开场实体的归属、段落编号、新的诊断样本，这些决定要先落进设计文档，后续任务才有据可依。

**依赖。** 维护者确认 §1.3 和 §1.5。维护者改选了其他做法时，按维护者的选择改写下面的步骤，并同步修改本文受影响的任务。否决 A1 时跳过步骤 3、4、9 里有关多模型的句子；否决 A3 时跳过步骤 12 里有关删除作品的句子。

**拥有的文件。** `docs/llm-endpoints.md`、`docs/data-model.md`、`docs/diagnostics.md`、`docs/architecture.md`、`docs/milestone-2.md`。

**先读。** [docs/AGENTS.md](../docs/AGENTS.md) 全文，尤其是 §2 写作原则、§3 审计、§4 中文母语感。

**步骤。**

- [ ] 1. `docs/llm-endpoints.md` §2 的 JSON 示例里，把模型那一行改成：

  ```json
  { "id": "qwen3:14b", "contextWindow": 32768, "maxTokens": 8192, "tools": true, "reasoning": true, "thinkingFormat": "qwen-chat-template", "vision": false }
  ```

- [ ] 2. `docs/llm-endpoints.md` §6 “能力字段”那一段之后，另起一段，原文如下：

  ```
  **思考写法。** 不同服务端用不同的请求字段开关思考：OpenAI 用 `reasoning_effort`，DashScope 等 Qwen 服务用 `enable_thinking`，vLLM、SGLang 上的 Qwen 模型用 `chat_template_kwargs.enable_thinking`，DeepSeek 用 `thinking: {type}`，OpenRouter 用 `reasoning: {effort}`，智谱用 `thinking: {type}`。所以每个模型有一个能力字段 `thinkingFormat`，取 `auto`、`openai`、`qwen`、`qwen-chat-template`、`deepseek`、`openrouter`、`zai` 之一，默认 `auto`。`auto` 交给 pi-ai 按地址识别（pi-ai `api/openai-completions.js` 的 `detectCompat`），识别不出时按 `openai` 写法。没有这个字段，自建服务上“关闭思考”根本发不出去。
  ```

- [ ] 3. `docs/llm-endpoints.md` §6 “保存前的校验”列表最后加一条：`- 思考写法只能是上一段列出的七个值之一。`
- [ ] 4. `docs/llm-endpoints.md` §7 “生成参数”一节：
  - 表格 `thinking` 一行的第三列改成：`` `reasoning`；按模型的思考写法发出，见下文 ``。
  - 表格 `thinkingBudget` 一行的第三列改成：`` 只对 `qwen` 写法发送，字段名 `thinking_budget` ``。
  - 列表第二条（以“思考档位只对能力字段”开头）之后插入两条：

    ```
    - **没设档位和设为关闭是两回事。** 用途没设 `thinking` 时，请求里不带任何思考字段，由服务端决定。设为 `off` 时，按模型的思考写法明确发出关闭：`openai` 写法发 `reasoning_effort: "none"`，`qwen` 写法发 `enable_thinking: false`，`qwen-chat-template` 写法发 `chat_template_kwargs.enable_thinking: false`，`deepseek` 和 `zai` 写法发 `thinking: {"type": "disabled"}`，`openrouter` 写法发 `reasoning: {"effort": "none"}`。默认会思考的模型只有这样才能关掉。
    - **思考预算只对 `qwen` 写法发送**，字段名 `thinking_budget`。其他写法没有通用的预算字段，设置页把预算栏置灰并写明原因；接口收到时以 `thinking_unsupported` 拒绝。
    ```

  - 列表第三条（以“`topP`、`topK`、`minP` 只有”开头）之后插入一条：

    ```
    - **同时设了思考档位和采样参数时，设置页提示：** 开启思考后，部分服务会忽略或拒绝采样参数，请用测试连接确认。采样参数只有在服务端真正兑现时才算生效，所以验收看的是服务商收到的请求体，不是界面上的值。
    ```

- [ ] 5. `docs/llm-endpoints.md` §9 `llm_calls` 表里 `ref_kind` 那一行的注释改成 `-- turn_request | job | chat_message | turn`，并在表后的列表第一条末尾加一句：`回合摘要的调用以回合为引用（`ref_kind = turn`）。`
- [ ] 6. `docs/llm-endpoints.md` §10 的表：
  - `llm.endpoints.update` 一行的第二列改成：`修改自定义端点的名称和 key。地址变化时拒绝，要作为新端点添加；跨源时返回 \`endpoint_origin_changed\`（§3）`
  - 在 `llm.endpoints.remove` 之后加三行：

    ```
    | `llm.models.add` | 给自定义端点加一个模型 |
    | `llm.models.update` | 修改模型的能力字段：`reasoning`、`thinkingFormat` |
    | `llm.models.remove` | 删除模型；端点下最后一个模型不能删（`last_model`）。引用它的用途分配一并清除 |
    ```

- [ ] 7. `docs/data-model.md` §4 `facts` 表里 `source_para` 那一行注释改成 `-- 出处：正文的第几段，从 1 起，按空行切分`。`entity_names`、`knowledge` 两张表里的 `source_para` 同样补上 `-- 从 1 起`。
- [ ] 8. `docs/data-model.md` §4 “主角也是一个实体”那一段末尾加一句：`每个版本恰好有一个 \`is_protagonist = 1\` 的实体；开场回合为主角写一条主角自己持有的称呼，所以主角总知道自己的名字。`
- [ ] 9. `docs/data-model.md` §4 “几个典型的事实”表之前，加一段：

  ```
  **采用开场时的归属。** 作者采用的开场预览里新出现的实体，视为作者认可的设定：`origin_turn_id` 为空，同一个 `id` 同时写进草稿和发布版本，所以将来从同一个开场重新开局时，固定人物不会丢。开场里的称呼、事件、特征、关系、约定和知情挂在根回合上，因为它们是这一局开场时发生的经历。
  ```

- [ ] 10. `docs/diagnostics.md` §3 样本表，在 `turn.context` 一行之后加四行：

  ```
  | `story.projection` | 开始读取一条路线可见的故事事实 | 投影可用。附实体、事实、知情的条数 |
  | `story.tool` | 模型调用一次只读工具 | 工具返回结果或错误。附工具名和返回的记录条数 |
  | `summary.total` | 摘要任务开始处理 | 摘要写入、失败或回合已不存在 |
  | `settings.update` | core 收到外观偏好的修改 | 写入完成或失败 |
  ```

  并把 `turn.context` 一行第三列末尾的“成功时附纳入的回合数和估算的上下文 token 数”改成“成功时附纳入的回合数、估算的上下文 token 数、索引列出的实体数和摘要行数”。
- [ ] 11. `docs/architecture.md` §3 第二条（以“一条事件流”开头）里，“包括请求状态变化、回合已提交、生成任务进度、端点配置变化”改成“包括请求状态变化、回合已提交、生成任务进度、端点配置变化、外观偏好变化”。
- [ ] 12. `docs/milestone-2.md`：
  - “作者和玩家能做什么”表的“配置模型”一行末尾加：`一个端点下可以有多个模型，每个模型可以标明是否支持思考和思考写法；端点和模型都能删除。`
  - 同表“游玩”一行末尾加：`失败后也可以把原话放回输入框改写再发。`
  - 同表“作品库”一行末尾加：`作品卡的更多操作里可以删除作品，删除前确认。`
  - “实现顺序与检查点”第 2 条，把“采用时随开场存进发布版本。提交根回合时，在同一事务里写入这些事实。”改成下面这句（原文照抄，括号里是 `docs/` 内的相对链接）：

    ```
    采用时，新出现的实体作为作品设定写进草稿和发布版本，其余事实挂在根回合上，与根回合在同一事务里写入（[数据模型 §4](./data-model.md#4-故事事实)）。
    ```
- [ ] 13. 运行 `node scripts/check-doc-links.mjs`，必须通过。
- [ ] 14. 按 [docs/AGENTS.md §3](../docs/AGENTS.md#3-审计) 对本次新增的行跑三遍扫描，逐条判断命中。

**注意事项。**

- 直接写成现在时，不写“新增”“改为”“里程碑二”之类的过程词。
- 不改上面没列出的段落。看到其他问题，写进汇报。
- 步骤里的原文照抄；中文标点、反引号都按原样。

**完成判据。**

- `node scripts/check-doc-links.mjs` 输出“链接检查通过”。突变：把步骤 9 加的那段里随便一个链接改成 `./data-model.md#不存在`，必须报错。
- `git diff --stat -- docs/` 只列出本任务拥有的五个文件。
- 三遍审计扫描的命中逐条写进汇报，每条附判断。

### T01 落地借鉴的编码规范

**目的。** 维护者要求参考 Looma 的 AGENTS.md。下面挑出的是在 Unwritten 的技术栈上同样成立、而且本里程碑马上会用到的规则。它们落进仓库规范后，T07–T17 和以后的里程碑都按它执行，不再只存在于这份任务文件里。依据：[AGENTS.md §10](../AGENTS.md#10-沉淀方法) 的四条门槛（反复遇到、稳定机制、可写成触发条件与判据、符合当前代码）。

不搬的部分和理由：Mantine、TipTap、Monaco、Zustand、orval、Python 后端的具体条款（技术栈不同）；虚拟列表、WebKit 性能对照、Tauri 壳的条款（本仓库目前用不上）；KI 编号、台账细则（本仓库还没有 KI 体系）。

**依赖。** 维护者确认 D10。

**拥有的文件。** `apps/client/AGENTS.md`、`packages/core/AGENTS.md`（新建）、`tasks/AGENTS.md`（新建）、根目录 `AGENTS.md`。

**先读。** 根目录 [AGENTS.md](../AGENTS.md) 全文；[apps/client/AGENTS.md](../apps/client/AGENTS.md) 全文；[docs/AGENTS.md](../docs/AGENTS.md) §4 中文母语感。

**步骤。**

- [ ] 1. `apps/client/AGENTS.md` 末尾追加五节，原文如下（照抄）：

  ```markdown
  ## 7. 模块边界

  - 代码分三层：`app/` 装配（入口、Provider、路由、外壳），`features/` 功能（按页面切分），`shared/` 共享（API 客户端、通用部件、hooks、工具函数）。依赖只能从上往下：`app` → `features` → `shared`。
  - `features/*` 之间不互相 import。两个 feature 都要用的东西，下沉到 `shared/`。
  - 判据：`grep -rnE "from '\.\./\.\./features/|from '\.\./(library|authoring|play|settings)/" apps/client/src/features` 零命中。

  ## 8. 状态与数据流

  - **服务端数据只放在 TanStack Query 的缓存里。** 组件里不另存一份服务端数据的副本。
  - **组件不直接发请求。** 一律经 `useApi()` 拿到的 oRPC 客户端，查询键只用 `shared/api/query.ts` 的 `queryKeys`。代码里不出现裸 `fetch`。
  - **事件流只在 `App.tsx` 统一订阅**，把每种事件映射成查询失效。组件不自己订阅事件流。
  - **写后精确失效。** mutation 成功后按查询键失效受影响的查询，不整体失效全部查询。
  - **乐观更新只用 `queryClient.setQueryData`，不用 React 的 `useOptimistic`。** 后者的状态在组件局部，会在查询缓存旁边再立一份真相，而且它在过渡结束时会先跳回旧值，再等重新查询的结果，界面会闪。
  - **需要重复触发的动作带序号。** 让同一个目标再次滚动、聚焦或播报时，用 `{ id, seq }` 这样的对象，不用裸值：React 会跳过相同值的 `setState`。
  - **在途编辑留在本地。** 输入框的内容是组件本地状态，防抖后保存；事件回查得到的服务端值不覆盖还没保存的本地输入。

  ## 9. 加载、空状态、错误

  - 加载用共享的 `Skeleton`，空状态用共享的 `EmptyState`，并给出下一步能做什么。
  - 错误用共享的 `ErrorNotice`：主句是 `errors:<code>`，有 `detail` 时放在“详细信息”下原样显示。不要手写只有“加载失败”的提示。
  - `not_found` 是记录不存在的正常结局，用 `EmptyState` 说明去哪里，不当作故障。
  - 鉴权失败（HTTP 401）切换到无令牌说明页；`stale_revision`、`config_conflict`、`stale_head` 这类冲突，重新读取最新数据，保留用户的输入，请用户核对后再提交。

  ## 10. 滚动、浮层与长内容

  - **跟随最新内容用挂在内容盒上的 `ResizeObserver`。** 用户往上翻时暂停跟随，回到底部后恢复。不用 `flex-direction: column-reverse`，也不要观察尺寸不变的滚动容器。
  - **关闭不等于卸载。** 关闭状态的抽屉、对话框不挂载昂贵内容。Base UI 的弹层默认关闭时卸载，不要打开 `keepMounted`。判据数 DOM 节点，不看是否可见。
  - **浮层和宣告区的挂载容器要 `position: relative`。** 绝对定位的子元素找不到已定位的祖先时，会把位置算进外层滚动容器，凭空多出一条滚动条。这类回归组件测试看不出来，在真实浏览器里量 `scrollHeight - clientHeight`。
  - **下拉选择用 Base UI 的 `Select`，不用原生 `<select>`。** 原生下拉的展开菜单由操作系统绘制，主题 token 管不到。
  - 宣告区一律用共享的 `LiveRegion`，不各自手写 `aria-live`。

  ## 11. 测试

  - **判断“保存成功”要看服务端。** 断言请求参数或重新读回的值，不断言按钮恢复可用：加载状态本身就会让按钮禁用和恢复。
  - **观察器的测试桩要验证接线。** 只有调用了 `observe(target)` 之后才能触发回调，并断言 `target` 是哪个元素。直接调用回调只测到了回调本身，测不到观察器有没有挂上。
  - **每页恰好一个 `h1`，标题逐级不跳。** 新页面和新浮层用 `shared/test/heading-outline.ts` 断言。
  - **只在生产构建成立的接线要有构建侧判据。** 内容安全策略、首屏外观脚本这类东西，组件测试跑在开发构建里，证明不了它们生效，要在端到端测试里查。
  ```

- [ ] 2. 新建 `packages/core/AGENTS.md`，原文如下（照抄）：

  ```markdown
  # packages/core/ 编码规范

  本目录是 Unwritten 的 core：全部业务逻辑，对外提供 oRPC 接口（[架构总览 §1](../../docs/architecture.md#1-四个组成部分)）。写代码前先读对应的设计文档，代码是设计的兑现。

  ## 1. 模块与依赖方向

  - `api/` 只做三件事：解析请求、调用服务、映射响应。业务逻辑不写在路由里。
  - 模块之间经 `services.ts` 里的接口调用，不深入导入别的模块的内部文件。跨模块的变化通知经 `events/` 的事件总线。
  - `story/` 只依赖 `store/` 和 `text/`，不导入 `llm/`、`api/`、`play/`、`authoring/`：故事事实的读写不知道模型和接口的存在。
  - `llm/pi.ts` 是唯一导入 pi-ai 和 pi-agent-core 的文件。
  - 判据：`grep -rnE "from '\.\./(llm|api|play|authoring)/" packages/core/src/story` 零命中；`grep -rln "@earendil-works" packages/core/src` 只列出 `llm/pi.ts` 和测试支持代码。

  ## 2. 契约与错误

  - contracts 是 client 与 core 之间的单源。枚举、可空性、字段名在 contracts 里定死。
  - core 只返回稳定的错误码和结构化的 `detail`，显示给用户的文字由 client 按错误码查 i18n。
  - 新增一个错误码要改三处：`contracts/src/errors.ts`、`core/src/errors.ts` 的 `HTTP_STATUS`、`client/src/i18n/zh-CN/errors.json`。
  - **读的时候校验什么，写的时候就校验什么。** 存进 JSON 列的对象，写入前用同一个 Zod schema 校验，不另开一条不校验的写路径。

  ## 3. 事务与事件

  - 一个用例一个事务。SQLite 驱动是同步的，事务回调里不 `await`。
  - **先提交后发布。** `bus.publish` 放在事务提交成功之后。订阅方读到的必须是已经落库的状态。
  - 有副作用的命令带幂等键；推进路线 head 用比较再更新（[架构总览 §3](../../docs/architecture.md#3-client-与-core-的通信)）。

  ## 4. 模型调用

  - 所有模型调用都经 `llm` 模块的 `run()` 或 `complete()`。业务代码不直接拼 HTTP 请求。
  - **工具不写库。** 只读工具只读；提案工具（`propose_turn`、`propose_preview`）只交出提案，由 core 校验后在提交事务里写入。
  - **重试分层，不叠加。** 网络类失败由 `llm` 模块自动重试一次；提案不合格由校验反馈让模型修正，最多两次；再失败交给用户点“重试”。不在别的层再加一层重试。
  - **采样参数只有服务端真正兑现才算生效。** 测试断言伪服务收到的请求体，不断言配置里的值。
  - **改动任何进入工具说明或系统提示的文字，都要更新 token 棘轮测试**（`story/tools.test.ts`、`play/context.test.ts`），并在提交说明里写清涨幅来自哪一段。不要为了让测试通过直接把数字调大。

  ## 5. 新增时要登记的地方

  - **新增一种 `changes` 类型：** `story/types.ts` 的 schema、`story/changes.ts` 的解析与校验、`story/writer.ts` 的写入、`play/propose-turn-tool.ts` 的参数说明、`play/narrator-prompt.ts` 的系统提示（如需）、`story/tools.test.ts` 的 token 棘轮，以及每条规则一个测试。
  - **新增一个只读工具：** `story/tools.ts`、`story/render.ts` 的结果格式、`turn_requests.log` 的足迹、`story.tool` 样本、token 棘轮。
  - **新增一个模型用途：** contracts 的用途枚举、`llm/providers-schema.ts`、`llm/service.ts` 的回落规则、client 设置页的用途列表和文案。
  - **新增一个错误码：** 见 §2。

  ## 6. 日志与性能

  - 运行事件和性能样本只写诊断库（[运行诊断与性能记录](../../docs/diagnostics.md)）。不用 `console.log`，不写日志文件。
  - **成功路径也要记。** 模型调用、上下文构建、工具调用、提交、后台任务的开始与结束都要有事件或样本，不能只在失败分支记。
  - 样本带稳定的名字、耗时、结果、能解释耗时的规模字段（条数、token 估算数）和已有的关联 ID。
  - `data` 里只放枚举、计数、布尔和 id，不放正文、名字、陈述、玩家输入和 key。

  ## 7. 测试

  - **断言钉产物，不回抄自己的声明。** 期望值不从被测代码里取；固定的协议字段名、上限、阈值，至少有一条断言直接写字面量。
  - **用扫描、反射得到的集合，先断非空再断性质。** 空集上的“全部满足”恒为真。
  - **否定断言配阳性对照。** 断言“没写入”“不泄露”“没发送”时，同一个测试里证明同一条路径确实在产出别的东西。
  - **会启动后台队列的测试**，动作前只断言处于可执行状态，动作后用 `whenIdle()` 等队列空了再断言。
  - 需要模型的测试一律用伪服务：单元测试用 `createScriptedLlm`，集成测试用伪 OpenAI 服务。测试里的故事内容全部虚构。
  ```

- [ ] 3. 新建 `tasks/AGENTS.md`，原文如下（照抄）：

  ```markdown
  # tasks/ 写作规范

  `tasks/` 放每个里程碑的实现任务拆解，一个里程碑一个文件，例如 `milestone-2.md`。`docs/` 描述系统应有的样子，`tasks/` 描述怎样把它做出来、做到了怎样知道。写法遵循 [docs/AGENTS.md §4](../docs/AGENTS.md#4-中文母语感)。

  ## 1. 文件结构

  每个里程碑文件依次是：给执行者的规则、范围评估（含推迟项和待拍板的设计决定）、贯穿全局的约定、依赖与并行波次、文件总表、任务、附录（文案、提示词、文本格式）、台账。每个任务的固定结构是：目的 / 依赖 / 拥有的文件 / 先读 / 步骤 / 接线点 / 注意事项 / 完成判据。

  ## 2. 事实断言带核法

  - 任务里写到“某符号在某文件”“某处已有某能力”，都是规划那一刻读到的，执行时可能已经变了。写成“`X`（按符号名找，规划时在 `a.ts`）”，不只写行号。
  - 写“已核实”时附上核法：跑了什么命令，读到了什么。
  - “全文没有 X”这类否定结论，只能用 `grep` 或完整读取支撑，不能用截断的读取。
  - 每个任务都提醒执行者：先核实前提，前提不成立就停下来说。

  ## 3. 功能落点与接线点分开写

  - 功能写好了，不等于有人调用它。任务里分两栏写：功能落点（改哪个文件的哪个符号）和接线点（把它挂上去的每一行在哪里）。
  - 一个功能有 N 个调用方，就要有 N 条接线判据。N 要当场 `grep` 出来，不写“等”。

  ## 4. 判据

  判据不是“跑一遍看看”，是“什么情况下它会红”。

  1. **每条判据配一个最小突变**：写清把哪一行改成什么，这条必须红。突变不红时先答两问：这一行在这个跑法下会被执行吗？还有没有第二道守卫接住了？如实写进汇报，不为了变红改判据。
  2. **断言这条路径独有的可观测面。** “看到它报错了”只证明有某个机制在工作，不证明是你写的那个。判据也不能锚在被测代码自己声明的值上。
  3. **否定命题要证三件事**：同一次运行里别的东西确实在产出（阳性对照）；摘掉守卫时它确实会写进去；拦截器本身是活的。
  4. **放宽判据要单独裁定。** 收紧可以自己定；把判据改松（换比较方向、集合相等改成子集、删掉一条断言）要写明方向，由维护者裁定。
  5. **照着单源判的判据，从单源现取，不手抄。** 枚举、清单、常量从定义处导入；但固定的协议字面量至少有一条断言直接写死。
  6. **判据的字面要带理由。** 排除项、命令名、条数写明为什么，执行时按理由重新核对范围。

  常见的恒绿写法：集合天然为空；期望值从被测代码派生；夹具让两种实现得到同一个结果；只测了多条路径中的一条；断言停在中间产物而不是最终副作用。

  ## 5. 写不出判据就诚实留白

  测不动的性质，写明“这里没有判据，靠什么契约立住、由谁人工检查”。不要给它凑一条名字比实际强的用例。“机器验不了”和“还没验”分开记。

  ## 6. 施工纪律

  - **突变用编辑器改回，不用 `git checkout`、`git restore`、`git stash`。** 工作区里一直压着未提交的成果。
  - 突变改动和测试运行不并发。
  - 门禁读数重定向进文件再看，不接 `| tail`：管道会吞掉退出码和失败条数。
  - 最后一次全量检查跑在最终的树上。
  - 出示“不该动的东西”的零差异：依赖清单、lint 配置、门禁脚本的 diff 为空，证明这次的绿不是靠削弱门禁换来的。

  ## 7. 台账

  - 台账记执行实况：改了什么、门禁读数、复核结论、欠账。不写过程叙事。
  - 裁定连同理由、决策者和何时重估一起写。
  - 判据做不到时，记“做不到、为什么、换了什么证据”，判据原文一个字不改。
  ```

- [ ] 4. 根目录 `AGENTS.md` 开头的目录列表（以“目录下另有 AGENTS.md 的”开头的那段）加两行，放在 `apps/client/AGENTS.md` 那一行之后：

  ```
  - [packages/core/AGENTS.md](packages/core/AGENTS.md)：core 的模块边界、事务、模型调用、日志与测试规则。
  - [tasks/AGENTS.md](tasks/AGENTS.md)：任务拆解与判据的写作规范。
  ```

- [ ] 5. 运行 `node scripts/check-doc-links.mjs`，必须通过（它会检查全仓 AGENTS.md 的链接）。

**注意事项。**

- 不改上面没列出的段落。
- `apps/client/AGENTS.md` 现有的 §1–§6 不动，新内容编号接着往下排。
- 两份新文件里的链接是相对于文件自己的位置写的，照抄即可。

**完成判据。**

- `node scripts/check-doc-links.mjs` 输出“链接检查通过”。突变：把 `packages/core/AGENTS.md` 里的 `../../docs/architecture.md` 改成 `../docs/architecture.md`，必须报错。
- `grep -c "^## " apps/client/AGENTS.md` 输出 11。

### T02 Figma 校准（编排者执行）

**目的。** 维护者决定先校准 Figma 再写界面。Prototype 页上的稿子要对齐设计文档，并补齐本里程碑新增的状态（手记、模型用途、思考参数、外观偏好、删除确认、改写冲突），作为 T07、T13–T15 的视觉依据。弱模型不能可靠地操作 Figma，所以这个任务由编排者用 figma-console 工具执行。

**依赖。** 无。可与 T00、T01、T03 同时进行，最迟在 T07 开工前完成稿子并经维护者确认。

**拥有的文件。** Figma 文件 `Unwritten`（`fileKey` 记在维护者的备忘里）的 Prototype 页和 Design System 页；`apps/client/src/shared/ui/logo-paths.json`；`tasks/assets/milestone-2/*.png`。

**先读。** [设计准则](../docs/design-guidelines.md) 全文、[主题与 token](../docs/theme.md) §4–§7、[动效 §5](../docs/motion.md#5-场景编排)、[a11y §8](../docs/a11y.md#8-游玩页)。Figma 的限制：每个变量集合只能有一个 mode，最多三个页面；不要新建页面或 mode。

**步骤。**

- [ ] 1. 用 `figma_search_components` 列出现有部件，截图 Prototype 页现有的四个 section，对照设计准则 §2 的七条准则和 §9 的部件表，列出差异。
- [ ] 2. Design System 页补齐部件的全部状态：主按钮、次按钮、文字按钮、危险按钮（默认、悬停、按下、禁用、焦点）；输入框、多行输入、下拉选择、单选组、数字输入（默认、聚焦、错误、禁用）；卡片、徽标（中性、成功、警告、危险）；工具行；对话框；右侧抽屉；通知；骨架块；生成中标记；空状态。颜色和尺寸只绑定变量。
- [ ] 3. Prototype 页按页面补齐状态：
  - 作品库：加载中、空库、有三部作品（草稿、可玩、有进度）、更多操作菜单展开、删除确认对话框。
  - 创作页：写背景（已保存、正在保存）、生成中、预览（含出场人物列表）、预览已过期、已存入作品库。
  - 游玩页：阅读中（开场 + 两个回合）、生成中、失败（重试和改写）、玩家上翻时新段落到达（“回到最新”）、输入框有字时点推荐行动的确认对话框、手记抽屉打开、从手记跳回原文的定位高亮。
  - 设置页：模型用途（三张卡：默认、游玩、后台摘要；含思考参数、采样参数、同时设置时的提示、预算置灰的原因）、端点列表（一个端点两个模型）、添加端点、外观与阅读（含示例段落）。
  - 以上全部再出一份深色稿。
- [ ] 4. 每一帧用 `figma_take_screenshot` 导出 PNG，存到 `tasks/assets/milestone-2/`，文件名用 `<页面>-<状态>-<light|dark>.png`，例如 `play-journal-open-dark.png`。
- [ ] 5. 从 Logo 页导出完整标志和简化标志的 SVG 路径，写成 `apps/client/src/shared/ui/logo-paths.json`：

  ```json
  {
    "full": { "viewBox": "0 0 48 48", "rings": ["<d>", "<d>"], "dot": { "cx": 24, "cy": 24, "r": 3 } },
    "simple": { "viewBox": "0 0 32 32", "rings": ["<d>"], "dot": { "cx": 16, "cy": 16, "r": 2.5 } },
    "wordmark": { "viewBox": "0 0 120 28", "paths": ["<d>"] }
  }
  ```

  数值按 Figma 实际导出的填写；上面只是结构示例。
- [ ] 6. 稿子和本文 T07、T13–T15 的描述不一致时：稿子符合设计文档，就改本文对应任务；稿子不符合设计文档，就改稿子。两者都改不了时，按 §0.3 汇报维护者。
- [ ] 7. 把截图清单和差异处置写进 §6 台账，请维护者确认。

**完成判据。** `tasks/assets/milestone-2/` 里每个页面状态都有浅色和深色两张截图；`logo-paths.json` 能被 `JSON.parse` 解析，`full.rings` 至少一条路径；维护者在台账里确认。

### T03 契约与接口先行

**目的。** 把 client 与 core 之间的全部新契约、core 各模块之间的全部新接口一次写死，让 W2–W4 的任务可以并行开工、互不等待。按 §2.8 只加不删，按 §2.9 给新服务方法写占位实现，保证合并后 `pnpm typecheck` 和 `pnpm test` 照常通过。

**依赖。** T00。

**拥有的文件。** §4 里归属 T03 的全部文件。

**先读。** [LLM 端点 §7、§10](../docs/llm-endpoints.md#7-用途分配)（T00 改过的版本）；[数据模型 §4–§5](../docs/data-model.md#4-故事事实)；[主题与 token §9](../docs/theme.md#9-外观偏好与切换)；本文 §1.5、§2.3、§2.8、§2.9；现有的 `packages/contracts/src/**`、`packages/core/src/services.ts`、`packages/core/src/api/router.ts`、`packages/core/src/llm/types.ts`。

**步骤。**

- [ ] 1. `packages/contracts/src/errors.ts`：在 `ERROR_CODES` 数组末尾（`'save'` 之后）加 `'thinking_unsupported'`、`'last_model'`。
- [ ] 2. `packages/contracts/src/schemas/llm.ts`，在文件里已有的 import 之后、`ModelCapabilitiesSchema` 之前加：

  ```ts
  export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  export const ThinkingLevelSchema = z.enum(THINKING_LEVELS);

  export const THINKING_FORMATS = ['auto', 'openai', 'qwen', 'qwen-chat-template', 'deepseek', 'openrouter', 'zai'] as const;
  export const ThinkingFormatSchema = z.enum(THINKING_FORMATS);

  export const PURPOSES = ['default', 'narrator', 'background'] as const;
  export const PurposeSchema = z.enum(PURPOSES);

  export const GENERATION_LIMITS = { thinkingBudgetMax: 1_000_000, temperatureMax: 2, topKMax: 1_000 } as const;

  export const GenerationParamsSchema = z.object({
    thinking: ThinkingLevelSchema.nullable(),
    thinkingBudget: z.number().int().positive().max(GENERATION_LIMITS.thinkingBudgetMax).nullable(),
    temperature: z.number().min(0).max(GENERATION_LIMITS.temperatureMax).nullable(),
    topP: z.number().gt(0).max(1).nullable(),
    topK: z.number().int().positive().max(GENERATION_LIMITS.topKMax).nullable(),
    minP: z.number().min(0).max(1).nullable(),
  });

  export const EMPTY_GENERATION_PARAMS = {
    thinking: null,
    thinkingBudget: null,
    temperature: null,
    topP: null,
    topK: null,
    minP: null,
  } as const satisfies z.infer<typeof GenerationParamsSchema>;
  ```

- [ ] 3. 同一文件，`ModelCapabilitiesSchema` 加两个字段（放在 `tools` 之后）：

  ```ts
  reasoning: z.boolean().nullable(),
  thinkingFormat: ThinkingFormatSchema,
  ```

- [ ] 4. 同一文件，`LlmConfigViewSchema` 之前加：

  ```ts
  export const PurposeProblemSchema = z.enum(['not_configured', 'model_missing', 'no_tools']);

  export const PurposeViewSchema = z.object({
    purpose: PurposeSchema,
    model: ModelRefSchema.nullable(),
    params: GenerationParamsSchema,
    inherited: z.boolean(),
    effectiveModel: ModelRefSchema.nullable(),
    effectiveParams: GenerationParamsSchema,
    problem: PurposeProblemSchema.nullable(),
  });
  ```

  字段含义（写进 T05 的实现，这里先定死）：`model`、`params` 是这个用途自己的分配，没分配时 `model` 为 `null`、`params` 为全空；`inherited` 为 `true` 表示它没有自己的分配，回落到 `default`；`effectiveModel`、`effectiveParams` 是回落之后实际使用的；`problem` 说明实际不可用的原因，可用时为 `null`。
- [ ] 5. 同一文件，`LlmConfigViewSchema` 的对象里加一个字段（放在最后）：`purposes: z.array(PurposeViewSchema),`。`defaultModel`、`defaultModelUsable` 保留（§2.8）。
- [ ] 6. 同一文件，修改和新增输入 schema：
  - `UpdateEndpointInputSchema` 的 `modelId: ModelIdSchema` 改成 `modelId: ModelIdSchema.optional()`。
  - `SetPurposeInputSchema` 整个替换成：

    ```ts
    export const SetPurposeInputSchema = z.object({
      baseRevision: z.string(),
      purpose: PurposeSchema,
      model: ModelRefSchema.nullable(),
      params: GenerationParamsSchema.default(EMPTY_GENERATION_PARAMS),
    });
    ```

  - 新增：

    ```ts
    export const AddModelInputSchema = z.object({
      baseRevision: z.string(),
      endpointId: z.string().min(1),
      modelId: ModelIdSchema,
    });

    export const UpdateModelInputSchema = z.object({
      baseRevision: z.string(),
      endpointId: z.string().min(1),
      modelId: ModelIdSchema,
      reasoning: z.boolean().nullable(),
      thinkingFormat: ThinkingFormatSchema,
    });

    export const RemoveModelInputSchema = z.object({
      baseRevision: z.string(),
      endpointId: z.string().min(1),
      modelId: ModelIdSchema,
    });

    export const RemoveEndpointInputSchema = z.object({
      baseRevision: z.string(),
      endpointId: z.string().min(1),
    });
    ```

  - 把现有的 `TestConnectionInputSchema` 改名为 `TestDraftConnectionInputSchema`（内容不变），再新增：

    ```ts
    export const TestPurposeConnectionInputSchema = z.object({ purpose: PurposeSchema });

    export const TestConnectionInputSchema = z.union([TestDraftConnectionInputSchema, TestPurposeConnectionInputSchema]);
    ```

  - 文件末尾的类型导出补上：`ThinkingLevel`、`ThinkingFormat`、`Purpose`（类型名用 `LlmPurpose`，避免和 core 里已有的 `Purpose` 撞名）、`GenerationParams`、`PurposeProblem`、`PurposeView`、`AddModelInput`、`UpdateModelInput`、`RemoveModelInput`、`RemoveEndpointInput`、`TestDraftConnectionInput`、`TestPurposeConnectionInput`。写法照文件里现有的 `export type X = z.infer<typeof XSchema>;`。
- [ ] 7. 新建 `packages/contracts/src/schemas/story.ts`：

  ```ts
  import { z } from 'zod';
  import { UuidSchema } from './common.ts';

  export const ENTITY_KINDS = ['character', 'place', 'item', 'group', 'other'] as const;
  export const EntityKindSchema = z.enum(ENTITY_KINDS);

  export const KNOWLEDGE_LEVELS = ['heard', 'suspects', 'confirmed', 'misled'] as const;
  export const KnowledgeLevelSchema = z.enum(KNOWLEDGE_LEVELS);

  export const StorySourceSchema = z.object({
    turnId: UuidSchema,
    depth: z.number().int().nonnegative(),
    para: z.number().int().positive(),
  });

  export const JournalLineSchema = z.object({
    id: z.string().min(1),
    text: z.string(),
    level: KnowledgeLevelSchema,
    source: StorySourceSchema.nullable(),
  });

  export const JournalSubjectSchema = z.object({
    entityId: z.string().min(1),
    kind: EntityKindSchema,
    name: z.string(),
    lines: z.array(JournalLineSchema),
  });

  export const JournalViewSchema = z.object({
    routeId: UuidSchema,
    headTurnId: UuidSchema,
    subjects: z.array(JournalSubjectSchema),
    events: z.array(JournalLineSchema),
  });

  export type EntityKind = z.infer<typeof EntityKindSchema>;
  export type KnowledgeLevel = z.infer<typeof KnowledgeLevelSchema>;
  export type StorySource = z.infer<typeof StorySourceSchema>;
  export type JournalLine = z.infer<typeof JournalLineSchema>;
  export type JournalSubject = z.infer<typeof JournalSubjectSchema>;
  export type JournalView = z.infer<typeof JournalViewSchema>;
  ```

  `JournalLine.id` 是事实 id；`text` 按[数据模型 §5](../docs/data-model.md#5-可见性规则)：确认知情用事实陈述，其余用主角实际听见或相信的说法。
- [ ] 8. `packages/contracts/src/schemas/works.ts`：
  - 文件开头 import `EntityKindSchema`（从 `./story.ts`）。
  - `PreviewSchema` 之前加：

    ```ts
    export const PreviewCastMemberSchema = z.object({
      kind: EntityKindSchema,
      name: z.string(),
      knownAs: z.string().nullable(),
      profile: z.string(),
      protagonist: z.boolean(),
    });
    ```

  - `PreviewSchema` 的对象里加一个字段（放在最后）：`cast: z.array(PreviewCastMemberSchema).default([]),`。用 `.default([])` 是因为 M1 存下的预览没有这个字段。
  - 类型导出补 `PreviewCastMember`。
- [ ] 9. `packages/contracts/src/schemas/play.ts`：`TurnViewSchema` 的对象里，在 `prose` 之后加 `paragraphs: z.array(z.string()),`。
- [ ] 10. `packages/contracts/src/events.ts`：import `AppearanceSchema`（从 `./schemas/appearance.ts`），在联合类型的数组末尾加：

  ```ts
  z.object({ type: z.literal('settings.changed'), appearance: AppearanceSchema }),
  ```

- [ ] 11. 过程：
  - `procedures/llm.ts`：import 新 schema，契约改成：

    ```ts
    export const llmContract = {
      providers: { list: oc.output(LlmConfigViewSchema) },
      endpoints: {
        create: oc.input(CreateEndpointInputSchema).output(CreateEndpointOutputSchema),
        update: oc.input(UpdateEndpointInputSchema).output(LlmConfigViewSchema),
        remove: oc.input(RemoveEndpointInputSchema).output(LlmConfigViewSchema),
      },
      models: {
        add: oc.input(AddModelInputSchema).output(LlmConfigViewSchema),
        update: oc.input(UpdateModelInputSchema).output(LlmConfigViewSchema),
        remove: oc.input(RemoveModelInputSchema).output(LlmConfigViewSchema),
      },
      purposes: { set: oc.input(SetPurposeInputSchema).output(LlmConfigViewSchema) },
      test: oc.input(TestConnectionInputSchema).output(TestConnectionResultSchema),
    };
    ```

  - `procedures/works.ts`：契约对象末尾加 `delete: oc.input(WorkIdInputSchema).output(z.object({})),`。
  - `procedures/play.ts`：import `JournalViewSchema`（从 `../schemas/story.ts`），契约对象末尾加 `getJournal: oc.input(RouteIdInputSchema).output(JournalViewSchema),`。
  - 新建 `procedures/settings.ts`：

    ```ts
    import { oc } from '@orpc/contract';
    import { AppearanceSchema } from '../schemas/appearance.ts';

    export const settingsContract = {
      get: oc.output(AppearanceSchema),
      update: oc.input(AppearanceSchema).output(AppearanceSchema),
    };
    ```

  - `index.ts`：`contract` 加 `settings: settingsContract`；加 `export * from './schemas/story.ts';`。
- [ ] 12. contracts 测试。新建 `packages/contracts/src/schemas/llm.test.ts`，用例（测试名照抄）：
  - `生成参数的边界`：`temperature` 取 `0` 和 `2` 通过，`2.01` 和 `-0.1` 不通过；`topP` 取 `1` 通过，`0` 不通过；`topK` 取 `1` 通过，`0` 和 `1.5` 不通过；`minP` 取 `0` 和 `1` 通过，`1.01` 不通过；`thinkingBudget` 取 `1` 通过，`0` 不通过。每个值单独构造一个其余字段全为 `null` 的对象来测。
  - `设置用途兼容旧形状`：`{ baseRevision: 'r', purpose: 'default', model: { endpointId: 'e', modelId: 'm' } }` 解析成功，`params.thinking` 为 `null`。
  - `测试连接接受两种输入`：旧的草稿形状和 `{ purpose: 'narrator' }` 都能解析；`{ purpose: 'author_chat' }` 不能解析（`author_chat` 不在界面开放的用途里）。
  - `思考档位与写法的取值`：直接断言 `THINKING_LEVELS` 等于 `['off','minimal','low','medium','high','xhigh','max']`，`THINKING_FORMATS` 等于 `['auto','openai','qwen','qwen-chat-template','deepseek','openrouter','zai']`（写字面量，不从别处取）。
  新建 `packages/contracts/src/schemas/works.test.ts`：`旧预览没有 cast 时补成空数组`。`errors.test.ts` 加一条：`ERROR_CODES` 包含 `'thinking_unsupported'` 和 `'last_model'`（字面量）。
- [ ] 13. `packages/core/src/errors.ts`：`HTTP_STATUS` 加 `thinking_unsupported: 400,`、`last_model: 409,`。
- [ ] 14. `packages/core/src/text/turn-text.ts` 末尾加：

  ```ts
  export function splitParagraphs(prose: string): string[] {
    return normalizeProse(prose)
      .split(/\n{2,}/)
      .filter((paragraph) => paragraph.length > 0);
  }
  ```

  并在 `turn-text.test.ts` 加用例 `段落按空行切分，段号与数组下标加一对应`：输入 `'甲\n\n\n乙\n丙\n\n丁'`，期望 `['甲', '乙\n丙', '丁']`。
- [ ] 15. `packages/core/src/llm/types.ts`：
  - `LlmRunRef.kind` 改成 `'turn_request' | 'job' | 'turn'`。
  - 文件末尾加：

    ```ts
    export interface LlmCompleteInput {
      purpose: Purpose;
      system: string;
      prompt: string;
      sessionId: string;
      ref: LlmRunRef;
      maxOutputTokens: number;
      signal?: AbortSignal;
    }

    export interface LlmCompleteResult {
      text: string;
    }
    ```

- [ ] 16. `packages/core/src/services.ts`：
  - import 补上 contracts 的 `AddModelInput`、`UpdateModelInput`、`RemoveModelInput`、`RemoveEndpointInput`、`JournalView`、`Appearance`；从 `./llm/types.ts` 补 `LlmCompleteInput`、`LlmCompleteResult`。
  - `LlmService` 加：

    ```ts
    removeEndpoint(input: RemoveEndpointInput): Promise<LlmConfigView>;
    addModel(input: AddModelInput): Promise<LlmConfigView>;
    updateModel(input: UpdateModelInput): Promise<LlmConfigView>;
    removeModel(input: RemoveModelInput): Promise<LlmConfigView>;
    complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
    ```

  - `LibraryService` 加 `delete(input: WorkIdInput): Record<string, never>;`
  - `PlayService` 加 `getJournal(input: RouteIdInput): JournalView;`
  - 新增：

    ```ts
    export interface SettingsService {
      get(): Appearance;
      update(input: Appearance): Appearance;
    }

    export interface SummaryService {
      enqueue(turnId: string, routeId: string): void;
      backfill(): number;
      whenIdle(): Promise<void>;
    }
    ```

  - `Services` 加 `settings: SettingsService;`、`summary: SummaryService;`。
  - `ServiceFactories` 改成：

    ```ts
    export interface ServiceFactories {
      llm(deps: CoreDeps): LlmService;
      library(deps: CoreDeps): LibraryService;
      settings(deps: CoreDeps): SettingsService;
      summary(deps: CoreDeps & { llm: LlmService }): SummaryService;
      authoring(deps: CoreDeps & { llm: LlmService }): AuthoringService;
      play(deps: CoreDeps & { llm: LlmService; summary: SummaryService }): PlayService;
    }
    ```

- [ ] 17. 占位实现（§2.9）。每个占位的方法体只有一行 `throw appError('internal', 'not implemented: <名字>');`，`<名字>` 照下面写：
  - `llm/service.ts` 返回的对象加 `removeEndpoint`（`llm.removeEndpoint`）、`addModel`（`llm.addModel`）、`updateModel`（`llm.updateModel`）、`removeModel`（`llm.removeModel`）、`complete`（`llm.complete`）。`async` 方法里同样直接 `throw`。
  - `llm/service.ts` 的 `testConnection(input)` 改成：`if ('purpose' in input) throw appError('internal', 'not implemented: llm.testConnection.purpose'); return tester(input);`。`createConnectionTester` 的参数类型改成 `TestDraftConnectionInput`。
  - `llm/service.ts` 的 `endpointView` 里每个模型加 `reasoning: model.reasoning ?? null` 和 `thinkingFormat: model.thinkingFormat ?? 'auto'`；`view()` 的两个返回分支都加 `purposes: []`。
  - `llm/providers-schema.ts` 的 `ModelEntrySchema` 加一行 `thinkingFormat: ThinkingFormatSchema.optional(),`（从 contracts 导入）。
  - `library/service.ts` 返回的对象加 `delete`（`library.delete`）。
  - `play/service.ts` 返回的对象加 `getJournal`（`play.getJournal`）；`turnView()` 加 `paragraphs: splitParagraphs(turn.prose)`。`createPlayService` 的参数类型改成 `CoreDeps & { llm: LlmService; summary: SummaryService }`，本任务不使用 `summary`。
  - 新建 `settings/service.ts`：`export function createSettingsService(deps: CoreDeps): SettingsService`，`get` 和 `update` 都是占位（`settings.get`、`settings.update`）。参数 `deps` 暂时不用时写成 `_deps`，看 oxlint 是否接受；不接受就按 §0.3 汇报，不要加抑制指令。
  - 新建 `summary/queue.ts`：`export function createSummaryService(deps: CoreDeps & { llm: LlmService }): SummaryService`，`enqueue`、`backfill` 是占位（`summary.enqueue`、`summary.backfill`）；`whenIdle` **不是**占位，直接 `return Promise.resolve();`：步骤 21 会把它加进 `close()`，占位抛错会让每个关闭 core 的测试失败。
  - `llm/service.ts` 的 `updateEndpoint`：`input.modelId` 变成可选后，用 `const modelId = input.modelId ?? endpoint.models[0]?.id ?? '';` 代替原来对 `input.modelId` 的三处使用，其余逻辑不变（T05 会重写这个方法）。
  - `llm/service.ts` 的 `setPurpose`：方法开头加 `if (input.purpose !== 'default' || input.model === null) throw appError('internal', 'not implemented: llm.setPurpose');`，之后的代码可以把 `input.model` 当作非空使用。不加这一行，放宽后的输入会把别的用途的设置写进 `default`。
  - `authoring/preview-tool.ts` 的 `parsePreviewArgs` 成功分支返回的对象加 `cast: []`。
- [ ] 18. `packages/core/src/test-support/scripted-llm.ts`：
  - `ScriptStep` 加一种：`| { text: string }`。
  - `run()` 里遇到 `text` 步骤时抛 `new LlmRunError('invalid_output', null)`。
  - 新增 `completes: LlmCompleteInput[]` 记录，和 `complete(input)`：记录输入；从队列取一步；`fail` 步骤抛对应的 `LlmRunError`；`text` 步骤返回 `{ text: step.text }`；其他步骤或队列为空抛 `new LlmRunError('invalid_output', null)`。
  - 新的管理方法 `removeEndpoint`、`addModel`、`updateModel`、`removeModel` 指向已有的 `notScripted`。
- [ ] 19. 新建 `packages/core/src/test-support/fake-summary.ts`，并在 `test-support/index.ts` 导出：

  ```ts
  import type { SummaryService } from '../services.ts';

  export interface RecordingSummary extends SummaryService {
    enqueued: Array<{ turnId: string; routeId: string }>;
  }

  export function createRecordingSummary(): RecordingSummary {
    const enqueued: Array<{ turnId: string; routeId: string }> = [];
    return {
      enqueued,
      enqueue(turnId, routeId) {
        enqueued.push({ turnId, routeId });
      },
      backfill() {
        return 0;
      },
      async whenIdle() {},
    };
  }
  ```

- [ ] 20. `packages/core/src/api/router.ts` 挂上新过程，每个 handler 只调用对应服务方法：
  - `llm.endpoints.remove` → `llm.removeEndpoint(input)`；`llm.models.add/update/remove` → `llm.addModel/updateModel/removeModel(input)`。
  - `works.delete` → `library.delete(input)`。
  - `play.getJournal` → `play.getJournal(input)`。
  - `settings.get` → `settings.get()`；`settings.update` → `settings.update(input)`。
- [ ] 21. `packages/core/src/app.ts`：在 `library` 之后构造 `const settings = factories.settings(deps);`、`const summary = factories.summary({ ...deps, llm });`；`play` 改成 `factories.play({ ...deps, llm, summary })`；`services` 加上 `settings`、`summary`；`close()` 里 `Promise.all` 加上 `summary.whenIdle()`。`main.ts` 的工厂对象加 `settings: (deps) => createSettingsService(deps)`、`summary: (deps) => createSummaryService(deps)`。
- [ ] 22. 让现有测试跟上接口：`app.test.ts`、`api/http-app.test.ts`、`app.integration.test.ts` 里构造工厂或服务的地方，补上 `settings`、`summary`（集成测试用真实的 `createSettingsService`、`createSummaryService`；单元测试的假服务里，新方法用 `throw new Error('not used')`）。`play/service.test.ts` 构造 `createPlayService` 时补 `summary: createRecordingSummary()`。只补构造参数，不改任何断言。
- [ ] 23. `apps/client/src/i18n/zh-CN/errors.json` 加两个键，文案见附录 A.2。

**接线点。**

| 新过程 | 契约 | 路由 handler | 服务方法 |
| --- | --- | --- | --- |
| `llm.endpoints.remove` | `procedures/llm.ts` | `router.ts` | `LlmService.removeEndpoint` |
| `llm.models.add` / `update` / `remove` | 同上 | 同上 | `LlmService.addModel` / `updateModel` / `removeModel` |
| `works.delete` | `procedures/works.ts` | 同上 | `LibraryService.delete` |
| `play.getJournal` | `procedures/play.ts` | 同上 | `PlayService.getJournal` |
| `settings.get` / `update` | `procedures/settings.ts` | 同上 | `SettingsService.get` / `update` |

**注意事项。**

- 不实现任何业务逻辑。占位就是占位，后续任务会替换。
- `implement(contract)` 要求路由覆盖契约里的全部过程，漏一个类型检查就会报错。这正是接线的第一道检查。
- client 的代码本任务不改（`errors.json` 除外）。契约只加不删，client 应该照常通过类型检查。如果没通过，说明某处收紧了契约，回头检查。

**完成判据。**

- `pnpm typecheck`、`pnpm lint`、`pnpm test` 全部退出码为 0。
- `pnpm --filter @unwritten/contracts test` 里本任务新增的用例全部通过。突变：把 `GenerationParamsSchema` 的 `temperature` 上限改成 `3`，`生成参数的边界` 必须红。
- `grep -rn "not implemented:" packages/core/src` 恰好列出 13 处：`llm` 7 处（`removeEndpoint`、`addModel`、`updateModel`、`removeModel`、`complete`、`testConnection.purpose`、`setPurpose`）、`library` 1 处、`play` 1 处、`settings` 2 处、`summary` 2 处。逐条和步骤 17 对照，多一处或少一处都要说明。
- 路由接线：在 `api/http-app.test.ts` 加一个用例 `设置过程已挂到路由上`：用测试里的假服务把 `settings.get` 换成返回 `DEFAULT_APPEARANCE`，照文件里已有的 `/api/works/list` 调用写法，通过 HTTP 调 `/api/settings/get`（带令牌），得到同样的对象。突变：把 `router.ts` 里 `settings.get` 的 handler 改成调用 `services.settings.update(DEFAULT_APPEARANCE)`，用例必须红（假服务的 `update` 抛错）。

### T04 存储：新表、迁移、旧数据补齐、故事类型

**目的。** 建好故事事实、摘要、全文索引、外观偏好的存储，并把 M1 留下的数据补齐到新结构能用的状态。同时定死 `story/` 模块共用的类型，让 T08、T09 能同时开工。

**依赖。** T03。

**拥有的文件。** `packages/core/src/store/schema.ts`、`store/meta.ts`、`store/db.ts`、`store/backfill.ts`、`store/prose-index.ts`、`store/migrations/` 下本任务生成的两个目录、`story/types.ts`，以及它们的测试；`app.ts` 里记录 `story.backfill` 的那几行。另外，为了让类型检查通过，允许在三个别的任务拥有的文件里**只加** `presentIds: []`（见步骤 4）。

**先读。** [数据模型 §4、§6、§8](../docs/data-model.md#4-故事事实)；[主题与 token §9](../docs/theme.md#9-外观偏好与切换)；现有的 `store/schema.ts`、`store/db.ts`、`store/meta.ts`、`store/migrations/` 下 M1 的迁移文件（看 `--> statement-breakpoint` 的写法）；`drizzle.config.ts`。

**步骤。**

- [ ] 1. `store/schema.ts` 新增六张表。从 `drizzle-orm/sqlite-core` 补充导入 `primaryKey`、`check`；从 `@unwritten/contracts` 导入 `ENTITY_KINDS`、`KNOWLEDGE_LEVELS`、`type Appearance`；从 `../story/types.ts` 导入 `FACT_KINDS`、`type EntityProfile`、`type FactData`。

  ```ts
  export const entities = sqliteTable(
    'entities',
    {
      versionId: text('version_id')
        .notNull()
        .references(() => workVersions.id, { onDelete: 'cascade' }),
      id: text('id').notNull(),
      kind: text('kind', { enum: ENTITY_KINDS }).notNull(),
      name: text('name').notNull(),
      profile: text('profile', { mode: 'json' }).$type<EntityProfile>().notNull(),
      isProtagonist: integer('is_protagonist').notNull().default(0),
      castSlot: text('cast_slot'),
      originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
      rev: integer('rev').notNull().default(0),
    },
    (table) => [
      primaryKey({ columns: [table.versionId, table.id] }),
      index('entities_origin_idx').on(table.versionId, table.originTurnId),
    ],
  );

  export const entityNames = sqliteTable(
    'entity_names',
    {
      versionId: text('version_id')
        .notNull()
        .references(() => workVersions.id, { onDelete: 'cascade' }),
      entityId: text('entity_id').notNull(),
      name: text('name').notNull(),
      holderId: text('holder_id'),
      originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
      sourcePara: integer('source_para'),
    },
    (table) => [index('entity_names_entity_idx').on(table.versionId, table.entityId)],
  );

  export const facts = sqliteTable(
    'facts',
    {
      versionId: text('version_id')
        .notNull()
        .references(() => workVersions.id, { onDelete: 'cascade' }),
      id: text('id').notNull(),
      originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
      sourcePara: integer('source_para'),
      kind: text('kind', { enum: FACT_KINDS }).notNull(),
      subjectId: text('subject_id'),
      objectId: text('object_id'),
      key: text('key'),
      statement: text('statement').notNull(),
      data: text('data', { mode: 'json' }).$type<FactData>(),
      rev: integer('rev').notNull().default(0),
    },
    (table) => [
      primaryKey({ columns: [table.versionId, table.id] }),
      index('facts_origin_idx').on(table.versionId, table.originTurnId),
    ],
  );

  export const knowledge = sqliteTable(
    'knowledge',
    {
      versionId: text('version_id')
        .notNull()
        .references(() => workVersions.id, { onDelete: 'cascade' }),
      factId: text('fact_id').notNull(),
      holderId: text('holder_id').notNull(),
      level: text('level', { enum: KNOWLEDGE_LEVELS }).notNull(),
      perceivedStatement: text('perceived_statement'),
      viaId: text('via_id'),
      originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
      sourcePara: integer('source_para'),
    },
    (table) => [index('knowledge_fact_idx').on(table.versionId, table.factId)],
  );

  export const turnSummaries = sqliteTable('turn_summaries', {
    turnId: text('turn_id')
      .primaryKey()
      .references(() => turns.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  });

  export const appSettings = sqliteTable(
    'app_settings',
    {
      id: integer('id').primaryKey(),
      appearance: text('appearance', { mode: 'json' }).$type<Appearance>().notNull(),
      updatedAt: integer('updated_at').notNull(),
    },
    (table) => [check('app_settings_single_row', sql`${table.id} = 1`)],
  );
  ```

  列名和含义以[数据模型 §4、§6](../docs/data-model.md#4-故事事实)为准。`entities.profile` 在设计里是 JSON 档案，本里程碑只存 `{ "text": "<一句话档案>" }`。
- [ ] 2. `story/types.ts`（新建）。照抄下面的内容，这是 T08、T09、T10、T11 共用的契约：

  ```ts
  import { z } from 'zod';
  import { EntityKindSchema, KnowledgeLevelSchema, type EntityKind, type KnowledgeLevel } from '@unwritten/contracts';
  import type { StoredAction, StoredScene } from '../store/meta.ts';

  export const FACT_KINDS = ['event', 'trait', 'relation', 'promise'] as const;
  export const FactKindSchema = z.enum(FACT_KINDS);
  export type FactKind = z.infer<typeof FactKindSchema>;

  export const RELATION_STAGES = ['heard_of', 'met', 'familiar'] as const;
  export const PROMISE_STATUSES = ['agreed', 'kept', 'broken'] as const;

  export const PROTAGONIST_FALLBACK_NAME = '主角';

  export const STORY_LIMITS = {
    changesLinesMax: 40,
    nameMax: 40,
    profileMax: 300,
    statementMax: 200,
    keyMax: 40,
    relationTypeMax: 40,
    perceivedMax: 200,
    placeMax: 100,
    timeMax: 100,
    presentMax: 20,
    witnessesMax: 20,
    relationStrengthMin: -100,
    relationStrengthMax: 100,
    indexProfileChars: 30,
    sceneProfileChars: 40,
    toolResultMaxChars: 4_000,
    catalogPageSize: 30,
    searchMaxHits: 10,
    searchContextChars: 60,
    recentEventsPerEntity: 10,
    nameMinLengthForLeakCheck: 2,
  } as const;

  export const EntityProfileSchema = z.object({ text: z.string() });
  export type EntityProfile = z.infer<typeof EntityProfileSchema>;

  export const FactDataSchema = z.record(z.string(), z.union([z.string(), z.number()]));
  export type FactData = z.infer<typeof FactDataSchema>;

  export const EntityRefSchema = z.union([
    z.object({ existing: z.string().min(1) }),
    z.object({ created: z.number().int().positive() }),
  ]);
  export type EntityRef = z.infer<typeof EntityRefSchema>;

  export const FactRefSchema = z.union([
    z.object({ existing: z.string().min(1) }),
    z.object({ line: z.number().int().positive() }),
  ]);
  export type FactRef = z.infer<typeof FactRefSchema>;

  export const NewEntityChangeSchema = z.object({
    line: z.number().int().positive(),
    kind: EntityKindSchema,
    name: z.string().min(1),
    knownAs: z.string().min(1).nullable(),
    profile: z.string(),
    para: z.number().int().positive(),
    protagonist: z.boolean(),
  });

  export const NameChangeSchema = z.object({
    line: z.number().int().positive(),
    entity: EntityRefSchema,
    name: z.string().min(1),
    holder: EntityRefSchema,
    para: z.number().int().positive(),
  });

  export const FactChangeSchema = z.object({
    line: z.number().int().positive(),
    kind: FactKindSchema,
    subject: EntityRefSchema.nullable(),
    object: EntityRefSchema.nullable(),
    key: z.string().min(1).nullable(),
    statement: z.string().min(1),
    data: FactDataSchema.nullable(),
    para: z.number().int().positive(),
    witnesses: z.array(EntityRefSchema),
  });

  export const KnowledgeChangeSchema = z.object({
    line: z.number().int().positive(),
    fact: FactRefSchema,
    holder: EntityRefSchema,
    level: KnowledgeLevelSchema,
    perceived: z.string().min(1).nullable(),
    via: EntityRefSchema.nullable(),
    para: z.number().int().positive(),
  });

  export const SceneChangeSchema = z.object({
    place: z.string().min(1),
    time: z.string().min(1),
    present: z.array(EntityRefSchema),
  });

  export const ValidatedChangesSchema = z.object({
    entities: z.array(NewEntityChangeSchema),
    names: z.array(NameChangeSchema),
    facts: z.array(FactChangeSchema),
    knowledge: z.array(KnowledgeChangeSchema),
    scene: SceneChangeSchema.nullable(),
  });
  export type ValidatedChanges = z.infer<typeof ValidatedChangesSchema>;
  export type NewEntityChange = z.infer<typeof NewEntityChangeSchema>;
  export type NameChange = z.infer<typeof NameChangeSchema>;
  export type FactChange = z.infer<typeof FactChangeSchema>;
  export type KnowledgeChange = z.infer<typeof KnowledgeChangeSchema>;
  export type SceneChange = z.infer<typeof SceneChangeSchema>;

  export const EMPTY_CHANGES: ValidatedChanges = { entities: [], names: [], facts: [], knowledge: [], scene: null };

  export interface ProjEntity {
    id: string;
    kind: EntityKind;
    name: string;
    profile: string;
    isProtagonist: boolean;
    originTurnId: string | null;
    originDepth: number;
  }

  export interface ProjName {
    entityId: string;
    name: string;
    holderId: string | null;
    depth: number;
    turnId: string | null;
    para: number | null;
    seq: number;
  }

  export interface ProjFact {
    id: string;
    kind: FactKind;
    subjectId: string | null;
    objectId: string | null;
    key: string | null;
    statement: string;
    data: FactData | null;
    depth: number;
    turnId: string | null;
    para: number | null;
  }

  export interface ProjKnowledge {
    factId: string;
    holderId: string;
    level: KnowledgeLevel;
    perceived: string | null;
    viaId: string | null;
    depth: number;
    turnId: string | null;
    para: number | null;
  }

  export interface ChainTurn {
    id: string;
    depth: number;
    action: StoredAction | null;
    paragraphs: string[];
    scene: StoredScene;
  }

  export interface StoryProjection {
    versionId: string;
    headTurnId: string;
    protagonistId: string;
    chain: ChainTurn[];
    entities: Map<string, ProjEntity>;
    names: ProjName[];
    facts: ProjFact[];
    knowledge: ProjKnowledge[];
    summaries: Map<string, string>;
  }
  ```

  约定（写进 T08、T09 的实现，这里先定死）：
  - `EntityRef` 的 `created` 是本次 `changes` 里 `new_entity` 那一行的行号；`existing` 是实体的真实 id。`FactRef` 的 `line` 是本次 `changes` 里事实那一行的行号。
  - 作者设定的行（`origin_turn_id` 为空）在投影里 `depth = -1`。
  - `ProjName.seq` 是 SQLite 的 `rowid`，同一深度有多条称呼时，`seq` 大的是后写的。
  - `facts` 和 `knowledge` 是已经按覆盖规则取过最新值的结果；`event` 没有覆盖，全部保留。
- [ ] 3. `store/meta.ts`：
  - `StoredSceneSchema` 加 `presentIds: z.array(z.string()).default([])`。`present` 仍是这一回合结束时在场者真名的快照，`presentIds` 是对应的实体 id；M1 的旧回合没有 `presentIds`，读出来是空数组。
  - `VersionMetaSchema` 的 `opening` 对象加 `changes: ValidatedChangesSchema.optional()`。
  - `PreviewJobResultSchema` 加 `changes: ValidatedChangesSchema.optional()`。
  - `TurnRequestLogSchema` 的元素对象加 `args: z.record(z.string(), z.string()).optional()` 和 `records: z.array(z.string()).optional()`。
- [ ] 4. 步骤 3 让 `StoredScene` 多了一个必填字段，下面三处会报类型错误。在这三处只加 `presentIds: []`，别的不动：
  - `play/propose-turn-tool.ts` 的 `sceneFrom` 返回值；
  - `play/service.ts` 里 `parentScene` 的默认值 `{ place: '', time: '', present: [] }`；
  - `authoring/service.ts` 里 `scene: { ...preview.scene, present: [] }`。
  用 `grep -rn "present: \[\]" packages/core/src` 核对还有没有别处。
- [ ] 5. 生成迁移。在 `packages/core` 目录里：
  1. `pnpm exec drizzle-kit generate --name story_tables`。检查生成的 `migration.sql` 只包含六张新表和它们的普通索引，没有改动旧表。
  2. `pnpm exec drizzle-kit generate --custom --name story_indexes_fts`，得到一个空的 `migration.sql`。写入下面的内容（语句之间的分隔行照抄）：

     ```sql
     CREATE UNIQUE INDEX `entity_names_unique` ON `entity_names` (`version_id`, `entity_id`, `name`, ifnull(`holder_id`, ''), ifnull(`origin_turn_id`, ''));
     --> statement-breakpoint
     CREATE UNIQUE INDEX `facts_keyed_unique` ON `facts` (`version_id`, `kind`, ifnull(`subject_id`, ''), ifnull(`object_id`, ''), `key`, ifnull(`origin_turn_id`, '')) WHERE `key` IS NOT NULL;
     --> statement-breakpoint
     CREATE UNIQUE INDEX `knowledge_unique` ON `knowledge` (`version_id`, `fact_id`, `holder_id`, ifnull(`origin_turn_id`, ''));
     --> statement-breakpoint
     CREATE UNIQUE INDEX `entities_one_protagonist` ON `entities` (`version_id`) WHERE `is_protagonist` = 1;
     --> statement-breakpoint
     CREATE VIRTUAL TABLE `prose_fts` USING fts5(`turn_id` UNINDEXED, `para` UNINDEXED, `body`, tokenize = 'trigram');
     --> statement-breakpoint
     CREATE TRIGGER `turns_delete_fts` AFTER DELETE ON `turns` BEGIN DELETE FROM `prose_fts` WHERE `turn_id` = old.`id`; END;
     ```

     表达式唯一索引写在自定义迁移里，是因为 SQLite 把 `NULL` 当作互不相同，必须用 `ifnull` 归一（[数据模型 §4](../docs/data-model.md#4-故事事实)）；FTS5 虚表和触发器 drizzle 的 schema 写不出来。
  3. 两个迁移目录的名字由 drizzle-kit 加时间戳前缀，按生成顺序排在 M1 的迁移之后。不要手改生成部分。
- [ ] 6. `store/prose-index.ts`（新建）：

  ```ts
  import { sql } from 'drizzle-orm';
  import type { Database } from './db.ts';
  import { splitParagraphs } from '../text/turn-text.ts';

  export function indexTurnProse(db: Pick<Database, 'run'>, turnId: string, prose: string): number {
    const paragraphs = splitParagraphs(prose);
    paragraphs.forEach((body, index) => {
      db.run(sql`insert into prose_fts (turn_id, para, body) values (${turnId}, ${index + 1}, ${body})`);
    });
    return paragraphs.length;
  }
  ```

  参数类型写成 `Pick<Database, 'run'>`，是为了既能传 `db`，也能传事务里的 `tx`。如果 drizzle 的事务对象类型和 `Database` 的 `run` 签名不兼容，改用两者共有的最小类型，并在汇报里说明。
- [ ] 7. `store/backfill.ts`（新建）：

  ```ts
  export interface BackfillResult {
    protagonists: number;
    ftsTurns: number;
  }

  export function backfillStory(db: Database): BackfillResult;
  ```

  在一个 `{ behavior: 'immediate' }` 事务里做两件事：
  1. **补主角。** 只补已经开局的版本（有开局才有路线要续写；还没采用开场的草稿由采用时写入主角，这里补了反而会和采用时写的主角撞唯一索引）。查询：`select v.id as version_id, v.work_id from work_versions v where exists (select 1 from playthroughs t where t.version_id = v.id) and not exists (select 1 from entities e where e.version_id = v.id and e.is_protagonist = 1)`。按 `work_id` 分组，每组生成一个 `randomUUID()`，组内每个版本都插入同一个 id 的主角：`kind = 'character'`、`name = PROTAGONIST_FALLBACK_NAME`、`profile = { text: '' }`、`isProtagonist = 1`、`originTurnId = null`。同时为每个版本插入一条称呼：`entityId = 主角 id`、`name = PROTAGONIST_FALLBACK_NAME`、`holderId = 主角 id`、`originTurnId = null`、`sourcePara = null`。同一部作品的各版本用同一个 id，和 D5 的约定一致（M1 每部作品只有一个发布版本有开局，所以实际每组一个版本）。
  2. **补全文索引。** 查出没有任何索引行的回合：`select id, prose from turns where id not in (select distinct turn_id from prose_fts)`，逐个调用 `indexTurnProse`。
  返回两项各补了几个（主角按版本计数，索引按回合计数）。数据已经齐全时返回两个 0。
- [ ] 8. `store/db.ts`：`OpenedDatabase` 加 `backfill: BackfillResult`；`migrate(...)` 之后调用 `backfillStory(db)`，把结果放进返回值。补齐抛错时和迁移失败同样处理（关连接、抛出）。
- [ ] 9. `app.ts`：在记录 `store.migrated` 之后加一条事件：`logger.record({ level: 'info', module: 'core', event: 'story.backfill', data: opened.backfill })`。
- [ ] 10. 测试。`store/db.test.ts` 补用例（测试名照抄）：
  - `新迁移建出故事表和全文索引`：打开临时库，`select name from sqlite_master` 包含 `entities`、`entity_names`、`facts`、`knowledge`、`turn_summaries`、`app_settings`、`prose_fts`、`turns_delete_fts`（字面量）。
  - `称呼的唯一索引把空持有者视为同一个`：同一实体、同一名字、`holder_id` 都为 `NULL`、`origin_turn_id` 都为 `NULL` 插两次，第二次抛错。阳性对照：换一个非空的 `holder_id` 能插入。
  - `每个版本只能有一个主角`：同一版本插两个 `is_protagonist = 1` 的实体，第二次抛错；`is_protagonist = 0` 的第二个实体能插入。
  - `删除回合时清掉它的全文索引行`：建一个回合、写入索引、删除回合，`prose_fts` 里查不到这个 `turn_id`。阳性对照：删除前能查到。
  - `trigram 检索中文`：索引一段含“灯塔守夜人”的正文，`prose_fts match '守夜人'` 命中。
  新建 `store/backfill.test.ts`：
  - `为 M1 留下的作品补主角和全文索引`：用 drizzle 直接插入一部 M1 形状的作品（作品、草稿、发布版本、开局、根回合、一个续写回合，正文用附录 D），**不经过新代码**。关库后用 `openDatabase` 重新打开。另插入一部只有草稿、没有开局的作品。断言：`backfill.protagonists` 等于 1；有开局的发布版本有一个主角，名字是 `主角`，并有一条主角自己持有的称呼；两部作品的草稿都没有主角；两个回合都能被 `prose_fts` 查到；`backfill.ftsTurns` 等于 2。
  - `补齐可以重复执行`：再关、再开一次，`backfill` 两项都是 0，主角仍然只有一个。
- [ ] 11. `story/types.test.ts`（新建）：`ValidatedChanges 能往返 JSON`：构造一个每个数组各含一项的对象，`ValidatedChangesSchema.parse(JSON.parse(JSON.stringify(x)))` 与原对象深相等。

**注意事项。**

- 不建 `state_defs`、`state_values`（§1.4）。
- `profile`、`data` 是 JSON 列，写入前用 `EntityProfileSchema`、`FactDataSchema` 校验（core 规范“读的时候校验什么，写的时候就校验什么”）。
- 补齐在 `openDatabase` 里同步执行。M1 的数据量很小，不需要分批。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过，本任务的用例全部在列。
- 突变一：把 `backfill.ts` 补索引查询里的 `where id not in (...)` 删掉，`补齐可以重复执行` 必须红（第二次会重复写索引；如果它没红，说明断言没查索引行数，补上 `select count(*) from prose_fts` 的字面断言）。
- 突变二：把自定义迁移里 `entity_names_unique` 的 `ifnull(\`holder_id\`, '')` 改成 `\`holder_id\``，`称呼的唯一索引把空持有者视为同一个` 必须红。注意：改迁移文件后要删掉测试用的临时库重跑，迁移只在新库上执行。
- 突变三：把补主角查询里的 `exists (select 1 from playthroughs ...)` 条件删掉，`为 M1 留下的作品补主角和全文索引` 必须红（草稿被补上了主角）。
- `pnpm --filter @unwritten/core build` 成功，`ls packages/core/dist/migrations` 列出本任务的两个新目录。这一条证明迁移会被打进产物（`tsdown.config.ts` 按目录整体复制）。

### T05 llm：生成参数、思考写法、多模型端点、complete()

**目的。** 让每个用途带着自己的模型和生成参数调用模型，并按模型的思考写法把“思考”正确地发给服务端（D2、D3、D4）；一个端点可以有多个模型；提供不带工具的 `complete()` 给后台摘要用。

**依赖。** T03。

**拥有的文件。** `packages/core/src/llm/` 下的 `params.ts`（新建）、`providers-schema.ts`、`service.ts`、`pi.ts`、`run.ts`、`test-connection.ts` 及它们的测试；`test-support/fake-openai-server.ts`、`test-support/llm-steps.ts`。

**先读。** [LLM 端点 §2、§6、§7、§8、§10](../docs/llm-endpoints.md#2-providersjson)（T00 改过的版本）；现有的 `llm/` 全部文件；pi-ai 的类型声明：`node_modules/@earendil-works/pi-ai/dist/types.d.ts` 里的 `SimpleStreamOptions`、`StreamOptions`，`dist/providers/compat-schema.d.ts` 里的 `OpenAICompletionsCompatSchema`，`dist/api/openai-completions.js` 里按 `thinkingFormat` 分支的那一段（搜 `compat.thinkingFormat ===`）。

**规划时核实过的 pi-ai 1.6 事实（动手前再核一遍，按符号名找）：**

| 事实 | 在哪里 |
| --- | --- |
| `streamSimple` / `completeSimple` 接受 `reasoning`、`thinkingBudgets`、`temperature`、`samplingParams`；`complete` 不接受 `reasoning` | `dist/types.d.ts` 的 `SimpleStreamOptions`；`dist/models.d.ts` |
| 模型的 `reasoning` 为 `false` 时，任何思考字段都不发 | `dist/api/openai-completions.js`，每个分支都带 `&& model.reasoning` |
| `reasoning` 为 `undefined`（即关闭）时：`openai` 写法只有在 `thinkingLevelMap.off` 是字符串时才发 `reasoning_effort` | 同上，`offValue` 那一段 |
| `xhigh`、`max` 只有在 `thinkingLevelMap` 里有映射时才被支持，否则被压到 `high` | `dist/models.js` 的 `getSupportedThinkingLevels` |
| 预算只有在 `compat.thinkingTokenBudgetField` 设了值时才作为顶层字段发出；可选值是 `thinking_budget`、`thinking_budget_tokens`、`thinking_token_budget` | `dist/providers/compat-schema.d.ts` |
| `samplingParams` 原样合并进请求体，最后合并，所以会覆盖同名字段 | `openai-completions.js` 的 `resolveSamplingParams` |
| pi-agent-core 的 `Agent` 把 `thinkingLevel === 'off'` 转成 `reasoning: undefined` | `pi-agent-core/dist/agent.js` |

**步骤。**

- [ ] 1. `providers-schema.ts`：`PurposeRefSchema` 加一个可选字段：

  ```ts
  params: z
    .object({
      thinking: ThinkingLevelSchema.optional(),
      thinkingBudget: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().gt(0).max(1).optional(),
      topK: z.number().int().positive().optional(),
      minP: z.number().min(0).max(1).optional(),
    })
    .optional(),
  ```

  文件里“没设置”就是不写这个键；接口视图里“没设置”是 `null`。`version` 仍是 1：这是向后兼容的新增字段，旧版 core 读到会忽略它。
- [ ] 2. `llm/params.ts`（新建），只依赖 contracts 和 `providers-schema.ts`，不导入 pi-ai：

  ```ts
  import type { GenerationParams, ThinkingFormat, ErrorCode } from '@unwritten/contracts';
  import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
  import type { ProvidersFile } from './providers-schema.ts';

  export type FileParams = NonNullable<NonNullable<ProvidersFile['purposes']['default']>['params']>;

  export function paramsFromFile(params: FileParams | undefined): GenerationParams;
  export function paramsToFile(params: GenerationParams): FileParams | undefined;
  export function paramsProblem(
    params: GenerationParams,
    model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat },
  ): ErrorCode | null;
  export function sanitizeParams(
    params: GenerationParams,
    model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat },
  ): GenerationParams;
  ```

  - `paramsFromFile`：缺的键转成 `null`；`undefined` 转成 `EMPTY_GENERATION_PARAMS` 的副本。
  - `paramsToFile`：值为 `null` 的键不写；全部为 `null` 时返回 `undefined`（文件里就不出现 `params`）。
  - `paramsProblem` 返回 `'thinking_unsupported'` 的两种情况，其余返回 `null`：
    1. `model.reasoning === false` 且 `params.thinking` 不是 `null` 也不是 `'off'`；
    2. `params.thinkingBudget !== null`，并且满足任一条：`model.thinkingFormat !== 'qwen'`、`params.thinking === null`、`params.thinking === 'off'`。
  - `sanitizeParams`：模型条件变了以后，把不再成立的参数清掉，用于模型能力被修改之后：第 1 种情况把 `thinking` 设为 `null`；第 2 种情况把 `thinkingBudget` 设为 `null`。其余原样返回。
- [ ] 3. `llm/service.ts` 的读侧：
  - `foundModel` 不变。`resolvedFor(state, purpose)` 改成返回 `{ endpoint, model, params: GenerationParams } | null`：用途自己的引用存在时用它和它的 `params`；`narrator`、`author_chat`、`background` 没有自己的引用时回落到 `default` 的引用和 `default` 的 `params`。其余判断（`api` 必须是 `openai-completions`、`narrator` 和 `author_chat` 的模型 `tools` 不能是 `false`）不变。
  - 新增 `purposeViews(state): PurposeView[]`，按 `PURPOSES` 的顺序（`default`、`narrator`、`background`）各给一个视图，字段含义见 T03 步骤 4。`problem` 的判定顺序：用途和 `default` 都没有引用 → `not_configured`；实际使用的引用指向的端点或模型不存在 → `model_missing`；用途是 `narrator` 且模型 `tools === false` → `no_tools`；否则 `null`。`default` 用途自己不回落，`inherited` 恒为 `false`。
  - `view()` 的 `ok` 分支把 T03 写的 `purposes: []` 换成 `purposes: purposeViews(state)`。非 `ok` 分支保持空数组。
  - `targetFor(purpose)` 返回的 `RuntimeTarget` 加两个字段：`thinkingFormat: found.model.thinkingFormat ?? 'auto'`、`params: found.params`。
- [ ] 4. `llm/service.ts` 的写侧。每个写操作都照现有写法：`store.enqueue(() => { ... })`，先 `ensureWritable`，算出目标状态；目标状态已经生效就直接返回当前视图（幂等）；否则核对 `baseRevision`（不一致抛 `config_conflict`），`structuredClone` 后修改，`writeConfig`。
  - `setPurpose(input)`：
    - `input.model === null`：删除这个用途的引用（`default` 也可以删）。
    - 否则：`foundModel` 找不到抛 `endpoint_not_found`；`paramsProblem(input.params, 模型)` 不为 `null` 时抛 `appError('thinking_unsupported', ...)`；写入 `{ provider: endpointId, model: modelId, params: paramsToFile(input.params) }`，`params` 为 `undefined` 时不写这个键。
    - 幂等判断：引用的端点、模型和 `paramsFromFile(现有 params)` 都与输入相同。
  - `addModel(input)`：端点不存在抛 `endpoint_not_found`；同 id 的模型已存在时直接返回当前视图（幂等）；否则在 `models` 末尾加 `{ id: modelId }`。
  - `updateModel(input)`：端点或模型不存在抛 `endpoint_not_found`。`reasoning` 为 `null` 时删掉这个键，否则写入；`thinkingFormat` 为 `'auto'` 时删掉这个键，否则写入。然后遍历四个用途的引用，凡是指向这个模型的，用 `sanitizeParams` 清理它的 `params`。
  - `removeModel(input)`：端点或模型不存在时直接返回当前视图（幂等）；端点只剩这一个模型时抛 `last_model`；否则删掉模型，并删除四个用途里指向它的引用。
  - `removeEndpoint(input)`：端点不存在时直接返回当前视图；否则删掉端点，并删除四个用途里指向它的引用。
  - `updateEndpoint(input)`：`input.modelId` 为 `undefined` 时只改名称和 key；有值时保持 M1 的行为（改第一个模型的 id 并更新引用）。T16 会删掉 `modelId`。
  - 四个用途里的 `author_chat` 界面上不显示，但删除模型、删除端点、清理参数时一样要处理它，否则会留下指向不存在模型的引用。
- [ ] 5. `llm/pi.ts`：
  - `RuntimeTarget` 加 `thinkingFormat: ThinkingFormat` 和 `params: GenerationParams`（类型从 contracts 导入）。
  - 新增一个模块内函数，把思考写法映射成 pi-ai 的 compat 字段：

    | `thinkingFormat` | 合进 `compat` 的字段 |
    | --- | --- |
    | `auto` | 不加任何字段，交给 pi-ai 的自动识别 |
    | `openai` | `thinkingFormat: 'openai'`、`supportsReasoningEffort: true` |
    | `qwen` | `thinkingFormat: 'qwen'`、`supportsReasoningEffort: false`、`thinkingTokenBudgetField: 'thinking_budget'` |
    | `qwen-chat-template` | `thinkingFormat: 'qwen-chat-template'`、`supportsReasoningEffort: false` |
    | `deepseek` | `thinkingFormat: 'deepseek'`、`supportsReasoningEffort: false` |
    | `openrouter` | `thinkingFormat: 'openrouter'` |
    | `zai` | `thinkingFormat: 'zai'`、`supportsReasoningEffort: false` |

  - `build(target)` 里：
    - `const thinkingSet = target.params.thinking !== null;`
    - `model.reasoning = thinkingSet;`
    - `thinkingSet` 时 `model.thinkingLevelMap = { off: 'none', xhigh: 'xhigh', max: 'max' }`，否则不设。`off: 'none'` 让 `openai` 和 `openrouter` 写法在关闭时明确发出 `none`；`xhigh`、`max` 的映射让这两档不被压到 `high`。
    - `compat` 在 M1 的三项（`supportsStore: false`、`supportsDeveloperRole: false`、`maxTokensField: 'max_tokens'`）之后合并上表的字段。删掉 M1 写死的 `supportsReasoningEffort: false`：没设档位时 `model.reasoning` 为 `false`，什么都不会发。
  - 新增一个模块内函数 `requestOptions(params: GenerationParams)`，返回要合进 pi-ai 请求选项的对象，只包含非 `null` 的项：
    - `reasoning`：`params.thinking` 不是 `null` 也不是 `'off'` 时取它的值；
    - `thinkingBudgets`：`params.thinkingBudget` 不为 `null` 时，`{ minimal: b, low: b, medium: b, high: b }`（四档写同一个值，pi-ai 会按档位取）；
    - `temperature`；
    - `samplingParams`：`{ top_p, top_k, min_p }` 里非 `null` 的项，一项都没有时不设这个键。
  - `createAgentSession`：`initialState.thinkingLevel` 用 `target.params.thinking ?? 'off'`；`streamFn` 里把 `requestOptions(target.params)` 合进去（放在 `...options` 之后、`fetch` 之前）。
  - `completeOnce` 改用 `models.completeSimple`（`complete` 不接受 `reasoning`），选项里同样合进 `requestOptions(target.params)`。`CompletionOutcome` 加 `text: string`：取最后一条助手消息里全部 `type === 'text'` 的片段，按顺序拼接；没有时为空字符串。
- [ ] 6. `llm/run.ts`：
  - `llm.call` 事件的 `data` 加 `thinking: target.params.thinking`。
  - 新增 `createCompleter(deps): (input: LlmCompleteInput) => Promise<LlmCompleteResult>`，行为照 `createRunner`：
    - 找不到目标抛 `llm_not_configured`；
    - 每次尝试新建 `AbortController`，合并 `deps.shutdown` 和 `input.signal`；`timeouts.firstOutputMs` 到时中止并记为超时（`completeSimple` 不是流式回调，所以用整体时限）；
    - 调用 `completeOnce(target, transport, { system, user: input.prompt, tools: [], maxTokens: input.maxOutputTokens })`；
    - 失败按 `classifyFailure` 分类；成功但 `text.trim()` 为空记为 `invalid_output`；
    - 每次尝试写一行 `llm_calls`（字段照 `attemptOnce`），记 `llm.call` 事件；
    - `RETRYABLE` 里的错误、且没收到输出时重试一次，`rate_limited` 先等 `RATE_LIMIT_RETRY_DELAY_MS`；
    - 返回 `{ text: outcome.text.trim() }`。
  - `service.ts` 里把 T03 的 `complete` 占位换成 `createCompleter(...)` 的结果。
- [ ] 7. `llm/test-connection.ts`：参数类型改回联合 `TestConnectionInput`。
  - 草稿形状：保持现状，`target` 加 `thinkingFormat: 'auto'`、`params: EMPTY_GENERATION_PARAMS`。
  - 用途形状：`deps` 加一个 `targetFor(purpose)`（由 `service.ts` 传入同一个函数）；找不到目标时返回 `{ ok: false, code: 'llm_not_configured', detail: null, savedToolsCapability: false }`；找到时用它的目标（带思考写法和参数）发同样的 `ping` 请求，结果处理同草稿形状，`savedToolsCapability` 固定为 `false`。
  - `service.ts` 的 `testConnection` 去掉 T03 的占位分支，直接调用 `tester(input)`。
- [ ] 8. `test-support/fake-openai-server.ts`：`FakeStep` 加一种：

  ```ts
  | { kind: 'thinking_then_tool_call'; thinking: string; chunkDelayMs: number; name: string; arguments: string }
  ```

  流式响应先按 20 个字符一段发 `delta: { reasoning_content: <片段> }`，每段之间等 `chunkDelayMs`，然后照 `sendToolCall` 的流式写法发工具调用。`llm-steps.ts` 加帮助函数 `thinkingToolStep(name, args, thinking, chunkDelayMs)`。
- [ ] 9. 测试。`llm/params.test.ts`（新建）：
  - `文件与视图互转`：`paramsToFile(全 null)` 为 `undefined`；`paramsFromFile(undefined)` 全为 `null`；一个只设了 `topK: 40` 的视图转成文件是 `{ topK: 40 }`（字面量）。
  - `思考参数的拒绝条件`：表驱动，至少覆盖：能力为否 + `high` → 拒绝；能力为否 + `off` → 通过；能力未知 + `high` → 通过；`qwen` + `medium` + 预算 → 通过；`openai` + `medium` + 预算 → 拒绝；`qwen` + `off` + 预算 → 拒绝；`qwen` + 未设档位 + 预算 → 拒绝。期望结果写字面量 `'thinking_unsupported'` 或 `null`。
  `llm/service.test.ts` 补用例：
  - `用途视图回落到默认`：只设了 `default`，`narrator` 视图的 `inherited` 为 `true`，`effectiveModel` 等于默认模型，`problem` 为 `null`。阳性对照：`default` 视图的 `inherited` 为 `false`。
  - `给不支持思考的模型设档位被拒绝`：模型 `reasoning: false`，`setPurpose` 带 `thinking: 'high'` 抛 `thinking_unsupported`，文件内容不变（重新读文件比较）。
  - `删除最后一个模型被拒绝，删除其他模型清掉引用`：一个端点两个模型，`narrator` 指向第二个；删第二个后 `narrator` 视图 `model` 为 `null`；再删第一个抛 `last_model`。
  - `把模型改成不支持思考时清掉用途里的思考档位`：`narrator` 设了 `high`，`updateModel` 把 `reasoning` 改为 `false` 后，`narrator` 视图的 `params.thinking` 为 `null`，`temperature` 保持原值（阳性对照）。
  `llm/run.test.ts` 补用例，全部用伪 OpenAI 服务，断言伪服务记录的 `requests.at(-1).body`：
  - `openai 写法按档位发 reasoning_effort`：`thinking: 'high'`、`temperature: 0.7`、`topK: 40` → 请求体 `reasoning_effort === 'high'`、`temperature === 0.7`、`top_k === 40`，没有 `enable_thinking` 键。
  - `openai 写法的关闭发 none`：`thinking: 'off'` → `reasoning_effort === 'none'`。
  - `xhigh 不被压低`：`openai` 写法、`thinking: 'xhigh'` → `reasoning_effort === 'xhigh'`。
  - `qwen 写法发 enable_thinking 和预算`：`thinking: 'medium'`、`thinkingBudget: 2048` → `enable_thinking === true`、`thinking_budget === 2048`，没有 `reasoning_effort` 键。
  - `qwen 写法的关闭`：`thinking: 'off'` → `enable_thinking === false`。
  - `qwen-chat-template 写法`：`thinking: 'low'` → `chat_template_kwargs.enable_thinking === true`。
  - `没设档位时不带任何思考字段`：只设 `temperature: 0.5` → 请求体里没有 `reasoning_effort`、`enable_thinking`、`chat_template_kwargs`、`thinking`、`reasoning` 这五个键；阳性对照：同一个请求体里 `temperature === 0.5`。
  - `思考输出也算模型有输出`：`stallMs: 300`，伪服务用 `thinking_then_tool_call`，思考分 10 段、每段间隔 100 毫秒，然后调用必调工具；`run()` 成功，不超时。阳性对照：同样设置下，伪服务用 `hang` 步骤时以 `timeout` 失败。
  - `complete 返回文本并写调用记录`：伪服务返回 `text` 步骤“灯塔亮到天明。”，`complete()` 返回这段文字；`llm_calls` 多一行，`ref_kind` 为 `'turn'`。
  - `complete 收到空文本按无效输出处理`：伪服务返回空文本，抛 `LlmRunError`，`code === 'invalid_output'`。
  `llm/test-connection.test.ts` 补：`按用途测试时带上用途的参数`：`narrator` 设了 `thinking: 'high'`（`openai` 写法），按用途测试后，伪服务收到的请求体 `reasoning_effort === 'high'`。

**注意事项。**

- `llm/pi.ts` 仍是唯一导入 pi-ai 的文件。`params.ts` 不导入 pi-ai。
- 请求体断言里的字段名（`reasoning_effort`、`enable_thinking`、`thinking_budget`、`chat_template_kwargs`、`top_k`）一律写字面量，不从实现里取（§2.7 第 2 条）。
- 如果某个写法的实际请求体和上表不一致（例如 pi-ai 的行为和规划时核实的不同），不要改测试去迁就实现，按 §0.3 汇报。
- 写 `llm_calls` 和发事件都在调用结束后，不阻塞调用本身。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过，上面列出的用例全部在列。
- 突变一：把 `pi.ts` 里 `thinkingLevelMap` 的 `xhigh: 'xhigh'` 删掉，`xhigh 不被压低` 必须红。
- 突变二：把 `off: 'none'` 删掉，`openai 写法的关闭发 none` 必须红。
- 突变三：把 `qwen` 那一行的 `thinkingTokenBudgetField` 删掉，`qwen 写法发 enable_thinking 和预算` 必须红。
- 突变四：把 `build()` 里的 `model.reasoning = thinkingSet` 改成 `model.reasoning = true`，`没设档位时不带任何思考字段` 必须红。
- 突变五：把 `paramsProblem` 第 1 种情况的 `=== false` 改成 `!== true`，`思考参数的拒绝条件` 里“能力未知 + high → 通过”那一条必须红。
- 突变六：把 `removeModel` 里清理用途引用的那段删掉，`删除最后一个模型被拒绝，删除其他模型清掉引用` 必须红。
- `grep -rn "not implemented: llm" packages/core/src` 零命中（含 T03 加在 `setPurpose` 开头的那一行：步骤 4 重写 `setPurpose` 时删掉它）。

### T06 core：外观偏好与删除作品

**目的。** 外观与阅读偏好存进 core，`index.html` 首屏就带上用户的偏好，多个标签页通过 `settings.changed` 同步（[主题与 token §9](../docs/theme.md#9-外观偏好与切换)）。删除作品按[数据模型 §8](../docs/data-model.md#8-删除) 级联清掉全部数据（A3）。

**依赖。** T04（`app_settings` 表）。

**拥有的文件。** `packages/core/src/settings/service.ts` 及测试、`library/service.ts` 的 `delete` 及测试、`api/http-app.ts` 渲染首页的那一行及测试。

**先读。** [主题与 token §9](../docs/theme.md#9-外观偏好与切换)；[数据模型 §8](../docs/data-model.md#8-删除)；现有的 `api/http-app.ts`、`api/client-assets.ts`、`library/service.ts`。

**步骤。**

- [ ] 1. `settings/service.ts`，替换 T03 的占位：
  - `get()`：读 `app_settings` 里 `id = 1` 的行。没有行，或者 `AppearanceSchema.safeParse(row.appearance)` 不成功，都返回 `{ ...DEFAULT_APPEARANCE }`。
  - `update(input)`：
    1. `const startedAt = performance.now();`，`const next = AppearanceSchema.parse(input);`
    2. `const current = get();` 四个字段都相同时：记 `settings.update` 样本（`outcome: 'ok'`），返回 `current`，**不发事件**。
    3. 否则在一个事务里写入：`insert ... values({ id: 1, appearance: next, updatedAt: Date.now() }).onConflictDoUpdate({ target: appSettings.id, set: { appearance: next, updatedAt: Date.now() } })`。
    4. 事务提交后：`deps.bus.publish({ type: 'settings.changed', appearance: next })`；记事件 `settings.changed`（`module: 'settings'`，`data` 放四个枚举字段）；记 `settings.update` 样本。
    5. 返回 `next`。
    6. 写入抛错时记 `settings.update` 样本（`outcome: 'error'`），抛 `appError('save', 'settings write failed')`。
- [ ] 2. `api/http-app.ts`：首页渲染那一行的 `DEFAULT_APPEARANCE` 换成 `options.services.settings.get()`。去掉不再使用的 `DEFAULT_APPEARANCE` 导入。
- [ ] 3. `library/service.ts` 的 `delete(input)`，替换占位：
  1. 一个 `{ behavior: 'immediate' }` 事务里 `delete from works where id = input.workId`，取 `changes`。
  2. `changes === 0`：返回 `{}`，不发事件（幂等：重复删除同一个作品不报错）。
  3. 提交后：`deps.bus.publish({ type: 'works.changed', workId: input.workId })`；记事件 `work.deleted`（`module: 'library'`，`workId` 放关联 ID）。
  4. 返回 `{}`。
  外键会级联删掉版本、开局、回合、路线、回合请求、生成任务、故事事实、摘要；回合删除触发器清掉全文索引；`llm_calls.work_id` 置空。不要手写这些删除。
- [ ] 4. 测试。`settings/service.test.ts`（新建）：
  - `没有存过时返回默认偏好`。
  - `修改后读回新值并发出事件`：订阅总线，`update({ appearance: 'dark', proseSize: '4', proseFont: 'sans', proseLeading: 'compact' })` 后 `get()` 返回同样的值；总线收到一条 `settings.changed`，`appearance.appearance === 'dark'`。
  - `相同的值不发事件`：再 `update` 同样的值，总线没有新事件。阳性对照：上一条用例里确实收到过事件。
  - `库里的值被改坏时回落到默认`：直接用 SQL 把 `appearance` 写成 `'{"appearance":"purple"}'`，`get()` 返回默认值。
  `api/http-app.test.ts` 补：`首页带上存下的外观偏好`：假服务的 `settings.get` 返回 `proseSize: '5'`，请求 `/` 得到的 HTML 含 `data-uw-prose-size="5"`（字面量）。
  `library/service.test.ts` 补：`删除作品级联清掉进度、事实和全文索引`：用 T04 的数据形状造一部有回合、有实体、有索引行的作品；删除后 `works`、`work_versions`、`turns`、`entities`、`prose_fts` 里都查不到它的行；`llm_calls` 里原来关联它的行还在，`work_id` 为 `NULL`。阳性对照：删除前每张表都能查到。另一条 `重复删除同一个作品不报错，也不再发事件`。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `update` 里“四个字段都相同时不发事件”的判断删掉，`相同的值不发事件` 必须红。
- 突变二：把 `http-app.ts` 改回 `DEFAULT_APPEARANCE`，`首页带上存下的外观偏好` 必须红。
- 突变三：在 T04 的自定义迁移里去掉触发器（在一个临时新库上验证），`删除作品级联清掉进度、事实和全文索引` 必须因 `prose_fts` 残留而红。这一条证明 FTS 的清理确实靠触发器，而不是别的东西顺带做了。
- `grep -rn "not implemented: settings\|not implemented: library" packages/core/src` 零命中。

### T07 client：共享部件与外壳

**目的。** M1 的界面粗糙，根子在于缺一层共享部件：四个页面共用一份 `app.module.css`，Base UI 和 Lucide 装了但一处没用。本任务按[设计准则 §9](../docs/design-guidelines.md#9-部件)和 T02 校准过的稿子，做出全应用唯一一套部件，外加外壳（工具行、页面切换、快捷键、事件分发、通知）和组件测试的公共夹具。T13–T15 只用这里的部件拼页面，不再各自写按钮和输入框的样式。

**依赖。** T03（契约）、T02（稿子和 `logo-paths.json`）。

**拥有的文件。** §4.4 里归属 T07 的全部文件。

**先读。** [设计准则](../docs/design-guidelines.md) 全文；[主题与 token §4–§7、§10](../docs/theme.md#4-基元-token)；[动效 §3–§6](../docs/motion.md#3-token)；[a11y §3、§4、§6、§10](../docs/a11y.md#3-页面结构)；[apps/client/AGENTS.md](../apps/client/AGENTS.md) 全文（含 T01 新加的 §7–§11）；`tasks/assets/milestone-2/` 下的截图；Base UI 的类型声明（`node_modules/@base-ui/react/<部件>/index.d.ts`），每用一个部件先读它的导出名和 props。

**步骤。**

- [ ] 1. `theme/appearance.ts`：
  - `applyAppearance(appearance: Appearance)`：先在根元素上写 `data-uw-appearance`、`data-uw-prose-size`、`data-uw-prose-font`、`data-uw-prose-leading` 四个属性，再按现有逻辑解析并写 `data-uw-theme`（含 View Transition 和 `data-uw-theme-switching`）。
  - `followSystemAppearance()` 不变，回调里改成 `applyAppearance(readAppearance())`；`readAppearance()` 从根元素的四个属性读回一个 `Appearance`，读到非法值时用 `DEFAULT_APPEARANCE` 里对应的那一项。
  - `appearance.test.tsx` 按新签名改写现有两个用例，再加：`写入阅读偏好的三个属性`（字面量断言 `data-uw-prose-size="4"` 等）。
- [ ] 2. `shared/lib/css-time.ts`：

  ```ts
  export function readCssDuration(name: `--uw-${string}`, element: Element = document.documentElement): number;
  ```

  读 `getComputedStyle(element).getPropertyValue(name).trim()`；以 `ms` 结尾按毫秒解析，以 `s` 结尾乘 1000，读不到或无法解析返回 `0`。测试：`解析毫秒和秒`（在测试里给元素设 `--uw-test: 0.36s`，期望 `360`）。
- [ ] 3. `shared/api/query.ts` 的 `queryKeys` 加 `settings: ['settings'] as const` 和 `journal: (routeId: string) => ['journal', routeId] as const`。
- [ ] 4. 共享部件。每个部件一个 `.tsx` 和同名 `.module.css`，放在 `shared/ui/`。样式只用 token；状态用 Base UI 的 data 属性选；每个可交互元素有 `:focus-visible` 的 `outline`；交互目标不小于 `--uw-size-target-min`；边框始终保留，不需要显示时设为 `transparent`。部件清单与接口：

  | 部件 | 文件 | 接口 | 要点 |
  | --- | --- | --- | --- |
  | 按钮 | `Button.tsx` | `variant: 'primary' \| 'secondary' \| 'text' \| 'danger' \| 'danger-solid'`；`size?: 'sm' \| 'md'`（默认 `md`）；`icon?: LucideIcon`；`busy?: boolean`；其余透传原生按钮属性。另导出 `buttonClassName(variant, size)`，给 TanStack Router 的 `<Link>` 用同一套样式 | 用 Base UI 的 `Button`。外观按[设计准则 §9](../docs/design-guidelines.md#9-部件)：主按钮强调色实底反白；次按钮表面色底、装饰性描边、表面投影；文字按钮平时无底、悬停出底；危险按钮是次按钮长相、文字用危险色；`danger-solid` 只用于确认破坏性操作的对话框。悬停底色用 `transition-feedback`，按下缩放用 `transition-press` + `scale-press`。`busy` 时 `aria-busy="true"` 且禁用 |
  | 图标按钮 | `IconButton.tsx` | `label: string`（必填，作为 `aria-label`）；`icon: LucideIcon`；`variant?: 'text' \| 'secondary'`；其余透传 | 只用于含义一眼能懂的操作（[设计准则 §7](../docs/design-guidelines.md#7-图标)） |
  | 图标 | `Icon.tsx` | `icon: LucideIcon`；`size?: 'sm' \| 'md'` | 渲染 Lucide 图标，`aria-hidden`；尺寸用 `--uw-size-icon-sm/md`；CSS 里 `stroke-width: var(--uw-size-icon-stroke)` |
  | 单行输入 | `TextField.tsx` | `label`、`value`、`onValueChange(value: string)`、`description?`、`error?`、`placeholder?`、`type?`、`mono?: boolean`、`disabled?`、`autoComplete?` | 用 Base UI `Field`（`Field.Root`、`Field.Label`、`Field.Control`、`Field.Description`、`Field.Error`）。凹陷底 + 控件边框。`mono` 用于地址和模型 id |
  | 多行输入 | `TextArea.tsx` | 同上，另加 `minRows?`、`onKeyDown?`、`onCompositionStart?`、`onCompositionEnd?`、`ref` 透传 | CSS 用 `field-sizing: content` 随内容长高，`min-block-size` 和 `max-block-size` 用 token 算 |
  | 数字输入 | `NumberField.tsx` | `label`、`value: number \| null`、`onValueChange(value: number \| null)`、`min?`、`max?`、`step?`、`description?`、`disabled?` | 用 Base UI `NumberField`。清空就是 `null`（表示“不设置”） |
  | 下拉选择 | `Select.tsx` | `label`、`value: string`、`onValueChange(value: string)`、`options: Array<{ value: string; label: string; description?: string }>`、`description?`、`disabled?` | 用 Base UI `Select`，不用原生 `<select>`（client 规范 §10）。弹层用 `--uw-material-overlay-*`，出现和消失用 `transition-popup` / `-popup-exit`，以 `--transform-origin` 为原点 |
  | 单选组 | `RadioGroup.tsx` | `label`、`value`、`onValueChange`、`options: Array<{ value: string; label: string }>`、`orientation?: 'horizontal' \| 'vertical'` | 用 Base UI `RadioGroup` + `Radio`。组名用 `aria-labelledby` 指向可见标签 |
  | 卡片 | `Card.tsx` | `as?: 'article' \| 'section' \| 'div'`；`children` | 表面底、装饰性描边、`--uw-elevation-surface`、`--uw-radius-lg` |
  | 徽标 | `Badge.tsx` | `tone: 'neutral' \| 'success' \| 'warning' \| 'danger'`；`icon?: LucideIcon`；`children` | 标签字号、小圆角。中性用凹陷底配次要文字；反馈色用对应 `-soft` 底配前景色 |
  | 工具行 | `PageToolbar.tsx` | `title: string`；`back?: { to: '/' \| '/settings'; label: string }`；`tools?: ReactNode` | `<header>`，粘顶，高度 `--uw-size-toolbar`，背景 `--uw-material-chrome-bg`，`backdrop-filter: var(--uw-material-chrome-backdrop)`。起始端返回（`<Link>` + `ChevronLeft` 图标 + 文字），中间是 `<h1 tabIndex={-1}>`（`typography.subtitle`），末端是 `tools` |
  | 页面 | `Page.tsx` | `title: string`；`back?`；`tools?`；`width: 'page' \| 'prose'`；`children` | 渲染 `PageToolbar` + `<main>`。挂载时设 `document.title = t('common:app.documentTitle', { title })`，并把焦点移到 `h1`（[a11y §3](../docs/a11y.md#3-页面结构)）。`title` 变化时只更新 `document.title`，不再移焦点。`<main>` 用 `@starting-style` 做页面切换：淡入并上移 `--uw-motion-distance-md`，用 `transition-dialog`（[动效 §5](../docs/motion.md#5-场景编排)“页面切换”）。`width: 'prose'` 时内容宽度为 `--uw-prose-measure`，`page` 时为 `--uw-size-page-max` |
  | 确认对话框 | `ConfirmDialog.tsx` | `open`、`onOpenChange`、`title`、`description`、`confirmLabel`、`cancelLabel?`（默认 `common:action.cancel`）、`tone: 'default' \| 'danger'`、`onConfirm()`、`busy?` | 用 Base UI `AlertDialog`。遮罩 `--uw-color-scrim`；对话框从中心以 `scale-enter` 放大淡入，`transition-dialog` / `-dialog-exit`。`danger` 时确认按钮用 `danger-solid`。关闭后焦点回到触发元素（Base UI 默认行为，不覆盖） |
  | 侧边抽屉 | `SideSheet.tsx` | `open`、`onOpenChange`、`title`、`children`、`finalFocus?`（透传给 Base UI，用于关闭后把焦点放到别处） | 用 Base UI `Dialog`，弹层贴右边，宽 `--uw-size-panel`，背景 `--uw-material-overlay-bg`。从右侧整体滑入、滑回，`transition-dialog` / `-dialog-exit`。关闭时卸载内容（不设 `keepMounted`）。内容区可滚动；滚动区没有可聚焦子元素时，给它 `role="group"`、可访问名称和 `tabIndex={0}` |
  | 更多操作菜单 | `OverflowMenu.tsx` | `label: string`；`items: Array<{ label: string; onSelect(): void; tone?: 'danger' }>` | 用 Base UI `Menu`，触发器是 `IconButton`（`Ellipsis` 图标）。弹层从触发器长出 |
  | 通知 | `Toaster.tsx` | 导出 `ToastProvider`（包住应用）和 `useNotify(): (input: { title: string; tone: 'success' \| 'danger' \| 'info' }) => void` | 用 Base UI `Toast`。背景直接用 `--uw-color-surface-raised`，描边和投影借 `--uw-material-overlay-border`、`--uw-material-overlay-elevation`。从屏幕底边移入 `distance-md`。每条带图标和文字 |
  | 骨架 | `Skeleton.tsx` | `variant: 'lines' \| 'card' \| 'prose'`；`count?: number` | `aria-hidden` 的灰块，透明度用 `--uw-animation-pulse` 呼吸；外层另放一个 `VisuallyHidden` 的“正在加载”（`common:status.loading`） |
  | 空状态 | `EmptyState.tsx` | `title`、`description?`、`action?: ReactNode`、`icon?: LucideIcon`；`headingLevel: 2 \| 3`（必填，由调用方按所在位置给） | 居中，留白分层，标题用 `typography.section-title` |
  | 生成中标记 | `GeneratingMarker.tsx` | `label: string` | 一个小圆点（`aria-hidden`，`--uw-animation-pulse`）加文字 |
  | 视觉隐藏 | `VisuallyHidden.tsx` | `children`、`as?` | 标准视觉隐藏样式 |
  | 宣告区 | `LiveRegion.tsx` | `message: string`；`politeness?: 'polite' \| 'assertive'` | 从 `Notice.tsx` 迁出。外层 `position: relative`（client 规范 §10） |
  | 错误提示 | `ErrorNotice.tsx` | `error: unknown` 或 `code: string`（二选一）；`action?: ReactNode` | 从 `Notice.tsx` 迁出。`role="alert"`；主句 `errors:<code>`；有 `detail` 时放在“详细信息”（`common:error.details`）下；带 `CircleAlert` 图标；危险色柔和底 |
  | 快捷键提示 | `Kbd.tsx` | `digit: number` | 显示 `⌘1`（macOS）或 `Ctrl+1`（其他平台），`typography.mono` |
  | 标志 | `Logo.tsx` | `variant: 'full' \| 'simple'`；`withWordmark?: boolean` | 读 `logo-paths.json` 画内联 SVG。环用 `fill: var(--uw-color-ink)`，中心点用 `var(--uw-color-accent)`；`aria-hidden`，名字由旁边的文字承担 |

  `Notice.tsx` 在部件迁出后删除，并把引用它的地方改成从新文件导入（只改 import 行）。
- [ ] 5. hooks，放在 `shared/hooks/`：
  - `usePlatform.ts`：`export function isMacPlatform(): boolean`，读 `navigator.userAgentData?.platform ?? navigator.platform`，包含 `Mac` 时为 `true`。
  - `useShortcut.ts`：

    ```ts
    export function useShortcut(
      shortcut: { key: string; mod: boolean },
      handler: (event: KeyboardEvent) => void,
      options?: { enabled?: boolean },
    ): void;
    ```

    在 `window` 上监听 `keydown`。匹配条件：`event.key === shortcut.key`；`mod` 为 `true` 时 macOS 要求 `metaKey`、其他平台要求 `ctrlKey`，且不能同时按着另一个修饰键；`event.isComposing` 为 `true` 时不处理。匹配后 `preventDefault()` 再调用 `handler`。`enabled === false` 时不挂监听。
  - `useAutosave.ts`：

    ```ts
    export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
    export function useAutosave<T>(input: {
      value: T;
      savedValue: T;
      save(value: T): Promise<void>;
      delayMs: number;
      enabled: boolean;
    }): { status: AutosaveStatus; error: unknown; flush(): Promise<void> };
    ```

    `value` 和 `savedValue` 不同、且 `enabled` 时进入 `pending`，`delayMs` 毫秒内没有新变化就调用 `save`（`saving`），成功 `saved`、失败 `error`。`flush()` 立即保存当前值并等它完成（生成预览前调用）。同一时间只有一次保存在进行，进行中又有新变化时，等这次完成后再保存最新值。卸载时如果还有未保存的变化，调用一次 `save`。
  - `useFollowLatest.ts`：

    ```ts
    export function useFollowLatest(input: {
      contentRef: RefObject<HTMLElement | null>;
      sentinelRef: RefObject<HTMLElement | null>;
    }): { atLatest: boolean; scrollToLatest(): void };
    ```

    用 `IntersectionObserver` 观察 `sentinelRef`（放在剧情末尾的一个空元素），可见时 `atLatest = true`。用 `ResizeObserver` 观察 `contentRef`（剧情的内容盒，client 规范 §10），内容变高时：如果变高之前 `atLatest` 为 `true`，调用 `sentinel.scrollIntoView({ block: 'end' })`；否则不滚动。`scrollToLatest()` 直接调用同一个 `scrollIntoView`。平滑与否交给 CSS 的 `scroll-behavior`（减少动态效果时 token 会把它设为 `auto`），JS 里不写 `behavior`。
  - `useEnterToSubmit.ts` 保持不变。
- [ ] 6. 外壳：
  - `app/router.tsx`：`RootLayout` 去掉全局的顶部导航条，只渲染 `<div className={styles.shell}><Outlet /></div>`，并在这里挂 `useShortcut({ key: ',', mod: true }, () => navigate({ to: '/settings' }))`。各页面自己用 `Page` 渲染工具行。
  - `app/App.tsx`：
    - 去掉 `applyAppearance('system')`；保留 `followSystemAppearance()`。
    - 事件分发里加：`settings.changed` → `applyAppearance(event.appearance)` 并 `queryClient.setQueryData(queryKeys.settings, event.appearance)`；`turn.committed` 另外失效 `queryKeys.journal(event.routeId)`。
    - 用 `ToastProvider` 包住 `RouterProvider`。
  - `app/app.module.css`：只保留 `.shell` 一条规则（背景 `--uw-color-bg`、文字 `--uw-color-text`、`min-block-size: 100vh`），以及 `scroll-padding-block-start: var(--uw-size-toolbar)`（[a11y §4](../docs/a11y.md#4-键盘与焦点)）。其余规则在 T13–T15 改完各页后由 T16 删除；本任务先不删，以免页面在中间状态下失去样式。
- [ ] 7. 组件测试的公共夹具，放在 `shared/test/`：
  - `fake-api.ts`：`createFakeApi(handlers: Record<string, (input: unknown) => unknown>)` 返回一个和 `ApiClient` 同形的对象：用 `Proxy` 按访问路径拼出键（例如 `api.works.list` → `'works.list'`），调用时找到同名 handler 就返回它的结果（包成 `Promise`），找不到就以 `new ORPCError('internal')` 拒绝。另返回 `calls: Array<{ path: string; input: unknown }>` 记录每次调用。`events.subscribe` 默认返回一个永不结束的异步迭代器。
  - `render.tsx`：`renderRoute(path: string, options: { api: ApiClient })`：建一个新的 `QueryClient`（`retry: false`），用 `createMemoryHistory({ initialEntries: [path] })` 和真实的路由树建路由，包上 `ApiProvider`、`QueryClientProvider`、`ToastProvider`，渲染。i18n 用全部命名空间的 JSON 同步初始化。返回 `vitest-browser-react` 的渲染结果和路由实例。
  - `axe.ts`：`expectNoAxeViolations(container: Element): Promise<void>`，用 `axe-core` 跑一遍，违规列表为空。
  - `heading-outline.ts`：`expectHeadingOutline(container: Element)`：恰好一个 `h1`；按文档顺序，每个标题的级别最多比前一个大 1。
- [ ] 8. `i18n/zh-CN/common.json` 加附录 A.1 的键。
- [ ] 9. 测试（每个文件和部件放在一起，`*.test.tsx`）：
  - 每个部件至少一条 `无可访问性违规`（`expectNoAxeViolations`）。
  - `Button`：`忙碌时禁用并标记 aria-busy`；`buttonClassName 给链接同样的样式`（同一 `variant` 下链接和按钮的类名相同）。
  - `TextField`：`标签和输入框关联`（`getByRole('textbox', { name: 标签 })` 能找到）；`错误信息通过 aria-describedby 关联`。
  - `NumberField`：`清空时回传 null`。
  - `Select`：`键盘打开并选择`（聚焦触发器，按 `ArrowDown` 打开，选中第二项，`onValueChange` 收到第二项的值）。
  - `ConfirmDialog`：`关闭后焦点回到触发按钮`；`危险确认按钮用实底样式`。
  - `SideSheet`：`关闭时不渲染内容`（关闭状态下 `queryByText(内容)` 为空：client 规范 §10“关闭不等于卸载”）；`Esc 关闭`。
  - `Toaster`：`通知带图标和文字`。
  - `Page`：`挂载时设置文档标题并聚焦 h1`；`标题变化不抢焦点`。
  - `useShortcut`：`组字时不触发`（派发 `isComposing: true` 的事件，回调不执行；阳性对照：同样的按键 `isComposing: false` 时执行）；`没有修饰键时不触发`。
  - `useAutosave`：`防抖后保存一次`（连续三次变化只调用一次 `save`，参数是最后的值）；`flush 立即保存`；`保存失败进入 error`。用假时钟时注意：React 调度不受 `vi.useFakeTimers` 控制，用 `vi.advanceTimersByTimeAsync` 并 `await` 渲染。
  - `useFollowLatest`：用测试桩替换 `ResizeObserver` 和 `IntersectionObserver`，桩只有在 `observe(target)` 被调用之后才能触发回调（client 规范 §11）。用例：`观察的是内容盒`（断言 `observe` 收到的元素就是 `contentRef.current`）；`停在最新时内容变高会滚动`；`往上翻过时内容变高不滚动`。

**接线点。**

| 功能 | 接线位置 | 怎样验证 |
| --- | --- | --- |
| ⌘, 打开设置 | `router.tsx` 的 `RootLayout` | T17 的端到端用例按 ⌘, 进入设置页 |
| `settings.changed` 同步外观 | `App.tsx` 事件分发 | T17 两个标签页用例 |
| `turn.committed` 失效手记 | 同上 | T15 的组件测试用假事件验证不了（事件分发在 `App.tsx`），由 T17 覆盖 |
| `ToastProvider` | `App.tsx` 和 `shared/test/render.tsx` 两处 | 两处都要包；`render.tsx` 漏了，页面测试里调用 `useNotify` 会报错 |

**注意事项。**

- 部件的外观以 T02 的稿子为准；稿子和本表冲突时按 T02 步骤 6 处理，不要自己取舍。
- 只用 Base UI 实际导出的部件和 props。不确定某个 prop 是否存在时读它的类型声明，不要凭印象写。
- 不在部件里写任何业务文案；部件需要的通用文案（“取消”“关闭”“正在加载”“详细信息”）走 `common`。
- 动效只动 `transform` 和 `opacity`；出现用 `[data-starting-style]` 或 `@starting-style`，消失用 `[data-ending-style]`（client 规范 §3）。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过，上面列出的用例全部在列。
- `pnpm lint` 通过（Stylelint 检查只用 token、逻辑属性、禁 `transition: all`）。
- 突变一：把 `useShortcut` 里的 `isComposing` 判断删掉，`组字时不触发` 必须红。
- 突变二：把 `SideSheet` 的 Base UI 弹层加上 `keepMounted`，`关闭时不渲染内容` 必须红。
- 突变三：把 `useFollowLatest` 里观察的元素从 `contentRef.current` 换成 `sentinelRef.current`，`观察的是内容盒` 必须红。
- 突变四：把 `Page` 挂载时的 `focus()` 删掉，`挂载时设置文档标题并聚焦 h1` 必须红。
- `grep -rn "Notice.tsx" apps/client/src` 零命中。

### T08 story 读侧：投影、短编号、文本渲染、手记、检索

**目的。** 实现“一条路线此刻能看见哪些故事事实”（[数据模型 §5](../docs/data-model.md#5-可见性规则)），以及建立在它上面的四样东西：给模型用的短编号（[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)末尾“编号”）、给模型看的文本格式（附录 C）、给玩家看的手记（D8）、全文检索（[数据模型 §6](../docs/data-model.md#6-派生数据)）。推送（T11 的上下文）、拉取（T11 的工具）、手记接口（T11）、写侧校验（T09）都读这一份投影，所以它是“可见性”的漏斗：只要这里对，下游就不会看见不该看见的东西。

**依赖。** T04。

**拥有的文件。** `packages/core/src/story/projection.ts`、`codebook.ts`、`render.ts`、`journal.ts`、`search.ts` 及测试；`test-support/story-fixtures.ts`。

**先读。** [数据模型 §4–§6](../docs/data-model.md#4-故事事实)；[回合循环 §3–§4](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)；本文 §2.2、附录 C；T04 的 `story/types.ts`。

**步骤。**

- [ ] 1. `test-support/story-fixtures.ts`（新建，并在 `test-support/index.ts` 导出）。先写夹具，后面的测试都用它：

  ```ts
  export interface SeedSpec {
    turns: Array<{ prose: string; action?: string; parent?: number; presentKeys?: string[] }>;
    head?: number;
    entities: Array<{ key: string; kind: EntityKind; name: string; profile?: string; protagonist?: boolean; originTurn?: number | null }>;
    names?: Array<{ entity: string; name: string; holder: string | null; originTurn?: number | null; para?: number }>;
    facts?: Array<{ key: string; kind: FactKind; subject?: string; object?: string; factKey?: string; statement: string; data?: FactData; originTurn?: number | null; para?: number }>;
    knowledge?: Array<{ fact: string; holder: string; level: KnowledgeLevel; perceived?: string; via?: string; originTurn?: number | null; para?: number }>;
  }

  export interface SeededStory {
    workId: string;
    versionId: string;
    playthroughId: string;
    routeId: string;
    headTurnId: string;
    turnIds: string[];
    ids: Record<string, string>;
  }

  export function seedStory(db: Database, spec: SeedSpec): SeededStory;
  ```

  - `turns[0]` 是根回合（深度 0，没有 `action`）。`parent` 是父回合在数组里的下标，省略时为前一个；深度按父回合加一。`presentKeys` 是在场实体的 `key`，写进 `scene.presentIds`，`scene.present` 写对应的真名。
  - `head` 是路线 head 在数组里的下标，省略时为最后一个。
  - `originTurn` 是回合下标，省略或为 `null` 时 `origin_turn_id` 为空（作者设定）。
  - `ids` 把每个实体和事实的 `key` 映射到生成的真实 id。
  - 直接用 drizzle 插入，不调用任何服务；一次插入作品、草稿、发布版本、开局、全部回合、路线、实体、称呼、事实、知情，并调用 `indexTurnProse` 为每个回合建全文索引。
- [ ] 2. `story/projection.ts`：

  ```ts
  export interface ProjectionInput {
    versionId: string;
    chain: Array<{ id: string; depth: number; action: StoredAction | null; prose: string; scene: StoredScene }>;
  }

  export function loadProjection(db: Database, input: ProjectionInput): StoryProjection;
  ```

  `chain` 由调用方传入（调用方用 `play/chain.ts` 的 `ancestorChain` 取），按深度从 0 到 head 排好。`story/` 不导入 `play/`。实现：
  1. `chainIds = chain.map((turn) => turn.id)`；`depthOf = new Map(chain.map((turn) => [turn.id, turn.depth]))`。`depth(originTurnId) = originTurnId === null ? -1 : depthOf.get(originTurnId)`。
  2. 四张表各查一次，条件都是 `version_id = input.versionId and (origin_turn_id is null or origin_turn_id in chainIds)`（用 drizzle 的 `or(isNull(...), inArray(...))`）。`entity_names` 额外选出 `rowid` 作为 `seq`（`sql<number>\`rowid\``）。
  3. **事实的覆盖规则：** `key` 为空的事实（`event`）全部保留；`key` 不为空的事实按 `` `${kind}|${subjectId ?? ''}|${objectId ?? ''}|${key}` `` 分组，每组只留 `depth` 最大的一条。
  4. **知情的覆盖规则：** 按 `` `${factId}|${holderId}` `` 分组，每组只留 `depth` 最大的一条。
  5. 称呼不做覆盖，全部保留，按 `(depth, seq)` 升序排好；“当前称呼”由下面的帮助函数取最后一条。
  6. `summaries`：`select turn_id, summary from turn_summaries where turn_id in chainIds`。
  7. `chain` 里每个回合的 `paragraphs` 用 `splitParagraphs(turn.prose)`。
  8. 找 `isProtagonist` 为真的实体作为 `protagonistId`；找不到抛 `new Error('protagonist entity missing')`（T04 的补齐保证每个版本都有，找不到说明数据坏了）。
  同一文件导出这些纯函数（只读投影，不查库）：

  ```ts
  export function currentNameHeldBy(p: StoryProjection, entityId: string, holderId: string | null): string | null;
  export function protagonistNameOf(p: StoryProjection, entityId: string): string | null;
  export function knowledgeOf(p: StoryProjection, factId: string): ProjKnowledge[];
  export function protagonistKnowledge(p: StoryProjection, factId: string): ProjKnowledge | null;
  export function presentIdsAtHead(p: StoryProjection): string[];
  export function appearedEntityIds(p: StoryProjection): Set<string>;
  export function acquaintanceStage(p: StoryProjection, entityId: string): string | null;
  export function openPromises(p: StoryProjection): ProjFact[];
  export function protagonistKnownStrings(p: StoryProjection): Set<string>;
  export function maskUnknownNames(p: StoryProjection, text: string): string;
  ```

  - `currentNameHeldBy`：`holderId` 相同的称呼里 `(depth, seq)` 最大的那一条的 `name`。
  - `protagonistNameOf`：主角持有的当前称呼；没有时用公开称呼（`holderId` 为 `null`）；都没有时，如果 `entityId` 就是主角，返回主角的真名，否则返回 `null`。
  - `presentIdsAtHead`：head 回合 `scene.presentIds` 里仍在 `entities` 中的那些。
  - `appearedEntityIds`：满足任一条的实体：`originDepth >= 0`；作为 `depth >= 0` 的事实的 `subjectId` 或 `objectId`；出现在链上任一回合的 `scene.presentIds`；有一条 `depth >= 0` 的称呼。这就是[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)说的“已出场”。
  - `acquaintanceStage`：`kind = 'relation'`、`key = 'acquaintance'`、主体和客体是主角与这个实体（任一方向）的事实里 `depth` 最大的那条的 `data.stage`；没有时 `null`。
  - `openPromises`：`kind = 'promise'` 且 `data.status === 'agreed'` 的事实。
  - `protagonistKnownStrings`：主角知道的全部名字字符串：每个实体的 `protagonistNameOf`（非空的），加上主角持有的全部称呼（不只是当前那条），加上公开称呼，加上主角自己的真名。
  - `maskUnknownNames`：给手记用。对每个实体，它的真名和全部称呼里，不在 `protagonistKnownStrings` 中、且长度不小于 `STORY_LIMITS.nameMinLengthForLeakCheck` 的字符串，在 `text` 里替换成 `protagonistNameOf(实体)`；`protagonistNameOf` 为 `null` 时替换成 `KIND_UNKNOWN_LABEL[实体.kind]`（`character: '一个不知道名字的人'`、`place: '一个地方'`、`item: '一件东西'`、`group: '一群人'`、`other: '某样东西'`，作为常量导出）。按字符串长度从长到短替换，避免短名字先替换掉长名字的一部分。
- [ ] 3. `story/codebook.ts`：

  ```ts
  export type Resolved = { ok: true; id: string } | { ok: false; error: string };

  export interface CodeBook {
    entityCode(entityId: string): string;
    factCode(factId: string): string;
    resolveEntity(token: string): Resolved;
    resolveFact(token: string): Resolved;
    resolveTurn(token: string): { ok: true; turn: ChainTurn } | { ok: false; error: string };
    issuedEntityIds(): string[];
    issuedFactIds(): string[];
  }

  export function createCodeBook(p: StoryProjection): CodeBook;
  ```

  - 创建时先给主角发 `@1`。`entityCode`、`factCode` 第一次遇到某个 id 时发下一个号（`@2`、`@3`…，`#1`、`#2`…），之后返回同一个号。
  - `resolveEntity(token)`，先 `trim`：
    - 形如 `@数字`：发过这个号就返回对应 id；没发过返回错误 `编号 <token> 不是本次给出的编号。`
    - 否则按名字找：在**已发过编号**的实体里，真名或任一可见称呼与 `token` 完全相同的。一个都没有：`找不到名为「<token>」的人物或事物。请用编号引用，或先查 list_catalog。`；多于一个：`「<token>」对应多个：<逐个列出 编号（种类，真名）>。请用编号指明。`
  - `resolveFact(token)`：只接受 `#数字`，规则同上，错误为 `编号 <token> 不是本次给出的事实编号。`
  - `resolveTurn(token)`：接受 `T数字`，在 `p.chain` 里找同深度的回合；找不到返回 `本路线没有回合 <token>。`
  - 错误文字是返回给模型看的，写死在常量里，不走 i18n。
- [ ] 4. `story/render.ts`：按附录 C 的格式实现下面这些函数，**格式一个字都不改**（T11 的 token 棘轮和模型的提示都依赖它）：

  ```ts
  export function renderEntityLine(p: StoryProjection, cb: CodeBook, entityId: string): string;
  export function renderSceneBlock(p: StoryProjection, cb: CodeBook): string;
  export function renderPromiseLine(p: StoryProjection, cb: CodeBook, fact: ProjFact): string;
  export function renderEntityDetail(p: StoryProjection, cb: CodeBook, entityId: string): string;
  export function renderCatalogPage(p: StoryProjection, cb: CodeBook, category: CatalogCategory, cursor: number): string;
  export function renderWhoKnows(p: StoryProjection, cb: CodeBook, factId: string): string;
  export function renderTurnText(turn: ChainTurn): string;
  export function renderSearchHits(hits: SearchHit[]): string;
  export function clipToolResult(text: string): string;
  export function sourceLabel(depth: number, para: number | null): string;

  export const CATALOG_CATEGORIES = ['characters', 'places', 'items', 'groups', 'others', 'promises', 'events', 'scenes'] as const;
  export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];
  export const KIND_LABEL: Record<EntityKind, string>;
  export const LEVEL_LABEL: Record<KnowledgeLevel, string>;
  ```

  `clipToolResult`：长度（按 `Array.from` 计字符）超过 `STORY_LIMITS.toolResultMaxChars` 时截到上限，末尾加一行 `（已截断）`。
- [ ] 5. `story/search.ts`：

  ```ts
  export interface SearchHit { turnId: string; depth: number; para: number; snippet: string }
  export function searchStory(db: Database, p: StoryProjection, query: string): SearchHit[];
  ```

  - `q = query.trim()`，为空返回 `[]`。
  - `Array.from(q).length >= 3`：全文检索。把 `q` 包成短语：`'"' + q.replaceAll('"', '""') + '"'`（不包会被当成 FTS 语法，玩家原话里的引号、减号会让查询报错）。SQL：`select turn_id, para, body from prose_fts where prose_fts match ${phrase}`，在 TypeScript 里过滤出 `turn_id` 属于 `p.chain` 的行（只看祖先链：别的分支上的回合不可见）。
  - 少于 3 个字：trigram 切不出片段，改为在 `p.chain` 每个回合的 `paragraphs` 里找子串（[数据模型 §6](../docs/data-model.md#6-派生数据)）。
  - 两种方式的结果都按深度从大到小、段号从小到大排序，最多 `STORY_LIMITS.searchMaxHits` 条。
  - `snippet`：以第一次命中的位置为中心，前后各取 `STORY_LIMITS.searchContextChars` 个字符，截断的一侧加 `…`。
- [ ] 6. `story/journal.ts`：

  ```ts
  export function buildJournal(p: StoryProjection, routeId: string): JournalView;
  ```

  按 D8：
  - **条目**：每个 `protagonistNameOf` 不为 `null` 的实体（主角自己除外）。`name` 取 `protagonistNameOf`。
  - **条目下的行**：提到这个实体（`subjectId` 或 `objectId` 等于它）、种类是 `trait`、`relation`、`promise`、`event` 的事实，且 `protagonistKnowledge(事实)` 不为 `null`。`text`：知情程度为 `confirmed` 用 `fact.statement`，否则用 `perceived`；`perceived` 为空时跳过这一行（[数据模型 §5](../docs/data-model.md#5-可见性规则)：没有保存说法时不生成条目）。`text` 一律经过 `maskUnknownNames`。`source`：知情记录有回合和段号时 `{ turnId, depth, para }`，否则 `null`。行按来源深度、段号升序排。
  - **事件组**：主角知情的全部 `event` 事实，规则同上，按来源排序。
  - 条目排序：先按种类（人物、地点、物品、组织、其他），同种类里按第一条行的来源深度升序，没有行的排在最后。
  - `headTurnId` 取 `p.headTurnId`。
- [ ] 7. 测试（测试名照抄，素材用附录 D）：
  - `projection.test.ts`：
    - `只看得见祖先链上的事实`：根回合下分两个子回合 A、B，路线 head 在 A；B 上的事实不在投影里，A 上的和作者设定的在。阳性对照：把 head 换成 B 时，B 上的事实出现、A 上的消失。
    - `有键的事实后写的覆盖先写的，事件全部保留`：T1 写认识阶段 `heard_of`，T3 写 `met`；投影里认识阶段只有一条，是 `met`。同时 T1、T3 各有一条事件，两条都在。
    - `知情取最新的程度`：主角 T1 `heard`、T2 `confirmed`，投影里是 `confirmed`。
    - `主角的称呼随路线变化`：T1 主角称她“撑伞的女人”，T3 得知真名“沈岚”；head 在 T3 时 `protagonistNameOf` 是“沈岚”，head 在 T2 时是“撑伞的女人”。
    - `缺主角时报错`：直接删掉主角实体后 `loadProjection` 抛错。
  - `codebook.test.ts`：`主角永远是 @1`；`没发过的编号被拒绝`；`同名时列出全部候选`（两个都叫“老周”的人物，错误文字里同时出现两个编号）；`按主角的称呼也能找到`。
  - `render.test.ts`：对附录 C 的每一种格式，用附录 D 的夹具构造输入，断言输出**逐字等于**附录 C 里的示例（写成字面量字符串）。
  - `journal.test.ts`：
    - `只收录主角知道称呼的实体`：一个主角知道称呼的人物、一个不知道的；手记只有前者。
    - `不知道的真名在手记里被遮住`：确认知情的事件陈述里含一个主角不知道的真名，手记里替换成主角对他的称呼；阳性对照：同一句里主角知道的名字原样保留。
    - `听说的事用主角听到的说法`。
  - `search.test.ts`：
    - `三个字以上走全文检索，只看祖先链`：同一个词同时出现在祖先链和兄弟分支上，结果只有祖先链那一条。阳性对照：结果非空。
    - `一两个字走子串扫描`。
    - `查询里的引号不会让检索报错`：查询 `他说"等等"` 不抛错。

**注意事项。**

- `story/` 不导入 `llm/`、`api/`、`play/`、`authoring/`（core 规范 §1）。
- 投影一次读完、在内存里处理。不在请求之间缓存投影：每次请求重新读，保证看到的是已提交的最新状态。
- 本任务不写任何东西进库（夹具除外）。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过，上面列出的用例全部在列。
- `grep -rnE "from '\.\./(llm|api|play|authoring)/" packages/core/src/story` 零命中。
- 突变一：把投影查询条件里的 `inArray(..., chainIds)` 换成不加过滤（看得见本版本的全部行），`只看得见祖先链上的事实` 必须红。
- 突变二：把事实覆盖的分组键去掉 `subjectId`，`有键的事实后写的覆盖先写的，事件全部保留` 应当仍绿（这个夹具里主体相同）；这说明它守不住这一处。补一条用例 `不同主体的同名键互不覆盖`：两个人物各有一条 `key = 'mood'` 的特征，投影里两条都在。再做一次这个突变，新用例必须红。
- 突变三：把 `maskUnknownNames` 的替换去掉，`不知道的真名在手记里被遮住` 必须红。
- 突变四：把 `search.ts` 里按祖先链过滤的那一步删掉，`三个字以上走全文检索，只看祖先链` 必须红。

### T09 story 写侧：解析校验 changes、不泄露检查、写入

**目的。** 模型交上来的 `changes` 是“每行一个 JSON”的字符串（[回合循环 §5](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。本任务把它解析成 `ValidatedChanges`，按[回合循环 §6](../docs/turn-loop.md#6-校验与保存)校验引用、新人物去重、知情、不泄露，并提供在提交事务里写入的函数。**事实在每一回合自动记录，不经人工审核**，所以校验是唯一的守门人：这里放过的错误会永久写进路线。

**依赖。** T04；与 T08 同时开工，只用 T08 定死的接口（`StoryProjection` 和 `CodeBook` 的签名见 T04、T08）。T08 还没合并时，在本任务的测试里用 T08 的 `seedStory` + `loadProjection` + `createCodeBook`；如果它们还不存在，先按 T08 的签名写最小可用的版本放在本任务的测试文件里，T08 合并后删掉，改用正式的。

**拥有的文件。** `packages/core/src/story/changes.ts`、`leak.ts`、`writer.ts` 及测试；`test-support/llm-steps.ts` 里构造 `changes` 行的帮助函数。

**先读。** [回合循环 §5–§6、§11](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)；[数据模型 §4](../docs/data-model.md#4-故事事实) 的“覆盖规则”“几个典型的事实”；本文 §2.2、T04 的 `story/types.ts`、T08 的接口、附录 B.3（`changes` 的字段说明，模型看到的就是它）。

**步骤。**

- [ ] 1. `story/changes.ts`：

  ```ts
  export interface ChangesContext {
    mode: 'opening' | 'turn';
    projection: StoryProjection | null;
    codebook: CodeBook | null;
    paragraphCount: number;
    parentPresentIds: string[];
  }

  export const TURN_CHANGE_TYPES = ['new_entity', 'name', 'event', 'trait', 'relation', 'promise', 'knowledge', 'scene'] as const;
  export const OPENING_CHANGE_TYPES = ['new_entity', 'name', 'event', 'trait', 'relation', 'promise', 'knowledge'] as const;

  export function parseChanges(raw: string, ctx: ChangesContext): ParseResult<ValidatedChanges>;
  ```

  `mode: 'opening'` 时 `projection`、`codebook` 为 `null`（开场之前还没有任何事实），`parentPresentIds` 为空数组。解析分三遍：
  1. **第一遍：逐行解析。** 空字符串返回 `EMPTY_CHANGES`。用 `parseJsonLines(raw, 'changes')`；非空行数超过 `STORY_LIMITS.changesLinesMax` 时报 `changes：最多 <上限> 行。`。每行必须有字符串 `type`，且在当前模式允许的类型里，否则报 `第 <行> 行 changes：不支持的类型 <type>。可用的类型：<逗号分隔的列表>。`
  2. **第二遍：收集本次新增的实体。** 先处理全部 `new_entity` 行，建立“名字 → 行号”的表（`name` 和 `known_as` 都登记），后面的行无论在前在后都能引用它们。
  3. **第三遍：逐行校验其余字段，解析引用。**
  
  **字段读取的通用规则**（写成模块内的小函数）：
  - 字符串字段：必须是字符串；`trim` 后按规则判断空和长度（长度按 `Array.from` 计）。
  - 段号 `para`：接受字符串数字或整数，必须在 `1..paragraphCount` 之间，否则 `第 <行> 行 changes.para：段号必须在 1 到 <段数> 之间。`
  - 实体引用（`entity`、`holder`、`subject`、`object`、`via`、`witnesses` 和 `present` 里的每一项）：先在本次新增的名字表里找，找到得 `{ created: 行号 }`；再用 `codebook.resolveEntity`，成功得 `{ existing: id }`；都失败时用 `codebook` 给出的错误文字，前面加 `第 <行> 行 changes.<字段>：`。开场模式没有 `codebook`，只能引用本次新增的实体。
  - 事实引用（`knowledge` 的 `fact`）：`#数字` 用 `codebook.resolveFact`；`L数字` 表示本次 `changes` 的第几行，那一行必须是 `event`、`trait`、`relation`、`promise` 之一，否则 `第 <行> 行 changes.fact：L<n> 不是本次的事实行。`
  
  **各类型的规则**（字段名与[回合循环 §5](../docs/turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)一致；错误文字照抄，`<…>` 处填实际值）：

  | 类型 | 必填 | 规则 | 主要错误 |
  | --- | --- | --- | --- |
  | `new_entity` | `kind`、`name`、`profile`、`para` | `kind` 是五种之一；`name` 不超过 `nameMax`；`known_as` 可省略或为空串（表示主角此刻不知道怎么称呼它），不超过 `nameMax`；`profile` 不超过 `profileMax`，可以是空串。`protagonist` 只在开场模式出现，值为 `"true"`；开场模式里恰好一行 `protagonist: "true"`，且 `kind` 是 `character`。`distinct` 可选，值为 `"true"` | 续写模式出现 `protagonist`：`第 <行> 行 changes：续写时不能新增主角。`；开场没有主角：`changes：开场必须有一行 "protagonist":"true" 的人物。`；同名（见下） |
  | `name` | `entity`、`name`、`holder`、`para` | `holder` 必须在“在场集合”里（见下） | `第 <行> 行 changes.holder：<引用> 本回合不在场。` |
  | `event` | `subject`、`statement`、`para` | `object` 可选；`statement` 不超过 `statementMax`；`witnesses` 可选，逗号分隔的实体引用，每个都必须是人物，最多 `witnessesMax` 个。省略 `witnesses` 时：续写模式且本次没有 `scene` 行，取父回合在场者加主角；开场模式或本次有 `scene` 行时必须写明 | `第 <行> 行 changes.witnesses：开场或场景有变化时，必须写明目击者。` |
  | `trait` | `subject`、`key`、`statement`、`para` | `key` 不超过 `keyMax` | — |
  | `relation` | `subject`、`object`、`key`、`statement`、`para` | `relation_type` 可选，不超过 `relationTypeMax`；`strength` 可选，整数，`relationStrengthMin..Max`；`key` 为 `acquaintance` 时 `stage` 必填，是 `heard_of`、`met`、`familiar` 之一；`via` 可选。`data` 写入 `{ type, strength, stage, via }` 里有值的项；`via` 指向本次新增的实体时写成字符串 `created:<行号>`，由写入时换成真实 id | `第 <行> 行 changes.stage：认识阶段只能是 heard_of、met、familiar。` |
  | `promise` | `subject`、`object`、`key`、`status`、`statement`、`para` | `status` 是 `agreed`、`kept`、`broken` 之一；`data` 写 `{ status }` | `第 <行> 行 changes.status：约定状态只能是 agreed、kept、broken。` |
  | `knowledge` | `fact`、`holder`、`level`、`para` | `level` 是四种之一；`level` 不是 `confirmed` 时 `perceived_statement` 必填，不超过 `perceivedMax`；`via` 可选。`holder` 不在在场集合里时必须写 `via` | `第 <行> 行 changes：<引用> 本回合不在场，必须写明 via（从谁那里得知）。` |
  | `scene` | `place`、`time`、`present` | 最多一行；`place` 不超过 `placeMax`，`time` 不超过 `timeMax`；`present` 是逗号分隔的实体引用，每个都必须是人物，最多 `presentMax` 个，可以为空串（只有主角在场） | `changes：最多只能有一条 scene。` |

  **在场集合**（`name` 的 `holder`、`knowledge` 的 `holder` 用）：主角，加上父回合在场者，加上本次 `scene` 行的 `present`，加上本次新增的人物。主角在开场模式下是本次 `protagonist` 那一行。

  **同名检查**（[回合循环 §6](../docs/turn-loop.md#6-校验与保存)“新人物去重”）：新增实体的 `name` 与投影里同种类实体的真名或任一称呼相同时，如果没有 `"distinct":"true"`，或者 `profile` 为空，报：`第 <行> 行 changes：与 <编号>（<真名>）同名。如果就是此人，删掉这一行，改用 <编号> 引用；如果是另一个人，加上 "distinct":"true"，并在 profile 里写明区别。`。本次 `changes` 里两行 `new_entity` 同种类同名，报：`第 <行> 行 changes：和第 <行> 行重复新增了同一个名字。`

  **有键事实的重复**：本次 `changes` 里两行 `trait`、`relation`、`promise` 的种类、主体、客体、`key` 完全相同时，报 `第 <行> 行 changes：和第 <行> 行写的是同一项，请合并成一行。`（唯一索引不允许同一回合同一组有两行）。

  全部错误收集起来一起返回，不在第一条错误处停下（模型一次修正全部问题）。
- [ ] 2. `story/leak.ts`：

  ```ts
  export function findLeaks(input: {
    projection: StoryProjection | null;
    changes: ValidatedChanges;
    paragraphs: string[];
    options: string[];
  }): string[];
  ```

  [回合循环 §6](../docs/turn-loop.md#6-校验与保存)“不泄露”的实现：
  1. **主角此刻已知的名字**：`projection` 存在时取 `protagonistKnownStrings(projection)`，否则为空集。
  2. **随段落增加的已知名字**：本次新增实体的 `knownAs`（从它的 `para` 起已知）；本次 `name` 行里 `holder` 是主角的（从它的 `para` 起已知）；开场模式下主角自己的 `name`（从第 1 段起已知）。“主角”在续写模式是 `{ existing: projection.protagonistId }`，在开场模式是 `protagonist: true` 那一行的 `{ created: 行号 }`。
  3. **候选名字**：投影里每个实体的真名和全部称呼，加上本次新增实体的 `name` 和 `knownAs`；长度小于 `STORY_LIMITS.nameMinLengthForLeakCheck` 的不检查。
  4. **逐段检查**：第 `p` 段的已知集合 = 第 1 步 ∪ 第 2 步里 `para <= p` 的。把段落里出现的已知名字按长度从长到短替换成 `\u0000`，再看是否还含有不在已知集合里的候选名字。有就报：`第 <p> 段出现了主角还不知道的名字「<名字>」。先在这一段或之前用 name 给主角加上这个称呼，或者换成主角知道的叫法。`
  5. **选项**：已知集合取全部段落之后的；第 `i` 个选项（从 1 起）含未知名字时报：`第 <i> 个推荐行动出现了主角还不知道的名字「<名字>」。`
  先替换已知名字再查，是为了处理“主角知道‘林叔’、不知道真名‘林’”这一类：长名字里包着短名字时不误报。
- [ ] 3. `story/writer.ts`：

  ```ts
  export function allocateEntityIds(changes: ValidatedChanges): Map<number, string>;

  export interface WriteChangesInput {
    changes: ValidatedChanges;
    createdIds: Map<number, string>;
    turnId: string;
    versionId: string;
    entityVersionIds: string[];
    entityOrigin: 'version' | 'turn';
    protagonistId: string | null;
    parentPresentIds: string[];
  }

  export interface WriteChangesResult {
    createdIds: Map<number, string>;
    protagonistId: string;
    scene: { presentIds: string[] } | null;
  }

  export function writeChanges(tx: StoryTx, input: WriteChangesInput): WriteChangesResult;
  ```

  `StoryTx` 是 drizzle 事务对象和 `Database` 共有的最小类型（照 T04 `indexTurnProse` 的处理方式）。必须在调用方的提交事务里调用；本函数不开事务、不 `await`、不发事件。按顺序：
  0. `allocateEntityIds` 为每个新增实体生成一个 `randomUUID()`，返回“行号 → id”。调用方先调用它，用这些 id 算出回合的 `scene.presentIds`、插入回合行，再调用 `writeChanges` 并把同一张表传进 `createdIds`。这样分两步，是因为事实的 `origin_turn_id` 引用回合，回合必须先插入；而回合的场景又要用到新人物的 id。
  1. `resolve(ref)`：`existing` 原样返回，`created` 查 `input.createdIds`，查不到抛错。返回值里的 `createdIds` 就是输入的那一张。
  2. 新增实体写进 `entityVersionIds` 里的每个版本，`id` 相同；`originTurnId` 在 `entityOrigin === 'version'` 时为 `null`，否则为 `turnId`；`profile` 写 `{ text }`；开场的主角 `isProtagonist = 1`。`protagonistId` 取输入值，为 `null` 时取新增的主角 id；两者都没有时抛错。
  3. 称呼（全部写进 `versionId`，`originTurnId = turnId`）：
     - 开场的主角：一条主角自己持有的、名字是主角真名的称呼，`sourcePara = 1`；
     - 每个 `knownAs` 不为空的新增实体：一条主角持有的称呼，`sourcePara` 是它的 `para`；
     - 每条 `name` 行；
     - 按 `(entityId, name, holderId)` 去重后再写，避免撞唯一索引。
  4. 事实：生成 id，按行号记入一张“行号 → 事实 id”的表；`data.via` 是 `created:<行号>` 时换成真实 id；写进 `versionId`，`originTurnId = turnId`，`sourcePara = para`。
  5. 知情：先按事件的 `witnesses` 展开（每个目击者一条 `level = 'confirmed'`、`sourcePara` 同事件），再写 `knowledge` 行（`fact` 是 `line` 时查第 4 步的表）。同一个 `(factId, holderId)` 既有展开的又有明写的，明写的为准。
  6. `scene`：`changes.scene` 不为空时返回 `{ presentIds: present 解析后的 id }`，否则返回 `null`（调用方沿用父回合的场景）。
- [ ] 4. `test-support/llm-steps.ts` 加帮助函数 `changeLine(fields: Record<string, string>): string`（`JSON.stringify` 一行）和 `changeLines(...lines: Array<Record<string, string>>): string`（用 `\n` 连接）。
- [ ] 5. 测试，素材用附录 D，每条规则至少一个反例和一个正例。测试名照抄下列，断言错误文字时用 `toContain` 加上表里的固定部分：
  - `changes.test.ts`：
    - `空字符串得到空变化`
    - `不支持的类型被拒绝，并列出可用类型`（续写模式下的 `state`）
    - `开场必须恰好有一个主角`、`续写时不能新增主角`
    - `同名新人物必须声明 distinct 并写明区别`（正例：带 `distinct` 和非空 `profile` 时通过）
    - `同一次重复新增同一个名字被拒绝`
    - `引用没发过的编号被拒绝`、`可以按名字引用本次新增的人物`（引用在新增那一行之前也可以）
    - `省略目击者时默认父回合在场者加主角`（断言解析结果的 `witnesses`）
    - `场景变化时必须写明目击者`
    - `不在场又没写来源的知情被拒绝`（正例：写了 `via` 时通过；正例：持有者在本次 `scene.present` 里时通过）
    - `未确认的知情必须写主角听到的说法`
    - `L 引用必须指向本次的事实行`
    - `认识阶段只能取三个值`
    - `同一组有键事实写了两行被拒绝`
    - `多条错误一次全部返回`（一个 `changes` 里放三处不同的错误，返回三条）
  - `leak.test.ts`：
    - `正文提前出现真名被拦下`（第 2 段出现真名，`name` 行在第 3 段）
    - `同一段里先给称呼就不算泄露`（`name` 行的 `para` 等于出现真名的那一段：边界用例）
    - `推荐行动里的真名被拦下`
    - `长称呼包着短真名时不误报`（主角知道“林叔”，真名“林”只有一个字，不检查；另一个夹具：主角知道“老周头”，真名“老周”两个字，正文写“老周头”不报，写“老周”报）
    - `开场里主角自己的名字不算泄露`
  - `writer.test.ts`：
    - `写入后投影能读到`（`seedStory` 造一条路线，`writeChanges` 写一个新人物、一条事件、一条关系，再 `loadProjection`，三样都在）
    - `事件的目击者展开成确认知情`
    - `明写的知情覆盖目击者展开的`（同一人既是目击者又被明写为 `suspects`，结果是 `suspects`）
    - `开场的新实体写进两个版本，id 相同`
    - `关系的 via 指向本次新增的人物时换成真实 id`

**注意事项。**

- 返回给模型的错误文字要具体：第几行、哪个字段、为什么、怎么改。这是模型能否在两次修正内改对的关键。
- 不要在校验里查库：投影和编号簿由调用方一次准备好。
- 写入函数只写，不校验；校验全部在 `parseChanges` 和 `findLeaks` 里。调用方必须先校验通过再写（T10、T11 的接线判据会检查这一点）。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过，上面列出的用例全部在列。
- 突变一：把在场集合里“本次 `scene` 行的 `present`”去掉，`不在场又没写来源的知情被拒绝` 的第二个正例必须红。
- 突变二：把 `findLeaks` 第 4 步的 `para <= p` 改成 `para < p`，`同一段里先给称呼就不算泄露` 必须红。
- 突变三：把第 4 步“先替换已知名字”去掉，`长称呼包着短真名时不误报` 必须红。
- 突变四：把 `writer.ts` 第 5 步“明写的为准”改成“展开的为准”，`明写的知情覆盖目击者展开的` 必须红。
- 突变五：在 `parseChanges` 里遇到第一条错误就返回，`多条错误一次全部返回` 必须红。

### T10 开场写入初始事实

**目的。** 让作品从开场起就有主角和开场里出场的人物，否则第一回合的续写没有任何事实可推送，手记也是空的。预览工具多交一份 `changes`，作者在预览里看到出场人物；采用时按 D5 写入。

**依赖。** T08、T09。

**拥有的文件。** `packages/core/src/authoring/preview-tool.ts`、`preview-prompt.ts`、`service.ts` 及测试；`test-support/llm-steps.ts` 里的 `proposePreviewStep`。

**先读。** [回合循环 §10](../docs/turn-loop.md#10-开场)；[数据模型 §4](../docs/data-model.md#4-故事事实) 的“采用开场时的归属”（T00 加的）；附录 B.1、B.3；T09 的 `parseChanges`（开场模式）、`findLeaks`、`allocateEntityIds`、`writeChanges`。

**步骤。**

- [ ] 1. `preview-tool.ts`：
  - `PREVIEW_TOOL_PARAMETERS` 加两个参数，描述照抄附录 B.3：`present`（开场结束时在场的人物，逗号分隔，写本次新增人物的名字）和 `changes`（每行一个 JSON）。`required` 加上这两个。
  - `parsePreviewArgs(args)` 在现有校验之后：
    1. `paragraphs = splitParagraphs(prose)`；
    2. `parseChanges(changes, { mode: 'opening', projection: null, codebook: null, paragraphCount: paragraphs.length, parentPresentIds: [] })`；
    3. `present` 按 `/[,，、]/` 切开、去空白、去空项；每一项必须**恰好**对应本次新增的一个人物（`kind` 为 `character`，`name` 或 `knownAs` 相同），否则报 `参数 present：找不到「<名字>」，在场的人物必须是 changes 里新增的人物。`；最多 `STORY_LIMITS.presentMax` 个。把结果写成 `changes.scene = { place, time, present: [{ created: 行号 }, ...] }`；
    4. `findLeaks({ projection: null, changes, paragraphs, options: options.map((o) => o.text) })`；
    5. 全部错误合并返回。
  - 成功时返回值改成 `{ preview, changes }`：`preview.cast` 由 `changes.entities` 得到（`kind`、`name`、`knownAs`、`profile`、`protagonist`），按主角在前、其余按行号排；`changes` 是 `ValidatedChanges`。删掉 T03 写的 `cast: []`。
- [ ] 2. `preview-prompt.ts`：`PREVIEW_SYSTEM_PROMPT` 换成附录 B.1 的原文。
- [ ] 3. `authoring/service.ts`：
  - 生成任务成功时，`jobs.result` 写 `{ preview, changes, adoption: null }`。
  - `adoptPreview` 的事务里：
    1. `job.result.changes` 不存在（M1 生成的旧预览）时抛 `appError('stale_preview', 'preview predates story facts')`，界面会提示重新生成预览。
    2. `meta.opening` 加 `changes`（与预览任务里的那一份相同，留给将来的重新开局）。
    3. 插入根回合之前：`const createdIds = allocateEntityIds(changes);` 根回合的 `scene` 写 `{ place, time, present: <在场人物的真名>, presentIds: <在场人物的 id> }`。
    4. 插入根回合之后：`writeChanges(tx, { changes, createdIds, turnId: rootTurnId, versionId: publishedId, entityVersionIds: [draft.id, publishedId], entityOrigin: 'version', protagonistId: null, parentPresentIds: [] })`。
    5. `indexTurnProse(tx, rootTurnId, preview.prose)`。
    6. 其余（建发布版本、开局、路线、更新作品）不变。
  - 事务提交后不需要排队摘要：开场回合不写摘要，摘要行固定写“开场”（[回合循环 §9](../docs/turn-loop.md#9-后台摘要)）。
- [ ] 4. `test-support/llm-steps.ts` 的 `proposePreviewStep` 加两个可选参数 `present?: string[]`、`changes?: string`。省略 `changes` 时，默认生成一行主角：`{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}`，`present` 默认为空数组。这样 M1 的现有测试不用改脚本就能继续通过。
- [ ] 5. 测试（`authoring/service.test.ts`、`preview-tool.test.ts`）：
  - `预览列出开场里出场的人物`：`cast` 里主角在前，`knownAs` 原样保留。
  - `开场没有主角被拒绝并让模型修正`：第一次交的 `changes` 没有主角，第二次补上，任务成功；`turn_requests` 无关，这里断言 `jobs.status === 'done'`，并且脚本化 llm 的两步都被消耗。
  - `开场正文提前出现真名被拒绝`：新增人物真名“沈岚”，`known_as` 为“撑伞的女人”，正文第 1 段写了“沈岚”。
  - `在场人物必须是本次新增的人物`。
  - `采用开场写入主角和出场人物`：采用后，发布版本和草稿里各有同一 id 的主角和人物；根回合 `scene.presentIds` 等于在场人物的 id；主角持有对“撑伞的女人”的称呼；`prose_fts` 能查到开场正文里一个三字词。阳性对照：采用前这些表里都没有这部作品的行。
  - `旧预览不能采用`：直接在库里造一个 `result` 没有 `changes` 的预览任务，采用时抛 `stale_preview`。

**接线点。**

| 功能 | 接线位置 |
| --- | --- |
| `parseChanges`、`findLeaks` | `parsePreviewArgs`（唯一入口） |
| `allocateEntityIds`、`writeChanges`、`indexTurnProse` | `adoptPreview` 的事务 |

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把 `parsePreviewArgs` 里的 `findLeaks` 调用删掉，`开场正文提前出现真名被拒绝` 必须红。
- 突变二：把 `adoptPreview` 里的 `writeChanges` 调用删掉，`采用开场写入主角和出场人物` 必须红。
- 突变三：把 `entityVersionIds` 改成只有 `[publishedId]`，同一用例必须红（草稿里没有）。
- 突变四：把 `indexTurnProse` 调用删掉，同一用例必须红（查不到开场正文）。

### T11 回合的推送与拉取

**目的。** 本里程碑的核心：续写时，core 把约束性材料、当前场景、索引、最近原文和更早回合的摘要直接放进 prompt（推送），细节由模型用 7 个只读工具查（拉取）；模型交上来的 `changes` 校验通过后，与回合在同一事务里写入。它兑现[回合循环 §1、§3–§6](../docs/turn-loop.md#1-一回合的流程)在本里程碑范围内的部分。

**依赖。** T05（`RuntimeTarget` 带参数）、T08、T09、T12（`SummaryService.enqueue` 的真实现；只依赖接口时也可以先开工，测试里用 `createRecordingSummary`）。

**拥有的文件。** `packages/core/src/play/context.ts`、`narrator-prompt.ts`、`propose-turn-tool.ts`、`service.ts` 及测试；`packages/core/src/story/tools.ts` 及测试。

**先读。** [回合循环 §1–§6、§9、§11](../docs/turn-loop.md#1-一回合的流程)；附录 B.2、B.3、B.4、C；T08、T09 的全部接口；现有的 `play/` 全部文件。

**步骤。**

- [ ] 1. `narrator-prompt.ts`：`NARRATOR_SYSTEM_PROMPT`、`PROPOSE_TURN_DESCRIPTION` 换成附录 B.2 的原文。
- [ ] 2. `propose-turn-tool.ts`：
  - `PROPOSE_TURN_PARAMETERS` 的 `changes` 描述换成附录 B.3 的原文；其余参数不变。
  - `parseProposeTurnArgs(args)` 去掉 `parentScene` 参数和场景解析，只校验 `prose`、`options`、`ending` 三项（规则同 M1），并把 `changes` 原样作为字符串返回：

    ```ts
    export interface ProposedTurnDraft {
      prose: string;
      paragraphs: string[];
      options: StoredOption[];
      changesRaw: string;
    }
    export function parseProposeTurnArgs(args: Record<string, unknown>): ParseResult<ProposedTurnDraft>;
    ```

  - `changes` 的解析和校验交给 `story/changes.ts`（见步骤 5）。
- [ ] 3. `context.ts` 重写：

  ```ts
  export interface NarratorContextInput {
    meta: VersionMeta;
    projection: StoryProjection;
    codebook: CodeBook;
    action: StoredAction;
    model: ResolvedModel;
    estimateTokens(text: string): number;
    toolSchemaText: string;
  }

  export type NarratorContext =
    | {
        ok: true;
        system: string;
        prompt: string;
        includedTurns: number;
        omittedTurns: number;
        summaryLines: number;
        indexEntities: number;
        contextTokens: number;
      }
    | { ok: false; code: 'context_too_small' };

  export function buildNarratorContext(input: NarratorContextInput): NarratorContext;
  ```

  各块的格式照附录 C.1，按下面的顺序和预算组装（[回合循环 §3](../docs/turn-loop.md#3-上下文哪些直接给哪些让模型查)“预算”）：
  1. `budget = model.contextWindow - model.maxOutputTokens - estimateTokens(toolSchemaText) - estimateTokens(NARRATOR_SYSTEM_PROMPT)`。
  2. **必需材料**：作品设定块、叙事要求块、主角块、当前场景块、最新回合（head）的原文块、玩家行动块。估算之和超过预算 → `{ ok: false, code: 'context_too_small' }`。不截断任何必需材料。
  3. 先为三条省略说明各预留一份最坏情况的长度（数字按 `99999` 估算）：索引的省略说明、回合的省略说明。
  4. **索引**：`未了结的约定` 块整块放入（放不下时只放能放下的前几行，并在块末写明“另有 N 条约定未列出，可用 list_catalog 查看”）。然后是实体索引：除主角外的全部可见实体，先已出场的，再未出场的；每组内按 `originDepth` 从大到小，相同时按真名的码位升序（附录 C.1，排序必须确定，否则编号会随运行变化）；一条一条加，放不下就停，剩下的写一行省略说明（附录 C.1）。
  5. **更早的回合原文**：从 head 的父回合往开场方向一个一个加原文块，放不下就停。
  6. **摘要行**：剩下没放原文的回合，从新到旧一条一条加摘要行（有摘要用摘要；没有摘要时用 `玩家行动：<原话>`；开场回合固定写 `开场`），放不下就停。
  7. 还剩没放下的回合，写一行回合的省略说明：`另有 <N> 个更早的回合未列出，可用 search_story 或 read_turn 取回。`
  8. 拼接顺序照附录 C.1。`contextTokens` 是最终 `prompt` 的估算值。
  编号：渲染任何实体、事实时都经过 `codebook`（`entityCode`、`factCode`），这样模型只看得到、也只能引用本次真正给出的编号。
- [ ] 4. `story/tools.ts`（新建）：

  ```ts
  export interface StoryToolsInput {
    db: Database;
    projection: StoryProjection;
    codebook: CodeBook;
    log: TurnRequestLog;
    onSample(sample: { tool: string; records: number; ok: boolean; durationMs: number }): void;
  }

  export const STORY_TOOL_NAMES = ['get_character', 'get_place', 'get_entity', 'list_catalog', 'who_knows', 'search_story', 'read_turn'] as const;

  export function createStoryTools(input: StoryToolsInput): LlmTool[];
  export function storyToolSchemaText(): string;
  ```

  - 每个工具的名字、参数、说明照抄附录 B.4。参数全部是字符串。
  - `LlmTool` 类型从 `../llm/types.ts` 导入（只导入类型，`import type`）。这是 `story/` 唯一一处对 `llm/` 的依赖，而且只是类型；core 规范 §1 的判据命令用的是 `from '\.\./llm/` 的模式，`import type` 也会被它匹配到。为了让判据保持简单，把 `LlmTool` 的类型定义在 `story/tools.ts` 里本地声明一份结构相同的 `interface StoryTool { name; description; parameters; execute(args): Promise<{ text: string; terminate: boolean }> }`，返回 `StoryTool[]`；`play/service.ts` 把它们当 `LlmTool` 用（结构兼容，TypeScript 会检查）。
  - 每个工具的 `execute(args)`：
    1. 记开始时间；
    2. 读出字符串参数，缺了或类型不对时抛 `new Error('参数 <名> 必须是字符串。')`；
    3. 用 `codebook` 解析编号或名字，失败时抛 `new Error(<codebook 给出的错误>)`；
    4. 用 `render.ts` / `search.ts` 生成结果文字，经 `clipToolResult`；
    5. 往 `log` 里追加 `{ tool, ok, errors, args, records }`：`records` 是这次结果里涉及的实体和事实的真实 id；
    6. 调用 `onSample`；
    7. 成功返回 `{ text, terminate: false }`；失败重新抛出同一个错误（pi-agent-core 会把它作为工具错误交还给模型，[回合循环 §6](../docs/turn-loop.md#6-校验与保存)）。
  - 各工具的取数：

    | 工具 | 取数 |
    | --- | --- |
    | `get_character` | `target` 解析成实体，种类必须是 `character`（否则报 `<编号> 不是人物，请用 get_place 或 get_entity。`），`renderEntityDetail` |
    | `get_place` | 同上，种类必须是 `place` |
    | `get_entity` | 种类是 `item`、`group`、`other` 之一 |
    | `list_catalog` | `category` 必须是 `CATALOG_CATEGORIES` 之一；`cursor` 可为空串（从 0 开始）或非负整数字符串；`renderCatalogPage` |
    | `who_knows` | `fact` 必须是 `#数字`；`renderWhoKnows` |
    | `search_story` | `query`；`searchStory` + `renderSearchHits` |
    | `read_turn` | `turn` 是 `T数字`；`codebook.resolveTurn`；`renderTurnText` |

  - `storyToolSchemaText()`：把 7 个工具的 `name`、`description`、`JSON.stringify(parameters)` 依次拼接，用于预算估算和 token 棘轮。
- [ ] 5. `play/service.ts` 的 `runTurnRequest`：
  1. 取祖先链后：`const projectionStarted = performance.now(); const projection = loadProjection(deps.db, { versionId: playthrough.versionId, chain });`，记 `story.projection` 样本（`requestId`、`attempt`，`data` 为三项条数）。`const codebook = createCodeBook(projection);`
  2. `toolSchemaText` 改成 `storyToolSchemaText() + JSON.stringify(PROPOSE_TURN_PARAMETERS) + PROPOSE_TURN_DESCRIPTION`。
  3. `buildNarratorContext` 按新签名调用；`turn.context` 样本的 `data` 加 `contextTokens`、`indexEntities`、`summaryLines`。
  4. `tools = [...createStoryTools({ db: deps.db, projection, codebook, log, onSample: (s) => deps.logger.sample({ metric: 'story.tool', durationMs: s.durationMs, outcome: s.ok ? 'ok' : 'error', requestId, attempt: request.attempts, data: { tool: s.tool, records: s.records } }) }), proposeTool]`。
  5. `proposeTool.execute(args)`：`parseProposeTurnArgs(args)`；成功后 `parseChanges(draft.changesRaw, { mode: 'turn', projection, codebook, paragraphCount: draft.paragraphs.length, parentPresentIds: presentIdsAtHead(projection) })`；再 `findLeaks({ projection, changes, paragraphs: draft.paragraphs, options: draft.options.map((o) => o.text) })`。三处的错误合并；有错误时记事件 `turn.changes.rejected`（`data: { attempt, errorCount }`），其余照 M1 的修正逻辑（最多修正 `MAX_CORRECTIONS` 次）。都通过时保存 `{ draft, changes }`，返回 `{ text: '已收到。', terminate: true }`。
  6. 提交事务里，在插入回合行之前：`const createdIds = allocateEntityIds(changes);` 场景：`changes.scene` 不为空时 `{ place, time, present: <真名>, presentIds: <解析后的 id> }`；为空时沿用父回合的 `scene`。插入回合行之后：`writeChanges(tx, { changes, createdIds, turnId, versionId: playthrough.versionId, entityVersionIds: [playthrough.versionId], entityOrigin: 'turn', protagonistId: projection.protagonistId, parentPresentIds: presentIdsAtHead(projection) })`；`indexTurnProse(tx, turnId, draft.prose)`。其余（推进 head、标记请求完成）不变。
  7. 事务提交、事件发布之后：`deps.summary.enqueue(turnId, route.id)`。
  8. `getJournal(input)`：照 `getRoute` 取路线、开局、版本、祖先链；`loadProjection`；返回 `buildJournal(projection, route.id)`。
- [ ] 6. 测试。现有的 `play/service.test.ts` 里用名字写 `present` 的场景脚本，改成引用实体（例如开场新增的人物）；只改脚本数据，不放松断言。新增用例（`play/service.test.ts`、`play/context.test.ts`、`story/tools.test.ts`）：
  - `context.test.ts`：
    - `必需材料放不下时失败`（保留 M1 的用例，改成新签名）。
    - `索引先列已出场的实体`：夹具里三个已出场、三个未出场，预算只够放四条，结果里三个已出场的都在、未出场的只有一条，并有一行“另有 2 个未出场的人物和地点”。
    - `原文放不下的回合改用摘要行，摘要缺失时用玩家行动`。
    - `省略的回合有明确说明`（断言 prompt 含 `可用 search_story 或 read_turn 取回`，字面量）。
    - `编号只给出现在上下文里的实体`：被预算挤掉的实体没有编号；用它的真名调用 `codebook.resolveEntity` 失败（只在已发编号的实体里按名字找）。阳性对照：留在索引里的实体，用真名能解析到。
    - `上下文的 token 棘轮`：用附录 D 的固定夹具，断言 `estimateTokens(prompt)` 等于一个写死的数（实现完成后跑一次得到，填进测试）。改动附录 C 的任何格式都会让它红，红了要在汇报里写清涨幅来自哪一块（core 规范 §4）。
  - `story/tools.test.ts`：
    - 7 个工具各一条成功用例，断言结果文字逐字等于附录 C 的示例。
    - `工具调用记进请求足迹`：`log` 里有工具名、参数和记录 id。
    - `查不到时把错误交还给模型`：`get_character` 用没发过的编号，`execute` 抛错，错误文字含 `不是本次给出的编号`；`log` 里这一条 `ok === false`。
    - `只读工具不写库`：调用全部 7 个工具前后，`entities`、`entity_names`、`facts`、`knowledge`、`turn_summaries` 五张表的行数不变。阳性对照：同一个测试里 `log` 增加了 7 条。
    - `工具说明的 token 棘轮`：`estimateTokens(storyToolSchemaText())` 等于一个写死的数。
  - `play/service.test.ts`：
    - `交上来的事实与回合一起提交`：脚本让模型交一回合，`changes` 新增一个人物、一条事件；提交后投影里两样都在，事件的目击者有知情记录；`prose_fts` 能查到新回合。
    - `事实不合格时回合不提交，修正后提交`：第一次交的 `changes` 引用了没发过的编号，第二次改对；最终只有一个新回合，`turn.changes.rejected` 事件记了一次。
    - `修正两次仍不合格时失败，不写任何事实`：三次都交坏的；请求以 `invalid_output` 失败，路线 head 不变，五张事实表的行数不变。阳性对照：同一个测试开头，开场的事实行数大于 0。
    - `过期的请求不写事实`：提交前把路线 head 推走（模拟另一个标签页先提交），请求变成 `superseded`，事实表行数不变。
    - `提交后排队摘要`：`createRecordingSummary` 收到一条，`turnId` 等于新回合。
    - `模型能用工具查旧事并据此续写`：开场有人物“守夜人”（主角）和“沈岚”；脚本第一步调用 `get_character` 查 `@2`，第二步交回合；断言请求足迹里有 `get_character`，伪造的模型输入里（`scriptedLlm.runs[0].prompt`）含 `@2`。
    - `手记只给主角知道的`：调用 `getJournal`，结果与 `buildJournal` 对同一投影的结果相同；并且有一个主角不知道称呼的人物不在其中。

**接线点。**

| 功能 | 接线位置 | 摘除后应当红的用例 |
| --- | --- | --- |
| `loadProjection` | `runTurnRequest`、`getJournal` 各一处 | `交上来的事实与回合一起提交`、`手记只给主角知道的` |
| `createStoryTools` | `runTurnRequest` 的 `tools` | `模型能用工具查旧事并据此续写` |
| `parseChanges` | `proposeTool.execute` | `事实不合格时回合不提交，修正后提交` |
| `findLeaks` | `proposeTool.execute` | 新增一条 `正文提前出现真名时回合不提交`（复用 T09 的泄露夹具） |
| `writeChanges`、`indexTurnProse` | 提交事务 | `交上来的事实与回合一起提交` |
| `summary.enqueue` | 提交之后 | `提交后排队摘要` |

**注意事项。**

- 投影和编号簿在一次请求的整个工具循环里共用同一份，不要在工具里重新读投影：同一次请求里模型看到的编号必须一直有效。
- 工具不写库（§0.2）。只有 `propose_turn` 校验通过后，在提交事务里写入。
- 提交事务里不 `await`。`allocateEntityIds`、`writeChanges`、`indexTurnProse` 都是同步的。
- 事务失败时整体回滚：回合、事实、索引一起没有。不要把事实写入放到事务外面。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 接线点表里每一行都做一次摘除突变（把那一行调用删掉或换成空操作），对应的用例必须红。逐行写进汇报。
- 突变：把 `context.ts` 第 4 步“先列已出场的”的排序去掉，`索引先列已出场的实体` 必须红。
- `grep -rnE "from '\.\./(llm|api|play|authoring)/" packages/core/src/story` 零命中（含 `story/tools.ts`）。

### T12 后台摘要队列

**目的。** 每个回合提交后，用 `background` 用途的模型写一两句摘要（[回合循环 §9](../docs/turn-loop.md#9-后台摘要)）。摘要是更早回合的索引行：原文放不下时，模型靠它判断要不要用 `read_turn` 回去翻原文。摘要失败不影响游玩。

**依赖。** T04（`turn_summaries`）、T05（`complete()`）。

**拥有的文件。** `packages/core/src/summary/queue.ts`、`summary/prompt.ts` 及测试；`app.ts` 里调用 `summary.backfill()` 的那几行。

**先读。** [回合循环 §9](../docs/turn-loop.md#9-后台摘要)；[数据模型 §6](../docs/data-model.md#6-派生数据)；附录 B.5；T03 的 `SummaryService` 接口；T05 的 `complete()`。

**步骤。**

- [ ] 1. `summary/prompt.ts`：导出附录 B.5 的 `SUMMARY_SYSTEM_PROMPT`，以及：

  ```ts
  export const SUMMARY_LIMITS = { maxChars: 200, maxOutputTokens: 512 } as const;
  export function buildSummaryPrompt(input: { depth: number; action: string | null; prose: string; language: string }): string;
  ```

  `buildSummaryPrompt` 的格式：

  ```
  【作品语言】<language>
  【回合】T<depth>
  【玩家行动】<action>
  【正文】
  <prose>
  ```

- [ ] 2. `summary/queue.ts`，替换 T03 的占位：

  ```ts
  export const SUMMARY_CONCURRENCY = 1;
  export const SUMMARY_BACKFILL_DAYS = 7;
  export const SUMMARY_BACKFILL_MAX = 200;
  ```

  - `enqueue(turnId, routeId)`：`deps.shutdown.aborted` 时直接返回；否则把 `run(turnId, routeId)` 加进 `PQueue`（并发 `SUMMARY_CONCURRENCY`），`.catch` 里记 `summary.failed`（`code: 'internal'`）。
  - `run(turnId, routeId)`：
    1. 记开始时间。读回合；不存在、深度为 0、或已有摘要 → 直接返回（不记失败）。
    2. 读开局和版本，取作品语言（`meta.narration?.language ?? 'zh-CN'`）和 `workId`。
    3. `deps.llm.resolve('background')` 为 `null` → 记 `summary.failed`（`code: 'llm_not_configured'`）并返回。
    4. 调用 `deps.llm.complete({ purpose: 'background', system: SUMMARY_SYSTEM_PROMPT, prompt, sessionId: routeId, ref: { kind: 'turn', id: turnId, attempt: 1, workId }, maxOutputTokens: SUMMARY_LIMITS.maxOutputTokens, signal: deps.shutdown })`。
    5. 整理结果：所有空白（含换行）合成一个空格，`trim`，按 `Array.from` 截到 `SUMMARY_LIMITS.maxChars`。为空 → 记 `summary.failed`（`code: 'invalid_output'`）。
    6. 写入只在回合仍存在时生效（[数据模型 §6](../docs/data-model.md#6-派生数据)“派生数据不需要版本栅栏”）：`insert into turn_summaries (turn_id, summary, created_at) select ${turnId}, ${summary}, ${Date.now()} where exists (select 1 from turns where id = ${turnId}) on conflict(turn_id) do nothing`。
    7. 记 `summary.done` 事件和 `summary.total` 样本（`workId`，`data: { turnId }`）。
    8. `LlmRunError` → 记 `summary.failed`（`code: error.code`）和 `summary.total` 样本（`outcome: 'error'`）。
  - `backfill()`：找最近 `SUMMARY_BACKFILL_DAYS` 天内 `updated_at` 有变化的路线；对每条路线取祖先链（用 `play/chain.ts` 的 `ancestorChain`；`summary/` 可以导入 `play/chain.ts`，它不是 `story/`），收集深度大于 0、没有摘要的回合，按深度从大到小排；全部路线合起来最多 `SUMMARY_BACKFILL_MAX` 个，逐个 `enqueue`。返回排进去的个数。
  - `whenIdle()`：`queue.onIdle()`。
- [ ] 3. `app.ts`：在恢复中断任务之后、开始监听之前，调用 `summary.backfill()`，结果记进 `recovery.interrupted` 事件的 `data`（新增字段 `summaries`）。
- [ ] 4. 测试（`summary/queue.test.ts`，用 `createScriptedLlm` 的 `text` 步骤）：
  - `回合提交后写入摘要`：`enqueue` 后 `whenIdle`，`turn_summaries` 有这一行；`scriptedLlm.completes[0].purpose === 'background'`（字面量）。
  - `摘要里的换行被合并，超长被截断`：模型返回 300 字、含换行的文字，存下的是一行、200 字。
  - `后台模型未配置时记失败，不抛错`：`setResolved(null)`，`enqueue` 后 `whenIdle` 正常结束，没有摘要行，诊断事件里有 `summary.failed`。
  - `回合在生成期间被删除时不写入`：在脚本步骤返回之前删掉回合（用一个自定义 `complete` 实现：先删回合再返回文字），结束后没有摘要行，也没有抛错。
  - `开场回合不写摘要`。
  - `启动补排只补最近活跃路线上缺摘要的回合`：两条路线，一条 `updated_at` 是 10 天前；补排只覆盖另一条，且已有摘要的回合不重复排。

**完成判据。**

- `pnpm --filter @unwritten/core test` 通过。
- 突变一：把第 6 步的 `where exists (...)` 去掉，`回合在生成期间被删除时不写入` 必须红（外键会让插入失败，`run` 抛错；断言“没有抛错、也没有记 `internal`”）。
- 突变二：把 `backfill` 里的天数条件去掉，`启动补排只补最近活跃路线上缺摘要的回合` 必须红。
- `grep -rn "not implemented: summary" packages/core/src` 零命中。

### T13 设置页

**目的。** 设置页是作者接入模型、调参数、选外观的地方。本任务按 T02 的稿子重做：三张用途卡（默认、游玩、后台摘要），每张卡选模型、设生成参数、测试；端点列表（一个端点多个模型，可改能力、可删除）；添加端点；外观与阅读偏好。

**依赖。** T07。core 端的过程（T05、T06）还没合并时，测试里用 `createFakeApi`。

**拥有的文件。** `apps/client/src/features/settings/*`、`src/i18n/zh-CN/settings.json`。

**先读。** [LLM 端点 §6–§7](../docs/llm-endpoints.md#6-自定义端点)（T00 改过的版本）；[主题与 token §9](../docs/theme.md#9-外观偏好与切换)；[设计准则 §4、§9](../docs/design-guidelines.md#4-布局)；`tasks/assets/milestone-2/settings-*.png`；T03 的契约；T07 的部件和夹具；附录 A.6。

**步骤。**

- [ ] 1. 文件拆分（每个组件一个文件，同名 `.module.css`）：

  | 文件 | 内容 |
  | --- | --- |
  | `SettingsPage.tsx` | `Page`（`title = t('settings:page.heading')`，`back = { to: '/', label: t('common:nav.library') }`，`width: 'page'`）；依次渲染 `ConfigProblem`、`PurposeSection`、`EndpointSection`、`AddEndpointForm`、`AppearanceSection`，每节是一个带 `h2` 的 `section` |
  | `ConfigProblem.tsx` | 配置文件无效或版本过高时的提示（沿用 M1 的三种问题文案），用 `ErrorNotice` 的样式；此时其余写操作全部禁用 |
  | `PurposeSection.tsx`、`PurposeCard.tsx` | 三张用途卡 |
  | `GenerationParamsForm.tsx` | 一个用途的参数表单 |
  | `params-form.ts` | 纯函数：参数表单的状态 ↔ `GenerationParams`，以及每一项是否可用、为什么不可用 |
  | `EndpointSection.tsx`、`EndpointCard.tsx`、`ModelRow.tsx` | 端点列表、端点卡、模型行 |
  | `AddEndpointForm.tsx` | 添加端点（沿用 M1 的字段和测试连接） |
  | `AppearanceSection.tsx` | 外观与阅读偏好，含示例段落 |
  | `labels.ts` | 枚举值到文案键的对照表：`PURPOSE_LABEL_KEYS`、`THINKING_LEVEL_LABEL_KEYS`、`THINKING_FORMAT_LABEL_KEYS`、`PROBLEM_LABEL_KEYS` |
  | `endpoint-edit.ts` | M1 留下的纯函数，按多模型改写或删除（看是否还有用处） |

- [ ] 2. `params-form.ts`：

  ```ts
  export interface ParamsFormState {
    thinking: ThinkingLevel | 'unset';
    thinkingBudget: number | null;
    temperature: number | null;
    topP: number | null;
    topK: number | null;
    minP: number | null;
  }

  export function formFromParams(params: GenerationParams): ParamsFormState;
  export function paramsFromForm(form: ParamsFormState): GenerationParams;
  export function fieldAvailability(
    form: ParamsFormState,
    model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat } | null,
  ): {
    thinking: { enabled: boolean; reasonKey: string | null };
    thinkingBudget: { enabled: boolean; reasonKey: string | null };
    samplingWarningKey: string | null;
  };
  ```

  - `thinking` 用 `'unset'` 表示“不设置”（下拉里的第一项），转回参数时变成 `null`。
  - `fieldAvailability`：
    - `model` 为 `null` 或 `model.reasoning === false`：`thinking` 不可用，原因 `settings:params.reason.noReasoning`（`model` 为 `null` 时原因 `settings:params.reason.noModel`）；
    - `thinkingBudget` 只在 `model.thinkingFormat === 'qwen'` 且 `thinking` 不是 `'unset'` 也不是 `'off'` 时可用；不可用时原因依次为：写法不是 `qwen` → `settings:params.reason.budgetFormat`；档位没开 → `settings:params.reason.budgetNeedsThinking`；
    - `samplingWarningKey`：`thinking` 不是 `'unset'` 也不是 `'off'`，且四个采样参数里至少一个不为 `null` 时为 `settings:params.samplingWarning`，否则为 `null`（A4）。
  - 这些规则和 core 的 `paramsProblem`（T05）是同一条判据的两份实现：core 是守卫，client 是提前告诉用户。测试里两边都用同一张表驱动的用例（见步骤 7）。
- [ ] 3. `PurposeCard`（每个用途一张，`Card as='section'`，标题 `h3` 是用途名）：
  - 显示当前实际使用的模型：`<端点名> · <模型 id>`（模型 id 用 `typography.mono`）；`inherited` 时加一个中性徽标“使用默认模型”；`problem` 不为空时加一个警告徽标和原因文字（`PROBLEM_LABEL_KEYS`）。
  - 模型下拉：选项是全部端点下的全部模型（`<端点名> · <模型 id>`）；`narrator`、`background` 另有第一项“使用默认模型”（值为空串，保存时 `model: null`）。
  - `GenerationParamsForm`：思考档位（`Select`，第一项“不设置”，然后七个档位）、思考预算（`NumberField`）、`temperature`（`NumberField`，0–2，步长 0.1）、`top_p`（0–1，步长 0.05）、`top_k`（正整数）、`min_p`（0–1，步长 0.01）。不可用的项禁用，并在 `description` 里写原因；有 `samplingWarningKey` 时在表单末尾显示提示文字（带 `TriangleAlert` 图标）。选了“使用默认模型”时，参数表单整体禁用，并说明“使用默认模型的参数”。
  - 按钮：`保存`（`secondary`；整页没有主按钮：设置页每张卡同等重要，[设计准则 §2](../docs/design-guidelines.md#2-七条准则)“一屏只有一个主要操作”这里没有单一主操作）、`测试这个用途`（`text`）。保存调用 `llm.purposes.set({ baseRevision, purpose, model, params })`；测试调用 `llm.test({ purpose })`，结果显示在卡内（成功：成功徽标 + `settings:endpoint.testOk`；失败：`errors:<code>` + 详情）。
  - 本地表单状态在服务端值变化时**不覆盖**未保存的修改（client 规范 §8）：用“表单是否改过”的标记，改过就保留本地值，并显示“有未保存的修改”。
  - `thinking_unsupported`、`config_conflict` 错误：显示错误，保留表单；`config_conflict` 时重新读取配置。
- [ ] 4. `EndpointCard`：
  - 头部：端点名、地址（`mono`）、key 状态徽标（沿用 M1 文案）、更多操作菜单（`OverflowMenu`：“修改名称和 key”“删除端点”）。
  - 模型列表：每行一个 `ModelRow`：模型 id（`mono`）、工具调用徽标（是 / 否 / 未知）、“支持思考”单选（是 / 否 / 未知）、“思考写法”下拉（七项，`THINKING_FORMAT_LABEL_KEYS`）、`删除模型`（`text` 按钮，`danger` 文字）。改“支持思考”或“思考写法”后立即调用 `llm.models.update`。删除模型先 `ConfirmDialog`（`tone: 'danger'`），描述里列出会被清除的用途（从 `purposes` 里找 `model` 指向它的）。只剩一个模型时“删除模型”禁用，`description` 说明原因。
  - 模型列表下方：`添加模型`（一个 `TextField` + `secondary` 按钮），调用 `llm.models.add`。
  - 删除端点：`ConfirmDialog`（`tone: 'danger'`），描述列出会被清除的用途；确认后调用 `llm.endpoints.remove`，成功后 `useNotify` 提示“端点已删除”。
  - 修改名称和 key：展开一个内联表单（沿用 M1 的 `keep` / `set` / `remove` 逻辑），调用 `llm.endpoints.update` 时**不传** `modelId`。
- [ ] 5. `AddEndpointForm`：沿用 M1 的字段（名称、地址、模型 id、可选 key、设为默认）、测试连接（草稿形状）和保存逻辑，换成新部件。地址是 `http` 且主机不是本机回环地址、而这次会带 key 时，显示警告（M1 已有的规则）。
- [ ] 6. `AppearanceSection`：
  - 四个 `RadioGroup`：外观（跟随系统 / 浅色 / 深色）、正文字号（五档：很小 / 小 / 标准 / 大 / 很大）、正文字体（衬线 / 无衬线）、行距（舒适 / 紧凑）。
  - 下方一段示例正文（文案 `settings:appearance.sample`），用正文的字体、字号、行距 token 排版，放在纸色底上，让用户看到效果。
  - 改任一项：立即 `applyAppearance(新值)`（乐观更新，只用 `queryClient.setQueryData(queryKeys.settings, 新值)`，client 规范 §8），然后调用 `settings.update`；失败时把根属性和查询缓存恢复成旧值，并 `useNotify` 提示“外观设置没有保存”。
  - 读取：`useQuery({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() })`。
- [ ] 7. 测试（`renderRoute('/settings', { api: createFakeApi({...}) })`）：
  - `params-form.test.ts`：表驱动用例，至少覆盖 T05 `思考参数的拒绝条件` 里的全部组合；对每一组，断言 `fieldAvailability` 给出的“可用”与 core 的结果一致（把 T05 的那张表复制过来作为字面量；两边各自一份表，是因为 client 测试不能导入 core）。另加 `不设置转回 null`。
  - `labels.test.ts`：对 `PURPOSES`、`THINKING_LEVELS`、`THINKING_FORMATS` 的每一个值都能在 `settings.json` 里查到非空文案（从 contracts 的常量现取；先断言常量长度分别为 3、7、7）。
  - `SettingsPage.test.tsx`：
    - `无可访问性违规`、`标题大纲正确`（`expectHeadingOutline`）。
    - `保存用途时发送模型和参数`：选模型、把思考设为“高”、`temperature` 填 0.7，点保存；断言 `calls` 里 `llm.purposes.set` 的输入（`params.thinking === 'high'`、`params.temperature === 0.7`），不断言按钮状态（client 规范 §11）。
    - `模型不支持思考时思考档位禁用并说明原因`。
    - `预算只对 qwen 写法可用`。
    - `同时设思考和采样参数时出现提示`；阳性对照：只设采样参数时没有提示。
    - `删除模型前确认，并列出会清除的用途`。
    - `端点只剩一个模型时不能删除模型`。
    - `修改端点时不发送 modelId`：断言 `llm.endpoints.update` 的输入里没有 `modelId` 键。
    - `改外观立即生效，保存失败时恢复`：`settings.update` 拒绝；点“深色”后根元素 `data-uw-appearance` 先变成 `dark`，失败后变回原值，并出现通知。
    - `服务端配置变化不覆盖未保存的表单`：改了表单但没保存时，让假 API 返回新的配置并失效查询，表单里仍是本地值。
- [ ] 8. `settings.json` 按附录 A.6 写全。M1 已有的键保留，用不到的删除（键测试会列出未使用的键）。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：把 `fieldAvailability` 里“写法不是 qwen”的判断去掉，`预算只对 qwen 写法可用` 必须红。
- 突变二：把 `AppearanceSection` 失败时的恢复去掉，`改外观立即生效，保存失败时恢复` 必须红。
- 突变三：把 `PurposeCard` 的“改过就保留本地值”去掉，`服务端配置变化不覆盖未保存的表单` 必须红。

### T14 作品库与创作页

**目的。** 作品库是应用的门面，创作页是作者写下第一句话的地方。按 T02 的稿子重做：作品库是卡片网格，每张卡一个主入口；创作页的背景自动保存，预览按玩家看到的版式排出开场并列出出场人物，过期的预览明确标出。

**依赖。** T07。

**拥有的文件。** `apps/client/src/features/library/*`、`src/features/authoring/*`、`src/i18n/zh-CN/library.json`、`authoring.json`。

**先读。** [创作流程 §1、§2、§4、§6](../docs/authoring-flow.md#1-从作品库新建或接着上次的工作)；[设计准则 §4、§9](../docs/design-guidelines.md#4-布局)；`tasks/assets/milestone-2/library-*.png`、`authoring-*.png`；[运行诊断 §3](../docs/diagnostics.md#3-性能样本) 的 `client.library_ready`、`client.preview_visible`（M1 已接入，改写时保留）；附录 A.3、A.4。

**步骤。**

- [ ] 1. 作品库，文件：`LibraryPage.tsx`、`WorkCard.tsx`、`DeleteWorkDialog.tsx`（各带 `.module.css`）。
  - `Page`：`title = t('library:page.heading')`，没有返回，`tools` 是一个 `IconButton`（`Settings` 图标，`label = t('common:nav.settings')`，链接到 `/settings`）。工具行下方是页头：`Logo`（`withWordmark`）和主按钮“新建故事”。
  - 加载中：`Skeleton variant='card' count={3}`。空库：`EmptyState`（`headingLevel={2}`，标题、描述见附录 A.3，`action` 是“新建故事”按钮）。读取失败：`ErrorNotice`。
  - 网格：`display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--uw-size-card-min), 1fr));`，间距用 token。
  - `WorkCard`（`Card as='article'`）：标题 `h2`（`title ?? label`，都没有时用 `library:card.untitled`）；简介（有就显示，原样显示，不截断）；状态徽标（草稿：中性；可玩：成功色，带图标）；更新时间（`formatRelative`）；**一个**主入口，用 `buttonClassName('primary')` 的 `<Link>`：草稿 → “继续创作”到编辑页；可玩无进度 → “开始故事”；可玩有进度 → “继续游玩”到游玩页（[设计准则 §9](../docs/design-guidelines.md#9-部件)“主入口是卡片上的按钮，整张卡不做成一个大按钮”）。可玩作品另有一个 `text` 链接“查看创作稿”到编辑页。右上角 `OverflowMenu`，`label = t('library:card.more', { title })`，只有一项“删除作品”（`tone: 'danger'`）。
  - 一屏只有一个主按钮：页头的“新建故事”是主按钮时，卡片上的主入口用 `secondary`。按 T02 的稿子定，稿子没定时用这条。
  - `DeleteWorkDialog`：`ConfirmDialog tone='danger'`，标题 `library:delete.title`（插值作品名），描述 `library:delete.description`；确认调用 `works.delete`，成功后 `useNotify({ title: t('library:delete.done'), tone: 'success' })`，并失效 `queryKeys.works`。
  - 保留 M1 的 `client.library_ready` 上报。
- [ ] 2. 创作页，文件：`AuthoringPage.tsx`、`BackgroundEditor.tsx`、`PreviewPanel.tsx`、`CastList.tsx`、`PublishedPanel.tsx`。
  - `Page`：`title` 是作品的 `title ?? label`，都为空时用 `authoring:page.heading`；`back` 回作品库；`width: 'prose'`。
  - `BackgroundEditor`：`TextArea`（标签“故事背景”，`placeholder` 是起笔提示 `authoring:background.placeholder`，`description` 是 `authoring:background.help`）。用 `useAutosave`：`value` 是本地文本，`savedValue` 是服务端的 `draft.background`，`delayMs = AUTOSAVE_DELAY_MS`（常量 `800`，写在本文件），`save` 调用 `works.saveBackground`（带 `baseContentRev`）。输入框下方一行状态：`pending` / `saving` 显示“正在保存”，`saved` 显示“已保存”，`error` 显示 `errors:<code>`。`stale_revision` 时重新读取作品，保留本地文本，状态显示“草稿已在别处更新”。作品已发布时只读。
  - 生成按钮（主按钮“生成开场预览”）：点击时先开始 `client.preview_visible` 计时，`await autosave.flush()`，再用最新的 `contentRev` 调 `works.generatePreview`。背景为空时禁用。生成中显示 `GeneratingMarker`（`authoring:preview.running`），并经 `LiveRegion` 播报。
  - `PreviewPanel`：标题 `h2`“预览开场”。依次是：作品标题（`h3`）、简介、公开设定、`CastList`、开场正文（用正文的字体、字号、行距和纸色底排版，与游玩页一致，按 `paragraphs` 分段；预览数据里没有 `paragraphs`，用 `prose.split(/\n{2,}/)` 显示即可，这里不涉及段号）、推荐行动（只读列表，前面是序号）。
  - 预览过期（任务的 `basedOnContentRev` 不等于草稿的 `contentRev`，或本地有未保存的修改）：在预览标题旁显示警告徽标“已过期”，说明 `authoring:preview.staleHelp`，采用按钮禁用。
  - `CastList`：`h3`“出场人物”；每人一行：名字（主角加中性徽标“主角”），`knownAs` 不为空且和名字不同时显示“主角称作：<knownAs>”，下一行是 `profile`（次要文字）。作者视角可以看到真名（[数据模型 §5](../docs/data-model.md#5-可见性规则)“作者”视角）。
  - 采用按钮（`secondary`，因为主按钮是“生成开场预览”）“采用开场并存入作品库”。`stale_preview` 错误显示 `errors:stale_preview`，提示重新生成。
  - `PublishedPanel`：已发布时替换生成区域：标题“已存入作品库”，主按钮“开始故事”（到游玩页），`text` 链接“返回作品库”。
  - 保留 M1 的 `client.preview_visible` 上报逻辑（按 `jobId` 匹配，见[运行诊断 §3](../docs/diagnostics.md#3-性能样本)）。
- [ ] 3. 文案按附录 A.3、A.4 写全。
- [ ] 4. 测试：
  - `LibraryPage.test.tsx`：`无可访问性违规`、`标题大纲正确`；`空库时引导新建`；`每张卡只有一个主入口`（每个 `article` 里，主样式的链接恰好一个）；`三种状态对应三种入口文字`；`删除作品前确认，确认后调用删除并提示`（断言 `calls` 里 `works.delete` 的 `workId`）；`取消删除不调用接口`。
  - `AuthoringPage.test.tsx`：`无可访问性违规`、`标题大纲正确`；`停止输入后自动保存一次`（断言 `works.saveBackground` 只被调用一次，参数是最后的文本）；`生成前先保存未保存的修改`（输入后立即点生成；断言调用顺序是 `saveBackground` 在 `generatePreview` 之前，且 `generatePreview` 的 `contentRev` 是保存返回的那个）；`过期的预览不能采用`；`预览列出出场人物，主角带标记`；`草稿在别处更新时保留本地文本`。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：把生成按钮里的 `await autosave.flush()` 删掉，`生成前先保存未保存的修改` 必须红。
- 突变二：把 `WorkCard` 的“查看创作稿”也改成主样式，`每张卡只有一个主入口` 必须红。

### T15 游玩页与手记

**目的。** 游玩页是玩家停留最久的地方。按[设计准则 §1、§3、§4](../docs/design-guidelines.md#1-基调)、[动效 §5](../docs/motion.md#5-场景编排)、[a11y §8](../docs/a11y.md#8-游玩页) 重做：单列书页式正文；行动夹在剧情之间；推荐行动带序号、⌘1–⌘9 可选；新段落整块淡入；生成中有呼吸标记；往上翻时新段落到达不打扰阅读；失败时原位重试或改写；手记从右侧滑出，能跳回原文。

**依赖。** T07。`play.getJournal`（T11）还没合并时，测试里用 `createFakeApi`。

**拥有的文件。** `apps/client/src/features/play/*`、`src/i18n/zh-CN/play.json`。

**先读。** [游玩流程 §2、§4、§5](../docs/gameplay-flow.md#2-读一段决定一步)；[设计准则 §3、§4、§9](../docs/design-guidelines.md#3-版式)；[动效 §5、§6](../docs/motion.md#5-场景编排)；[a11y §8、§10](../docs/a11y.md#8-游玩页)；[i18n §7](../docs/i18n.md#7-中文排版)（组字）；`tasks/assets/milestone-2/play-*.png`；M1 的 `PlayPage.tsx`（`client.turn_visible` 的计时与去重逻辑要原样保留）；附录 A.5。

**步骤。**

- [ ] 1. 文件拆分：

  | 文件 | 内容 |
  | --- | --- |
  | `PlayPage.tsx` | 页面容器：查询路线、组装下面的组件、计时上报、播报 |
  | `TurnArticle.tsx` | 一个已提交的回合 |
  | `PendingTurn.tsx` | 生成中的回合 |
  | `FailedTurn.tsx` | 失败的回合：重试、改写 |
  | `OptionList.tsx` | 推荐行动 |
  | `ActionComposer.tsx` | 自由输入 |
  | `ReplaceInputDialog.tsx` | 输入框有字时点推荐行动的确认 |
  | `BackToLatest.tsx` | “回到最新”按钮 |
  | `JournalSheet.tsx`、`JournalSubject.tsx` | 手记 |
  | `anchors.ts` | `paragraphAnchorId(turnId, para)` 和 `turnHeadingId(turnId)` |
  | `usePlaySubmit.ts` | 提交行动、重试、改写的 mutation 和请求 id 管理 |
  | `useTurnVisibleSample.ts` | 从 M1 的 `PlayPage` 原样搬出 `client.turn_visible` 的计时与上报 |
  | `useAnnouncement.ts` | 由路线状态算出宣告区的文字和级别，同一件事只播报一次 |

- [ ] 2. `PlayPage`：
  - `Page`：`title` 是作品标题（`workTitle`，为空用 `play:page.untitled`）；`back` 回作品库；`width: 'prose'`；`tools` 是“手记”按钮（`secondary`，`size='sm'`，`BookOpen` 图标 + 文字 `play:journal.open`）和设置的 `IconButton`。
  - 主区整面纸色（`--uw-color-page`），不在底色上再叠一张纸（[设计准则 §4](../docs/design-guidelines.md#4-布局)）。
  - 结构：`<div ref={contentRef}>` 里依次是全部 `TurnArticle`、`PendingTurn` 或 `FailedTurn`（如有）、一个空的 `<div ref={sentinelRef} />`；其后是行动区 `<section aria-labelledby=...>`（视觉隐藏标题“你的行动”），里面是 `OptionList` 和 `ActionComposer`，只在最新决定点、没有进行中的请求时显示。
  - `useFollowLatest({ contentRef, sentinelRef })`；`atLatest` 为 `false` 时显示 `BackToLatest`。
  - 加载中：`Skeleton variant='prose'`。
- [ ] 3. `TurnArticle`：
  - `<article aria-labelledby={turnHeadingId(turn.id)}>`；标题是视觉隐藏的 `h2`（`tabIndex={-1}`，`id = turnHeadingId`），开场为“开场”，其余为“第 N 回合”（[a11y §8](../docs/a11y.md#8-游玩页)）。不显示可见的“第 N 回合”标题（M1 有，去掉：书页里不需要）。
  - 有行动时，正文之前显示行动：界面字体、`--uw-prose-action-size`、`--uw-color-ink-action`，前面是视觉隐藏的“你的行动：”。不加边框和色块（[设计准则 §3](../docs/design-guidelines.md#3-版式)）。
  - 正文：每段一个 `<p id={paragraphAnchorId(turn.id, index + 1)} tabIndex={-1}>`，取自 `turn.paragraphs`（不要再从 `prose` 切）。正文用 `--uw-prose-font`、`--uw-prose-size`、`--uw-prose-leading`、`--uw-color-ink`，段间距 `--uw-prose-paragraph-gap`，`lang` 设为作品语言。
  - 新到达的回合（不是首次挂载时就有的）用 `@starting-style` 淡入并上移 `--uw-motion-distance-sm`，`transition-reading`；首次进入页面时已有的回合不播放（[动效 §6](../docs/motion.md#6-实现规则)第 7 条：首次挂载和回看历史时不挂）。做法：`PlayPage` 记下首次渲染时的回合 id 集合，只给不在集合里的回合加 `data-uw-arriving` 属性，CSS 只对带这个属性的元素写 `@starting-style`。推荐行动在正文之后间隔 `--uw-motion-delay-stagger` 再淡入。
- [ ] 4. `PendingTurn`：`aria-busy="true"`；显示行动原话（同 `TurnArticle` 的行动样式）和 `GeneratingMarker`（`play:pending.running`）。
- [ ] 5. `FailedTurn`：显示行动原话、`errors:<code>`（`ErrorNotice` 的样式）、两个按钮：“重试这次行动”（`primary`，调用 `play.retry`）和“改写行动”（`secondary`，A2）。改写：把原话填进输入框、聚焦输入框，并隐藏这个失败块（本地状态）；玩家修改后发送时用新的 `requestId`（这是一个新的请求，[回合循环 §2](../docs/turn-loop.md#2-回合请求)）。
- [ ] 6. `OptionList`：`role="group"`、`aria-label = t('play:options.label')`。每个行动一个按钮，一行一个、占满正文列宽、文字靠起始端，前面是 `Kbd`（`⌘1`…）；装饰性描边、不填底，悬停才出现底色（[设计准则 §9](../docs/design-guidelines.md#9-部件)）。快捷键：对前 9 个行动注册 `useShortcut({ key: String(n), mod: true }, ...)`，只在行动区可见时启用。点击或快捷键：输入框为空时直接提交（`optionIndex = n`）；输入框有字时打开 `ReplaceInputDialog`。
- [ ] 7. `ReplaceInputDialog`：`ConfirmDialog`，标题 `play:replace.title`，描述 `play:replace.description`，确认按钮“改用推荐行动”（提交这个推荐行动，清空输入框），取消按钮“继续编辑”（关闭，焦点回到输入框）。
- [ ] 8. `ActionComposer`：`TextArea`（标签“你的行动”，`placeholder`、说明沿用 M1 文案），`useEnterToSubmit`；发送按钮（`primary`）。正在生成时禁用。
- [ ] 9. 焦点和播报（[a11y §8](../docs/a11y.md#8-游玩页)）：
  - `useAnnouncement`：生成中 → `polite` “正在写下一段”；新回合到达 → `polite` “新的剧情已到达”；失败 → `assertive` “本段未完成”。用 `{ requestId, attempt, status }` 作为这条播报的身份，同一身份只播报一次（client 规范 §8“需要重复触发的动作带序号”的反面：不重复触发）。
  - 新回合到达时：如果玩家当时停在最新位置（`atLatest`），而且焦点在行动区里（`document.activeElement` 在行动区 `section` 内），把焦点移到新回合的标题；否则焦点不动，只播报。
  - `BackToLatest`：普通按钮，按下后 `scrollToLatest()`，焦点移到最新回合的标题。出现和消失用 `transition-popup`。
- [ ] 10. 手记：
  - `JournalSheet`：`SideSheet`，标题“手记”。打开时才查询 `play.getJournal({ routeId })`（`useQuery` 的 `enabled: open`，查询键 `queryKeys.journal(routeId)`）。内容：
    - 人物、地点、物品、组织、其他各一组（组标题 `h3`，空的组不显示），每组下每个条目一个 `JournalSubject`；
    - “发生过的事”一组，是 `events`；
    - 全部为空时用 `EmptyState`（`headingLevel={3}`）。
  - `JournalSubject`：条目名（`h4`）；每一行是文字加一个“跳回原文”按钮（`text`，`size='sm'`，`aria-label` 写明“跳回原文：<来源>”）；`source` 为 `null` 时没有按钮。知情程度不是“确认”的行，前面加一个中性徽标（“听说”“猜测”“误信”）。
  - 跳回原文：关闭抽屉，关闭时 `finalFocus` 设为目标段落（`document.getElementById(paragraphAnchorId(turnId, para))`）；滚动到那一段（`scrollIntoView({ block: 'center' })`）；在那一段上挂 `data-uw-changed`，`readCssDuration('--uw-motion-duration-highlight')` 毫秒后用计时器摘掉（[动效 §6](../docs/motion.md#6-实现规则)第 7 条）。高亮样式：`[data-uw-changed]` 时背景 `--uw-color-ink-highlight`，用 `duration-highlight` 淡回。
  - 关闭抽屉（不跳转）时阅读位置不变：`SideSheet` 是覆盖在正文上的浮层，不推开正文列。
- [ ] 11. 文案按附录 A.5 写全。
- [ ] 12. 测试（`PlayPage.test.tsx` 等，`renderRoute('/play/<id>', { api })`）：
  - `无可访问性违规`、`标题大纲正确`：有手记打开和关闭两种状态各一次。
  - `段落用 core 给的切分，并带锚点`：`paragraphs` 是 `['甲', '乙']` 时渲染两个 `p`，`id` 分别是 `paragraphAnchorId(id, 1)` 和 `(id, 2)`。
  - `只在最新决定点显示行动区`；`生成中不显示行动区，并标记 aria-busy`。
  - `⌘ 加数字选择推荐行动`（派发 `metaKey` 或 `ctrlKey` 加 `'2'`，按测试环境的平台；断言 `play.submitAction` 的 `optionIndex === 2`）；`组字时 ⌘ 加数字不提交`。
  - `输入框有字时点推荐行动先确认`：选“继续编辑”不提交，输入框保留原文；选“改用推荐行动”提交推荐行动。
  - `失败后改写行动`：点“改写行动”后输入框里是原话且获得焦点；修改后发送，`play.submitAction` 收到的 `requestId` 和失败请求的不同。
  - `新回合到达时只播报一次`：同一状态重复渲染三次，宣告区文字只设置一次（记录 `LiveRegion` 的 `message` 变化次数）。
  - `首次进入时已有的回合不播放进入动效`（没有 `data-uw-arriving`）；`新到达的回合带进入标记`。
  - `打开手记才查询手记`：打开前 `calls` 里没有 `play.getJournal`；打开后有一次。
  - `从手记跳回原文`：点某一行的“跳回原文”后抽屉关闭、目标段落获得焦点、带 `data-uw-changed`；计时结束后属性被摘掉（假时钟）。
  - `没有来源的手记行没有跳转按钮`。
  - 保留并通过 M1 的 `client.turn_visible` 相关断言（搬到 `useTurnVisibleSample` 后仍然成立）。

**完成判据。**

- `pnpm --filter @unwritten/client test` 通过。
- 突变一：把 `TurnArticle` 的段落改成从 `prose` 切分（`prose.split('\n\n')`），用一个 `paragraphs` 与此切法结果不同的夹具（例如 `prose` 里有三个连续换行），`段落用 core 给的切分，并带锚点` 必须红。
- 突变二：把 `useAnnouncement` 的身份去重去掉，`新回合到达时只播报一次` 必须红。
- 突变三：把 `JournalSheet` 的 `enabled: open` 去掉，`打开手记才查询手记` 必须红。
- 突变四：把 `data-uw-arriving` 改成给所有回合都加，`首次进入时已有的回合不播放进入动效` 必须红。

### T16 core 装配、集成测试、过渡字段清理

**目的。** 把 W2–W4 的成果接成一条完整链路，用伪 OpenAI 服务从接口层走一遍；删掉 §2.8 的过渡字段和 M1 遗留的共享样式，确认没有占位实现残留。

**依赖。** T06、T10、T11、T12、T13、T14、T15。

**拥有的文件。** `packages/core/src/app.integration.test.ts`；contracts 里的过渡字段（`schemas/llm.ts`、`schemas/play.ts`）；core 里随之要改的地方；`apps/client/src/app/app.module.css`；`apps/client/src/features/settings/endpoint-edit.ts`（如仍存在）。

**先读。** 本文 §2.8、§2.9；[第二个里程碑](../docs/milestone-2.md)的验收表。

**步骤。**

- [ ] 1. 集成测试（`app.integration.test.ts`，真实服务 + 伪 OpenAI 服务 + 临时数据目录），补四条用例：
  - `从配置到续写的事实链路`：通过 oRPC 客户端新建端点、加第二个模型、给 `narrator` 设 `openai` 写法和 `thinking: 'high'`、给 `background` 设第二个模型；写背景、生成预览（伪服务交带主角和一个人物的 `changes`）、采用；续写两回合（第一回合新增一个人物并交出一件物品，第二回合用 `get_character` 查他）。断言：伪服务收到的续写请求体 `reasoning_effort === 'high'`，摘要请求体没有 `reasoning_effort`；`play.getJournal` 列出主角知道的两个人物；摘要表有两行。
  - `重启后事实与摘要仍在`：关掉 core，用同一数据目录重启，`play.getJournal` 结果与重启前相同。
  - `M1 数据目录升级`：用 drizzle 在临时目录里造一份 M1 形状的库（照 T04 的测试夹具），启动 core，续写一回合成功，新回合的事实写入，旧回合能被 `search_story` 搜到（脚本让模型先调 `search_story`，断言工具结果里有旧回合的编号）。
  - `两部作品互不串`：两部作品各有进度；对其中一部续写时，伪服务收到的 prompt 里没有另一部作品的任何实体名（附录 D 里两部作品的人物名互不相同）。阳性对照：prompt 里有本作品的实体名。
- [ ] 2. 删除过渡字段（§2.8），每删一处，按类型检查的报错逐个改调用方：
  - `TurnViewSchema.prose` → 删除；core `turnView()` 去掉 `prose`；client 里还在用 `turn.prose` 的地方改用 `paragraphs`（应当已经没有）。
  - `LlmConfigViewSchema.defaultModel`、`defaultModelUsable` → 删除；core `view()` 去掉这两项；client 改用 `purposes`。
  - `UpdateEndpointInputSchema.modelId` → 删除；core `updateEndpoint` 去掉“改第一个模型 id”的分支；`llm/service.test.ts` 里测这个分支的用例一并删除（这个行为已不存在）。
  - `SetPurposeInputSchema.params` 的 `.default(...)` 保留：它不是过渡字段，“不设参数”就是全空。
- [ ] 3. `apps/client/src/app/app.module.css` 删掉除 `.shell` 之外的全部规则；`grep -rn "app.module.css" apps/client/src` 只剩 `router.tsx` 一处。`features/settings/endpoint-edit.ts` 不再被引用时删除它和它的测试。
- [ ] 4. 跑一遍本文全部任务的“完成判据”里的 `grep` 类检查，汇总进 §6 台账。

**完成判据。**

- `pnpm typecheck`、`pnpm lint`、`pnpm test` 全部退出码为 0。
- `grep -rn "not implemented:" packages/core/src` 零命中。
- `grep -rn "defaultModelUsable\|\.prose\b" packages/contracts/src apps/client/src` 零命中（`styles.prose` 这类 CSS 类名除外，逐条看）。
- 突变：把 `play/service.ts` 里 `summary.enqueue` 的调用删掉，`从配置到续写的事实链路` 必须因摘要表行数不对而红。这一条证明集成测试覆盖到了接线，而不只是各服务自身。

### T17 端到端测试

**目的。** 从浏览器验证里程碑验收表（[docs/milestone-2.md](../docs/milestone-2.md)）里能自动化的部分，并把 M1 的端到端用例迁到新界面上。

**依赖。** T16。

**拥有的文件。** `e2e/` 下的测试和夹具。

**先读。** [第二个里程碑](../docs/milestone-2.md)的验收表；[技术选型 §8](../docs/tech-stack.md#8-测试)；[a11y §11](../docs/a11y.md#11-测试)；现有的 `e2e/tests/*.spec.ts`（启动 core、伪服务、读取地址的写法照抄）。

**步骤。**

- [ ] 1. 先跑一遍现有的 `pnpm e2e`，记录哪些用例因界面改动失败。逐个改选择器（新的按钮名、标签名见附录 A），**只改选择器和导航步骤，不删断言**。M1 的“设置”链接现在是作品库工具行里的图标按钮，名字仍是“设置”。
- [ ] 2. 新建 `e2e/tests/milestone-2.spec.ts`，每条用例一个临时数据目录、一个伪服务、一个 core 进程：
  - `按用途发送思考参数`：从设置页给“游玩”设 `openai` 写法和“高”档位、`temperature` 0.7，给“后台摘要”选同一个模型、思考设为“关闭”；玩一回合；断言伪服务记录的续写请求体和摘要请求体（字段名写字面量）。
  - `思考写法决定字段`：把模型的思考写法改成 `qwen`、预算 2048，再玩一回合，请求体有 `enable_thinking` 和 `thinking_budget`，没有 `reasoning_effort`。
  - `开场人物进入手记`：生成预览时伪服务交出主角和一个人物；预览里能看到这个人物；采用、开始故事；打开手记，能看到主角对他的称呼；点“跳回原文”，对应段落获得焦点。
  - `旧事被接住`（验收表第五行的自动化部分）：伪服务按脚本让模型在第 2 回合新增人物、第 4 回合调用 `get_character`；断言伪服务收到的第 4 回合请求里有 `get_character` 的工具结果，且 prompt 的索引里有这个人物的编号。真实模型能否“自然接住”留给 T18。
  - `坏的事实不进路线`：伪服务三次都交引用了未知编号的 `changes`；界面显示失败，点重试前路线不变；打开手记，没有新条目。
  - `外观偏好跨刷新和标签页`：设置页选深色、正文字号“大”；刷新后 `<html>` 的 `data-uw-appearance="dark"`、`data-uw-prose-size="4"`，且首屏 HTML（`page.goto` 拿到的响应文本）里就带着这两个属性；再开一个新标签页同样如此；在第二个标签页改回浅色，第一个标签页无需刷新就变成浅色。
  - `删除作品`：作品库删除一部作品，确认后卡片消失；重启 core 后仍然没有。
  - `键盘与输入法`：只用键盘从作品库进入游玩页；用 `page.keyboard` 按 ⌘2（或 Ctrl+2）选第二个推荐行动；用组合事件模拟组字中按 ⌘1 和回车，不提交。
  - `每页无可访问性违规`：作品库、创作页（有预览）、游玩页（手记关闭、打开）、设置页，浅色和深色各跑一次 `@axe-core/playwright`。
- [ ] 3. 每条用例结束时停 core、关伪服务、删临时目录。等待一律等界面状态或请求，不用固定延时。

**完成判据。**

- `pnpm build` 和 `pnpm e2e` 通过；`milestone-2.spec.ts` 连续跑两遍都通过。
- 突变：把 T07 `App.tsx` 里 `settings.changed` 的分发删掉，`外观偏好跨刷新和标签页` 必须红（第一个标签页不会自动变色）。
- 突变：把 core `http-app.ts` 首页渲染改回 `DEFAULT_APPEARANCE`，同一用例必须红（首屏 HTML 里没有深色）。

### T18 真实模型走查与收口

**目的。** 自动化测试只能证明“机制在工作”，证明不了“故事读起来连贯”“界面读起来舒服”。本任务用真实模型和真人眼睛核对这两件事，并完成收口检查。

**依赖。** T17；维护者提供真实端点。

**拥有的文件。** 本文 §6 台账。

**步骤。**

- [ ] 1. 从空的 `.data/` 启动生产构建，在设置页接入真实模型，按需设置思考参数，测试连接。记录用的端点、模型、思考写法（不记 key）。
- [ ] 2. 写一句虚构的背景（附录 D 或另编），生成预览并采用。核对：出场人物是否合理；主角对他人的称呼是否没有泄露真名。
- [ ] 3. 连续玩十个回合以上：第 2 回合结识一个人并交给他一件东西，第 8 回合以后再提起。核对：新回应是否接住；手记是否记下了主角知道的事、没有记下不该知道的事；请求足迹里模型用了哪些工具。
- [ ] 4. 浅色、深色各连续阅读十分钟（[设计准则 §12](../docs/design-guidelines.md#12-验收)）；截图转灰度；用色盲模拟查看。核对设计准则 §2 七条准则的“判断方法”。
- [ ] 5. 用真实中文输入法确认：组字时回车不提交。⌘ 加数字在浏览器里会被拦截（D9），这一项在浏览器里不验，记为欠账，留给桌面版。用 VoiceOver 走一遍主路径。
- [ ] 6. 跑 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm e2e`、`node scripts/check-doc-links.mjs`、`node scripts/check-tokens.mjs`，读数写进台账。按 §0.5 第 2 条自检全部 diff。
- [ ] 7. 查诊断库：按本里程碑新增的样本名（`story.projection`、`story.tool`、`summary.total`、`settings.update`）各统计样本数、中位数和第 95 百分位，写进台账，作为性能基线。

**完成判据。** 自动化检查全部通过；台账里有真实模型走查的结论（连贯性、泄露、手记、界面观感各一段）和性能基线；维护者确认。

---

## 附录 A · 中文文案

规则同第一个里程碑：照抄；字段的标签、说明、占位文字各用独立的键；作品数据、端点名、模型 id 原样显示，不进文案。下表只列本里程碑**新增或改动**的键，已有的键不变。“改”表示改动已有键的文案；“删”表示删除已有的键。

### A.1 common（T07）

| 键 | 文案 |
| --- | --- |
| `app.documentTitle` | `{{title}} · Unwritten` |
| `action.close` | 关闭 |
| `action.more` | 更多操作 |
| `status.saving` | 正在保存 |
| `toast.region` | 通知 |

### A.2 errors（T03）

| 键 | 文案 |
| --- | --- |
| `thinking_unsupported` | 这个模型不支持这样的思考设置。请检查模型的“支持思考”和“思考写法”。 |
| `last_model` | 端点至少要保留一个模型。要删除整个端点，请用“删除端点”。 |

### A.3 library（T14）

| 键 | 文案 |
| --- | --- |
| `card.untitled` | 未命名的草稿 |
| `card.viewDraft` | 查看创作稿 |
| `card.more` | 《{{title}}》的更多操作 |
| `card.delete` | 删除作品 |
| `delete.title` | 删除《{{title}}》？ |
| `delete.description` | 作品、全部游玩进度和故事记录都会删除，无法恢复。 |
| `delete.confirm` | 删除作品 |
| `delete.done` | 作品已删除 |

### A.4 authoring（T14）

| 键 | 文案 |
| --- | --- |
| `background.placeholder` | 例如：末班渡轮停航前，你遇见了一个坚持等下一班船的人。 |
| `background.status.saving` | 正在保存 |
| `background.status.saved` | 已保存 |
| `background.status.stale` | 草稿已在别处更新。你正在写的内容已保留，保存时会覆盖。 |
| `background.save`、`background.unsaved` | 删（改为自动保存） |
| `preview.stale` | 已过期 |
| `preview.staleHelp` | 背景改过了，这份预览基于旧的背景。请重新生成后再采用。 |
| `preview.options` | 推荐行动 |
| `cast.heading` | 出场人物 |
| `cast.protagonist` | 主角 |
| `cast.knownAs` | 主角称作：{{name}} |

### A.5 play（T15）

| 键 | 文案 |
| --- | --- |
| `page.untitled` | 未命名的故事 |
| `pending.complete` | 改：新的剧情已到达 |
| `pending.rewrite` | 改写行动 |
| `action.heading` | 你的行动 |
| `action.prefix` | 你的行动： |
| `options.label` | 推荐行动 |
| `replace.title` | 输入框里还有你写的内容 |
| `replace.description` | 要改用这个推荐行动吗？你写的内容会被清空。 |
| `replace.confirm` | 改用推荐行动 |
| `replace.cancel` | 继续编辑 |
| `journal.open` | 手记 |
| `journal.title` | 手记 |
| `journal.empty.heading` | 手记还是空的 |
| `journal.empty.description` | 认识的人、去过的地方和发生过的事，会随着故事记在这里。 |
| `journal.group.character` | 人物 |
| `journal.group.place` | 地点 |
| `journal.group.item` | 物品 |
| `journal.group.group` | 组织 |
| `journal.group.other` | 其他 |
| `journal.group.events` | 发生过的事 |
| `journal.jump` | 跳回原文：{{source}} |
| `journal.source.opening` | 开场第 {{para}} 段 |
| `journal.source.turn` | 第 {{depth}} 回合第 {{para}} 段 |
| `journal.level.heard` | 听说 |
| `journal.level.suspects` | 猜测 |
| `journal.level.misled` | 误信 |
| `journal.level.confirmed` | 确认 |

### A.6 settings（T13）

| 键 | 文案 |
| --- | --- |
| `page.heading` | 改：设置 |
| `current.heading`、`current.empty` | 删（由用途卡代替） |
| `purpose.heading` | 模型用途 |
| `purpose.description` | 每个用途可以用不同的模型和参数。没有单独设置的用途使用默认模型。 |
| `purpose.name.default` | 默认 |
| `purpose.name.narrator` | 游玩 |
| `purpose.name.background` | 后台摘要 |
| `purpose.help.default` | 生成开场预览，以及没有单独设置的用途都用它。 |
| `purpose.help.narrator` | 写开场之后的每一回合。 |
| `purpose.help.background` | 给每个回合写一两句摘要。便宜、快的模型就够。 |
| `purpose.model` | 模型 |
| `purpose.useDefault` | 使用默认模型 |
| `purpose.inheritedParams` | 使用默认模型的参数。 |
| `purpose.save` | 保存 |
| `purpose.test` | 测试这个用途 |
| `purpose.dirty` | 有未保存的修改 |
| `purpose.saved` | 已保存 |
| `purpose.problem.not_configured` | 还没有选模型 |
| `purpose.problem.model_missing` | 选的模型已经不存在 |
| `purpose.problem.no_tools` | 这个模型不支持工具调用，不能用于游玩 |
| `params.thinking` | 思考 |
| `params.thinkingLevel.unset` | 不设置 |
| `params.thinkingLevel.off` | 关闭 |
| `params.thinkingLevel.minimal` | 最少 |
| `params.thinkingLevel.low` | 低 |
| `params.thinkingLevel.medium` | 中 |
| `params.thinkingLevel.high` | 高 |
| `params.thinkingLevel.xhigh` | 很高 |
| `params.thinkingLevel.max` | 最高 |
| `params.thinkingBudget` | 思考预算（token） |
| `params.temperature` | temperature |
| `params.topP` | top_p |
| `params.topK` | top_k |
| `params.minP` | min_p |
| `params.unsetHint` | 留空表示不设置，由服务端决定。 |
| `params.reason.noModel` | 先选一个模型。 |
| `params.reason.noReasoning` | 这个模型标为不支持思考。 |
| `params.reason.budgetFormat` | 只有思考写法为 Qwen 的模型能设思考预算。 |
| `params.reason.budgetNeedsThinking` | 先选一个思考档位。 |
| `params.samplingWarning` | 开启思考后，部分服务会忽略或拒绝采样参数。请用测试连接确认。 |
| `endpoints.heading` | 端点 |
| `endpoint.edit` | 改：修改名称和 key |
| `endpoint.more` | 端点“{{name}}”的更多操作 |
| `endpoint.delete` | 删除端点 |
| `endpoint.deleteTitle` | 删除端点“{{name}}”？ |
| `endpoint.deleteDescription` | 端点下的模型会一起删除。 |
| `endpoint.deleteAffects` | 这些用途的设置会被清除：{{purposes}} |
| `endpoint.deleted` | 端点已删除 |
| `endpoint.httpWarning` | 这个地址不加密，key 会以明文发送。 |
| `model.heading` | 模型 |
| `model.add` | 添加模型 |
| `model.newId` | 新模型 ID |
| `model.tools` | 工具调用 |
| `model.reasoning` | 支持思考 |
| `model.thinkingFormat` | 思考写法 |
| `model.capability.yes` | 是 |
| `model.capability.no` | 否 |
| `model.capability.unknown` | 未知 |
| `model.delete` | 删除模型 |
| `model.deleteTitle` | 删除模型“{{id}}”？ |
| `model.deleteDescription` | 删除后，这个模型不能再用于任何用途。 |
| `model.lastModel` | 端点至少要保留一个模型。 |
| `thinkingFormat.auto` | 自动识别 |
| `thinkingFormat.openai` | OpenAI（reasoning_effort） |
| `thinkingFormat.qwen` | Qwen / DashScope（enable_thinking） |
| `thinkingFormat.qwen-chat-template` | vLLM、SGLang 上的 Qwen（chat_template_kwargs） |
| `thinkingFormat.deepseek` | DeepSeek |
| `thinkingFormat.openrouter` | OpenRouter |
| `thinkingFormat.zai` | 智谱 |
| `appearance.heading` | 外观与阅读 |
| `appearance.theme` | 外观 |
| `appearance.themeOption.system` | 跟随系统 |
| `appearance.themeOption.light` | 浅色 |
| `appearance.themeOption.dark` | 深色 |
| `appearance.proseSize` | 正文字号 |
| `appearance.sizeOption.1` | 很小 |
| `appearance.sizeOption.2` | 小 |
| `appearance.sizeOption.3` | 标准 |
| `appearance.sizeOption.4` | 大 |
| `appearance.sizeOption.5` | 很大 |
| `appearance.proseFont` | 正文字体 |
| `appearance.fontOption.serif` | 衬线 |
| `appearance.fontOption.sans` | 无衬线 |
| `appearance.proseLeading` | 行距 |
| `appearance.leadingOption.comfortable` | 舒适 |
| `appearance.leadingOption.compact` | 紧凑 |
| `appearance.preview` | 示例 |
| `appearance.sample` | 雨停的时候，渡口的灯还亮着。守夜人把最后一张船票压在茶杯下面，抬头看见有人沿着栈桥走来。 |
| `appearance.saveFailed` | 外观设置没有保存，已恢复原来的设置。 |

---

## 附录 B · 给模型的文字

全部写在 core 的常量里，不走 i18n。照抄，标点按原样。改动任何一个字，都要更新 T11 的 token 棘轮测试，并说明涨幅来自哪里（core 规范 §4）。

### B.1 `PREVIEW_SYSTEM_PROMPT`（T10）

```
你要根据作者的背景写出一部文字冒险的开场。沿用背景明确写出的事实，按背景所用的语言补充玩家能知道的设定。让玩家清楚自己是谁、现在身处何地，以及眼前为什么值得行动。用可读的段落写开场，停在一个由玩家决定的时刻。为同一处境给出不同且现在可执行的行动。标题、简介和公开设定只使用开场时玩家可以知道的信息。在 changes 里登记开场里出现的人物、地点和事物：主角一行，带 "protagonist":"true"；其余用 new_entity。主角此刻怎么称呼对方，写在 known_as；主角还不知道真名时，正文和选项里只用 known_as。present 写开场结束时在场的人物。调用 `propose_preview` 提交全文，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。
```

### B.2 `NARRATOR_SYSTEM_PROMPT` 与 `PROPOSE_TURN_DESCRIPTION`（T11）

```
你是这个文字冒险的叙事者。沿用作品设定、当前场景和这条路线的既有经历。用要求的作品语言回应玩家本次行动的原意，演出当下可以发生的后果，留下由玩家决定的下一步。用完整段落写正文，并给出少量不同、具体而可执行的推荐行动。可以让行动失败或产生代价，交代玩家能观察到的原因。上下文里的人物和事物用 @编号表示，事实用 #编号，回合用 T编号，正文的段落带 [段号]。需要更早的细节时，先用只读工具查，不要编造这条路线上没有发生过的旧事。每个角色只依据自己知道的事行动。主角还不知道的名字，不要写进正文和推荐行动。交回合时，把这一回合新出现的人物和事物、称呼的变化、发生的事、特征、关系和约定的变化、谁知道了什么，按 changes 的格式逐行写出，每行标明出处段号。按工具的字符串格式调用 `propose_turn`。收到校验反馈时修正后再提交。
```

`PROPOSE_TURN_DESCRIPTION`：

```
提交这一回合的正文、推荐行动和故事变化。写完正文后调用一次；收到校验反馈时，按反馈修正后再调用。
```

### B.3 `changes` 与 `present` 的参数说明（T10、T11）

续写（`propose_turn` 的 `changes`）：

```
每行一个 JSON，这一回合没有变化时填空字符串。引用人物或事物写编号（如 @3）或名字；引用事实写编号（如 #12），或写本次第几行（如 L2）。para 是出处在正文里的段号，从 1 起。可用的类型：
{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，不知道时留空","profile":"一句话档案","para":"1"}
{"type":"name","entity":"@3","name":"称呼","holder":"@1","para":"2"}
{"type":"event","subject":"@3","object":"@1","statement":"一句话","witnesses":"@1,@3","para":"2"}
{"type":"trait","subject":"@3","key":"特征名","statement":"一句话","para":"2"}
{"type":"relation","subject":"@1","object":"@3","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}
{"type":"promise","subject":"@3","object":"@1","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}
{"type":"knowledge","fact":"#12","holder":"@4","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"@3","para":"3"}
{"type":"scene","place":"地点","time":"故事时间","present":"@3,@4"}
新人物和已有人物同名时：是同一个人，就用编号引用，不要新增；是另一个人，加上 "distinct":"true"，并在 profile 里写明区别。省略 witnesses 时，默认上一回合在场的人加主角；场景有变化时必须写明。不在场的人得知一件事，必须写 via。
```

开场（`propose_preview` 的 `changes`）：

```
每行一个 JSON。引用人物或事物写名字；引用事实写本次第几行（如 L2）。para 是出处在正文里的段号，从 1 起。必须恰好有一行主角：
{"type":"new_entity","kind":"character","name":"主角的名字","known_as":"","profile":"一句话档案","para":"1","protagonist":"true"}
其余可用的类型：
{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，不知道时留空","profile":"一句话档案","para":"1"}
{"type":"name","entity":"名字","name":"称呼","holder":"名字","para":"2"}
{"type":"event","subject":"名字","object":"名字","statement":"一句话","witnesses":"名字,名字","para":"2"}
{"type":"trait","subject":"名字","key":"特征名","statement":"一句话","para":"2"}
{"type":"relation","subject":"名字","object":"名字","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}
{"type":"promise","subject":"名字","object":"名字","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}
{"type":"knowledge","fact":"L2","holder":"名字","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"名字","para":"3"}
开场里的 event 必须写明 witnesses。
```

`present`：

```
开场结束时在场的人物，写 changes 里新增人物的名字，用逗号分隔。只有主角时留空。
```

### B.4 只读工具（T11）

每个工具的 `parameters` 都是 `{ type: 'object', properties: {...}, required: [全部参数], additionalProperties: false }`，每个参数 `type: 'string'`。

| 工具 | 说明 | 参数与参数说明 |
| --- | --- | --- |
| `get_character` | 查一个人物的完整档案：称呼、特征、关系、知道的事、最近和他有关的事件。 | `target`：人物的编号（如 @3）或名字 |
| `get_place` | 查一个地点的档案，以及在这里发生过的事。 | `target`：地点的编号或名字 |
| `get_entity` | 查物品、组织等其他事物的档案，以及和它有关的事。 | `target`：编号或名字 |
| `list_catalog` | 按类别列出本路线可见的条目，每页最多 30 条。 | `category`：characters、places、items、groups、others、promises、events、scenes 之一；`cursor`：上一页末尾给出的游标，第一页留空 |
| `who_knows` | 查谁知道一件事、知道到什么程度、从谁那里得知。 | `fact`：事实编号，如 #12 |
| `search_story` | 在本路线的原文里搜索，返回命中的回合、段号和前后文。 | `query`：要找的词或短语 |
| `read_turn` | 读一个回合的玩家行动和完整正文，段落带段号。 | `turn`：回合编号，如 T12 |

### B.5 `SUMMARY_SYSTEM_PROMPT`（T12）

```
你要为文字冒险的一个回合写摘要。用作品语言写一两句话，不超过 120 字。点名出现的人物、地点和发生的事，写清玩家做了什么、结果如何。只写正文里发生的事，不评价，不推测。只输出摘要本身。
```

---

## 附录 C · 给模型看的文本格式

T08 的 `render.ts`、T11 的 `context.ts` 和 `tools.ts` 按这里实现，测试逐字比对。`<…>` 是占位，其余字符原样输出。

**通用规则：**

- **显示名**（`displayName`）：主角的显示名是真名。其他实体：`protagonistNameOf` 为空 → `<真名>（主角不知道这个名字）`；等于真名 → `<真名>`；否则 → `<主角的称呼>（真名：<真名>）`。
- **档案截断**：按 `Array.from` 计字符，超过上限时截到上限并加 `…`；档案为空时写 `未写档案`。
- **来源**（`sourceLabel`）：深度为 -1 → `作品设定`；段号为空 → `T<深度>`；否则 `T<深度> 第<段号>段`。
- **正文段落**：每段前加 `[<段号>] `，段与段之间空一行。
- **种类名**：`character` 人物，`place` 地点，`item` 物品，`group` 组织，`other` 其他。
- **知情程度名**：`heard` 听说，`suspects` 猜测，`confirmed` 确认，`misled` 误信。

### C.1 续写的上下文（`prompt`）

块与块之间空一行，按下面的顺序。没有内容的可选块整块省略。

```
【作品设定】
<背景>

【公开设定】
<公开设定>

【叙事要求】
作品语言：<语言>。正文和选项都用这种语言写。

【主角】
@1 <主角真名> · <档案，截 40 字>

【当前场景】
地点：<地点，空则写 未说明>
时间：<时间，空则写 未说明>
在场：
- <编号> <显示名> · 认识阶段：<阶段，没有则写 未记录> · <档案，截 40 字>

【人物与事物索引】
- <编号> <种类名> · <显示名> · <档案，截 30 字> · <已出场 或 未出场>
另有 <N> 个未出场的人物和事物，可用 list_catalog 查看。

【未了结的约定】
- <事实编号> <主体编号> → <客体编号>：<陈述>

【更早的回合】
T<深度> <摘要；没有摘要时 玩家行动：<原话>；开场写 开场>
另有 <N> 个更早的回合未列出，可用 search_story 或 read_turn 取回。

【最近的回合】
T<深度>
玩家行动：<原话>
[1] <第 1 段>

[2] <第 2 段>

T<深度>（最新）
玩家行动：<原话>
[1] <第 1 段>

【玩家这次的行动】
<原话>
<（玩家选择了推荐行动第 N 项。） 或 （这是玩家自己写的行动，按原意回应。）>
```

- 在场的人一个都没有时，`在场：` 那一行写成 `在场：只有主角`，不列表。
- `【更早的回合】` 和 `【最近的回合】` 里的回合都按深度从小到大排；两个“另有…”的行只在确实有省略时出现。
- 开场回合的标题是 `T0（开场）`，没有“玩家行动”那一行；开场就是最新回合时写 `T0（开场，最新）`。
- 编号的发放顺序就是在上下文里第一次出现的顺序：主角 `@1`，然后是在场者（按 `presentIds` 的顺序），然后是索引（先已出场的，按 `originDepth` 从大到小，相同时按真名的码位升序；再未出场的，规则相同），最后是约定里出现的事实。

**示例**（附录 D 的“北岬”夹具，路线 head 在 T2，未展示作品设定、叙事要求、回合原文和行动块）：

```
【主角】
@1 林远 · 刚到北岬的邮差

【当前场景】
地点：北岬灯塔值班室
时间：第三天夜里
在场：
- @2 沈岚 · 认识阶段：met · 说话很慢，总带着一把黑伞
- @3 老周 · 认识阶段：未记录 · 灯塔看守，话不多

【人物与事物索引】
- @4 物品 · 铜钥匙 · 灯塔顶层门的钥匙 · 已出场
- @5 地点 · 北岬灯塔 · 岬角尽头的白色灯塔 · 已出场
- @2 人物 · 沈岚 · 说话很慢，总带着一把黑伞 · 已出场
- @3 人物 · 老周 · 灯塔看守，话不多 · 已出场
```

同一夹具，路线 head 在 T1（主角还只知道“撑伞的女人”）时，在场那一行是：

```
- @2 撑伞的女人（真名：沈岚） · 认识阶段：met · 说话很慢，总带着一把黑伞
```

### C.2 实体详情（`get_character`、`get_place`、`get_entity`）

人物：

```
<编号> 人物 · 真名：<真名>
主角的称呼：<主角的当前称呼；没有则写 无>
其他称呼：<每条 <持有者编号> 称为「<称呼>」（<来源>），用 、 分隔；没有则写 无>
档案：<完整档案>
特征：
- <事实编号> <陈述>（<来源>）
关系：
- <事实编号> <主体编号> → <客体编号> <key>[ · 阶段 <stage>][ · 强度 <strength>]：<陈述>（<来源>）
知道的事：
- <事实编号> <陈述>（<程度名>[，来自 <via 编号>]，<来源>）[；以为：<perceived>]
最近的相关事件：
- <事实编号> <陈述>（<来源>）
```

地点、物品、组织、其他：第一行的种类名换成对应的名字；没有“知道的事”一节；“最近的相关事件”一节的标题换成 `相关的事：`。任何一节没有条目时，节标题下写一行 `- 无`。“最近的相关事件”按深度从大到小，最多 `STORY_LIMITS.recentEventsPerEntity` 条。“其他称呼”只列主角以外的持有者，每个持有者只列当前那一条。

**示例**（“北岬”夹具，head 在 T2。构造方法：新建编号簿（此时只有 `@1`），调用一次 `entityCode(沈岚的 id)` 得到 `@2`，再调用 `renderEntityDetail(沈岚的 id)`。事实编号按渲染顺序发放：特征 `#1`、关系 `#2`、事件 `#3`）：

```
@2 人物 · 真名：沈岚
主角的称呼：沈岚
其他称呼：无
档案：说话很慢，总带着一把黑伞
特征：
- #1 她在等下一班船（T2 第1段）
关系：
- #2 @1 → @2 acquaintance · 阶段 met：主角在栈桥上遇见撑伞的女人（T0 第2段）
知道的事：
- #3 沈岚告诉主角末班渡轮已经停航（确认，T0 第2段）
最近的相关事件：
- #3 沈岚告诉主角末班渡轮已经停航（T0 第2段）
```

### C.3 目录（`list_catalog`）

```
<类别名>（第 <起>–<止> 条，共 <总数> 条）
- <条目行>
下一页：cursor=<下一页的起点>
```

- 类别名：`characters` 人物，`places` 地点，`items` 物品，`groups` 组织，`others` 其他，`promises` 约定，`events` 事件，`scenes` 关键场面。
- 实体类别的条目行同 C.1 的索引行；`promises` 同 C.1 的约定行再加 `（<status>）`；`events` 是 `- <事实编号> <来源>：<陈述>`，按深度从大到小。
- 没有下一页时最后一行是 `没有更多了。`；类别为空时整个结果只有一行 `<类别名>：没有条目。`；`scenes` 固定返回 `本作品没有设定关键场面。`

### C.4 知情（`who_knows`）

```
<事实编号> <陈述>
知情者：
- <编号> <显示名>：<程度名>[，来自 <via 编号>][；以为：<perceived>]（<来源>）
```

没有知情者时第二行写 `知情者：无`。

### C.5 检索（`search_story`）

```
搜索「<查询>」，命中 <N> 处：
- T<深度> 第<段号>段：<片段>
```

没有命中时只有一行：`搜索「<查询>」，没有命中。`

### C.6 读回合（`read_turn`）

同 C.1 的回合块（不带“（最新）”）。

### C.7 截断

任何工具结果超过 `STORY_LIMITS.toolResultMaxChars` 个字符时，截到上限，末尾另起一行写 `（已截断）`。

---

## 附录 D · 测试用的虚构素材

全部为本仓库自编，不来自任何作品。测试里需要故事内容时用这里的，或另编，不要从别处摘。

### D.1 “北岬”夹具（T08 起的默认夹具）

- **作品**：背景“雨下了三天，你在北岬等一班开往南岸的渡轮。”；公开设定“你是来北岬送信的邮差，渡轮因风雨停航。”；语言 `zh-CN`。
- **实体**（全部是作品设定，`originTurn` 为 `null`，只有铜钥匙在 T2 新增）：

  | key | 种类 | 真名 | 档案 | 备注 |
  | --- | --- | --- | --- | --- |
  | `lin` | 人物 | 林远 | 刚到北岬的邮差 | 主角 |
  | `shen` | 人物 | 沈岚 | 说话很慢，总带着一把黑伞 | |
  | `zhou` | 人物 | 老周 | 灯塔看守，话不多 | |
  | `tower` | 地点 | 北岬灯塔 | 岬角尽头的白色灯塔 | |
  | `brassKey` | 物品 | 铜钥匙 | 灯塔顶层门的钥匙 | `originTurn: 2` |

- **回合**：
  - T0（开场）：
    1. 雨下到第三天，北岬灯塔的灯还亮着。你提着行李走上栈桥，木板在脚下吱呀作响。
    2. 栈桥尽头站着一个撑伞的女人。她把伞往你这边倾了倾，说末班渡轮已经停航。
    3. 灯塔看守老周从值班室探出头，朝你们招手。
  - T1，行动“把行李交给老周，问他今晚能不能借宿”：
    1. 老周接过行李，说值班室后面还有一张空床。
    2. 撑伞的女人没有跟进来，她站在门口，看着海面。
  - T2，行动“问撑伞的女人叫什么名字”：
    1. 她说她叫沈岚，在等下一班船。
    2. 老周把一把铜钥匙放在桌上，说灯塔顶层的门只有这一把钥匙。
  - T2 的场景：地点“北岬灯塔值班室”，时间“第三天夜里”，在场 `shen`、`zhou`。T0、T1 的场景：地点“北岬栈桥”，时间“第三天傍晚”，在场 `shen`、`zhou`。
- **称呼**（持有者都是 `lin`）：`lin` 称自己“林远”（T0 第 1 段）；`shen` 称为“撑伞的女人”（T0 第 2 段）、“沈岚”（T2 第 1 段）；`zhou` 称为“老周”（T0 第 3 段）；`tower` 称为“北岬灯塔”（T0 第 1 段）；`brassKey` 称为“铜钥匙”（T2 第 2 段）。
- **事实**：
  - `meet`：关系，`lin` → `shen`，`key = acquaintance`，`data.stage = met`，“主角在栈桥上遇见撑伞的女人”，T0 第 2 段。
  - `ferry`：事件，`shen` → `lin`，“沈岚告诉主角末班渡轮已经停航”，T0 第 2 段。
  - `wait`：特征，`shen`，`key = 等待`，“她在等下一班船”，T2 第 1 段。
  - `keyOnTable`：事件，`zhou` → `brassKey`，“老周把灯塔顶层的铜钥匙放在桌上”，T2 第 2 段。
- **知情**：`ferry` 的 `lin`、`shen` 确认（T0 第 2 段）；`keyOnTable` 的 `lin`、`zhou` 确认（T2 第 2 段）；`wait` 的 `lin` 确认（T2 第 1 段）。

### D.2 “雪原驿站”夹具（两部作品互不串的用例）

- 背景“暴雪封路，你被困在雪原上的驿站里。”；主角“阿木”（赶马的少年）；人物“葛老板”（驿站老板，嗓门大）；地点“白石驿站”。
- T0：1.“风雪拍着窗纸，白石驿站里只剩一盏油灯。” 2.“葛老板把一碗热汤推到你面前，说今晚谁也走不了。”
- 两部夹具的全部名字互不相同，也互不包含，所以“prompt 里没有另一部作品的名字”这类断言不会因为子串巧合而误判。

---

## 6. 台账

编排者在每个波次合并后填写。只记执行实况，不写过程叙事（规则见 T01 新建的 `tasks/AGENTS.md` §7）。

### 6.1 维护者裁定

| 编号 | 裁定 | 理由与何时重估 |
| --- | --- | --- |
| D1–D10、A1–A4 | 待维护者确认 | |

### 6.2 波次读数

| 波次 | 集成分支提交 | `pnpm typecheck` | `pnpm lint` | `pnpm test` | 文档链接 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| W0 | | | | | | |

### 6.3 突变账

| 任务 | 突变 | 结果（红 / 绿） | 全绿时的归因与处置 |
| --- | --- | --- | --- |

### 6.4 欠账与不适用

| 项 | 类型（欠账 / 不适用） | 为什么现在做不了 | 补上需要什么 |
| --- | --- | --- | --- |
| 真实模型下“旧事被自然接住” | 机器验不了 | 自动化只能证明工具被调用、材料被送达，不能证明叙述是否自然 | T18 人工走查 |
| 读屏走查 | 机器验不了 | 同上 | T18 用 VoiceOver |
