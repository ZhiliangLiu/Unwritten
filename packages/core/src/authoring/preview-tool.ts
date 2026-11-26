import type { Preview } from '@unwritten/contracts';
import { LanguageTagSchema } from '@unwritten/contracts';
import type { ParseResult } from '../text/turn-text.ts';
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
        '每行一个 JSON。引用人物或事物写名字；引用事实写本次第几行（如 L2）。para 是出处在正文里的段号，从 1 起。必须恰好有一行主角：\n' +
        '{"type":"new_entity","kind":"character","name":"主角的名字","known_as":"","profile":"一句话档案","para":"1","protagonist":"true"}\n' +
        '其余可用的类型：\n' +
        '{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，不知道时留空","profile":"一句话档案","para":"1"}\n' +
        '{"type":"name","entity":"名字","name":"称呼","holder":"名字","para":"2"}\n' +
        '{"type":"event","subject":"名字","object":"名字","statement":"一句话","witnesses":"名字,名字","para":"2"}\n' +
        '{"type":"trait","subject":"名字","key":"特征名","statement":"一句话","para":"2"}\n' +
        '{"type":"relation","subject":"名字","object":"名字","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}\n' +
        '{"type":"promise","subject":"名字","object":"名字","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}\n' +
        '{"type":"knowledge","fact":"L2","holder":"名字","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"名字","para":"3"}\n' +
        '开场里的 event 必须写明 witnesses。',
    },
  },
  required: ['title', 'blurb', 'public_setting', 'prose', 'options', 'place', 'time', 'language', 'present', 'changes'],
  additionalProperties: false,
} as const;

function stringArg(args: Record<string, unknown>, key: string, errors: string[]): string | null {
  const value = args[key];
  if (typeof value !== 'string') {
    errors.push(`参数 ${key} 必须是字符串`);
    return null;
  }
  return value;
}

export interface PreviewParseResult {
  preview: Preview;
  changes: ValidatedChanges;
}

export function parsePreviewArgs(args: Record<string, unknown>): ParseResult<PreviewParseResult> {
  const errors: string[] = [];
  const title = stringArg(args, 'title', errors)?.trim() ?? null;
  const blurb = stringArg(args, 'blurb', errors)?.trim() ?? null;
  const publicSetting = stringArg(args, 'public_setting', errors)?.trim() ?? null;
  const proseRaw = stringArg(args, 'prose', errors);
  const optionsRaw = stringArg(args, 'options', errors);
  const place = stringArg(args, 'place', errors)?.trim() ?? null;
  const time = stringArg(args, 'time', errors)?.trim() ?? null;
  const language = stringArg(args, 'language', errors);

  const required: Array<[string, string | null, number]> = [
    ['title', title, PREVIEW_LIMITS.titleMax],
    ['blurb', blurb, PREVIEW_LIMITS.blurbMax],
    ['public_setting', publicSetting, PREVIEW_LIMITS.publicSettingMax],
    ['place', place, PREVIEW_LIMITS.placeMax],
    ['time', time, PREVIEW_LIMITS.timeMax],
  ];
  for (const [name, value, max] of required) {
    if (value === null) continue;
    if (!value) errors.push(`参数 ${name} 不能为空`);
    else if (Array.from(value).length > max) errors.push(`参数 ${name} 不能超过 ${max} 个字符`);
  }

  let prose = '';
  if (proseRaw !== null) {
    prose = normalizeProse(proseRaw);
    const paragraphs = prose.split(/\n{2,}/).filter((paragraph) => paragraph.length > 0);
    if (paragraphs.length < 1 || paragraphs.length > PREVIEW_LIMITS.paragraphsMax) {
      errors.push(`参数 prose 的段落数必须在 1 到 ${PREVIEW_LIMITS.paragraphsMax} 之间`);
    }
    if (Array.from(prose).length > PREVIEW_LIMITS.proseMax) {
      errors.push(`参数 prose 不能超过 ${PREVIEW_LIMITS.proseMax} 个字符`);
    }
  }

  let options: Preview['options'] = [];
  if (optionsRaw !== null) {
    const parsed = parseOptionLines(optionsRaw, {
      min: PREVIEW_LIMITS.optionsMin,
      max: PREVIEW_LIMITS.optionsMax,
      textMax: PREVIEW_LIMITS.optionTextMax,
    });
    if (!parsed.ok) errors.push(...parsed.errors);
    else options = parsed.value;
  }

  const changesRaw = stringArg(args, 'changes', errors);
  const presentRaw = stringArg(args, 'present', errors);

  if (language !== null && !LanguageTagSchema.safeParse(language).success) {
    errors.push('参数 language 必须是合法的语言标签');
  }

  if (errors.length) return { ok: false, errors };
  const paragraphs = splitParagraphs(prose);
  let changes: ValidatedChanges | null = null;
  if (changesRaw !== null && !changesRaw.trim()) {
    errors.push('参数 changes 不能为空');
  } else if (changesRaw !== null) {
    const parsedChanges = parseChanges(changesRaw, {
      mode: 'opening',
      projection: null,
      codebook: null,
      paragraphCount: paragraphs.length,
      parentPresentIds: [],
    });
    if (!parsedChanges.ok) errors.push(...parsedChanges.errors);
    else changes = parsedChanges.value;
  }
  if (changes) {
    const present = (presentRaw ?? '')
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (present.length > STORY_LIMITS.presentMax) {
      errors.push(`参数 present：最多 ${STORY_LIMITS.presentMax} 个。`);
    }
    const refs: Array<{ created: number }> = [];
    for (const token of present) {
      const matches = changes.entities.filter(
        (entity) => entity.kind === 'character' && (entity.name === token || entity.knownAs === token),
      );
      const match = matches[0];
      if (matches.length !== 1 || !match) {
        errors.push(`参数 present：找不到「${token}」，在场的人物必须是 changes 里新增的人物。`);
        continue;
      }
      refs.push({ created: match.line });
    }
    changes.scene = { place: place ?? '', time: time ?? '', present: refs };
    errors.push(
      ...findLeaks({
        projection: null,
        changes,
        paragraphs,
        options: options.map((option) => option.text),
      }),
    );
  }

  if (errors.length || !changes) return { ok: false, errors };
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
