export const SUMMARY_SYSTEM_PROMPT =
  '你要为文字冒险的一个回合写摘要。用作品语言写一两句话，不超过 120 字。点名出现的人物、地点和发生的事，写清玩家做了什么、结果如何。只写正文里发生的事，不评价，不推测。只输出摘要本身。';

export const SUMMARY_LIMITS = { maxChars: 200, maxOutputTokens: 512 } as const;

export function buildSummaryPrompt(input: {
  depth: number;
  action: string | null;
  prose: string;
  language: string;
}): string {
  return [
    `【作品语言】${input.language}`,
    `【回合】T${input.depth}`,
    `【玩家行动】${input.action ?? ''}`,
    '【正文】',
    input.prose,
  ].join('\n');
}
