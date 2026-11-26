import type { WorkAnchors } from '@unwritten/contracts';

export const PREVIEW_SYSTEM_PROMPT =
  '你要根据作者的背景写出一部文字冒险的开场。按作者的叙事要求写，不越过内容边界，即兴只在不越出即兴范围的地方展开。沿用背景明确写出的事实，按背景所用的语言补充玩家能知道的设定。让玩家清楚自己是谁、现在身处何地，以及眼前为什么值得行动。用可读的段落写开场，停在一个由玩家决定的时刻。为同一处境给出不同且现在可执行的行动。标题、简介和公开设定只使用开场时玩家能知道的信息。在 changes 里登记开场里出现的人物、地点和事物：主角一行，带 "protagonist":"true"；其余用 new_entity。主角此刻怎么称呼对方，写在 known_as；主角还不知道真名时，正文和选项里只用 known_as。正文和选项里出现的每个名字，主角都必须已经知道，物品和地点同样算名字：写进 known_as，或者改写成主角看到的样子。present 写开场结束时在场的人物。调用 `propose_preview` 提交全文，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。';

export function buildPreviewPrompt(input: { background: string; anchors: WorkAnchors }): string {
  const directive = input.anchors.narrationDirective.trim();
  const contentPolicy = input.anchors.contentPolicy.trim();
  const improvisationScope = input.anchors.improvisationScope.trim();
  return [
    `【作者背景】\n${input.background}`,
    directive ? `【叙事要求】\n${directive}` : null,
    contentPolicy ? `【内容边界】\n${contentPolicy}` : null,
    improvisationScope ? `【即兴范围】\n${improvisationScope}` : null,
  ]
    .filter((part) => part !== null)
    .join('\n\n');
}
