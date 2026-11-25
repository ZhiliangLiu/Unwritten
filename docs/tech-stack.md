# Unwritten · 技术选型

本文列出每一部分用什么技术和库、为什么选它，以及项目的目录结构。进程模型和各部分的职责见[架构总览](./architecture.md)。

## 1. 选型原则

- **质量第一。** 选成熟、稳定、类型完整、维护活跃的方案，不因为“实现起来省事”而降低标准。
- **同等质量时选更流行的。** 生态更大，例子更多，AI 写起来也更顺手。
- **服从架构约束：**
  - client 不导入 core，两者只通过 contracts 通信；
  - 样式只用 token；
  - 编译器用 TypeScript 7。
- **版本只有一处来源。** 本文只写主版本号，确切版本统一写在 `pnpm-workspace.yaml` 的 catalog 里，各个包用 `catalog:` 引用。
- **不为一两行代码引入依赖。** Node 和浏览器已经提供的能力，直接用平台自带的。例如 id 用 `crypto.randomUUID()`，日期格式化用 `Intl`。

## 2. 总览

| 部分 | 技术 |
| --- | --- |
| 仓库 | pnpm 12 workspaces + catalog、Turborepo 2 |
| 语言与编译 | TypeScript 7（原生编译器）、Node 24 |
| 构建 | Vite 8（client）、tsdown（core、desktop）、Lightning CSS |
| desktop | Electron 45、electron-builder 26、electron-updater 6、@electron/fuses、shell-env |
| client | React 19 + React Compiler、Base UI 1、CSS Modules、TanStack Router 1、TanStack Query 5、Zustand 5、React Hook Form 7、TanStack Virtual 3、i18next + react-i18next、lucide-react、jsdiff |
| contracts | Zod 4、oRPC contract 1 |
| core | Hono 4 + @hono/node-server、oRPC server 1、Drizzle ORM 1 + drizzle-kit 1、`node:sqlite`、pi-ai + pi-agent-core 1、p-queue |
| 测试 | Vitest 5（Node 环境 + 浏览器模式）、Playwright、Testing Library、axe-core、fast-check、MSW、pi-ai 的测试用伪服务商 |
| 代码质量 | oxlint + oxlint-tsgolint、Prettier 3、Stylelint 18、husky + lint-staged、GitHub Actions |

## 3. 仓库与工具链

