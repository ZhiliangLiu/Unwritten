import type { StoredOption, StoredScene } from '../store/meta.ts';
import type { ParseResult } from '../text/turn-text.ts';
import { normalizeProse, parseJsonLines, parseOptionLines } from '../text/turn-text.ts';

export const PROPOSE_TURN_TOOL_NAME = 'propose_turn';

export const TURN_LIMITS = {
  proseMax: 6_000,
  paragraphsMax: 20,
  optionsMin: 1,
  optionsMax: 6,
  optionTextMax: 100,
  placeMax: 100,
  timeMax: 100,
  presentMax: 20,
} as const;

export const PROPOSE_TURN_PARAMETERS = {
  type: 'object',
  properties: {
    prose: { type: 'string', description: '正文，段落之间空一行' },
    options: { type: 'string', description: '推荐行动，每行一个 JSON：{"text":"…"}' },
    changes: {
      type: 'string',
      description:
        '每行一个 JSON。只接受场景：{"type":"scene","place":"…","time":"…","present":"甲,乙"}。场景没有变化时填空字符串',
    },
    ending: { type: 'string', description: '填 "false"' },
  },
  required: ['prose', 'options', 'changes', 'ending'],
  additionalProperties: false,
} as const;

export interface ProposedTurn {
  prose: string;
  options: StoredOption[];
  scene: StoredScene;
}

function stringArg(args: Record<string, unknown>, key: string, errors: string[]): string | null {
  const value = args[key];
  if (typeof value !== 'string') {
    errors.push(`参数 ${key} 必须是字符串`);
    return null;
  }
  return value;
}

function sceneFrom(value: Record<string, unknown>, line: number, errors: string[]): StoredScene | null {
  if (value.type !== 'scene') {
    errors.push(`第 ${line} 行 changes：本作品只接受 scene 类型`);
    return null;
  }
  if (typeof value.place !== 'string' || !value.place.trim()) {
    errors.push(`第 ${line} 行 changes.place：必须是非空字符串`);
    return null;
  }
  if (typeof value.time !== 'string' || !value.time.trim()) {
    errors.push(`第 ${line} 行 changes.time：必须是非空字符串`);
    return null;
  }
  if (
    Array.from(value.place.trim()).length > TURN_LIMITS.placeMax ||
    Array.from(value.time.trim()).length > TURN_LIMITS.timeMax
  ) {
    errors.push(`第 ${line} 行 changes：地点或时间超过 ${TURN_LIMITS.placeMax} 个字符`);
    return null;
  }
  if (typeof value.present !== 'string') {
    errors.push(`第 ${line} 行 changes.present：必须是字符串`);
    return null;
  }
  const present = value.present
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (present.length > TURN_LIMITS.presentMax) {
    errors.push(`第 ${line} 行 changes.present：最多 ${TURN_LIMITS.presentMax} 人`);
    return null;
  }
  return { place: value.place.trim(), time: value.time.trim(), present };
}

export function parseProposeTurnArgs(
  args: Record<string, unknown>,
  parentScene: StoredScene,
): ParseResult<ProposedTurn> {
  const errors: string[] = [];
  const proseRaw = stringArg(args, 'prose', errors);
  const optionsRaw = stringArg(args, 'options', errors);
  const changesRaw = stringArg(args, 'changes', errors);
  const ending = stringArg(args, 'ending', errors);

  let prose = '';
  if (proseRaw !== null) {
    prose = normalizeProse(proseRaw);
    const paragraphs = prose.split(/\n{2,}/).filter((paragraph) => paragraph.length > 0);
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

  let scene = parentScene;
  if (changesRaw !== null && changesRaw.trim()) {
    const parsed = parseJsonLines(changesRaw, 'changes');
    if (!parsed.ok) errors.push(...parsed.errors);
    else {
      let sceneCount = 0;
      for (const { line, value } of parsed.value) {
        if ((value as Record<string, unknown>).type === 'scene') {
          sceneCount += 1;
          if (sceneCount > 1) errors.push('changes 里最多只能有一条 scene');
          const parsedScene = sceneFrom(value as Record<string, unknown>, line, errors);
          if (parsedScene) scene = parsedScene;
        } else {
          errors.push(`第 ${line} 行 changes：本作品只接受 scene 类型`);
        }
      }
    }
  }

  if (ending !== null && ending.trim() !== 'false') {
    errors.push('这部作品没有结束条件，ending 只能填 "false"');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { prose, options, scene } };
}
