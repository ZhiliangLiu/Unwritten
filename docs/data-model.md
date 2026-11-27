# Unwritten · 数据模型

本文定义作品、经历和故事事实的存储结构，以及一条路线在某个决定点能看见哪些事实。全部表都放在同一个 SQLite 文件 `library.db` 里，见[架构总览 §6](./architecture.md#6-数据目录)。

## 1. 三层内容

| 层 | 是什么 | 由谁写 | 什么时候改变 |
| --- | --- | --- | --- |
| 作品版本 | 作者的世界：设定、方案、开场、人物、秘密、状态栏定义、关键场面、结束条件 | 作者，通过创作向导和工作站 | 草稿随时可改。复制成试玩快照或发布版本后，作者设定的部分不再改变；游玩产生的行继续追加在同一个版本下 |
| 经历 | 一次开局下的回合树、路线和存档 | 玩家行动 + AI 回应，由 core 校验后提交 | 每提交一个回合，就在树上加一个节点 |
| 故事事实 | 人物、地点、事件、关系、约定、谁知道什么、状态值 | 作者设定的部分随作品版本走；游玩中产生的部分挂在产生它的回合上 | 作者设定在草稿里可以编辑，复制进试玩快照或发布版本后冻结；游玩中产生的行只追加，不修改 |

**最关键的设计：路线能看见什么，由回合树上的祖先链决定。** 不能用“第几回合之前”这种线性位置来过滤：两条路线可能共享同一段过去，如果在共享回合的行上写入“从某处起失效”，另一条路线也会被一起改掉。所以路线上的当前状态一律是对只追加日志的投影：游玩中产生的行只追加，从不修改。

## 2. 作品与版本

```sql
works (
  id            TEXT PRIMARY KEY,
  title         TEXT,              -- 作者未起名时为空，作品库用背景首句来辨认
  blurb         TEXT,              -- 玩家可读的简介
  illustration_style JSON,         -- 作者给的默认画风：{"preset": "<预设 id>"} 或 {"custom": "<画风原文>"}；为空时用默认画风
  draft_id      TEXT NOT NULL,     -- 当前草稿版本
  published_id  TEXT,              -- 最近一次发布的版本；为空表示作品尚在创作
  created_at, updated_at
)

work_versions (
  id            TEXT PRIMARY KEY,
  work_id       TEXT NOT NULL REFERENCES works ON DELETE CASCADE,
  kind          TEXT NOT NULL,     -- draft | trial | published
  copied_from   TEXT,              -- 由哪个版本复制而来
  content_rev   INTEGER NOT NULL DEFAULT 0,  -- 作者设定的修订号，见下文“未发布的修改”
  source_rev    INTEGER,           -- 复制时源版本的 content_rev
  meta          JSON NOT NULL,     -- 见下表
  created_at, updated_at
)
```

`meta` 存放创作向导和工作站整块读写的内容：

| 字段 | 内容 |
| --- | --- |
| `background` | 作者写的背景原文 |
| `settings` | 补充设定，八节：`world`（世界）、`protagonist`（玩家主角）、`cast`（主要人物）、`secrets`（秘密与知情）、`opening`（开场）、`actions`（行动与提示）、`scenes`（关键场面与结局）、`status`（初始状态栏）。每一节保存作者原文 `text` 和这一节自己的修订号 `rev`（这一节的内容变了才加一）。有选择的节另存选择：`cast.mode` 是整部作品的主要人物模式，`fixed`（固定主要角色）或 `per_run`（每次新开局生成）；`actions.hints` 是 `actions_only`（只显示行动）或 `known_consequences`（提醒已知后果）；`opening.mode` 是 `ai`（AI 起草）、`situation`（按作者写的情境起草）或 `author_text`（正文采用作者原文）；`protagonist.fields` 是作者留给玩家填写的主角项目，最多 8 项，每项有项目名 `name`、默认值 `defaultValue` 和 `isName`（是否为主角的名字，最多一项）。玩家留空时用默认值，开场占位符因此总有值可填。作者锚点不在这八节里，单独存在 `anchors` |
| `plan` | 故事方案：`items`、`conflicts`、`confirmedRev`。`items` 的每一项有 core 分配的 `id`、来源 `source` 和种类 `kind`：`summary`（玩家身份、基调、开场处境、世界、公开设定这几个摘要）、`entity`（人物、地点和事物；人物另有形象 `appearance`，只写此刻看得见的样子；主要人物每局生成时是人物位置，带作用和相遇样例）、`secret`（秘密：标题、真相、主体、知情者、揭晓条件）、`state`（状态栏栏目：显示方式、配置、是否幕后、揭晓条件、开局值）、`scene`（关键场面）、`ending`（结束条件）。来源是 `author`（作者写的或作者亲手改过的）、`ai`（AI 补全的）或 `author_confirmed`（作者在提案卡上确认过的 AI 内容）；`author` 和 `author_confirmed` 都受“作者设定优先”的保护，重新生成方案时原样保留。`conflicts` 是 AI 报告的两条互相矛盾的作者原话。`confirmedRev` 是确认方案时的 `content_rev`；它等于草稿当前的 `content_rev` 才算已确认，所以确认之后草稿的任何写入都让方案回到未确认。没有 `kind` 的项按摘要读取，`id` 为 `public_setting` 的就是公开设定 |
| `castSlots` | 主要人物每局生成时的人物位置：`id`、作用、相遇样例。确认方案时由方案里的人物位置写入；固定主要角色的作品没有这一项，人物直接写进实体表 |
| `opening` | 采用的开场：正文、初始选项（可以带提醒）、初始场景、初始状态值 `initialState`、开场的故事变化 `changes`，以及这些变化里新出现的实体分到的 id `createdIds`；每局生成人物的作品另标 `template`，开局时这份开场只作参照。改稿后的核对还要用到它引用了哪些设定、各是什么修订号（见[创作工作站 §7](./author-workstation.md#7-受影响范围与开场核对)）。正文、初始选项和初始状态值里都可以含主角填写项的占位符，格式为 `{{protagonist.<项目名>}}`，开局时一并替换成玩家填写的值（[回合循环 §10](./turn-loop.md#10-开场)） |
| `opening_candidates` | 仅草稿有：候选开场 |
| `keyScenes` | 关键场面：每条有 `id`、条件原文、发生什么、是否只发生一次。确认方案时写入 |
| `ending` | 结束条件原文；没有这个键表示开放式作品。确认方案时写入 |
| `narration` | 作品语言。它在生成故事方案时按作者背景所用的语言定下，作者可以修改（[i18n §6](./i18n.md#6-作品语言)） |
| `anchors` | 作者锚点：叙事要求、内容边界、即兴范围，三段自由文本。创作时原样给模型，游玩时原样进每一回合的 prompt。不设长度上限，所以写得越长，越挤占索引和更早回合的预算（[回合循环 §3](./turn-loop.md#3-上下文哪些直接给哪些让模型查)） |
| `wizardStep` | 仅草稿有：向导停在哪一步，`background`、`plan` 或 `opening` |

**标题和简介是作品的展示信息，不属于版本。** 它们只用来在作品库和路线列表里辨认作品，所以存在 `works` 上，不随版本复制。作者随时可以修改，改完作品库和所有路线立即显示新的；写入不计入 `content_rev`，也不需要“应用到新开局”。游玩时的上下文不包含它们（[回合循环 §3](./turn-loop.md#3-上下文哪些直接给哪些让模型查)），所以改名不影响任何路线里的故事。

**默认画风也存在 `works` 上，同样不属于版本。** 每局在开局时就把画风写进开局行并锁定（§3），所以改默认画风只影响之后的新开局，不影响任何已有的路线。它不计入 `content_rev`：不会让已确认的方案回到未确认，也不需要发布就对新开局生效（[插图与出图服务 §6.3](./image.md#63-画风)）。

**为什么这些放在 JSON 里。** 它们由向导和工作站整块读写，从不按名字查询，而且只属于某一个版本。人物、地点、事实、状态栏定义则放进下面的表，因为回合循环的只读工具要把它们和游玩中产生的行一起查询。

**版本的生命周期：**

| 时机 | 操作 |
| --- | --- |
| 新建作品 | 建立 `works` 和一份 `draft` 版本 |
| 开始试玩 | 把草稿复制成一份 `trial` 版本，再新建一个 `kind=trial` 的开局 |
| 确认方案 | 删掉草稿里全部作者设定的故事事实行，按方案重新写入：人物、地点、事物进实体表（实体的 id 就是方案项的 id），主角知道的称呼进称呼表，秘密写成 `secret` 事实和知情者的知情记录，栏目写进 `state_defs`；关键场面、结束条件、人物位置写进 `meta`。草稿不被任何开局引用，所以整批重写是安全的 |
| 存入作品库 / 应用到新开局 | 开场预览里新出现的实体作为作者设定写进草稿，再把草稿复制成一份 `published` 版本，`works.published_id` 改指向它。不建开局 |
| 新开局 | 由玩家在开局页发起（填写作者留出的主角项目），使用 `works.published_id` 指向的版本 |
| 续玩 / 从存档另开 | 沿用该开局创建时记录的版本 |

**怎样复制。**

- **故事事实表：** 实体、称呼、事实、知情、状态栏定义中所有作者设定的行（`origin_turn_id` 为空的行）一起复制，换上新的 `version_id`，其余列原样保留：
  - `entities`、`facts` 的主键是 `(version_id, id)`，`id` 不变；
  - `entity_names`、`knowledge` 通过 `entity_id`、`fact_id` 引用前两张表，引用值不变；
  - `state_defs` 的主键是 `(version_id, id)`，`id` 和 `key` 不变。

  所以复制后各行之间的引用不需要改写，同一个人物在草稿、试玩快照和发布版本里都是同一个 id。
- **meta：** `opening_candidates` 和 `wizardStep` 只属于草稿，不复制；`opening` 只复制已采用的那一份。

**未发布的修改。** 草稿里作者设定的任何写入——`meta` 中除 `wizardStep`、`opening_candidates` 以外的字段，以及实体、称呼、事实、知情、状态定义——都在同一个事务里把草稿的 `content_rev` 加一。复制时，新版本记下源版本的 `content_rev`，写进 `source_rev`。草稿的 `content_rev` 大于最近发布版本的 `source_rev`，就表示有未发布的修改。切换向导步骤这类界面状态不参与计数。

## 3. 经历：开局、回合树、路线、存档

```sql
playthroughs (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  kind          TEXT NOT NULL,     -- play | trial
  protagonist   JSON,              -- 玩家这次填写的主角项目
  cast          JSON,              -- 每局生成模式下本局确定的人物；只在开场提交前暂存，供失败后重试。开场提交时写入实体表，并清空这一列
  illustration  JSON NOT NULL,     -- enabled、style、aspectPreference、resolutionTier、protagonistInFrame、protagonistAppearance、authorPortraitSetIds、protagonistPortraitSetId。开局时写入。主角形象可以补写一次
  root_turn_id  TEXT,              -- 开场回合；开场生成失败时为空，重试时沿用这一行
  created_at
)

turns (
  id            TEXT PRIMARY KEY,
  playthrough_id TEXT NOT NULL REFERENCES playthroughs ON DELETE CASCADE,
  parent_id     TEXT REFERENCES turns,  -- 开场为空
  depth         INTEGER NOT NULL,       -- 开场为 0
  action        JSON,                   -- 行动原话、推荐项序号（若有）及已回答的澄清；开场为空
  prose         TEXT NOT NULL,          -- 正文，段落之间用空行分隔
  options       JSON NOT NULL,          -- 下一步的推荐行动
  scene         JSON NOT NULL,          -- 这一回合结束时的地点、在场者、故事时间
  ending        INTEGER NOT NULL DEFAULT 0,
  illustrate_para INTEGER,              -- 插图放在该段之后；0 表示第一段之前；无标记时为空
  status        TEXT NOT NULL,          -- committed | candidate
  created_at
)

routes (
  id            TEXT PRIMARY KEY,
  playthrough_id TEXT NOT NULL REFERENCES playthroughs ON DELETE CASCADE,
  head_turn_id  TEXT NOT NULL REFERENCES turns,
  name          TEXT,
  draft_input   TEXT,                   -- 玩家已写但尚未发送的输入
  created_at, updated_at
)

saves (
  id            TEXT PRIMARY KEY,
  route_id      TEXT NOT NULL REFERENCES routes ON DELETE CASCADE,
  turn_id       TEXT NOT NULL REFERENCES turns,
  name          TEXT NOT NULL,
  created_at
)
```

父回合、路线 head 和存档指向的回合必须属于同一开局。core 在事务内验证跨表归属；事实、称呼、知情与状态引用必须属于该版本，游玩产生的引用对象必须位于当前祖先链或同一批合法写入中。

开局行的 `authorPortraitSetIds` 按人物保存当时已采用的组 id，`protagonistPortraitSetId` 指向采用的主角参考快照。主角参考可空，人物参考的归属和清理见[插图与出图服务 §9](./image.md#9-存储)。`resolutionTier` 是 `720`、`1k`、`2k` 或仅使用服务默认尺寸时的 `default`。从没有插图设置的库迁移时，已有开局设为纯文字，预填作品默认画风、自动比例和 1K，主角不入画，参考为空。

一个“回合”包含玩家的一次行动和 AI 对它的完整回应；开场是根回合，没有玩家行动。游玩流程里的各种操作，在这棵树上都只需要一两步：

| 操作 | 在树上做什么 |
| --- | --- |
| 续写 | 在 head 下加一个子回合，再把 head 移过去 |
| 换一种发展 | 在 head 的父回合下加一个兄弟回合（玩家行动相同），状态为 `candidate`，head 不动 |
| 采用候选 | head 指向候选，候选改为 `committed`；原来那个回合留在树上，旧存档照样可用 |
| 沿用原版 | 删除这些候选 |
| 手动存档 | 新建一条 `saves`，指向当前 head |
| 从存档另开 | 新建一条 `routes`，head 设为存档指向的回合；之后的行动从那里长出新的分支 |
| 重新开局 | 新建 `playthroughs`，使用作品当前的发布版本 |
| 路线结束 | head 回合的 `ending` 为 1。路线是否结束直接由 head 推导，不单独存一个状态 |

自动保存输入和创建手动存档都携带预期 head；过期时不写入。存档只指向已提交的回合，草稿输入只属于当前决定点，推进或采用候选时一并清空。

**不变量：已提交回合的正文、选项、场景，以及它产生的事实，一律不再修改。** 作者直接编辑文字只发生在草稿的开场里，不会发生在路线中。

“最近游玩的路线”取路线表 `updated_at` 最大的一条。创建路线、提交行动结果或采用候选时更新时间；读取、改名、保存输入和后台摘要不改变排序。作品库卡片上的“最近事件”取自 head 回合中主角已确认的事件。没有可显示的事件时，使用路线名或主角视角的场景标签。§6 的后台摘要只供叙述者检索。

## 4. 故事事实

```sql
entities (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  id            TEXT NOT NULL,
  kind          TEXT NOT NULL,     -- character | place | item | group | other
  name          TEXT NOT NULL,     -- 真名，叙述者视角
  profile       JSON,              -- 档案：身份、习惯、说话方式、关系边界……；人物另有形象 appearance，只写此刻看得见的样子
  is_protagonist INTEGER NOT NULL DEFAULT 0,
  cast_slot     TEXT,              -- 每局生成的人物对应哪个人物位置
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,  -- 空 = 作者设定；开场 = 本局生成；其他 = 游玩中出现
  rev           INTEGER NOT NULL DEFAULT 0,               -- 草稿中每改一次加一
  PRIMARY KEY (version_id, id)
)

entity_names (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  entity_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  holder_id     TEXT,              -- 谁这样称呼他；空 = 公开称呼
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,
  source_para   INTEGER            -- 出处：origin_turn 正文的第几段，从 1 起，按空行切分
)
-- SQLite 的唯一约束把 NULL 当作互不相同，可空列先用 ifnull 归一，否则重复行照样写得进去
CREATE UNIQUE INDEX entity_names_unique
  ON entity_names (version_id, entity_id, name, ifnull(holder_id, ''), ifnull(origin_turn_id, ''));

facts (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  id            TEXT NOT NULL,
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,  -- 空 = 作者设定
  source_para   INTEGER,           -- 出处段号，从 1 起
  kind          TEXT NOT NULL,     -- event | trait | relation | promise | secret | scene_hit
  subject_id    TEXT,
  object_id     TEXT,
  key           TEXT,              -- 见下文“覆盖规则”
  statement     TEXT NOT NULL,     -- 一句话陈述，叙述者视角
  data          JSON,              -- relation: {type, strength, stage}; promise: {status}; secret: {title, reveal}; scene_hit: {scene_id}
  rev           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, id)
)
-- 有 key 的事实，同一组在同一个回合里只能有一行；event 没有 key，不受限
CREATE UNIQUE INDEX facts_keyed_unique
  ON facts (version_id, kind, ifnull(subject_id, ''), ifnull(object_id, ''), key, ifnull(origin_turn_id, ''))
  WHERE key IS NOT NULL;

knowledge (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  fact_id       TEXT NOT NULL,
  holder_id     TEXT NOT NULL,     -- 知情者（实体 id；玩家即主角实体）
  level         TEXT NOT NULL,     -- heard | suspects | confirmed | misled
  perceived_statement TEXT,       -- 未确认时主角实际听见、推测或相信的说法
  via_id        TEXT,              -- 从谁那里得知
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,
  source_para   INTEGER            -- 出处段号，从 1 起
)
CREATE UNIQUE INDEX knowledge_unique
  ON knowledge (version_id, fact_id, holder_id, ifnull(origin_turn_id, ''));

state_defs (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  id            TEXT NOT NULL,
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  display       TEXT NOT NULL,     -- number | stage | list | text
  config        JSON,              -- 随 display 而定，见下文“栏目的显示方式”
  hidden        INTEGER NOT NULL DEFAULT 0,  -- 作者标为幕后：永远不显示给玩家
  reveal        TEXT,              -- 玩家什么时候能看见（作者原文）
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,  -- 空 = 作者定义；否则 = AI 在该回合新增的栏目
  rev           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, id)
)
CREATE UNIQUE INDEX state_defs_key_by_origin
  ON state_defs (version_id, key, ifnull(origin_turn_id, ''));

state_values (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  turn_id       TEXT NOT NULL REFERENCES turns ON DELETE CASCADE,
  state_def_id  TEXT NOT NULL,
  value         TEXT,              -- list 栏目存这一回合合并后的整张清单
  visible       INTEGER NOT NULL,  -- 此刻是否显示给玩家
  closed        INTEGER NOT NULL DEFAULT 0,  -- 事情已了结，栏目收起
  PRIMARY KEY (version_id, turn_id, state_def_id),
  FOREIGN KEY (version_id, state_def_id) REFERENCES state_defs ON DELETE CASCADE
)
```

**知情记录只在认知变化时写。** 某人对某条事实没有任何知情记录，就是不知道；“被误导”（`misled`）和“尚未知道”是两种不同的状态，分开记录。

**主角也是一个实体。** 玩家知道什么，就是主角知道什么，所以知情者永远是实体 id，不需要另设“玩家”这种特殊身份。主角的姓名如果留给玩家填写，就在开场回合里写一条 `entity_names`。每个版本恰好有一个 `is_protagonist = 1` 的实体；开场回合为主角写一条主角自己持有的称呼，所以主角总知道自己的名字。

**覆盖规则。**

- `key` 不为空的事实，按 `(kind, subject_id, object_id, key)` 分组，后面的覆盖前面的。
- `event` 不设 `key`，只累加。已经发生的事就是历史，不会被撤销；要让它“没发生过”，只能是换一种发展，而那是树上的另一个节点。
- `knowledge` 按 `(fact_id, holder_id)` 分组，后面的覆盖前面的。
- `state_values` 按 `state_def_id` 分组，后面的覆盖前面的。
- “后面”指所在回合的 `depth` 更大。作者设定的行视为 `depth = -1`，所以总是最先被覆盖。
- **同一组在同一个回合里最多只有一行。** `facts`、`entity_names`、`knowledge` 的唯一索引和 `state_values` 的主键保证这一点，所以“取 depth 最大的那一行”的结果总是唯一的。

**栏目身份。** 栏目的 `id` 是存储身份，`key` 是 narrator 在当前路线引用的名称。新增时拒绝与当前投影或同批新增栏目重名。不同开局、兄弟分支和候选可以各自新增同名栏目。状态值引用当前投影中的栏目 id，或同批新建栏目的 id。

**栏目的显示方式。** `display` 决定 `config` 和 `value` 的写法，以及玩家看到什么：

| `display` | `config` | `value` | 玩家看到什么 |
| --- | --- | --- | --- |
| `number` | `{"min", "max", "unit"}`，都可以省略，同时给出两端时 `min < max` | 有限的十进制数字，遵守已设置的上下限 | 数字和单位；两端都有值时加一条进度条 |
| `stage` | `{"stages": [...]}`，按先后列出至少两个不同的阶段名 | `stages` 里的某一项 | 一排分段，已到达的段填满；只写出当前阶段的名字，没到达的阶段只显示还剩几步 |
| `list` | 空 | JSON 数组，每项是 `{"item", "status"}`，`status` 为 `open`、`done`、`failed`、`gone` 之一 | 每项一行，带状态图标和状态文字；`gone` 的项不再显示 |
| `text` | 空 | 一句话 | 原文 |

- **core 在写入时按 `display` 校验 `config` 和 `value`。** 作者在向导里写 `config`；narrator 新增栏目时随 `new_state` 给出（[回合循环 §5](./turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。改 `config` 和改其他列一样让 `rev` 加一。
- **没到达的阶段不写名字。** 阶段名本身就可能是剧透，例如“告白”“决裂”。
- **清单按条目合并。** narrator 每回合只交出有变化的条目（`state_item`），core 把它们并进该栏目在父回合的清单，再把整张清单写成这一回合的一条状态值。narrator 不必每回合重抄整张清单，也就不会漏抄；“后面的覆盖前面的”对清单照样成立。条目按 `item` 原文识别，同一栏目里不重复。只交了条目、没交 `state` 时，`visible` 和 `closed` 沿用父回合的值；栏目第一次有值时默认不显示。

**状态栏目显示给谁。** 三个字段按以下优先级决定：

1. `state_defs.hidden` 为 1 的栏目永远不显示给玩家，任何状态变化都不能把它设为显示；
2. 其余栏目此刻是否显示，由最近一次状态变化的 `visible` 决定；`closed` 为 1 时栏目收起，但来历仍留在手记里；
3. `state_defs.reveal` 是作者写的揭晓条件原文。它交给 narrator 判断什么时候把 `visible` 设为 1，由评测保证，不做确定性校验。

**采用开场时的归属。** 作者采用的开场预览里新出现的实体，视为作者认可的设定：`origin_turn_id` 为空，同一个 `id` 同时写进草稿和发布版本，所以将来从同一个开场重新开局时，固定人物不会丢。开场里的称呼、事件、特征、关系、约定和知情挂在根回合上，因为它们是这一局开场时发生的经历。

**几个典型的事实：**

| 情形 | 怎样记录 |
| --- | --- |
| 约定 | 先是一条 `event` 记下“对方问明天还会等我吗”；玩家答应后，才写 `promise`（`key` 是约定名，`status=agreed`），出处必须是答应的那一段；之后再写 `kept` 或 `broken`。一次询问不能直接记成承诺 |
| 认识的过程 | 主角对某人的 `relation`，`key=acquaintance`，`data.stage` 依次为 `heard_of`、`met`、`familiar`。听说时在 `data.via` 里记下是谁提起的 |
| 秘密 | `secret` 事实，`data.title` 是无剧透的标题，`data.reveal` 是揭晓条件原文。秘密可以来自作者设定，也可以由 narrator 在游玩中创造（[回合循环 §5](./turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。一开始就知情的角色，用同一来源的 `knowledge` 行表示；主角得知秘密时，追加一条带出处的 `knowledge` |
| 称呼 | 真名在 `entities.name`；主角知道的称呼是 `entity_names` 中 `holder_id` 为主角的行，例如“撑伞的女人”，得知真名后再追加一条 |
| 关键场面已触发 | 写一条 `scene_hit` 事实，`key` 是场面编号，出处是发生的那一段 |
| 人物的样子变了 | 写一条 `trait` 事实，`key` 是 `appearance`，`statement` 是此刻看得见的新样子，出处是发生变化的那一段。当前形象取路线上可见的最新一条。主角在变化前后都能认出此人时，可以在 `data.same_visible_identity` 标为 `true`（[插图与出图服务 §6.2](./image.md#62-人物参考组)） |
| 新增状态栏目 | 写一条 `state_defs`，`origin_turn_id` 指向新增它的回合；作者标为幕后的信息，在新栏目里同样设为 `hidden` |

**同名不等于同一个人。** 查人物时，同时结合称呼、当前场景和已有的关系来判断。同名的多个实体会全部作为候选返回，由调用方区分（见[回合循环 §4](./turn-loop.md#4-只读工具)）。

## 5. 可见性规则

所有故事事实都用同一条规则判断可见性：

```sql
WITH RECURSIVE path(id, parent_id, depth) AS (
  SELECT id, parent_id, depth FROM turns WHERE id = :head
  UNION ALL
  SELECT t.id, t.parent_id, t.depth FROM turns t JOIN path p ON t.id = p.parent_id
)
-- 可见 = 本版本中 origin_turn_id 为空的行（作者设定）
--      + origin_turn_id 在 path 里的行
-- 同一组内取 depth 最大的那一行（覆盖规则见 §4）
```

每个请求开始时，把 `path` 算一次放进临时表，之后的所有查询都和这张表连接。

不需要另外写过滤条件，下面这些就自然不可见：

- 未采用的候选：它们是兄弟节点，不在祖先链上；
- 别的路线上发生的事：它们在别的分支上；
- 作者的试玩：试玩快照是另一个 `version_id`；
- 其他作品：同样是另一个 `version_id`。

未被选择的推荐行动、重写时写的偏好，都不会写成事实，因此也不会成为任何人物的记忆。

**三种视角：**

| 视角 | 给谁用 | 能看见什么 |
| --- | --- | --- |
| 叙述者 | 回合循环的只读工具 | 路线上所有可见的行，并标注每件事谁知道 |
| 主角 | client 的状态栏、手记、人物称呼；回合校验中的泄露检查 | 只有主角知情的事实、主角知道的称呼，以及未标幕后、当前设为显示的状态值。未确认的知情只投影 `perceived_statement`、知情程度和可公开的出处，不投影事实原句或其他幕后字段 |
| 作者 | 创作工作站 | 草稿里的作者设定；幕后设定折叠时，秘密只显示无剧透标题 |

**插图按段落投影。** 输入是目标回合和图片所在段号。取这个回合的祖先链，回合内只使用截至该段的正文、已有明确出处的事实、称呼和知情记录。同回合里出处缺失或在后面的记录不进入镜头，也不用回合结束时的 `scene` 推断段内在场者。人物只有在截至该段的正文或已知事实中可确认亲眼见到、且处于画面当时的场景中，才提供该段可确认的形象和参考图。看不出谁在场或是什么样子时，只用可确认的文字线索。

段号 0 只使用所选作品版本中主角开局前已知的设定。地点同样要在这些材料中可确认。缺少可入画的线索时跳过开场图。重试、重画与分线回看都用原回合和原段号，已发生的揭晓不会倒流到旧图里。

**手记不单独建表。** 它直接从主角视角的知情记录和出处生成，按人物、地点、事件分组；有出处时可跳回本路线原文。初始已知且没有出处的条目不显示跳转。只有确认知情的记录可以使用事实陈述；听说、猜测和误信只显示主角实际听见或相信的说法。没有保存该说法时，不生成手记条目。采用另一版回应后，head 变了，手记跟着变，不需要同步任何东西。

**状态栏的投影。** client 的状态栏同样走主角视角，不另建表。每个显示中的栏目给出：

- 显示方式和当前值。数字栏目附单位和已设置的边界，阶段栏目只附当时的阶段名、步序和总步数，清单栏目只返回可显示的条目。由 core 生成这些视图，原始阶段列表留在 core；
- 父回合时同样经过投影的值，client 据此标出数字增减、先前文字和清单变化。父回合时栏目还没显示，就不给旧值，栏目标为“新”；
- 本路线上每次可见变化的出处和当时的投影值。隐藏期间写下的值和未到达的阶段名不进入来历；
- `closed` 为 1 的栏目单独给出，由 client 收进“已了结”。

> 已知限制：祖先链用递归查询，适合几百个回合的路线。路线深到上千回合、查询明显变慢时，改用闭包表保存祖先关系。

## 6. 派生数据

```sql
turn_summaries (
  turn_id   TEXT PRIMARY KEY REFERENCES turns ON DELETE CASCADE,
  summary   TEXT NOT NULL,       -- 一两句话，必须点名出现的人物、地点和事件
  created_at
)

prose_fts  -- FTS5 虚表，tokenize='trigram'
  (turn_id UNINDEXED, para UNINDEXED, body)

-- FTS5 虚表不能声明外键，回合删除时由触发器清掉它的索引行
CREATE TRIGGER turns_delete_fts AFTER DELETE ON turns
BEGIN DELETE FROM prose_fts WHERE turn_id = old.id; END;
```

- **全文索引在提交回合的同一个事务里写入**，所以已提交的回合一定搜得到。
- **摘要在后台生成**（见[回合循环 §9](./turn-loop.md#9-后台摘要)）。生成失败或还没生成时，用“回合编号 + 玩家行动”代替；开场回合没有玩家行动，用“开场”。
- **中文检索：** trigram 分词能处理中文，但不足 3 个字的查询切不出任何片段，结构上就搜不到。所以 1–2 个字的查询改为在祖先链的段落里做子串扫描。扫描范围受路线长度限制。
- **派生数据不需要版本栅栏。** 已提交的回合不会再变，所以不存在“摘要基于旧版正文”的问题。写入摘要时只需确认回合仍然存在：候选被删除时，它的摘要随外键删除，索引行由上面的触发器删除。

## 7. 写在其他文档里的表

| 表 | 文档 |
| --- | --- |
| `turn_requests`：一次回合请求的状态 | [回合循环 §2](./turn-loop.md#2-回合请求) |
| `chat_threads`、`chat_messages`、`card_claims`、`jobs` | [创作工作站 §13](./author-workstation.md#13-数据表) |
| `llm_calls`：模型调用记录 | [LLM 端点 §9](./llm-endpoints.md#9-调用记录) |
| `llm_call_logs`：模型调用正文 | [LLM 端点 §9.1](./llm-endpoints.md#91-调试日志) |
| `app_settings`：外观与阅读偏好 | [主题与 token §9](./theme.md#9-外观偏好与切换) |
| `illustrations`、`portrait_sets`：插图与人物参考组 | [插图与出图服务 §9.2](./image.md#92-表) |
| `image_calls`：出图调用记录 | [插图与出图服务 §11](./image.md#11-调用记录与诊断) |

## 8. 删除

SQLite 默认不执行外键约束。core 打开每个数据库连接时都执行 `PRAGMA foreign_keys = ON`，下面的级联删除才会生效。

- **删除作品：** 外键级联删除版本、开局、回合、路线、存档、故事事实、对话和生成任务。回合删除触发器清理正文索引。插图和人物参考的记录随外键删除。遗留图片按[插图与出图服务 §9.4](./image.md#94-清理)判断是否还有引用。
- **删除候选：** 挂在它上面的事实、称呼、知情、状态值、摘要随外键删除，索引行由触发器删除。候选不画插图，所以没有图片要清理。
- **试玩：** 试玩快照和它的试玩进度一起保留，随作品一起删除，不单独提供删除。
- **被替换下来的原版回合不删除**，因为旧存档可能还指向它。

## 9. 不做的事

- **单独删除一次试玩。** 试玩记录体量小，随作品一起删除就够了；单独删除要设计入口和确认流程，收益不大。
- **跨作品共享人物或设定。** 每部作品的故事事实都按版本隔离，同名人物在不同作品里互不相干。
- **语义检索和向量索引。** 检索只用 trigram 全文检索和短查询的子串扫描（§6）。

## 10. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 两部作品各有一个同名角色；同一部作品的两次开局里，这个角色又有不同的称呼 | 在每条路线里分别查询这个名字 | 查到的都是本作品、本路线的那个人物，以及对应的原文 |
| 同一个发布版本的两条兄弟路线 | 分别新增相同 key 的状态栏目，并设置不同的值 | 两条路线均保存成功，各自只显示自己的栏目和值 |
| 一个阶段栏目，作者发布后改了阶段列表，再发布一次 | 分别续玩旧路线和新开一局 | 旧路线按旧版本的阶段显示，新开局按新的阶段显示 |
| 一个清单栏目，narrator 连续三回合各交一个条目变化 | 查看第三回合的状态值 | 清单里有三个回合累计的全部条目，每项是最后一次的状态 |
| 一个栏目隐藏期间改过两次值，然后设为显示 | 打开它的来历 | 来历从设为显示的那一回合开始，看不到隐藏期间的值 |
| 一个阶段栏目的后续阶段名包含幕后剧情 | 查询当前状态、父回合和来历 | client 只收到各个回合可见的阶段名、步序和总步数，响应里没有未到达的阶段名 |
| 一条路线在第 5 回合存档后继续走 | 从存档另开，采取不同行动，然后在两条路线里各查第 5 回合之后的事 | 第 5 回合以前的事实两边都能看见，之后的事实只在各自的路线里可见 |
| 作者改了某个人物并发布新版本 | 分别续玩旧路线、从旧存档另开、新开一局 | 前两种用旧版本的人物，新开局用新版本的人物 |
