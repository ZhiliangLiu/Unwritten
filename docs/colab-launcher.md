# Unwritten · Colab 启动器

本文说明 `plugins/colab-launcher/`：一个常驻在 Mac 上的小服务，实现[启动器协议 `unwritten-launcher/1`](./image.md#122-启动器协议-unwritten-launcher1)，用 [Colab CLI](https://github.com/googlecolab/google-colab-cli) 按需开关运行 ComfyUI 插件的 Colab 运行时。core 什么时候唤醒、怎样等待，见[插图与出图服务 §12](./image.md#12-按需启动)；运行时里发生的事，见 [Colab 宿主](./colab-host.md)。

一句话概括：**启动器只开关运行时，不碰出图请求；令牌只经文件上传，不出现在命令行和执行的代码里。**

## 1. 定位

- **它是插件。** 它实现 Unwritten 定义的启动器协议，规则同[插件](./plugins.md)。core 不认识 Colab，只把它当作一个地址加一个令牌。
- **它和 core 在同一台 Mac 上，只监听 127.0.0.1。** Colab CLI 的登录凭据在这台 Mac 的钥匙串里，所以启动器必须跑在这里。
- **一个启动器进程只管一个服务。** 目前只有 ComfyUI 插件用它。以后多一个服务，就多开一个进程，换一个端口。
- **启动器不知道服务好没好。** 服务就绪由 core 直接问服务（[插图与出图服务 §12.1](./image.md#121-定位)），启动器只报告运行时走到了哪一步。

## 2. 目录

```
plugins/colab-launcher/
  README.md            入口地图：它是什么、怎样登录 Colab CLI、怎样常驻
  pyproject.toml       Python 版本，ruff、pytest 的配置
  uv.lock              开发依赖的锁定版本
  colab-cli.lock       钉死的 Colab CLI 版本
  launcher/            启动器服务
  bootstrap.py         交给 colab exec 的入口脚本：解包代码，再运行宿主（§5）
  tests/               pytest，带一个伪 colab 命令
```

- **依赖：** aiohttp 和 Python 标准库。Python 版本不低于 3.12，因为 Colab CLI 要求 3.12 以上。
- **Colab CLI 钉版本。** 用 `uv tool install google-colab-cli==<colab-cli.lock 里的版本>` 安装。启动器启动时运行 `colab version` 核对，版本不对就报告未就绪，原因是 `not_configured`。Colab CLI 调用的是从浏览器请求推出来的内部接口，不是公开的 API，0.x 版本之间随时可能变，所以只用验收过的版本。
- 目录里的 README 按[根目录 AGENTS.md §9](../AGENTS.md#9-源码目录的-readme) 只做入口地图，设计细节都在本文。

## 3. 配置与登录

**配置文件**放在 `~/.config/unwritten/colab-launcher.json`，权限 0600：

```json
{
  "listen": "127.0.0.1",
  "port": 8290,
  "token": "$UNWRITTEN_LAUNCHER_TOKEN",
  "host": "<仓库>/selfhost/colab",
  "service": {
    "name": "comfyui",
    "code": "<仓库>/plugins/comfyui",
    "session": "unwritten-comfyui",
    "gpu": "A100",
    "highMem": false,
    "token": "$UNWRITTEN_IMAGE_TOKEN",
    "tailscaleAuthKey": "$TS_AUTHKEY_IMAGE"
  }
}
```

- **`listen` 只能是 `127.0.0.1`。** 启动器只给本机的 core 调用，填其他地址时拒绝启动；缺省也是 `127.0.0.1`。

- **三个密钥都可以写成 `$变量名`，** 从环境变量读取，写法同 [LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)。`token` 是 core 调用启动器用的令牌，在 Unwritten 设置页生成（[插图与出图服务 §2](./image.md#2-出图服务的配置)）；`service.token` 是出图服务的令牌，和设置页里那个服务的 key 是同一个；`tailscaleAuthKey` 只在第一次部署时用到（[Colab 宿主 §7](./colab-host.md#7-colab-secrets)）。
- **`gpu` 取 Colab CLI 接受的值**（`T4`、`L4`、`G4`、`H100`、`A100`），按服务的资源下限选（[ComfyUI 插件 §8.1](./comfyui-plugin.md#81-对宿主的约定)）。
- **配置缺项或密钥读不到时，** `/v1/info` 报告未就绪，原因是 `not_configured`。

**登录 Colab CLI。** 第一次使用前，在终端里运行一次 `colab sessions`，按提示在浏览器里完成登录。CLI 把刷新令牌存进系统钥匙串，之后启动器以同一个 macOS 用户运行 CLI，不用再登录。启动器不读取这份凭据。CLI 返回 401 时，`/v1/info` 报告未就绪，原因是 `not_signed_in`。

**常驻。** README 给出一份 launchd 用户代理的配置，让启动器在登录时启动；也可以在终端里手动运行。

## 4. 状态与 Colab CLI 命令

| 协议请求或事件 | 启动器怎样做 | 状态 |
| --- | --- | --- |
| `start` | 先运行 `colab sessions`。同名会话还在，例如上次释放失败，就先 `colab stop -s <会话>`。然后按 §5 启动 | `starting` |
| 授权地址出现 | 见 §5 第 3 步 | `needs_action` |
| `continue` | 往等待授权的 `colab drivemount` 的标准输入写一个换行 | `starting` |
| 宿主报告 `serving` | 见 §5 第 4 步 | `running` |
| 宿主的入口结束 | 宿主空闲到时或出错后退出，`colab exec` 随之返回。启动器运行 `colab stop -s <会话>`，会话已经不在时也算成功 | `stopping` → `stopped` |
| `stop` | 结束本地的 `colab exec` 进程，运行 `colab stop -s <会话>` | `stopping` → `stopped` |
| 运行中，会话消失 | 每隔 `LAUNCHER_SESSION_CHECK_S`（默认 60 秒）运行一次 `colab sessions`，找不到这个会话，说明运行时已被回收 | `stopped` |
| 启动器重启 | 先运行 `colab sessions`：会话还在，就当作 `running`，只靠会话检查来跟踪；不在就是 `stopped` | `running` 或 `stopped` |

失败的映射：

| 情况 | `reason` |
| --- | --- |
| `colab new` 返回 400：这个账号没有可用的额度或加速器 | `quota` |
| CLI 返回 401 | `not_signed_in` |
| 授权地址过了有效期，没有收到 `continue` | `action_expired` |
| 其他命令失败，或宿主报告启动出错 | `start_error` |

失败后，启动器运行 `colab stop -s <会话>` 释放运行时，不让一个半途而废的运行时继续消耗计算单元。

## 5. 启动的步骤

1. **新建运行时：** `colab new -s <会话> --gpu <gpu>`，`highMem` 为 true 时加 `--high-mem`。
2. **上传。**
   - 把宿主目录和服务目录打成一个 tar 包，不含 `tests/` 和虚拟环境，上传到 `/content/unwritten/upload.tar`。代码直接取自本机的仓库，不用再手动同步到 Drive。
   - 把服务令牌、Tailscale 认证 key 和 `idleMinutes` 写进一个临时的 `launch.json`，权限 0600，上传到 `/content/unwritten/launch.json`，上传后立即删掉本地这份。
3. **挂载 Drive。** 运行 `colab drivemount -s <会话>`。
   - CLI 需要授权时，会打印「Please visit:」和一个授权地址，然后等人按回车。启动器只接受 `https://` 开头、主机属于 `google.com` 的地址，进入 `needs_action`。`action.expiresAt` 取 CLI 等待的上限，600 秒。CLI 可能同时自己打开本机的浏览器。
   - 收到 `continue` 后，启动器替用户补上回车。
   - 没打印授权地址就成功了，说明这个账号已经授权过，直接进入下一步。
4. **运行宿主。** `colab exec -s <会话> --timeout 0 -f bootstrap.py`。这个进程一直开着：
   - `--timeout 0` 去掉默认 30 秒无输出就失败的限制；
   - `bootstrap.py` 解包 `upload.tar`，再运行宿主的入口（[Colab 宿主 §8.1](./colab-host.md#81-由启动器启动)）；
   - 启动器逐行读取输出，只解析 `unwritten-host` 开头的状态行。宿主报告 `serving` 时，进入 `running`。

## 6. 安全

- **只监听 127.0.0.1。** 配置里的地址不是回环地址时，拒绝启动。
- **鉴权**按[插件 §3.2](./plugins.md#32-鉴权)：`Authorization: Bearer`，常量时间比较，令牌短于 32 个字符时拒绝启动。不返回重定向，也不返回 CORS 头。
- **密钥不进命令行，也不进执行的代码。** 命令行参数在 `ps` 里人人可见；`colab exec` 执行的代码和输出会被 CLI 记进本地日志（`colab log`）。所以令牌和认证 key 只经 `launch.json` 上传，宿主读完就删（[Colab 宿主 §8.1](./colab-host.md#81-由启动器启动)）。
- **授权地址只转交，不跟随。** 启动器只把地址交给 core，自己不访问它，也不替用户完成授权。
- **日志**只记状态变化、CLI 命令的名字、退出码和耗时，不记 CLI 的完整输出。

## 7. 开发与测试

- **工具：** uv、ruff、pytest，同[技术选型 §3](./tech-stack.md#3-仓库与工具链)。不写注释。
- **伪 colab 命令。** `tests/` 里有一个 Python 写的伪 `colab`，放在 `PATH` 前面，模拟 `version`、`sessions`、`new`、`upload`、`drivemount`、`exec`、`stop`：
  - `drivemount` 打印授权地址并等待标准输入；
  - `exec` 按脚本输出状态行，然后退出。

  用它测试这些行为：
  - 令牌校验；
  - 状态转换；
  - 同时多次 `start` 只启动一次；
  - 授权的等待、继续和过期；
  - `quota` 等失败的映射，以及失败后会释放运行时；
  - 宿主退出后执行 `colab stop`；
  - 会话消失后转为 `stopped`；
  - 启动器重启后按会话恢复；
  - 只接受 `google.com` 的 `https` 地址；
  - 命令行参数和日志里没有密钥，本地的 `launch.json` 已删除。
- **一致性测试。** `pnpm test:python` 用伪 colab 命令启动启动器，再对着它运行 core 的启动器协议一致性测试（[插图与出图服务 §12.5](./image.md#125-一致性测试)）。这条命令不进 `pnpm test`，因为它要求本机装有 uv。

## 8. 已知限制

- **Colab CLI 用的是内部接口。** Colab 一改，CLI 就可能失效。这时可以退回手动运行笔记本（[Colab 宿主 §8](./colab-host.md#8-笔记本的步骤)）。
- **每次唤醒可能都要授权一次 Drive。** Drive 的授权会不会跨运行时记住，CLI 的文档和代码都没说。要授权时，唤醒会一直等到用户点「继续」，最多 600 秒。
- **启动器在后台运行时没有终端。** CLI 等回车时先读 `/dev/tty`，读不到才读标准输入。启动器靠的是后一条，§10 有对应的验收用例。
- **运行几个小时的 `exec` 能不能让运行时一直活着，** CLI 的文档没写。它只说内核活跃时，后端会维持运行时。
- **本地的 `colab exec` 断开后，** 启动器就看不到状态行了，只能靠会话检查来跟踪运行时。
- **Mac 睡着时，关闭只能靠运行时自己。** 宿主空闲到时会调用 `runtime.unassign()`，但它在 CLI 打开的运行时里能不能用，文档没写。不能用时，运行时会留到后端因为不活跃把它回收，期间一直消耗计算单元。
- **Colab CLI 只支持 macOS 和 Linux。**

## 9. 不做的事

- **一个启动器管多个服务。** 每个服务的会话、GPU 和密钥各不相同，分开进程更简单。
- **保存 Google 凭据，或者替用户完成授权。** 登录凭据留在 CLI 的钥匙串里，授权由用户在浏览器里完成。
- **监听回环以外的地址。** 只有本机的 core 调用它。
- **用 `colab run`。** 它在脚本结束后就释放运行时，不适合长时间运行的服务。
- **在启动器这条路上读 Colab Secrets。** CLI 打开的运行时能不能读 `userdata`，文档没有写明，所以密钥由启动器上传。

## 10. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 启动器已常驻，配置齐全 | 在 Unwritten 设置页点「测试启动器」 | 显示启动器的实现名、版本和当前状态 `stopped` |
| Colab CLI 还没登录 | 点「测试启动器」 | 显示未就绪，原因是 `not_signed_in` |
| 服务关着 | 进入一个开了插图的开局 | 一个新的 Colab 运行时被创建。需要授权时，Unwritten 显示授权提示；点「打开授权页」并在浏览器里允许，再点「继续」。服务就绪后，开场图画成 |
| 启动器在后台常驻，没有终端 | 走一遍上一条 | 「继续」能让 CLI 收到回车，授权后接着启动 |
| 服务已就绪 | 运行 `ps`，再查看 `colab log` | 都找不到服务令牌、启动器令牌和认证 key |
| 服务已就绪 | 在运行时里查看 `/content/unwritten/` | 没有 `launch.json` |
| 服务已就绪，连续空闲超过 `idleMinutes` | 等待，再运行 `colab sessions` | 运行时已释放，启动器状态是 `stopped` |
| 服务已关闭 | 在开局里点一张插图的「重试」 | 再次唤醒，图画成 |
| 一个运行了几个小时的会话 | 持续游玩、出图 | 运行时没有被中途回收 |
| 服务运行中 | 结束启动器进程再重新启动 | 状态恢复为 `running` |
| 服务运行中 | 在 Colab 网页上手动断开运行时 | 一个会话检查周期内，状态变为 `stopped` |
| 账号没有 A100 的额度 | 唤醒 | 状态变为 `failed`，原因是 `quota`；Unwritten 显示唤醒失败；`colab sessions` 里没有残留的会话 |
| 伪 colab 命令 | 运行启动器的 pytest | 全部通过 |