| 技术 | 用途 | 理由 |
| --- | --- | --- |
| **pnpm 12** | 包管理、workspaces | 依赖隔离严格，不会让一个包悄悄用到它没声明的依赖。catalog 让全仓的版本只有一处来源（thinkrail 用的也是 catalog） |
| **Turborepo 2** | 任务编排与缓存 | `build`、`test`、`lint`、`typecheck` 按依赖顺序执行，结果可以缓存；同类工具里使用最广，比 Nx 轻 |
| **TypeScript 7** | 类型检查 | 用 Go 重写的原生编译器，比 5.x、6.x 快一个数量级。用 Turbo 按包运行 `tsc --noEmit`，各包直接检查所用的 contracts 源码。工具链的兼容情况见 §10 |
| **Node 24** | 开发和独立运行 core 时的运行时 | 和 Electron 45 内置的 Node 主版本一致，避免开发时和打包后的行为不同。版本写在 `.node-version` 和各包的 `engines` 里 |
| **Vite 8** | client 的开发服务器与构建 | 事实标准；8.x 用 Rolldown 打包 |
| **tsdown** | core、desktop 的打包 | 基于 Rolldown，和 Vite 8 用同一套打包器；是 tsup 的继任者 |
| **Lightning CSS** | CSS 转换 | 由 Vite 内置调用，负责 CSS Modules、嵌套语法和 `@custom-media` 断点（[主题与 token §4.4](./theme.md#44-层级不透明度断点)），不再需要 PostCSS |

**内部包直接导出 TypeScript 源码。** `packages/contracts` 不单独构建，`exports` 直接指向 `src/*.ts`，由使用它的 Vite 和 tsdown 一起打包。这样不需要生成 `.d.ts`，也就避开了 TS 7 下生成声明文件的工具兼容问题。它有两个入口：`@unwritten/contracts` 是 client 与 core 之间的契约，`@unwritten/contracts/desktop` 是 core 与 desktop 之间的进程消息类型。desktop 只导入后者，打包时不会带上整份 oRPC 契约。

## 4. desktop

| 技术 | 用途 | 理由 |
| --- | --- | --- |
| **Electron 45** | 外壳 | 选它的理由见[架构总览 §2](./architecture.md#2-进程模型)。内置 Chromium 156，`@starting-style`、View Transitions、`text-autospace`、`text-spacing-trim` 都能直接用 |
| **electron-builder 26** | 打包、签名、macOS 公证、安装包 | 使用量远超官方的 Electron Forge，签名、公证、增量更新都很成熟 |
| **electron-updater 6** | 自动更新 | 与 electron-builder 配套；用 GitHub Releases 作为更新源 |
| **@electron/fuses** | 打包时关闭不需要的 Electron 能力 | 例如关闭 `RunAsNode`、开启 asar 完整性校验，缩小攻击面。在 electron-builder 的配置里声明 |
| **shell-env** | 从访达或 Dock 启动时，读取登录 shell 的环境变量 | providers.json 里的 `$VAR` 写法依赖它（[LLM 端点 §3](./llm-endpoints.md#3-key-的来源与保护)） |

desktop 的主进程代码只有几百行：开窗口、启动和看护 core、同步原生外观、自动更新。它用 tsdown 打包。client 和 core 的构建产物都放进安装包的资源目录：窗口不直接加载 client 的文件，而是由 core 通过 HTTP 提供。

## 5. client

| 技术 | 用途 | 理由 |
| --- | --- | --- |
| **React 19** + **React Compiler 1** | 界面 | 生态最大。React Compiler 自动做记忆化，组件里不再需要手写 `useMemo`、`useCallback`。Vite 的 React 插件用 `reactCompilerPreset()` 和 `@rolldown/plugin-babel` 接入编译器，Babel 运行依赖是 `@babel/core` |
| **Base UI 1** | 组件基础 | 无样式组件中当前最主流的一个，也是 shadcn/ui 新项目的默认底座。负责键盘操作、焦点管理和 ARIA 语义，样式完全由我们决定（[a11y §2](./a11y.md#2-分工)） |
| **CSS Modules** | 样式 | 样式只用 token，由 Stylelint 强制（[主题与 token §12](./theme.md#12-强制检查)） |
| **TanStack Router 1** | 路由 | 路由、路径参数和查询参数都有完整的类型。下载量不如 React Router，但类型安全更好，按质量优先的原则选它；和 TanStack Query 也是同一个生态。用文件路由，配合 `@tanstack/router-plugin` 生成路由树 |
| **TanStack Query 5** | 服务端数据的缓存、请求、失效 | 事实标准。服务端数据只放在这里，不进 Zustand |
| **Zustand 5** | 纯界面状态 | 例如面板开合、当前选中的标签页。轻量，同类里下载量最高 |
| **React Hook Form 7** + `@hookform/resolvers` | 表单 | 设置页、端点配置、提案卡上的问题。用同一份 Zod schema 校验，和 contracts 共用 |
| **TanStack Virtual 3** | 长列表虚拟化 | 用于很长的剧情流和作品库。不定高的行也能处理 |
| **oRPC client** + `@orpc/tanstack-query` | 调用 core | 直接由 contracts 里的契约生成带类型的客户端，不导入 core 的任何代码（§6） |
| **i18next** + **react-i18next** | 界面文案 | 见 [i18n §3](./i18n.md#3-方案与文件) |
| **lucide-react** | 图标 | 见[设计准则 §7](./design-guidelines.md#7-图标) |
| **jsdiff**（`diff`） | 文字差异 | 提案卡上的修改前后对比、开场核对 |

不引入动画库。动效以 CSS transition 和 token 为基础，循环反馈和主题切换按动效文档实现（[动效 §6](./motion.md#6-实现规则)）。将来出现松手后需要继续运动的手势时，再引入 Motion（原 Framer Motion）。

## 6. contracts

| 技术 | 用途 | 理由 |
| --- | --- | --- |
| **Zod 4** | 所有接口数据的 schema；core 在信任边界上做校验；client 用来校验表单 | 同类里使用最广。4.x 能直接导出 JSON Schema（`z.toJSONSchema`），pi 的工具参数用的正是 JSON Schema，所以回合循环的工具定义也复用 Zod |
| **oRPC contract 1**（`@orpc/contract`） | 定义 client 与 core 之间的每一个调用：输入、输出、错误、事件流。core 与 desktop 之间的进程消息不是 oRPC 调用，只用 Zod schema 定义（[架构总览 §2.3](./architecture.md#23-core-与-desktop-的进程消息通道)） | 契约先行：契约写在 contracts 里，core 用 `implement(contract)` 实现，client 直接从契约生成客户端。tRPC 更流行，但它的类型必须从服务端代码推导，client 就得导入 core，违反架构约束 |

## 7. core

| 技术 | 用途 | 理由 |
| --- | --- | --- |
| **Hono 4** + **@hono/node-server** | HTTP 服务：令牌与 Host 校验、静态文件（client 的构建产物）、挂载 oRPC | 基于 Web 标准的 Request 和 Response，中间件简洁，类型好；下载量和 Express 同一量级 |
| **oRPC server 1** | 实现契约：调用和事件流 | 见 §6。事件用 oRPC 的事件流推送（HTTP 流式响应），和普通调用走同一套令牌鉴权（[架构总览 §3](./architecture.md#3-client-与-core-的通信)） |
| **Drizzle ORM 1** + **drizzle-kit 1** | 表结构定义、查询、迁移 | TypeScript 原生，SQL 写法直观，同步驱动也有同步 API；`node:sqlite` 驱动是 `drizzle-orm/node-sqlite`，从 1.0 起提供，所以 drizzle-orm 和 drizzle-kit 都用 1.x。FTS5 虚表和祖先链递归查询用 `sql` 模板直接写 |
| **`node:sqlite`** | SQLite 驱动 | Node 内置，不用为 Electron 和 Node 两种运行时分别编译原生模块。Node 24 内置的 SQLite 编译时带了 FTS5，trigram 分词的中文检索可以直接用。如果 Electron 45 不提供这个模块，使用 better-sqlite3，并验证 Drizzle 驱动、迁移和各平台原生模块打包 |
| **pi-ai 1** + **pi-agent-core 1** | 调用模型、工具调用循环。npm 包是 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core` | 选型理由见 [LLM 端点](./llm-endpoints.md) |
| **`node:sqlite`** | 运行诊断写入 | 运行事件与性能样本写入独立的 SQLite 连接，使用准备好的语句批量提交。字段和计时口径见[运行诊断与性能记录](./diagnostics.md) |
| **p-queue** | 后台任务队列 | 回合摘要、生成任务的并发控制（[回合循环 §9](./turn-loop.md#9-后台摘要)） |

## 8. 测试

| 技术 | 用途 |
| --- | --- |
| **Vitest 5** | 全部单元测试和集成测试。core 跑在 Node 环境；client 的组件测试跑在**浏览器模式**（`@vitest/browser-playwright` + `vitest-browser-react`），用真实的 Chromium，所以布局、滚动、CSS 变量都是真的，不受 jsdom 没有布局的限制 |
| **Testing Library** | 按角色和名称查询元素（[a11y §11](./a11y.md#11-测试)） |
| **axe-core** / **@axe-core/playwright** | 组件测试和端到端测试里的可访问性检查 |
| **fast-check** | 属性测试：随机生成回合树和事实，验证可见性投影不泄露其他路线（[数据模型 §5](./data-model.md#5-可见性规则)） |
| **MSW** | client 测试里在网络层模拟 core 的响应 |
| **pi-ai 的测试用伪服务商** | 回合循环、工作站的测试不调用真实模型，返回可控的工具调用和文本 |
| **Playwright** | 端到端测试，分两种模式：浏览器打开独立运行的 core，以及用 `_electron.launch` 启动真实的桌面应用 |

测试文件和被测文件放在一起，命名为 `*.test.ts(x)`；端到端测试放在根目录的 `e2e/`。真实模型的评测放在 `evals/`，按需运行，不进每次提交的检查（[回合循环 §11](./turn-loop.md#11-叙述约定)）。

## 9. 代码质量

| 技术 | 用途 | 理由 |
| --- | --- | --- |
| **oxlint** + **oxlint-tsgolint** | TypeScript、React、Hooks、jsx-a11y、import 等规则；类型感知的规则 | 类型感知部分建立在 typescript-go 之上，与 TS 7 配套，速度是 ESLint 加 typescript-eslint 的数十倍。typescript-eslint 目前还不支持 TS 7（§10） |
| oxlint 的 JS 插件 | `eslint-plugin-i18next`（禁止字面字符串）、`eslint-plugin-react-hooks`（React Compiler 规则），以及本仓库自写的规则（`style` 只允许自定义属性） | 能直接加载 ESLint 9 的插件 |
| **Prettier 3** | 格式化 TypeScript、JSON、Markdown | 事实标准；它自带解析器，与项目的 TypeScript 版本无关 |
| **Stylelint 18** | CSS 检查：只用 token、逻辑属性、禁止 `transition: all` | 插件：`stylelint-config-standard`、`stylelint-declaration-strict-value`、`stylelint-use-logical` |
| **husky** + **lint-staged** | 提交前只检查改动过的文件 | 同类里使用最广 |
| **GitHub Actions** | CI：类型检查、lint、测试，以及三个平台的打包 | Turborepo 的缓存让没改动的包跳过 |

## 10. TypeScript 7 与工具链

TypeScript 7 是用 Go 重写的原生编译器，不再提供旧的 JavaScript API。依赖这套 API 的工具因此用不了 TS 7，最典型的是 typescript-eslint，它的最新版要求 TypeScript 低于 6.1。为此，工具链这样安排：

| 环节 | 做法 |
| --- | --- |
| 类型检查 | 各包运行 `tsc --noEmit`，使用 TS 7 原生编译器 |
| 转译 | Vite 和 tsdown 用 Oxc 转译，与 TypeScript 版本无关 |
| lint | oxlint，类型感知部分由 oxlint-tsgolint 提供，它本身就建立在 TS 7 之上 |
| 格式化 | Prettier 自带解析器 |
| 声明文件 | 内部包直接导出源码，不生成 `.d.ts`（§3） |

**已知限制：** oxlint 的 JS 插件机制还处在 alpha 阶段。如果某个 ESLint 插件在其中表现异常：

- 先给 Oxc 报 bug；
- 同时把那一条规则临时改成独立运行的检查脚本，不为了它把整条 lint 链退回到 ESLint 加 TS 6。

## 11. 目录结构

```
unwritten/
├─ apps/
│  ├─ desktop/                    Electron 主进程
│  │  ├─ src/
│  │  │  ├─ main.ts               入口：单实例锁、启动 core、打开窗口
│  │  │  ├─ core-process.ts       用 utilityProcess 启动并看护 core
│  │  │  ├─ window.ts             BrowserWindow 与安全设置
│  │  │  ├─ native-theme.ts       把外观偏好同步到 nativeTheme
│  │  │  ├─ shell-env.ts          读取登录 shell 的环境变量
│  │  │  └─ updater.ts            自动更新
│  │  ├─ electron-builder.yml
│  │  └─ package.json
│  └─ client/                     React 客户端（纯 web）
│     ├─ src/
│     │  ├─ app/                  入口、Provider、外壳
│     │  ├─ routes/               TanStack Router 的文件路由
│     │  ├─ features/
│     │  │  ├─ library/           作品库
│     │  │  ├─ authoring/         创作向导、试玩入口
│     │  │  ├─ workstation/       创作工作站：对话、提案卡
│     │  │  ├─ play/              游玩页：剧情流、行动、状态栏、手记、存档
│     │  │  └─ settings/          设置：外观、阅读、LLM 端点
│     │  ├─ shared/
│     │  │  ├─ api/               oRPC 客户端、查询键、事件流分发
│     │  │  ├─ ui/                基于 Base UI 的共享组件、LiveRegion
│     │  │  ├─ hooks/
│     │  │  └─ lib/
│     │  ├─ theme/                token 与主题（主题与 token §11）
│     │  └─ i18n/                 文案（i18n §3）
│     ├─ index.html
│     ├─ vite.config.ts
│     ├─ AGENTS.md
│     └─ package.json
├─ packages/
│  ├─ contracts/                  client、core、desktop 之间共用的契约，直接导出源码
│  │  ├─ src/
│  │  │  ├─ index.ts              导出 client 与 core 之间的契约
│  │  │  ├─ schemas/              Zod schema：作品、版本、回合、路线、设置……
│  │  │  ├─ procedures/           oRPC 契约，按领域分文件
│  │  │  ├─ events.ts             事件流的事件类型
│  │  │  ├─ errors.ts             错误码
│  │  │  └─ desktop.ts            core 与 desktop 之间的进程消息类型，单独作为 `/desktop` 入口导出
│  │  └─ package.json
│  └─ core/
│     ├─ src/
│     │  ├─ main.ts               入口：解析参数、打开数据库、启动服务
│     │  ├─ api/                  Hono 应用：令牌与 Host 校验、静态文件、挂载契约的实现
│     │  ├─ store/                连接、事务、Drizzle 表定义
│     │  │  └─ migrations/        drizzle-kit 生成的迁移，以及手写的 FTS5 迁移
│     │  ├─ library/              作品与版本
│     │  ├─ story/                实体、事实、知情；可见性投影；全文检索
│     │  ├─ play/                 开局、回合树、路线、存档、回合循环
│     │  │  └─ tools/             只读工具、propose_turn、ask_clarification
│     │  ├─ authoring/            向导、生成任务、工作站、动作注册表
│     │  ├─ llm/                  providers.json、pi-ai 封装、用途分配、调用记录
│     │  ├─ settings/             外观与阅读偏好
│     │  ├─ log/                  SQLite 运行事件、性能样本、诊断库迁移
│     │  ├─ events/               进程内事件总线：各模块发布变更，事件流过程订阅
│     │  └─ test-support/         测试支持代码：伪 OpenAI 服务、脚本化的 llm，不进构建产物
│     ├─ drizzle.config.ts
│     └─ package.json
├─ e2e/                           Playwright：浏览器模式与 Electron 模式
├─ evals/                         真实模型评测，按需运行
├─ docs/                          设计文档
├─ scripts/                       仓库脚本，例如 check-doc-links.mjs
├─ .github/workflows/             CI
├─ AGENTS.md  README.md
├─ package.json                   根脚本，统一用 turbo 调度
├─ pnpm-workspace.yaml            workspaces 与 catalog
├─ turbo.json
├─ tsconfig.base.json             各包 tsconfig 继承的公共配置
├─ .oxlintrc.json
├─ .prettierrc.json
├─ stylelint.config.mjs
└─ .node-version
```

**依赖方向：**

- `apps/client` 只依赖 `@unwritten/contracts`，不导入 `/desktop` 入口；
- `packages/core` 依赖 `@unwritten/contracts` 的两个入口；
- `apps/desktop` 只依赖 `@unwritten/contracts/desktop`，负责启动 core 的构建产物，不导入 core 的代码。

这条规则由 oxlint 的 import 规则检查。

## 12. 不选的方案

| 方案 | 不选的原因 |
| --- | --- |
| Tauri、Electrobun | 见[架构总览 §2](./architecture.md#2-进程模型) |
| Electron Forge | 官方工具，但签名、公证和更新的生态不如 electron-builder 成熟 |
| Express、Fastify | Express 的类型和中间件模型陈旧；Fastify 很成熟，但它的强项（按 schema 序列化）由 oRPC 承担了，Hono 更轻、更贴近 Web 标准 |
| tRPC | 类型必须从服务端推导，client 就得导入 core（§6） |
| TypeBox | Zod 4 同样能导出 JSON Schema，而且生态大得多 |
| Prisma | 有独立的查询引擎和代码生成步骤，对本机桌面应用太重 |
| better-sqlite3（作为默认） | 需要为 Electron 和 Node 两种运行时分别编译；只在 `node:sqlite` 不可用时作为备选（§7） |
| Mantine、MUI、shadcn/ui + Tailwind | 自带主题系统，或者依赖工具类样式，“只用 token”很难强制（[主题与 token §14](./theme.md#14-不做的事)） |
| React Router | 类型安全不如 TanStack Router |
| Redux | 服务端数据交给 TanStack Query 之后，剩下的界面状态用 Zustand 就够了 |
| Jest | Vitest 与 Vite 共用配置和转译，还有真实浏览器模式 |
| ESLint + typescript-eslint | 还不支持 TS 7（§10） |
| Biome | 格式化和 lint 都不错，但插件生态不够，装不上 i18next 规则；类型感知规则也不如 oxlint-tsgolint 完整 |
| Vercel AI SDK、LiteLLM | 见 [LLM 端点](./llm-endpoints.md)；LiteLLM 是 Python 库 |

## 13. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 刚克隆下来的仓库 | `pnpm install`，然后 `pnpm turbo run typecheck lint test build` | 全部通过；类型检查用的是 TS 7 |
| 一个包的版本需要升级 | 只改 `pnpm-workspace.yaml` 的 catalog | 所有使用它的包一起升级，没有哪个包单独写死版本 |
| client 的代码里写一行 `import … from '@unwritten/core'`；或者 desktop 的代码里导入 `@unwritten/contracts` 的主入口 | 运行 oxlint | 报错 |
| 独立运行的 core | 用浏览器打开它打印出的地址 | 和桌面窗口的行为一致 |
| 打包后的 macOS 应用 | 从访达启动，配置一个 `$VAR` 写法的 key，再查看全文检索 | key 能解析；中文的 trigram 检索能命中 |
