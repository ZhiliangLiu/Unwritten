# Unwritten · 架构总览

本文说明 Unwritten 由哪几部分组成、各部分在哪里运行、彼此怎样通信，以及几个关键选型的理由；完整的技术选型见[技术选型](./tech-stack.md)。用户能看到的行为以[创作流程](./authoring-flow.md)和[游玩流程](./gameplay-flow.md)为准，技术文档只写实现方式。

## 文档索引

这是全仓唯一的文档索引，README 链接到这里。

| 文档 | 回答什么 |
| --- | --- |
| [创作流程](./authoring-flow.md) | 作者能看见的行为：从写背景到存入作品库、试玩和改稿 |
| [游玩流程](./gameplay-flow.md) | 玩家能看见的行为：阅读、行动、存档、分线和结局 |
| [架构总览](./architecture.md) | 系统分哪几部分，进程怎样运行，彼此怎样通信 |
| [技术选型](./tech-stack.md) | 每一部分用什么技术和库、为什么，以及项目目录结构 |
| [数据模型](./data-model.md) | 作品版本、回合树、故事事实怎样存储；一条路线能看见哪些事实 |
| [回合循环](./turn-loop.md) | 游玩时 AI 每回合读什么、怎样提交结果，core 怎样校验和保存 |
| [创作工作站](./author-workstation.md) | 创作时的对话面板、提案卡，以及怎样写入草稿 |
| [LLM 端点](./llm-endpoints.md) | 模型服务怎样配置、探测、按用途分配 |
| [运行诊断与性能记录](./diagnostics.md) | 本机诊断库、事件、计时起止点和查询口径 |
| [设计准则](./design-guidelines.md) | 界面的视觉方向：版式、布局、层次、颜色、图标、文案语气 |
| [主题与 token](./theme.md) | 全部视觉 token、浅色与深色主题、外观切换、为将来主题预留的材质 |
| [动效](./motion.md) | 动效原则、动效 token、各场景编排、实现规则 |
| [i18n](./i18n.md) | 界面文案、core 返回的内容、作品语言、中文排版与输入法 |
| [a11y](./a11y.md) | 可访问性目标、分工、各页面的做法、测试 |
| [第一个里程碑](./milestone-1.md) | 模型设置、创作和续玩的交付范围与验收条件 |
| [第二个里程碑](./milestone-2.md) | 故事事实与推送拉取、界面打磨、按用途的生成参数的交付范围与验收条件 |
| [第三个里程碑](./milestone-3.md) | 桌面外壳与本机安装包、作者设定向导及其在游玩中的兑现的交付范围与验收条件 |

## 1. 四个组成部分

| 部分 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| **client** | 所有界面：作品库、创作向导、工作站面板、游玩阅读页、设置。它是一个纯 web 应用 | 不访问数据库、文件或模型服务；不写桌面专属的代码分支 |
| **core** | 全部业务逻辑：作品与版本、回合循环、创作工作站、故事事实与可见性、LLM 调用、配置文件。对外提供 HTTP 接口（调用与事件流），同时把 client 的构建产物发给浏览器 | 不依赖 Electron。和 desktop 之间只有一条进程消息通道（§2.3），没有 desktop 也能独立运行 |
| **contracts** | client、core、desktop 之间共用的契约：client 与 core 之间的接口类型与校验 schema，以及 core 与 desktop 之间的进程消息类型（§2.3） | 不含业务逻辑 |
| **desktop** | Electron 外壳：单实例、窗口、菜单、外部链接、原生外观；负责启动并看护 core | 不含业务逻辑；和 core 之间只用 §2.3 的进程消息通道 |

依赖方向是 client → contracts ← core，desktop 也只依赖 contracts 里的进程消息类型。desktop 只负责启动 core，并打开 core 提供的地址。client 和 desktop 都不导入 core 的任何代码。

