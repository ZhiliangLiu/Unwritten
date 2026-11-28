# packages/core/ 编码规范

本目录是 Unwritten 的 core：全部业务逻辑，对外提供 oRPC 接口（[架构总览 §1](../../docs/architecture.md#1-四个组成部分)）。写代码前先读对应的设计文档，代码是设计的兑现。

## 1. 模块与依赖方向

- `api/` 只做三件事：解析请求、调用服务、映射响应。业务逻辑不写在路由里。
- 模块之间经 `services.ts` 里的接口调用，不深入导入别的模块的内部文件。跨模块的变化通知经 `events/` 的事件总线。
- `story/` 只依赖 `store/` 和 `text/`，不导入 `llm/`、`api/`、`play/`、`authoring/`：故事事实的读写不知道模型和接口的存在。
- `llm/pi.ts` 是唯一导入 pi-ai 和 pi-agent-core 的文件。
- `image/` 不导入 `story/`、`play/`、`authoring/`、`illustration/`：出图模块不认识作品、人物和回合，只认协议和能力（[插图与出图服务 §1](../../docs/image.md#1-组成)）。
- 外发的 HTTP 请求只经 `net/` 的 `fetch` 封装（[LLM 端点 §3](../../docs/llm-endpoints.md#3-key-的来源与保护)）。
- 源码里不出现插件和 `selfhost/` 下专属的名字，也不按出图服务报告的实现名分支（[插件 §2](../../docs/plugins.md#2-边界)）。自建模型服务按普通的自定义端点处理，不加预设，也不按地址或模型 id 识别。
- 判据：`grep -rnE "from '\.\./(llm|api|play|authoring)/" packages/core/src/story` 零命中；`grep -rln "@earendil-works" packages/core/src` 只列出 `llm/pi.ts` 和测试支持代码；`grep -rnE "from '\.\./(story|play|authoring|illustration)/" packages/core/src/image` 零命中；扫描插件名的测试通过。

## 2. 契约与错误

- contracts 是 client 与 core 之间的单源。枚举、可空性、字段名在 contracts 里定死。
- core 只返回稳定的错误码和结构化的 `detail`，显示给用户的文字由 client 按错误码查 i18n。
- 新增一个错误码要改三处：`contracts/src/errors.ts`、`core/src/errors.ts` 的 `HTTP_STATUS`、`client/src/i18n/zh-CN/errors.json`。
- **读的时候校验什么，写的时候就校验什么。** 存进 JSON 列的对象，写入前用同一个 Zod schema 校验，不另开一条不校验的写路径。

## 3. 事务与事件

- 一个用例一个事务。SQLite 驱动是同步的，事务回调里不 `await`。
- **先提交后发布。** `bus.publish` 放在事务提交成功之后。订阅方读到的必须是已经落库的状态。
- 有副作用的命令带幂等键；推进路线 head 用比较再更新（[架构总览 §3](../../docs/architecture.md#3-client-与-core-的通信)）。

## 4. 模型调用

- 所有模型调用都经 `llm` 模块的 `run()` 或 `complete()`，所有出图调用都经 `image` 模块的 `generate()`。业务代码不直接拼 HTTP 请求。
- **工具不写库。** 只读工具只读；提案工具（`propose_turn`、`propose_preview`）只交出提案，由 core 校验后在提交事务里写入。
- **重试分层，不叠加。** 网络类失败由 `llm` 或 `image` 模块自动重试一次；提案或镜头描述不合格由校验反馈让模型修正，最多两次；再失败交给用户点“重试”。不在别的层再加一层重试。
- **采样参数只有服务端真正兑现才算生效。** 测试断言伪服务收到的请求体，不断言配置里的值。
- **改动任何进入工具说明或系统提示的文字，都要更新 token 棘轮测试**（`story/tools.test.ts`、`play/context.test.ts`），并在提交说明里写清涨幅来自哪一段。不要为了让测试通过直接把数字调大。

## 5. 新增时要登记的地方

- **新增一种 `changes` 类型：** `story/types.ts` 的 schema、`story/changes.ts` 的解析与校验、`story/writer.ts` 的写入、`play/propose-turn-tool.ts` 的参数说明、`play/narrator-prompt.ts` 的系统提示（如需）、`story/tools.test.ts` 的 token 棘轮，以及每条规则一个测试。
- **新增一个只读工具：** `story/tools.ts`、`story/render.ts` 的结果格式、`turn_requests.log` 的足迹、`story.tool` 样本、token 棘轮。
- **新增一个模型用途：** contracts 的用途枚举、`providers/schema.ts`、`llm/service.ts` 的回落规则、client 设置页的用途列表和文案。
- **新增一种出图协议或一种插件：** 见[插件 §7](../../docs/plugins.md#7-新增插件)。
- **新增一个错误码：** 见 §2。

## 6. 日志与性能

- 运行事件和性能样本只写诊断库（[运行诊断与性能记录](../../docs/diagnostics.md)）。不用 `console.log`，不写日志文件。
- **成功路径也要记。** 模型调用、上下文构建、工具调用、提交、后台任务的开始与结束都要有事件或样本，不能只在失败分支记。
- 样本带稳定的名字、耗时、结果、能解释耗时的规模字段（条数、token 估算数）和已有的关联 ID。
- `data` 里只放枚举、计数、布尔和 id，不放正文、名字、陈述、玩家输入和 key。

## 7. 测试

- **断言钉产物，不回抄自己的声明。** 期望值不从被测代码里取；固定的协议字段名、上限、阈值，至少有一条断言直接写字面量。
- **用扫描、反射得到的集合，先断非空再断性质。** 空集上的“全部满足”恒为真。
- **否定断言配阳性对照。** 断言“没写入”“不泄露”“没发送”时，同一个测试里证明同一条路径确实在产出别的东西。
- **会启动后台队列的测试**，动作前只断言处于可执行状态，动作后用 `whenIdle()` 等队列空了再断言。
- 需要模型的测试一律用伪服务：单元测试用 `createScriptedLlm`，集成测试用伪 OpenAI 服务。测试里的故事内容全部虚构。
