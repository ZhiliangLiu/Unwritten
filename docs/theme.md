# Unwritten · 主题与 token

本文定义 client 的全部视觉 token 的名字、用途和规则、浅色和深色两套主题、外观切换的方式，以及组件怎样使用 token。取值背后的设计方向见[设计准则](./design-guidelines.md)；动效相关的 token 见[动效 §3](./motion.md#3-token)。

## 1. 范围

- **token 是唯一的视觉值来源。** 组件样式里不出现任何颜色、尺寸、时长的字面量，全部引用 token。这样换主题、调尺度时，所有组件都会跟着变，不会有哪个角落漏掉。
- **取值只写在 `packages/tokens/tokens.json`。** 它是全部 token 的单源，动效 token 也在里面。格式是 DTCG 2025.10（设计 token 社区组的格式），与平台无关。本文和[动效](./motion.md)只写 token 的名字、用途、规则和理由，不抄取值。各客户端的样式由它生成：web 的生成规则见 §11；将来的原生客户端各加一个生成目标，组件照样只认名字。
- **两套主题：** 浅色 `light` 和深色 `dark`。
- **外观偏好有三档：** 跟随系统、浅色、深色，默认跟随系统。
- **为将来的主题预留扩展点。** 功能层和浮层通过“材质”token 取色（§6），所以将来接半透明主题时，只需改 token 的值，组件不用改。

## 2. token 分三层

```
packages/tokens/tokens.json
 ├─ base                 基元：排版、正文与阅读偏好、空间、尺寸、层级、不透明度、断点、动效；与主题无关
 ├─ theme.<主题 id>      语义：颜色、层次（投影）、材质；每套主题完整定义一遍
 └─ override.<系统偏好>  系统偏好生效时覆盖其中一部分：reduced-motion、contrast-more
        │ 生成
各客户端的样式，例如 web 的 tokens.css 与 themes/<主题 id>.css（§11）
        │
组件   只引用基元与语义 token；可以定义自己的局部变量，但值必须来自全局 token
```

- **基元层不含颜色。** 颜色属于主题，放在语义层。
- **引用跟随作用域。** 基元引用其他基元。主题内引用基元或本主题的 token。覆盖沿用被覆盖 token 的作用域。
- **语义层是每套主题的必填契约。** §5、§6、§7 表里的每个 token（颜色、材质、层次），每套主题都必须给出值，token 集合完全相同。少一个，`node scripts/check-tokens.mjs` 就失败（§12）。
- **覆盖只改已有的 token。** `override.<偏好>.base` 覆盖基元，`override.<偏好>.<主题 id>` 覆盖语义；按主题覆盖时每套主题都要写。
- **组件只认语义名**，例如 `--uw-color-surface`，永远不认具体色值。

## 3. 命名

统一用 `--uw-<类别>-<角色>[-<变体>]` 的格式：

| 类别 | 例子 |
| --- | --- |
| `color` | `--uw-color-text-muted`、`--uw-color-accent-hover` |
| `font` / `text` / `leading` / `weight` / `tracking` | `--uw-font-ui`、`--uw-text-md`、`--uw-leading-prose` |
| `prose` | `--uw-prose-size`、`--uw-prose-measure` |
| `space` | `--uw-space-4` |
| `radius` / `border` | `--uw-radius-lg`、`--uw-border-width` |
| `size` | `--uw-size-control-md`、`--uw-size-icon-sm` |
| `z` / `opacity` | `--uw-z-popover`、`--uw-opacity-disabled` |
| `elevation` | `--uw-elevation-overlay` |
| `material` | `--uw-material-overlay-bg` |
| `motion` / `transition` / `animation` | `--uw-motion-duration-fast`、`--uw-transition-feedback`、`--uw-animation-pulse`（见[动效 §3](./motion.md#3-token)） |

token 的名字表达角色，不表达取值：写 `--uw-color-text-muted`，不写 `--uw-color-gray-600`。

**JSON 路径和名字一一对应。** 去掉开头的 `base.`、`theme.<主题 id>.` 或 `override.<偏好>.<base 或主题 id>.`，其余各段用 `-` 连起来，前面加 `--uw-`：`theme.light.color.text-muted` 就是 `--uw-color-text-muted`，`base.motion.duration-fast` 就是 `--uw-motion-duration-fast`。原生客户端按同一条路径给自己的常量命名。

DTCG 里没有直接对应的几类值，约定这样写：

- **相对字号的长度**（字距、版心、段间距、玩家行动的字号）：DTCG 的 `dimension` 只有 `px` 和 `rem`，所以写成 `number`，并在 `$extensions.unwritten.unit` 标 `em`；
- **过渡涉及哪些属性**：写在 `$extensions.unwritten.properties`；循环动画另标 `iteration`；
- **不播放的过渡和动画**：时长写 0；
- **材质的背景模糊**：写成模糊半径，0 表示不模糊；
- **阅读偏好的选项**：写在对应 token 的 `$extensions.unwritten.options`（§4.2）；
- **主题的 `color-scheme`**：写在主题这一组的 `$extensions.unwritten.color-scheme`（§9）。

## 4. 基元 token

### 4.1 排版

| token | 用途 |
| --- | --- |
| `--uw-font-ui` | 界面 |
| `--uw-font-prose-serif` | 正文，默认 |
| `--uw-font-prose-sans` | 正文，读者选择无衬线时使用；就是界面字体 |
| `--uw-font-mono` | 端点地址、模型 id、快捷键 |
| `--uw-text-xs` / `sm` / `md` / `lg` / `xl` / `2xl` / `3xl` | 界面字号，从小到大；`md` 是界面基准 |
| `--uw-leading-tight` / `ui` / `prose` / `prose-compact` | 标题 / 界面 / 正文舒适 / 正文紧凑 |
| `--uw-weight-regular` / `medium` / `semibold` | 常规 / 中等 / 半粗 |
| `--uw-tracking-tight` / `normal` | `xl` 及以上的标题用 `tight`；相对字号 |

字体全部使用系统自带的，不打包网络字体（[设计准则 §3](./design-guidelines.md#3-版式)）。

**排版角色。** 组件按角色取排版 token，不自己搭配字号和字重。标题级别由页面结构决定，和角色无关（[a11y §3](./a11y.md#3-页面结构)）。界面的七个角色是 `base.typography` 下的组合 token，各自引用字体、字号、字重、行高，字距等于 `tracking` 乘以字号；正文的三个角色随阅读偏好变化，直接用 §4.2 的 token。

| 角色 | token | 用在哪里 |
| --- | --- | --- |
| 页面标题 | `typography.page-title`：`2xl`、半粗、`tight` 行高与字距 | 作品库、设置等页面的主标题 |
| 区块标题 | `typography.section-title`：`lg`、半粗、`tight` 行高 | 向导步骤、设置分区、作品卡标题 |
| 小标题 | `typography.subtitle`：`md`、半粗 | 工具行里的作品名、提案卡标题、表单分组 |
| 界面正文 | `typography.body`：`md`、常规 | 按钮、输入框、列表、对话消息、推荐行动 |
| 说明 | `typography.caption`：`sm`、常规 | 次要说明、元信息、错误原因 |
| 标签 | `typography.label`：`xs`、中等 | 徽标、状态栏的栏目名 |
| 技术信息 | `typography.mono`：等宽、`sm`、常规 | 端点地址、模型 id、快捷键提示、推荐行动前的序号 |
| 正文 | `prose-font`、`prose-size`、`prose-leading`，常规 | 剧情正文、开场预览 |
| 玩家行动 | `font-ui`、`prose-action-size`、`prose-leading`，常规 | 夹在两段剧情之间的行动 |
| 正文强调 | 只改字重：`semibold`，其余继承 | 正文里的 `em` 和 `strong` |

正文强调用 `semibold`，不用 `medium`。宋体只有常规和粗体两档，浏览器把 500 回落成常规体，强调就看不出来；600 会选中粗体。苹方有中等字重，所以界面里的标签可以用 `medium`。

### 4.2 正文与阅读偏好

| token | 说明 |
| --- | --- |
| `--uw-prose-font` | 随阅读偏好在衬线和无衬线之间切换，默认衬线 |
| `--uw-prose-size` | 随阅读偏好在五档（`prose.size-scale.1` 到 `5`）之间切换，默认第 3 档 |
| `--uw-prose-leading` | 随阅读偏好在舒适和紧凑之间切换，默认舒适 |
| `--uw-prose-measure` | 版心宽度，约 36 个汉字；相对正文字号 |
| `--uw-prose-paragraph-gap` | 段间距，正文不首行缩进；相对正文字号 |
| `--uw-prose-action-size` | 玩家行动的字号；相对正文字号，随阅读偏好一起缩放 |

阅读偏好写在根元素上（§9）。三个随偏好切换的 token 在 `$extensions.unwritten` 里写明对应哪项偏好（`preference`）和每个选项指向哪个 token（`options`）。web 据此生成属性选择器，例如 `:root[data-uw-prose-size='1']` 把 `--uw-prose-size` 指向第 1 档。

阅读偏好和主题无关，切换主题时不会重置。

### 4.3 空间与几何

| token | 用途 |
| --- | --- |
| `--uw-space-1` / `2` / `3` / `4` / `5` / `6` / `8` / `10` / `12` / `16` | 间距，编号是 4px 的倍数 |
| `--uw-radius-sm` / `md` / `lg` / `full` | 标签 / 控件 / 卡片、面板、对话框 / 胶囊和圆点 |
| `--uw-border-width` | 描边 |
| `--uw-focus-ring-width` / `--uw-focus-ring-offset` | 焦点环的粗细和外扩 |
| `--uw-size-icon-sm` / `md` | 图标的两档尺寸（[设计准则 §7](./design-guidelines.md#7-图标)） |
| `--uw-size-control-sm` / `md` / `lg` | 控件高度 |
| `--uw-size-target-min` | 交互目标的最小尺寸（[a11y §6](./a11y.md#6-尺寸缩放与目标大小)） |
| `--uw-size-icon-stroke` | 图标线宽，按 Lucide 图标 24 单位的画布计，随图标尺寸等比缩放。比 Lucide 默认的 `2` 细一档，和苹方常规体的笔画相称 |
| `--uw-size-meter` | 状态栏里进度条和阶段条的粗细 |
| `--uw-size-toolbar` | 顶部工具行的高度；滚动容器的 `scroll-padding-block-start` 取这个值（[a11y §4](./a11y.md#4-键盘与焦点)） |
| `--uw-size-panel` / `-min` / `-max` | 工作站面板宽度；手记与存档浮层用 `--uw-size-panel` |
| `--uw-size-page-max` | 作品库等页面的最大宽度 |
| `--uw-size-card-min` | 作品库卡片网格的最小列宽；页面最宽时排三列 |

### 4.4 层级、不透明度、断点

| token | 用途 |
| --- | --- |
| `--uw-z-sticky` | 粘顶的工具行 |
| `--uw-z-overlay` | 对话框和它的遮罩 |
| `--uw-z-popover` | 菜单、下拉、气泡。高于对话框，因为它们可能从对话框里打开 |
| `--uw-z-toast` | 通知 |
| `--uw-z-tooltip` | 提示 |
| `--uw-opacity-disabled` | 禁用态 |
| `--uw-opacity-muted` | 仍可见、但不是当前重点的元素 |

断点写在 `base.breakpoint`：`compact` 是窄窗口（宽度小于它），`wide` 是宽窗口（宽度不小于它），比较方式写在 `$extensions.unwritten.media`。媒体查询里读不到 CSS 变量，所以 web 把它们生成成 `media.css` 里的 `@custom-media --uw-compact` 和 `--uw-wide`，由构建工具展开。

## 5. 语义 token：颜色契约

每套主题都必须完整定义下表中的每一项。浅色像米白书页，深色像夜里的暖灰；强调色是墨蓝（[设计准则 §6](./design-guidelines.md#6-颜色)）。

| token | 用途 |
| --- | --- |
| `--uw-color-bg` | 应用背景 |
| `--uw-color-surface` | 面板、卡片 |
| `--uw-color-surface-raised` | 浮层 |
| `--uw-color-surface-sunken` | 输入框、凹陷区 |
| `--uw-color-surface-hover` | 可交互项悬停 |
| `--uw-color-surface-pressed` | 可交互项按下 |
| `--uw-color-surface-selected` | 选中项 |
| `--uw-color-text` | 主要文字 |
| `--uw-color-text-muted` | 次要文字、说明、占位符 |
| `--uw-color-text-subtle` | 装饰性或大字号的元信息，不承载必读内容 |
| `--uw-color-text-on-accent` | 强调色实底上的文字 |
| `--uw-color-border` | 分隔线、卡片描边（装饰性） |
| `--uw-color-border-control` | 输入框、复选框等控件的边框 |
| `--uw-color-accent` | 主按钮底色、选中指示 |
| `--uw-color-accent-hover` | 强调色悬停 |
| `--uw-color-accent-pressed` | 强调色按下 |
| `--uw-color-accent-soft` | 柔和底：徽标底、选中行 |
| `--uw-color-accent-text` | 用作文字的强调色：链接 |
| `--uw-color-focus-ring` | 键盘焦点环 |
| `--uw-color-success` / `-soft` | 成功：前景 / 柔和底 |
| `--uw-color-warning` / `-soft` | 警告 |
| `--uw-color-danger` / `-soft` | 危险、破坏性操作 |
| `--uw-color-info` / `-soft` | 中性提示 |
| `--uw-color-page` | 正文纸面，独立于 `surface` |
| `--uw-color-ink` | 正文墨色，独立于 `text` |
| `--uw-color-ink-muted` | 正文里的次要文字 |
| `--uw-color-ink-action` | 夹在剧情之间的玩家行动 |
| `--uw-color-ink-selection` | 正文选中底，半透明 |
| `--uw-color-ink-highlight` | 从手记跳回原文时的定位高亮、搜索命中 |
| `--uw-color-scrim` | 对话框遮罩，半透明 |
| `--uw-color-image-dim` | 叠在插图和参考图上的一层，半透明。浅色主题为透明；深色主题略压暗图片，免得亮图在暗色页面上刺眼（[设计准则 §2](./design-guidelines.md#2-七条准则)） |

**对比度。** 下表的“各个表面”指全部 7 种表面底色：`bg`、`surface`、`surface-raised`、`surface-sunken`、`surface-hover`、`surface-pressed`、`surface-selected`。`node scripts/check-tokens.mjs` 按 token 文件逐套主题计算每一组，不达标就失败。

| 组合 | 要求 |
| --- | --- |
| `text` 对各个表面 | ≥ 4.5 : 1 |
| `text-muted` 对各个表面 | ≥ 4.5 : 1 |
| `text-subtle` 对各个表面 | ≥ 3 : 1，只用于大字号或装饰 |
| `ink` 对 `page` | 10 : 1 到 12 : 1。约 11 : 1 是护眼区间：足够清楚，又不像纯黑配纯白那样刺眼 |
| `accent-text` 对各个表面；`ink-action` 对 `page` | ≥ 4.5 : 1 |
| `text-on-accent` 对主按钮的默认、悬停与按下底色 | ≥ 4.5 : 1 |
| 四种反馈色对 `surface` 和各自的柔和底色 | ≥ 4.5 : 1 |
| `border-control` 对各个表面 | ≥ 3 : 1（WCAG 1.4.11） |
| `focus-ring` 对各个表面 | ≥ 3 : 1 |

**两条规则：**

- **反馈色独立于强调色。** 成功、警告、危险表达的是状态，强调色表达的是可交互和选中，两者不混用。
- **正文的纸和墨独立于界面的表面和文字。** 这样正文的护眼取值可以单独调整，不受界面配色牵连。

## 6. 材质：预留给将来的主题

界面上的大面积表面分四类。功能层和浮层的背景一律通过材质 token 取得；内容和通知的背景直接用颜色 token，永远不透明：

| 材质角色 | 用在哪里 | token |
| --- | --- | --- |
| 功能层 `chrome` | 顶部工具行、工作站面板 | `--uw-material-chrome-bg`、`--uw-material-chrome-backdrop` |
| 浮层 `overlay` | 菜单、下拉、气泡、对话框、手记与存档浮层 | `--uw-material-overlay-bg`、`--uw-material-overlay-backdrop`、`--uw-material-overlay-border`、`--uw-material-overlay-elevation` |
| 内容 | 正文纸、卡片、输入框、表格 | 直接用颜色 token，永远不透明，不经过材质 token |
| 通知 `toast` | 通知、错误提示 | 背景直接用 `--uw-color-surface-raised`，永远不透明；描边和投影借用 `--uw-material-overlay-border`、`--uw-material-overlay-elevation` |

浅色和深色主题里，材质背景指向不透明的颜色 token：功能层指向 `surface`，浮层指向 `surface-raised`；背景模糊为 0。

通知和错误提示和浮层一样浮在页面上方，所以借用浮层的描边和投影，和菜单、对话框处在同一高度。但它们承载必须立刻读清的状态，背景不借用浮层材质，任何主题下都不半透明。

组件这样写：

```css
.popup {
  background-color: var(--uw-material-overlay-bg);
  backdrop-filter: var(--uw-material-overlay-backdrop);
  border: var(--uw-border-width) solid var(--uw-material-overlay-border);
  box-shadow: var(--uw-material-overlay-elevation);
}
```

现在 `backdrop` 生成出来是 `none`，看起来和直接写颜色没有区别。之所以现在就这样写，是为了以后接半透明主题时，组件一行都不用改。

**将来的半透明主题（例如仿 Apple 液态玻璃的主题）必须遵守的约束。** 这些约束现在就写下来，让组件的写法从一开始就不挡路：

1. **只改材质 token 的值。** 组件不读主题名，也不为某个主题写分支。
2. **只有功能层和浮层可以半透明。** 内容和通知——正文、卡片、输入框、通知、错误提示——永远不透明。
3. **同屏同时生效的 `backdrop-filter` 不超过一块**，否则滚动和动画时开销太大。
4. **四种情况一律回落成不透明：** 用户在设置里关闭透明效果、`prefers-reduced-transparency: reduce`、`prefers-contrast: more`、环境不支持 `backdrop-filter`。四种情况翻的是同一组材质 token。
5. **不对 `filter`、`backdrop-filter` 做动画。** 面板改尺寸这类结构动效进行期间，材质降一档（[动效 §7](./motion.md#7-性能)）。
6. **对比度要在真实合成的背景上测量**，不能只拿 token 的颜色值计算。
7. **平台原生材质是平台事实，不是主题状态。** macOS 窗口的 `vibrancy`、Windows 的 `backgroundMaterial` 由 desktop 决定，再告诉 client。client 不自己猜测平台。

## 7. 层次（投影）

| token | 用途 |
| --- | --- |
| `--uw-elevation-surface` | 表面：卡片、面板 |
| `--uw-elevation-overlay` | 浮层：菜单、对话框、通知 |

浅色主题靠投影分层，深色主题靠“越高的层越亮”加顶边的一条细亮线分层，因为深色背景上投影几乎看不见（[设计准则 §5](./design-guidelines.md#5-层次与材质)）。

## 8. 提高对比度

`prefers-contrast: more` 时，按 token 文件的 `override.contrast-more` 覆盖以下 token，组件不用写任何东西：

| token | 效果 |
| --- | --- |
| `--uw-color-text-muted` | 改用主要文字色 |
| `--uw-color-text-subtle` | 改用原来的次要文字色 |
| `--uw-color-border` | 改用控件边框色 |
| `--uw-focus-ring-width` | 加粗 |

Windows 的强制颜色模式（`forced-colors: active`）见 [a11y §7](./a11y.md#7-系统偏好)。

## 9. 外观偏好与切换

**偏好存在 core。** 外观偏好（跟随系统 / 浅色 / 深色）和阅读偏好（正文字号、字体、行距）都存在 core 的设置里，因为桌面版和将来的 web 客户端要共用同一份偏好。core 把它们存进作品库的 `app_settings` 表，一行，按 contracts 的 `AppearanceSchema` 校验后写入。设置页通过契约里的 `settings.get` 和 `settings.update` 两个过程读写它们。

**首屏不闪。** core 返回 `index.html` 时，把偏好直接写在根元素上：

```html
<html lang="zh-CN" data-uw-appearance="system" data-uw-prose-size="3" data-uw-prose-font="serif" data-uw-prose-leading="comfortable">
```

`<head>` 里有一段很短的内联脚本，在首次绘制前用 `matchMedia('(prefers-color-scheme: dark)')` 把 `system` 解析成具体的主题，写成 `data-uw-theme="light"` 或 `data-uw-theme="dark"`。主题 CSS 只认 `data-uw-theme`，所以 DOM 上永远不会出现 `system` 这个值。

写进 HTML 的这些值都是枚举。core 先按 contracts 里的 schema 校验，再写入，不拼接任意字符串。内联脚本带上 core 为这次响应生成的 nonce，配合内容安全策略（[架构总览 §2.1](./architecture.md#21-本机接口的安全)）。

**唯一的写入口。** 首屏之后，根元素上的这些属性只由 `applyAppearance()` 写入。调用时机包括：用户改了偏好、系统明暗变化（监听上面那个 `matchMedia`）、启动或收到设置变化通知后与 core 同步设置。

**原生界面跟着走：**

- 每套主题在 token 文件里写明 `color-scheme`，生成的主题样式带上它（web 是 `color-scheme: light` 或 `dark`），让滚动条、原生表单控件、默认选中色跟主题一致。
- desktop 把 Electron 的 `nativeTheme.themeSource` 设成同一个偏好，让原生菜单、标题栏、系统对话框也跟主题一致。core 在就绪时向 desktop 提供当前偏好。偏好变化时，core 通过进程消息通道发出 `appearance-changed`，通知 desktop（[架构总览 §2.3](./architecture.md#23-core-与-desktop-的进程消息通道)）。

**切换时的过渡。** 浅色和深色之间不做生硬跳变，因为大面积的亮度突变刺眼。

- `applyAppearance()` 用 View Transitions API 做一次整页交叉淡入淡出，时长为 `--uw-motion-duration-theme`。
- 切换期间，根元素挂上瞬态属性 `data-uw-theme-switching`，把颜色类的反馈过渡 token 设为 `none`，避免每个按钮各自再淡变一次（[动效 §6](./motion.md#6-实现规则)）。
- `prefers-reduced-motion: reduce` 时仍然保留这次淡入淡出：它只改变透明度，不涉及位移，还能避免亮度突变（[动效 §4](./motion.md#4-减少动态效果)）。

## 10. 组件怎样使用 token

- **视觉属性只能用 token。** 包括：颜色、背景、边框、圆角、阴影、字体族、字号、字重、行高、字距、外边距、内边距、间隙、定位偏移、控件和图标尺寸、`z-index`、`opacity`、`transition`、`animation`，以及 `transform` 里的位移量和缩放量。
- **允许的字面量**只有这些：`0`、`none`、`auto`、`inherit`、`initial`、`currentColor`、`transparent`，以及纯结构性的布局值，例如 `100%`、`1fr`、`min-content`、`flex: 1`。
- **颜色字面量**——十六进制、`rgb()`、`hsl()`、颜色名——只能出现在 `themes/*.css` 里。
- **组件不写主题选择器**，例如 `[data-uw-theme='dark']`，也不在 TypeScript 里读主题名。主题差异只能通过 token 表达。
- **组件可以定义局部变量**，例如 `--button-height`，但它的值必须来自全局 token。
- **内联 `style` 只能设置 CSS 自定义属性**，用来传递运行时才知道的几何量，例如虚拟列表的偏移量；不能直接写视觉值。React 通过 CSSOM 写入 `style`，不受内容安全策略的 `style-src` 限制，所以不需要 `'unsafe-inline'`（[架构总览 §2.1](./architecture.md#21-本机接口的安全)）。
- **组件状态用 Base UI 暴露的 data 属性来选**，例如 `[data-open]`、`[data-disabled]`、`[data-highlighted]`、`[data-starting-style]`，不另外造 class。
- **方向一律用逻辑属性**，例如 `margin-inline-start`、`inset-block-end`、`inline-size`（[i18n §8](./i18n.md#8-布局方向)）。

## 11. 文件布局

```
packages/tokens/
  tokens.json        全部 token 的单源
  build-css.mjs      web 的生成脚本

apps/client/src/theme/
  tokens.css         生成：base，override.*.base，阅读偏好的属性选择器
  media.css          生成：@custom-media 断点
  themes/<主题 id>.css  生成：theme.<主题 id>、color-scheme、override.contrast-more.<主题 id>
  appearance.ts      applyAppearance()：首屏之后唯一写入根属性的入口
  boot.inline.js     首屏前解析外观的内联脚本，由 core 内联进 index.html
```

**web 的生成规则。** 构建和启动开发服务器先运行 `node packages/tokens/build-css.mjs`。可以传入输出目录，默认写入 `apps/client/src/theme/`。生成的 CSS 不提交，也不手改。

- token 生成 CSS 变量，名字按 §3。引用生成 `var()`。偏好覆盖中引用同一组覆盖掉的 token 时，使用它在原主题中的值，以便 `text-subtle` 保留原来的 `text-muted`；
- 颜色有 alpha 时生成 `rgb(r g b / a)`，没有时生成十六进制；
- `shadow` 生成一个 `box-shadow` 值；`transition` 按 `properties` 生成 `transition` 简写；`animation` 下的 token 按名字生成 `animation` 简写，关键帧写在 `tokens.css` 里；
- `typography` 每个字段生成一个变量，例如 `--uw-typography-page-title-font-size`；
- 标了 `em` 的 `number` 生成 `em` 长度；
- 时长为 0 的过渡和动画、模糊半径为 0 的 `backdrop` 生成 `none`，模糊半径不为 0 时生成 `blur()`；
- `override.reduced-motion` 生成在 `@media (prefers-reduced-motion: reduce)` 里，基元覆盖所在的规则同时把 `scroll-behavior` 设为 `auto`；`override.contrast-more` 生成在 `@media (prefers-contrast: more)` 里；
- 断点引用解析成具体尺寸。背景模糊引用解析成半径，再按模糊规则生成；
- 每套主题生成在 `:root[data-uw-theme='<主题 id>']` 下。

## 12. 强制检查

规则只写在文档里是不够的，下面这些检查保证它们真正生效：

- **stylelint：**
  - 用 `stylelint-declaration-strict-value` 把 §10 列出的属性限制为只能用 `var(--…)` 或允许的字面量；
  - 用 `color-no-hex`、`color-named: never`，以及禁止 `rgb`、`hsl`、`color-mix` 等颜色函数的规则，禁止颜色字面量。`themes/*.css` 豁免这一条；
  - 禁止 `transition: all`；
  - 要求使用逻辑属性。
- **oxlint：** 用 oxlint 的 JS 插件自写一条规则，规定 JSX 的 `style` 对象里只允许 `--` 开头的键（[技术选型 §9](./tech-stack.md#9-代码质量)）。
- **token 检查（`node scripts/check-tokens.mjs`）：**
  - 每个 token 都有 `$type`，取值符合 DTCG 的格式；引用都能解析、没有循环，引用的类型对得上；
  - 每套主题的 token 集合完全相同；覆盖只能覆盖已有的 token，按主题覆盖时每套主题都要写；
  - 生成的 CSS 变量名不重复；
  - 界面排版角色的字距等于 `tracking` 乘以字号；
  - 逐套检查默认和提高对比度两种配色。按 §5 逐组计算，半透明的前景先合成到对应的不透明底色上。
  - 用 Web 生成器检查阅读选项和 CSS 变量声明，组合排版展开后的变量名也参与重名检查。
- **外观测试：**
  - DOM 上从不出现 `data-uw-theme="system"`；
  - 首屏前就已经有 `data-uw-theme`；
  - 切换期间挂上 `data-uw-theme-switching`，切换结束后摘掉。

## 13. 新增一套主题

1. 在 token 文件的 `theme` 下复制 `light` 或 `dark`，改成新的主题 id，并写明它的 `color-scheme`。id 只用小写字母和连字符，发布后不再改名。
2. 改完 §5、§6、§7 的全部 token，在 `override.contrast-more` 下补上这套主题的覆盖，并通过 `node scripts/check-tokens.mjs`。
3. 材质 token 默认指向不透明的颜色 token，只有确实需要时才改成半透明。半透明主题遵守 §6 的约束。
4. 在外观偏好里加上这个选项；展示名走 i18n。
5. 用户保存的主题 id 不认识时（例如主题被撤下），回落为“跟随系统”，不报错。

## 14. 不做的事

- **按作品改变界面配色。** 界面基调固定，作品内容只在正文里呈现（[设计准则 §1](./design-guidelines.md#1-基调)）。
- **用户自定义颜色或导入第三方主题 CSS。** 会造成对比度和验收矩阵失控，也会执行外部样式。
- **CSS-in-JS 或 Tailwind。** token 只有一个来源，就是 token 文件；web 只用由它生成的 CSS 变量。

## 15. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 外观设为跟随系统 | 启动应用，再切换系统的明暗 | 首屏没有闪烁；系统切换后界面交叉淡入到新主题，原生菜单和滚动条也跟着变 |
| 任意页面 | 在设置里切换浅色和深色 | 整页淡入淡出一次，按钮之类的控件不会各自再淡变；开启减少动态效果后照样淡入淡出 |
| 系统开启提高对比度 | 浏览作品库、游玩页、设置 | 次要文字与背景的对比提高，分隔线变成控件边框色，焦点环变粗 |
| 代码里新加一处写死的颜色或间距 | 运行 stylelint | 报错 |
| 只在 `theme.light` 里新增一个语义 token | 运行 `node scripts/check-tokens.mjs` | 失败，指出 `theme.dark` 缺这一项 |
| 把 `ink` 改成接近纯黑 | 运行 `node scripts/check-tokens.mjs` | 失败，指出 `ink` 对 `page` 的对比度超出护眼区间 |
| 修改 token 文件里的一个颜色 | 重新构建 client | 生成的主题 CSS 跟着变，组件不用改 |
| 阅读偏好设为最大字号 + 无衬线字体 | 切换主题 | 阅读偏好保持不变 |
| 正文字体为宋体，正文里有一处强调 | 浅色和深色下各读一遍 | 强调处明显比周围粗 |
