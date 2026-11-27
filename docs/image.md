# Unwritten · 插图与出图服务

本文说明游玩时的插图怎样生成：出图服务怎样配置，core 与出图服务之间的协议，人物形象与立绘，一张插图从标记到显示的流程，以及图片怎样存储、交给 client。玩家和作者看得见的行为见[游玩流程 §2.1](./gameplay-flow.md#21-插图)和[创作流程 §2](./authoring-flow.md#2-写背景只补自己在意的设置)；在 Colab 上运行的出图服务见 [ComfyUI 插件与 Colab 部署](./comfyui-plugin.md)。

一句话概括：**core 只认协议和能力，不认具体的出图服务；插图在回合提交之后生成，从不挡住正文。**

## 1. 组成

| 部分 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `image`（core 模块） | 出图服务的配置与探测、两种协议的客户端、按服务排队、返回数据的校验、调用记录 | 不认识作品、人物和回合 |
| `illustration`（core 模块） | 什么时候画、镜头描述、挑参考人物、立绘、图片文件的存储与清理、把结果挂到回合和人物上 | 不认识具体的协议 |
| 出图服务 | 按协议接收提示词和参考图，返回一张图 | 不认识故事，不接触作品库 |
| 插件 | 实现 Unwritten 图像协议（§3）的独立服务，例如 [ComfyUI 插件](./comfyui-plugin.md) | 不载入 core，不和 core 共享代码 |

两条硬规则：

1. **只有 `image` 模块认识出图协议。** 加一种协议只改这一个模块，`illustration` 只调用 §5 的入口。
2. **core 的行为只由能力字段决定，从不按出图服务的实现名分支。** 这条规则和守住它的源码扫描测试见[插件 §2](./plugins.md#2-边界)。

本文出现的常量（`IMAGE_*`、`ILLUSTRATION_*`、`APPEARANCE_MAX_LENGTH` 等）都定义在 `image` 和 `illustration` 模块里，写明「可配置」的由这两个模块的配置覆盖。

插件为什么是服务而不是代码、插件和 core 的边界在哪里，见[插件 §1–2](./plugins.md#1-什么是插件)。任何实现了 §3、通过一致性测试（§3.7）的服务都能接入，core 不为它改一行。

## 2. 出图服务的配置

出图服务和 LLM 端点写在同一个 `providers.json` 里，key 的写法和保护规则也相同（[LLM 端点 §2](./llm-endpoints.md#2-providersjson)、[§3](./llm-endpoints.md#3-key-的来源与保护)）：

```json
{
  "version": 2,
  "providers": {},
  "endpoints": [],
  "purposes": {},
  "imageServices": [
    {
      "id": "image-comfyui-3f2a1c",
      "name": "ComfyUI",
      "protocol": "unwritten-image",
      "baseUrl": "https://unwritten-image.example-tailnet.ts.net",
      "apiKey": "$UNWRITTEN_IMAGE_TOKEN"
    },
    {
      "id": "image-openai-9b1c2d",
      "name": "OpenAI",
      "protocol": "openai-images",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "$OPENAI_API_KEY",
      "model": "gpt-image-2",
      "capabilities": { "maxReferences": 16, "sizes": "custom" }
    }
  ],
  "image": { "service": "image-comfyui-3f2a1c" }
}
```

- **文件版本是 2。** 读到版本 1 时，在内存里补上空的 `imageServices` 和 `"image": { "service": null }`；第一次从界面保存时写回新格式，旧文件另存为 `providers.json.bak`，规则同 [LLM 端点 §2](./llm-endpoints.md#2-providersjson)。
- **`protocol` 只有两个取值：** `unwritten-image`（§3）和 `openai-images`（§4）。
- **key 规则全部照搬。** `apiKey` 的三种写法、只返回 `hasKey` 和 `keySource`、编辑时留空就保留、「移除 key」、地址保存后不能改、明文 http 访问非本机地址时警告，都同 [LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)。服务的 id 格式是 `image-<名称简写>-<6 位十六进制>`，取法同自定义端点。
- **令牌由设置页生成，** 规则见[插件 §3.2](./plugins.md#32-鉴权)。core 把令牌写进这个服务的 `apiKey`；用户把它存进出图服务那一侧，例如 Colab Secrets（[ComfyUI 插件 §8.2](./comfyui-plugin.md#82-colab-secrets)）。
- **`image.service` 是当前使用的出图服务。** 为空时插图功能停用，界面上和插图有关的入口一律不显示。删除正在使用的服务时，确认框写明插图会停用，删除后把它清空。
- **能力从哪来。** `unwritten-image` 服务的能力由服务自己报告（§3.2），配置里不写。`openai-images` 服务没法自报，能力写在 `capabilities` 里；添加服务时按模型 id 预填（§4.3），用户可以改。
- **「游玩时生成插图」开关是偏好，不是凭据，** 存在 `app_settings`（[主题与 token §9](./theme.md#9-外观偏好与切换)），默认打开。关闭后不再生成新图，已画好的图照常显示。

设置页的「出图服务」一节：

| 操作 | 做什么 |
| --- | --- |
| 添加服务 | 选协议，填名称、地址、key。`unwritten-image` 可以点「生成令牌」；`openai-images` 另填模型 id，确认预填的能力 |
| 测试连接 | `unwritten-image`：带令牌读 `/v1/info`，显示实现名、模型、是否就绪和能力。`openai-images`：用 key 读 `{baseUrl}/models`，只验证 key，不生成图片 |
| 生成测试图 | 只对 `openai-images` 提供。这一步按张计费，界面写明后由用户主动点 |
| 状态 | 显示最近一次连接的结果（在线、未就绪、离线）和时间 |
| 隐私说明 | 一行文字：本回合的正文片段、人物形象和立绘会发给出图服务 |

core 接口都是 contracts 里的 oRPC 过程：

| 过程 | 作用 |
| --- | --- |
| `image.services.list` | 出图服务列表：协议、地址、`hasKey`、`keySource`、能力、最近一次连接结果；同时返回 `image.service` |
| `image.services.create`、`image.services.update`、`image.services.remove` | 增删改，规则同 [LLM 端点 §10](./llm-endpoints.md#10-core-接口) 的端点过程 |
| `image.services.generateToken` | 为一个 `unwritten-image` 服务生成令牌，只在这次响应里返回令牌原文 |
| `image.services.test` | 测试连接；`paid: true` 时为 `openai-images` 生成一张测试图 |
| `image.select` | 修改 `image.service` |
| `image.usage.summary` | 出图用量汇总（§11） |
| `image.file` | 取一张插图或立绘（§10） |

## 3. Unwritten 图像协议

协议名是 `unwritten-image/1`。它遵守[插件 §3](./plugins.md#3-协议的共同规则)的全部共同规则：路径带主版本号、只增不改、Bearer 令牌、不返回重定向和 CORS 头、信息接口、幂等键、任务、错误格式。本节只写出图协议独有的部分。

### 3.1 参考图

参考图以内联 base64 放在请求体里，请求里没有任何 URL。除了取图接口直接返回字节，其余请求和响应都是 JSON。

### 3.2 `GET /v1/info`

```json
{
  "protocol": "unwritten-image/1",
  "implementation": { "name": "ComfyUI", "version": "0.1.0" },
  "model": "Qwen-Image-2.1",
  "ready": true,
  "notReadyReason": null,
  "queue": { "pending": 0, "max": 8 },
  "capabilities": {
    "maxReferences": 10,
    "maxReferenceBytes": 8388608,
    "maxPromptLength": 4000,
    "seed": true,
    "negativePrompt": false,
    "qualities": ["fast", "best"],
    "aspects": ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16"]
  }
}
```

- `protocol`、`implementation`、`ready`、`notReadyReason`、`capabilities` 是所有协议共有的字段（[插件 §3.3](./plugins.md#33-信息接口)）；`model` 和 `queue` 是出图协议加的，只用来在设置页显示。
- **未就绪的原因：** `starting`（启动或自检中）、`out_of_memory`（显存跑不动模板）、`workflow_error`（模板跑不通）。core 据此提示「出图服务正在启动」或对应的原因。
- **`qualities`：** `fast` 用于开局页的预览，`best` 用于插图和立绘。服务至少支持 `best`；只支持一档时，core 两种用途都用它。
- **`negativePrompt` 为 false，表示服务会忽略负面提示词，** 例如工作流的 CFG 为 1。这时 core 不发这个字段，把要避开的内容写进正面提示词（§7.3）。
- **`aspects` 至少包含 `3:2` 和 `3:4`，** 分别用于场景图和立绘。

### 3.3 `POST /v1/jobs`

```json
{
  "idempotencyKey": "<core 生成的 UUID>",
  "prompt": "A quiet ferry pier at dusk, {{ref:1}} hands an umbrella to {{ref:2}} ...",
  "references": [
    { "mime": "image/webp", "data": "<base64>" },
    { "mime": "image/webp", "data": "<base64>" }
  ],
  "aspect": "3:2",
  "quality": "best",
  "seed": 42
}
```

- `prompt` 是英文，参考图用 `{{ref:N}}` 指代，N 从 1 起，对应 `references` 的顺序。服务把它换成模型自己的写法，所以 core 不需要知道任何模型的提示词语法。长度不超过 `maxPromptLength`。
- `negativePrompt` 只在 `capabilities.negativePrompt` 为 true 时发送，所以上面这个发给 `negativePrompt: false` 服务的例子里没有它。
- `references` 不超过 `maxReferences` 张，每张解码后不超过 `maxReferenceBytes`，`mime` 是 `image/png`、`image/jpeg`、`image/webp` 之一。服务会实际解码校验，不信 `mime`。
- `aspect`、`quality` 必须在能力列表里。具体宽高由服务按模型的原生尺寸决定，所以 core 不传像素数。
- `seed` 只在 `capabilities.seed` 为 true 时发送；省略时服务随机取一个，在结果里返回。

响应 202：`{ "id": "<任务 id>", "status": "queued" }`。

- **幂等**按[插件 §3.4](./plugins.md#34-有副作用的请求)：隧道抖一下、core 重发 POST，GPU 不会把同一张图画两遍。服务至少记住幂等键，直到任务结果过了保留期（§3.5）。
- **队列满时**返回 429 `busy`，带 `Retry-After`。

### 3.4 查询、取图、取消

| 请求 | 返回 |
| --- | --- |
| `GET /v1/jobs/{id}` | `{ "id", "status", "position", "seed", "width", "height", "error" }`。`status` 是 `queued`、`running`、`done`、`failed`、`cancelled` 之一；`position` 只在排队时有；`error` 是 `{ "code", "message" }` |
| `GET /v1/jobs/{id}/image` | 任务完成时返回 `image/webp` 字节；未完成或已过保留期返回 404 `not_found` |
| `DELETE /v1/jobs/{id}` | 取消排队或运行中的任务；已完成的任务提前释放结果。返回 204 |

core 每隔 `IMAGE_POLL_INTERVAL_MS`（默认 2000）查询一次状态。

### 3.5 服务的义务

除了[插件 §4](./plugins.md#4-插件的义务) 的全部义务，出图服务还要做到：

- **返回的 WebP 不含 EXIF、XMP 和任何文本块。** 出图引擎常把工作流和提示词写进图片元数据，而提示词里有故事内容。
- **结果在完成后至少保留 `RESULT_RETENTION_MS`（10 分钟）。** core 取走后调用 DELETE 提前释放。
- **错误码只用 §3.6 列出的这些。**

### 3.6 错误码

错误响应的格式见[插件 §3.5](./plugins.md#35-错误)。下表是出图协议用到的全部错误码，以及 core 的处理。

| 错误码 | HTTP | 含义 | core 的处理 |
| --- | --- | --- | --- |
| `unauthorized` | 401 | 令牌不对 | 不重试，提示到设置里检查令牌 |
| `invalid_request` | 400 | 请求格式不合格 | 不重试，记为 `image_invalid_request` |
| `too_many_references`、`reference_too_large`、`unsupported_aspect`、`unsupported_quality` | 400、413 | 超出了能力 | 说明 core 手里的能力已经过期：重新读 `/v1/info`，按新能力重做一次 |
| `idempotency_conflict` | 409 | 同一个键、不同的请求体 | 不重试，记为 `image_invalid_request` |
| `busy` | 429 | 队列已满 | 按 `Retry-After` 等待后重试一次 |
| `not_ready` | 503 | 服务未就绪 | 不重试，提示服务正在启动 |
| `not_found` | 404 | 任务不存在或结果已过期 | 重新提交一次 |

任务本身的失败写在任务的 `error` 里，`code` 是 `out_of_memory`、`workflow_error`、`refused`、`interrupted`、`internal` 之一，core 把这张图标为失败并显示对应原因。

### 3.7 一致性测试

`packages/core/src/image/conformance/` 里有一组测试，逐条覆盖 §3.1–3.6 和插件协议的共同规则：缺令牌和错令牌被拒、`/v1/info` 字段齐全、幂等、各项超限、未就绪、结果不含元数据、DELETE 之后取图返回 404。

运行方式见[插件 §3.6](./plugins.md#36-一致性测试)，环境变量是 `UNWRITTEN_IMAGE_CONFORMANCE_URL` 和 `UNWRITTEN_IMAGE_CONFORMANCE_TOKEN`。对着真实插件运行时会真的画几张小图。

## 4. OpenAI 图像接口

### 4.1 请求

- **不带参考图：** `POST {baseUrl}/images/generations`，JSON 请求体：`model`、`prompt`、`n: 1`、`size`、`quality`、`output_format: "webp"`、`moderation: "auto"`。
- **带参考图：** `POST {baseUrl}/images/edits`，multipart 请求体：`model`、`prompt`、每张参考图一个 `image[]` 文件字段、`size`、`quality`、`output_format`、`n`。不用 JSON 的 `images` 数组，因为兼容这个接口的服务普遍只实现了 multipart 的写法。
- **参考图的写法：** `{{ref:N}}` 换成 `input image N`。
- **没有 seed，也没有负面提示词，** 所以能力固定为 `seed: false`、`negativePrompt: false`。
- **质量：** `fast` 对应 `low`，`best` 对应 `high`。
- **响应：** 取 `data[0].b64_json`，解码后按 §5.3 校验；`usage` 里的 token 数记进调用记录（§11）。
- **时间上限：** 一次请求 `OPENAI_IMAGE_TIMEOUT_MS`（默认 180000，可配置）内没有返回，就按超时处理。取消时中止请求。

### 4.2 尺寸

| 能力 `sizes` | 3:2 | 3:4 | 1:1 |
| --- | --- | --- | --- |
| `fixed` | `1536x1024` | `1024x1536` | `1024x1024` |
| `custom` | `1536x1024` | `1152x1536` | `1024x1024` |

- `fixed` 对应只接受这三种尺寸的模型；`custom` 对应接受任意 `宽x高` 的模型，宽和高都是 16 的倍数，宽高比在 1:3 到 3:1 之间。
- `fixed` 下的 3:4 用 2:3 的 `1024x1536` 代替。界面一律按图片的实际宽高显示，不拉伸。

### 4.3 按模型预填的能力

| 模型 id | `maxReferences` | `sizes` |
| --- | --- | --- |
| 以 `gpt-image-2` 开头 | 16 | `custom` |
| `gpt-image-1.5`、`gpt-image-1-mini`、`chatgpt-image-latest` | 16 | `fixed` |
| 其他 | 0 | `fixed` |

`maxReferences` 为 0 时不调编辑接口，人物一致性只靠形象文字，设置页写明这一点。模型更替很快，这张表随版本维护，模型 id 永远可以手填。

### 4.4 错误

| 情况 | 类别 |
| --- | --- |
| 401、403 | `image_unauthorized` |
| 429，且 `error.code` 是 `insufficient_quota` | `image_quota`，不重试 |
| 其他 429 | `image_rate_limited`，等待后重试一次 |
| 400，且 `error.code` 是 `moderation_blocked` | `image_refused` |
| 其他 400 | `image_invalid_request` |
| 5xx、断网、超时 | `image_server`、`image_offline`、`image_timeout`；还没收到响应时重试一次 |
| 301、302、303、307、308 | `image_redirected` |

## 5. image 模块

### 5.1 调用入口

`image` 模块对 `illustration` 只提供两个函数：

- `capabilities()`：当前服务的能力。`unwritten-image` 服务取最近一次 `/v1/info` 的结果，`openai-images` 服务取配置。
- `generate(input)`：`input` 包含 `prompt`、`negativePrompt`、`references`、`aspect`、`quality`、`seed`、`signal`、`ref`（调用记录的引用，§11）。返回图片字节、类型、宽高、实际用的 seed（没有时为空）、服务 id 和模型。

规则：

- **每个服务同时只跑一个任务。** 出图服务背后通常只有一块 GPU。用 p-queue 按服务排队，并发数为 1；开局页的预览优先，其余按先后顺序。
- **离线时快速失败。** core 记着每个服务最近一次的连接结果。最近 `IMAGE_OFFLINE_TTL_MS`（默认 60000）以内连不上过，自动排进来的新任务直接以 `image_offline` 失败，不再等超时；超过这段时间，下一个任务先探测，再提交。**玩家手动点「重试」「重画」或「预览画风」时不看这条记录，** 先探测一次再提交：玩家往往是刚把服务开起来才点的重试。
- **自家协议的单个任务，** 从提交到取回图片最长 `IMAGE_JOB_TIMEOUT_MS`（默认 600000，可配置）。超时后对服务发 DELETE，以 `image_timeout` 失败。
- **自动重试最多一次，** 规则同 [LLM 端点 §8](./llm-endpoints.md#8-调用预算与错误)。再失败就交给玩家点「重试」。

### 5.2 外发请求

`llm` 模块里那个不跟随重定向的 `fetch` 封装，抽成独立的 `net` 模块，`llm` 和 `image` 都经过它（[LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)）。出图服务的 key 和模型服务的 key 一样，不能被重定向带到另一台主机。

### 5.3 校验返回的数据

出图服务的返回是信任边界：

- **按文件头判断类型。** 只收 PNG、JPEG、WebP。SVG 能带脚本，和其他类型一样一律拒收，以 `image_invalid_response` 失败。
- **单张不超过 `IMAGE_MAX_BYTES`**（默认 20 MB）。
- **宽高从文件头读出，** 不信服务报的值。
- **原样保存，不转码。** 转码要引入原生的图像库，而自家协议本来就只返回 WebP。

### 5.4 错误类别

错误码写在 contracts 的 `errors.ts` 里，client 按 `errors:<code>` 显示（[i18n §5](./i18n.md#5-core-返回什么)）：`image_unauthorized`、`image_quota`、`image_rate_limited`、`image_offline`、`image_not_ready`、`image_busy`、`image_refused`、`image_timeout`、`image_server`、`image_invalid_request`、`image_invalid_response`、`image_redirected`、`image_out_of_memory`、`image_workflow_error`、`image_interrupted`、`image_file_missing`。提示的写法同[设计准则 §8](./design-guidelines.md#8-文案语气)：写清发生了什么、怎么办。

## 6. 人物形象与立绘

### 6.1 形象

**形象只写此刻看得见的样子：** 长相、身形、衣着、显眼的特征。人物在伪装就写伪装；揭晓之后，在揭晓的那一回合追加新的形象。不写身份、来历和任何秘密，因为立绘和插图会把它原样画出来。这一条靠提示词和评测保证（[回合循环 §11](./turn-loop.md#11-叙述约定)）。

| 人物 | 形象存在哪 | 由谁写 |
| --- | --- | --- |
| 作者设定的人物 | `entities.profile.appearance`，随版本复制 | 作者在方案里写，或采用 AI 的。生成方案时，AI 为每个人物写一份 |
| 每局生成的人物 | `entities.profile.appearance`，开场提交时写入 | `propose_cast` 里必填 |
| 开场预览里新出现、采用时写成作者设定的人物 | `entities.profile.appearance`，采用开场时写入 | 预览的 `new_entity` 里必填，规则同下一行 |
| 游玩中新出现的人物 | `entities.profile.appearance`，随 `new_entity` 写入 | narrator，`kind` 为 `character` 时必填 |
| 主角 | 开局行的 `illustration.protagonistAppearance` | 玩家在开局页写；选了入画却留空时，由 AI 按作者的主角设定写一份 |
| 路线上的变化 | `trait` 事实，`key` 是 `appearance` | narrator |

- **主角的形象存在开局行，不存在事实表。** 它每局一份；而且 AI 补写形象要花时间，赶不上固定人物开场的同步提交（[回合循环 §10](./turn-loop.md#10-开场)）。补写只发生一次，写入后不再改。
- **当前形象**是路线上最新的一条 `appearance` 特征，按祖先链投影（[数据模型 §4](./data-model.md#4-故事事实)）；没有这样的特征时，用基础形象。
- 形象不超过 `APPEARANCE_MAX_LENGTH`（300 字），不含换行。
- **档案里没有形象的人物**，例如迁移之前就已经存在的人物，入画时不带参考立绘，只靠镜头描述里的外貌描写，前后几张图里可能长得不一样。必填的规则只约束之后新增的人物，不回填已有的档案。

### 6.2 立绘

每个形象配一张立绘，画场景图时用作参考图。

- **立绘由「所属、人物、形象哈希、画风哈希」唯一确定。** 形象文字或画风变了，就是另一张立绘。哈希是去掉首尾空白、做 NFC 规范化之后的 sha256。
- **构图固定：** 单人、正面、上半身、浅色素净的背景，宽高比 3:4，质量 `best`。构图要求由 core 拼进提示词，不交给 LLM。
- **提示词**由 §8 的调用写成英文：输入这个人物的形象和画风，不带参考图。
- **第一次需要时才画：** 某个人物第一次入画时；玩家在开局页点「预览画风」时；作者在方案里点「生成立绘」时。
- **重画**就是换一个 seed 再画一张，成功后替换这一行的文件，不保留历史版本。

| 所属 | 什么时候产生 | 目录 |
| --- | --- | --- |
| 作品 | 作者在方案里生成，用作品的默认画风 | `images/works/<作品 id>/` |
| 预览 | 开局页的预览，这时开局还不存在 | `images/pending/` |
| 开局 | 本局需要时现画；开局时从预览移入；或从作品立绘复制而来 | `images/playthroughs/<开局 id>/` |

开局时预览还没画完的，画完后直接归入本局，文件写进本局目录。

一局需要某张立绘时，按这个顺序找：本局已有的 → 作品立绘里形象和画风都相同的（把文件复制进本局目录）→ 现画一张。每局的目录因此自成一体，删掉一局的目录不影响别的开局。

### 6.3 画风

- **预设加自定义文本。** 预设是一组 id 和英文提示词片段，写在 core 的常量里：`watercolor`（水彩）、`ink`（水墨）、`anime`（赛璐璐）、`painterly`（厚涂）、`cinematic`（写实电影感）。界面上的名字走 i18n。
- **作者给默认画风，** 写在补充设定的「插图」节，存在 `works.illustration_style`，和标题、简介一样不属于版本：改了立即对之后的新开局生效，不计入草稿的修订号，也不会让已确认的方案回到未确认（[数据模型 §2](./data-model.md#2-作品与版本)）。作者没写时用 `DEFAULT_ILLUSTRATION_STYLE`（`painterly`）。
- **玩家开局时可以改，** 存进开局行。**开局后锁定：** 一局之内画风不变，所以一个形象在一局里只有一张立绘。
- **自定义画风的原文可能是中文，** 由 §8 的调用写进英文提示词。

## 7. 插图

### 7.1 什么时候画

- **开场固定画一张，** 放在开场第一段之前。固定人物的开场不经过 narrator，没人能给它打标记；而开场是玩家对这部作品的第一印象。
- **之后由 narrator 判断高潮。** `propose_turn` 的 `illustrate` 参数写高潮所在的段号，不画就留空（[回合循环 §5](./turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)）。没有频率上限，是高潮就画；画得多不多靠提示词和评测把握，诊断按路线记下标记率（§11）。
- **标记随回合提交，** 写进 `turns.illustrate_para`。开场为 0，表示第一段之前。
- **插图开关打开、并且选了出图服务时，** 在提交回合的同一个事务里插入一行 `illustrations`，状态为 `queued`。client 拿到回合时就知道这里有图，立刻按宽高比占位。
- **候选不画。** 换一种发展的候选只记下 `illustrate_para`；候选被采用时，在采用的那个事务里插入 `illustrations`。原版回合上的图留在原版上。
- 开关关闭或没有出图服务时不插入记录，界面上也不出现占位。

### 7.2 一张插图的流程

后台取出一张 `queued` 的插图后，依次执行：

1. **主角形象。** 主角入画、形象却为空时，先补写形象（§6.1）。
2. **镜头描述。** 用 §8 的调用写出提示词、负面提示词、画面说明和参考人物，存进这一行。已有镜头描述、并且它是按当前服务的能力写的，就跳过这一步。
3. **立绘。** 为每个参考人物找到或画出立绘（§6.2）。
4. **场景图。** 调用 `generate`：参考图按镜头描述里的顺序，宽高比 3:2，质量 `best`。
5. **保存。** 按 §9.3 写文件、提交记录，推送 `illustration.updated`。

- **失败后不再自动重试。** 除了 §5.1 那一次传输层面的自动重试，任一步失败，这一行就标为 `failed`，记下错误类别和失败在哪一步。玩家点「重试」时，从失败的那一步接着做，已有的镜头描述和立绘照用。
- **参考人物最多 `ILLUSTRATION_MAX_REFERENCES` 个**（默认 4，可配置），同时不超过服务能力里的 `maxReferences`。参考图越多越慢，一个画面里需要认出脸的人物通常也就两三个。
- **整条流程不挡任何操作。** 图还没画好，玩家照常读、照常行动；图到达时只填进已经占好的位置。

### 7.3 由 core 拼进提示词的固定内容

- **画风片段。** 预设的英文片段直接拼接；自定义画风由 §8 写进提示词。
- **固定要避开的内容：** 文字、字母、水印、签名、标志。服务支持负面提示词时写进负面提示词；不支持时写成正面的描述，例如 `no text or lettering anywhere in the image`。这一条由 core 拼接，不交给 LLM 临场发挥，因为画面里一出现文字，就可能写出主角还不知道的名字。
- **主角不入画时，** 加上第一人称视角、画面里没有主角的要求。

### 7.4 重画、不要这张图、文件找不到了

- **「重画」** 沿用已有的镜头描述，换一个 seed 再画；成功后替换文件，失败时旧图保留。
- **「不要这张图」** 把状态改为 `dismissed`，文件由下一次清理删除，界面不再显示这一处。
- **文件找不到了：** 有人手动删了 `images/` 里的文件。读取时发现文件不在，返回 `image_file_missing`，界面显示「图片找不到了」和「重画」。

## 8. 镜头描述

镜头描述是一次模型调用，用 `background` 用途（[LLM 端点 §7](./llm-endpoints.md#7-用途分配)），经 `llm` 模块的 `complete()` 发出，不带任何工具。`background` 用途不要求模型支持工具调用，所以镜头描述也不用提案工具，而是让模型按固定格式输出纯文本，由 core 解析和校验。

**输入全部经过主角视角的投影：**

- 这一回合的正文和被标记的段号；开场图的段号是 0。
- 场景：地点在主角口中的称呼；在场人物，每人一行，包括短编号、主角对他的称呼、当前形象、是不是主角。
- 画风的原文、作者的内容边界（[数据模型 §2](./data-model.md#2-作品与版本) 的锚点）、主角是否入画、宽高比。
- 当前服务的能力：最多几张参考图、负面提示词是否生效。

不给真名、秘密、幕后栏目，也不给任何只有 narrator 才看得到的材料：插图是给玩家看的，镜头描述只能用玩家已经看得到的东西来写。

模型的输出是四行，每行以一个固定的标签开头，标签后面直到行尾都是这一项的内容：

| 标签 | 内容 |
| --- | --- |
| `PROMPT:` | 英文的正面提示词。参考人物写成 `{{ref:N}}`，N 对应 `REFS` 里的顺序 |
| `NEGATIVE:` | 英文的负面提示词。服务不支持负面提示词时留空 |
| `CAPTION:` | 用作品语言写的一两句画面说明，用作 alt 文字和大图下方的说明 |
| `REFS:` | 用逗号分隔的在场人物短编号，按画面里的主次排列；没有参考人物时留空 |

立绘用同一种格式，只是输入换成一个人物的形象和画风，`REFS` 留空。主角形象的补写（§6.1）也走 `complete()`，输出只有一行形象文字。

校验：

- `refs` 里的编号都在场、不重复，数量不超过上限；`prompt` 里的每个 `{{ref:N}}` 都有对应的参考人物。
- **`PROMPT` 和 `NEGATIVE` 里不出现任何人物的真名**（实体表里的 `name`）。画面靠参考图和外貌描述来认人；真名一进提示词，模型就可能把它当成文字画进画面，而主角未必知道这个名字。称呼不在禁止之列：「撑伞的女人」「the old man」这类称呼本身就是外貌描述，禁掉会把正常的描写也拒掉。
- **`caption` 经过不泄露校验**（[回合循环 §6](./turn-loop.md#6-校验与保存)），不能出现主角还不知道的名字。
- 缺标签、标签重复，或者校验不通过时，把逐条的错误附在下一轮请求里让模型重写，最多 2 次，仍不通过就以 `invalid_output` 失败。重写的次数和[回合循环 §6](./turn-loop.md#6-校验与保存)的修正次数相同。

提示词用英文，因为各家出图模型对英文最稳；画面说明是给玩家看的，所以用作品语言（[i18n §6](./i18n.md#6-作品语言)）。

## 9. 存储

### 9.1 目录

```
<数据目录>/images/
  playthroughs/<开局 id>/<sha256>.webp   这一局的插图和立绘
  works/<作品 id>/<sha256>.webp          作者创作时画的立绘
  pending/<sha256>.webp                  开局页的预览，开局时移进本局目录
```

- 文件名是内容的 sha256，扩展名按实际类型取 `.webp`、`.png` 或 `.jpg`。同一个目录里，相同的图只存一份。
- 记录里只存所属和哈希，路径由这两样推出，不存绝对路径，所以数据目录搬了位置也照样找得到。

### 9.2 表

```sql
illustrations (
  id              TEXT PRIMARY KEY,
  turn_id         TEXT NOT NULL UNIQUE REFERENCES turns ON DELETE CASCADE,
  playthrough_id  TEXT NOT NULL REFERENCES playthroughs ON DELETE CASCADE,
  para            INTEGER NOT NULL,   -- 图放在第几段之后；0 = 第一段之前
  status          TEXT NOT NULL,      -- queued | running | done | failed | dismissed
  stage           TEXT,               -- 失败时停在哪一步：appearance | shot | portrait | generate | save
  caption         TEXT,               -- 画面说明，作品语言
  prompt          TEXT,
  negative_prompt TEXT,
  shot_capability JSON,               -- 写镜头描述时依据的能力：maxReferences、negativePrompt
  refs            JSON,               -- 参考人物的实体 id，按 {{ref:N}} 的顺序
  seed            INTEGER,
  service_id      TEXT,
  model           TEXT,
  file            TEXT,               -- 文件的 sha256 加扩展名
  width           INTEGER,
  height          INTEGER,
  error           TEXT,               -- 错误类别（§5.4）
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at, updated_at
)

portraits (
  id              TEXT PRIMARY KEY,
  work_id         TEXT NOT NULL REFERENCES works ON DELETE CASCADE,
  scope           TEXT NOT NULL,      -- work | pending | playthrough
  playthrough_id  TEXT REFERENCES playthroughs ON DELETE CASCADE,  -- 只在 scope = playthrough 时有值
  entity_id       TEXT NOT NULL,
  appearance_hash TEXT NOT NULL,
  style_hash      TEXT NOT NULL,
  appearance      TEXT NOT NULL,      -- 画这张立绘时的形象原文
  style           JSON NOT NULL,      -- 画这张立绘时的画风
  status          TEXT NOT NULL,      -- queued | running | done | failed
  prompt          TEXT,
  negative_prompt TEXT,
  seed            INTEGER,
  service_id      TEXT,
  model           TEXT,
  file            TEXT,
  width           INTEGER,
  height          INTEGER,
  error           TEXT,
  created_at, updated_at
)
-- 可空列先用 ifnull 归一，原因同数据模型 §4
CREATE UNIQUE INDEX portraits_unique
  ON portraits (work_id, scope, ifnull(playthrough_id, ''), entity_id, appearance_hash, style_hash);
```

- 一个回合最多一张插图，所以 `turn_id` 唯一。候选被删除时，它的插图记录随外键删除。
- 插图和立绘的提示词含有故事内容，只存在 `library.db` 里，不进诊断库（[运行诊断 §2](./diagnostics.md#2-运行事件)）。

### 9.3 写入顺序

1. 按 §5.3 校验。
2. 写进同一目录下的临时文件，再改名成哈希文件名。同名文件已经存在，就删掉临时文件。
3. 在事务里把记录改为 `done`，写入文件名和宽高。
4. 事务提交之后推送事件。

这样不会出现「记录说有图、文件却不在」的中间状态。崩溃发生在第 2、3 步之间时，最多留下一个没人引用的文件。

### 9.4 清理

- **时机：** core 启动时；以及删除作品之后。
- **整目录删除：** 没有对应开局的 `playthroughs/<id>/`，没有对应作品的 `works/<id>/`。
- **逐个文件删除：** 在剩下的目录里，删掉不被任何 `done` 记录引用的文件，包括重画后被换下来的旧图和 `dismissed` 的图。修改时间在 `IMAGE_GC_GRACE_MS`（默认 10 分钟）以内的不删，免得误删正等着提交的图。
- **作者改过形象之后的旧立绘：** 作品立绘里，既没有任何一个版本的实体、也没有草稿方案里的人物项还在用它那段形象的，连记录一起删除。方案里的人物项要算进来，因为作者在确认方案之前就可以生成立绘，那时人物还没写进实体表；方案项的 id 就是之后实体的 id（[数据模型 §2](./data-model.md#2-作品与版本)）。
- **过期预览：** `pending/` 里超过 `PORTRAIT_PREVIEW_TTL_DAYS`（默认 7 天）、没被任何开局采用的预览，连记录一起删除。
- **重启：** core 启动时，把 `running` 的插图和立绘改为 `failed`，原因记为 `image_interrupted`，做法同[回合循环 §8](./turn-loop.md#8-中断与恢复)。

### 9.5 体量

单张 WebP 通常在几百 KB 到一两 MB 之间。设置页显示插图占用了多少空间，数字由两张表按文件去重后求和，不扫描磁盘。

## 10. 交给 client

- **取图是一个 oRPC 过程：** `image.file`，输入一个插图 id 或立绘 id，输出 `File`。oRPC 把位于输出根部的 `File` 直接作为响应体发送，不经过 multipart。响应带正确的 `Content-Type`；core 的 HTTP 层给所有响应加上 `X-Content-Type-Options: nosniff`。
- **client 带令牌取图，再转成 blob URL 交给 `<img>`。** `<img src>` 带不了 `Authorization` 请求头，所以不能直接写接口地址。为此内容安全策略的 `img-src` 加上 `blob:`（[架构总览 §2.1](./architecture.md#21-本机接口的安全)）。
- **client 在内存里按「插图或立绘的 id 加更新时间」缓存最近用过的 blob URL。** 重画之后更新时间变了，自然取到新图。回合卸载或缓存淘汰时调用 `URL.revokeObjectURL`。
- **立绘只给主角见过的人。** 手记接口只对认识阶段已到 `met` 的人物返回立绘 id；只听说过的人不返回，否则等于提前透露他的长相（[数据模型 §5](./data-model.md#5-可见性规则)）。这条规则写在 core 的投影里，不交给 client 去过滤。
- **回合视图里的插图**只带状态、段号、宽高、画面说明和错误类别，不带提示词。
- **事件：** `illustration.updated`（插图状态变了）、`portrait.updated`（立绘状态变了）、`image.config_changed`（出图服务的配置变了）。规则同[架构总览 §3](./architecture.md#3-client-与-core-的通信)：事件只是通知，状态以查询结果为准。

插图和立绘的操作都是 oRPC 过程。有副作用的都带幂等键，双击和网络重发只生效一次（[架构总览 §3](./architecture.md#3-client-与-core-的通信)）：

| 过程 | 作用 |
| --- | --- |
| `illustration.retry` | 从失败的那一步接着画一张插图（§7.2） |
| `illustration.reroll` | 沿用镜头描述，换一个 seed 重画（§7.4） |
| `illustration.dismiss` | 不要这张图（§7.4） |
| `portrait.generate` | 作者在方案里为一个人物生成或重画立绘，归作品所属（§6.2） |
| `portrait.preview` | 开局页的「预览画风」和重画预览，归预览所属（§6.2） |
| `play.suggestAppearance` | 开局页的「按设定写一个」：按作者的主角设定起草一段主角形象，只返回文字，不写库 |

`play.start` 的输入另带本局的插图设置：画风、主角是否入画、主角形象（[数据模型 §3](./data-model.md#3-经历开局回合树路线存档)）。

## 11. 调用记录与诊断

```sql
image_calls (
  id              TEXT PRIMARY KEY,
  service_id      TEXT NOT NULL,
  protocol        TEXT NOT NULL,     -- unwritten-image | openai-images
  model           TEXT,
  work_id         TEXT REFERENCES works ON DELETE SET NULL,
  ref_kind        TEXT NOT NULL,     -- illustration | portrait | test
  ref_id          TEXT,
  quality         TEXT NOT NULL,
  reference_count INTEGER NOT NULL,
  input_tokens    INTEGER,           -- 只有 openai-images 报告
  output_tokens   INTEGER,
  duration_ms     INTEGER,
  status          TEXT NOT NULL,     -- ok | error | aborted
  error           TEXT,              -- 错误类别（§5.4）
  created_at
)
```

- **设置页的用量汇总**按服务列出最近 7 天和 30 天画了多少张、用了多少 token。按张计费的服务不在响应里报告费用，所以 core 不估算费用。
- core 启动时删除 90 天以前的记录，同 [LLM 端点 §9](./llm-endpoints.md#9-调用记录)。
- 插图的事件和计时样本见[运行诊断 §2.1](./diagnostics.md#21-错误提示与诊断编号)和[§3](./diagnostics.md#3-性能样本)，其中按路线记录的 narrator 标记率，用来发现某个模型标高潮标得太多。

## 12. 不做的事

- **载入 core 的代码插件。** 理由见[插件 §1](./plugins.md#1-什么是插件)。
- **其他协议的适配器**，例如 Gemini、A1111、阿里云百炼。这些服务可以在前面加一层实现 Unwritten 图像协议的代理来接入。
- **插图的频率上限。** 是高潮就画，频率由 narrator 的判断和评测把握。
- **离线后自动补画。** 服务连不上时直接失败，由玩家手动重试，免得服务回来后积压的图一口气画出来。
- **生成进度的百分比。** OpenAI 图像接口不报告进度，占位符保持安静，只写「正在画这一幕」。
- **服务端的原生画风**，例如把「水彩」对应到服务器上的一个 LoRA。画风预设要和服务器上装的模型一一对应，复杂度明显上升。
- **转码和缩略图。** 需要原生的图像库；手记里的缩略图直接把原图缩小显示。
- **候选的插图、游玩中途改画风、手动「画这一幕」、插图的图集和导出、按作品单独指定出图服务。**

## 13. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 没有配置任何出图服务 | 走一遍创作、开局和游玩 | 界面上没有任何和插图有关的入口或占位；只写一句背景照样能玩通 |
| 伪出图服务已接入，插图开关打开 | 开局，再玩到 narrator 标记了高潮的一回合 | 开场第一段之前和被标记的段落之后各出现一个占位；图到达后填进占位，正文和阅读位置不动 |
| 一致性测试 | 对伪服务和真实插件分别运行 | 都通过；对一个不校验令牌的服务运行时失败 |
| 出图服务返回一张 SVG，或一个超过 20 MB 的文件 | 等这张图 | 以 `image_invalid_response` 失败，`images/` 里没有这个文件 |
| 出图服务的地址返回 302，指向另一台测试主机 | 测试连接，或画一张图 | 以 `image_redirected` 失败，另一台主机没有收到任何请求 |
| 服务离线 | 连续玩到两个被标记的高潮 | 两处都很快显示失败和「重试」，没有等到超时；服务上线后点「重试」能画成 |
| 一张插图在场景图这一步失败 | 点「重试」 | 不再调用镜头描述，也不重画立绘，只重画场景图 |
| 一个主角只知道外号的人物在场 | 查看画面说明和发出的提示词 | 画面说明只用外号；提示词里没有他的真名 |
| `background` 用途配的是一个不支持工具调用的模型 | 玩到一个高潮 | 镜头描述照常写成，插图照常画出 |
| narrator 在一次换一种发展的候选里标了高潮 | 打开比较，再采用候选 | 比较时候选没有占位；采用之后出现占位并开始画；原版回合上的图仍在原版上 |
| 同一部作品开两局，画风相同，第二局沿用作者在方案里画好的立绘 | 删掉第一局的目录，再看第二局 | 第二局的立绘和插图完好 |
| 删除一部有插图的作品 | 重启 core | 这部作品的 `works/` 目录和各局的 `playthroughs/` 目录都不见了 |
| 手记里有一个见过和一个只听说过的人物 | 查看手记接口的响应 | 只有见过的那个人带立绘 id |
| 源码里写一个 `comfy` 字样的分支 | 运行测试 | 扫描源码的测试失败 |
| `providers.json` 是版本 1 | 启动 core，从界面添加一个出图服务 | 读取正常；保存后文件是版本 2，旧文件存成 `providers.json.bak` |
