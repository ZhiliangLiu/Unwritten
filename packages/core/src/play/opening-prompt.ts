import type { WorkSettings } from '@unwritten/contracts';
import type { VersionMeta } from '../store/meta.ts';
import { readPlan, readPublicSetting } from '../store/plan.ts';
import type { CodeBook } from '../story/codebook.ts';
import { renderEntityLine, renderSecretLines, renderStateBlock } from '../story/render.ts';
import type { StoryProjection } from '../story/types.ts';
import type { CastMember } from './cast-tool.ts';

export const CAST_SYSTEM_PROMPT =
  '你要为这一局文字冒险确定主要人物。作品为每个人物位置写了作用和一次相遇的样例；按位置各写一个具体的人：名字、主角此刻怎么称呼他、一句话档案。人物要符合作品设定和这个位置的作用，彼此不同，也不要和【已有的人物】同名。调用 `propose_cast` 提交，每个位置一行。收到字段错误时修正后重新提交。';

export const OPENING_SYSTEM_PROMPT =
  '你要为这一局写开场。作品已经采用了一份开场，它定下了时间、地点和处境；这一局的主要人物也已经确定。以【采用的开场】为准，保留时间、地点和处境，让【这一局的人物】按各自的位置进入开场，其余尽量和采用的开场一致。按作者的叙事要求写，不越过内容边界。主角此刻还不知道名字的人物，正文和选项里只写主角看到的样子。用 new_entity 登记这一局的人物，"slot" 写人物位置的编号，名字和【这一局的人物】一致。调用 `propose_opening` 提交，按工具说明填写每个字符串参数。收到字段错误时修正后重新提交。';

const HINT_MODE_TEXT: Record<WorkSettings['actions']['hints'], string> = {
  actions_only: '只显示行动：推荐行动不写 hint。',
  known_consequences: '提醒已知后果：每个推荐行动可以带一句 hint，只用主角已知的信息。',
};

function planSummary(meta: VersionMeta, key: 'identity' | 'tone' | 'situation' | 'world'): string | null {
  const item = readPlan(meta)?.items.find((candidate) => candidate.kind === 'summary' && candidate.key === key);
  return item?.kind === 'summary' ? item.text : null;
}

function storyPlanBlock(meta: VersionMeta): string | null {
  const summaries = [
    ['identity', '玩家身份'],
    ['tone', '基调'],
    ['situation', '开场处境'],
    ['world', '世界'],
  ] as const;
  const lines = summaries.flatMap(([key, label]) => {
    const text = planSummary(meta, key);
    return text ? [`- ${label}：${text}`] : [];
  });
  return lines.length ? `【故事方案】\n${lines.join('\n')}` : null;
}

function narrationBlock(meta: VersionMeta): string {
  const directive = (meta.anchors?.narrationDirective ?? '').trim();
  const language = meta.narration?.language?.trim() || '跟随背景所用的语言';
  return `【叙事要求】\n${[`作品语言：${language}。`, directive].filter(Boolean).join('\n')}`;
}

function protagonistBlock(projection: StoryProjection, codebook: CodeBook, name: string): string | null {
  const protagonist = projection.entities.get(projection.protagonistId);
  if (!protagonist) return null;
  return `【主角】\n${codebook.entityCode(protagonist.id)} ${name} · ${protagonist.profile}`;
}

export function buildCastPrompt(input: {
  meta: VersionMeta;
  projection: StoryProjection;
  codebook: CodeBook;
  protagonistName: string;
}): string {
  const { meta, projection, codebook } = input;
  const castLines = [...projection.entities.values()]
    .filter((entity) => entity.kind === 'character' && entity.id !== projection.protagonistId)
    .map((entity) => renderEntityLine(projection, codebook, entity.id));
  const slotLines = (meta.castSlots ?? []).map(
    (slot, index) => `- 位置${index + 1}：作用：${slot.role}；相遇样例：${slot.encounter}`,
  );
  const publicSetting = readPublicSetting(meta).trim();
  const improvisationScope = (meta.anchors?.improvisationScope ?? '').trim();
  const blocks = [
    `【作品设定】\n${meta.background}`,
    publicSetting ? `【公开设定】\n${publicSetting}` : null,
    narrationBlock(meta),
    improvisationScope ? `【即兴范围】\n${improvisationScope}` : null,
    protagonistBlock(projection, codebook, input.protagonistName),
    castLines.length ? `【已有的人物】\n${castLines.join('\n')}` : null,
    slotLines.length ? `【人物位置】\n${slotLines.join('\n')}` : null,
  ];
  return blocks.filter((block) => block !== null).join('\n\n');
}

export function buildOpeningPrompt(input: {
  meta: VersionMeta;
  settings: WorkSettings;
  projection: StoryProjection;
  codebook: CodeBook;
  protagonistName: string;
  opening: { prose: string; options: Array<{ text: string }> };
  cast: Array<{ index: string; role: string; member: CastMember }>;
}): string {
  const { meta, settings, projection, codebook } = input;
  const entityLines = [...projection.entities.values()]
    .filter((entity) => entity.id !== projection.protagonistId)
    .map((entity) => renderEntityLine(projection, codebook, entity.id));
  const castLines = input.cast.map(
    (entry) =>
      `- 位置${entry.index}（${entry.role}）：${entry.member.name}，${
        entry.member.knownAs ? `主角称作「${entry.member.knownAs}」` : '主角还不知道名字'
      }，${entry.member.profile}${entry.member.appearance ? `，形象：${entry.member.appearance}` : ''}`,
  );
  const openingBlock = [
    `【采用的开场】\n${input.opening.prose}`,
    `推荐行动：\n${input.opening.options.map((option) => `- ${option.text}`).join('\n')}`,
  ].join('\n');
  const secretLines = renderSecretLines(projection, codebook, [...projection.entities.keys()]);
  const stateBlock = renderStateBlock(projection, codebook);
  const contentPolicy = (meta.anchors?.contentPolicy ?? '').trim();
  const improvisationScope = (meta.anchors?.improvisationScope ?? '').trim();
  const ending = meta.ending?.trim() ?? '';
  const sceneLines = (meta.keyScenes ?? []).map((scene) => `- ${scene.condition} → ${scene.outcome}`);
  const blocks = [
    `【作者背景】\n${meta.background}`,
    narrationBlock(meta),
    contentPolicy ? `【内容边界】\n${contentPolicy}` : null,
    improvisationScope ? `【即兴范围】\n${improvisationScope}` : null,
    storyPlanBlock(meta),
    protagonistBlock(projection, codebook, input.protagonistName),
    entityLines.length ? `【人物与事物】\n${entityLines.join('\n')}` : null,
    secretLines ? `【秘密】\n${secretLines}` : null,
    stateBlock ? `【状态栏】\n${stateBlock}` : null,
    sceneLines.length ? `【关键场面】\n${sceneLines.join('\n')}` : null,
    ending ? `【结束条件】\n${ending}` : null,
    openingBlock,
    castLines.length ? `【这一局的人物】\n${castLines.join('\n')}` : null,
    `【行动提示】\n${HINT_MODE_TEXT[settings.actions.hints]}`,
  ];
  return blocks.filter((block) => block !== null).join('\n\n');
}
