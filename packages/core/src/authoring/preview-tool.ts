import type { Preview } from '@unwritten/contracts';
import { LanguageTagSchema } from '@unwritten/contracts';
import type { ParseResult } from '../text/turn-text.ts';
import { normalizeProse, parseOptionLines } from '../text/turn-text.ts';

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
  },
  required: ['title', 'blurb', 'public_setting', 'prose', 'options', 'place', 'time', 'language'],
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

export function parsePreviewArgs(args: Record<string, unknown>): ParseResult<Preview> {
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

  if (language !== null && !LanguageTagSchema.safeParse(language).success) {
    errors.push('参数 language 必须是合法的语言标签');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title: title ?? '',
      blurb: blurb ?? '',
      publicSetting: publicSetting ?? '',
      prose,
      options,
      scene: { place: place ?? '', time: time ?? '' },
      language: language ?? '',
    },
  };
}
