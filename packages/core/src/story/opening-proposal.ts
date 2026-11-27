import { LIST_ITEM_STATUSES } from '@unwritten/contracts';
import type { HintMode, ListItemStatus, NeedsReview } from '@unwritten/contracts';
import { normalizeProse, parseJsonLines, parseOptionLines, splitParagraphs } from '../text/turn-text.ts';
import { placeholderToken, unknownPlaceholders, withoutPlaceholders } from '../text/placeholders.ts';
import { parseChanges } from './changes.ts';
import type { CodeBook } from './codebook.ts';
import { findLeaks } from './leak.ts';
import { stateDefByKey } from './projection.ts';
import { checkStateValue, mergeListItems } from './state.ts';
import type { ListEntry } from './state.ts';
import { listValueText } from './status.ts';
import {
  STORY_LIMITS,
  type EntityRef,
  type ProjStateDef,
  type StoryProjection,
  type ValidatedChanges,
} from './types.ts';

export type OpeningField =
  'prose' | 'options' | 'place' | 'time' | 'present' | 'changes' | 'state' | 'leak' | 'placeholder';

export interface OpeningSlot {
  index: string;
  slotId: string;
  name: string | null;
}

export interface OpeningProposalContext {
  projection: StoryProjection;
  codebook: CodeBook;
  hintMode: HintMode;
  fixedProse: string | null;
  fieldNames: readonly string[];
  forbiddenNames: readonly string[];
  placeholderPolicy: 'reject' | 'review';
  slots: OpeningSlot[];
  stateDefaults: Map<string, { value: string | null; visible: boolean }>;
}

export interface OpeningProposal {
  prose: string;
  paragraphs: string[];
  options: Array<{ text: string; hint: string | null }>;
  scene: { place: string; time: string; present: EntityRef[] };
  changes: ValidatedChanges;
  initialState: Array<{ stateDefId: string; value: string | null; visible: boolean }>;
  slotOf: Map<number, string>;
  needsReview: NeedsReview[];
}

export const OPENING_LIMITS = {
  proseMax: 6_000,
  paragraphsMax: 20,
  optionsMin: 1,
  optionsMax: 6,
  optionTextMax: 100,
  placeMax: 100,
  timeMax: 100,
} as const;

const STATE_ITEM_MAX = 100;

function charLength(value: string): number {
  return Array.from(value).length;
}

