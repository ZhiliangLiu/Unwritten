# Unwritten · 插图与出图服务

本文说明游玩时的插图怎样生成：出图服务怎样配置，core 与出图服务之间的协议，人物形象与参考图，一张插图从标记到显示的流程，以及图片怎样存储、交给 client。玩家和作者看得见的行为见[游玩流程 §2.1](./gameplay-flow.md#21-插图)和[创作流程 §2](./authoring-flow.md#2-写背景只补自己在意的设置)；可以在 Colab 上运行的出图服务见 [ComfyUI 插件](./comfyui-plugin.md)。

一句话概括：**core 只认协议和能力，不认具体的出图服务；插图在回合提交之后生成，从不挡住正文。**

## 1. 组成

| 部分 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `image`（core 模块） | 出图服务的配置与探测、两种协议的客户端、启动器客户端与按需唤醒（§12）、按服务排队、返回数据的校验、调用记录 | 不认识作品、人物和回合 |
| `illustration`（core 模块） | 什么时候画、镜头描述、挑参考人物、人物参考组、图片文件的存储与清理、把结果挂到回合和人物上 | 不认识具体的协议 |
| 出图服务 | 按协议接收提示词和参考图，返回一张图 | 不认识故事，不接触作品库 |
| 插件 | 实现 Unwritten 图像协议（§3）或启动器协议（§12.2）的独立服务，例如 [ComfyUI 插件](./comfyui-plugin.md)、[Colab 启动器](./colab-launcher.md) | 不载入 core，不和 core 共享代码 |

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
      "apiKey": "$UNWRITTEN_IMAGE_TOKEN",
      "launcher": { "baseUrl": "http://127.0.0.1:8290", "apiKey": "$UNWRITTEN_LAUNCHER_TOKEN" },
      "idleMinutes": 30
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
- **令牌由设置页生成，** 规则见[插件 §3.2](./plugins.md#32-鉴权)。用户先复制令牌到服务那一侧，再填服务地址。保存前，令牌和表单草稿随页面关闭而丢弃。重新开始时，用新令牌替换服务侧的令牌。保存后 core 把它写进服务的 `apiKey`。
- **`image.service` 是用于出图的服务。** 为空时停止出图，开局页收起插图设置。已有图片照常显示和保存，作者仍可从本机录入人物参考。删除正在使用的服务时，确认框写明效果，删除后把它清空。
- **按需启动是可选项。** 只有 `unwritten-image` 服务能配 `launcher` 和 `idleMinutes`。`launcher` 是启动器的地址和 key，key 的规则同服务的 `apiKey`；`idleMinutes` 默认 `IMAGE_IDLE_MINUTES`（30），取 5 到 720 之间的整数。规则见 §12。
- **能力从哪来。** `unwritten-image` 服务的能力由服务自己报告（§3.2），配置里不写。`openai-images` 服务没法自报，能力写在 `capabilities` 里；添加服务时按模型 id 预填（§4.3），用户可以改。
- **「游玩时生成插图」默认关闭。** 首次开启前，设置页列明实际使用的 `background` 和出图服务、各自接收的内容，并提示一张插图可能先生成多张参考图。确认关联的服务 id、`openai-images` 模型 id 和 `background` 的实际端点与模型，存入 `app_settings`。任一项变化后，设置页恢复关闭，重新确认后生效。每局仍可选择纯文字，生效规则见 §7.1。

设置页的「出图服务」一节：

| 操作 | 做什么 |
| --- | --- |
| 添加服务 | 选协议，填名称、地址、key。`unwritten-image` 可以点「生成令牌」；`openai-images` 另填模型 id，确认预填的能力 |
| 测试连接 | `unwritten-image` 读取 `/v1/info`，显示实现名、模型、能力和就绪状态。`openai-images` 读取 `{baseUrl}/models`，成功后显示「连接成功」，出图能力由实际生成验证 |
| 生成测试图 | `openai-images` 用固定的测试提示词画一张图。用户先确认可能产生费用，成功后显示「已成功出图」 |
| 状态 | 显示最近一次的连接结果和时间，未就绪时显示原因。成功出过图时，显示最近一次出图时间 |
| 默认出图规格 | 正文插图的比例默认为「自动」，也可固定。分辨率可选「高 · 720」「很高 · 1K」「非常高 · 2K」，优先预填 1K。当前服务只有一档时显示该档及原因。显示各档的实际宽×高，大尺寸可能更慢或更贵 |
| 按需启动 | `unwritten-image` 服务可以填启动器地址、点「生成令牌」生成启动器令牌、设空闲多少分钟后关闭服务。「测试启动器」读取启动器的信息和当前状态。见 §12 |
| 隐私说明 | `background` 服务接收可用的正文片段、人物形象和镜头约束。出图服务接收由此写成的提示词和每次选中的参考图片，可能包括本机导入的图片。手动补齐视角或生成主角预览时，在操作处提示涉及的内容与接收方 |

默认规格保存在 `app_settings`，新开局可覆盖。比例固定时，只提供该比例可用的档位。比例自动时，某档至少有一个比例可用即可选。进入新开局表单时，默认选项已不可用就提示并预填新服务可用的规格。打开表单后能力再变化时，仍可开始故事并保留玩家提交的偏好。无法出图的规格按 §7.4 处理。

core 接口都是 contracts 里的 oRPC 过程：

| 过程 | 作用 |
| --- | --- |
| `image.services.list` | 出图服务列表：协议、地址、`hasKey`、`keySource`、能力、最近一次连接结果和成功出图时间。同时返回 `image.service` |
| `image.services.create`、`image.services.update`、`image.services.remove` | 增删改，规则同 [LLM 端点 §10](./llm-endpoints.md#10-core-接口) 的端点过程 |
| `image.services.generateToken` | 生成 `unwritten-image` 服务令牌或启动器令牌，只在这次响应里返回原文。创建或修改服务时随表单保存 |
| `image.services.test` | 测试连接；`paid: true` 时为 `openai-images` 生成一张测试图；`target: "launcher"` 时读取启动器的 `/v1/info` 和 `/v1/state` |
| `image.select` | 修改 `image.service` |
| `image.outputPreferences` | 读取或修改新开局默认的比例偏好与分辨率档位，返回当前服务可用的比例与像素尺寸 |
| `image.usage.summary` | 出图用量汇总（§11） |
| `image.file` | 取一张插图或参考图（§10） |
| `image.prewarm` | 进入开了插图的开局时，让当前服务提前唤醒（§12.3） |
| `image.wake.continue` | 用户在浏览器里完成启动器要求的操作后，让唤醒继续（§12.3） |

## 3. Unwritten 图像协议

协议名是 `unwritten-image/1`。它遵守[插件 §3](./plugins.md#3-协议的共同规则)的全部共同规则：路径带主版本号、只增不改、Bearer 令牌、不返回重定向和 CORS 头、信息接口、幂等键、任务、错误格式。本节只写出图协议独有的部分。

### 3.1 参考图

参考图以内联 base64 放在请求体里，请求里只有本次选中的图片字节和媒体类型。core 选择人物及视角（§7.2），然后按数组顺序用 `{{ref:N}}` 指定图片。人物、参考组 id、文件路径和图片来源都留在 core。除了取图接口直接返回字节，其余请求和响应都是 JSON。OpenAI 图像接口按同一顺序构造 multipart 的 `image[]`（§4.1）。

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
    "aspects": ["1:1", "3:2", "3:4"],
    "resolutions": {
      "1:1": {
        "720": { "width": 720, "height": 720 },
        "1k": { "width": 1024, "height": 1024 },
        "2k": { "width": 2048, "height": 2048 }
      },
      "3:2": {
        "720": { "width": 1088, "height": 720 },
        "1k": { "width": 1536, "height": 1024 }
      },
      "3:4": {
        "720": { "width": 720, "height": 960 },
        "1k": { "width": 1024, "height": 1360 }
      }
    }
  }
}
```

- `protocol`、`implementation`、`ready`、`notReadyReason`、`capabilities` 是所有协议共有的字段（[插件 §3.3](./plugins.md#33-信息接口)）；`model` 和 `queue` 是出图协议加的，只用来在设置页显示。
- **未就绪的原因：** `starting`（启动或自检中）、`out_of_memory`（显存跑不动模板）、`workflow_error`（模板跑不通）。core 据此提示「出图服务正在启动」或对应的原因。
- **`qualities`：** `fast` 用于开局页的预览，`best` 用于插图和参考图。服务至少支持 `best`；只支持一档时，core 两种用途都用它。
- **`negativePrompt` 为 false，表示服务会忽略负面提示词，** 例如工作流的 CFG 为 1。这时 core 不发这个字段，把要避开的内容写进正面提示词（§7.3）。
- **`aspects` 至少包含 `3:2` 和 `3:4`。** 它是可选比例列表，正文插图可以用其中任一项。比例标签表示构图类别，实际像素允许按工作流对齐。
- **`resolutions` 是可选能力。** 对已公布的比例列出 `best` 可用的具体尺寸。档位 `720`、`1k`、`2k` 的目标短边分别为 720、1024、2048 像素，允许因工作流的像素对齐而相差至多 16 像素。启用参考图时，公布的尺寸同时适用于带参考图和纯文生图。某比例没有可选尺寸时只显示「服务默认」，包括只报告 `aspects` 的旧服务。`fast` 预览按服务默认尺寸。
- **校验已知规格。** 比例使用互质的正整数宽高比且不重复。显式尺寸须为正整数，符合 §5.3 的像素上限，并与所报比例的宽高比相差不超过 `IMAGE_ASPECT_TOLERANCE`（默认 2% 相对误差）。已知档位按总像素递增，只有确实支持的档位才报告。已知能力字段不合格时，连接测试报 `image_invalid_response`。

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
  "size": { "width": 1536, "height": 1024 },
  "quality": "best",
  "seed": 42
}
```

- `prompt` 是英文，参考图用 `{{ref:N}}` 指代，N 从 1 起，对应 `references` 的顺序。服务把它换成模型自己的写法，所以 core 不需要知道任何模型的提示词语法。长度不超过 `maxPromptLength`。
- `negativePrompt` 只在 `capabilities.negativePrompt` 为 true 时发送，所以上面这个发给 `negativePrompt: false` 服务的例子里没有它。
- `references` 不超过 `maxReferences` 张，每张解码后不超过 `maxReferenceBytes`，`mime` 是 `image/png`、`image/jpeg`、`image/webp` 之一。服务会实际解码校验，不信 `mime`。
- `aspect`、`quality` 必须在能力列表里。仅在 `quality` 为 `best`、服务声明所选比例与尺寸时发送 `size`。宽与高都是正整数，必须与所选比例下已公布的尺寸完全匹配。省略时按服务默认尺寸出图。档位名留在 core，插件只处理实际尺寸。
- `seed` 只在 `capabilities.seed` 为 true 时发送；省略时服务随机取一个，在结果里返回。

响应 202：`{ "id": "<任务 id>", "status": "queued" }`。

- **幂等**按[插件 §3.4](./plugins.md#34-有副作用的请求)：隧道抖一下、core 重发 POST，GPU 不会把同一张图画两遍。服务至少记住幂等键，直到任务结果过了保留期（§3.5）。
- 规格或参考图校验失败发生在登记任务之前。原请求明确被拒后，按新能力重建的请求体用新幂等键。传输重发沿用原请求体和原键。
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
| `too_many_references`、`reference_too_large` | 400、413 | 参考图超过服务能力 | 刷新能力，保留本图规格，按新能力重做一次 |
| `unsupported_aspect`、`unsupported_size`、`unsupported_quality` | 400 | 已选规格不再可用 | 刷新能力，原规格仍可用时才重试。否则以 `image_output_format_unavailable` 结束 |
| `idempotency_conflict` | 409 | 同一个键、不同的请求体 | 不重试，记为 `image_invalid_request` |
| `busy` | 429 | 队列已满 | 按 `Retry-After` 等待后重试一次 |
| `not_ready` | 503 | 服务未就绪 | 不重试，提示服务正在启动 |
| `not_found` | 404 | 任务不存在或结果已过期 | 已拿到任务 id 时以 `image_interrupted` 结束，由用户决定是否重试 |

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

`fixed` 只提供 1K。横图 3:2 用 1536×1024，竖图 2:3 用 1024×1536，方图用 1024×1024。界面直接显示真实比例。

`custom` 使用以下预设。转置的尺寸也提供对应的转置比例。

| 比例 | 720 | 1K | 2K |
| --- | --- | --- | --- |
| 1:1 | 不提供 | 1024×1024 | 2048×2048 |
| 3:2 | 1088×720 | 1536×1024 | 3072×2048 |
| 3:4 | 720×960 | 1024×1360 | 2048×2736 |
| 16:9 | 1280×720 | 1824×1024 | 3648×2048 |

core 把所选预设的宽高拼成 `size`。720 方图低于自定义模型的最小像素数。画风预览用可用的最小尺寸。尺寸和质量档分别传递。自定义尺寸的取值依据见 [OpenAI 图像生成指南](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output)。

### 4.3 按模型预填的能力

| 模型 id | `maxReferences` | `sizes` |
| --- | --- | --- |
| 以 `gpt-image-2` 开头 | 16 | `custom` |
| `gpt-image-1.5`、`gpt-image-1-mini`、`chatgpt-image-latest` | 16 | `fixed` |
| 其他 | 0 | `fixed` |

`maxReferences` 为 0 时不调编辑接口，人物一致性只靠形象文字，设置页写明这一点。模型更替很快，这张表随版本维护，模型 id 永远可以手填。

OpenAI 图像接口的参考图按 core 的单张 `IMAGE_MAX_BYTES` 限制筛选。Unwritten 图像协议按服务报告的 `maxReferenceBytes` 筛选。

### 4.4 错误

| 情况 | 类别 |
| --- | --- |
| 401、403 | `image_unauthorized` |
| 429，且 `error.code` 是 `insufficient_quota` | `image_quota`，不重试 |
| 其他 429 | `image_rate_limited`，等待后重试一次 |
| 400，且 `error.code` 是 `moderation_blocked` | `image_refused` |
| 400 且服务明确拒绝 `size` | `image_output_format_unavailable` |
| 其他 400 | `image_invalid_request` |
| 能确认尚未提交就已断网或超时 | `image_offline`、`image_timeout`。自动重试一次 |
| 请求可能已提交，响应丢失、超时或收到 5xx | `image_outcome_unknown`。说明服务可能已出图或计费，交给用户决定是否重试 |
| 301、302、303、307、308 | `image_redirected` |

## 5. image 模块

### 5.1 调用入口

`image` 模块对 `illustration` 只提供两个函数：

- `capabilities()`：当前服务的能力。`unwritten-image` 服务取最近一次 `/v1/info` 的结果，`openai-images` 服务取配置。
- `generate(input)`：`input` 包含 `prompt`、`negativePrompt`、`references`、`aspect`、`size`（可省略的实际宽高）、`quality`、`seed`、`signal`、`ref`（调用记录的引用，§11）。返回图片字节、类型、宽高、实际用的 seed（没有时为空）、服务 id 和模型。

规则：

- **每个服务同时只跑一个任务。** 出图服务背后通常只有一块 GPU。用 p-queue 按服务排队，并发数为 1；开局页的预览优先，其余按先后顺序。
- **离线时快速失败。** core 记着每个服务最近一次的连接结果。最近 `IMAGE_OFFLINE_TTL_MS`（默认 60000）以内连不上过，自动排进来的新任务直接以 `image_offline` 失败，不再等超时；超过这段时间，下一个任务先探测，再提交。**玩家手动点「重试」「重画」或「预览画风」时不看这条记录，** 先探测一次再提交：玩家往往是刚把服务开起来才点的重试。**配了启动器的服务不快速失败，** 连不上时先按 §12.3 唤醒，任务在队列里等。
- **自家协议的单个任务，** 从提交到取回图片最长 `IMAGE_JOB_TIMEOUT_MS`（默认 600000，可配置）。超时后对服务发 DELETE，以 `image_timeout` 失败。
- **自动重试最多一次。** Unwritten 图像协议对同一请求复用幂等键，OpenAI 图像接口按 §4.4 处理。再失败就交给玩家点「重试」。

### 5.2 外发请求

`llm` 模块里那个不跟随重定向的 `fetch` 封装，抽成独立的 `net` 模块，`llm` 和 `image` 都经过它（[LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)）。出图服务的 key 和模型服务的 key 一样，不能被重定向带到另一台主机。

### 5.3 校验返回的数据

出图服务的返回是信任边界：

- **按文件头判断类型。** 只收 PNG、JPEG、WebP。SVG 能带脚本，和其他类型一样一律拒收，以 `image_invalid_response` 失败。
- **单张不超过 `IMAGE_MAX_BYTES`**（默认 20 MB）。读取响应时累计字节数，超限即停止。OpenAI 先按该上限换算 base64 长度并给 JSON 字段留固定余量，限制整段响应，再校验解码后的字节数。
- **宽高从文件头读出。** 宽和高必须为正，乘积不超过 `IMAGE_MAX_PIXELS`（默认 3200 万像素）。
- 显式要求宽高时按实际像素核对。结果尺寸不同，以 `image_invalid_response` 失败，已有图片保持可用。
- 省略宽高时按比例及 §3.2 的误差范围核对实际图片，实际像素用于显示。生成的参考图也核对下游服务的单张参考图上限，超限时保留原有参考并提示用较小尺寸重试。
- **参考图只接受静态图片。** 用来建参考组的图片如果带 EXIF、XMP 或文本块，就以 `image_invalid_response` 失败，避免随后将元数据发到其他服务。标准色彩信息可以保留。
- **出图服务返回的合格文件原样保存。** 本机导入在 client 整理，见 §6.2。

### 5.4 错误类别

错误码写在 contracts 的 `errors.ts` 里，client 按 `errors:<code>` 显示（[i18n §5](./i18n.md#5-core-返回什么)）。出图错误包括 `image_unauthorized`、`image_quota`、`image_rate_limited`、`image_offline`、`image_not_ready`、`image_busy`、`image_refused`、`image_timeout`、`image_server`、`image_outcome_unknown`、`image_invalid_request`、`image_invalid_response`、`image_redirected`、`image_out_of_memory`、`image_workflow_error`、`image_interrupted`、`image_file_missing`。按需启动的错误是 `image_launcher_offline`、`image_launcher_unauthorized`、`image_wake_failed`、`image_wake_timeout`（§12.3）。录入校验失败用 `image_invalid_upload`，参考图超过服务上限且没有可用的同组图片时用 `image_reference_too_large`。提示的写法同[设计准则 §8](./design-guidelines.md#8-文案语气)。

选定的比例、分辨率档位或已确定的像素尺寸无法用于当前服务时返回 `image_output_format_unavailable`。提示说明当前服务不支持的选项，以及本次可选规格。

## 6. 人物形象与参考图

### 6.1 形象

**形象只写此刻看得见的样子：** 长相、身形、衣着、显眼的特征。人物在伪装就写伪装；揭晓之后，在揭晓的那一回合追加新的形象。不写身份、来历和任何秘密，因为参考图和插图会把它原样画出来。这一条靠提示词和评测保证（[回合循环 §11](./turn-loop.md#11-叙述约定)）。

| 人物 | 形象存在哪 | 由谁写 |
| --- | --- | --- |
| 作者设定的人物 | `entities.profile.appearance`，随版本复制 | 作者在方案里写，或采用 AI 起草的形象 |
| 每局生成的人物 | `entities.profile.appearance`，开场提交时写入 | narrator 在 `propose_cast` 里可选填写 |
| 开场预览里新出现、采用时写成作者设定的人物 | `entities.profile.appearance`，采用开场时写入 | narrator 在预览的 `new_entity` 里可选填写 |
| 游玩中新出现的人物 | `entities.profile.appearance`，随 `new_entity` 写入 | narrator 在 `new_entity` 里可选填写 |
| 主角 | 开局行的 `illustration.protagonistAppearance` | 玩家在开局页写；选了入画却留空时，由 AI 按作者的主角设定写一份 |
| 路线上的变化 | `trait` 事实，`key` 是 `appearance` | narrator |

- **主角的形象存在开局行，不存在事实表。** 它每局一份；而且 AI 补写形象要花时间，赶不上固定人物开场的同步提交（[回合循环 §10](./turn-loop.md#10-开场)）。补写只发生一次，写入后不再改。
- **当前形象**由 [数据模型 §4–5](./data-model.md#4-故事事实)的覆盖和可见性规则决定。没有形象特征且基础形象可见时，用基础形象。
- 形象不超过 `APPEARANCE_MAX_LENGTH`（300 字），不含换行。
- 人物的文字形象可留空。可见身份已有参考时，照常取用其基础组。既没有可用的形象文字也没有可见参考时，只用正文可确认的细节。模型漏填或填错插图附加项时，正文照常提交（[回合循环 §6](./turn-loop.md#6-校验与保存)）。

### 6.2 人物参考组

**基础参考组。** 一个可见形象用一组固定图片。作者和玩家的录入入口见[创作流程 §3](./authoring-flow.md#3-确认故事方案再生成开场)和[游玩流程 §2.1](./gameplay-flow.md#21-插图)。

| 位置 | 内容 | 使用场景 |
| --- | --- | --- |
| `front` 正面 | 平视的头肩像，能看清五官、发际线和左右不对称的特征 | 必填。适合近景，也是补齐其他视角时的依据 |
| `three_quarter` 斜侧脸 | 四分之三角度的头肩像，可看清鼻梁、下颌和侧面轮廓 | 转头、对视或斜侧角度 |
| `full_body` 全身 | 自然站立、完整入画，能看出身形和比例 | 动作、远景或多人互动 |

- **生成。** 用形象文字里的稳定外貌特征生成正面。全组用放松表情、简单衣着和素净背景。斜侧脸和全身各自用同一张正面作参考。服务支持参考图时才补画，可逐张重试。默认使用可用的竖图比例，优先用 1K。姿态按参考位置固定，作者和玩家手动生成时可选实际支持的比例和档位。已采用的文件保持原样。生成使用 `best`。
- **导入。** client 从本机选择静态 PNG、JPEG 或 WebP，解码前检查类型、`IMAGE_MAX_BYTES` 和 `IMAGE_MAX_PIXELS`。按照片方向解码后，用 Canvas 等比缩放并重新编码。优先用 WebP，浏览器返回 PNG 时按 PNG 处理。长边不超过 `PORTRAIT_IMPORT_MAX_EDGE`（默认 1536 像素），结果不超过 `PORTRAIT_IMPORT_MAX_BYTES`（默认 4 MiB）。用户预览后，通过带令牌的 multipart 上传一个位置，使用固定的传输文件名。core 以文件内容独立检查容器、实际宽高、字节上限和静态帧。可保留标准色彩信息，遇到 EXIF、XMP 或文本块则拒收。原图、路径和原始文件名不入库。参考图在主动出图或经设置确认的自动出图时才发到出图服务。见 [HTML Canvas 编码规范](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob)。
- **采用。** 一张可用的正面就能采用。斜侧脸和全身可以补齐后再次采用。替换正面会把已存在的其他视角标为待复核，采用时排除尚未通过复核的视角。采用记录固定当时通过复核的文件，后续编辑从独立草稿开始。生成结果用尝试 id 和草稿修订号守卫，迟到结果不能覆盖替换或采用的图片。
- **开局复用。** 开局按实际选用的作品版本匹配已采用的作者参考组，锁定组 id。玩家点「用作本局参考」时，生成一份包含当时已就绪视角的预览快照。开局校验快照所属作品、主角和形象，把它用作本局主角的参考。未主动选择时沿用符合条件的作者参考组。参考可以跨画风取用，镜头提示词写明本局画风。没有参考组时，第一次需要入画再生成正面，正文照常可读。
- **路线上的可见身份。** 从目标段可见的形象沿祖先链回溯。带 `same_visible_identity` 的变化继续使用原基础组，由镜头描述交代换装、受伤和表情。真容仍被遮住时只能使用可见的伪装参考。没有合适参考时，按该段可见文字生成或降级。

画风预览用固定题材和 `fast` 的默认尺寸，只供比较画风。

### 6.3 画风

- **预设加自定义文本。** 预设是一组 id 和英文提示词片段，写在 core 的常量里：`watercolor`（水彩）、`ink`（水墨）、`anime`（赛璐璐）、`painterly`（厚涂）、`cinematic`（写实电影感）。界面上的名字走 i18n。
- **作者给默认画风，** 写在补充设定的「插图」节，存在 `works.illustration_style`，和标题、简介一样不属于版本：改了立即对之后的新开局生效，不计入草稿的修订号，也不会让已确认的方案回到未确认（[数据模型 §2](./data-model.md#2-作品与版本)）。作者没写时用 `DEFAULT_ILLUSTRATION_STYLE`（`painterly`）。
- **玩家开局时可以改，** 存进开局行。开局后按该画风继续绘制，人物身份沿用本局锁定的参考。
- **自定义画风的原文可能是中文，** 由 §8 的调用写进英文提示词。

## 7. 插图

### 7.1 什么时候画

- **开场图放在第一段之前，** 因而只使用开场前可公开的初始处境。没有足够的已公开素材时跳过，见[数据模型 §5](./data-model.md#5-可见性规则)。
- **之后由 narrator 标记值得定格的瞬间。** 配图情况见[游玩流程 §2.1](./gameplay-flow.md#21-插图)，标记的写法见[回合循环 §5](./turn-loop.md#5-提交一回合propose_turn-与-ask_clarification)。有效标记随回合写入 `turns.illustrate_para`，其中 0 始终指第一段之前。
- **启用条件。** 已确认当前服务的自动出图（§2），且本局 `enabled` 为 true 时，才为提交的有效标记在同一事务里插入 `queued` 插图记录，并保存本局的比例偏好和分辨率档。纯文字开局始终跳过出图。
- **占位。** 比例固定时 client 拿到记录即可留出画框。自动比例时先显示一行状态，比例确定后再建立对应比例的画框，并保持正在读的正文位置。完成图按实际比例完整放入画框。
- **候选不画。** 换一种发展的候选只记下 `illustrate_para`。采用时按启用条件在同一事务里登记插图。原版回合上的图留在原版上。
- 关闭自动出图或服务确认失效时，停止未完成的游玩出图，包括该局按需生成的参考图。排队任务取消，已提交的请求尽力取消并丢弃迟到的结果。没有完成图的插图记录变成 `cancelled` 并收起占位，重画取消时保留完成图。重新开启后从新回合继续，不补画取消的任务。单张重试和重画也检查当前服务的确认状态与本局的设置。

### 7.2 一张插图的流程

后台取出一张 `queued` 的插图后，按 §7.1 检查启用条件，为本次尝试固定已确认的 `background` 和出图服务。先校验已选规格。待选比例为空，或已确定的规格不再可用时，直接按 §7.4 结束，本次不发模型或出图请求。每次调用前复核采用的服务确认与尝试 id，请求发往固定的目标。服务确认失效时结束本次尝试。服务连不上且配了启动器时，插图保持 `queued`，等 §12.3 的唤醒完成；唤醒失败时以 `wake` 这一步失败。

1. **主角形象。** 本段允许主角入画且形象为空时，先按 §6.1 补写。补写只使用可公开的主角外观设定。
2. **镜头描述与规格。** core 从该分辨率档取可用比例。固定比例或仅有一个可用比例时，由 core 确定并交给模型构图。自动且有多个比例时，由 §8 的镜头模型从清单中选。把比例和该档对应的像素尺寸写入本次尝试并通知 client。普通重试或重画使用记录中已经确定的规格。没有确定过比例时才重新选择。
3. **选参考图。** 从 §6.2 固定的参考组为每个参考人物选一张。按所需视角、正面、同组其他视角的顺序，选符合服务上限的首张。组内图片都超过服务上限时，提示图片过大。缺少可用的可见形象，或服务支持的参考图数量为 0 时，改用正文可确认的外貌文字。实际发出的数组确定后，从原始镜头描述一次性重写引用，并在出图前登记本次选中的文件。
4. **正文插图。** 调用 `generate`，传本图已经确定的比例和可选的实际宽高。参考图按镜头描述里的顺序传入，质量用 `best`。
5. **保存。** 按 §9.3 写文件、提交记录，推送 `illustration.updated`。

- **失败后不再自动重试。** 除了 §5.1 的传输层重试，任一步失败，这一行就标为 `failed`，记下错误类别和失败在哪一步。玩家点「重试」时，从失败处接着做，仍与原段落及当前服务能力匹配的镜头描述和参考图继续使用。
- **每次每个参考人物只发一张。** 参考人物最多 `ILLUSTRATION_MAX_REFERENCES` 个（默认 4，可配置），同时不超过服务的 `maxReferences`。名额优先给动作和互动主体，其余人物用可见外貌描述。
- **整条流程不挡任何操作。** 图还没画好，玩家照常读、照常行动；图到达时只填进已经占好的位置。

### 7.3 由 core 拼进提示词的固定内容

- **画风片段。** 预设的英文片段直接拼接；自定义画风由 §8 写进提示词。
- **固定要避开的内容：** 文字、字母、水印、签名、标志。服务支持负面提示词时写进负面提示词；不支持时写成正面的描述，例如 `no text or lettering anywhere in the image`。这一条由 core 拼接，不交给 LLM 临场发挥，因为画面里一出现文字，就可能写出主角还不知道的名字。
- **主角不入画时，** 加上第一人称视角、画面里没有主角的要求。

### 7.4 重画、不要这张图、文件找不到了

- **「重画」** 使用原段落的投影、已确定的比例和档位。原图有明确请求宽高时沿用该宽高。原图用「服务默认」时，在同一服务和模型上仍使用默认尺寸，界面说明实际像素以结果为准。服务能力匹配时沿用镜头描述及它引用的基础组和视角。支持 seed 时换一个 seed。旧图保持可读，成功后才替换，失败时在大图里显示原因。
- **规格不可用。** 服务不再支持本图规格时失败，提示可选规格。玩家可以为这一次重试或重画确认新的比例偏好和档位。新画面按新比例构图，成功替换时保持正文阅读位置。当前开局的设置和其他图片保持原值。
- **「不要这张图」** 对失败和画成的图都可用。把状态改为 `dismissed` 并取消本图的重画，界面收起这一处。没有其他记录引用的文件由清理回收。
- **文件找不到了：** 有人手动删了 `images/` 里的文件。读取时发现文件不在，返回 `image_file_missing`，界面显示「图片找不到了」和「重画」。

## 8. 镜头描述

镜头描述是一次模型调用，用 `background` 用途（[LLM 端点 §7](./llm-endpoints.md#7-用途分配)），经 `llm` 模块的 `complete()` 发出，不带任何工具。`background` 用途不要求模型支持工具调用，所以镜头描述也不用提案工具，而是让模型按固定格式输出纯文本，由 core 解析和校验。

**场景材料来自[数据模型 §5](./data-model.md#5-可见性规则)的段落投影：**

- 截至被标记段号的正文和主角可确认的场景材料。开场图只取段号 0 的投影结果。
- 可确认在画面中出现的人物，每人一行，包括短编号、该段已知的称呼、可见形象和是否为主角。没有确证的字段留空。

镜头要求另附画风、主角是否入画、当前规格允许的比例和参考图能力。自动比例时，模型按画面内容选构图，例如多人协作和地形关系适合横图，表现高度的动作适合竖图，线索近景可用方图。分辨率档由用户选择，core 按服务能力解析结果。作者的内容边界只作约束，其中涉及的事实不得带进画面描述或提示词。真名、秘密和幕后栏目不作为场景材料。

**每张图定格一个瞬间。** 先确定这段最值得画的动作、互动或变化，再选能把它画清楚的构图。人物与物件的互动要写明动作的主体、对象和当时的状态，例如一人伸手递出钥匙，另一人收回了手，钥匙仍在递出者手里。画协作或对峙时，写清各人的位置和身体朝向，有参考图时把人物和各自的参考图对应起来。手势、接触和视线重要时给足画面空间，线索可以用近景，位置关系重要时让环境入画。画面只呈现已发生、可观察的内容。待选行动的结果和人物尚未表露的内心留在画外。

模型输出以下四个字段。有多个比例可自动选择时另加 `ASPECT:`。每个字段单独一行：

| 标签 | 内容 |
| --- | --- |
| `PROMPT:` | 英文的正面提示词。参考人物写成 `{{ref:N}}`，N 对应 `REFS` 里的顺序。角色在实际画面里的视角另在提示词中指定 |
| `NEGATIVE:` | 英文的负面提示词。服务不支持负面提示词时留空 |
| `CAPTION:` | 用作品语言写一两句，说明画面里的动作、互动或可见细节，用作 alt 文字和大图下方的说明 |
| `REFS:` | 按画面主次写 `短编号:视角`，用逗号分隔。视角取 §6.2 的三个位置之一，无参考时留空 |
| `ASPECT:` | 只有多个比例可自动选择时填写。从给定的比例列表里选一个，例如 `3:4` |

生成正面时取稳定的外貌文字和画风。补齐其他视角时，core 按 §6.2 的固定构图引用正面图。主角形象的补写（§6.1）也走 `complete()`，输出只有一行形象文字。

校验：

- `refs` 里的编号都在场、不重复，视角有效，数量不超过上限。`prompt` 里的每个 `{{ref:N}}` 都有对应的参考人物。某个人物改用文字时，以该段投影中的外貌替换其引用，并同步调整其他引用的序号。
- 有多个比例可自动选择时，`ASPECT` 必须在该档的可用列表内。比例已确定时，core 使用确定的规格，模型多写的 `ASPECT` 不参与规格校验。比例和可选的实际宽高由 core 确定后再调用出图服务。
- **`PROMPT` 和 `NEGATIVE` 里不出现任何人物的真名**（实体表里的 `name`）。画面靠参考图和外貌描述来认人；真名一进提示词，模型就可能把它当成文字画进画面，而主角未必知道这个名字。称呼不在禁止之列：「撑伞的女人」「the old man」这类称呼本身就是外貌描述，禁掉会把正常的描写也拒掉。
- **`caption` 经过不泄露校验**（[回合循环 §6](./turn-loop.md#6-校验与保存)），以图所在段号的已知称呼为准。
- 缺标签、标签重复，或者校验不通过时，把逐条的错误附在下一轮请求里让模型重写，最多 2 次，仍不通过就以 `invalid_output` 失败。重写的次数和[回合循环 §6](./turn-loop.md#6-校验与保存)的修正次数相同。

提示词用英文，因为各家出图模型对英文最稳；画面说明是给玩家看的，所以用作品语言（[i18n §6](./i18n.md#6-作品语言)）。

## 9. 存储

### 9.1 目录

```
<数据目录>/images/
  blobs/<sha256>.<ext>
```

- 文件名取内容的 sha256，扩展名按实际类型取 `.webp`、`.png` 或 `.jpg`。相同内容全库只存一份。作品采用参考、预览归入开局和开局锁定参考都只写引用，避免复制多张大图。
- 归属和可见性由数据库中的记录决定。文件引用记录哈希、媒体类型、宽高和字节数，路径从哈希和媒体类型推出。移动数据目录时，一起带上 `library.db` 和 `images/`。

### 9.2 表

```sql
illustrations (
  id              TEXT PRIMARY KEY,
  turn_id         TEXT NOT NULL UNIQUE REFERENCES turns ON DELETE CASCADE,
  playthrough_id  TEXT NOT NULL REFERENCES playthroughs ON DELETE CASCADE,
  para            INTEGER NOT NULL,   -- 图放在第几段之后；0 = 第一段之前
  format_preference JSON NOT NULL,    -- 排队时的比例偏好和分辨率档位
  format          JSON,               -- 已确定的比例、档位和可选的请求宽高
  status          TEXT NOT NULL,      -- queued | running | done | failed | cancelled | dismissed
  stage           TEXT,               -- 失败时停在哪一步：wake | appearance | shot | portrait | generate | save
  caption         TEXT,               -- 画面说明，作品语言
  prompt          TEXT,
  negative_prompt TEXT,
  shot_capability JSON,               -- 写镜头描述时依据的比例列表、maxReferences、negativePrompt
  refs            JSON,               -- 镜头选中的人物 id 和视角
  reference_files JSON,               -- 已选的组 id、视角和文件引用，按实际请求顺序
  seed            INTEGER,
  service_id      TEXT,
  model           TEXT,
  file            JSON,               -- 文件引用
  error           TEXT,               -- 错误类别（§5.4）
  attempts        INTEGER NOT NULL DEFAULT 0,
  active_attempt_id TEXT,
  attempt_data    JSON,               -- 本次未完成的镜头描述、参考文件和调用参数
  created_at, updated_at
)

portrait_sets (
  id              TEXT PRIMARY KEY,
  work_id         TEXT NOT NULL REFERENCES works ON DELETE CASCADE,
  scope           TEXT NOT NULL,      -- work | pending | playthrough
  playthrough_id  TEXT REFERENCES playthroughs ON DELETE CASCADE,  -- 只在 scope = playthrough 时有值
  entity_id       TEXT,              -- 画风预览为空
  appearance_fact_id TEXT,           -- 可见身份的起点；基础形象为空
  appearance_hash TEXT NOT NULL,
  appearance      TEXT NOT NULL,      -- 参考组对应的形象原文
  style           JSON NOT NULL,      -- 自己生成参考图时所用的画风
  state           TEXT NOT NULL,      -- draft | active | retired
  draft_rev       INTEGER NOT NULL,
  slots           JSON NOT NULL,      -- 各视角的文件引用、导入或生成、待复核标记
  task            JSON,               -- 当前任务的尝试 id、位置、状态、错误及出图参数
  created_at, updated_at,
  CHECK (state IN ('draft', 'active', 'retired')),
  CHECK (
    (scope = 'work' AND playthrough_id IS NULL AND entity_id IS NOT NULL AND appearance_fact_id IS NULL)
    OR (scope = 'pending' AND playthrough_id IS NULL AND appearance_fact_id IS NULL AND state IN ('draft', 'active'))
    OR (scope = 'playthrough' AND playthrough_id IS NOT NULL AND entity_id IS NOT NULL AND state IN ('draft', 'active'))
  )
)
CREATE UNIQUE INDEX portrait_sets_active_work
  ON portrait_sets (work_id, entity_id, appearance_hash)
  WHERE scope = 'work' AND state = 'active';
CREATE UNIQUE INDEX portrait_sets_playthrough_identity
  ON portrait_sets (playthrough_id, entity_id, ifnull(appearance_fact_id, ''))
  WHERE scope = 'playthrough';
```

- 一个回合最多一张插图，所以 `turn_id` 唯一。作品按人物和对应形象选择一组已采用的参考。开局按人物和可见身份起点只登记一组基础参考。并发请求共用同一组和正在生成的正面。core 在写入事务里核对开局和作品归属，以及人物与可见身份起点是否属于该开局的投影范围。
- 采用时在事务中核对草稿修订号、归属和正面图片。作者采用或撤下参考时，还要核对当时看到的当前组 id，没有当前组时传空值。采用时把旧组标为 `retired`，再插入新的已采用快照。旧组文件引用保持不变。开局冻结作者组 id 和玩家选定的预览快照。预览快照只包含采用时就绪的视角，未完成的任务不能补写进去。形象哈希按文本去首尾空白、NFC 规范化后计算。
- 重试和重画登记本次尝试的 id，过程数据写入 `attempt_data`，包括用户为这次操作另选的规格。已有完成图时，保留 `done` 及原图的规格、说明、宽高和参考文件。结果落库时核对尝试 id，在同一个事务里更新这些字段。重画失败、停用、换服务或移除时撤销当前尝试。新图失败可保留该次已完成的步骤供重试，已有完成图仍使用其原有数据。
- 插图和参考图的提示词含有故事内容，只存在 `library.db` 里，不进诊断库（[运行诊断 §2](./diagnostics.md#2-运行事件)）。

### 9.3 写入顺序

1. 服务结果按 §5.3 校验。导入按 §6.2 校验。
2. 写进同一目录下的临时文件。校验和临时文件写入可与其他任务并行。
3. 进入与图片清理互斥的写入区间。先核对归属和草稿修订号或尝试 id，游玩任务另核对 §7.1 的启用条件。检查哈希文件是否已经就位，需要时把临时文件改成哈希文件名，再提交数据库引用。清理不能在哈希文件就位检查和引用提交之间运行。
4. 事务提交之后推送事件。

这样不会出现「记录说有图、文件却不在」的中间状态。崩溃发生在第 2、3 步之间时，最多留下一个没人引用的文件。

### 9.4 清理

- **时机。** core 启动或删除作品后清理。过期预览超过 `PORTRAIT_PREVIEW_TTL_DAYS`（默认 7 天）时删除预览记录，已存入开局快照的引用继续有效。
- **参考组。** 保留开局锁定的组、现有人物的已采用组和编辑草稿，以及未过期的预览。作者方案里尚未确认的人物项也算现有人物。已撤下或被替换的组，只在仍被开局或未移除的插图引用时保留。
- **文件。** 在 §9.3 的互斥区间里计算仍需保留的文件，再删除无引用且已超过 `IMAGE_GC_GRACE_MS`（默认 10 分钟）的文件。引用包括保留参考组、可查看或重试的插图、已登记的任务输入。多个开局或作品引用同一个文件时，删掉其中一个仍可从其他记录读取。
- **重启。** 运行中的插图或参考图任务标为失败，原因记为 `image_interrupted`。保留草稿里已导入或生成的图，也保留重画前的完成图。

### 9.5 体量

设置页显示插图和人物参考合计占用的空间。按仍有引用的哈希去重并汇总字节数，无引用的待清理文件不计入。

## 10. 交给 client

- **取图是一个 oRPC 过程。** `image.file` 接收图片标识和视图来源。插图以插图 id 标识，参考图以组 id 加位置标识。作品编辑和开局预览传作品 id，游玩传路线 id。core 只返回对应视图可以看到的图片：编辑页核对作品归属，开局预览核对预览所属作品，游玩核对该路线可见的回合插图或手记投影实际返回的参考图位置。存储哈希留在 core。响应带正确的 `Content-Type` 和 `X-Content-Type-Options: nosniff`。
- **client 带令牌取图，再转成 blob URL 交给 `<img>`。** `<img src>` 带不了 `Authorization` 请求头，所以不能直接写接口地址。为此内容安全策略的 `img-src` 加上 `blob:`（[架构总览 §2.1](./architecture.md#21-本机接口的安全)）。
- **client 在内存里按视图来源、记录 id、位置和更新时间缓存最近用过的 blob URL。** 记录更新后取新图。回合卸载或缓存淘汰时调用 `URL.revokeObjectURL`。
- **手记缩略图由 core 选。** 主角见过的人物才可能返回当前路线可见基础组的正面位置。形象变化但身份可延续时，仍可显示基础组正面。欠缺可见参考时省略缩略图（[数据模型 §5](./data-model.md#5-可见性规则)）。
- **回合视图里的插图**提供 id、更新时间、状态、是否在重画、段号、已确定的规格、实际宽高、画面说明和错误类别。尚无完成图时，使用当前尝试已确定的规格留画框。重画成功后才切换完成图的规格。提示词留在 core。
- **服务的唤醒状态**随 `image.services.list` 返回：已就绪、连不上、唤醒中、等待用户操作（附操作地址）、唤醒失败。排队中的插图、参考图和画风预览据此显示「正在唤醒出图服务」或「等待你完成授权」。
- **事件。** `illustration.updated`、`portrait.updated`、`image.config_changed` 和 `image.service_state` 让 client 刷新相关查询。人物参考组变更通知只带作品 id，图片标识和详情由可见视图的查询返回。状态以查询结果为准，见[架构总览 §3](./architecture.md#3-client-与-core-的通信)。

插图和人物参考的操作都是 oRPC 过程。文件录入使用 oRPC 的 multipart 请求。有副作用的过程带幂等键，双击和网络重发只生效一次。见[架构总览 §3](./architecture.md#3-client-与-core-的通信)和 [oRPC 运行要求](https://orpc.dev/docs/requirements)。

| 过程 | 作用 |
| --- | --- |
| `illustration.retry` | 从失败的那一步继续。规格不可用时可以带用户选定的新规格（§7.2、§7.4） |
| `illustration.reroll` | 重画时沿用原图规格，规格不可用时可以带用户选定的新规格（§7.4） |
| `illustration.dismiss` | 不要这张图（§7.4） |
| `portrait.draft` | 读取或建立作者的人物参考草稿、玩家的开局预览草稿。返回组 id、修订号、位置和任务状态 |
| `portrait.upload` | 带令牌的 oRPC multipart 输入，一次传一个 `File`，并带草稿 id、位置、预期修订号和请求 id。在解包前限制请求体大小，文件按 §6.2 校验 |
| `portrait.generate` | 按草稿 id、位置、预期修订号和所选规格生成或重画。补齐视角逐张登记，任务结果可以按位置重试 |
| `portrait.update` | 移除草稿中的图片或确认待复核的视角。核对预期修订号 |
| `portrait.adopt` | 采用时按预期草稿修订号固定已复核图片。作者的采用和撤下命令另带预期当前组 id。玩家选定预览快照时只核对预览草稿 |
| `portrait.preview` | 创作页和开局页用固定题材预览画风，返回独立的预览 id |
| `play.suggestAppearance` | 开局页的「按设定写一个」：用可公开的主角外观设定起草形象文字，只返回文字 |

`play.start` 的输入带本局是否出图、画风、比例偏好、分辨率档、主角是否入画和主角形象。选过主角参考时带预览快照 id。预览快照已过期或条件变化时，开局照常，按 §6.2 选择可用参考。试玩开局使用同一套规则（[数据模型 §3](./data-model.md#3-经历开局回合树路线存档)）。

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
- 插图的事件和计时样本见[运行诊断 §2.1](./diagnostics.md#21-错误提示与诊断编号)和[§3](./diagnostics.md#3-性能样本)。按路线记录的 narrator 标记率用于检查出图频率。

## 12. 按需启动

### 12.1 定位

有的出图服务平时关着，用到时才开，例如按计算单元计费、跑在 Colab 上的 GPU。core 不直接开关这类服务，而是调用一个**启动器**：实现 `unwritten-launcher/1` 的插件，例如 [Colab 启动器](./colab-launcher.md)。

- **启动器只负责开和关。** 服务开没开好，core 仍然向服务本身确认（§3.2），启动器只报告运行时走到了哪一步。
- **只有 `unwritten-image` 服务能配启动器。** OpenAI 图像接口是常开的云服务，用不到它；模型服务不做按需启动的理由见 §13。
- **core 不认识启动器背后的平台。** 唤醒、等待用户操作、失败，都只按协议的状态处理。

### 12.2 启动器协议 `unwritten-launcher/1`

协议遵守[插件 §3](./plugins.md#3-协议的共同规则)的全部共同规则。本节只写启动器独有的部分。

**`GET /v1/info`** 返回共同字段。未就绪的原因有两种：`not_configured`（启动器缺少配置）和 `not_signed_in`（启动器调用的平台还没有登录）。`capabilities` 目前没有字段。

**`GET /v1/state`**：

```json
{ "state": "needs_action", "reason": null, "action": { "url": "https://...", "expiresAt": "<Unix 秒数>" }, "since": "<Unix 秒数>" }
```

| `state` | 含义 |
| --- | --- |
| `stopped` | 服务没有运行 |
| `starting` | 正在开运行时、复制文件、启动服务 |
| `needs_action` | 要用户在浏览器里打开 `action.url` 完成一步操作，例如授权。过了 `action.expiresAt` 还没继续，就转为 `failed` |
| `running` | 运行时已经开好，服务进程已经启动。服务是否就绪，由 core 问服务本身 |
| `stopping` | 正在关闭 |
| `failed` | 这次启动失败。`reason` 取 `quota`（平台没有可用的额度或加速器）、`not_signed_in`、`action_expired`、`start_error` 之一 |

`since` 是进入当前状态的时刻，Unix 秒数。

| 请求 | 作用 |
| --- | --- |
| `POST /v1/start` | 请求体 `{ "idempotencyKey", "idleMinutes" }`。已在 `starting`、`needs_action`、`running` 时什么也不做；在 `stopping` 时，等关闭完成再启动。返回 202 和当前状态 |
| `POST /v1/continue` | 请求体 `{ "idempotencyKey" }`。用户完成了 `action.url` 上的操作。不在 `needs_action` 时返回 409 `invalid_state` |
| `POST /v1/stop` | 请求体 `{ "idempotencyKey" }`。已经停止时什么也不做。返回 202 |

- `idleMinutes` 是 5 到 720 之间的整数，由启动器交给服务一侧的看护循环（§12.4），否则返回 400 `invalid_request`。
- 错误码在共同错误码之外只多一个 `invalid_state`（409）。
- `action.url` 必须是 `https` 地址。core 收到别的协议时把这次唤醒记为失败，不交给 client。

### 12.3 core 怎样唤醒

- **两种时机。**
  - 预热：client 进入一个满足 §7.1 启用条件的开局时调用 `image.prewarm`。
  - 按需：出图任务（插图、参考图、画风预览）从队列里取出时，服务连不上。
- **先探测，再唤醒。** 服务的 `/v1/info` 能连上时什么也不做。连不上时，向启动器发 `start`，带上这个服务的 `idleMinutes`。
- **同一个服务同时只有一次唤醒。** 预热和多个任务碰在一起时，共用这一次唤醒，排队的任务都等它。
- **等待。** 每隔 `IMAGE_WAKE_POLL_MS`（默认 5000）读一次启动器的状态。到了 `running` 以后，改为探测服务的 `/v1/info`，直到它报告就绪。服务报告未就绪、原因又不是 `starting` 时（例如自检时显存不够），不再等下去，唤醒以对应的错误结束，例如 `image_out_of_memory`。整个唤醒最长 `IMAGE_WAKE_TIMEOUT_MS`（默认 1800000，可配置），等用户操作的时间也算在里面。
- **等待用户操作。** 状态为 `needs_action` 时，core 推送 `image.service_state`，带上操作地址。client 显示一条不会自动消失的提示，写着「出图服务需要你在浏览器里完成授权」，带「打开授权页」和「继续」两个按钮。「打开授权页」在系统浏览器里打开地址；「继续」调用 `image.wake.continue`，由 core 向启动器发 `continue`。
- **失败。**
  - 启动器连不上时，返回 `image_launcher_offline`；返回 401 时，返回 `image_launcher_unauthorized`。
  - 启动器报告 `failed` 时，返回 `image_wake_failed`，并附上原因。
  - 超过 `IMAGE_WAKE_TIMEOUT_MS` 时，返回 `image_wake_timeout`，并向启动器发一次 `stop`。启动器报告 `running`、服务却一直连不上时，就是这种情况：运行时没开好，留着只会白白消耗计算单元。
  - 在等的任务都以 `wake` 这一步失败。玩家点「重试」会重新唤醒。
- **停用时。** 关闭自动出图或换了服务时，按 §7.1 取消在等的游玩任务。已经发出的唤醒不撤回，服务开好后没有请求，到时自己关闭。

### 12.4 空闲关闭

- **由服务一侧计时。** 唤醒时，core 把 `idleMinutes` 经启动器交给服务一侧的看护循环。连续这么久没有出图请求，服务就关闭自己，启动器随后收尾（[Colab 启动器](./colab-launcher.md)）。
- **只算出图请求。** 插图、参考图、画风预览都算。core 的探测和测试连接不算，文字生成也不算。
- **为什么不由 core 计时。** Mac 睡眠或 core 退出时，core 发不出关闭请求；服务一侧计时，照样能关。
- **改了空闲分钟数，下次唤醒时生效。**

### 12.5 一致性测试

`packages/core/src/image/launcher/conformance/` 逐条覆盖 §12.2 和插件协议的共同规则：缺令牌和错令牌被拒、`/v1/info` 字段齐全、状态的转换、`continue` 在错误状态下返回 `invalid_state`、`action.url` 只用 `https`。运行方式见[插件 §3.6](./plugins.md#36-一致性测试)，环境变量是 `UNWRITTEN_LAUNCHER_CONFORMANCE_URL` 和 `UNWRITTEN_LAUNCHER_CONFORMANCE_TOKEN`。对着真实的启动器运行时，会真的开一个运行时，消耗计算单元。

## 13. 不做的事

- **载入 core 的代码插件。** 理由见[插件 §1](./plugins.md#1-什么是插件)。
- **其他协议的适配器**，例如 Gemini、A1111、阿里云百炼。这些服务可以在前面加一层实现 Unwritten 图像协议的代理来接入。
- **按路线设置插图配额。** 每回合至多一张，由 narrator 按 §7.1 标记。
- **离线后自动补画。** 没配启动器的服务连不上时直接失败，由玩家手动重试，免得服务回来后积压的图一口气画出来。配了启动器时，唤醒期间新来的任务在队列里等，之前已经失败的图仍然等玩家手动重试。
- **模型服务的按需启动。** 回合要等冷启动的十几分钟，还要改模型调用 120 秒的超时规则；出图可以降级，不挡正文，所以先只给出图服务做。
- **由 core 按空闲时长关闭服务，以及设置页的「立即关闭」。** 空闲关闭由服务一侧计时（§12.4），Mac 睡眠或 core 退出时照样生效。core 只在唤醒超时后发一次 `stop`，收回没开好的运行时。
- **生成进度的百分比。** OpenAI 图像接口不报告进度，占位符保持安静，只写「正在画这一幕」。
- **服务端的原生画风**，例如把「水彩」对应到服务器上的一个 LoRA。画风预设要和服务器上装的模型一一对应，复杂度明显上升。
- **生成独立的缩略图文件。** 手记里的缩略图直接把当前可见的正面图缩小显示。导入时的格式整理见 §6.2。
- **候选的插图、游玩中途改画风、手动「画这一幕」、插图的图集和导出、按作品单独指定出图服务。**

## 14. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 新作品，未配置出图服务 | 只写一句背景，再开局和游玩 | 创作和开局页没有出图入口，正文和行动可用 |
| 伪出图服务已接入，自动出图已开启，开场有已公开的初始处境 | 开局，再玩到 narrator 标记了关键一刻的回合 | 开场第一段之前和被标记的段落之后各出现一个占位。图到达后填进占位，正文和阅读位置不动 |
| 服务的横图和竖图都有 1K | 选择自动比例和 1K，伪镜头模型依次给出横图和竖图 | 两次请求分别使用各自比例的 1K 宽高。选比例前只显示一行状态。留出画框和到图时，阅读位置保持 |
| OpenAI 自定义尺寸启用，玩家选了 720 自动比例 | 让镜头模型先选方图，再修正为 16:9 | 方图不在该档的候选列表。出图服务只收到一次 1280×720 的请求 |
| 用户固定竖图，镜头模型多返回了横图的 `ASPECT` | 查看伪服务收到的出图请求 | 一次镜头调用即可使用用户选定的竖图，发出的比例和尺寸仍是用户的选择 |
| 老插件只公布比例 | 选择「服务默认」画图并重画 | 请求都带该图的原比例，均省略 `size`。完成图显示实际宽高 |
| 开局表单打开后服务移除了 2K | 用表单中仍选中的 2K 开始故事 | 正文正常打开。调用镜头模型前识别不支持的规格，提示单张重试时可另选，排队记录仍保留玩家原选择 |
| 一张已完成的横图正在按原尺寸重画 | 让服务返回不同的像素尺寸 | 以 `image_invalid_response` 失败，旧图、画框和尺寸保持原值 |
| 一致性测试 | 对伪服务和真实插件分别运行 | 都通过；对一个不校验令牌的服务运行时失败 |
| 出图服务返回一张 SVG，或一个超过 20 MB 的文件 | 等这张图 | 以 `image_invalid_response` 失败，`images/` 里没有这个文件 |
| 出图服务的地址返回 302，指向另一台测试主机 | 测试连接，或画一张图 | 以 `image_redirected` 失败，另一台主机没有收到任何请求 |
| 服务在最近的连接探测中已确认离线 | 连续玩到两个有有效插图标记的回合 | 两处都很快显示失败和「重试」。服务上线后点「重试」能画成 |
| 一张正文插图在最后的出图调用处失败 | 点「重试」 | 复用镜头描述和参考图，只重新生成正文插图 |
| 两位人物都入画，第一位没有可见参考，第二位有 | 生成插图并查看伪服务实际收到的请求 | 第一位用当时可见的外貌文字，第二位是 `{{ref:1}}`。数组第一张是第二位的图片 |
| 第 2 段图已生成，第 5 段才揭晓人物身份并出现新地点 | 查看发出的提示词、参考图和说明，再在存档分出的路线重画 | 各处都只使用第 2 段时可见的形象、地点和称呼 |
| 正文写一人递出钥匙、另一人收回手，下一段才有人接过钥匙 | 让 narrator 标记递出钥匙的段落，查看发出的提示词和画面说明 | 明确谁递出、谁收回手，钥匙仍在递出者手中。下一段的动作不进入镜头 |
| 一张正在画、一张排队、一张已完成 | 关闭自动出图，再等在画的服务返回结果 | 占位收起，排队请求没有发出，迟到的结果不被采用，已完成的图仍可查看 |
| 已完成的图正在重画 | 点「不要这张图」，再等待重画结果 | 这处图收起。重画结果到达后，重新进入路线仍看不到这张图 |
| 付费服务收到请求后断开连接 | 等待状态更新 | 本次请求只发出一次，界面说明可能已计费，由用户决定是否重试 |
| 已选定主角参考快照，随后只改画风 | 开局并等主角首次入画 | 发出的请求沿用已选图片，提示词使用本局画风 |
| 已选定主角参考快照，随后改了主角形象 | 开局并等主角首次入画 | 正文照常打开，引用已切换为与新形象匹配的参考 |
| `background` 用途配的是一个不支持工具调用的模型 | 玩到一个标记了插图的回合 | 镜头描述照常写成，插图照常画出 |
| narrator 在一次换一种发展的候选里标了插图 | 打开比较，再采用候选 | 比较时候选没有占位。采用之后出现占位并开始画。原版回合上的图仍在原版上 |
| JPEG 带拍摄位置、方向和原始文件名 | 未配置服务时导入正面，再配置服务并用这组出图 | 预览方向正确。导入只经本机接口，外发只有处理过的参考图，没有原始文件名或 EXIF |
| 浏览器的 Canvas 编码回落到 PNG | 导入参考图并出图 | core 保存静态 PNG，出图请求带 `image/png` 和有效图片字节 |
| 同一个草稿正在重画正面 | 导入新正面，让旧生成任务稍后返回，再采用新组 | 旧任务无法覆盖新正面。未复核的斜侧脸和全身未被采用 |
| 两个页面都看到同一个已采用组 | 在一页采用新组，再从另一页撤下旧组 | 第二次操作返回过期，已采用的新组仍在 |
| 一张完成图正在重画，新服务生成了不同的画面说明 | 让生成失败，再查看旧图 | 旧图、说明、宽高和参考文件都还是同一次完成记录的数据 |
| 共享哈希文件已超过清理保护期，暂时没有引用 | 用相同字节录入参考，并在去重检查时请求清理 | 新参考提交后实际可读，清理不会造出悬空引用 |
| 作者已经采用一组参考，并用它开过一局 | 替换正面并采用新组，开新局，再重画旧局的图 | 新局用新组，旧局重画用原组。两次请求都按各自镜头选择视角 |
| 两部作品分别引用同一图片 | 删除其中一部并执行清理 | 另一部仍能读图。两个引用都撤销且达到清理时间后，文件才被回收 |
| 一条路线见过某人，另一条路线只听说过他，两条共用同一次开局 | 查看两条手记，再用已见路线的参考图标识从另一条路线取图 | 已见路线能取可见正面，另一条路线的手记没有该图位置，直接取图也被拒绝 |
| 源码里写一个 `comfy` 字样的分支 | 运行测试 | 扫描源码的测试失败 |
| `providers.json` 是版本 1 | 启动 core，从界面添加一个出图服务 | 读取正常；保存后文件是版本 2，旧文件存成 `providers.json.bak` |
| 服务配了伪启动器，服务关着 | 进入一个开了插图的开局 | 启动器收到一次 `start`，带着这个服务的 `idleMinutes`；服务就绪后，开场图开始画 |
| 服务配了伪启动器，服务关着，同时排着三张图 | 等唤醒完成 | 启动器只收到一次 `start`；三张图按顺序画成 |
| 伪启动器在唤醒途中转为 `needs_action` | 在提示里点「继续」 | 提示消失，启动器收到 `continue`，唤醒接着进行 |
| 伪启动器返回 `action.url` 为 `http` 地址 | 等唤醒 | 以 `image_wake_failed` 失败，client 收不到这个地址 |
| 伪启动器一直停在 `starting` | 等过 `IMAGE_WAKE_TIMEOUT_MS` | 在等的插图以 `image_wake_timeout` 失败，启动器收到一次 `stop`；玩家点「重试」会重新唤醒 |
| 伪启动器报告 `running`，伪服务报告未就绪，原因是 `out_of_memory` | 等唤醒 | 唤醒很快以 `image_out_of_memory` 结束，不等到超时 |
| 启动器没有运行 | 玩到一个标了插图的回合 | 很快以 `image_launcher_offline` 失败，正文照常 |
| 没配启动器的服务连不上 | 玩到一个标了插图的回合 | 照旧快速失败，不发出任何唤醒请求 |
