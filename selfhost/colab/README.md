# Unwritten · Colab 宿主

`selfhost/colab/` 是部署侧的一层 Python 代码：在 Google Colab 里替一个需要 GPU 的服务做好准备，经 Tailscale 只让用户自己的设备访问，并在空闲时释放运行时。设计依据是 [Colab 宿主](../../docs/colab-host.md)。

## 负责什么

- 检查显存、内存和本地磁盘是否达到服务的下限。
- 把宿主代码、服务代码、模型和 tailscaled 状态从 Drive 复制到本地磁盘。
- 按 `models.lock.json` 从 Hugging Face 下载模型，核对大小和 sha256，在 Drive 上留核对标记。
- 读取 Colab Secrets 或启动器上传的 `launch.json`。
- 安装并启动 Tailscale，用 `tailscale serve` 只开放 443。
- 在服务启动前卸载 Drive，把 tailscaled 状态先复制回 Drive。
- 轮询服务的状态文件，打印状态，空闲时调用 `runtime.unassign()`。
- 由启动器启动时，向标准输出打印 `unwritten-host <JSON>` 状态行。

一个运行时只跑一个服务，不实现任何服务协议。

## 不归它管

- 服务自己的协议、错误码、模型选择、工作流和启动参数，由各服务的文档定义。
- 状态文件的内容由服务写入，宿主只读。
- Colab 套餐、GPU 供应、计算单元和运行时回收由 Colab 决定。
- Tailscale 的访问控制策略在管理后台配置，不在代码里。
- `apps/` 和 `packages/` 不导入这个目录，core 不知道宿主存在。

## 服务怎样接入

服务在自己的 `colab_service.py` 里建一个 `HostedService`（`unwritten_colab/service.py`），字段依次是：

- `name`：Drive 上的目录名，也用在状态文件名里；
- `hostname`、`tag`：tailnet 上的节点名和访问控制标签；
- `token_secret`、`authkey_secret`：两个 Secret 的名称；
- `min_vram_gib`、`min_ram_gib`：资源下限，内存为 `None` 时不检查；
- `port`：服务唯一对外暴露的回环端口；
- `models_lock`：模型锁定文件的本地路径，没有模型时为 `None`；
- `prepare(paths)`：安装引擎和依赖；
- `start(paths, token)`：在后台启动服务，返回进程列表。

`start` 收到的令牌经环境变量交给服务进程，不放进命令行参数。服务把状态写到 `paths.state_file`，格式见 [Colab 宿主 §4](../../docs/colab-host.md#4-宿主与服务的约定)。模型文件放在 `paths.models_dir`，服务目录是 `paths.service_dir`。

入口是 `run(service, mode="notebook", idle_minutes=...)` 或 `run(service, mode="launcher", idle_minutes=...)`。不传 `deps` 时从 `google.colab` 导入 `drive`、`userdata`、`runtime`；测试里整体替换 `RunDeps`。

## 调用方必须遵守的契约

- **状态文件**：`/tmp/unwritten-<名称>.state`，JSON 对象，字段是 `ready`、`notReadyReason`、`inFlight`、`lastActivityAt`。服务每次整份重写：先写临时文件，再改名覆盖。`inFlight` 是正在排队和处理的请求数，`lastActivityAt` 是 Unix 秒。
- **状态行**：只在启动器模式打印，每行是 `unwritten-host <JSON>`。`phase` 取 `copying`、`preparing`、`models`、`tailscale`、`starting`、`serving`、`exiting`；`exiting` 另有 `reason`，取 `idle`、`process_exit`、`error`，`error` 时带 `step`。格式见 [Colab 宿主 §8.1](../../docs/colab-host.md#81-由启动器启动)。
- **Drive 布局**：`unwritten/colab/`、`unwritten/<名称>/code/`、`unwritten/<名称>/models/`、`unwritten/<名称>/tailscale/`。服务启动前 Drive 一定已经卸载；tailscaled 状态在卸载前复制回 Drive。
- **认证 key**：只写进权限 `0600` 的临时文件，命令行里只有 `--auth-key=file:<路径>`；执行完立即删除文件。已经有节点身份时不再读取认证 key。
- **不打印密钥**：宿主自己的输出里不出现令牌、认证 key 和用户内容。

## 在 Colab 上使用

前提和套餐说明见 [Colab 宿主 §2](../../docs/colab-host.md#2-前提)。

1. **放代码。** 把仓库里的 `selfhost/colab/` 复制到 Drive 的 `unwritten/colab/`，把服务的目录复制到 `unwritten/<名称>/code/`。代码更新后重新复制。
2. **存 Secrets。** 在 Colab 左侧的 Secrets 面板里，用服务声明的两个名字各存一项：服务令牌，以及 Tailscale 认证 key。认证 key 用一次性、非临时、预先批准并带服务标签的 key。存好后给这个笔记本授予访问权限；没有权限时宿主会报 `no_access`，没有存时报告 `missing`。第二次部署可以删掉认证 key。
3. **写访问控制。** 在 Tailscale 管理后台的访问控制策略里，删掉默认放行全部流量的规则，只给你的登录名到两个服务标签的 `tcp:443` 授权，并且不让服务标签作为来源。策略示例见 [Colab 宿主 §9](../../docs/colab-host.md#9-tailscale-的访问控制)。开启 MagicDNS 和 HTTPS 证书，节点名固定用 `unwritten-image`、`unwritten-llm`。
4. **运行。** 打开 Drive 里的 `unwritten/<名称>/code/colab.ipynb`，运行全部单元格。看护循环每分钟打印就绪状态、未就绪原因和空闲分钟数；看到「就绪」后，用打印出的 `https://<节点名>...ts.net` 地址访问服务。
5. **空闲释放。** 连续空闲 `IDLE_SHUTDOWN_MINUTES` 后宿主调用 `runtime.unassign()`。运行时被回收后重新运行笔记本；节点身份和令牌沿用，已保存的服务地址不用改。
6. **由启动器启动。** 启动器自己挂载 Drive、上传代码和 `launch.json`，再执行同一个入口。宿主读完 `launch.json` 立即删除，不读 Colab Secrets，也不调用 `drive.mount`。

本目录的测试见 [Colab 宿主 §11](../../docs/colab-host.md#11-开发与测试)，用 `uv run --frozen --directory selfhost/colab pytest -q` 运行。
