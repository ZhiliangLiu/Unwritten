import type { HintMode, OptionView } from '@unwritten/contracts';
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
    options: {
      type: 'string',
      description: '推荐行动，每行一个 JSON：{"text":"…"}。作品要求提醒时可以写 {"text":"…","hint":"…"}',
    },
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
        '{"type":"state","key":"栏目 key","value":"新值","visible":"true|false","closed":"true|false"}\n' +
        '{"type":"state_item","key":"清单栏目 key","item":"条目原文","status":"open|done|failed|gone"}\n' +
        '{"type":"new_state","key":"新栏目 key","label":"显示名","display":"number|stage|list|text","hidden":"false","min":"0","max":"10","unit":"米","stages":"阶段一|阶段二"}\n' +
        '{"type":"secret","subject":"@3","title":"无剧透的标题","statement":"真相","reveal":"揭晓条件","knowers":"@3","para":"2"}\n' +
        '{"type":"scene_hit","scene":"S1","para":"3"}\n' +
        '引用本次新写的事实要给它起 "id"，例如 {"type":"event",…,"id":"f1"}；每行的 id 不能重复。\n' +
        '新人物和已有人物同名时：是同一个人，就用编号引用，不要新增；是另一个人，加上 "distinct":"true"，并在 profile 里写明区别。省略 witnesses 时，默认上一回合在场的人加主角；场景有变化时必须写明。不在场的人得知一件事，必须写 via。清单栏目不写 value，用 state_item 改条目；state 只在改值、改显示或了结时写。',
    },
    ending: { type: 'string', description: '作品有结束条件、而且这一回合满足了它时填 "true"，否则填 "false"' },
  },
  required: ['prose', 'options', 'changes', 'ending'],
  additionalProperties: false,
} as const;

export interface ProposedTurnDraft {
  prose: string;
  paragraphs: string[];
  options: OptionView[];
  changesRaw: string;
  ending: boolean;
}

function stringArg(args: Record<string, unknown>, key: string, errors: string[]): string | null {
  const value = args[key];
  if (typeof value !== 'string') {
    errors.push(`参数 ${key} 必须是字符串`);
    return null;
  }
  return value;
}

export function parseProposeTurnArgs(
  args: Record<string, unknown>,
  ctx: { hintMode: HintMode; endingAllowed: boolean },
): ParseResult<ProposedTurnDraft> {
  const errors: string[] = [];
  const proseRaw = stringArg(args, 'prose', errors);
  const optionsRaw = stringArg(args, 'options', errors);
  const changesRaw = stringArg(args, 'changes', errors);
  const endingRaw = stringArg(args, 'ending', errors);

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

  let options: OptionView[] = [];
  if (optionsRaw !== null) {
    const parsed = parseOptionLines(optionsRaw, {
      min: TURN_LIMITS.optionsMin,
      max: TURN_LIMITS.optionsMax,
      textMax: TURN_LIMITS.optionTextMax,
      allowHint: ctx.hintMode === 'known_consequences',
    });
    if (!parsed.ok) errors.push(...parsed.errors);
    else options = parsed.value;
  }

  let ending = false;
  if (endingRaw === 'true') {
    if (ctx.endingAllowed) ending = true;
    else errors.push('这部作品没有结束条件，ending 只能填 "false"。');
  } else if (endingRaw !== null && endingRaw !== 'false') {
    errors.push('ending 只能填 "true" 或 "false"。');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { prose, paragraphs, options, changesRaw: changesRaw ?? '', ending },
  };
}
