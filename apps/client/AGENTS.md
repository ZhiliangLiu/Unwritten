# apps/client/ 编码规范

本目录是 Unwritten 的 client：一个纯 web 应用，只通过 contracts 和 core 通信（[架构总览 §1](../../docs/architecture.md#1-四个组成部分)）。写代码前先读对应的设计文档：

- 视觉方向：[设计准则](../../docs/design-guidelines.md)
- token 与主题：[主题与 token](../../docs/theme.md)
- 动效：[动效](../../docs/motion.md)
- 文案与语言：[i18n](../../docs/i18n.md)
- 可访问性：[a11y](../../docs/a11y.md)

代码是设计的兑现，与设计文档冲突时，先改文档。

## 1. 组件与样式的基础

- **组件基础是 Base UI，样式写在 CSS Modules 里。** 不引入其他组件库、Tailwind、CSS-in-JS。确实需要时，先问维护者。
- 引入新组件前，先搜一遍已有的共享组件。
- 组件状态用 Base UI 暴露的 data 属性来选，例如 `[data-open]`、`[data-disabled]`、`[data-highlighted]`，不另外造 class。
- 不写桌面专属的分支。client 不知道自己运行在桌面窗口还是浏览器里。

## 2. 样式只用 token

- 视觉属性只能用 `--uw-*` token（属性清单见[主题与 token §10](../../docs/theme.md#10-组件怎样使用-token)）。允许的字面量只有：`0`、`none`、`auto`、`inherit`、`initial`、`currentColor`、`transparent`，以及纯结构性的布局值（`100%`、`1fr`、`min-content`、`flex: 1`）。
- 颜色字面量（十六进制、`rgb()`、`hsl()`、颜色名）只能出现在 `src/theme/themes/*.css` 里。
- 组件不写主题选择器，例如 `[data-uw-theme='dark']`，也不在 TypeScript 里读主题名。
- 功能层（顶部工具行、工作站面板）和浮层的背景，一律通过 `--uw-material-*` 取得，包括 `backdrop-filter: var(--uw-material-*-backdrop)`。哪怕现在的值是不透明色和 `none`，也要这样写：这是留给将来主题的扩展点。内容表面（正文、卡片、输入框）直接用颜色 token，永远不透明。
- 内联 `style` 只能设置 CSS 自定义属性，用来传递运行时才知道的几何量。
- 方向一律用逻辑属性（[i18n §8](../../docs/i18n.md#8-布局方向)）。
- 断点用 `@custom-media --uw-compact` 和 `--uw-wide`，不在媒体查询里写死数值。
- **新增 token 的流程：** 在同一次改动里完成以下三件事，然后跑 token 契约测试。
  1. 在 `tokens.css` 或两个主题文件里同时加上；
  2. 更新 `docs/theme.md` 的对应表格；
  3. 颜色类 token 补上对比度检查。
- 卡片、按钮、输入框始终保留一条边框，不需要显示时设为 `transparent`，以便在强制颜色模式下仍有轮廓（[a11y §7](../../docs/a11y.md#7-系统偏好)）。

## 3. 动效

- 过渡和动画只用动效 token 和组合过渡 token（[动效 §3](../../docs/motion.md#3-token)），不写 `transition: all`。
- **状态变化用 CSS transition，不用 `@keyframes`。** keyframes 只用于循环：呼吸、加载转圈。
- **出现和消失：** Base UI 组件用 `[data-starting-style]` 和 `[data-ending-style]`，非 Base UI 的元素用 `@starting-style`。浮层以 `--transform-origin` 为原点。
- **只动 `transform` 和 `opacity`。** 颜色过渡只用于小元素的反馈；`inline-size` 只用于工作站面板。不对 `filter`、`backdrop-filter` 和大面积的 `box-shadow` 做动画。
- **一次性的状态动效**（变化高亮、定位高亮）由组件在真实变化发生时挂上 `data-uw-changed`，并用计时器摘掉。首次挂载和回看历史时不挂（[动效 §6](../../docs/motion.md#6-实现规则)）。
- 组件不写自己的 `prefers-reduced-motion` 块，减少动态效果由 token 统一处理。JS 动画通过 `matchMedia` 读取这项偏好。
- JS 需要的时长和延迟，从 CSS token 读取，不在 TypeScript 里另写数字。

## 4. 文案

- 组件里不出现用户能看到的字面字符串，`aria-label`、`placeholder`、`title`、`alt` 也算。一律用 `t()` 或 `<Trans>`（[i18n §4](../../docs/i18n.md#4-文案规则)）。
- 不拼接字符串组句，用插值。
- 键名表达用途：`<命名空间>:<区域>.<元素>[.<状态>]`。字面相同但用途不同的文案，用不同的键。
- core 返回的错误按 `code` 查 `errors:<code>`，不显示 core 的 `message`。
- 作品内容、AI 输出、玩家输入是数据，原样显示，不过 `t()`。
- 日期、数字、相对时间用 `Intl.*` 格式化。
- 输入框处理 Enter 时，先判断输入法是否正在组字（`isComposing`）。

## 5. 可访问性

- 每页恰好一个 `h1`，标题级别按嵌套关系给。路由切换时更新 `document.title`，并把焦点移到 `h1`。
- 所有可交互元素在 `:focus-visible` 时有焦点环，用 `outline` 画。不允许 `outline: none` 却不给替代样式。
- 不覆盖 Base UI 组件的键盘行为和 ARIA 属性。
- 只有图标的按钮必须有 `aria-label`。
- 颜色不单独承载信息，状态一律配图标或文字。
- 播报一律走共享的 `LiveRegion` 组件，不自己手写 `aria-live` 区域。
- 交互目标不小于 `--uw-size-target-min`。
- 测试里用 `getByRole` 查元素，每个共享组件都跑 axe-core 检查（[a11y §11](../../docs/a11y.md#11-测试)）。

## 6. 安全

- AI 输出、作品内容、作者设定、玩家输入和模型返回的错误信息，一律作为纯文本渲染。不用 `dangerouslySetInnerHTML`，也不用 `innerHTML`，理由见[架构总览 §2.1](../../docs/architecture.md#21-本机接口的安全)。
- 不用 `eval`、`new Function`，也不写内联事件处理器，否则会和内容安全策略冲突。
- 令牌只保存在内存里，不写进 `localStorage`、`sessionStorage` 或 URL。
