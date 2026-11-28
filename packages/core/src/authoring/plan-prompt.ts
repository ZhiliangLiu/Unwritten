import type { PlanItem, WorkAnchors, WorkSettings } from '@unwritten/contracts';

export const PLAN_SYSTEM_PROMPT =
  '你要读作者的背景、写作要求和补充设定，整理出一份故事方案，交给作者确认。方案回答这几件事：玩家是谁、开场处境如何、故事是什么基调、世界里成立哪些事；有哪些人物、地点和事物；哪些是幕后的秘密、谁本来就知道、玩家凭什么能发现；状态栏跟踪什么；满足什么条件时发生关键场面；故事何时结束。作者写明的内容原样采用，标 "from":"author"；你补全的标 "from":"ai"。不必样样补齐：主角、玩家身份和开场处境一定要有，其余只在背景需要时补。【作者已确定的项】原样保留，不要重复列出，也不要改写。只有一个主角。【主要人物模式】是每次新开局生成时，主要人物写成人物位置：写它在故事里的作用和一次相遇的样例，不写具体的人。两条作者设定确实互相矛盾时，在 conflicts 里逐字引用两段原话，说明受影响的体验，不要自己裁定。作品语言跟随背景所用的语言。人物形象可省略；写形象时只写看得见的长相、身形、衣着与显眼特征，不写身份、来历和秘密。调用 `propose_plan` 提交，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。';

const CAST_MODE_TEXT: Record<WorkSettings['cast']['mode'], string> = {
  fixed: '固定主要角色',
  per_run: '每次新开局生成',
};

const OPENING_MODE_TEXT: Record<WorkSettings['opening']['mode'], string> = {
  ai: 'AI 起草',
  situation: '按作者写的情境',
  author_text: '采用作者原文',
};

const HINT_MODE_TEXT: Record<WorkSettings['actions']['hints'], string> = {
  actions_only: '只显示行动',
  known_consequences: '提醒已知后果',
};

const SUMMARY_LABELS: Record<(PlanItem & { kind: 'summary' })['key'], string> = {
  identity: '玩家身份',
  tone: '基调',
  situation: '开场处境',
  world: '世界',
  public_setting: '公开设定',
};

const ENTITY_KIND_LABELS: Record<(PlanItem & { kind: 'entity' })['entityKind'], string> = {
  character: '人物',
  place: '地点',
  item: '事物',
  group: '群体',
  other: '其他',
};

const DISPLAY_LABELS: Record<(PlanItem & { kind: 'state' })['display'], string> = {
  number: '数字',
  stage: '阶段',
  list: '清单',
  text: '文字',
};

function protectedLine(item: PlanItem): string {
  switch (item.kind) {
    case 'summary':
      return `- ${SUMMARY_LABELS[item.key]}：${item.text}`;
    case 'entity': {
      const kindLabel = item.slot ? '人物位置' : ENTITY_KIND_LABELS[item.entityKind];
      const roleLabel = item.role === 'protagonist' ? '（主角）' : item.role === 'cast' ? '（主要人物）' : '';
      return `- ${kindLabel}「${item.name}」${roleLabel}：${item.profile}`;
    }
    case 'secret':
      return `- 秘密「${item.title}」：${item.statement}`;
    case 'state':
      return `- 栏目「${item.label}」（${DISPLAY_LABELS[item.display]}）：开局 ${item.initial ?? '留空'}`;
    case 'scene':
      return `- 关键场面：${item.condition} → ${item.outcome}`;
    case 'ending':
      return `- 结束条件：${item.text}`;
  }
}

function settingsBlock(heading: string, text: string): string | null {
  return text.trim() ? `【补充设定 · ${heading}】\n${text}` : null;
}

function protagonistBlock(settings: WorkSettings): string | null {
  const parts: string[] = [];
  if (settings.protagonist.text.trim()) parts.push(settings.protagonist.text);
  if (settings.protagonist.fields.length) {
    const fields = settings.protagonist.fields
      .map((field) => `${field.name}（${field.isName ? '主角名，' : ''}默认「${field.defaultValue}」）`)
      .join('、');
    parts.push(`留给玩家填写：${fields}`);
  }
  return parts.length ? `【补充设定 · 玩家主角】\n${parts.join('\n')}` : null;
}

export function buildPlanPrompt(input: {
  background: string;
  anchors: WorkAnchors;
  settings: WorkSettings;
  protectedItems: PlanItem[];
}): string {
  const directive = input.anchors.narrationDirective.trim();
  const contentPolicy = input.anchors.contentPolicy.trim();
  const improvisationScope = input.anchors.improvisationScope.trim();
  const blocks = [
    `【作者背景】\n${input.background}`,
    directive ? `【叙事要求】\n${directive}` : null,
    contentPolicy ? `【内容边界】\n${contentPolicy}` : null,
    improvisationScope ? `【即兴范围】\n${improvisationScope}` : null,
    [
      `【主要人物模式】${CAST_MODE_TEXT[input.settings.cast.mode]}`,
      `【开场方式】${OPENING_MODE_TEXT[input.settings.opening.mode]}`,
      `【推荐行动】${HINT_MODE_TEXT[input.settings.actions.hints]}`,
    ].join('\n'),
    settingsBlock('世界', input.settings.world.text),
    protagonistBlock(input.settings),
    settingsBlock('主要人物', input.settings.cast.text),
    settingsBlock('秘密与知情', input.settings.secrets.text),
    settingsBlock('开场', input.settings.opening.text),
    settingsBlock('行动与提示', input.settings.actions.text),
    settingsBlock('关键场面与结局', input.settings.scenes.text),
    settingsBlock('初始状态栏', input.settings.status.text),
    input.protectedItems.length ? `【作者已确定的项】\n${input.protectedItems.map(protectedLine).join('\n')}` : null,
  ];
  return blocks.filter((block) => block !== null).join('\n\n');
}
