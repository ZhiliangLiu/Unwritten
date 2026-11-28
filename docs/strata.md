# Unwritten · Strata 自建模型服务

本文说明 `selfhost/strata/`：怎样在 Colab 或自己的 GPU 机器上运行 [Strata](https://github.com/Niko1221/Strata)，让 core 把它当作一个 OpenAI 兼容的自定义端点来调用。Colab 上的资源检查、Drive、Tailscale 和空闲释放见 [Colab 宿主](./colab-host.md)；core 怎样配置和调用模型服务见 [LLM 端点](./llm-endpoints.md)。

一句话概括：**Strata 只监听回环地址，对外只有一层网关；网关只放行 core 用到的两个接口。**

## 1. 定位

- **它不是插件。** 插件实现 Unwritten 定义的协议（[插件 §1](./plugins.md#1-什么是插件)）。Strata 本身就提供 OpenAI Chat Completions，core 按 [LLM 端点 §6](./llm-endpoints.md#6-自定义端点) 把它当作自定义端点调用，一行不用改。
- **它仍然履行插件的义务**（[插件 §4](./plugins.md#4-插件的义务)）：对外面最小、调用方只能填参数、每个输入都有上限、不留下用户内容、供应链钉死、启动自检。这些由本目录的运行参数和网关做到，见 §4–7。
- **core 不认识它。** 设置页没有 Strata 的预设，core 也不按地址或模型 id 识别它。`apps/` 和 `packages/` 里不出现 `strata` 这个名字，由扫描源码的测试检查（[插件 §2](./plugins.md#2-边界)）。
- **Strata 是什么。** MIT 许可的本地推理引擎：C++/CUDA 写的引擎，加一个 Python 服务，提供 OpenAI Chat Completions（流式、工具调用）和 Anthropic Messages 两种接口。它把 MoE 模型的专家权重放在内存里，其余放在显存里，所以单卡也能跑比显存大得多的模型（Strata `README.md`、`docs/MODELS.md`）。

## 2. 目录

```
selfhost/strata/
  README.md            入口地图：它是什么、在 Colab 和本机上怎样运行
  pyproject.toml       Python 版本，ruff、pytest 的配置
  uv.lock              开发依赖的锁定版本
  requirements.txt     在 Colab 上安装用，由 uv 从锁定文件导出
  strata.lock.json     Strata 的发布版本、发布目录地址和配套的引擎版本
  models.lock.json     每个模型文件的仓库、commit、路径、大小和 sha256
  gateway/             网关（§6）
  colab_service.py     对 Colab 宿主的约定（§8）
  colab.ipynb          Colab 笔记本，只放代码
  tests/               pytest，带一个伪 Strata
```

网关只用 aiohttp 和 Python 标准库。目录里的 README 按[根目录 AGENTS.md §9](../AGENTS.md#9-源码目录的-readme) 只做入口地图，设计细节都在本文。

## 3. 运行结构

```
tailscale serve（Colab）或本机的 core
        │
        ▼
网关，监听 127.0.0.1:8191        校验令牌、只放行两个接口、限制输入、写状态文件
        │  换成内部 key
        ▼
Strata，监听 127.0.0.1:8080
```

- **Strata 用 `--access local`，只监听回环地址。** 网关的端口由 `UNWRITTEN_LLM_PORT` 配置，默认 8191。
- **网关和 Strata 之间用另一把 key。** 每次启动时随机生成一把内部 key，只交给 Strata 和网关。用户的令牌到网关为止，Strata 收不到它。

## 4. Strata 与模型

- **版本钉死。** `strata.lock.json` 写明 Strata 的发布版本、发布目录地址 `https://github.com/Niko1221/Strata/releases/download/v<版本>`，以及这个版本配套的引擎版本。Strata 的发布版本和引擎版本各自编号（Strata `docs/INSTALL.md`）。
- **安装。** Strata 的安装脚本默认取最新的发布目录，`STRATA_FEED` 可以换成别的目录。所以安装时把它指向锁定的发布目录。脚本按安装清单核对安装包的 SHA-256，再检查发布目录的签名。之后 `strata launch` 从同一个发布目录取适合这块显卡的引擎，检查签名、试启动成功后才使用（Strata `docs/TERMINAL_LAUNCH.md`）。用 `STRATA_FEED` 钉版本是从安装脚本推断出来的做法，Strata 的文档没有写明，由 §14 的验收确认。
- **关闭更新检查。** 运行时设 `STRATA_UPDATE_CHECK=0`。Strata 没有遥测（Strata `docs/SAFETY.md`）。
- **模型用 Qwen3.8-Flash-Next 的 Q2_0。**
  - 来源：Hugging Face 上的 `ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF`，下载约 66 GB。它是 Strata 推荐的那组量化里最小的一档。
  - 内存：Strata 的模型说明写明，内存至少要有专家权重的大小再加约 10 GB，48 GB 内存放得下 Q2_0（Strata `docs/MODELS.md`）。
- **模型文件钉版本。** `models.lock.json` 写明每个文件的仓库、commit、路径、大小和 sha256，由宿主下载、核对和缓存（[Colab 宿主 §8](./colab-host.md#8-笔记本的步骤)）。Strata 第一次启动时会另外下载附属文件，例如 MTP 草稿层（Strata `docs/MODELS.md`）。这些文件也列进清单，放到 Strata 查找它们的位置。漏列或放错位置的文件，每次冷启动都会重新下载，由 §14 的验收检出。
- **许可。** Strata 本身是 MIT 许可，模型文件各自适用模型卡上的许可，Strata 不代为授权。README 第一段链接到模型卡，部署者下载前自行确认。
- **Q2_0 是约 2 bit 的量化。** 写作质量和工具调用的稳定性，由评测确认（§14）。

## 5. 运行参数

```
STRATA_UPDATE_CHECK=0 STRATA_INTERNAL_KEY=<内部 key> strata launch \
  --family qwen --model q2_0 --model-path <本地模型目录> --data-dir <本地数据目录> \
  --access local --port 8080 --context 65536 --parallel 1 --vision off \
  --api-key-env STRATA_INTERNAL_KEY --yes --no-tui
```

| 参数 | 为什么 |
| --- | --- |
| `--access local` | 只监听回环地址。对外入口由网关和宿主的 `tailscale serve` 负责，不用 Strata 自带的 `lan`、`cloudflare`、`tailscale` 方式 |
| `--context 65536` | 上下文长度固定，Unwritten 里这个模型的上下文窗口填同一个数（§9）。默认值，在 `colab_service.py` 里可配置 |
| `--parallel 1` | 一次只解码一个请求，显存和内存的占用可预测。同时到达的请求在 Strata 里排队，等待超时时返回 429（Strata `docs/DETAILS.md`），core 按限流处理 |
| `--vision off` | core 不给模型发图片，所以关掉视觉输入。网关另外拒收图片内容块（§6） |
| `--api-key-env STRATA_INTERNAL_KEY` | 用内部 key（§3） |
| `--yes --no-tui` | 无人值守启动，Strata 在后台运行 |
| 不配置 MCP，不开 `api_monitor` | MCP 工具以运行用户的权限执行；`api_monitor` 会把最近的请求和回答留在内存里（Strata `.github/SECURITY.md`、`docs/DETAILS.md`） |
| 不开 `lazy_load` | 启动时就加载模型，由自检（§7）顺带预热。懒加载会让第一个请求承担整个加载时间，可能超过 core 等待首个输出的 120 秒（[LLM 端点 §8](./llm-endpoints.md#8-调用预算与错误)） |

## 6. 网关

| 方面 | 怎么做 |
| --- | --- |
| 鉴权 | 一个 aiohttp 中间件拦在所有路由前面，用 `hmac.compare_digest` 比较 `Authorization: Bearer` 里的令牌。令牌来自环境变量 `UNWRITTEN_LLM_TOKEN`，短于 32 个字符时拒绝启动。不匹配时返回 401 |
| 只放行两个接口 | `GET /v1/models` 和 `POST /v1/chat/completions`。其余方法和路径一律返回 404，请求不转给 Strata。这样，Strata 凭 key 就能访问的 `/settings`、`/config`、`/load`、`/mcp`、`/slots` 和网页界面都挡在外面 |
| 请求体 | `client_max_size` 设为 `LLM_GATEWAY_MAX_BODY_BYTES`（默认 8 MiB，可配置），超出的请求不读完就拒绝。请求体必须是 JSON 对象。`messages` 里的内容只能是文本，带图片、音频或文件内容块的请求返回 400 |
| 转发 | 换上内部 key 转给 Strata，只带 `Content-Type` 和 `Accept`，不转发其他请求头。响应按块原样转回，流式响应不缓冲。到 Strata 的请求不设总时长上限，等待首个输出和中途停顿的超时由 core 负责（[LLM 端点 §8](./llm-endpoints.md#8-调用预算与错误)）。aiohttp 客户端默认的总时长上限会截断长回答，所以显式关掉 |
| 取消 | 调用方断开连接时，网关立即关闭到 Strata 的连接 |
| 重定向与 CORS | 不跟随重定向，Strata 返回 3xx 时以 502 回应；去掉响应里所有 `Access-Control-*` 头 |
| 就绪 | 自检（§7）通过之前，这两个接口返回 503。网关从启动起每隔 `STRATA_HEALTH_INTERVAL_S`（默认 60 秒）查一次 Strata 的 `GET /health`。连不上时转为未就绪，原因是 `engine_down`，加载途中也是这样，所以 Strata 在加载模型时退出，不会一直显示 `starting`。重新连上后，自检还没通过就回到 `starting`，已经通过就回到就绪 |
| 未就绪的原因 | `starting`（启动、加载或自检中）、`load_timeout`、`self_test_failed`、`engine_down`，含义见 §6 和 §7 |
| 状态文件 | 按 [Colab 宿主 §4](./colab-host.md#4-宿主与服务的约定) 写 `/tmp/unwritten-strata.state`，未就绪的原因原样写入 |
| 错误格式 | OpenAI 的 `{ "error": { "message", "type", "code" } }`。core 按状态码分类（[LLM 端点 §8](./llm-endpoints.md#8-调用预算与错误)） |
| 日志 | 只记方法、路径、状态码和耗时，不记请求体、响应体和请求头 |

## 7. 自检

- **自检请求是固定的：**
  - 一句不含故事内容的话；
  - 一个 `ping` 工具，只有一个字符串参数，并要求模型调用它；
  - 流式输出，`reasoning_effort: "none"`。

  收到合法的 `ping` 调用，才报告就绪。这一个请求同时验证了内部 key、流式转发和工具调用。自检请求直接调用网关的转发逻辑，不经过对外接口的就绪闸门。
- **反复尝试，直到成功或超时。** 网关启动后就开始发自检请求，每隔 `STRATA_HEALTH_INTERVAL_S` 一次，每次最多等这么久。模型还在加载时请求会失败或超时，原因保持 `starting`；`/health` 连不上时，以 `engine_down` 为准。自检只依赖 chat 接口本身，不依赖 Strata 文档没写全的加载状态字段。
- **超过 `STRATA_LOAD_TIMEOUT_S`（默认 1800 秒，可配置）仍未成功，就停止重试。** 最后一次尝试拿到了完整的回答、但里面没有合法的 `ping` 调用时，原因写成 `self_test_failed`；否则写成 `load_timeout`。`ready` 保持 false，进程不退出，看护循环每分钟打印原因。设置页的测试连接收到的是 503，按 [LLM 端点 §8](./llm-endpoints.md#8-调用预算与错误) 显示「连不上模型服务」，看不到具体原因。
- 自检同时完成预热，第一个正式请求不再等冷启动。

## 8. 在 Colab 上运行

对 [Colab 宿主](./colab-host.md#4-宿主与服务的约定)的约定：

| 约定 | 取值 |
| --- | --- |
| 名称 | `strata` |
| 节点名和标签 | `unwritten-llm`、`tag:unwritten-llm` |
| Secrets | 令牌 `UNWRITTEN_LLM_TOKEN`，认证 key `TS_AUTHKEY_LLM` |
| 显存下限 | 12 GB。Strata 给出的 Q2_0 运行数据来自一块 12 GB 显存的显卡（Strata `docs/DETAILS.md`），这里取它作下限。默认值，在 `colab_service.py` 里可配置 |
| 内存下限 | 48 GB（§4） |
| 磁盘下限 | 按宿主的规则，由 `models.lock.json` 算出 |
| 对外端口 | 网关的 8191 |
| 状态文件 | `/tmp/unwritten-strata.state` |

- **准备：** 安装 `requirements.txt` 里网关的依赖，再按 §4 安装钉死版本的 Strata。模型由宿主放到本地模型目录。`--data-dir` 指向本地磁盘上的目录。
- **启动：** 生成内部 key，按 §5 启动 Strata，再启动网关，令牌和内部 key 都经环境变量传入，然后返回网关进程。`strata launch` 本身返回失败时，启动就此停下，打印它的输出。Strata 用 `--no-tui` 在后台运行，不是笔记本的子进程，它是否健康由网关检查（§6）。

## 9. 在 Unwritten 里接上

1. 在 Mac 上用 `openssl rand -hex 32` 生成令牌，存进 Colab Secrets 的 `UNWRITTEN_LLM_TOKEN`。
2. 运行笔记本，等它打印服务地址和「就绪」。
3. 设置页 → 模型服务 → 添加自定义端点：
   - 协议选 `openai-completions`；
   - 地址填 `https://unwritten-llm.<tailnet 名>.ts.net/v1`；
   - key 填同一个令牌，也可以写成 `$UNWRITTEN_LLM_TOKEN`，从环境变量读取（[LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)）。
4. 点「查找模型」，勾选列出的模型，再填能力字段：
   - 上下文窗口填 65536（§5）；
   - 推理填「是」；
   - 思考写法选 `openai`，因为 Strata 认的字段是 `reasoning_effort`（Strata `docs/DETAILS.md`）。
5. 点「测试连接」，确认它支持工具调用，再按需分配用途。

- **思考档位只用关闭、`low`、`medium`、`high`。** Strata 的 `reasoning_effort` 只有 `none`、`low`、`medium`、`high` 四档。
- **给用途明确设上思考档位。** 用途没设档位时，请求里不带思考字段（[LLM 端点 §7](./llm-endpoints.md#7-用途分配)），Strata 就按模型自己的默认值 `high` 思考（Strata `docs/DETAILS.md`），每个回合都会明显变慢。
- **只有一个解码槽位。** narrator 和 background 都分给它时，回合摘要、镜头描述都要和 narrator 排队。
- **地址只填一次。** 节点身份保存在 Drive 上（[Colab 宿主 §6](./colab-host.md#6-drive)），重开运行时地址不变。自定义端点的地址保存后也不能改（[LLM 端点 §6](./llm-endpoints.md#6-自定义端点)）。

## 10. 在本机运行

在一台有 NVIDIA 显卡、内存足够的电脑上，按 §4 安装，按 §5 启动 Strata，再启动网关，不需要笔记本。

- core 和 Strata 在同一台机器上时，地址填 `http://127.0.0.1:8191/v1`。这是回环地址，不会出现明文 http 的警告。
- Strata 在另一台机器上时，用 Tailscale Serve 把请求转发到该机网关的回环地址，访问控制的写法同 [Colab 宿主 §9](./colab-host.md#9-tailscale-的访问控制)。
- Strata 的日志如果写入提示词，会留在这台机器的磁盘上（§12）。

## 11. 开发与测试

- **工具：** 用 uv 管理开发环境和锁定文件，用 ruff 做 lint 和格式化，用 pytest 跑测试（[技术选型 §3](./tech-stack.md#3-仓库与工具链)）。
- **不写注释。** 根目录 AGENTS.md 的规矩对 Python 一样适用，笔记本也只放代码。
- **伪 Strata。** `tests/` 里有一个 aiohttp 写的伪 Strata，实现 `/health`、`/v1/models` 和 `/v1/chat/completions`（流式和非流式，带工具调用），并记下自己收到的请求。用它测试：
  - 令牌校验；
  - 只放行两个接口，被拒的请求没有到达伪 Strata；
  - 请求体上限，以及非文本内容块被拒；
  - 换成内部 key，其他请求头被过滤；
  - 流式响应不缓冲；
  - 调用方断开后，上游连接被关闭；
  - 3xx 变成 502，CORS 头被去掉；
  - 日志里没有请求内容；
  - 状态文件的变化；
  - 自检的重试、超时，以及 `load_timeout` 和 `self_test_failed` 两种结果。
- **`pnpm test:python`** 跑网关的 pytest。这条命令不进 `pnpm test`，因为它要求本机装有 uv。

## 12. 已知限制

- **Colab 回收运行时，模型服务就中断。** 出图服务离线时，只是插图失败。Strata 承担 narrator 时，运行时一被回收，回合就停在「连不上模型服务」（[LLM 端点 §8](./llm-endpoints.md#8-调用预算与错误)）。要恢复，就重新运行笔记本，或者在用途分配里换一个端点。
- **冷启动慢。** 每次都要从 Drive 复制约 66 GB 的模型，再加载、自检。
- **A100、L4 不在 Strata 点名支持的显卡里。** Strata 写明支持 RTX 20 到 50 系列。它的 CUDA 12 引擎含 sm_60 到 sm_89 的代码，CUDA 13 引擎要求 NVIDIA 驱动 580 或更新（Strata `docs/OLDER_GPUS.md`、`docs/INSTALL.md`）。Colab 上实际能不能跑，以自检为准。
- **用 `STRATA_FEED` 钉版本没有文档依据**（§4）。
- **日志写什么没有文档。** Strata 没有说明 `strata-<model>.log` 会不会写入提示词，§14 用一个哨兵字符串来检查。即使写入，在 Colab 上也可以接受：本地磁盘随运行时一起销毁，Drive 那时已经卸载。在自己的机器上运行时，日志会一直留在磁盘上，不满足「不留下用户内容」，README 的本机运行一节要写明这一点。
- **网关不限制请求体的顶层字段。** 网关只放行两个接口、只收文本内容块，不按字段白名单过滤。如果 Strata 有在服务器上执行的扩展字段，持有令牌的调用方仍然能填，这一层风险靠令牌和 tailnet 兜住。不加白名单，是因为 core 多发一个字段就会被拒，网关得跟着 `llm` 模块同步维护。
- **Strata 还没有经过外部安全审计**（Strata `.github/SECURITY.md`），所以对外只经过网关（§6）。

## 13. 不做的事

- **对外暴露 Strata 的网页界面和管理接口。** 拿到 key 就能改设置、加载模型、调用 MCP。
- **用 Strata 自带的对外方式**（`--access lan`、`cloudflare`、`tailscale`）。它们会绕开宿主的节点命名、标签和访问控制。
- **放行 Anthropic Messages、Responses 等其他接口。** core 用一种协议就够了，多放行一个接口，就多一份暴露在外的东西。
- **MCP 和视觉输入。**
- **在 core 里加 Strata 的预设，或者按 Strata 分支。** 理由见 §1。
- **模型服务离线时，core 自动切换到别的端点。** 中途换模型，文风和工具调用的稳定性都会变。改用哪个端点，由用户在设置页的用途分配里决定。
- **由启动器按需唤醒。** 回合不能停下来等十几分钟的冷启动，按需启动先只给出图服务做（[插图与出图服务 §13](./image.md#13-不做的事)）。
- **和 ComfyUI 跑在同一个运行时里。** 理由见 [Colab 宿主 §1](./colab-host.md#1-定位)。
- **Docker。** Colab 的运行时里没有 Docker。

## 14. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 笔记本刚运行完 | 在 Mac 上不带令牌、带错的令牌分别请求 `/v1/models` | 都返回 401 |
| 服务已就绪 | 带正确的令牌请求 `/health`、`/settings`、`/config`、`/load`、`/mcp`、`/v1/messages` 和 `/` | 都返回 404，Strata 没有收到这些请求 |
| 服务已就绪 | 发一个带 `image_url` 内容块的请求 | 返回 400，Strata 没有收到 |
| Strata 刚安装好 | 查看 Strata 和引擎的版本 | 与 `strata.lock.json` 一致 |
| 服务已就绪 | 在 Unwritten 里添加自定义端点，查找模型，测试连接 | 列出模型；收到有效的工具调用后，模型标为支持工具调用 |
| narrator 分给 Strata，思考设为关闭 | 玩一个回合 | 回合正常提交，回应里没有思考内容 |
| Strata 正在为「换一种发展」流式生成候选 | 在 Unwritten 里取消 | 网关关闭到 Strata 的连接，GPU 占用随即回落 |
| 两个请求同时到达 | 等两个都完成 | 第二个排在第一个之后完成，两个都成功 |
| 发一个带哨兵字符串的请求 | 搜索 Strata 的数据目录、日志和 `/tmp`，以及 Drive | Drive 里找不到。本地磁盘上找到时，README 的本机运行一节写明日志里有故事内容 |
| 第二次部署 | 查看笔记本的输出 | 模型文件都从 Drive 复制，没有一个从 Hugging Face 下载 |
| 用 evals 的回合用例分别跑 Strata 和当前的 narrator 模型 | 对照两边的结果 | 维护者据此决定 Strata 能承担哪些用途 |
| narrator 分给 Strata，运行时已被回收 | 在 Unwritten 里提交行动，再重新运行笔记本后重试 | 先提示连不上模型服务；重试后回合提交成功 |
| Strata 的进程在运行中被杀掉 | 等 `STRATA_HEALTH_INTERVAL_S` | 看护循环打印未就绪，原因是 `engine_down`；请求返回 503 |
| Strata 在加载模型途中退出 | 等 `STRATA_HEALTH_INTERVAL_S` | 原因从 `starting` 变成 `engine_down` |
| 把 `STRATA_LOAD_TIMEOUT_S` 设得比模型加载时间还短 | 运行笔记本 | 超时后停止重试，原因是 `load_timeout` |
| narrator 分给 Strata，没设思考档位 | 玩一个回合，再把档位设为关闭重玩一次 | 第一次的回应带思考内容，明显更慢；第二次没有思考内容 |
| 伪 Strata | 运行 pytest | 全部通过 |
