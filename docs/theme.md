# Unwritten · 主题与 token

本文定义 client 的全部视觉 token、浅色和深色两套主题、外观切换的方式，以及组件怎样使用 token。取值背后的设计方向见[设计准则](./design-guidelines.md)；动效相关的 token 见[动效 §3](./motion.md#3-token)。

## 1. 范围

- **token 是唯一的视觉值来源。** 组件样式里不出现任何颜色、尺寸、时长的字面量，全部引用 token。这样换主题、调尺度时，所有组件都会跟着变，不会有哪个角落漏掉。
- **两套主题：** 浅色 `light` 和深色 `dark`。
- **外观偏好有三档：** 跟随系统、浅色、深色，默认跟随系统。
- **为将来的主题预留扩展点。** 功能层和浮层通过“材质”token 取色（§6），所以将来接半透明主题时，只需改 token 的值，组件不用改。

## 2. token 分三层

```
基元   apps/client/src/theme/tokens.css
       排版尺度、间距、圆角、描边、尺寸、层级、不透明度、动效、阅读偏好；与主题无关
        │
语义   apps/client/src/theme/themes/{light,dark}.css
       颜色、层次（投影）、材质；每套主题完整定义一遍
        │
组件   各组件的 CSS Module
       只引用基元与语义 token；可以定义自己的局部变量，但值必须来自全局 token
```

- **基元层不含颜色。** 颜色属于主题，放在语义层。
- **语义层是每套主题的必填契约。** §5、§6、§7 表里的每个 token（颜色、材质、层次），两套主题都必须给出值。少一个，测试就会失败（§12）。
- **组件只认语义名**，例如 `--uw-color-surface`，永远不认 `#FBFAF7`。

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

## 4. 基元 token

### 4.1 排版

| token | 值 | 用途 |
| --- | --- | --- |
| `--uw-font-ui` | `system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif` | 界面 |
| `--uw-font-prose-serif` | `"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", serif` | 正文，默认 |
| `--uw-font-prose-sans` | `var(--uw-font-ui)` | 正文，读者选择无衬线时使用 |
| `--uw-font-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | 端点地址、模型 id、快捷键 |
| `--uw-text-xs` / `sm` / `md` / `lg` / `xl` / `2xl` / `3xl` | `0.75` / `0.8125` / `0.875` / `1` / `1.25` / `1.5` / `2` rem | 界面字号；`md`（14px）是界面基准 |
| `--uw-leading-tight` / `ui` / `prose` / `prose-compact` | `1.25` / `1.5` / `1.85` / `1.65` | 标题 / 界面 / 正文舒适 / 正文紧凑 |
| `--uw-weight-regular` / `medium` / `semibold` | `400` / `500` / `600` | |
| `--uw-tracking-tight` / `normal` | `-0.01em` / `0` | `xl` 及以上的标题用 `tight` |

字体全部使用系统自带的，不打包网络字体（[设计准则 §3](./design-guidelines.md#3-版式)）。

### 4.2 正文与阅读偏好

| token | 默认值 | 说明 |
| --- | --- | --- |
| `--uw-prose-font` | `var(--uw-font-prose-serif)` | 随阅读偏好在衬线和无衬线之间切换 |
| `--uw-prose-size` | `1.125rem` | 五档：`1` / `1.0625` / `1.125` / `1.25` / `1.375` rem |
| `--uw-prose-leading` | `var(--uw-leading-prose)` | 随阅读偏好在舒适和紧凑之间切换 |
| `--uw-prose-measure` | `36em` | 版心宽度，约 36 个汉字 |
| `--uw-prose-paragraph-gap` | `0.9em` | 段间距，正文不首行缩进 |

阅读偏好写在根元素上（§9），`tokens.css` 把它们映射成上面这几个 token：

```css
:root[data-uw-prose-size='1'] { --uw-prose-size: 1rem; }
/* …其余四档同理 */
:root[data-uw-prose-font='sans'] { --uw-prose-font: var(--uw-font-prose-sans); }
:root[data-uw-prose-leading='compact'] { --uw-prose-leading: var(--uw-leading-prose-compact); }
```

阅读偏好和主题无关，切换主题时不会重置。

### 4.3 空间与几何

| token | 值 |
| --- | --- |
| `--uw-space-1` / `2` / `3` / `4` / `5` / `6` / `8` / `10` / `12` / `16` | `0.25` / `0.5` / `0.75` / `1` / `1.25` / `1.5` / `2` / `2.5` / `3` / `4` rem（4px 基线） |
| `--uw-radius-sm` / `md` / `lg` / `full` | `0.25rem`（标签）/ `0.375rem`（控件）/ `0.625rem`（卡片、面板、对话框）/ `9999px` |
| `--uw-border-width` | `1px` |
| `--uw-focus-ring-width` / `--uw-focus-ring-offset` | `2px` / `2px` |
| `--uw-size-icon-sm` / `md` | `1rem` / `1.25rem` |
| `--uw-size-control-sm` / `md` / `lg` | `1.75rem` / `2rem` / `2.5rem` |
| `--uw-size-target-min` | `1.5rem`，交互目标的最小尺寸（[a11y §6](./a11y.md#6-尺寸缩放与目标大小)） |
| `--uw-size-panel` / `-min` / `-max` | `22.5rem` / `20rem` / `35rem`，工作站面板宽度 |
| `--uw-size-page-max` | `75rem`，作品库等页面的最大宽度 |

### 4.4 层级、不透明度、断点

| token | 值 | 用途 |
| --- | --- | --- |
| `--uw-z-sticky` | `10` | 粘顶的工具行 |
| `--uw-z-overlay` | `100` | 对话框和它的遮罩 |
| `--uw-z-popover` | `200` | 菜单、下拉、气泡。高于对话框，因为它们可能从对话框里打开 |
| `--uw-z-toast` | `300` | 通知 |
| `--uw-z-tooltip` | `400` | 提示 |
| `--uw-opacity-disabled` | `0.45` | 禁用态 |
| `--uw-opacity-muted` | `0.7` | 仍可见、但不是当前重点的元素 |

断点不能写成 CSS 变量（媒体查询里读不到变量），所以用 `@custom-media` 在 `media.css` 里定义一次，由构建工具展开：

```css
@custom-media --uw-compact (width < 48rem);
@custom-media --uw-wide (width >= 80rem);
```

## 5. 语义 token：颜色契约与两套取值

两套主题都必须完整定义下表中的每一项。浅色像米白书页，深色像夜里的暖灰；强调色是墨蓝（[设计准则 §6](./design-guidelines.md#6-颜色)）。

| token | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--uw-color-bg` | 应用背景 | `#F4F2ED` | `#181715` |
| `--uw-color-surface` | 面板、卡片 | `#FBFAF7` | `#201F1C` |
| `--uw-color-surface-raised` | 浮层 | `#FFFFFF` | `#292724` |
| `--uw-color-surface-sunken` | 输入框、凹陷区 | `#EEEBE5` | `#141311` |
| `--uw-color-surface-hover` | 可交互项悬停 | `#F0EDE7` | `#2A2825` |
| `--uw-color-surface-pressed` | 可交互项按下 | `#E8E4DD` | `#33302C` |
| `--uw-color-surface-selected` | 选中项 | `#E4E9F0` | `#28313D` |
| `--uw-color-text` | 主要文字 | `#26221D` | `#E7E3DB` |
| `--uw-color-text-muted` | 次要文字、说明、占位符 | `#5F584F` | `#ACA59A` |
| `--uw-color-text-subtle` | 装饰性或大字号的元信息，不承载必读内容 | `#888074` | `#827C72` |
| `--uw-color-text-on-accent` | 强调色实底上的文字 | `#FFFFFF` | `#141A21` |
| `--uw-color-border` | 分隔线、卡片描边（装饰性） | `#E3DED5` | `#33302C` |
| `--uw-color-border-control` | 输入框、复选框等控件的边框 | `#857C70` | `#857E76` |
| `--uw-color-accent` | 主按钮底色、选中指示 | `#3B5878` | `#8EAED3` |
| `--uw-color-accent-hover` | 强调色悬停 | `#324C68` | `#A2BEDF` |
| `--uw-color-accent-pressed` | 强调色按下 | `#2A405A` | `#7C9DC3` |
| `--uw-color-accent-soft` | 柔和底：徽标底、选中行 | `#E4E9F0` | `#28313D` |
| `--uw-color-accent-text` | 用作文字的强调色：链接 | `#34506E` | `#9BB8DA` |
| `--uw-color-focus-ring` | 键盘焦点环 | `#3B5878` | `#8EAED3` |
| `--uw-color-success` / `-soft` | 成功：前景 / 柔和底 | `#3B7350` / `#E3EEE6` | `#82B592` / `#22302A` |
| `--uw-color-warning` / `-soft` | 警告 | `#8A5D14` / `#F4EBDA` | `#D6A75A` / `#352C1D` |
| `--uw-color-danger` / `-soft` | 危险、破坏性操作 | `#A8402F` / `#F5E2DE` | `#E48C80` / `#3A2422` |
| `--uw-color-info` / `-soft` | 中性提示 | `#45637F` / `#E4EAF0` | `#94ADC8` / `#243039` |
| `--uw-color-page` | 正文纸面，独立于 `surface` | `#FAF7F1` | `#1D1C1A` |
| `--uw-color-ink` | 正文墨色，独立于 `text` | `#3A342D` | `#D9D3C8` |
| `--uw-color-ink-muted` | 正文里的次要文字 | `#665D52` | `#A29B90` |
| `--uw-color-ink-action` | 夹在剧情之间的玩家行动 | `#3B5878` | `#9BB8DA` |
| `--uw-color-ink-selection` | 正文选中底 | `rgb(59 88 120 / 0.18)` | `rgb(142 174 211 / 0.28)` |
| `--uw-color-ink-highlight` | 从手记跳回原文时的定位高亮、搜索命中 | `#F2E5C2` | `#3A3222` |
| `--uw-color-scrim` | 对话框遮罩 | `rgb(38 34 29 / 0.32)` | `rgb(0 0 0 / 0.5)` |
| `--uw-color-shadow` | 投影色的 RGB 三元组，供 §7 合成 | `40 32 20` | `0 0 0` |

**对比度**（按上表取值计算，§12 的测试会钉住它们）。下表的“各个表面”指全部 7 种表面底色：`bg`、`surface`、`surface-raised`、`surface-sunken`、`surface-hover`、`surface-pressed`、`surface-selected`。

| 组合 | 浅色 | 深色 | 要求 |
| --- | --- | --- | --- |
| `text` 对各个表面 | ≥ 12.4 : 1 | ≥ 10.2 : 1 | ≥ 4.5 : 1 |
| `text-muted` 对各个表面 | ≥ 5.5 : 1 | ≥ 5.3 : 1 | ≥ 4.5 : 1 |
| `text-subtle` 对各个表面 | ≥ 3.0 : 1 | ≥ 3.1 : 1 | ≥ 3 : 1，只用于大字号或装饰 |
| `ink` 对 `page` | 11.5 : 1 | 11.4 : 1 | 落在约 11 : 1 的护眼区间：足够清楚，又不像纯黑配纯白那样刺眼 |
| `accent-text` 对各个表面；`ink-action` 对 `page` | ≥ 6.5 : 1 | ≥ 6.4 : 1 | ≥ 4.5 : 1 |
| 四种反馈色对 `surface` | ≥ 5.3 : 1 | ≥ 6.5 : 1 | ≥ 4.5 : 1 |
| `border-control` 对各个表面 | ≥ 3.2 : 1 | ≥ 3.2 : 1 | ≥ 3 : 1（WCAG 1.4.11） |
| `focus-ring` 对各个表面 | ≥ 5.8 : 1 | ≥ 5.7 : 1 | ≥ 3 : 1 |

**两条规则：**

- **反馈色独立于强调色。** 成功、警告、危险表达的是状态，强调色表达的是可交互和选中，两者不混用。
- **正文的纸和墨独立于界面的表面和文字。** 这样正文的护眼取值可以单独调整，不受界面配色牵连。

## 6. 材质：预留给将来的主题

界面上的大面积表面分四类。功能层和浮层的背景一律通过材质 token 取得；内容和通知的背景直接用颜色 token，永远不透明：

| 材质角色 | 用在哪里 | token | 浅色和深色主题的取值 |
| --- | --- | --- | --- |
| 功能层 `chrome` | 顶部工具行、工作站面板 | `--uw-material-chrome-bg`、`--uw-material-chrome-backdrop` | `var(--uw-color-surface)`、`none` |
| 浮层 `overlay` | 菜单、下拉、气泡、对话框 | `--uw-material-overlay-bg`、`--uw-material-overlay-backdrop`、`--uw-material-overlay-border`、`--uw-material-overlay-elevation` | `var(--uw-color-surface-raised)`、`none`、`var(--uw-color-border)`、`var(--uw-elevation-overlay)` |
| 内容 | 正文纸、卡片、输入框、表格 | 直接用颜色 token | 永远不透明，不经过材质 token |
| 通知 `toast` | 通知、错误提示 | 背景直接用 `--uw-color-surface-raised`；描边和投影借用 `--uw-material-overlay-border`、`--uw-material-overlay-elevation` | 背景永远不透明；描边和投影跟着浮层的取值走 |

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

现在 `backdrop` 的值是 `none`，看起来和直接写颜色没有区别。之所以现在就这样写，是为了以后接半透明主题时，组件一行都不用改。

**将来的半透明主题（例如仿 Apple 液态玻璃的主题）必须遵守的约束。** 这些约束现在就写下来，让组件的写法从一开始就不挡路：

1. **只改材质 token 的值。** 组件不读主题名，也不为某个主题写分支。
2. **只有功能层和浮层可以半透明。** 内容和通知——正文、卡片、输入框、通知、错误提示——永远不透明。
3. **同屏同时生效的 `backdrop-filter` 不超过一块**，否则滚动和动画时开销太大。
4. **四种情况一律回落成不透明：** 用户在设置里关闭透明效果、`prefers-reduced-transparency: reduce`、`prefers-contrast: more`、环境不支持 `backdrop-filter`。四种情况翻的是同一组材质 token。
5. **不对 `filter`、`backdrop-filter` 做动画。** 面板改尺寸这类结构动效进行期间，材质降一档（[动效 §7](./motion.md#7-性能)）。
6. **对比度要在真实合成的背景上测量**，不能只拿 token 的颜色值计算。
7. **平台原生材质是平台事实，不是主题状态。** macOS 窗口的 `vibrancy`、Windows 的 `backgroundMaterial` 由 desktop 决定，再告诉 client。client 不自己猜测平台。

## 7. 层次（投影）

| token | 浅色 | 深色 |
| --- | --- | --- |
| `--uw-elevation-surface` | `0 1px 2px rgb(var(--uw-color-shadow) / 0.06)` | `inset 0 1px 0 rgb(255 255 255 / 0.04)` |
| `--uw-elevation-overlay` | `0 1px 3px rgb(var(--uw-color-shadow) / 0.08), 0 8px 24px rgb(var(--uw-color-shadow) / 0.12)` | `inset 0 1px 0 rgb(255 255 255 / 0.06), 0 12px 32px rgb(var(--uw-color-shadow) / 0.45)` |

浅色主题靠投影分层，深色主题靠“越高的层越亮”加顶边的一条细亮线分层，因为深色背景上投影几乎看不见（[设计准则 §5](./design-guidelines.md#5-层次与材质)）。

## 8. 提高对比度

`prefers-contrast: more` 时，每个主题文件把以下 token 覆盖掉，组件不用写任何东西：

| token | 覆盖为 |
| --- | --- |
| `--uw-color-text-muted` | `var(--uw-color-text)` |
| `--uw-color-text-subtle` | 原来的 `text-muted` 值 |
| `--uw-color-border` | `var(--uw-color-border-control)` |
| `--uw-focus-ring-width` | `3px` |

Windows 的强制颜色模式（`forced-colors: active`）见 [a11y §7](./a11y.md#7-系统偏好)。

## 9. 外观偏好与切换

**偏好存在 core。** 外观偏好（跟随系统 / 浅色 / 深色）和阅读偏好（正文字号、字体、行距）都存在 core 的设置里，因为桌面版和将来的 web 客户端要共用同一份偏好。设置页通过契约里的 `settings.get` 和 `settings.update` 两个过程读写它们。

**首屏不闪。** core 返回 `index.html` 时，把偏好直接写在根元素上：

```html
<html lang="zh-CN" data-uw-appearance="system" data-uw-prose-size="3" data-uw-prose-font="serif" data-uw-prose-leading="comfortable">
```

`<head>` 里有一段很短的内联脚本，在首次绘制前用 `matchMedia('(prefers-color-scheme: dark)')` 把 `system` 解析成具体的主题，写成 `data-uw-theme="light"` 或 `data-uw-theme="dark"`。主题 CSS 只认 `data-uw-theme`，所以 DOM 上永远不会出现 `system` 这个值。

写进 HTML 的这些值都是枚举。core 先按 contracts 里的 schema 校验，再写入，不拼接任意字符串。内联脚本带上 core 为这次响应生成的 nonce，配合内容安全策略（[架构总览 §2.1](./architecture.md#21-本机接口的安全)）。

**唯一的写入口。** 首屏之后，根元素上的这些属性只由 `applyAppearance()` 写入。调用时机包括：用户改了偏好、系统明暗变化（监听上面那个 `matchMedia`）、启动或收到设置变化通知后与 core 同步设置。

**原生界面跟着走：**

- 每个主题文件都声明 `color-scheme: light` 或 `color-scheme: dark`，让滚动条、原生表单控件、默认选中色跟主题一致。
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
apps/client/src/theme/
  tokens.css         基元 token、材质与动效的默认值、阅读偏好映射、prefers-* 覆盖
  media.css          @custom-media 断点
  themes/light.css   浅色主题：颜色、层次、color-scheme、提高对比度时的覆盖
  themes/dark.css    深色主题：同上
  appearance.ts      applyAppearance()：首屏之后唯一写入根属性的入口
  boot.inline.js     首屏前解析外观的内联脚本，由 core 内联进 index.html
```

## 12. 强制检查

规则只写在文档里是不够的，下面这些检查保证它们真正生效：

- **stylelint：**
  - 用 `stylelint-declaration-strict-value` 把 §10 列出的属性限制为只能用 `var(--…)` 或允许的字面量；
  - 用 `color-no-hex`、`color-named: never`，以及禁止 `rgb`、`hsl`、`color-mix` 等颜色函数的规则，禁止颜色字面量。`themes/*.css` 豁免这一条；
  - 禁止 `transition: all`；
  - 要求使用逻辑属性。
- **oxlint：** 用 oxlint 的 JS 插件自写一条规则，规定 JSX 的 `style` 对象里只允许 `--` 开头的键（[技术选型 §9](./tech-stack.md#9-代码质量)）。
- **token 契约测试：**
  - 解析两个主题文件，确认 §5、§6、§7 的每个 token 在两边都有定义；
  - 按 §5 的对比度表计算每一组颜色，低于要求就失败。
- **外观测试：**
  - DOM 上从不出现 `data-uw-theme="system"`；
  - 首屏前就已经有 `data-uw-theme`；
  - 切换期间挂上 `data-uw-theme-switching`，切换结束后摘掉。

## 13. 新增一套主题

1. 复制 `themes/light.css` 或 `themes/dark.css`，改成新的主题 id。id 只用小写字母和连字符，发布后不再改名。
2. 填完 §5、§6、§7 的全部 token，并通过 §12 的契约测试和对比度测试。
3. 材质 token 默认指向不透明的颜色 token，只有确实需要时才改成半透明；动效 token 也只在确实需要时覆盖。半透明主题遵守 §6 的约束。
4. 在外观偏好里加上这个选项；展示名走 i18n。
5. 用户保存的主题 id 不认识时（例如主题被撤下），回落为“跟随系统”，不报错。

## 14. 不做的事

- **按作品改变界面配色。** 界面基调固定，作品内容只在正文里呈现（[设计准则 §1](./design-guidelines.md#1-基调)）。
- **用户自定义颜色或导入第三方主题 CSS。** 会造成对比度和验收矩阵失控，也会执行外部样式。
- **CSS-in-JS 或 Tailwind。** token 只有一个来源，就是这几份 CSS 文件。

## 15. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 外观设为跟随系统 | 启动应用，再切换系统的明暗 | 首屏没有闪烁；系统切换后界面交叉淡入到新主题，原生菜单和滚动条也跟着变 |
| 任意页面 | 在设置里切换浅色和深色 | 整页淡入淡出一次，按钮之类的控件不会各自再淡变；开启减少动态效果后照样淡入淡出 |
| 系统开启提高对比度 | 浏览作品库、游玩页、设置 | 次要文字与背景的对比提高，分隔线变成控件边框色，焦点环变粗 |
| 代码里新加一处写死的颜色或间距 | 运行 stylelint | 报错 |
| 只在浅色主题里新增一个语义 token | 运行 token 契约测试 | 失败，指出深色主题缺这一项 |
| 阅读偏好设为最大字号 + 无衬线字体 | 切换主题 | 阅读偏好保持不变 |