function splitRefs(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stateValueText(def: ProjStateDef, value: string): string {
  if (def.display === 'list') return listValueText(value);
  if (def.display === 'number' && def.config.unit) return `${value} ${def.config.unit}`;
  return value;
}

function positionText(where: 'prose' | 'option', index: number): string {
  return where === 'prose' ? `第 ${index} 段` : `第 ${index} 个推荐行动`;
}

export function parseOpeningProposal(
  args: Record<string, unknown>,
  ctx: OpeningProposalContext,
): { ok: true; value: OpeningProposal } | { ok: false; errors: string[]; fields: OpeningField[] } {
  const errors: string[] = [];
  const fields = new Set<OpeningField>();
  const fail = (field: OpeningField, message: string) => {
    fields.add(field);
    errors.push(message);
  };

  const proseSource = ctx.fixedProse ?? args.prose;
  let prose = '';
  let paragraphs: string[] = [];
  if (typeof proseSource !== 'string') {
    fail('prose', '参数 prose 必须是字符串');
  } else {
    prose = normalizeProse(proseSource);
    paragraphs = splitParagraphs(prose);
    if (paragraphs.length < 1 || paragraphs.length > OPENING_LIMITS.paragraphsMax) {
      fail('prose', `参数 prose 的段落数必须在 1 到 ${OPENING_LIMITS.paragraphsMax} 之间`);
    }
    if (charLength(prose) > OPENING_LIMITS.proseMax) {
      fail('prose', `参数 prose 不能超过 ${OPENING_LIMITS.proseMax} 个字符`);
    }
  }

  let options: Array<{ text: string; hint: string | null }> = [];
  if (typeof args.options !== 'string') {
    fail('options', '参数 options 必须是字符串');
  } else {
    const parsed = parseOptionLines(args.options, {
      min: OPENING_LIMITS.optionsMin,
      max: OPENING_LIMITS.optionsMax,
      textMax: OPENING_LIMITS.optionTextMax,
      allowHint: ctx.hintMode === 'known_consequences',
    });
    if (!parsed.ok) for (const message of parsed.errors) fail('options', message);
    else options = parsed.value;
  }

  const textField = (field: 'place' | 'time'): string | null => {
    const raw = args[field];
    if (typeof raw !== 'string') {
      fail(field, `参数 ${field} 必须是字符串`);
      return null;
    }
    const value = raw.trim();
    if (!value) fail(field, `参数 ${field} 不能为空`);
    else if (charLength(value) > OPENING_LIMITS[`${field}Max`]) {
      fail(field, `参数 ${field} 不能超过 ${OPENING_LIMITS[`${field}Max`]} 个字符`);
    }
    return value || null;
  };
  const place = textField('place');
  const time = textField('time');

  if (typeof args.changes !== 'string') fail('changes', '参数 changes 必须是字符串');
  if (typeof args.present !== 'string') fail('present', '参数 present 必须是字符串');
  if (typeof args.state !== 'string') fail('state', '参数 state 必须是字符串');
  if (errors.length) return { ok: false, errors, fields: [...fields] };

  const parsedChanges = parseChanges(args.changes as string, {
    mode: 'opening',
    projection: ctx.projection,
    codebook: ctx.codebook,
    paragraphCount: paragraphs.length,
    parentPresentIds: [],
    keyScenes: [],
  });
  if (!parsedChanges.ok) {
    return { ok: false, errors: parsedChanges.errors, fields: ['changes'] };
  }
  const changes = parsedChanges.value;

  const slotOf = new Map<number, string>();
  const slotLine = new Map<string, number>();
  for (const entity of changes.entities) {
    if (ctx.slots.length === 0) {
      if (entity.slot !== null) {
        fail('changes', `第 ${entity.line} 行 changes.slot：这部作品的主要人物是固定的，不写 slot。`);
      }
      continue;
    }
    if (entity.slot === null) continue;
    const slot = ctx.slots.find((candidate) => candidate.index === entity.slot);
    if (!slot) {
      fail('changes', `第 ${entity.line} 行 changes.slot：找不到人物位置 ${entity.slot}。`);
      continue;
    }
    if (entity.kind !== 'character') {
      fail('changes', `第 ${entity.line} 行 changes.slot：人物位置 ${slot.index} 必须登记一个人物。`);
      continue;
    }
    const earlier = slotLine.get(slot.index);
    if (earlier !== undefined) {
      fail('changes', `第 ${entity.line} 行 changes.slot：人物位置 ${slot.index} 已经在第 ${earlier} 行登记过。`);
      continue;
    }
    slotLine.set(slot.index, entity.line);
    if (slot.name !== null && entity.name !== slot.name) {
      fail('changes', `第 ${entity.line} 行 changes.name：人物位置 ${slot.index} 这一局的人物叫「${slot.name}」。`);
      continue;
    }
    slotOf.set(entity.line, slot.slotId);
  }
  for (const slot of ctx.slots) {
    if (!slotLine.has(slot.index)) {
      fail('changes', `changes：人物位置 ${slot.index} 没有对应的 new_entity（写 "slot":"${slot.index}"）。`);
    }
  }

  const present: EntityRef[] = [];
  const presentTokens = splitRefs(args.present as string);
  if (presentTokens.length > STORY_LIMITS.presentMax) {
    fail('present', `参数 present：最多 ${STORY_LIMITS.presentMax} 个。`);
  } else {
    for (const token of presentTokens) {
      const created = changes.entities.filter(
        (entity) => entity.kind === 'character' && (entity.name === token || entity.knownAs === token),
      );
      if (created.length === 1) {
        present.push({ created: created[0]!.line });
        continue;
      }
      if (created.length > 1) {
        fail('present', `参数 present：「${token}」对应多个人物。请改用别的称呼。`);
        continue;
      }
      const resolved = ctx.codebook.resolveEntity(token);
      if (!resolved.ok) {
        fail('present', `参数 present：找不到「${token}」。${resolved.error}`);
        continue;
      }
      if (ctx.projection.entities.get(resolved.id)?.kind !== 'character') {
        fail('present', `参数 present：${token} 不是人物。`);
        continue;
      }
      present.push({ existing: resolved.id });
    }
  }

  const stateDefs = [...ctx.projection.stateDefs.values()].sort((left, right) => left.originDepth - right.originDepth);
  const availableKeys = stateDefs.map((def) => def.key).join('、');
  const explicitValues = new Map<string, { value: string | null; visible: boolean | null }>();
  const explicitItems = new Map<string, ListEntry[]>();
  const stateLines = parseJsonLines(args.state as string, 'state');
  if (!stateLines.ok) {
    for (const message of stateLines.errors) fail('state', message);
  } else {
    for (const { line, value: rowValue } of stateLines.value) {
      const row = rowValue as Record<string, unknown>;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      const def = key ? stateDefByKey(ctx.projection, key) : null;
      if (!def) {
        fail('state', `第 ${line} 行 state：找不到栏目 ${key || '（缺失）'}。可用的栏目：${availableKeys || '无'}。`);
        continue;
      }
      const visibleRaw = row.visible;
      let visible: boolean | null = null;
      if (visibleRaw === true || visibleRaw === 'true') visible = true;
      else if (visibleRaw === false || visibleRaw === 'false') visible = false;
      else if (visibleRaw !== undefined && visibleRaw !== null && visibleRaw !== '') {
        fail('state', `第 ${line} 行 state.visible：只能是 "true" 或 "false"。`);
        continue;
      }
      if (visible === true && def.hidden) {
        fail('state', `第 ${line} 行 state：幕后栏目 ${def.key} 不能设为显示。`);
        continue;
      }
      if (def.display === 'list') {
        const item = typeof row.item === 'string' ? row.item.trim() : '';
        if (!item) {
          fail('state', `第 ${line} 行 state.item：不能为空。`);
          continue;
        }
        if (charLength(item) > STATE_ITEM_MAX) {
          fail('state', `第 ${line} 行 state.item：不能超过 ${STATE_ITEM_MAX} 个字符。`);
          continue;
        }
        const status = row.status;
        if (typeof status !== 'string' || !LIST_ITEM_STATUSES.includes(status as ListItemStatus)) {
          fail('state', `第 ${line} 行 state.status：条目状态只能是 open、done、failed、gone。`);
          continue;
        }
        const entries = explicitItems.get(def.id) ?? [];
        entries.push({ item, status: status as ListItemStatus });
        explicitItems.set(def.id, entries);
        continue;
      }
      if (row.item !== undefined) {
        fail('state', `第 ${line} 行 state：${def.key} 不是清单栏目，不写 item。`);
        continue;
      }
      let stateValue: string | null = null;
      const valueRaw = row.value;
      if (typeof valueRaw === 'string' || typeof valueRaw === 'number') {
        const text = String(valueRaw);
        stateValue = text === '' ? null : text;
      } else if (valueRaw !== undefined && valueRaw !== null && valueRaw !== '') {
        fail('state', `第 ${line} 行 state.value：必须是字符串`);
        continue;
      }
      if (stateValue !== null) {
        const checked = checkStateValue(def, stateValue);
        if (!checked.ok) {
          fail('state', `第 ${line} 行 state.value：${checked.error}`);
          continue;
        }
        stateValue = checked.value;
      }
      explicitValues.set(def.id, { value: stateValue, visible });
    }
  }

  const initialState: Array<{ stateDefId: string; value: string | null; visible: boolean }> = [];
  for (const def of stateDefs) {
    const explicit = explicitValues.get(def.id);
    const fallback = ctx.stateDefaults.get(def.id);
    const items = explicitItems.get(def.id);
    const value = items?.length
      ? mergeListItems(fallback?.value ?? null, items)
      : (explicit?.value ?? fallback?.value ?? null);
    if (value === null) continue;
    initialState.push({
      stateDefId: def.id,
      value,
      visible: explicit?.visible ?? fallback?.visible ?? !def.hidden,
    });
  }

  changes.scene = { place: place ?? '', time: time ?? '', present };
  for (const message of findLeaks({
    projection: ctx.projection,
    changes,
    paragraphs,
    options: options.map((option) => option.text),
    extras: [
      ...options.flatMap((option) => (option.hint ? [option.hint] : [])),
      ...initialState
        .filter((entry) => entry.visible && entry.value !== null)
        .map((entry) => {
          const def = stateDefs.find((candidate) => candidate.id === entry.stateDefId);
          return def ? stateValueText(def, entry.value as string) : '';
        }),
    ],
  })) {
    fail('leak', message);
  }

  const needsReview: NeedsReview[] = [];
  const review = (where: 'prose' | 'option', index: number, text: string) => {
    const position = positionText(where, index);
    const stripped = withoutPlaceholders(text);
    const unknown = unknownPlaceholders(text, ctx.fieldNames);
    const hardcoded = ctx.forbiddenNames.filter((name) => name.length > 0 && stripped.includes(name));
    if (ctx.placeholderPolicy === 'reject') {
      for (const name of unknown) {
        fail(
          'placeholder',
          `${position}：${placeholderToken(name)} 不是作者留的填写项。可用的：${ctx.fieldNames.length ? ctx.fieldNames.join('、') : '无'}。`,
        );
      }
      for (const name of hardcoded) {
        fail(
          'placeholder',
          `${position}：主角的名字留给玩家填写，这里写 ${placeholderToken(ctx.fieldNames[0] ?? '')}，不要写「${name}」。`,
        );
      }
      return;
    }
    for (const _name of unknown) {
      needsReview.push({ where, index, text, reason: 'unknown_placeholder' });
    }
    for (const _name of hardcoded) {
      needsReview.push({ where, index, text, reason: 'hardcoded_name' });
    }
  };

  paragraphs.forEach((paragraph, index) => review('prose', index + 1, paragraph));
  options.forEach((option, index) => {
    review('option', index + 1, option.text);
    if (option.hint) review('option', index + 1, option.hint);
  });

  if (ctx.placeholderPolicy === 'review' && ctx.slots.length > 0) {
    const slotNames = changes.entities.filter((entity) => slotOf.has(entity.line)).map((entity) => entity.name);
    paragraphs.forEach((paragraph, index) => {
      const stripped = withoutPlaceholders(paragraph);
      if (slotNames.some((name) => stripped.includes(name))) {
        needsReview.push({ where: 'prose', index: index + 1, text: paragraph, reason: 'hardcoded_name' });
      }
    });
  }

  if (errors.length) return { ok: false, errors, fields: [...fields] };
  return {
    ok: true,
    value: {
      prose,
      paragraphs,
      options,
      scene: { place: place!, time: time!, present },
      changes,
      initialState,
      slotOf,
      needsReview,
    },
  };
}
