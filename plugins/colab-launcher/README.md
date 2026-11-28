# Colab 启动器

实现[启动器协议 `unwritten-launcher/1`](../../docs/image.md#122-启动器协议-unwritten-launcher1)的插件，常驻在 Mac 上，用 [Colab CLI](https://github.com/googlecolab/google-colab-cli) 按需开关 Colab 运行时。设计见 [Colab 启动器](../../docs/colab-launcher.md)，运行时里的步骤见 [Colab 宿主 §8.1](../../docs/colab-host.md#81-由启动器启动)。

## 负责什么

- 提供 `GET /v1/info`、`GET /v1/state`、`POST /v1/start`、`POST /v1/continue`、`POST /v1/stop`，只监听 `127.0.0.1`。
- 用 Colab CLI 新建、上传、授权、执行和释放运行时。
- 把宿主目录和服务目录打成一个 tar 包，连同一个权限 `0600` 的 `launch.json` 上传到运行时。
- 解析宿主输出的 `unwritten-host <JSON>` 状态行，把阶段映射成启动器状态。

## 不归它管

- 出图服务本身的协议、就绪和空闲判断，由服务负责。
- Colab 宿主怎样准备、启动服务，由 `selfhost/colab/` 负责。
- 用户何时需要唤醒，由 core 决定（[插图与出图服务 §12.3](../../docs/image.md#123-core-怎样唤醒)）。
- 登录凭据保存在 Colab CLI 的系统钥匙串里，启动器不读取。

## 从哪里开始读

- `launcher/__main__.py`：进程入口。
- `launcher/config.py`：配置的读取、权限和 `$变量名` 解析。
- `launcher/cli.py`：每个 Colab CLI 命令一个函数。
- `launcher/machine.py`：状态机与启动步骤。
- `launcher/app.py`：aiohttp 路由、鉴权和幂等。
- `bootstrap.py`：交给 `colab exec` 的运行时入口。
- `launcher/status_lines.py`：状态行的解析。
- `launcher/packaging.py`：tar 包和 `launch.json`。

## 稳定契约

- 配置文件默认在 `~/.config/unwritten/colab-launcher.json`，权限必须是 `0600`；路径可以用 `UNWRITTEN_LAUNCHER_CONFIG` 覆盖。
- `listen` 只能写 `127.0.0.1`。缺省就是它。
- `token` 和 `service.token` 可以写成 `$变量名`，从环境变量读取；令牌短于 32 个字符时进程拒绝启动，信息里不回显令牌。
- 启动器令牌用于 core 调用启动器；服务令牌和 Tailscale 认证 key 只进入上传的 `launch.json`，不进命令行参数，也不进 `colab exec` 的代码。本地这份文件在上传后立即删除。
- 授权地址只接受 `https` 且主机是 `google.com` 或它的子域，启动器自己从不访问它。
- 日志只记状态变化、CLI 命令名、退出码和耗时，不记 CLI 的输出。

## 安装与运行

### 1. 安装 Colab CLI

```bash
uv tool install google-colab-cli==0.8.0
```

版本以 `colab-cli.lock` 为准。启动器启动时运行 `colab version` 核对，版本不符时 `/v1/info` 报告 `not_configured`。

### 2. 登录

```bash
colab sessions
```

按提示在浏览器里完成登录。凭据存进系统钥匙串，之后不用再登录。

### 3. 写配置

```bash
mkdir -p ~/.config/unwritten
```

```json
{
  "port": 8290,
  "listen": "127.0.0.1",
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

```bash
chmod 600 ~/.config/unwritten/colab-launcher.json
```

`token` 是 Unwritten 设置页为启动器生成的令牌；`service.token` 和设置页里出图服务的 key 是同一个；`tailscaleAuthKey` 只在第一次部署时用到。由 launchd 启动时拿不到 shell 的环境变量，直接把密钥写进配置文件，或在 plist 的 `EnvironmentVariables` 里给出变量。

### 4. 手动运行

```bash
uv run --frozen --directory plugins/colab-launcher python -m launcher
```

`colab` 不在 `PATH` 里时，用 `UNWRITTEN_COLAB_BIN` 指向它。

### 5. 常驻

在仓库根目录执行，把两个占位替换成实际路径：

```bash
sed -e "s|{{UV}}|$(command -v uv)|" -e "s|{{REPO}}|$(pwd)|" \
  plugins/colab-launcher/launchd/unwritten-colab-launcher.plist.template \
  > ~/Library/LaunchAgents/unwritten.colab-launcher.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/unwritten.colab-launcher.plist
```

日志写在 `/tmp/unwritten-colab-launcher.log`。`colab` 不在 plist 的 `PATH` 里时，在 `EnvironmentVariables` 里加一项 `UNWRITTEN_COLAB_BIN`，值用 `command -v colab` 的输出。停止并移除：

```bash
launchctl bootout gui/$(id -u)/unwritten.colab-launcher
```

### 6. 在 Unwritten 里填写

在设置页的出图服务里填启动器地址 `http://127.0.0.1:8290` 和在设置页生成的令牌。之后 core 会在需要时唤醒运行时，需要授权时显示「打开授权页」和「继续」。

## 测试

```bash
uv run --frozen --directory plugins/colab-launcher pytest -q
```

测试全部使用 `tests/fake_colab.py` 伪命令，不会创建真实的 Colab 运行时。`pnpm test:python` 还会用 `tests/serve_with_fakes.py` 启动一个启动器，对着它跑 core 的启动器一致性测试。
