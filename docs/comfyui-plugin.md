# Unwritten · ComfyUI 插件

本文说明 `plugins/comfyui/` 这个插件：它怎样把 ComfyUI 接到 [Unwritten 图像协议](./image.md#3-unwritten-图像协议)上，用什么模型和工作流，怎样守住安全，以及怎样在 Colab 或自己的 GPU 机器上运行。Colab 上的资源检查、Drive、Tailscale 和空闲释放见 [Colab 宿主](./colab-host.md)；core 一侧怎样使用出图服务见[插图与出图服务](./image.md)。

一句话概括：**ComfyUI 只在本机回环地址上运行，对外只有一层实现了协议的包装；网络、令牌、包装、供应链，四道防线各管一层。**

## 1. 定位

- **它是一个实现 `unwritten-image/1` 的独立服务。** core 不认识 ComfyUI，也不认识 Colab 和 Tailscale；在 core 看来，它只是一个地址加一个令牌。插件和 core 的边界、插件协议的共同规则和插件的义务见[插件](./plugins.md)。
- **它不认识故事。** 它收到英文提示词、参考图、比例、可选的像素宽高、质量档和 seed。作品库留在 core。
- **在哪里运行都一样。** 包装和工作流不区分机器：放在 Colab 上，或者放在一台有 NVIDIA 显卡的电脑上，代码都不用改。在 Colab 上由 Colab 宿主负责部署（§8），本机运行见 §9。
- **能不能接入，只看能不能通过 core 的一致性测试**（[插图与出图服务 §3.7](./image.md#37-一致性测试)）。

## 2. 目录

```
plugins/comfyui/
  README.md            入口地图：它是什么、在 Colab 和本机上怎样运行
  pyproject.toml       Python 版本，ruff、pytest 的配置
  uv.lock              开发依赖的锁定版本
  requirements.txt     在 Colab 上安装用，由 uv 从锁定文件导出
  comfyui.lock         钉死的 ComfyUI commit
  models.lock.json     每个模型文件的仓库、版本、路径、大小和 sha256
  server/              包装服务（§6）
  workflows/           工作流模板与参数绑定（§5）
  colab_service.py     对 Colab 宿主的约定（§8）
  colab.ipynb          Colab 笔记本，只放代码（§8）
  tests/               pytest，带一个伪 ComfyUI
```

插件不导入仓库里的任何 TypeScript 代码，只依赖协议规范。目录里的 README 按[根目录 AGENTS.md §9](../AGENTS.md#9-源码目录的-readme) 只做入口地图，设计细节都在本文。

## 3. 运行结构

```
包装服务，监听 127.0.0.1:8190    ◀── 对外入口（Colab 上是宿主的 tailscale serve）
   │  只走回环地址
   ▼
ComfyUI，监听 127.0.0.1:8188
```

- **ComfyUI 的启动参数：** `--listen 127.0.0.1 --port 8188 --disable-metadata --disable-auto-launch --input-directory <本地输入目录> --output-directory <本地输出目录>`。ComfyUI 默认就只监听 127.0.0.1，这里仍然显式写出，免得哪天默认值变了。不加 `--enable-cors-header`。`--disable-metadata` 让 ComfyUI 保存图片时不写入提示词元数据。
- **包装服务的端口**默认 8190，由 `UNWRITTEN_IMAGE_PORT` 配置，同样只监听 127.0.0.1。
- **对外只有包装这一个入口。** 在 Colab 上，tailnet 能不能访问 8188 和 8190，由宿主的访问控制规则决定，规则只放 443（[Colab 宿主 §5](./colab-host.md#5-运行结构)）。

## 4. 模型

**用 Qwen-Image-2.1。** 同一份权重既能文生图，也能多图参考编辑，所以人物参考图和正文插图共用一个模型。ComfyUI 原生支持它，不需要任何自定义节点。

模型文件取自 Hugging Face 上的 `Comfy-Org/Qwen-Image-2.1`：

| 用途 | 文件 | 大小 |
| --- | --- | --- |
| 扩散模型 | `diffusion_models/qwen_image_2.1_int8_convrot.safetensors` | 7.26 GB |
| 文本编码器 | `text_encoders/qwen3vl_8b_int8_convrot.safetensors` | 9.35 GB |
| VAE | `vae/qwen_image_2.1_vae_bf16.safetensors` | 676 MB |
| Turbo LoRA | `loras/qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors` | 913 MB |

- **扩散模型和文本编码器都用 int8，** 和官方模板一致，权重合计约 17 GB。按文件大小估算，40 GB 显存的 A100 放得下还有余量，24 GB 的 L4 偏紧，16 GB 的 T4 放不下。这是估算，不是官方数字：实际放不放得下，以启动自检（§6.4）为准。
- **快速档用 Turbo LoRA，不用单独的 Turbo 检查点。** 两档共用一个扩散模型，显存里不必同时放两份。
- **只用 safetensors 格式，** 不用会执行 pickle 的 `.ckpt`。
- **版本钉死。** `models.lock.json` 写明每个文件的仓库、commit、路径、大小和 sha256。在 Colab 上，下载、核对和缓存由宿主完成（[Colab 宿主 §8](./colab-host.md#8-笔记本的步骤)）。
- **许可。** 权重由部署者下载。Qwen-Image-2.1 的许可限于研究或评估，商业使用须取得单独许可。README 第一段链接到 [Qwen Research License](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)。
- **原生尺寸。** 模型原生支持约 2K 的分辨率，官方推荐的尺寸是：1:1 为 2048×2048，3:2 为 2528×1696，2:3 为 1696×2528，4:3 为 2400×1792，3:4 为 1792×2400，16:9 为 2752×1536，9:16 为 1536×2752。

## 5. 工作流模板

`workflows/` 里有四份模板，都从 ComfyUI 官方的 Qwen-Image-2.1 模板用「导出（API）」导出：

| 模板 | 用途 | 采样 |
| --- | --- | --- |
| `t2i-best` | 人物参考的正面和无参考图的正文插图 | 基础模型，25 步，CFG 1，`euler`，`simple` |
| `t2i-fast` | 画风预览 | 基础模型加 Turbo LoRA（`LoraLoaderModelOnly`），8 步，CFG 1，`euler`，官方模板的固定 `ManualSigmas` |
| `edit-best` | 带参考图的正文插图，以及按正面补齐的其他视角 | 同 `t2i-best`，文本编码节点接入参考图 |
| `edit-fast` | 带参考图的预览 | 同 `t2i-fast`，文本编码节点接入参考图 |

- **参数绑定写在 `manifest.json` 里。** 每份模板写明这几项：
  - 提示词、seed、宽、高分别填进哪个节点的哪个输入；
  - 每个参考图槽位对应哪个 `LoadImage` 节点，以及文本编码节点上的哪个 `image_N` 输入；
  - 这份模板的负面提示词是否生效。

  包装只按绑定填值，不理解工作流的含义。
- **没用到的参考图槽位，提交前从图里删掉。** 包装删除对应的 `LoadImage` 节点，并去掉文本编码节点上那个 `image_N` 输入。提交给 ComfyUI 的图里只有真正用到的槽位。
- **参考图最多 10 张。** 模型卡写明支持 10 张参考图，官方模板也接了 10 个槽位，所以 `/v1/info` 报告 `maxReferences: 10`。
- **`{{ref:N}}` 换成 `<imageN>`。** 包装按数组顺序把收到的图片放入槽位，人物参考组选哪一张由 core 决定。可选的提示词增强（`refine_prompt`）保持关闭，保留 core 给出的引用和镜头描述。
- **输出尺寸由绑定显式给出。** 编辑模板默认跟随第一张参考图的尺寸。包装把请求确定的宽高写入独立的输出画布，横图和竖图都遵循该请求。模板通过 §13 的实机验收，检查指定尺寸、人物特征与动作构图。参见 [ComfyUI 官方编辑模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json)。
- **省略 `size` 时，两档各用默认尺寸。** `best` 用 §4 的原生尺寸。`fast` 把原生尺寸的宽和高各减半，再取最近的 16 的倍数，例如 3:2 是 1264×848，3:4 是 896×1200，像素数约为原生的四分之一。两组尺寸都写在 `manifest.json` 里，可以改。
- **分辨率档按 GPU 型号写在 `manifest.json` 里。**
  - 为 720、1K、2K 三档，选短边接近 720、1024、2048 像素的尺寸，按锁定模板的要求对齐宽高，并符合[图像协议 §3.2](./image.md#32-get-v1info)。
  - 维护者在某种 GPU 上用文生图和编辑两种工作流确认过实际输出的宽高，才把这组尺寸写进该型号的清单。2K 先验证 2048×2048 的方图，只有实机支持的比例才进 2K 清单。
  - 包装启动时，按 `nvidia-smi` 报告的 GPU 型号取对应清单。清单里没有这个型号时，`/v1/info` 不报告 `resolutions`，只按默认尺寸出图。
  - 自检（§6.4）只跑默认尺寸，冷启动不为档位多花时间。
- **负面提示词不生效。** 两档都是 CFG 1，这时 ComfyUI 跳过负面条件那一遍计算，负面提示词没有任何作用。所以 `/v1/info` 报告 `negativePrompt: false`，core 会把要避开的内容写进正面提示词（[插图与出图服务 §7.3](./image.md#73-由-core-拼进提示词的固定内容)）。以后把某份模板改成 CFG 大于 1，要同时改它在 `manifest.json` 里的这个字段；`/v1/info` 只在四份模板都生效时才报告 true。
- **ComfyUI 升级时重新导出模板。** 节点名或输入名变了，启动自检会失败，服务报告 `workflow_error`，不会等到第一张插图才发现。

## 6. 包装服务

### 6.1 依赖

包装只用 aiohttp、Pillow 和 Python 标准库。ComfyUI 的 `requirements.txt` 本来就有 `aiohttp>=3.11.8` 和 `Pillow>=10.1.0`，所以包装不往 ComfyUI 的环境里新增运行依赖。

### 6.2 协议的实现

| 协议 | 包装怎样做 |
| --- | --- |
| 鉴权 | 一个 aiohttp 中间件拦在所有路由前面，用 `hmac.compare_digest` 比较令牌。令牌来自环境变量 `UNWRITTEN_IMAGE_TOKEN`，短于 32 个字符时拒绝启动 |
| 请求体上限 | `client_max_size` 设为能放下 `maxReferences` 张参考图的 base64 再加 64 KB，超出的请求不读完就拒绝 |
| `GET /v1/info` | 由 `manifest.json`、自检结果和队列状态拼出 |
| `POST /v1/jobs` | 校验字段和上限。显式尺寸须属于该比例公布的清单，否则在入队前返回 `unsupported_size`。用 Pillow 校验参考图并转成 RGB，宽或高超过 4096 像素的拒绝。按幂等键查重，放进容量为 8 的任务队列，满了返回 429 `busy` |
| 执行 | 一次只跑一个任务。参考图写进 ComfyUI 的输入目录，文件名是 `unwritten-<任务 id>-<N>.png`；按绑定填好模板，`POST /prompt`；每秒查询一次 `GET /history/{prompt_id}`，直到出现输出；从输出目录读出图片 |
| 结果 | 用 Pillow 重新编码成 WebP（质量 92），不传 EXIF、XMP 等任何附加数据，所以结果不带元数据。编码后立刻删除输入和输出目录里的文件，结果只留在内存里 |
| `GET /v1/jobs/{id}`、`/image` | 从内存里的任务表读取 |
| `DELETE /v1/jobs/{id}` | 排队中的直接移出队列；运行中的调用 ComfyUI 的 `POST /interrupt`；已完成的释放结果 |
| 保留期 | 结果在完成 10 分钟后丢弃，幂等键随之失效 |
| 日志 | 只记任务 id、状态和耗时，不记提示词，不记图片 |

### 6.3 错误映射

| ComfyUI 的情况 | 任务的错误码 |
| --- | --- |
| `/prompt` 返回节点错误 | `workflow_error` |
| 执行出错，信息里是显存不足 | `out_of_memory` |
| 被 `DELETE` 中断 | `interrupted` |
| ComfyUI 连不上，或返回了无法解析的内容 | `internal` |

### 6.4 启动自检

包装启动后，先用一句不含故事内容的固定提示词，按默认尺寸把四份模板各跑一遍：两份文生图模板先跑，两份编辑模板再拿文生图的结果当参考图。四份都成功才把 `ready` 设为 true。

- 自检失败时，`ready` 保持 false，`notReadyReason` 写成 `out_of_memory` 或 `workflow_error`，进程不退出，`/v1/info` 照常可读，用户在设置页的测试连接里就能看到原因。
- 自检同时完成预热：模型已经进了显存，第一张正式的图不用再等冷启动。

### 6.5 状态文件

包装按 [Colab 宿主 §4](./colab-host.md#4-宿主与服务的约定) 写 `/tmp/unwritten-comfyui.state`。`ready` 和 `notReadyReason` 与 `/v1/info` 一致，`inFlight` 是排队中和运行中的任务数，任务开始和结束时更新 `lastActivityAt`。宿主的看护循环据此判断空闲，不为这件事另开接口。

## 7. 安全

下表是这个插件履行[插件 §4](./plugins.md#4-插件的义务)的具体做法，外加网络这一层。

| 防线 | 挡什么 | 怎么做 |
| --- | --- | --- |
| 网络 | 没有门禁的请求根本到不了运行时 | 在 Colab 上，服务只在你的 tailnet 里，没有公网地址；访问控制只允许你名下的设备访问这个节点的 443 端口，这个节点不能主动连任何设备（[Colab 宿主 §9](./colab-host.md#9-tailscale-的访问控制)） |
| 令牌 | 网络那层失守时，仍然调用不了接口 | 设置页生成的 32 字节随机令牌；只存在 Colab Secrets 和本机的 `providers.json`；常量时间比较 |
| 包装 | 令牌泄露时，也只能出图 | ComfyUI 只监听回环地址；工作流是固定模板，调用方只能填参数，提交不了工作流，也就没法让 ComfyUI 执行任意节点；参考图只收内联数据；每个输入都有上限；结果重新编码、去掉元数据；图片和提示词不长期留存（§6.2） |
| 供应链 | 模型或节点被人做了手脚 | ComfyUI 钉到 commit；不装 ComfyUI-Manager，因为它能通过接口在线安装任意节点；不装自定义节点；模型只用 safetensors，钉版本并核对 sha256 |

Drive 的卸载、令牌在笔记本里的处理、节点名的公开范围，见 [Colab 宿主 §6–9](./colab-host.md#6-drive)。

## 8. 在 Colab 上运行

### 8.1 对宿主的约定

| 约定 | 取值 |
| --- | --- |
| 名称 | `comfyui` |
| 节点名和标签 | `unwritten-image`、`tag:unwritten-image` |
| Secrets | 令牌 `UNWRITTEN_IMAGE_TOKEN`，认证 key `TS_AUTHKEY_IMAGE` |
| 显存下限 | 24 GB，有 A100 时优先选它（§4） |
| 内存下限 | 不设 |
| 磁盘下限 | 按宿主的规则，由 `models.lock.json` 算出 |
| 对外端口 | 包装的 8190 |
| 状态文件 | `/tmp/unwritten-comfyui.state`（§6.5） |

### 8.2 准备与启动

- **准备：** 按 `comfyui.lock` 克隆指定的 commit 到 `/content/ComfyUI`，安装它的 `requirements.txt`，再安装插件的 `requirements.txt`。模型由宿主放到本地模型目录，ComfyUI 的 `extra_model_paths.yaml` 指向这个目录。
- **启动：** 用 §3 的参数在后台启动 ComfyUI，等到 `http://127.0.0.1:8188/system_stats` 可以访问；再启动包装服务，令牌经环境变量传入。返回 ComfyUI 和包装两个进程。自检结果写进状态文件。

### 8.3 在 Unwritten 里接上

1. 设置页 → 出图服务 → 添加服务，协议选「Unwritten 图像协议」，点「生成令牌」并复制。
2. 把令牌存进 Colab Secrets 的 `UNWRITTEN_IMAGE_TOKEN`，然后运行笔记本。
3. 笔记本打印出服务地址后，把它填进设置页，保存。地址固定不变，只填这一次。
4. 点「测试连接」，确认模型和就绪状态，再选择该服务。需要游玩时自动出图时，按[插图与出图服务 §2](./image.md#2-出图服务的配置)确认开启。

之后每次使用，见 [Colab 宿主 §10](./colab-host.md#10-看护循环与空闲释放)。

### 8.4 按需启动

不想每次手动运行笔记本时，在 Mac 上常驻 [Colab 启动器](./colab-launcher.md)，再在设置页给这个服务填上启动器地址和令牌。之后进入开了插图的开局，或者出图时服务关着，core 都会通过启动器唤醒它；空闲到设定的分钟数，它会自己关闭（[插图与出图服务 §12](./image.md#12-按需启动)）。手动运行笔记本仍然可用。

## 9. 在本机运行

在一台有 NVIDIA 显卡的电脑上：按 `comfyui.lock` 安装 ComfyUI，按 §4 准备模型，用 §3 的参数启动 ComfyUI 和包装服务，不需要笔记本。

- core 和插件在同一台机器上时，设置页里的地址填 `http://127.0.0.1:8190`。这是回环地址，不会出现明文 http 的警告。
- 插件在另一台机器上时，用 Tailscale Serve 转发到该机的回环地址。普通系统服务模式也可以用。包装和 ComfyUI 仍只监听回环地址。

## 10. 开发与测试

- **工具：** 用 uv 管理开发环境和锁定文件，用 ruff 做 lint 和格式化，用 pytest 跑测试（[技术选型 §3](./tech-stack.md#3-仓库与工具链)）。Python 版本写在 `pyproject.toml` 的 `requires-python` 里，跟随 ComfyUI 和 Colab 运行时的要求。
- **不写注释。** 根目录 AGENTS.md 的规矩对 Python 一样适用，笔记本也只放代码。
- **伪 ComfyUI。** `tests/` 里有一个 aiohttp 写的伪 ComfyUI，实现 `/prompt`、`/history`、`/interrupt`，往输出目录写一张带文本元数据的 PNG。用它测试：
  - 令牌和各项上限；
  - 幂等；
  - 参考图槽位的裁剪；
  - 结果去掉了元数据，输入和输出文件被删除；
  - 保留期；
  - 显存不足的错误映射；
  - 按 GPU 型号选取分辨率清单；
  - 状态文件的变化。
- **一致性测试。** CI 用伪 ComfyUI 启动包装，再对着它运行 core 的协议一致性测试（[插图与出图服务 §3.7](./image.md#37-一致性测试)）。
- **提交前检查。** lefthook 对暂存的 `.py` 文件跑 `ruff check --fix` 和 `ruff format`；CI 另跑插件的 pytest。

## 11. 已知限制

- **24 GB 显存偏紧。** §4 的显存判断来自文件大小的估算。放不下时自检报告 `out_of_memory`，只能换更大的 GPU。
- **分辨率档只对验证过的 GPU 型号开放。** 换到没有清单的型号，只有默认尺寸可用，直到维护者在该型号上验证并补上清单（§5）。
- Colab 运行时的寿命、冷启动和代码同步等限制，见 [Colab 宿主 §12](./colab-host.md#12-已知限制)。

## 12. 不做的事

- **对外暴露 ComfyUI 的界面或接口。** 它能上传文件、提交任意工作流。
- **ComfyUI-Manager 和任何自定义节点。** Qwen-Image-2.1 由 ComfyUI 原生支持，用不到它们。
- **启动时探测每一档尺寸。** 每个比例、每一档都要用 best 跑一遍文生图和编辑，冷启动要多画许多张大图，消耗计算单元。档位清单按 GPU 型号预先验证（§5）。
- **多卡、多个出图进程，以及为人物训练 LoRA。**

## 13. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 笔记本刚运行完 | 在 Mac 上对服务地址运行 core 的一致性测试 | 全部通过 |
| 服务已就绪 | 不带令牌、带错的令牌分别请求 `/v1/info` | 都返回 401 |
| 两张竖向参考图已准备好 | 用同一参考组分别画横图、竖图，再用不同档位画同一比例 | 结果宽高符合每次指定的清单尺寸。文件是静态 WebP，没有 EXIF、XMP 和文本块 |
| 当前 GPU 型号的 2K 清单里有方图 | 选择 2K 自动比例，并让镜头表现适合方图的画面 | 2K 显示 2048×2048。其他比例只在该型号的清单里有时可用 |
| GPU 型号不在 `manifest.json` 的清单里 | 查看 `/v1/info`，再画一张图 | 不报告 `resolutions`，出图使用默认尺寸 |
| 请求尺寸不在所选比例的清单内 | 发起出图并检查 ComfyUI 任务队列 | 返回 `unsupported_size`，ComfyUI 未收到任务 |
| 两位有明显不同外观的虚构人物，已有参考图 | 画一人递钥匙、另一人收手。让其中一人换装，再交换参考图顺序并调整提示词里的引用，重复生成 | 维护者对照参考图仍能认出两人，也能从每张画面看出谁递、谁收手、钥匙在谁手里。单独记录耗时和出错样图 |
| 第一人称镜头里，主角刚打开怀表 | 生成无参考图的正文插图 | 画面聚焦表盖和已露出的齿轮，线索清晰可辨 |
| 包装正在出图 | 查看 ComfyUI 的输入和输出目录 | 任务结束后，两个目录里都没有这个任务的文件 |
| 改坏一份模板里某个节点的输入名 | 启动包装 | `ready` 为 false，原因是 `workflow_error` |
| 伪 ComfyUI | 运行插件的 pytest | 全部通过 |