**为什么这样分。** 以后可能会有 web 客户端。只要 client 是纯 web 应用、只通过 contracts 和 core 通信，做 web 版时就只需把 core 当作普通服务运行，再把同一份 client 发给浏览器，不必另做一套界面或接口。这个分法参照了 thinkrail：它的 `apps/web`、`packages/server`、`packages/contracts`、`apps/desktop` 分别对应这里的 client、core、contracts、desktop，桌面外壳只承载同一份 web 客户端（thinkrail `apps/desktop/SPEC.md`）。

## 2. 进程模型

```
Electron 主进程（desktop）
 ├─ utilityProcess：core（运行在 Electron 自带的 Node 上）
 │    ├─ SQLite：library.db、diagnostics.db
 │    ├─ providers.json
 │    └─ HTTP（调用与事件流），监听 127.0.0.1 的随机端口
 └─ BrowserWindow：client，打开 http://127.0.0.1:<端口>/#token=<令牌>
```

启动顺序：

1. 主进程取得单实例锁，生成一个本次启动有效的随机令牌。单实例锁按数据目录区分。
2. 主进程用 `utilityProcess.fork` 启动 core，不带命令行参数；登录 shell 的环境变量经 `fork` 的 `env` 选项传入。随后发一条 `start` 消息，带数据目录、令牌、端口、client 目录和日志级别（§2.3）。令牌不放进命令行，因为本机任何进程都能用 `ps` 看到命令行参数。环境变量不走消息，因为 core 的模块一加载就可能读取它们，消息到达时已经晚了。
3. core 先打开诊断库，再打开作品库、执行迁移、读取 providers.json，在回环地址上监听 0 端口（由系统分配空闲端口），再把实际端口告诉主进程。
4. 主进程用这个端口和令牌打开窗口。端口不保存，每次启动都重新分配。若迁移失败、数据目录被占用，或 core 在 30 秒内没有就绪（常量 `CORE_READY_TIMEOUT_MS`），desktop 用原生对话框说明原因，有诊断编号时一并附上，提供「重试」和「退出」。就绪超时和启动中途退出是 desktop 自己发现的，没有诊断编号。同一数据目录同时只允许一个 core 持有写入权，独立运行也遵守这条规则。
5. 如果 core 意外退出，主进程用原生对话框提供「重启」和「退出」。重启时生成新令牌，用新地址重新打开同一个窗口。已提交的数据都在 SQLite 里；正在生成的请求按[回合循环 §8](./turn-loop.md#8-中断与恢复)处理。
6. 退出应用时，主进程发 `stop` 消息，等 core 关闭作品库、提交诊断后退出；5 秒内没退出（常量 `CORE_STOP_TIMEOUT_MS`）就强制结束。窗口全部关闭时，所有平台都退出应用。

**启动错误为什么用原生对话框，而不是错误页。** 窗口不使用 preload 脚本（§2.1），HTML 错误页上的「重试」按钮没有办法通知主进程；另做一套本地页面还要单独处理内容安全策略。原生对话框不经过渲染进程，文案由 desktop 自己提供（[i18n §3](./i18n.md#3-方案与文件)）。

**读取登录 shell 的环境变量最多等 5 秒**（常量 `SHELL_ENV_TIMEOUT_MS`）。shell 的配置文件卡住时，用 desktop 自己的环境变量启动 core，并记一条运行事件，以免应用永远打不开。

**core 为什么放在 utilityProcess，而不是主进程。** core 崩溃或长时间执行同步任务时，窗口和菜单不会跟着卡住。它用的是 Electron 自带的 Node，不需要另外打包一个可执行文件。OpenCode 桌面版在 Tauri 上单独打包 sidecar 时遇到过启动变慢、偶尔起不来的问题，迁到 Electron 后让 server 直接跑在 Electron 自带的 Node 里。

**为什么用 Electron。**

- core 用 TypeScript 写。如果用 Tauri，Rust 那一层只负责开窗口，却要求 core 单独打包成 sidecar。
- Electron 在各平台都用 Chromium，渲染一致；Tauri 在 macOS 和 Linux 上用系统 WebKit。
- 主流 agent 客户端都用 Electron：OpenAI Codex 桌面版是 Electron，OpenCode 桌面版也已经从 Tauri 迁到 Electron。
- 代价是安装包更大、内存占用更高。这个代价我们接受。

thinkrail 用的是 Electrobun：主进程是 Bun，core 直接嵌在主进程里，界面用系统 webview。它的安装包小，但框架还很年轻，而且和 Tauri 一样要面对 WebKit 渲染不一致的问题。

### 2.1 本机接口的安全

core 只监听回环地址。不过本机的其他程序，以及浏览器里打开的任何网页，都能尝试访问这个端口，所以要加以下防护：

- **令牌。** 每个 `/api` 请求都必须带 `Authorization: Bearer <令牌>`，事件流也是普通的 HTTP 请求，用同一个请求头鉴权。client 在页面加载时从地址的 `#token=` 读出令牌，只保存在内存里，然后用 `history.replaceState` 从地址栏抹掉。令牌放在 hash 里，是因为 hash 不会随请求发给服务器，也就不会出现在日志里。静态文件（HTML、JS、CSS）不需要令牌。HTML 只注入主题文档所列的外观与阅读枚举；不包含作品、模型配置或凭据。HTML 不使用缓存，构建出的静态资源可按内容指纹缓存。
- **带令牌的地址是唯一入口。** 令牌不写进任何浏览器存储，所以在生产构建里，刷新页面、从地址栏复制地址再打开，都拿不到令牌。开发构建的例外见 §7。页面加载时地址里没有令牌，client 不发任何 `/api` 请求，只显示一页固定说明：独立运行时请从 core 打印的地址重新打开，桌面版请重启应用。desktop 需要重新加载窗口时（例如渲染进程崩溃后），一律用带令牌的地址重新打开，菜单里也不提供原地刷新。渲染进程崩溃后先自动重开一次；重开后 10 秒内又崩溃，就改弹原生对话框，让用户选重新打开或退出，免得一直崩溃时无限重开。
- **Host 与 Origin 检查。** `Host` 只接受 `127.0.0.1:<端口>` 或 `localhost:<端口>`，以挡住 DNS 重绑定攻击。带 `Origin` 的请求，`Origin` 必须和页面同源。core 不返回任何 CORS 头。
- **窗口。** 开启 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，不使用 preload 脚本。窗口不能跳转到其他地址，外部链接一律交给系统浏览器打开。
- **内容安全策略。** core 返回 `index.html` 时带上 `Content-Security-Policy` 响应头，nonce 每次请求重新生成：

  ```
  default-src 'self'; script-src 'self' 'nonce-<本次 nonce>'; style-src 'self'; connect-src 'self';
  img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  ```

  - 唯一的内联脚本是首屏前解析外观的那一段，它带本次的 nonce（[主题与 token §9](./theme.md#9-外观偏好与切换)）。
  - 样式只来自构建出的 CSS 文件，所以 `style-src` 不需要 `'unsafe-inline'`。组件的 `style` 属性只用来设置 CSS 自定义属性，React 通过 CSSOM（`element.style.setProperty`）写入，不受 `style-src` 限制；HTML 里的 `style` 属性和 `setAttribute('style', …)` 才会被拦。
  - 这套策略由 core 下发，只在生产构建里生效。开发时页面由 Vite 提供，不带这套策略，所以内容安全策略相关的验收用生产构建做。
- **AI 输出与用户内容一律按纯文本渲染。** 正文、选项、作者设定、玩家输入、模型返回的错误信息都靠 React 默认的转义来显示，不经过 `dangerouslySetInnerHTML` 或 `innerHTML`。AI 的输出可能受提示注入影响，一旦被当成 HTML 执行，攻击代码就能拿到内存里的令牌，并调用 core 的全部接口。
- **API key 只在 core 里。** client 只能知道某个端点有没有配置 key，见 [LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)。

### 2.2 core 独立运行

`node packages/core/dist/main.js --data-dir <目录> [--port <端口>] [--client-dir <目录>] [--client-origin <地址>] [--log-level <级别>]` 会启动 core，并在 stdout 打印一行 `UNWRITTEN_CORE_URL=<带令牌的地址>`，用浏览器打开这个地址即可使用。`--client-dir` 指定 client 构建产物的目录，默认是仓库里的 `apps/client/dist`；`--client-origin` 只改变打印出的地址的源，开发时传 Vite 开发服务器的地址；`--log-level` 默认 `info`。这个模式有两个用途：开发调试，以及将来 web 客户端的基础。部署成多人使用的服务需要真正的账号鉴权，这不在本设计范围内。

**一个 core 可以同时被多个页面连接。** 桌面版只有一个窗口；但独立运行时，同一个地址可以在多个浏览器标签页里打开，将来的 web 客户端也一样。每个标签页都从 core 打印的带令牌地址打开，共用本次启动的令牌（§2.1）。并发写入不靠“只有一个页面”来保证，而是靠幂等键和比较再更新（§3、[回合循环 §2](./turn-loop.md#2-回合请求)）；事件流把每一处变化推给所有连着的页面。

### 2.3 core 与 desktop 的进程消息通道

desktop 用 `utilityProcess.fork` 启动 core 时，两者之间有一条 Electron 提供的进程消息通道。这是 core 和 desktop 之间唯一的接口，只传下面几类消息：

| 方向 | 消息 | 用途 |
| --- | --- | --- |
| desktop → core | `start`：数据目录、令牌、端口、client 目录、client 的源、日志级别 | 启动 core。core 只认第一条合法的 `start` |
| desktop → core | `log`：desktop 的一条运行事件或性能样本 | 由 core 写进诊断库（[运行诊断 §1](./diagnostics.md#1-存储与生命周期)） |
| desktop → core | `stop` | 正常退出：关闭作品库、提交诊断 |
| core → desktop | `ready`：实际监听的端口与当前外观偏好 | desktop 据此打开窗口 |
| core → desktop | `start-failed`：失败原因与诊断编号 | desktop 在启动错误对话框里显示 |
| core → desktop | `appearance-changed`：新的外观偏好 | desktop 同步 `nativeTheme.themeSource`（[主题与 token §9](./theme.md#9-外观偏好与切换)） |

登录 shell 的环境变量不走这条通道，由 `fork` 的 `env` 选项传入（§2，[LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)）。

core 用 `process.parentPort` 是否存在判断自己是否由 desktop 启动：存在时不读命令行，等 `start` 消息，也不打印启动地址。core 独立运行时没有这条通道：启动参数从命令行读取，令牌由 core 自己生成，core 发给 desktop 的消息直接不发。消息的类型定义放在 contracts 的 `desktop.ts` 里，作为 `@unwritten/contracts/desktop` 单独导出，和 client 的契约分开（[技术选型 §6](./tech-stack.md#6-contracts)）。每条消息到达时都按这些 schema 校验，不合格的丢弃并记一条运行事件，不中断进程。


## 3. client 与 core 的通信

- **用 oRPC 契约通信。** 每一个调用的输入、输出和错误都定义在 contracts 里（[技术选型 §6](./tech-stack.md#6-contracts)）。core 实现契约，client 直接从契约生成客户端，不导入 core 的任何代码。core 在入口处按契约校验每一个输入，这里是信任边界。设置、LLM 端点等所有接口都是契约里的过程，没有绕开契约的 HTTP 路由；Hono 只负责静态文件、令牌与 Host 校验，以及挂载契约的实现。
- **一条事件流：** client 打开一条事件流（oRPC 的事件迭代器，底层是 HTTP 流式响应），core 通过它推送通知，包括请求状态变化、回合已提交、生成任务进度、端点配置变化、外观偏好变化。选 HTTP 流式响应而不是 WebSocket，是因为推送只有从 core 到 client 一个方向；而且它和普通调用走同一套令牌鉴权与同源检查，不需要另一套握手协议。
- **事件只是通知，状态以 HTTP 查询的结果为准。** client 建立或重建事件流后，重新拉取当前页面及未结束请求的数据。拉取期间收到的变更通知仍使相关查询失效，旧查询结果不得覆盖已知的新状态，不补发错过的事件。这样就不需要维护事件序列，core 始终是唯一的事实来源。
- **有副作用的命令都带幂等键。** 回合请求用 client 生成的 `request_id`；确认提案卡用服务端已经存在的卡片 id。同一意图的双击和网络重发复用一个键。SQLite 命令在同一个事务内登记键并写入结果；异步命令在事务内登记唯一的任务。配置文件命令的去重规则见 [LLM 端点 §2](./llm-endpoints.md#2-providersjson)。同一键提交不同参数时拒绝；重复提交相同参数时返回已有结果或异步请求的当前状态。修改中的草稿和路线操作另外验证客户端所见修订号或决定点。

## 4. core 的内部模块

| 模块 | 负责什么 |
| --- | --- |
| `store` | SQLite 连接、迁移、事务 |
| `library` | 作品、版本（草稿 / 试玩快照 / 发布版本）、作品库列表 |
| `story` | 实体、事实、知情、状态；沿祖先链的可见性投影；全文检索 |
| `play` | 开局、回合树、路线、存档、回合循环 |
| `authoring` | 创作向导、生成任务、工作站的对话与提案卡 |
| `llm` | providers.json、对 pi-ai 的封装、用途分配、调用记录 |
| `log` | 本机运行事件和性能记录的校验与写入，见[运行诊断与性能记录](./diagnostics.md) |
| `events` | 进程内事件总线：各模块发布变更通知，事件流过程订阅后推给 client |
| `api` | Hono 应用：令牌与 Host 校验、静态文件、挂载契约的实现 |

两条硬规则：

1. **读取故事事实只能通过 `story` 模块。** 回合循环的只读工具、工作站的只读工具、client 的状态栏和手记，都调用同一套投影函数。防剧透的规则全部写在投影里，绕过它就会泄露信息。
2. **只有 `llm` 模块导入 pi-ai。** pi-ai 更新很快，把它限制在一个模块里，升级时只需要改这一处。

## 5. 技术选型

每一部分用什么技术和库、理由和不选的方案，都在[技术选型](./tech-stack.md)。本文只保留和进程模型直接相关的那一个：外壳用 Electron，理由见 §2。

模型在哪里运行（本机还是云端）由 providers.json 决定，作品库永远存在本机。这是两个独立的决定。

## 6. 数据目录

core 使用 desktop 传进来的数据目录，桌面版的数据目录是 Electron 的 `app.getPath('userData')`。设了环境变量 `UNWRITTEN_USER_DATA_DIR` 时，desktop 改用它（相对路径按启动时的工作目录解析），开发模式和端到端测试靠它把数据放到别处：

```
<数据目录>/
  library.db        作品库：全部作品、版本、路线、对话
  providers.json    LLM 端点与 key；macOS、Linux 上文件权限为 0600，Windows 上依赖用户目录的访问控制
  diagnostics.db    core、client 与 desktop 的运行事件和性能样本
```

作品库与诊断库的迁移分别在 `packages/core/src/store/migrations/` 和 `packages/core/src/log/migrations/`。core 打开各库时按编号执行对应的迁移。

## 7. 目录结构

完整的目录结构见[技术选型 §11](./tech-stack.md#11-目录结构)。

开发时，core 用 `node --watch` 独立运行；client 用 Vite 开发服务器，把 `/api` 代理到 core。代理转发时把 `Host` 和 `Origin` 都改写成 core 的地址：Vite 代理的 `changeOrigin` 只改写 `Host`，`Origin` 要另外设置。core 的 Host 与 Origin 检查（§2.1）不为开发模式开例外，core 里没有只在开发时放行的分支。令牌在请求头里，代理原样转发。desktop 设了环境变量 `UNWRITTEN_DEV_CLIENT_ORIGIN`（只接受回环地址的 http 源，写错时 desktop 在 stderr 说明原因后退出）时进入开发模式：core 直接跑 `packages/core/src/main.ts` 源码，监听 Vite 代理写死的 4317 端口，窗口打开 Vite 的地址，令牌照样放在地址的 hash 里传给 client。没有这个变量、也没有打包时，desktop 跑仓库里 core 和 client 的构建产物；打包后跑资源目录里的那一份。desktop 的开发模式和独立运行的 core 抢同一个端口和数据目录，两者不同时运行。开发时的数据目录是仓库下的 `.data/`，它已列入 `.gitignore`，因为里面的 providers.json 含有 key。

代理改写了 `Origin`，core 的 Origin 检查在开发时就分不清请求来自哪个页面。这一层防护改由 Vite 开发服务器自己的两项默认检查承担：`server.allowedHosts` 只响应 `localhost`、`.localhost` 下的域名和 IP 地址，挡住 DNS 重绑定；`server.cors` 只允许 `localhost`、`127.0.0.1`、`[::1]` 这几类源跨域。所以 Vite 配置里不放宽这两项（例如设成 `true`），也不改 `server.host` 让它监听回环以外的地址。即便如此，本机其他端口上的页面仍然能经过代理发请求，挡住它们的只有令牌。

开发构建（`import.meta.env.DEV`）不从地址栏抹掉令牌。Vite 整页重载时调用 `location.reload()`，地址的 hash 会保留，令牌就还在；抹掉的话，每次整页重载都会落到 §2.1 的说明页。代价是开发时地址栏里看得见令牌，这只发生在本机的开发环境里。生产构建照常抹掉。

## 8. 不做的事

- **多人共用一个 core 的账号体系。** core 只服务本机的一个用户，令牌只证明“是本次启动打开的页面”，不区分人。
- **把 core 部署成公网服务。** 回环地址、令牌和 Host 检查都是按本机场景设计的。
- **core 嵌在 Electron 主进程里运行。** 那样 core 崩溃或长时间计算会拖住窗口和菜单（§2）。
- **窗口全部关闭后保留应用进程。** macOS 的惯例是保留，但那样没有窗口时 core 仍在运行，还要处理重新开窗时的令牌。应用只有一个窗口，关掉就退出。

## 9. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| core 独立运行 | 用浏览器打开 core 打印出的地址，走一遍创作和游玩 | 和桌面窗口的行为完全一致，client 代码里搜不到桌面专属分支 |
| 游玩中正在生成 | 强制结束 core 进程 | 窗口显示错误页，可以重启；重启后已保存的路线完整，刚才的请求显示为“本段未完成”，可以重试 |
| core 正在运行 | 用另一个网页向它的端口发请求，分别不带令牌、伪造 Host | 请求全部被拒绝 |
| 生产构建，页面已经打开 | 刷新页面；或者打开去掉 `#token=` 的同一个地址 | 不发出任何 `/api` 请求，页面显示从带令牌的地址重新打开的说明 |
| 开发模式，Vite 代理到 core | 在 Vite 提供的页面里调用任意接口，再改一个触发整页重载的文件 | 调用成功；重载后令牌仍在地址里，接口照常可用；core 的 Host 与 Origin 检查没有开发模式的例外 |
| 生产构建，core 独立运行 | 在两个浏览器标签页里分别打开 core 打印出的带令牌地址，一边提交行动，一边看事件 | 两个标签页都收到回合已提交的事件；页面上没有被内容安全策略拦下的脚本或样式 |
| 桌面版正在运行 | 用 `ps` 查看 core 进程的命令行 | 命令行里没有令牌和数据目录 |
| 桌面版正在运行 | 用同一个数据目录再启动一次应用 | 没有第二个窗口，已有窗口被聚焦 |
| 另一个 core 占着数据目录 | 启动桌面版 | 原生对话框说明数据目录被占用并给出诊断编号；占用解除后点「重试」进入作品库 |
