# Unwritten · ComfyUI 插件

本插件把 ComfyUI 上的 Qwen-Image-2.1 接到 `unwritten-image/1` 协议上，给 Unwritten 提供插图、人物参考和预览的出图能力。权重由部署者从 Hugging Face 下载；Qwen-Image-2.1 的许可限于研究或评估，商业使用须取得单独许可，见 [Qwen Research License](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)。

设计细节见 [ComfyUI 插件](../../docs/comfyui-plugin.md)、[Unwritten 图像协议](../../docs/image.md#3-unwritten-图像协议)和[插件](../../docs/plugins.md)。

## 入口地图

| 路径 | 负责什么 |
| --- | --- |
| `server/app.py` | aiohttp 应用、鉴权中间件、五个协议路由 |
| `server/jobs.py` | 任务表、校验、幂等、队列、保留期、执行 |
| `server/comfy.py` | 调 ComfyUI 的 `/prompt`、`/history`、`/interrupt` |
| `server/workflow.py` | 按 `workflows/manifest.json` 的绑定填模板，删掉没用到的参考图槽位 |
| `server/images.py` | 校验参考图，把结果重新编码成无元数据的 WebP |
| `server/selftest.py` | 启动自检：四份模板各跑一遍 |
| `server/state_file.py` | 写 `/tmp/unwritten-comfyui.state` |
| `workflows/` | 四份 API 模板和 `manifest.json`，从 ComfyUI 官方 Qwen-Image-2.1 模板导出 |
| `comfyui.lock`、`models.lock.json` | ComfyUI 的 commit，以及四个模型文件的版本、大小和 sha256 |
| `colab_service.py`、`colab.ipynb` | 交给 Colab 宿主的准备、启动和笔记本 |
| `tests/` | 伪 ComfyUI、最小测试模板、pytest，以及一致性测试的启动脚本 |

这个目录不认识故事，也不访问数据目录和 `providers.json`。它只接收提示词、参考图、比例、尺寸、质量档和 seed。资源检查、Drive、Tailscale 和空闲释放由 `selfhost/colab/` 的宿主负责，见 [Colab 宿主](../../docs/colab-host.md)。

调用方只需要知道：包装监听 `127.0.0.1:8190`，协议入口是 `/v1`，每个请求带 `Authorization: Bearer <令牌>`。返回的错误码和任务字段以[图像协议 §3](../../docs/image.md#3-unwritten-图像协议)为准。

## 在 Colab 上运行

1. 在设置页 → 出图服务里添加服务，协议选「Unwritten 图像协议」，点「生成令牌」并复制。
2. 把令牌存进 Colab Secrets 的 `UNWRITTEN_IMAGE_TOKEN`，把 Tailscale 认证 key 存进 `TS_AUTHKEY_IMAGE`。
3. 把宿主代码放到 Drive 的 `unwritten/colab/`，把本目录的代码放到 `unwritten/comfyui/code/`。
4. 打开 `colab.ipynb` 并运行。笔记本挂载 Drive，按 `comfyui.lock` 准备 ComfyUI，下载并核对 `models.lock.json` 的模型，接入 Tailscale，然后启动 ComfyUI 和包装。
5. 笔记本打印出服务地址后，填进设置页并保存。点「测试连接」，确认模型和就绪状态，再启用自动出图。

之后每次使用只需重新运行笔记本。空闲到笔记本里设定的分钟数，宿主会释放运行时。

## 在本机运行

需要一台有 NVIDIA 显卡的机器，显存至少 24 GB。

1. 按 `comfyui.lock` 安装 ComfyUI，例如：

   ```sh
   git clone --filter=blob:none https://github.com/comfyanonymous/ComfyUI
   git -C ComfyUI checkout <comfyui.lock 里的 commit>
   python -m pip install -r ComfyUI/requirements.txt
   ```

2. 按 `models.lock.json` 把四个文件放到 ComfyUI 的 `models/diffusion_models/`、`models/text_encoders/`、`models/vae/`、`models/loras/`。
3. 把四份官方 Qwen-Image-2.1 模板用 ComfyUI 的「导出（API）」导出到 `workflows/`，按 `workflows/manifest.json` 的绑定核对节点 id 和输入名。
4. 启动 ComfyUI：

   ```sh
   python ComfyUI/main.py --listen 127.0.0.1 --port 8188 --disable-metadata --disable-auto-launch \
     --input-directory /path/to/comfy-input --output-directory /path/to/comfy-output
   ```

5. 生成令牌并启动包装：

   ```sh
   export UNWRITTEN_IMAGE_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
   export COMFY_INPUT_DIR=/path/to/comfy-input
   export COMFY_OUTPUT_DIR=/path/to/comfy-output
   python -m server
   ```

   `python -m server` 要在本目录里运行。默认连 `http://127.0.0.1:8188`，监听 `127.0.0.1:8190`。设置页里填 `http://127.0.0.1:8190`。包装和 ComfyUI 都只监听回环地址。

## 按需启动

在 Mac 上常驻 [Colab 启动器](../../docs/colab-launcher.md)，在设置页给这个服务填上启动器地址和令牌。之后进入开了插图的开局，或者服务关着时出图，Unwritten 会通过启动器唤醒它；空闲到设定分钟数后自动关闭。手动运行笔记本仍然可用。

## 开发与测试

```sh
uv run --frozen --directory plugins/comfyui pytest -q
uv run --frozen --directory plugins/comfyui ruff check
uv run --frozen --directory plugins/comfyui ruff format --check
```

仓库根目录的 `pnpm test:python` 还会用伪 ComfyUI 启动包装，再对它运行 core 的图像协议一致性测试；不需要 GPU。测试不读取官方模板，使用 `tests/workflows/` 里的最小模板。
