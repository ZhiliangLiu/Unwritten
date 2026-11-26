import type { StoredOption } from '../store/meta.ts';
import type { ParseResult } from '../text/turn-text.ts';
import { normalizeProse, parseOptionLines, splitParagraphs } from '../text/turn-text.ts';

export const PROPOSE_TURN_TOOL_NAME = 'propose_turn';

export const TURN_LIMITS = {
  proseMax: 6_000,
  paragraphsMax: 20,
  optionsMin: 1,
  optionsMax: 6,
  optionTextMax: 100,
} as const;

export const PROPOSE_TURN_PARAMETERS = {
  type: 'object',
  properties: {
    prose: { type: 'string', description: '正文，段落之间空一行' },
    options: { type: 'string', description: '推荐行动，每行一个 JSON：{"text":"…"}' },
    changes: {
      type: 'string',
      description:
        '每行一个 JSON，这一回合没有变化时填空字符串。引用人物或事物写编号（如 @3）或名字；引用事实写编号（如 #12），或本次事实行自己起的 id（如 f1）。para 是出处在正文里的段号，从 1 起。可用的类型：\n' +
        '{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，不知道时留空","profile":"一句话档案","para":"1"}\n' +
        '{"type":"name","entity":"@3","name":"称呼","holder":"@1","para":"2"}\n' +
        '{"type":"event","subject":"@3","object":"@1","statement":"一句话","witnesses":"@1,@3","para":"2"}\n' +
        '{"type":"trait","subject":"@3","key":"特征名","statement":"一句话","para":"2"}\n' +
        '{"type":"relation","subject":"@1","object":"@3","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}\n' +
        '{"type":"promise","subject":"@3","object":"@1","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}\n' +
        '{"type":"knowledge","fact":"#12","holder":"@4","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"@3","para":"3"}\n' +
        '{"type":"scene","place":"地点","time":"故事时间","present":"@3,@4"}\n' +
        '引用本次新写的事实要给它起 "id"，例如 {"type":"event",…,"id":"f1"}；每行的 id 不能重复。\n' +
        '新人物和已有人物同名时：是同一个人，就用编号引用，不要新增；是另一个人，加上 "distinct":"true"，并在 profile 里写明区别。省略 witnesses 时，默认上一回合在场的人加主角；场景有变化时必须写明。不在场的人得知一件事，必须写 via。',
    },
    ending: { type: 'string', description: '填 "false"' },
  },
  required: ['prose', 'options', 'changes', 'ending'],
  additionalProperties: false,
} as const;

export interface ProposedTurnDraft {
  prose: string;
  paragraphs: string[];
  options: StoredOption[];
  changesRaw: string;
}

function stringArg(args: Record<string, unknown>, key: string, errors: string[]): string | null {
  const value = args[key];
  if (typeof value !== 'string') {
    errors.push(`参数 ${key} 必须是字符串`);
    return null;
  }
  return value;
}

export function parseProposeTurnArgs(args: Record<string, unknown>): ParseResult<ProposedTurnDraft> {
  const errors: string[] = [];
  const proseRaw = stringArg(args, 'prose', errors);
  const optionsRaw = stringArg(args, 'options', errors);
  const changesRaw = stringArg(args, 'changes', errors);
  const ending = stringArg(args, 'ending', errors);

  let prose = '';
  let paragraphs: string[] = [];
  if (proseRaw !== null) {
    prose = normalizeProse(proseRaw);
    paragraphs = splitParagraphs(prose);
    if (paragraphs.length < 1 || paragraphs.length > TURN_LIMITS.paragraphsMax) {
      errors.push(`参数 prose 的段落数必须在 1 到 ${TURN_LIMITS.paragraphsMax} 之间`);
    }
    if (Array.from(prose).length > TURN_LIMITS.proseMax) {
      errors.push(`参数 prose 不能超过 ${TURN_LIMITS.proseMax} 个字符`);
    }
  }

  let options: StoredOption[] = [];
  if (optionsRaw !== null) {
    const parsed = parseOptionLines(optionsRaw, {
      min: TURN_LIMITS.optionsMin,
      max: TURN_LIMITS.optionsMax,
      textMax: TURN_LIMITS.optionTextMax,
    });
    if (!parsed.ok) errors.push(...parsed.errors);
    else options = parsed.value;
  }

  if (ending !== null && ending.trim() !== 'false') {
    errors.push('这部作品没有结束条件，ending 只能填 "false"');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { prose, paragraphs, options, changesRaw: changesRaw ?? '' },
  };
}
