# Unwritten · LLM 端点

本文说明模型服务怎样配置、探测、按用途分配，以及 core 怎样调用模型。调用统一经过 pi-ai，选型理由见[技术选型 §7](./tech-stack.md#7-core)。配置组件借鉴了 thinkrail 的自定义端点（thinkrail `packages/server/src/agent/customEndpoints.ts` 和 `apps/web/src/panels/customEndpointDraft.ts`）。

## 1. 组成

| 部分 | 是什么 | 作者或玩家要做什么 |
| --- | --- | --- |
| 内置服务商 | pi-ai 自带的服务商：OpenCode Go、OpenCode Zen、OpenAI、Anthropic、Google、DeepSeek、OpenRouter 等 | 只需填 key，模型列表来自 pi-ai 的模型目录 |
| 自定义端点 | 任何兼容 OpenAI 或 Anthropic 协议的服务：本机的 Ollama、LM Studio、vLLM、llama.cpp，或公司网关 | 填地址和 key，点“查找模型”后勾选要用的模型 |
| 用途分配 | 游玩、创作对话、后台摘要各用哪个模型 | 在设置页里为每个用途选一个模型 |

“多协议”由两层共同实现：内置服务商使用 pi-ai 的原生协议实现；自定义端点可以选 `openai-completions` 或 `anthropic-messages` 协议。

## 2. providers.json

```json
{
  "version": 1,
  "providers": {
    "opencode-go": { "apiKey": "$OPENCODE_API_KEY" },
    "anthropic":   { "apiKey": "sk-ant-…" }
  },
  "endpoints": [
    {
      "id": "custom-ollama-3f2a1c",
      "name": "Ollama",
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "models": [
        { "id": "qwen3:14b", "contextWindow": 32768, "maxTokens": 8192, "tools": true, "reasoning": true, "vision": false }
      ]
    }
  ],
  "purposes": {
    "default":    { "provider": "opencode-go", "model": "kimi-k3" },
    "background": { "provider": "custom-ollama-3f2a1c", "model": "qwen3:14b" }
  }
}
```

- **位置**是 `<数据目录>/providers.json`。macOS、Linux 上文件权限为 0600；Windows 上依赖用户目录的访问控制。
- **写入。** core 内部的写操作排队执行，每次先在同一目录写一个以 `providers.json.` 开头的临时文件，再改名覆盖原文件，避免写到一半留下坏文件。写回前核对从界面读取以来的文件修订；发现手工修改时返回冲突，由用户重新载入后再改。界面写入发送读取时的配置修订和目标配置变更。若重发时目标变更已生效，返回现有结果；否则只在修订仍匹配时写入。重复新增端点沿用同一个端点 id。临时文件同样含有 key，名字的前缀保证它和备份文件都落在 `.gitignore` 的规则里。
- **读取。** core 启动时读一次；每次使用前检查文件的修改时间，变了就重新读。所以用户手动编辑文件也能生效，生效后通过事件流推送 `llm.config_changed`。
- **文件写坏了怎么办。** core 读取时按 schema 校验。文件无法解析时，设置页显示出错的行和列，并**拒绝从界面保存**，以免覆盖掉用户手写的内容。只有用户明确选择“用界面里的配置覆盖文件”时才会写入。
- **启动时文件就是坏的。** core 照常启动，作品库、创作和阅读都能用；需要调用模型的功能停用，并提示“模型配置文件有误”。设置页照样能打开，显示出错位置，用户可以手动修好文件，或选择用界面配置覆盖。
- **文件版本与迁移。** `version` 低于当前版本时，core 读取时在内存里升级；第一次从界面保存时写回新格式，旧文件另存为同目录的 `providers.json.bak`。它同样含有 key，权限和原文件相同。`version` 高于当前版本（被更新的应用写过）时，只读，拒绝从界面保存，提示升级应用。
- **自定义端点的 id** 格式是 `custom-<名称简写>-<6 位随机十六进制>`，做法同 thinkrail 的 `newEndpointId`。

## 3. key 的来源与保护

`apiKey` 有三种写法：

| 写法 | 含义 |
| --- | --- |
| `"sk-…"` | 明文，直接写在文件里 |
| `"$VAR"` 或 `"${VAR}"` | 调用时读取环境变量 `VAR`（同 thinkrail 的 `resolveProbeKey`） |
| 不写 | 没有 key，用于本机服务 |

内置服务商在文件里没有配置 key 时，pi-ai 会按自己的规则去读标准的环境变量，例如 OpenCode 的 `OPENCODE_API_KEY`。设置页通过 pi-ai 的 `getAuth` 显示 key 的来源，例如“来自环境变量 OPENCODE_API_KEY”。

**桌面版要先取得登录 shell 的环境变量。** 在 macOS 上从访达或 Dock 启动的应用，拿不到 `~/.zshrc` 里设置的变量。所以 desktop 启动时，先读出登录 shell 的环境变量，再传给 core，做法同 thinkrail desktop 的 `resolveShellEnv()`。少了这一步，`$VAR` 写法只在从终端启动时才有效。

**保护规则：**

- **key 不出 core。** 列表接口只返回 `hasKey` 和 `keySource`（文件 / 某个环境变量 / 无），永远不返回 key 本身。
- **编辑时 key 输入框留空，就保留原来的 key。** 要去掉 key 必须点“移除 key”（同 thinkrail 的 `hasSavedKey` / `removeKey`）。
- **日志和调用记录里不出现 key。** 服务商返回的错误信息里如果带着 key，先抹掉再记录。
- **经 `llm` 模块出去的请求一律不跟随重定向**（`redirect: "error"`），包括探测、测试连接和实际的模型调用，以免 key 被转发到另一台主机。thinkrail 只对带 key 的请求这样做；这里不判断请求带不带 key，因为 pi-ai 会自己读取标准环境变量里的 key，core 列不全所有可能发出去的 key，按 key 比对总会漏掉一类。模型接口的请求本来就不该经过重定向；端点返回重定向时报 `redirected`，提示用户改用跳转后的最终地址，作为新端点添加（修改端点时不能改地址，见下一条）。`llm` 模块是 core 所有外发请求的唯一出口，全部经过同一个 `fetch` 封装，由它强制这个选项，不依赖各家 SDK 自己的设置。pi-ai 和各家 SDK 能传入 `fetch` 的，显式传入这个封装；不能传入的，靠替换全局 `fetch`。替换写在一个单独的模块里，由 core 入口第一个导入，早于 pi-ai 和任何 SDK 的加载：ESM 会先执行被导入的模块，替换如果写在 `llm` 模块内部，SDK 可能已经在加载时拿走了原始的 `fetch`。SDK 绕开 `fetch` 直接发请求的情况，由验收里的重定向用例按协议逐一检出。Anthropic 协议的 key 放在 `x-api-key` 头里，Fetch 标准的“跨源重定向时去掉 `Authorization`”保护不到它，所以这条规则不能省。
- **已保存的端点不修改调用地址。** 同源路径变更也通过新增端点完成。协议、主机、端口任何一项变了，都要作为新端点添加，否则已保存的 key 会被悄悄发给新的主机（同 thinkrail 的“A server keeps its address”）。修改端点时只能改名称、key、模型列表和能力字段（§10）。
- **带 key 通过明文 http 访问非本机地址时**，界面给出警告，但不阻止（局域网里的模型服务很常见）。

key 以明文或环境变量引用的形式保存在本机文件里，不用系统钥匙串。这是已经定下的取舍。介意明文存储的用户，可以改用环境变量引用。

## 4. 内置服务商

- **服务商列表**来自 pi-ai 的 `getProviders()`。设置页为每个服务商显示 key 输入框和配置状态。
- **模型列表**来自 pi-ai 的模型目录，包括 id、名称、上下文窗口、输出上限、是否支持推理、输入类型。pi-ai 的聊天模型目录只收录支持工具调用的模型，所以这些模型都能用于 `narrator` 和 `author_chat`。
- **目录随 pi-ai 版本更新。** 目录里还没有某个模型时，可以把同一家服务商的兼容地址添加为自定义端点来使用。
- **key 怎样交给 pi-ai。** core 用 providers.json 实现 pi-ai 的 `CredentialStore` 接口（`read`、`list`、`modify`、`delete`）。这样 pi-ai 原有的鉴权顺序——先用已保存的凭据，再找环境变量——不需要任何改动。

## 5. OpenCode Go

OpenCode Go 是可选的服务商。创作与游玩可以使用其他满足用途要求的模型。它是 pi-ai 的内置服务商 `opencode-go`，key 从 OpenCode Console 获取，环境变量是 `OPENCODE_API_KEY`。

**使用要求。** Go 的文档要求客户端满足三条，Unwritten 的做法如下：

| Go 的要求 | Unwritten 的做法 |
| --- | --- |
| 用自己的 User-Agent 标明身份 | pi-ai `identity.userAgent` 设为 `{ custom: "unwritten/<版本>" }`；`identity.attribution` 的 `name` 设为 `unwritten`，pi-ai 会据此发出 `x-opencode-client: unwritten` |
| 每个对话发送固定的会话标识 | pi-ai 的 `sessionId` 参数：游玩时用路线 id（回合和摘要都用这个）；开场和每局生成人物时还没有路线，用开局 id；工作站对话用线程 id，生成任务用作品 id |
| 发送“典型的编程 agent 流量” | Unwritten 发送文字冒险请求。设置页说明 Go 面向编程 agent，文字冒险用途的可用性由服务商决定。 |

**用量上限。** Go 的用量有三层限制：每 5 小时、每周、每月。触发限制时按 `quota` 类错误处理（§8），提示“OpenCode Go 用量已达上限，稍后再试，或在 Console 开启 Extra Usage”，不自动重试。

**模型列表变得快。** pi-ai 的目录可能跟不上，这时可以把 Go 添加为自定义端点：

- 地址：`https://opencode.ai/inference/go/openai/v1`（选 `openai-completions` 协议），或 `https://opencode.ai/inference/go/anthropic/v1`（选 `anthropic-messages` 协议）。Go 会在不同协议之间转换，所以每个文本模型在两种协议下都能用。
- Go 的模型列表在 `https://opencode.ai/inference/go/v1/models`，不在 `/openai/v1` 下面，用通用的“地址后面拼 `/models`”的办法探测不到。所以自定义端点的预设里有一项“OpenCode Go”，模型列表地址是写死的。
- 主机是 `opencode.ai` 的自定义端点，由 `llm` 模块自动加上 `x-opencode-session` 请求头和上面说的 User-Agent。

**另一个选择。** OpenCode 的按量付费接口是 `https://opencode.ai/inference`，对应 pi-ai 的 `opencode`（Zen）服务商，接口形式和 Go 相同，使用条款以 OpenCode 官方为准。

## 6. 自定义端点

**预设：**

| 预设 | 地址 |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| vLLM | `http://127.0.0.1:8000/v1` |
| llama.cpp | `http://127.0.0.1:8080/v1` |
| OpenCode Go | 见 §5 |

前四项照搬 thinkrail 的 `LOCAL_SERVER_PRESETS`。

**配置流程：** 选预设或手填 → 填名称、地址、协议和 key → 点“查找模型” → 勾选模型（能力字段已预填，可以改）→ 保存 → 可选“测试连接”。

**整理地址**（同 thinkrail 的 `parseBaseUrl`）：

- 只接受 `http` 和 `https`；
- 地址里带账号密码或查询参数，直接拒绝；
- 去掉 `#` 后面的部分；
- 去掉末尾的 `/chat/completions`、`/completions`、`/models`、`/messages` 和斜杠。

**查找模型：**

- **openai-completions 协议：** 请求 `GET <地址>/models`。返回 404 并且地址不以 `/v1` 结尾时，再试 `<地址>/v1/models`；这次成功的话，把 `/v1` 补进地址。
- **anthropic-messages 协议：** 同样的顺序，但改用 `x-api-key` 和 `anthropic-version` 请求头。
- **超时 5 秒**（同 thinkrail 的 `LIST_TIMEOUT_MS`）。
- **解析返回的列表：**
  - 读取 `data[].id`，去重；
  - 跳过不是聊天模型、或者输出里不含文本的条目（例如 embedding 模型）；
  - 上下文窗口依次从 `max_model_len`、`max_input_tokens`、`context_length`、`meta.n_ctx` 中读取；
  - 最多保留 500 个模型。

  这部分同 thinkrail 的 `parseModelList`。

**失败分类**（同 thinkrail 的 `CustomEndpointProbeFailure`，另加 `redirected`）：

| 类别 | 提示 |
| --- | --- |
| `invalid-url` | 地址格式不对：需要完整的 http:// 或 https:// 地址，不能带账号密码或查询参数 |
| `unreachable` | 连不上这个地址，请确认服务已经启动 |
| `timeout` | 等待超时 |
| `unauthorized` | key 无效，或者没有权限 |
| `not-compatible` | 这个地址不是兼容的模型接口 |
| `no-models` | 服务里没有可用的模型 |
| `redirected` | 这个地址返回了重定向，请填写跳转后的最终地址 |

**能力字段。** 探测结果通常不全：上下文窗口有时能拿到，是否支持工具和推理很少能拿到。没拿到的字段留空（表示未知），由用户填写。输出上限默认取上下文窗口的四分之一，并限制在 256 到 16,384 之间（同 thinkrail 的 `defaultMaxTokens`）。

查找模型失败或服务不提供列表时，可手动填写模型 id 和已知能力，再用测试连接检查。

**保存前的校验**（同 thinkrail 的 `validateDraft`）：

- 名称不能为空；
- 地址必须合法；
- 至少选一个模型；
- 模型 id 不能为空，也不能重复；
- 数值必须是正整数；
- 能力字段只能是“是”“否”或“未知”。

**测试连接。** 用选中的模型发一个最小请求：只带一个空的 `ping` 工具，并要求模型调用它。这一个请求能同时验证 key、模型 id 和工具调用能力，确认收到有效工具调用后，将 `tools` 写为“是”。网络、鉴权或单次未调用只显示本次结果，不更改已保存的能力值。只消耗几十个 token。

**怎样交给 pi-ai。** 每个自定义端点用 `createProvider` 构造一个 pi-ai 服务商，协议实现用 `openAICompletionsApi()` 或 `anthropicMessagesApi()`。对来路不明的 OpenAI 兼容服务，采用保守的兼容设置：不发 `store`，不用 developer 角色，输出上限字段用 `max_tokens`（同 thinkrail 的 `COMPAT`）。

## 7. 用途分配

| 用途 | 谁用 | 要求 | 选模型时看重什么 |
| --- | --- | --- | --- |
| `narrator` | 回合循环、开场生成、每局生成人物 | 必须支持工具调用 | 写作质量 |
| `author_chat` | 工作站对话、生成故事方案、拟标题和简介、从试玩里提取设定 | 必须支持工具调用 | 听从指令，结构化输出稳定 |
| `background` | 回合摘要 | 不要求工具调用 | 便宜、快 |
| `default` | 以上用途没有单独配置时，都用这一项 | | |

用途按成本分三档，对应成本画像完全不同的三类调用：看重写作质量的、看重听从指令的、看重便宜和快的。`default` 不是第四档，只是三档没有单独配置时的回落项。

- **分配时校验。** 校验按每个用途实际用到的模型来做：`narrator` 和 `author_chat` 没有单独配置、要回落到 `default` 时，`default` 的模型同样要求支持工具调用。`tools` 为“否”的模型不能用于这两个用途；为“未知”的可以，但会提示先测试连接。
- **用途没有配置、也没有 `default` 时**，依赖它的功能会停用，并写明原因，例如“请先在设置里为『游玩』选择模型”。向导按钮同样显示原因。
- **修改分配后**，从下一个请求开始生效，正在运行的请求继续用原来的模型。
- **删除一个正在使用的端点**时，确认框会列出受影响的用途；删除后，清除引用该端点的分配，再按本节规则重新计算实际模型。确认框显示哪些用途会回落到默认模型，哪些会停用。

## 8. 调用、预算与错误

- **调用入口只有一个。** `llm` 模块对外只提供 `run(purpose, {system, messages, tools, sessionId, signal, onEvent})`。它先找到这个用途对应的 pi-ai 模型：需要工具的调用跑 pi-agent-core 的循环，不需要工具的调用直接做一次请求。
- **预算数字**来自模型元数据中的上下文窗口和输出上限。不知道上下文窗口时按 32,768 处理，并在设置页提醒补填；不知道输出上限时按 §6 的默认规则计算。
- **调用前的长度估算**按字符数保守计算：中日韩文字按每字 2 个 token，其他文字按每 3 个字符 1 个 token。很多分词器里一个汉字要占 1 到 3 个 token，按一字一个 token 算会低估。这两个系数可配置。超出预算时按[回合循环 §3](./turn-loop.md#3-上下文哪些直接给哪些让模型查)的顺序裁剪。
- **时间上限：** 一次调用 120 秒内没有任何输出、或者流式输出中途停顿 60 秒，都按超时处理。两个上限都可配置。
- **取消：** 回合请求或生成任务被取消时，通过 `AbortSignal` 中止正在进行的调用。

| 错误类别 | 例子 | 处理 | 提示 |
| --- | --- | --- | --- |
| `unauthorized` | 401、403 | 不重试 | key 无效，请到设置里检查 |
| `quota` | 用量上限（含 OpenCode Go 的三层上限） | 不重试 | 用量已达上限，并写明是哪个服务 |
| `rate_limited` | 短时限流 | 等待后重试一次 | 重试仍失败时提示稍后重试 |
| `context_overflow` | 服务商报告输入过长 | 不重试，记录实际长度 | 当前模型的上下文不够，请换一个模型 |
| `network` / `timeout` / `server` | 断网、超时、5xx | 还没收到任何输出时重试一次 | 连不上模型服务 |
| `redirected` | 端点返回 301、302、303、307、308 | 不重试 | 模型服务返回了重定向，请到设置里改用跳转后的最终地址 |
| `invalid_output` | 模型没有调用 `propose_turn`，或参数无法解析、校验不通过 | 走[回合循环 §6](./turn-loop.md#6-校验与保存)的修正机制，修正 2 次仍不通过才失败 | 这一段没写成功，请重试 |

自动重试最多一次。再失败就交给玩家点“重试”，避免多层重试叠在一起。

`context_overflow` 和[回合循环 §3](./turn-loop.md#3-上下文哪些直接给哪些让模型查)的 `context_too_small` 是两件事：后者是 core 在首次请求或工具续轮前发现必要材料放不下，停止发送这一轮请求；前者是服务商报告超长。两者提示相同，但前者说明估算系数偏小，记录实际长度供调整。全部错误码定义在 contracts 的 `errors.ts`（[i18n §5](./i18n.md#5-core-返回什么)）。

## 9. 调用记录

```sql
llm_calls (
  id                 TEXT PRIMARY KEY,
  purpose            TEXT NOT NULL,
  work_id            TEXT REFERENCES works ON DELETE SET NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  ref_kind           TEXT,           -- turn_request | job | chat_message
  ref_id             TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cost               REAL,
  cost_from_provider INTEGER,        -- 1 = 服务商报告的费用；0 = 按目录价格估算
  duration_ms        INTEGER,
  status             TEXT NOT NULL,  -- ok | error | aborted
  error              TEXT,           -- 错误类别（§8）
  created_at
)
```

- **调用记录保存用量、耗时与结果。** 诊断库里的首输出耗时用调用 ID 与本表关联。模型请求和回复属于作品与对话数据，诊断库只收集[运行诊断与性能记录](./diagnostics.md)规定的字段。
- **设置页显示用量**，按用途和作品汇总最近 7 天和 30 天的数据。记录只关联仍存在的作品；调用未结束时删除作品，补写记录时也不再关联该作品。作品删除后，记录仍计入用途总量，不再归入单部作品。
- core 启动时删除 90 天以前的记录。

## 10. core 接口

这些接口都是 contracts 里的 oRPC 过程，输入、输出和错误由契约定义，没有单独的 HTTP 路由（[架构总览 §3](./architecture.md#3-client-与-core-的通信)）。

| 过程 | 作用 |
| --- | --- |
| `llm.providers.list` | 内置服务商和自定义端点的列表：`hasKey`、`keySource`、模型及其能力 |
| `llm.providers.setKey` | 设置或移除内置服务商的 key |
| `llm.endpoints.probe` | 探测一个地址，返回模型列表或失败类别 |
| `llm.endpoints.create` | 新增自定义端点，重发复用创建请求分配的端点 id |
| `llm.endpoints.update` | 修改自定义端点：只能改名称、key、模型列表和能力字段。地址变化时拒绝，要作为新端点添加；跨源时返回 `endpoint_origin_changed`（§3） |
| `llm.endpoints.remove` | 删除自定义端点 |
| `llm.test` | 测试连接 |
| `llm.purposes.get`、`llm.purposes.set` | 读取和修改用途分配 |
| `llm.usage.summary` | 用量汇总 |

## 11. 不做的事

- pi-ai 支持的订阅登录（OAuth），例如 ChatGPT、Claude、GitHub Copilot。
- 用命令获取 key（thinkrail 的 `!command` 写法）。
- 系统钥匙串。
- 对本地服务的能力细探：Ollama 的 `/api/show`、llama.cpp 的 `/props`、LM Studio 的 `/api/v0/models`（thinkrail 的 `enrich`）。
- 按作品单独指定模型。
- 图像模型和 embedding 模型。

## 12. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 配好 OpenCode Go | 走完一次创作，再玩十个回合 | 每个请求都带 `unwritten/<版本>` 的 User-Agent 和 `x-opencode-client`；同一条路线的 `x-opencode-session` 始终不变 |
| 本机 Ollama 已启动，没有 key | 选预设 → 查找模型 → 保存 → 测试连接 | 能列出模型；收到有效工具调用后把该模型标为支持工具调用 |
| 填了一个错误的 key | 查找模型 | 显示“key 无效” |
| 手动把 providers.json 改坏 | 在设置页点保存 | 拒绝保存，提示出错的行列；文件保持原样 |
| 已配置若干 key | 在 client 的网络面板里查看所有 LLM 相关接口的响应 | 找不到任何 key |
| 每种协议各配一个端点，端点对一切请求返回 302，指向另一台测试主机；其中一个内置服务商的 key 只来自标准环境变量，另有一个端点没有 key | 分别探测、测试连接、发起一次实际的模型调用 | 每个请求都以 `redirected` 失败，另一台测试主机没有收到任何请求 |
| key 写成 `$VAR`，变量只在 `~/.zshrc` 里设置 | 从访达启动 Unwritten | key 能正确解析 |
