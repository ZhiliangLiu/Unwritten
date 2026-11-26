# Unwritten · 运行诊断与性能记录

运行事件回答“这次操作发生了什么”。性能样本回答“时间花在哪一步”。两者存进同一个本机 SQLite 库，按一次运行、一次生成任务或一次模型调用关联。

## 1. 存储与生命周期

数据目录下的 `diagnostics.db` 是运行事件和性能样本的唯一持久化位置。core 打开诊断库后再打开 `library.db`，因此作品库加锁失败或迁移失败时，仍能留下可查询的诊断记录。client 经鉴权后的 `log.client` 上报，由 core 写入诊断库。desktop 的记录遵循同一存储契约。诊断库维护自己的迁移记录，使用 SQLite WAL 模式，短事务写入可与本机诊断查询并行。`-wal` 和 `-shm` 是 SQLite 管理的数据库伴随文件。诊断连接使用普通锁模式，遇到写锁争用立即返回。

诊断写入使用有上限的内存队列，离开当前业务调用栈后按批提交。队列上限默认 1,024 条，满时丢弃新记录并计数。运行中，每轮最多写入 128 条，剩余记录留到下一轮。诊断库打开或写入失败时，丢弃失败批次并计数，业务结果照常提交。首次出现故障时向 stderr 发出固定错误提示，下批写入时按需重新打开诊断库。有待记录的丢弃数量时，在批次内留一条给 `diagnostics.dropped`，事务提交后才结清该事件记录的数量。

正常退出和可处理的启动失败先提交队列，再关闭诊断库。进程意外退出时，已提交的记录仍可查询，内存中的队列可能丢失。

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

`created_at` 是 Unix 毫秒时间戳，client 记录取 core 接收时间。`run_id` 标识一次 core 或 desktop 进程运行，由接收方写入。事件名和各事件允许的字段由各模块的事件定义统一校验。默认记录 `info` 及以上运行事件，`--log-level` 可调。性能样本与写入端自己的丢弃计数始终采集。

关联 ID 可留空。数据库以时间和关联 ID 为查询入口，关联 ID 指向作品库中的记录，跨库查询不设外键。模型的用量、费用和单次调用总耗时保存在 `library.db` 的 `llm_calls`，诊断事件用同一个 `call_id` 关联。工具足迹留在原回合请求上，按作品的生命周期清理。详见[模型调用记录](./llm-endpoints.md#9-调用记录)和[回合请求](./turn-loop.md#2-回合请求)。

落库前按事件字段白名单取值。错误记录使用稳定错误码和失败阶段。凭据、带令牌的 URL、请求与响应正文、诊断栈原文、作品内容和玩家输入都不进入诊断库。`log.client` 只接受契约中列出的错误字段与性能项，拒绝未知字段。上报失败时结束本次上报，避免递归上报。

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
| `turn.context` | 开始读取并构建续写上下文 | 上下文可提交给模型，或构建失败。成功时附纳入的回合数、估算的上下文 token 数、索引列出的实体数和摘要行数 |
| `story.projection` | 开始读取一条路线可见的故事事实 | 投影可用。附实体、事实、知情的条数 |
| `story.tool` | 模型调用一次只读工具 | 工具返回结果或错误。附工具名和返回的记录条数 |
| `summary.total` | 摘要任务开始处理 | 摘要写入、失败或回合已不存在 |
| `settings.update` | core 收到外观偏好的修改 | 写入完成或失败 |
| `preview.validate`、`turn.validate` | 开始校验一次模型提案 | 得到校验结果，包括须修正的情况 |
| `preview.commit`、`turn.commit` | 开始提交通过校验的结果 | 提交事务成功、回滚或因决定点变化而放弃。单独登记失败状态不计入这一项 |
| `client.library_ready` | 导航进入作品库 | 作品列表、空库或读取失败状态首次渲染 |
| `client.preview_visible` | 作者触发生成 | 预览或失败提示渲染 |
| `client.turn_visible` | 玩家发送行动或重试 | 已提交的回应或失败提示渲染 |

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

## 5. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 空数据目录 | 启动 core、打开作品库、测试模型、生成预览、提交一回合并正常退出 | `diagnostics.db` 有启动、生成和退出事件，两张表可查询。目录里没有日志文件或日志目录 |
| 一次续写先失败，再成功重试 | 按请求 ID 查询诊断库 | 能查到两次尝试的独立总耗时、排队和上下文耗时，结果和尝试号正确。模型首输出样本可用调用 ID 关联模型调用记录 |
| 数据目录中已有诊断记录 | 重启 core，再按版本和时间区间查询 | 已提交的样本仍可读取。超过保留期的数据被清理 |
| 一次生成被进程退出打断 | 重启 core，按原请求 ID 或任务 ID 查询 | 可以查到对应的中断事件。没有跨进程补算的耗时 |
| 正在通过 SQLite 查看已有诊断记录 | 保持读事务，同时完成新的生成 | 新诊断记录可提交。用于查询的连接结束后能读到新记录 |
| 阅读页留着上次失败提示 | 重试并等待新结果 | 上次失败提示不结束本次计时。新结果渲染后只上报一次，样本带回合请求 ID 和本次尝试号 |
| 作品库无法打开，诊断库可写 | 启动 core | 启动失败可从诊断库查询，目录里没有日志文件 |
| 诊断库发生写入故障 | 提交正常的作品写入，再恢复诊断库 | 作品写入成功，故障期间没有改写其他文件来记录日志。恢复后可看到丢弃记录计数 |
| client 上报未知字段、无效计时或凭据 | 查询诊断库 | 越过契约的上报被拒绝。数据库里只有允许的字段和读数 |
