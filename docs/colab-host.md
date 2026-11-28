# Unwritten · Colab 宿主

本文说明 `selfhost/colab/`：怎样在 Google Colab 上运行一个需要 GPU 的服务，经 Tailscale 只让你自己的设备访问它，并在空闲时释放运行时。用到它的有 [ComfyUI 插件](./comfyui-plugin.md)和 [Strata 自建模型服务](./strata.md)。这两份文档只写服务自己的准备和启动步骤，其余都由宿主负责。

一句话概括：**一个运行时只跑一个服务；服务只监听回环地址，对外只有 `tailscale serve` 的 443 端口；服务启动前先卸载 Drive。**

## 1. 定位

- **宿主只管部署。** 它检查资源、搬运文件、接入 tailnet、看护进程、空闲时释放运行时。它不实现任何协议，core 也不知道它存在。
- **`selfhost/` 放用户自己部署、但不属于插件的东西：** Colab 宿主，以及 core 用已有协议调用的自建服务，例如 Strata。插件放在 `plugins/`，定义见[插件 §1](./plugins.md#1-什么是插件)。`apps/` 和 `packages/` 不导入 `selfhost/` 的代码，也不出现它们专属的名字，规则和检查同[插件 §2](./plugins.md#2-边界)。
- **一个运行时只跑一个服务。** 出图模型和大语言模型放在同一块 GPU 上会争抢显存，单卡通常放不下两份权重。两个服务都要用时，开两个运行时，各自是 tailnet 上的一个节点。
- **两种启动方式，走同一套步骤。** 你可以在浏览器里手动运行笔记本，也可以让 Mac 上的 [Colab 启动器](./colab-launcher.md) 用 Colab CLI 按需开关运行时。两种方式只在代码和密钥从哪来、怎样授权 Drive 上不同（§8.1）。
- **Colab 只是一种运行方式。** 服务本身不区分机器，在自己的 GPU 机器上运行见各服务文档的「在本机运行」。

## 2. 前提

使用前按 [Colab FAQ](https://research.google.com/colaboratory/faq.html?hl=en) 核对当前套餐、计算单元余额和用途限制。

- **Google AI Pro 订阅。** Google AI Pro 在 Colab 里每月提供 200 个计算单元，可以使用更强的加速器和更长的运行时间。这项权益只在 Colab 提供付费服务的国家和地区有效，Google One 的免费试用期间不包括。
- **GPU 运行时。** 按服务声明的资源下限选（§4）。Colab 能选的 GPU 种类随时间变化。
- **Drive 空间。** 放得下服务的模型文件，再加上代码和状态目录。
- **Tailscale。** 一个 Tailscale 账号；Mac 上装好 Tailscale 并登录；在管理后台开启 MagicDNS 和 HTTPS 证书，并确认节点名会被公开到证书透明度日志（§9）。

## 3. 目录

```
selfhost/colab/
  README.md            入口地图：宿主做什么、服务怎样接入
  pyproject.toml       Python 版本，ruff、pytest 的配置
  uv.lock              开发依赖的锁定版本
  unwritten_colab/     宿主的 Python 模块：资源检查、Drive、Secrets、Tailscale、看护循环
  tests/               pytest，带伪 google.colab 模块和伪命令
```

宿主只用 Python 标准库和 Colab 自带的 `google.colab`，不往运行时里装依赖。目录里的 README 按[根目录 AGENTS.md §9](../AGENTS.md#9-源码目录的-readme) 只做入口地图，设计细节都在本文。

## 4. 宿主与服务的约定

每个服务在自己目录的 `colab_service.py` 里声明下面这些，笔记本把它交给宿主：

| 约定 | 含义 |
| --- | --- |
| 名称 | Drive 上的目录名，也用在状态文件名里 |
| 节点名和标签 | 这个服务在 tailnet 上的主机名和访问控制标签 |
| 两个 Secret 的名字 | 服务令牌和 Tailscale 认证 key（§7） |
| 资源下限 | 显存、内存、本地磁盘。磁盘下限是 `models.lock.json` 的 `files` 合计，加上可选的 `artifacts` 的源文件与打包文件，再加 `DISK_HEADROOM_GIB`（默认 20，可配置） |
| 对外端口 | 服务唯一对外的端口，只监听 127.0.0.1。`tailscale serve` 只转发这一个 |
| 状态文件 | `/tmp/unwritten-<名称>.state`，见下文 |
| 准备 | 一个函数：安装引擎和依赖。模型由宿主放到本地（§8） |
| 启动 | 一个函数：在后台启动服务，返回它启动的进程 |

各服务的取值写在它自己的文档里。

**状态文件**是一个 JSON 对象：

```json
{ "ready": false, "notReadyReason": "starting", "inFlight": 0, "lastActivityAt": null }
```

- `inFlight` 是正在排队和处理的请求数。`lastActivityAt` 是最近一个请求开始或结束的时刻，用 Unix 秒数表示。
- 服务在状态变化、请求开始和请求结束时整份重写这个文件：先写临时文件，再改名覆盖。
- `notReadyReason` 的取值由服务定义，宿主原样打印。
- **宿主只读这个文件，不调用服务的接口。** 各服务的协议不同，宿主不必认识它们，也不用拿着服务令牌去探测。

## 5. 运行结构

```
Colab 运行时
  tailscaled（用户态网络，状态目录在本地磁盘）
    └─ tailscale serve：HTTPS 443 ──▶ 服务的对外端口，监听 127.0.0.1
                                          │  只走回环地址
                                          ▼
                                     服务内部的其他进程，也只监听 127.0.0.1
```

- **对外只有 `tailscale serve` 这一个入口。** 它只把 tailnet 上 443 端口的 HTTPS 请求转给服务的对外端口。
- **用户态网络会把 tailnet 上到达其他端口的连接，转给本机的同一端口。** 服务的回环端口能不能从 tailnet 访问，完全取决于访问控制规则：规则只放 443（§9）。服务内部的进程不对外，就靠这条规则，不是可选项。

## 6. Drive

```
<Drive 根目录>/unwritten/
  colab/            仓库里 selfhost/colab 的副本
  <名称>/
    code/           服务目录的副本：plugins/comfyui 或 selfhost/strata，笔记本从这里打开；由启动器启动时不用
    models/         模型文件和核对标记
    tailscale/      这个节点的 tailscaled 状态
```

Drive 挂载在 `/content/drive`。宿主在挂载点下依次查找 `MyDrive` 和 `My Drive`，用找到的那个作为 Drive 根目录。仓库里的代码更新后，要手动把对应目录复制到 Drive 上。

- **服务启动前卸载 Drive。** 挂载期间，运行时里的任何进程都能读写你的整个 Drive，不只是 `unwritten/` 这一个目录：`drive.mount` 没有只挂载一个子目录的参数（colabtools `google/colab/drive.py`）。服务要处理来自网络的请求，它或它包装的引擎只要有一个漏洞，Drive 上的一切就都暴露了。所以宿主先把需要的东西复制到本地磁盘 `/content/unwritten/`，再调用 `drive.flush_and_unmount()` 把待写的内容推回 Drive、卸载，然后才启动服务。
- **卸载之后，这个运行时不再挂载 Drive。** `drive.mount` 每次调用都要向前端发起授权请求，看护期间没有人在旁边确认。要更新代码或模型，就重新开一个运行时。
- **tailscaled 的状态目录用本地副本。** tailscaled 运行时会改写状态文件，而 Drive 是网络挂载，不保证改名和文件锁的语义。所以宿主把状态复制到本地，用本地副本启动 tailscaled，`up` 成功后复制回 Drive，再卸载。卸载之后的状态变化不写回 Drive，下次启动沿用这一份。
- **状态目录里有这个节点的私钥。** Drive 被人拿到时，对方能冒充这个节点；但访问控制只允许别人连进这个节点，不允许它往外连，影响有限。
- **图片、提示词、模型输出和日志都不写进 Drive。**

## 7. Colab Secrets

每个服务用两个 Secret，名字由服务声明（§4）：

| 用途 | 内容 |
| --- | --- |
| 服务令牌 | core 调用这个服务时带的令牌，生成方式见各服务的文档 |
| Tailscale 认证 key | 一次性、非临时、预先批准、带这个服务的标签。只有第一次部署会用到 |

- **名字里带上服务。** Colab 的 Secret 属于账号，所有笔记本看到的是同一份清单，访问权限按笔记本分别授予。两个服务用不同的名字，才不会互相覆盖。
- **读取。** 笔记本用 `google.colab.userdata.get(<名称>)` 读取，只读这一次部署用得到的 Secret（§8 第 2 步）。抛出 `SecretNotFoundError`，说明没有存这个 Secret；抛出 `NotebookAccessError`，说明存了但没给这个笔记本访问权限。两种情况都停下来，写明缺的是哪一个、该怎么做。
- **令牌和认证 key 不出现在笔记本里。** 不写进任何单元格，也不打印。
- **由启动器启动时不读 Colab Secrets，** 密钥由启动器上传（§8.1）。
- **认证 key 用一次性、非临时的。** 节点状态存在 Drive 上（§6），以后每次开机都沿用同一个节点身份，不用再认证。临时节点下线 30 到 60 分钟后才会被清除，在这段时间里重开 Colab 会注册出一个新节点，换一个新的 IP；固定的节点身份让节点名和地址始终不变，设置页里的地址只填一次。带标签的节点首次认证后，默认不会因为 key 过期掉线。

## 8. 笔记本的步骤

笔记本放在服务目录里，只放代码，说明写在 README 里（[根目录 AGENTS.md §8](../AGENTS.md#8-不写注释)）。第一个单元格配置 `IDLE_SHUTDOWN_MINUTES`，挂载 Drive（`drive.mount('/content/drive')`），从 Drive 上的副本导入宿主。之后依次：

1. **复制到本地。** 把宿主代码、服务代码和 tailscaled 状态复制到 `/content/unwritten/`。此后只从本地副本导入代码，服务的 `colab_service.py` 也从这里导入。
2. **读取 Secrets，检查资源。** 令牌每次都读；认证 key 只在本地副本里还没有节点身份时才读，之后的部署可以把它从 Secrets 里删掉。用 `nvidia-smi` 读显存，从 `/proc/meminfo` 读内存，读 `/content` 所在磁盘的可用空间。任何一项低于服务的下限，就停下来写明缺哪一项、需要多少。这一步在复制模型之前，资源不够时不白搬几十 GB。
3. **服务的「准备」，然后放好模型。**
   - 先调用服务的「准备」，安装引擎和依赖。
   - Drive 上缺的模型文件，按 `models.lock.json` 从 `https://huggingface.co/<仓库>/resolve/<commit>/<路径>` 下载到本地，核对 sha256，再复制一份到 Drive。地址里带 commit，所以仓库后来的改动不会混进来。通过核对的文件在 Drive 上留一个标记，记下大小和修改时间；之后每次启动只比较这两项，不重新计算哈希。
   - Drive 上已有的模型，顺序复制到本地。顺序复制一遍，比让引擎在网络挂载上随机读取快得多。
4. **接入 Tailscale。**
   - 用 Tailscale 官方的安装脚本安装；
   - 启动 `tailscaled --tun=userspace-networking --statedir=/content/unwritten/<名称>/tailscale --socket=/tmp/tailscaled.sock`；
   - 状态目录里还没有节点身份时，把认证 key 写进权限 `0600` 的临时文件，执行 `tailscale --socket=/tmp/tailscaled.sock up --auth-key=file:<临时文件> --hostname=<节点名> --advertise-tags=<标签>`，执行完删掉临时文件；已有身份时只执行 `up`，不带认证 key。认证 key 不出现在命令行参数里，因为命令行参数在 `ps` 里人人可见；
   - 把状态目录复制回 Drive。
5. **卸载 Drive：** `drive.flush_and_unmount()`。
6. **服务的「启动」。** 令牌经环境变量传入，等到状态文件出现。
7. **对外开放。** 执行 `tailscale --socket=/tmp/tailscaled.sock serve --bg --https=443 http://127.0.0.1:<对外端口>`，打印服务地址 `https://<节点名>.<tailnet 名>.ts.net`。服务还没就绪时也开放，由服务自己回应未就绪；例如出图服务的测试连接会显示未就绪的原因（[插图与出图服务 §3.2](./image.md#32-get-v1info)）。
8. **看护循环**（§10）。

### 8.1 由启动器启动

[Colab 启动器](./colab-launcher.md)用 `colab exec` 运行一个入口脚本。它解包启动器上传的代码，再调用宿主的同一个入口，按上面的 8 步执行。区别只有这些：

| 步骤 | 手动运行笔记本 | 由启动器启动 |
| --- | --- | --- |
| 代码 | Drive 上 `unwritten/` 下的副本 | 启动器从本机仓库打包上传的代码 |
| 令牌、认证 key 和空闲分钟数 | Colab Secrets，以及笔记本第一个单元格 | `/content/unwritten/launch.json`。宿主读完立即删掉它。空闲分钟数是 Unwritten 设置页为这个服务设的值 |
| 挂载 Drive | 笔记本调用 `drive.mount`，在浏览器里授权 | 启动器先用 `colab drivemount` 挂好，授权由 Unwritten 提示。宿主发现 `/content/drive` 下已经有 Drive 根目录，就不再调用 `drive.mount` |
| 输出 | 给人看的文字 | 另外打印状态行，供启动器解析 |
| 结束 | 空闲到时释放运行时 | 同样调用 `runtime.unassign()`，然后入口返回，启动器再执行 `colab stop` |

**状态行**每行一条，格式是 `unwritten-host <JSON>`：

```
unwritten-host {"phase": "serving"}
unwritten-host {"phase": "exiting", "reason": "idle"}
```

- `phase` 按步骤取 `copying`、`preparing`、`models`、`tailscale`、`starting`、`serving`、`exiting`。服务对外开放（第 7 步）之后报告 `serving`。
- `exiting` 附 `reason`：`idle`（空闲到时）、`process_exit`（服务进程退出后空闲到时）、`error`（启动途中出错，另附出错的 `step`）。
- 状态行里只有阶段和原因，不含令牌、地址、提示词或任何用户内容，因为 CLI 会把 `exec` 的输出记进本地日志。

## 9. Tailscale 的访问控制

在 Tailscale 管理后台的访问控制策略里：

```json
{
  "tagOwners": {
    "tag:unwritten-image": ["autogroup:admin"],
    "tag:unwritten-llm": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["<你的 Tailscale 登录名>"],
      "dst": ["tag:unwritten-image", "tag:unwritten-llm"],
      "ip": ["tcp:443"]
    }
  ]
}
```

- **删掉默认策略里放行全部流量的那条规则。** grants 默认拒绝，只有明确授予的访问才放行；但只要那条全部放行的旧规则还在，上面这条就形同虚设。
- **没有任何一条 grant 以这两个标签为来源，** 所以服务节点不能主动连接任何设备，包括你的 Mac，也包括另一个服务节点。
- **只开 443，** 所以 tailnet 上的设备连不到服务的回环端口（§5）。
- 如果这个 tailnet 还用来做别的事，那些设备之间的访问要另外写 grants。
- **节点名会公开。** 开启 Tailscale 的 HTTPS 证书后，节点名和 tailnet 名会写进公开的证书透明度日志。所以节点名固定用 `unwritten-image`、`unwritten-llm`，不含任何个人信息。

## 10. 看护循环与空闲释放

这个单元格一直运行：

- 每分钟打印一次就绪状态、未就绪的原因和空闲时长。
- 「启动」返回的任何一个进程退出时，打印是哪个进程、退出码。服务不再接请求，空闲计时照常进行，到时照样释放运行时，免得服务已经挂了还在消耗计算单元。
- `inFlight` 为 0 时才算空闲。空闲时长从 `lastActivityAt` 算起，还没有过请求时从看护循环开始时算起。
- 连续空闲 `IDLE_SHUTDOWN_MINUTES`（默认 30 分钟，在笔记本第一个单元格里配置；由启动器启动时取 `launch.json` 里的值）后，调用 `google.colab.runtime.unassign()` 释放运行时，不再消耗计算单元。

看护循环报告服务状态，并在闲置时主动释放运行时。Colab 仍可能根据套餐、使用量和资源供应回收运行时。

**每次使用：** 打开 Drive 里的 `unwritten/<名称>/code/colab.ipynb`，运行后等看护循环打印「就绪」。运行时被回收后，重新运行笔记本。沿用原节点身份和令牌时，已保存的服务地址不用改。

## 11. 开发与测试

- **工具：** 用 uv 管理开发环境和锁定文件，用 ruff 做 lint 和格式化，用 pytest 跑测试（[技术选型 §3](./tech-stack.md#3-仓库与工具链)）。Python 版本跟随 Colab 运行时的要求。
- **不写注释。** 根目录 AGENTS.md 的规矩对 Python 一样适用，笔记本也只放代码。
- **伪 Colab。** `tests/` 用一个伪 `google.colab` 模块，再把伪的 `nvidia-smi`、`tailscaled`、`tailscale` 放在 `PATH` 前面，测试以下几项：
  - 资源低于下限时，在复制模型之前停下；
  - Drive 在服务启动之前卸载；
  - 状态目录在卸载之前复制回 Drive；
  - 首次接入和再次接入时 `up` 的参数，以及再次接入时不读认证 key；
  - 看护循环的空闲判断和进程退出；
  - 由启动器启动时：读完 `launch.json` 就删掉，Drive 已挂载时不再调用 `drive.mount`，状态行的格式和内容。
- **`pnpm test:python`** 跑宿主的 pytest。这条命令不进 `pnpm test`，因为它要求本机装有 uv。

## 12. 已知限制

- **Colab 的运行时有寿命。** 时长、GPU 供应和回收条件由 Colab 决定，见 §2。服务下线的后果各不相同：出图服务下线只影响插图，模型服务下线会中断正在用它的功能，见各服务的文档。
- **用户态网络下的入站转发和 `tailscale serve`，** Tailscale 的官方文档没有明确写出它们的行为。§14 有对应的验收用例；这两条不成立时，这种部署方式就走不通。
- **卸载之后，tailscaled 状态的变化不写回 Drive。** 带标签的节点默认不会因为 key 过期掉线，平时状态不会再变。Tailscale 要求重新认证时，用一个新的认证 key 再部署一次。
- **冷启动慢：** 从 Drive 复制模型、安装引擎、加载模型、跑自检。模型越大越慢。
- **手动运行笔记本时，代码靠手动同步到 Drive。** 仓库里的代码更新后，Drive 上的副本不会自动更新。由启动器启动时，启动器每次都上传本机仓库里的代码。
- **两个服务同时用，就要两个运行时，** 计算单元也按两份消耗。

## 13. 不做的事

- **一个运行时跑多个服务。** 理由见 §1。
- **服务运行期间保持挂载 Drive。** 理由见 §6。
- **Tailscale Funnel 或其他公网入口。** 服务不需要被公网访问。
- **临时节点。** 理由见 §7。
- **把 Headscale 作为默认的协调服务器。** 它需要一台自己的公网机器；要换的话，只需在 `tailscale up` 上加 `--login-server`，服务和 core 都不用改。
- **宿主调用服务的接口来判断就绪和空闲。** 各服务的协议不同，宿主只读状态文件（§4）。
- **把结果、提示词或日志存进 Drive。**

## 14. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 运行时的显存、内存或磁盘低于服务的下限 | 运行笔记本 | 在检查资源那一步停下，写明缺哪一项、需要多少，还没有开始复制模型 |
| 服务已就绪 | 在运行时里列出 `/content/drive` | Drive 已卸载，读不到 Drive 里的任何文件 |
| 服务已就绪 | 在 Colab 里用 Tailscale 主动连接你的 Mac，再连接另一个服务节点 | 连接都被拒绝 |
| 服务已就绪 | 在 Mac 上用节点的 tailnet 地址访问 443 以外的端口，包括服务的各个回环端口 | 都连不上 |
| 服务已就绪 | 从 Mac 访问服务地址 | 请求经 `tailscale serve` 到达服务的对外端口 |
| 第二次部署，Colab Secrets 里已经删掉认证 key | 运行笔记本 | 接入成功，节点名和服务地址与上一次相同 |
| 服务的自检失败 | 查看看护循环的输出 | 每分钟打印未就绪和服务给出的原因 |
| 服务的一个进程在运行中退出 | 查看看护循环的输出，再等 `IDLE_SHUTDOWN_MINUTES` | 打印退出的是哪个进程和退出码；之后运行时被释放 |
| 服务正在处理一个耗时超过 `IDLE_SHUTDOWN_MINUTES` 的请求 | 等待 | 运行时不被释放 |
| 服务空闲超过 `IDLE_SHUTDOWN_MINUTES` | 等待 | 运行时被释放 |
| 笔记本运行完 | 搜索所有单元格的输出 | 找不到令牌和认证 key |
| 由启动器启动，服务已就绪 | 在运行时里查看 `/content/unwritten/`，再查看启动器收到的输出 | 没有 `launch.json`；状态行里只有阶段和原因 |
| 由启动器启动，Drive 已由 `colab drivemount` 挂好 | 运行到第一步 | 宿主不再调用 `drive.mount`，也没有出现第二次授权 |
| 伪 Colab | 运行宿主的 pytest | 全部通过 |
