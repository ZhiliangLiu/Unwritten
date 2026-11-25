# Unwritten · 动效

本文定义 client 的动效原则、动效 token、各个场景的编排，以及实现规则。所有过渡和动效都只能通过这里定义的 token 来写（[主题与 token §10](./theme.md#10-组件怎样使用-token)）。原则主要来自 Apple 的 *Designing Fluid Interfaces*。

## 1. 原则

- **即时响应。** 按下的那一刻就给反馈，不等松开；输入后 100ms 内必须看到变化。
- **解释变化，不表演。** 动效只用来说明“刚才发生了什么、东西去了哪里”。用户不操作时，界面是静止的。
- **可以随时打断。** 任何动画进行中，用户都可以继续操作；正在关闭的浮层被再次打开时，从当前状态直接反向，不先播完。
- **从哪里来，回哪里去。** 浮层从触发它的元素长出来，关闭时缩回原处；从右侧滑入的面板，也从右侧退出。
- **默认不回弹。** 过渡平稳地停下，不过冲、不弹跳。只有用户甩动时带出了速度的手势才允许回弹，而 Unwritten 目前没有这类手势。
- **安静。** 除了加载指示，不使用循环动画；不做视差、粒子、打字机效果。

## 2. 四类动效

| 类别 | 由什么触发 | 用途 | 例子 |
| --- | --- | --- | --- |
| 反馈 | 悬停、按下、聚焦 | 告诉用户“可以操作”“操作已收到” | 按钮按下时底色加深并轻微缩小 |
| 状态 | 加载、完成、数值变化 | 说明状态变了 | 状态栏里变化的那一项短暂高亮 |
| 结构 | 浮层开合、面板开合、页面切换 | 说明空间关系 | 菜单从触发按钮长出来 |
| 阅读 | 新剧情到达、跳回原文 | 把读者的注意力引到新内容上，又不打断阅读 | 新的一段剧情淡入 |

## 3. token

**时长与延迟：**

| token | 值 | 用途 |
| --- | --- | --- |
| `--uw-motion-duration-fast` | `120ms` | 悬停、按下、小元素的状态变化 |
| `--uw-motion-duration-base` | `200ms` | 菜单、下拉、气泡、提示、通知 |
| `--uw-motion-duration-slow` | `280ms` | 对话框、工作站面板、页面内容切换 |
| `--uw-motion-duration-reading` | `360ms` | 新剧情淡入 |
| `--uw-motion-duration-theme` | `240ms` | 主题切换时的整页交叉淡入淡出 |
| `--uw-motion-duration-highlight` | `1200ms` | 变化高亮淡回原色 |
| `--uw-motion-duration-pulse` | `1600ms` | 加载指示的一次呼吸周期 |
| `--uw-motion-delay-tooltip` | `500ms` | 提示出现前的停留时间 |
| `--uw-motion-delay-stagger` | `80ms` | 新剧情的正文块与其后的状态栏、推荐行动之间的间隔 |

**缓动：**

| token | 值 | 用途 |
| --- | --- | --- |
| `--uw-motion-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 状态变化和位置移动，两个方向都用 |
| `--uw-motion-ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` | 出现：快进、慢停 |
| `--uw-motion-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 消失：慢起、快走，是 `enter` 的镜像，进出才走同一条路 |
| `--uw-motion-ease-linear` | `linear` | 呼吸、进度 |

**位移与缩放：**

| token | 值 | 用途 |
| --- | --- | --- |
| `--uw-motion-distance-sm` | `4px` | 新剧情、提案卡出现时的上移量 |
| `--uw-motion-distance-md` | `8px` | 页面内容切换、通知出现时的位移 |
| `--uw-motion-scale-enter` | `0.97` | 浮层、对话框出现时的起始缩放 |
| `--uw-motion-scale-press` | `0.98` | 按下时的缩放 |

**组合过渡。** 组件直接使用这些组合，不自己拼属性列表：

| token | 内容 | 用途 |
| --- | --- | --- |
| `--uw-transition-feedback` | `color`、`background-color`、`border-color`，用 `fast` + `standard` | 悬停、按下、选中的颜色变化 |
| `--uw-transition-press` | `transform`，用 `fast` + `standard` | 按下缩放 |
| `--uw-transition-popup` / `-popup-exit` | `opacity`、`transform`，用 `base` + `enter` / `exit` | 菜单、下拉、气泡、通知 |
| `--uw-transition-dialog` / `-dialog-exit` | `opacity`、`transform`，用 `slow` + `enter` / `exit` | 对话框、窄窗口下的工作站浮层 |
| `--uw-transition-panel` | `inline-size`，用 `slow` + `standard` | 工作站面板开合，全应用唯一的布局动画 |
| `--uw-transition-reading` | `opacity`、`transform`，用 `reading` + `enter` | 新剧情、提案卡出现 |

## 4. 减少动态效果

`prefers-reduced-motion: reduce` 时，`tokens.css` 统一覆盖 token，组件不用为此写任何代码：

| token | 覆盖为 | 效果 |
| --- | --- | --- |
| `--uw-motion-distance-sm`、`-md` | `0px` | 不再位移，只保留淡入淡出 |
| `--uw-motion-scale-enter`、`-press` | `1` | 不再缩放 |
| `--uw-motion-duration-slow`、`-reading` | `var(--uw-motion-duration-fast)` | 大面积的过渡改成很短的淡入 |
| `--uw-transition-panel` | `none` | 面板直接出现或收起 |
| `scroll-behavior` | `auto` | 不做平滑滚动 |

淡入淡出、颜色变化、主题切换的交叉淡入淡出都保留：它们不涉及位移，不会引起眩晕，反而能避免亮度突变。这条遵循 Apple 的做法：减少动态效果不等于取消所有反馈，而是换成不引起眩晕的等价形式。

## 5. 场景编排

| 场景 | 出现 / 发生 | 消失 / 结束 | 用到的 token |
| --- | --- | --- | --- |
| 悬停 | 底色变为 `surface-hover` | 反向 | `transition-feedback` |
| 按下 | 按下的瞬间底色变为 `surface-pressed`，并缩小到 `scale-press` | 松开后平稳复原，不回弹 | `transition-feedback`、`transition-press` |
| 焦点环 | 立即出现，没有过渡 | 立即消失 | 无 |
| 菜单、下拉、气泡 | 以触发点（Base UI 的 `--transform-origin`）为原点，从 `scale-enter` 放大并淡入 | 沿原路缩回并淡出 | `transition-popup`、`-popup-exit` |
| 提示 | 停留 `delay-tooltip` 后淡入，不缩放。在相邻元素之间连续移动时立即出现（Base UI 的 `[data-instant]`） | 淡出 | `transition-popup` 中的 `opacity` |
| 对话框 | 遮罩淡入；对话框从中心以 `scale-enter` 放大并淡入 | 反向 | `transition-dialog`、`-dialog-exit` |
| 通知 | 从所在屏幕边缘的方向移入 `distance-md`，同时淡入 | 沿原路退出 | `transition-popup`、`-popup-exit` |
| 工作站面板（创作页） | 列宽从 0 展开到面板宽度，面板内容随后淡入 | 内容先淡出，列宽再收回 | `transition-panel`、`transition-popup` |
| 窄窗口下的工作站 | 从右侧整体滑入，覆盖在主区之上 | 滑回右侧 | `transition-dialog`、`-dialog-exit` |
| 页面切换 | 外壳不动；新内容淡入并上移 `distance-md` | 旧内容直接移除，不播放离开动画，免得用户等待 | `transition-dialog` |
| 新剧情到达 | 整段正文作为一个块淡入，并上移 `distance-sm`；间隔 `delay-stagger` 后，状态栏和推荐行动淡入 | 无 | `transition-reading` |
| 生成中 | 预览文字随生成直接追加，不逐字动画；预览下方是“生成中”标记，透明度缓慢呼吸 | 提交后，预览原地换成正式回合，不再播放一次进入动画 | `duration-pulse`、`ease-linear` |
| 自动跟随 | 玩家停在最新位置时，新内容出现后平滑滚动，让它进入视野 | 玩家往上翻过时不滚动，改为淡入一个“回到最新”按钮 | `transition-popup` |
| 换一种发展的比较 | 原版和候选之间交叉淡入淡出 | 同左 | `duration-base` |
| 状态栏数值变化 | 变化的那一项底色变为 `accent-soft`，在 `duration-highlight` 内淡回 | 无 | `duration-highlight` |
| 提案卡出现 | 淡入并上移 `distance-sm` | 无 | `transition-reading` |
| 确认提案卡 | 按钮区换成回执，只有颜色过渡 | 无 | `transition-feedback` |
| 从手记跳回原文 | 平滑滚动到那一段；该段底色变为 `ink-highlight`，在 `duration-highlight` 内淡回 | 无 | `duration-highlight` |
| 主题切换 | 整页交叉淡入淡出（[主题与 token §9](./theme.md#9-外观偏好与切换)） | 无 | `duration-theme` |
| 加载 | 骨架块的透明度缓慢呼吸 | 内容到达后直接替换 | `duration-pulse` |
| 成功、失败 | 静态的图标和文字，不播放动画 | 无 | 无 |

## 6. 实现规则

1. **状态变化用 CSS transition，不用 `@keyframes`。** transition 可以在中途被打断并平滑反向，keyframes 不行。这也是 Base UI 推荐的做法。keyframes 只用于循环：呼吸和加载转圈。
2. **出现和消失的写法：**
   - Base UI 组件用 `[data-starting-style]` 和 `[data-ending-style]` 写出现前、消失后的样式；
   - 非 Base UI 的元素首次挂载时，用 CSS 的 `@starting-style` 写出现前的样式。
3. **只引用 token。** 时长、缓动、位移、缩放、组合过渡全部用 §3 的 token。不写 `transition: all`。
4. **只动 `transform` 和 `opacity`。**
   - 颜色过渡只用于小元素的反馈；
   - `inline-size` 只用于工作站面板这一处；
   - 不对 `filter`、`backdrop-filter` 和大面积的 `box-shadow` 做动画。
5. **从当前状态开始。** 被打断的动画从屏幕上的当前值继续，CSS transition 天然就是这样。用 JS 写的动画也必须读取当前值，不能从目标值重新开始。
6. **不阻塞输入。** 动画进行期间，所有控件照常可用。
7. **一次性的状态动效，绑在真实的变化事件上。**
   - 状态栏高亮、跳回原文的定位高亮，都由组件在“值刚刚变化”或“刚刚跳转”时挂上瞬态属性 `data-uw-changed`，再由计时器摘掉；
   - 首次挂载和回看历史时不挂，否则早已发生的变化会被当成刚刚发生；
   - 摘掉属性靠计时器，不靠 `animationend`：减少动态效果时动画可能根本不会触发，属性就会一直留在 DOM 上。
8. **拖拽 1:1 跟手。** 目前唯一的拖拽是调整工作站面板宽度，它直接跟随指针，不加动画。将来如果出现松手后需要继续运动的手势，用临界阻尼的弹簧（阻尼比 1.0，响应 0.35 秒），并把参数加进 §3 的 token 表。
9. **JS 需要的时长从 CSS 读取。** 例如提示的停留时间，用一个工具函数从 `--uw-motion-delay-tooltip` 读出，不在 TypeScript 里再写一份数字。
10. **主题切换闸只罩颜色反馈。** 切换主题期间，`[data-uw-theme-switching]` 把 `--uw-transition-feedback` 设为 `none`。不要用 `*` 选择器把所有过渡都关掉：那会取消正在进行的展开、收起动画，依赖 `transitionend` 收尾的组件会卡在半路。
11. **减少动态效果统一由 token 处理。** 组件不写自己的 `prefers-reduced-motion` 块。用 JS 写的动画通过 `matchMedia` 读取这项偏好。

## 7. 性能

- **时长上限：**
  - 悬停和按下 ≤ 120ms；
  - 浮层 ≤ 200ms；
  - 对话框、面板、页面切换 ≤ 280ms；
  - 只有新剧情淡入可以用到 360ms，因为它服务的是阅读节奏，而不是操作反馈。
- **结构动效期间的瞬态标记。** 工作站面板开合期间，外壳上挂瞬态属性 `data-uw-structure-motion`，在 `transitionend` 时摘掉；超过 `--uw-motion-duration-slow` 仍未收到 `transitionend` 时，同样摘掉。
  - 浅色和深色主题不使用这个属性；
  - 它留给将来的材质主题，用来在列宽逐帧变化期间降低材质开销（[主题与 token §6](./theme.md#6-材质预留给将来的主题)）。
- **循环动画只在需要时运行。** 呼吸动画只在加载、生成期间存在，结束即移除。
- **不用 JS 定时器驱动装饰性动画。**
- **`will-change` 只在动画即将开始时加上，结束后去掉。**

## 8. 不做的事

- **打字机效果。** 逐字蹦出会打断阅读节奏，正文直接追加。
- **翻页、卷轴这类拟物转场。**
- **回弹和弹性效果**，见 §1。
- **视差、粒子、环境动画。**
- **声音和触觉反馈。**

## 9. 验收

| 从什么情况开始 | 操作 | 应当看到的结果 |
| --- | --- | --- |
| 菜单正在打开 | 在动画进行中立刻点击关闭 | 菜单从当前大小直接缩回，没有跳变 |
| 游玩页，停在最新位置 | 提交一个行动，等新剧情到达 | 正文块淡入，状态栏和推荐行动稍后淡入；页面平滑滚动到新内容 |
| 游玩页，往上翻看前文 | 等新剧情到达 | 阅读位置不动，出现“回到最新”按钮 |
| 打开状态栏所在的旧路线 | 进入页面 | 没有任何一项播放变化高亮 |
| 系统开启减少动态效果 | 打开菜单、对话框、工作站面板，并提交一个行动 | 没有位移和缩放，只有短暂的淡入；面板直接出现 |
| 任意组件的 CSS | 写一个写死的时长或 `transition: all` | stylelint 报错 |
| 展开中的折叠区 | 同时切换主题 | 折叠区正常展开完毕，不会卡在半路 |
| 创作页，真实的 Electron 窗口 | 工作站面板开合 10 次 | 没有明显卡顿；记录长帧数量作为基线 |
