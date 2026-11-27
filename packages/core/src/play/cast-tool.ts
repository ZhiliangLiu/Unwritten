import type { ParseResult } from '../text/turn-text.ts';
import { parseJsonLines } from '../text/turn-text.ts';
import { STORY_LIMITS } from '../story/types.ts';

export const PROPOSE_CAST_TOOL_NAME = 'propose_cast';

export const PROPOSE_CAST_PARAMETERS = {
  type: 'object',
  properties: {
    cast: {
      type: 'string',
      description:
        '每行一个 JSON，每个人物位置一行：{"slot":"位置编号","name":"真名","known_as":"主角此刻的称呼，不知道时留空","profile":"一句话档案"}',
    },
  },
  required: ['cast'],
  additionalProperties: false,
} as const;

export interface CastMember {
  slotId: string;
  name: string;
  knownAs: string | null;
  profile: string;
}

export interface CastContext {
  slots: Array<{ index: string; slotId: string }>;
  takenNames: readonly string[];
}

function charLength(value: string): number {
  return Array.from(value).length;
}

export function parseCastArgs(args: Record<string, unknown>, ctx: CastContext): ParseResult<CastMember[]> {
  if (typeof args.cast !== 'string') return { ok: false, errors: ['参数 cast 必须是字符串'] };
  const parsed = parseJsonLines(args.cast, 'cast');
  if (!parsed.ok) return parsed;
  const errors: string[] = [];
  const members = new Map<string, CastMember>();
  const nameLines = new Map<string, number>();
  for (const { line, value } of parsed.value) {
    const row = value as Record<string, unknown>;
    const slot = typeof row.slot === 'string' ? row.slot.trim() : '';
    if (!slot) {
      errors.push(`第 ${line} 行 cast.slot：不能为空`);
      continue;
    }
    const slotDef = ctx.slots.find((candidate) => candidate.index === slot);
    if (!slotDef) {
      const available = ctx.slots.map((candidate) => candidate.index).join('、') || '无';
      errors.push(`第 ${line} 行 cast.slot：找不到人物位置 ${slot}。可用的位置：${available}。`);
      continue;
    }
    const earlier = members.get(slot);
    if (earlier) {
      errors.push(`第 ${line} 行 cast.slot：人物位置 ${slot} 已经登记过。`);
      continue;
    }
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) {
      errors.push(`第 ${line} 行 cast.name：不能为空`);
      continue;
    }
    if (charLength(name) > STORY_LIMITS.nameMax) {
      errors.push(`第 ${line} 行 cast.name：不能超过 ${STORY_LIMITS.nameMax} 个字符`);
      continue;
    }
    if (ctx.takenNames.includes(name)) {
      errors.push(`第 ${line} 行 cast.name：不能和作品里已有的人物同名（${name}）。`);
      continue;
    }
    const sameName = nameLines.get(name);
    if (sameName !== undefined) {
      errors.push(`第 ${line} 行 cast.name：和第 ${sameName} 行重复了同一个名字。`);
      continue;
    }
    const knownAsRaw = row.known_as;
    if (knownAsRaw !== undefined && knownAsRaw !== null && typeof knownAsRaw !== 'string') {
      errors.push(`第 ${line} 行 cast.known_as：必须是字符串`);
      continue;
    }
    const knownAs = typeof knownAsRaw === 'string' ? knownAsRaw.trim() : '';
    if (knownAs && charLength(knownAs) > STORY_LIMITS.nameMax) {
      errors.push(`第 ${line} 行 cast.known_as：不能超过 ${STORY_LIMITS.nameMax} 个字符`);
      continue;
    }
    if (row.profile !== undefined && row.profile !== null && typeof row.profile !== 'string') {
      errors.push(`第 ${line} 行 cast.profile：必须是字符串`);
      continue;
    }
    const profile = typeof row.profile === 'string' ? row.profile.trim() : '';
    if (charLength(profile) > STORY_LIMITS.profileMax) {
      errors.push(`第 ${line} 行 cast.profile：不能超过 ${STORY_LIMITS.profileMax} 个字符`);
      continue;
    }
    nameLines.set(name, line);
    members.set(slot, { slotId: slotDef.slotId, name, knownAs: knownAs || null, profile });
  }
  for (const slot of ctx.slots) {
    if (!members.has(slot.index)) errors.push(`cast：人物位置 ${slot.index} 没有对应的人物。`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: ctx.slots.map((slot) => members.get(slot.index)!) };
}
