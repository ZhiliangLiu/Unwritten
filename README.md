# Unwritten

Unwritten 是一个本机运行的 AI 文字冒险应用。作者写一段背景，就能做出一部可以反复游玩的作品。作者决定世界里哪些事成立、哪些地方留给玩家选择；AI 补全设定、演出剧情，并记住每条路线上的人物、约定和秘密。

## 能做什么

- **创作。** 从一句背景开始，经过“确认故事方案 → 预览并采用开场 → 存入作品库”就能得到可玩的作品。右侧的 AI 工作站可以用自然语言修改草稿：对话里 AI 提出的修改以提案卡呈现，作者确认后才写入；向导里的按钮是确定的操作，点击即执行。
- **游玩。** 每回合读一段完整剧情，可以点选推荐行动，也可以自由输入。人物关系、秘密和约定会被记住，在很多回合之后继续起作用。
- **路线。** 支持自动续玩、手动存档、从存档另开路线，以及对最新一段回应“换一种发展”。同一次开局里，从存档另开的路线共享此前的经历，之后的后果各自独立。
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

全部设计文档的索引在[架构总览](docs/architecture.md#文档索引)。

参与开发前先读 [AGENTS.md](AGENTS.md)（协作规范）和 [docs/AGENTS.md](docs/AGENTS.md)（文档写作规范）。

## 本机数据

所有数据都保存在本机的数据目录里：桌面版使用系统的应用数据目录，开发时使用仓库下的 `.data/`。

| 文件 | 内容 |
| --- | --- |
| `library.db` | 作品库：作品、版本、路线、存档、对话 |
| `providers.json` | 模型端点和 API key；macOS、Linux 上文件权限为 0600，Windows 上依赖用户目录的访问控制。key 可以写成 `$ENV_VAR`，从环境变量读取 |
| `logs/` | 运行日志 |

`.data/` 和 `providers.json` 都已列入 `.gitignore`，不要把它们提交进仓库。
