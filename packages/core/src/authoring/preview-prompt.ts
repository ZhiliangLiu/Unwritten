import type { WorkSettings } from '@unwritten/contracts';
import type { VersionMeta } from '../store/meta.ts';
import { readPlan } from '../store/plan.ts';
import { placeholderToken } from '../text/placeholders.ts';
import type { CodeBook } from '../story/codebook.ts';
import { renderEntityLine, renderSecretLines, renderStateBlock } from '../story/render.ts';
import type { StoryProjection } from '../story/types.ts';

export const PREVIEW_SYSTEM_PROMPT =
  '你要按已经确认的故事方案写一部文字冒险的开场。按作者的叙事要求写，不越过内容边界，即兴只在不越出即兴范围的地方展开。方案里的人物、地点和事物用 @编号表示。让玩家清楚自己是谁、身处何地、眼前为什么值得行动；用可读的段落写，停在一个由玩家决定的时刻。为同一处境给出不同且现在可执行的行动。标题、简介和公开设定只使用开场时玩家能知道的信息。主角已经在方案里，不要再新增主角。主角此刻还不知道名字的人物和事物，正文和选项里只写主角看到的样子；要让主角知道一个名字，用 name 登记。开场里第一次出现、方案里没有的人物和事物，用 new_entity 登记。状态栏的开局值写在 state 里。按【开场方式】写：给了作者原文时不写正文，只交其余参数。【主角填写项】里有主角名时，凡是提到主角名字的地方写占位符，不写具体名字。调用 `propose_preview` 提交，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。';

const HINT_MODE_TEXT: Record<WorkSettings['actions']['hints'], string> = {
  actions_only: '只显示行动：推荐行动不写 hint。',
  known_consequences: '提醒已知后果：每个推荐行动可以带一句 hint，只用主角已知的信息。',
};

function planSummary(meta: VersionMeta, key: 'identity' | 'tone' | 'situation' | 'world'): string | null {
  const item = readPlan(meta)?.items.find((candidate) => candidate.kind === 'summary' && candidate.key === key);
  return item?.kind === 'summary' ? item.text : null;
}

function openingModeText(settings: WorkSettings): string {
  const text = settings.opening.text.trim();
  switch (settings.opening.mode) {
    case 'ai':
      return text ? `由你起草。作者的要求：${text}` : '由你起草。';
    case 'situation':
      return `按作者写的情境起草：${text}`;
    case 'author_text':
      return `采用作者原文，不写正文：\n${settings.opening.text}`;
  }
}

export function buildPreviewPrompt(input: {
  meta: VersionMeta;
  settings: WorkSettings;
  projection: StoryProjection;
  codebook: CodeBook;
}): string {
  const { meta, settings, projection, codebook } = input;
  const directive = (meta.anchors?.narrationDirective ?? '').trim();
  const contentPolicy = (meta.anchors?.contentPolicy ?? '').trim();
  const improvisationScope = (meta.anchors?.improvisationScope ?? '').trim();
  const language = meta.narration?.language?.trim() || '跟随背景所用的语言';

  const summaries = [
    ['identity', '玩家身份'],
    ['tone', '基调'],
    ['situation', '开场处境'],
    ['world', '世界'],
  ] as const;
  const summaryLines = summaries.flatMap(([key, label]) => {
    const text = planSummary(meta, key);
    return text ? [`- ${label}：${text}`] : [];
  });

  const protagonist = projection.entities.get(projection.protagonistId);
  const protagonistLine = protagonist
    ? `${codebook.entityCode(protagonist.id)} ${protagonist.name} · ${protagonist.profile}`
    : null;
  const entityLines = [...projection.entities.values()]
    .filter((entity) => entity.id !== projection.protagonistId)
    .map((entity) => renderEntityLine(projection, codebook, entity.id));

  const slots =
    settings.cast.mode === 'per_run'
      ? (meta.castSlots ?? []).map(
          (slot, index) => `- 位置${index + 1}：作用：${slot.role}；相遇样例：${slot.encounter}`,
        )
      : [];
  const secretLines = renderSecretLines(projection, codebook, [...projection.entities.keys()]);
  const stateBlock = renderStateBlock(projection, codebook);
  const sceneLines = (meta.keyScenes ?? []).map((scene) => `- ${scene.condition} → ${scene.outcome}`);
  const ending = meta.ending?.trim() ?? '';
  const fieldLines = settings.protagonist.fields.map(
    (field) =>
      `- ${field.name}${field.isName ? '（主角名）' : ''}：写 ${placeholderToken(field.name)}，玩家留空时是「${field.defaultValue}」`,
  );

  const blocks = [
    `【作者背景】\n${meta.background}`,
    `【叙事要求】\n${[`作品语言：${language}。`, directive].filter(Boolean).join('\n')}`,
    contentPolicy ? `【内容边界】\n${contentPolicy}` : null,
    improvisationScope ? `【即兴范围】\n${improvisationScope}` : null,
    summaryLines.length ? `【故事方案】\n${summaryLines.join('\n')}` : null,
    protagonistLine ? `【主角】\n${protagonistLine}` : null,
    entityLines.length ? `【人物与事物】\n${entityLines.join('\n')}` : null,
    slots.length ? `【人物位置】\n${slots.join('\n')}` : null,
    secretLines ? `【秘密】\n${secretLines}` : null,
    stateBlock ? `【状态栏】\n${stateBlock}` : null,
    sceneLines.length ? `【关键场面】\n${sceneLines.join('\n')}` : null,
    ending ? `【结束条件】\n${ending}` : null,
    `【开场方式】\n${openingModeText(settings)}`,
    `【行动提示】\n${HINT_MODE_TEXT[settings.actions.hints]}`,
    fieldLines.length ? `【主角填写项】\n${fieldLines.join('\n')}` : null,
  ];
  return blocks.filter((block) => block !== null).join('\n\n');
}
