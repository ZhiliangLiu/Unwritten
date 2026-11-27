# Unwritten · 运行诊断与性能记录

运行事件回答“这次操作发生了什么”。性能样本回答“时间花在哪一步”。两者存进同一个本机 SQLite 库，按一次运行、一次生成任务或一次模型调用关联。

## 1. 存储与生命周期

数据目录下的 `diagnostics.db` 是运行事件和性能样本的唯一持久化位置。core 打开诊断库后再打开 `library.db`，因此作品库加锁失败或迁移失败时，仍能留下可查询的诊断记录。client 经鉴权后的 `log.client` 上报，由 core 写入诊断库。desktop 不导入 core，也不另开诊断库：它把运行事件和性能样本经进程消息通道的 `log` 消息交给 core（[架构总览 §2.3](./architecture.md#23-core-与-desktop-的进程消息通道)），core 按事件名白名单校验后写入，事件的 `module` 固定为 `desktop`，样本的 `source` 固定为 `desktop`。core 就绪之前，desktop 在内存里最多缓存 64 条（常量 `DESKTOP_LOG_BUFFER_MAX`），超出的丢弃并计数；core 就绪后先写一条带丢弃数量的 `desktop.dropped`，再按顺序写缓存。core 意外退出到重启就绪之间同样先缓存。诊断库维护自己的迁移记录，使用 SQLite WAL 模式，短事务写入可与本机诊断查询并行。`-wal` 和 `-shm` 是 SQLite 管理的数据库伴随文件。诊断连接使用普通锁模式，遇到写锁争用立即返回。

诊断写入使用有上限的内存队列，离开当前业务调用栈后按批提交。入队即安排提交，不需要调用方显式刷新；关闭时先提交队列再关闭诊断库，关闭之后不再重开。队列上限默认 1,024 条，满时丢弃新记录并计数。运行中，每轮最多写入 128 条，剩余记录留到下一轮。诊断库打开或写入失败时，丢弃失败批次并计数，业务结果照常提交。首次出现故障时向 stderr 发出固定错误提示，还在队列里的批次照常轮转，下一批按需重新打开诊断库。有待记录的丢弃数量时，在批次内留一条给 `diagnostics.dropped`，事务提交后才结清该事件记录的数量。

正常退出和可处理的启动失败先取消并等待已启动的后台任务，再关闭作品库、提交诊断队列并关闭诊断库。进程意外退出时，已提交的记录仍可查询，内存中的队列可能丢失。

运行事件和性能样本默认保留 14 天。诊断模块的常量定义保留期、队列上限和批次上限。启动时和 UTC 日期改变后的首次写入时安排清理，通过时间索引分批删除过期行。清理与诊断写入各自提交，每轮清理受同一批次上限限制。应用的日志、调试和性能记录都禁止写入数据库以外的文件。

## 2. 运行事件

```sql
diagnostic_events (
  id          TEXT NOT NULL PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  run_id      TEXT NOT NULL,
  level       TEXT NOT NULL,
  module      TEXT NOT NULL,
  event       TEXT NOT NULL,
  work_id     TEXT,
  request_id  TEXT,
  job_id      TEXT,
  call_id     TEXT,
  data        JSON NOT NULL
)
```

`created_at` 是 Unix 毫秒时间戳，client 记录取 core 接收时间。`run_id` 标识一次 core 进程运行，由接收方写入：client 和 desktop 的记录都带上收下它们的那次 core 运行。事件名和各事件允许的字段由各模块的事件定义统一校验。默认记录 `info` 及以上运行事件，`--log-level` 可调。性能样本与写入端自己的丢弃计数始终采集。

关联 ID 可留空。数据库以时间和关联 ID 为查询入口，关联 ID 指向作品库中的记录，跨库查询不设外键。模型的用量、费用和单次调用总耗时保存在 `library.db` 的 `llm_calls`，诊断事件用同一个 `call_id` 关联。工具足迹留在原回合请求上，按作品的生命周期清理。详见[模型调用记录](./llm-endpoints.md#9-调用记录)和[回合请求](./turn-loop.md#2-回合请求)。

落库前按事件字段白名单取值。错误记录使用稳定错误码和失败阶段。凭据、带令牌的 URL、请求与响应正文、诊断栈原文、作品内容和玩家输入都不进入诊断库。`log.client` 只接受契约中列出的错误字段与性能项，拒绝未知字段。上报失败时结束本次上报，避免递归上报。

### 2.1 错误提示与诊断编号

普通 RPC 失败返回稳定错误码和诊断编号。client 显示原因与下一步操作，编号可以直接查到 `diagnostic_events.id`。模型连接测试失败也返回编号，模型请求记录收到的 HTTP 状态码。预览和续写的异步失败沿用任务 ID 和请求 ID，重试续写时日志附上尝试号。旧任务和旧请求也可以用已有 ID 查询。

RPC 的失败事件记录过程名、错误码和失败阶段。输入或输出未通过契约校验时记录问题数。意外异常额外记录有限的异常类型、SQLite 数字错误码或已知的系统错误码。磁盘已满、存储只读或权限不足、SQLite 锁争用有独立错误提示。运行中的写入与读取使用同一套存储错误分类。

作品成功创建、草稿成功保存、预览或续写提交失败、后台运行异常和启动失败各有事件。写入失败状态也出错时，另记 `failure_state` 事件，保留原提交失败的事件和耗时。作品库无法写入时，生成状态保留上次成功写入的值，重启时按既有恢复流程处理未完成的尝试。生成期间删除作品，无法提交的预览记为中断。草稿未改动时不重复记录保存成功。client 的渲染异常、未处理异常和事件流中断通过现有上报接口记录固定来源和错误码。事件流重新连通时上报一次中断原因，连续重连失败不重复记日志。

故事方案和开局与预览、续写同样记录开始、完成、失败和中断：方案任务记 `plan.job.started`、`plan.job.done`、`plan.job.failed`、`plan.job.interrupted`，完成时附方案项数、冲突数和结果是否过期；作者改一项、删一项、确认方案各有事件，确认时附写入的人物、秘密、栏目、场面条数和主要人物模式。开局记 `playthrough.started`，附人物模式和玩家填了几项；每局生成人物的开场请求记 `opening.request.done` 或 `opening.request.failed`，失败时附阶段（人物、开场、校验、提交）。保存草稿的事件附本次改了的补充设定节。

插图和出图服务各有事件，见[插图与出图服务](./image.md)。`illustration.flagged` 附路线 id 和回合深度，用来按路线统计标记率。`illustration.done`、`illustration.failed` 和 `illustration.dismissed` 记录结果，失败时附步骤和错误类别。`portrait.done` 和 `portrait.failed` 记录人物参考任务结果。`image.service.probe` 记录服务、协议和探测结果。`image.gc` 记录回收的组数、文件数和字节数。提示词、画面说明和形象原文留在作品库。

desktop 的事件由 contracts 的 `/desktop` 入口逐个定义字段：`desktop.started`（是否打包、是否开发模式、平台）、`desktop.shell_env`（是否成功、是否超时、读到的变量个数）、`desktop.core_exited`（退出码、启动中还是运行中）、`desktop.core_ready_timeout`、`desktop.core_restarted`（重试还是重启）、`desktop.renderer_gone`（Electron 给出的原因）、`desktop.navigation_blocked`（导航还是新窗口、是否交给了系统浏览器）、`desktop.dropped`（丢弃条数）。不合格的进程消息由 core 记 `desktop.channel.invalid`，附消息种类和校验问题数。窗口地址带令牌，任何事件都不记录它。

在数据目录打开 `diagnostics.db`，将界面上的诊断编号传给以下查询：

```sql
SELECT created_at, level, module, event, data
FROM diagnostic_events
WHERE id = :id OR job_id = :id OR request_id = :id
ORDER BY created_at;
```

进程无法连接、诊断库暂时不可写或日志级别过滤掉事件时，诊断记录可能缺失。独立运行的启动失败仍在 stderr 提示，能落库时另有阶段和诊断编号。桌面版的启动失败由 core 记下诊断编号，经 `start-failed` 消息交给 desktop，显示在启动错误对话框里。

## 3. 性能样本

```sql
performance_samples (
  id           TEXT NOT NULL PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  run_id       TEXT NOT NULL,
  app_version  TEXT NOT NULL,
  source       TEXT NOT NULL,
  metric       TEXT NOT NULL,
  duration_ms  REAL NOT NULL,
  outcome      TEXT NOT NULL,
  work_id      TEXT,
  request_id   TEXT,
  job_id       TEXT,
  call_id      TEXT,
  attempt      INTEGER,
  data         JSON NOT NULL
)
```

每个样本记录一个计时区间。用产生样本的进程或页面的单调时钟计算非负耗时。区间结束后再交样本，`outcome` 为 `ok`、`error` 或 `interrupted`，被新的决定点取代也计为 `interrupted`。每次应用层重试重新计时，用原请求 ID 和本次尝试号关联。重启时，core 为每个恢复为失败的任务或请求记一条带原 ID 的中断事件。耗时只来自同一个时钟完成的测量。core 样本的 `created_at` 取计时终点，client 样本的 `created_at` 取 core 收到上报的时间。

| 样本 | 起点 | 终点 |
| --- | --- | --- |
| `core.startup` | 进入启动流程 | HTTP 开始监听，或启动失败 |
| `core.library_open` | 开始打开作品库 | 加锁与迁移完成，或其中一步失败 |
| `core.recover` | 开始恢复中断任务与请求 | 恢复事务结束 |
| `llm.connection_test` | core 开始测试模型连接 | 工具探测完成或失败 |
| `llm.first_output` | 当次模型调用发出 | 收到首个输出事件。没有收到输出的调用通过 `llm_calls` 查询 |
| `preview.total`、`turn.total` | core 接受该次生成尝试 | 结果提交、失败或中断，含正常退出时取消的排队尝试 |
| `preview.queue`、`turn.queue` | 尝试入队 | 开始处理该尝试 |
| `turn.context` | 开始读取并构建续写上下文 | 上下文可提交给模型，或构建失败。成功时附纳入的回合数、估算的上下文 token 数、索引列出的实体数、摘要行数，以及秘密、状态栏、关键场面各占几行；无论成败都附作者锚点占的 token 数 |
| `story.projection` | 开始读取一条路线可见的故事事实 | 投影可用。附实体、事实、知情的条数 |
| `story.tool` | 模型调用一次只读工具 | 工具返回结果或错误。附工具名和返回的记录条数 |
| `summary.total` | 摘要任务开始处理 | 摘要写入、失败或回合已不存在 |
| `settings.update` | core 收到外观偏好的修改 | 写入完成或失败 |
| `plan.queue`、`plan.total` | 方案任务入队；core 接受该次生成 | 开始处理；结果写入、失败或中断。总耗时附方案项数 |
| `plan.validate`、`plan.commit` | 开始校验一次方案提案；开始提交 | 得到校验结果；提交成功或回滚 |
| `plan.confirm` | 收到确认方案 | 结构化设定写入完成或失败。附人物、秘密、栏目、场面条数 |
| `opening.queue`、`opening.total` | 开场请求入队；core 接受该次尝试 | 开始处理；根回合提交、失败或中断 |
| `opening.cast` | 开始生成本局人物 | 人物写入开局，或失败 |
| `opening.validate`、`opening.commit` | 开始校验一次开场提案；开始提交 | 同 `turn.validate`、`turn.commit` |
| `story.status` | 开始读取一条路线的状态栏 | 主角视角的状态栏可用。附显示中与已了结的栏目数 |
| `illustration.queue`、`illustration.total` | 插图入队；开始处理 | 开始处理；文件写入并提交、失败或中断。总耗时附参考人物数和是否现画了立绘 |
| `illustration.shot` | 开始写镜头描述 | 镜头描述校验通过并写入，或失败 |
| `image.generate` | `image` 模块向出图服务提交一张图 | 取回并校验完图片，或失败、超时、取消。附协议、质量档和参考图张数，`call_id` 关联 `image_calls` |
| `desktop.core_ready` | desktop 启动 core | 收到 `ready`、`start-failed`、超时或进程退出。`attempt` 是本次启动的第几次尝试 |
| `desktop.window_ready` | desktop 创建窗口 | 窗口第一次可以显示 |
| `preview.validate`、`turn.validate` | 开始校验一次模型提案 | 得到校验结果，包括须修正的情况 |
| `preview.commit`、`turn.commit` | 开始提交通过校验的结果 | 提交事务成功、回滚或因决定点变化而放弃。单独登记失败状态不计入这一项 |
| `client.library_ready` | 导航进入作品库 | 作品列表、空库或读取失败状态首次渲染 |
| `client.preview_visible` | 作者触发生成 | 预览或失败提示渲染 |
| `client.plan_visible` | 作者点「生成故事方案」 | 方案或失败提示渲染 |
| `client.turn_visible` | 玩家发送行动或重试 | 已提交的回应或失败提示渲染 |

校验样本在失败时登记失败项的数量和字段类别，`preview.job.failed` 的 `invalid_output` 同样带上最近一次被拒的字段。字段类别由校验入口给出，例如 `prose`、`changes`、`present`、`leak`，不登记错误原文和作品内容。

模型首输出是模型调用的活动，玩家可见的完成时间由 client 单独计时。模型样本里的 `attempt` 沿用发起它的应用层尝试号，同一次尝试中的模型自动重试用不同的 `call_id` 区分。首输出样本按该次模型调用的最终结果归组。

client 的终点取对应状态提交到 DOM 的时刻，通过效果回调或等价的渲染提交回调记录。预览以本次 `jobId` 匹配结果，续写以请求 ID 和本次尝试号匹配结果。发送前的保存失败或命令明确被拒绝时，以本次操作的错误提示为终点。重试前留在界面上的旧失败和事件回查的重复通知都不能结束这次计时。`log.client` 在测量结束后发送，未保留起点的重连或恢复页面只显示状态。字段白名单只允许范围明确的计数，例如纳入上下文的回合数。

分析时按时间段、应用版本和样本名查询，并按结果分别汇总样本数、中位数与第 95 百分位。计算第 95 百分位时，先将耗时升序排列，再取第 `ceil(0.95 × 样本数)` 个值。用相同场景和相同观察区间比较改动，借助关联 ID 查看同一次操作的排队、模型、校验和提交读数。

```sql
SELECT metric, outcome, duration_ms
FROM performance_samples
WHERE app_version = :version AND created_at >= :start AND created_at < :end
ORDER BY metric, outcome, duration_ms;
```

## 4. 不做的事

- **日志文件或终端镜像。** 持久化集中在数据库，stdout 留给独立运行的启动地址，stderr 留给无法落库时的故障提示。
- **远程采集和诊断读取接口。** 诊断数据留在本机，查询直接读本机数据库。
- **逐帧写入。** 界面运行按离散操作采样，专项动效的帧率和长任务使用[动效 §7](./motion.md#7-性能)的检查方法。
- **desktop 自己的诊断库或日志文件。** desktop 的记录只经 core 写入。已知限制：core 一次都没有启动成功时（例如数据目录始终被占用），desktop 缓存的事件随退出丢失，能查到的只有 core 自己写下的 `core.start_failed`。

## 5. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 空数据目录 | 启动 core、打开作品库、测试模型、生成预览、提交一回合并正常退出 | `diagnostics.db` 有启动、生成和退出事件，两张表可查询。目录里没有日志文件或日志目录 |
| 一次续写先失败，再成功重试 | 按请求 ID 查询诊断库 | 能查到两次尝试的独立总耗时、排队和上下文耗时，结果和尝试号正确。模型首输出样本可用调用 ID 关联模型调用记录 |
| 数据目录中已有诊断记录 | 重启 core，再按版本和时间区间查询 | 已提交的样本仍可读取。超过保留期的数据被清理 |
| 一次生成被进程退出打断 | 重启 core，按原请求 ID 或任务 ID 查询 | 可以查到对应的中断事件。没有跨进程补算的耗时 |
| core 正在运行，生成预览失败 | 不退出 core，直接查询诊断库 | 在库中能查到本次运行的启动、生成、校验和失败事件。校验样本与失败事件带失败项数量和字段类别 |
| 正在通过 SQLite 查看已有诊断记录 | 保持读事务，同时完成新的生成 | 新诊断记录可提交。用于查询的连接结束后能读到新记录 |
| 阅读页留着上次失败提示 | 重试并等待新结果 | 上次失败提示不结束本次计时。新结果渲染后只上报一次，样本带回合请求 ID 和本次尝试号 |
| 作品库无法打开，诊断库可写 | 启动 core | 启动失败可从诊断库查询，目录里没有日志文件 |
| 诊断库发生写入故障 | 提交正常的作品写入，再恢复诊断库 | 作品写入成功，故障期间没有改写其他文件来记录日志。恢复后可看到丢弃记录计数 |
| client 上报未知字段、无效计时或凭据 | 查询诊断库 | 越过契约的上报被拒绝。数据库里只有允许的字段和读数 |
| 桌面版，core 已就绪 | 退出应用后打开数据目录的 `diagnostics.db` | 有 `module = 'desktop'` 的 `desktop.started`，`run_id` 与同一次 core 的 `core.started` 相同；目录里没有 desktop 写的其他文件 |
| desktop 发来字段不合规的 `log` 消息 | 查询诊断库 | 只有一条 `desktop.channel.invalid`，没有那条不合规的事件 |
