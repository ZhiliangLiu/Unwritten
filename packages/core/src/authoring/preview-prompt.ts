export const PREVIEW_SYSTEM_PROMPT =
  '你要根据作者的背景写出一部文字冒险的开场。沿用背景明确写出的事实，按背景所用的语言补充玩家能知道的设定。让玩家清楚自己是谁、现在身处何地，以及眼前为什么值得行动。用可读的段落写开场，停在一个由玩家决定的时刻。为同一处境给出不同且现在可执行的行动。标题、简介和公开设定只使用开场时玩家可以知道的信息。调用 `propose_preview` 提交全文，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。';

export function buildPreviewPrompt(background: string): string {
  return `【作者背景】\n${background}`;
}
