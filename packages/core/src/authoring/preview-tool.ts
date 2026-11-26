import type { Preview } from '@unwritten/contracts';
import { LanguageTagSchema } from '@unwritten/contracts';
import { normalizeProse, parseOptionLines, splitParagraphs } from '../text/turn-text.ts';
import { parseChanges } from '../story/changes.ts';
import { findLeaks } from '../story/leak.ts';
import type { ValidatedChanges } from '../story/types.ts';
import { STORY_LIMITS } from '../story/types.ts';

export const PREVIEW_TOOL_NAME = 'propose_preview';

export const PREVIEW_LIMITS = {
  titleMax: 40,
  blurbMax: 200,
  publicSettingMax: 1_000,
  proseMax: 6_000,
  paragraphsMax: 20,
  optionsMin: 1,
  optionsMax: 6,
  optionTextMax: 100,
  placeMax: 100,
  timeMax: 100,
} as const;

export const PREVIEW_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '作品标题' },
    blurb: { type: 'string', description: '给玩家看的简介，一两句话，不剧透' },
    public_setting: { type: 'string', description: '简短的公开设定：世界、主角身份和处境' },
    prose: { type: 'string', description: '开场正文，段落之间空一行' },
    options: { type: 'string', description: '推荐行动，每行一个 JSON：{"text":"…"}' },
    place: { type: 'string', description: '开场结束时主角所在的地点' },
    time: { type: 'string', description: '开场结束时的故事时间' },
    language: { type: 'string', description: '作品语言的语言标签，例如 zh-CN' },
    present: {
      type: 'string',
      description: '开场结束时在场的人物，写 changes 里新增人物的名字，用逗号分隔。只有主角时留空。',
    },
    changes: {
      type: 'string',
      description:
        '每行一个 JSON。引用人物或事物写名字；引用本次新写的事实，先给那行起一个 "id"（如 "f1"），再写这个 id。para 是出处在正文里的段号，从 1 起。必须恰好有一行主角：\n' +
        '{"type":"new_entity","kind":"character","name":"主角的名字","known_as":"","profile":"一句话档案","para":"1","protagonist":"true"}\n' +
        '其余可用的类型：\n' +
        '{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，正文或选项会写到它时必填","profile":"一句话档案","para":"1"}\n' +
        '{"type":"name","entity":"名字","name":"称呼","holder":"名字","para":"2"}\n' +
        '{"type":"event","subject":"名字","object":"名字","statement":"一句话","witnesses":"名字,名字","para":"2"}\n' +
        '{"type":"trait","subject":"名字","key":"特征名","statement":"一句话","para":"2"}\n' +
        '{"type":"relation","subject":"名字","object":"名字","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}\n' +
        '{"type":"promise","subject":"名字","object":"名字","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}\n' +
        '{"type":"knowledge","fact":"f1","holder":"名字","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"名字","para":"3"}\n' +
        '引用本次新写的事实要给它起 "id"，例如 {"type":"event",…,"id":"f1"}；每行的 id 不能重复。\n' +
        '开场里的 event 必须写明 witnesses。',
    },
  },
  required: ['title', 'blurb', 'public_setting', 'prose', 'options', 'place', 'time', 'language', 'present', 'changes'],
  additionalProperties: false,
} as const;

export type PreviewField =
  | 'title'
  | 'blurb'
  | 'public_setting'
  | 'prose'
  | 'options'
  | 'place'
  | 'time'
  | 'language'
  | 'present'
  | 'changes'
  | 'leak';

export interface PreviewParseResult {
  preview: Preview;
  changes: ValidatedChanges;
}

export type PreviewParse =
  { ok: true; value: PreviewParseResult } | { ok: false; errors: string[]; fields: PreviewField[] };

