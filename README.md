# Unwritten

Unwritten 是一个本机运行的 AI 文字冒险应用。作者写一段背景，就能做出一部可以反复游玩的作品。作者决定世界里哪些事成立、哪些地方留给玩家选择；AI 补全设定、演出剧情，并记住每条路线上的人物、约定和秘密。

## 能做什么

- **创作。** 从一句背景开始，经过“确认故事方案 → 预览并采用开场 → 存入作品库”就能得到可玩的作品。右侧的 AI 工作站可以用自然语言修改草稿；AI 只提出修改建议，作者确认后才会写入。
- **游玩。** 每回合读一段完整剧情，可以点选推荐行动，也可以自由输入。此前认识的人、透露的秘密、履行或错过的约定，可以在很多回合后重新影响剧情。
- **路线。** 支持自动续玩、手动存档、从存档另开路线，以及对最新一段回应“换一种发展”。不同路线共享同一段过去，之后的后果各自独立。
- **模型自选。** 可以接 OpenCode Go、OpenAI、Anthropic、Google 等服务商，也可以接 Ollama、LM Studio 这类本机模型；游玩、创作对话、后台摘要可以分别使用不同的模型。

## 架构

```
Electron 外壳（desktop）
 ├─ core：业务逻辑、SQLite、LLM 调用，提供本机 HTTP 接口（调用与事件流）
 └─ client：纯 web 界面，只通过接口和 core 通信
```

client 不包含任何桌面专属代码，core 也可以脱离桌面独立运行，所以同一份 client 可以直接在浏览器里使用。详见[架构总览](docs/architecture.md)。

| 目录 | 内容 |
| --- | --- |
| `apps/desktop` | Electron 主进程：窗口、菜单、更新，负责启动 core |
| `apps/client` | React 客户端 |
| `packages/core` | core：作品、回合循环、创作工作站、故事事实、LLM 调用 |
| `packages/contracts` | client 与 core 共用的接口类型和 schema |
| `docs` | 设计文档 |

主要技术：TypeScript 7、Electron、React + Base UI、oRPC、Hono、Drizzle + SQLite、pi-ai。完整的选型和目录结构见[技术选型](docs/tech-stack.md)。

## 设计文档

| 文档 | 内容 |
| --- | --- |
| [创作流程](docs/authoring-flow.md) | 作者视角的产品体验 |
| [游玩流程](docs/gameplay-flow.md) | 玩家视角的产品体验 |
| [架构总览](docs/architecture.md) | 组成部分、进程模型、通信方式 |
| [技术选型](docs/tech-stack.md) | 每一部分用的技术与库、理由，以及完整的目录结构 |
| [数据模型](docs/data-model.md) | 作品版本、回合树、故事事实，以及可见性规则 |
| [回合循环](docs/turn-loop.md) | 游玩时 AI 每回合怎样读取上下文、提交结果，core 怎样校验 |
| [创作工作站](docs/author-workstation.md) | 对话面板、提案卡，以及怎样写入草稿 |
| [LLM 端点](docs/llm-endpoints.md) | 模型服务的配置、探测与用途分配 |
| [设计准则](docs/design-guidelines.md) | 视觉方向：简约、高雅、护眼、阅读优先 |
| [主题与 token](docs/theme.md) | 视觉 token、浅色与深色主题、外观切换 |
| [动效](docs/motion.md) | 动效原则、token 与场景编排 |
| [i18n](docs/i18n.md) | 界面文案与中文排版 |
| [a11y](docs/a11y.md) | 可访问性 |

参与开发前先读 [AGENTS.md](AGENTS.md)（协作规范）和 [docs/AGENTS.md](docs/AGENTS.md)（文档写作规范）。

## 本机数据

所有数据都保存在本机的数据目录里：桌面版使用系统的应用数据目录，开发时使用仓库下的 `.data/`。

| 文件 | 内容 |
| --- | --- |
| `library.db` | 作品库：作品、版本、路线、存档、对话 |
| `providers.json` | 模型端点和 API key，文件权限为 0600。key 可以写成 `$ENV_VAR`，从环境变量读取 |
| `logs/` | 运行日志 |

`.data/` 和 `providers.json` 都已列入 `.gitignore`，不要把它们提交进仓库。
