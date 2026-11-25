# Unwritten 设计 token

[`tokens.json`](./tokens.json) 是颜色、排版、空间和动效的单源，使用 [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) 格式。浅色和深色分别保留完整的语义层。CSS 生成器面向 client，组件样式和各平台的外观切换由各消费方负责。

- [Unwritten Figma · Prototype](https://www.figma.com/design/uaT0KDEwC6wvVbKUiT5BcQ/Unwritten?node-id=19-2528) 展示组件和交互。Figma 以 px 展示几何尺寸，以百分比展示不透明度。导出保留网页所需的相对单位、字体回落和系统偏好。
- [主题与 token](../../docs/theme.md#11-文件布局) 和[动效](../../docs/motion.md#3-token) 定义命名、偏好和组件用法。

```sh
node scripts/check-tokens.mjs
node --test packages/tokens/build-css.test.mjs
node packages/tokens/build-css.mjs
```

最后一条默认生成 `apps/client/src/theme/tokens.css`、`media.css` 和 `themes/*.css`。可以传入输出目录。改值时编辑 JSON，生成文件由 Git 忽略。