export function parsePreviewArgs(args: Record<string, unknown>): PreviewParse {
  const errors: string[] = [];
  const fields = new Set<PreviewField>();
  const fail = (field: PreviewField, message: string) => {
    fields.add(field);
    errors.push(message);
  };
  const text = (field: PreviewField): string | null => {
    const value = args[field];
    if (typeof value !== 'string') {
      fail(field, `参数 ${field} 必须是字符串`);
      return null;
    }
    return value;
  };
  const failed = (): PreviewParse => ({ ok: false, errors, fields: [...fields] });

  const title = text('title')?.trim() ?? null;
  const blurb = text('blurb')?.trim() ?? null;
  const publicSetting = text('public_setting')?.trim() ?? null;
  const proseRaw = text('prose');
  const optionsRaw = text('options');
  const place = text('place')?.trim() ?? null;
  const time = text('time')?.trim() ?? null;
  const language = text('language');

  const required: Array<[PreviewField, string | null, number]> = [
    ['title', title, PREVIEW_LIMITS.titleMax],
    ['blurb', blurb, PREVIEW_LIMITS.blurbMax],
    ['public_setting', publicSetting, PREVIEW_LIMITS.publicSettingMax],
    ['place', place, PREVIEW_LIMITS.placeMax],
    ['time', time, PREVIEW_LIMITS.timeMax],
  ];
  for (const [name, value, max] of required) {
    if (value === null) continue;
    if (!value) fail(name, `参数 ${name} 不能为空`);
    else if (Array.from(value).length > max) fail(name, `参数 ${name} 不能超过 ${max} 个字符`);
  }

  let prose = '';
  if (proseRaw !== null) {
    prose = normalizeProse(proseRaw);
    const paragraphs = prose.split(/\n{2,}/).filter((paragraph) => paragraph.length > 0);
    if (paragraphs.length < 1 || paragraphs.length > PREVIEW_LIMITS.paragraphsMax) {
      fail('prose', `参数 prose 的段落数必须在 1 到 ${PREVIEW_LIMITS.paragraphsMax} 之间`);
    }
    if (Array.from(prose).length > PREVIEW_LIMITS.proseMax) {
      fail('prose', `参数 prose 不能超过 ${PREVIEW_LIMITS.proseMax} 个字符`);
    }
  }

  let options: Preview['options'] = [];
  if (optionsRaw !== null) {
    const parsed = parseOptionLines(optionsRaw, {
      min: PREVIEW_LIMITS.optionsMin,
      max: PREVIEW_LIMITS.optionsMax,
      textMax: PREVIEW_LIMITS.optionTextMax,
    });
    if (!parsed.ok) for (const message of parsed.errors) fail('options', message);
    else options = parsed.value;
  }

  const changesRaw = text('changes');
  const presentRaw = text('present');

  if (language !== null && !LanguageTagSchema.safeParse(language).success) {
    fail('language', '参数 language 必须是合法的语言标签');
  }

  if (errors.length) return failed();
  const paragraphs = splitParagraphs(prose);
  let changes: ValidatedChanges | null = null;
  if (changesRaw !== null && !changesRaw.trim()) {
    fail('changes', '参数 changes 不能为空');
  } else if (changesRaw !== null) {
    const parsedChanges = parseChanges(changesRaw, {
      mode: 'opening',
      projection: null,
      codebook: null,
      paragraphCount: paragraphs.length,
      parentPresentIds: [],
    });
    if (!parsedChanges.ok) for (const message of parsedChanges.errors) fail('changes', message);
    else changes = parsedChanges.value;
  }
  if (changes) {
    const present = (presentRaw ?? '')
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (present.length > STORY_LIMITS.presentMax) {
      fail('present', `参数 present：最多 ${STORY_LIMITS.presentMax} 个。`);
    }
    const refs: Array<{ created: number }> = [];
    const characters = [
      ...new Set(
        changes.entities
          .filter((entity) => entity.kind === 'character')
          .flatMap((entity) => (entity.knownAs ? [entity.name, entity.knownAs] : [entity.name])),
      ),
    ];
    for (const token of present) {
      const matches = changes.entities.filter(
        (entity) => entity.kind === 'character' && (entity.name === token || entity.knownAs === token),
      );
      const match = matches[0];
      if (matches.length !== 1 || !match) {
        const hint = characters.length ? `本次新增的人物：${characters.join('、')}。` : '';
        fail('present', `参数 present：找不到「${token}」。${hint}在场的人物必须是 changes 里新增的人物。`);
        continue;
      }
      refs.push({ created: match.line });
    }
    changes.scene = { place: place ?? '', time: time ?? '', present: refs };
    for (const message of findLeaks({
      projection: null,
      changes,
      paragraphs,
      options: options.map((option) => option.text),
    })) {
      fail('leak', message);
    }
  }

  if (errors.length || !changes) return failed();
  const cast = [...changes.entities]
    .sort((left, right) => Number(right.protagonist) - Number(left.protagonist) || left.line - right.line)
    .map((entity) => ({
      kind: entity.kind,
      name: entity.name,
      knownAs: entity.knownAs,
      profile: entity.profile,
      protagonist: entity.protagonist,
    }));
  return {
    ok: true,
    value: {
      preview: {
        title: title ?? '',
        blurb: blurb ?? '',
        publicSetting: publicSetting ?? '',
        prose,
        options,
        scene: { place: place ?? '', time: time ?? '' },
        language: language ?? '',
        cast,
      },
      changes,
    },
  };
}
