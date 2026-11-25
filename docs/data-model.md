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
| `settings` | 补充设定。每一节都保存作者原文、作者的选择（例如主要人物用固定角色还是每局生成、行动提示是只显示行动还是提醒已知后果），以及这一节自己的修订号 `rev` |
| `plan` | 故事方案。每一项都标明来源：`author`（作者写的）、`ai`（AI 补全的）、`author_confirmed`（作者在提案卡上确认过的 AI 内容）。`author` 和 `author_confirmed` 都受“作者设定优先”的保护，AI 不能直接改写 |
| `protagonist_fields` | 作者留给玩家填写的主角项目。每一项有项目名和默认值，玩家留空时用默认值，开场占位符因此总有值可填 |
| `cast_slots` | 主要人物的位置。固定角色指向一个实体；每局生成的位置保存这个角色在故事里的作用和一次相遇样例 |
| `opening` | 采用的开场：正文、初始选项、初始场景、初始状态值，以及它引用了哪些设定、各是什么修订号（见[创作工作站 §7](./author-workstation.md#7-受影响范围与开场核对)）。正文、初始选项和初始状态值里都可以含主角填写项的占位符，格式为 `{{protagonist.<项目名>}}`，开局时一并替换成玩家填写的值（[回合循环 §10](./turn-loop.md#10-开场)） |
| `opening_candidates` | 仅草稿有：候选开场 |
| `key_scenes` | 关键场面：每条有编号、条件原文、发生什么、是否只发生一次 |
| `ending` | 结束条件原文；为空表示开放式作品 |
| `narration` | 作品语言，以及基调、视角、段落节奏、对白风格等叙事要求。作品语言在生成故事方案时按作者背景所用的语言定下，作者可以修改（[i18n §6](./i18n.md#6-作品语言)） |
| `wizard_step` | 仅草稿有：向导停在哪一步 |

**标题和简介是作品的展示信息，不属于版本。** 它们只用来在作品库和路线列表里辨认作品，所以存在 `works` 上，不随版本复制。作者随时可以修改，改完作品库和所有路线立即显示新的；写入不计入 `content_rev`，也不需要“应用到新开局”。游玩时的上下文不包含它们（[回合循环 §3](./turn-loop.md#3-上下文哪些直接给哪些让模型查)），所以改名不影响任何路线里的故事。

**为什么这些放在 JSON 里。** 它们由向导和工作站整块读写，从不按名字查询，而且只属于某一个版本。人物、地点、事实、状态栏定义则放进下面的表，因为回合循环的只读工具要把它们和游玩中产生的行一起查询。

**版本的生命周期：**

| 时机 | 操作 |
| --- | --- |
| 新建作品 | 建立 `works` 和一份 `draft` 版本 |
| 开始试玩 | 把草稿复制成一份 `trial` 版本，再新建一个 `kind=trial` 的开局 |
| 存入作品库 / 应用到新开局 | 把草稿复制成一份 `published` 版本，`works.published_id` 改指向它 |
| 新开局 | 使用 `works.published_id` 指向的版本 |
| 续玩 / 从存档另开 | 沿用该开局创建时记录的版本 |

**怎样复制。**

- **故事事实表：** 实体、称呼、事实、知情、状态栏定义中所有作者设定的行（`origin_turn_id` 为空的行）一起复制，换上新的 `version_id`，其余列原样保留：
  - `entities`、`facts` 的主键是 `(version_id, id)`，`id` 不变；
  - `entity_names`、`knowledge` 通过 `entity_id`、`fact_id` 引用前两张表，引用值不变；
  - `state_defs` 的主键是 `(version_id, key)`，`key` 不变。

  所以复制后各行之间的引用不需要改写，同一个人物在草稿、试玩快照和发布版本里都是同一个 id。
- **meta：** `opening_candidates` 和 `wizard_step` 只属于草稿，不复制；`opening` 只复制已采用的那一份。

**未发布的修改。** 草稿里作者设定的任何写入——`meta` 中除 `wizard_step`、`opening_candidates` 以外的字段，以及实体、称呼、事实、知情、状态定义——都在同一个事务里把草稿的 `content_rev` 加一。复制时，新版本记下源版本的 `content_rev`，写进 `source_rev`。草稿的 `content_rev` 大于最近发布版本的 `source_rev`，就表示有未发布的修改。切换向导步骤这类界面状态不参与计数。

## 3. 经历：开局、回合树、路线、存档

```sql
playthroughs (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  kind          TEXT NOT NULL,     -- play | trial
  protagonist   JSON,              -- 玩家这次填写的主角项目
  cast          JSON,              -- 每局生成模式下本局确定的人物；只在开场提交前暂存，供失败后重试。开场提交时写入实体表，并清空这一列
  root_turn_id  TEXT,              -- 开场回合；开场生成失败时为空，重试时沿用这一行
  created_at
)

turns (
  id            TEXT PRIMARY KEY,
  playthrough_id TEXT NOT NULL REFERENCES playthroughs ON DELETE CASCADE,
  parent_id     TEXT REFERENCES turns,  -- 开场为空
  depth         INTEGER NOT NULL,       -- 开场为 0
  action        JSON,                   -- 玩家行动的原话：{kind: option | free, text}；开场为空
  prose         TEXT NOT NULL,          -- 正文，段落之间用空行分隔
  options       JSON NOT NULL,          -- 下一步的推荐行动
  scene         JSON NOT NULL,          -- 这一回合结束时的地点、在场者、故事时间
  ending        INTEGER NOT NULL DEFAULT 0,
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

**不变量：已提交回合的正文、选项、场景，以及它产生的事实，一律不再修改。** 作者直接编辑文字只发生在草稿的开场里，不会发生在路线中。

“最近游玩的路线”就是 `updated_at` 最大的那条。作品库卡片上的“最近事件”取自 head 回合的摘要（§6）。

## 4. 故事事实

```sql
entities (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  id            TEXT NOT NULL,
  kind          TEXT NOT NULL,     -- character | place | item | group | other
  name          TEXT NOT NULL,     -- 真名，叙述者视角
  profile       JSON,              -- 档案：身份、习惯、说话方式、关系边界……
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
  source_para   INTEGER            -- 出处：origin_turn 正文的第几段
)
-- SQLite 的唯一约束把 NULL 当作互不相同，可空列先用 ifnull 归一，否则重复行照样写得进去
CREATE UNIQUE INDEX entity_names_unique
  ON entity_names (version_id, entity_id, name, ifnull(holder_id, ''), ifnull(origin_turn_id, ''));

facts (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  id            TEXT NOT NULL,
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,  -- 空 = 作者设定
  source_para   INTEGER,
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
  via_id        TEXT,              -- 从谁那里得知
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,
  source_para   INTEGER
)
CREATE UNIQUE INDEX knowledge_unique
  ON knowledge (version_id, fact_id, holder_id, ifnull(origin_turn_id, ''));

state_defs (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  display       TEXT NOT NULL,     -- number | stage | text
  hidden        INTEGER NOT NULL DEFAULT 0,  -- 作者标为幕后：永远不显示给玩家
  reveal        TEXT,              -- 玩家什么时候能看见（作者原文）
  origin_turn_id TEXT REFERENCES turns ON DELETE CASCADE,  -- 空 = 作者定义；否则 = AI 在该回合新增的栏目
  rev           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, key)
)

state_values (
  version_id    TEXT NOT NULL REFERENCES work_versions ON DELETE CASCADE,
  turn_id       TEXT NOT NULL REFERENCES turns ON DELETE CASCADE,
  key           TEXT NOT NULL,
  value         TEXT,
  visible       INTEGER NOT NULL,  -- 此刻是否显示给玩家
  closed        INTEGER NOT NULL DEFAULT 0,  -- 事情已了结，栏目收起
  PRIMARY KEY (version_id, turn_id, key)
)
```

**知情记录只在认知变化时写。** 某人对某条事实没有任何知情记录，就是不知道；“被误导”（`misled`）和“尚未知道”是两种不同的状态，分开记录。

**主角也是一个实体。** 玩家知道什么，就是主角知道什么，所以知情者永远是实体 id，不需要另设“玩家”这种特殊身份。主角的姓名如果留给玩家填写，就在开场回合里写一条 `entity_names`。

**覆盖规则。**

- `key` 不为空的事实，按 `(kind, subject_id, object_id, key)` 分组，后面的覆盖前面的。
- `event` 不设 `key`，只累加。已经发生的事就是历史，不会被撤销；要让它“没发生过”，只能是换一种发展，而那是树上的另一个节点。
- `knowledge` 按 `(fact_id, holder_id)` 分组，后面的覆盖前面的。
- `state_values` 按 `key` 分组，后面的覆盖前面的。
- “后面”指所在回合的 `depth` 更大。作者设定的行视为 `depth = -1`，所以总是最先被覆盖。
- **同一组在同一个回合里最多只有一行。** `facts`、`entity_names`、`knowledge` 的唯一索引和 `state_values` 的主键保证这一点，所以“取 depth 最大的那一行”的结果总是唯一的。

**状态栏目显示给谁。** 三个字段按以下优先级决定：

1. `state_defs.hidden` 为 1 的栏目永远不显示给玩家，任何状态变化都不能把它设为显示；
2. 其余栏目此刻是否显示，由最近一次状态变化的 `visible` 决定；`closed` 为 1 时栏目收起，但来历仍留在手记里；
3. `state_defs.reveal` 是作者写的揭晓条件原文。它交给 narrator 判断什么时候把 `visible` 设为 1，由评测保证，不做确定性校验。

**几个典型的事实：**

| 情形 | 怎样记录 |
| --- | --- |
| 约定 | 先是一条 `event` 记下“对方问明天还会等我吗”；玩家答应后，才写 `promise`（`key` 是约定名，`status=agreed`），出处必须是答应的那一段；之后再写 `kept` 或 `broken`。一次询问不能直接记成承诺 |
| 认识的过程 | 主角对某人的 `relation`，`key=acquaintance`，`data.stage` 依次为 `heard_of`、`met`、`familiar`。听说时在 `data.via` 里记下是谁提起的 |
| 秘密 | `secret` 事实，`data.title` 是无剧透的标题，`data.reveal` 是揭晓条件原文。秘密可以来自作者设定，也可以由 narrator 在游玩中创造（[回合循环 §5](./turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。一开始就知情的角色，用同一来源的 `knowledge` 行表示；主角得知秘密时，追加一条带出处的 `knowledge` |
| 称呼 | 真名在 `entities.name`；主角知道的称呼是 `entity_names` 中 `holder_id` 为主角的行，例如“撑伞的女人”，得知真名后再追加一条 |
| 关键场面已触发 | 写一条 `scene_hit` 事实，`key` 是场面编号，出处是发生的那一段 |
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
| 主角 | client 的状态栏、手记、人物称呼；回合校验中的泄露检查 | 只有主角知情的事实、主角知道的称呼，以及未标幕后、当前设为显示的状态值 |
| 作者 | 创作工作站 | 草稿里的作者设定；幕后设定折叠时，秘密只显示无剧透标题 |

**手记不单独建表。** 它直接从“主角的知情记录 + 出处段落”生成，按人物、地点、事件分组；点出处就跳回本路线的原文。采用另一版回应后，head 变了，手记跟着变，不需要同步任何东西。

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

## 8. 删除

SQLite 默认不执行外键约束。core 打开每个数据库连接时都执行 `PRAGMA foreign_keys = ON`，下面的级联删除才会生效。

- **删除作品：** 外键级联删除它的所有版本；版本下的开局、回合、路线、存档，以及作者设定和游玩产生的故事事实，都随版本删除；对话和生成任务随作品删除。正文的索引行由回合删除触发器清掉。
- **删除候选：** 挂在它上面的事实、称呼、知情、状态值、摘要随外键删除，索引行由触发器删除。
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
| 一条路线在第 5 回合存档后继续走 | 从存档另开，采取不同行动，然后在两条路线里各查第 5 回合之后的事 | 第 5 回合以前的事实两边都能看见，之后的事实只在各自的路线里可见 |
| 作者改了某个人物并发布新版本 | 分别续玩旧路线、从旧存档另开、新开一局 | 前两种用旧版本的人物，新开局用新版本的人物 |
