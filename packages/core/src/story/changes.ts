import type { EntityKind, StateConfig, StateDisplay } from '@unwritten/contracts';
import { LIST_ITEM_STATUSES, STATE_DISPLAYS } from '@unwritten/contracts';
import type { ParseResult } from '../text/turn-text.ts';
import { parseJsonLines } from '../text/turn-text.ts';
import type { CodeBook, Resolved } from './codebook.ts';
import { sceneHitIds, stateDefByKey } from './projection.ts';
import { checkStateConfig, checkStateValue } from './state.ts';
import type { StoryProjection } from './types.ts';
import {
  EMPTY_CHANGES,
  RELATION_STAGES,
  PROMISE_STATUSES,
  STORY_LIMITS,
  type EntityRef,
  type FactChange,
  type FactData,
  type FactRef,
  type NameChange,
  type NewEntityChange,
  type NewStateChange,
  type SceneChange,
  type SceneHitChange,
  type SecretChange,
  type StateChange,
  type StateDefRef,
  type StateItemChange,
  type ValidatedChanges,
} from './types.ts';

export interface ChangesContext {
  mode: 'opening' | 'turn';
  projection: StoryProjection | null;
  codebook: CodeBook | null;
  paragraphCount: number;
  parentPresentIds: string[];
  keyScenes?: Array<{ code: string; id: string; once: boolean }>;
}

export const TURN_CHANGE_TYPES = [
  'new_entity',
  'name',
  'event',
  'trait',
  'relation',
  'promise',
  'knowledge',
  'scene',
  'state',
  'state_item',
  'new_state',
  'secret',
  'scene_hit',
] as const;
export const OPENING_CHANGE_TYPES = [
  'new_entity',
  'name',
  'event',
  'trait',
  'relation',
  'promise',
  'knowledge',
] as const;
const FACT_LINE_TYPES: readonly string[] = ['event', 'trait', 'relation', 'promise'];

const STATE_KEY_PATTERN = /^[\p{L}\p{N}_]{1,40}$/u;
const NEW_STATES_MAX = 3;
const STATE_LABEL_MAX = 20;
const STATE_ITEM_MAX = 100;
const SECRET_TITLE_MAX = 40;
const SECRET_REVEAL_MAX = 1_000;

type ChangeLine = { line: number; value: Record<string, unknown> };
type NewEntity = NewEntityChange & { distinct: boolean };

function charLength(value: string): number {
  return Array.from(value).length;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  line: number,
  errors: string[],
  options?: { required?: boolean; max?: number },
): string | null {
  const raw = value[key];
  if (raw === undefined || raw === null) {
    if (options?.required) errors.push(`第 ${line} 行 changes.${key}：不能为空`);
    return null;
  }
  if (typeof raw !== 'string') {
    errors.push(`第 ${line} 行 changes.${key}：必须是字符串`);
    return null;
  }
  const trimmed = raw.trim();
  if (options?.required && !trimmed) {
    errors.push(`第 ${line} 行 changes.${key}：不能为空`);
    return null;
  }
  if (options?.max !== undefined && charLength(trimmed) > options.max) {
    errors.push(`第 ${line} 行 changes.${key}：不能超过 ${options.max} 个字符`);
    return null;
  }
  return trimmed;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === 'true' || value[key] === true;
}

function optionalBooleanField(
  value: Record<string, unknown>,
  key: string,
  line: number,
  errors: string[],
): boolean | null {
  const raw = value[key];
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  errors.push(`第 ${line} 行 changes.${key}：只能是 "true" 或 "false"。`);
  return null;
}

function configNumberField(value: Record<string, unknown>, key: string, line: number, errors: string[]): number | null {
  const raw = value[key];
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    errors.push(`第 ${line} 行 changes.${key}：必须是数字。`);
    return null;
  }
  return parsed;
}

function paraField(
  value: Record<string, unknown>,
  line: number,
  paragraphCount: number,
  errors: string[],
): number | null {
  const raw = value.para;
  const parsed = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > paragraphCount) {
    errors.push(`第 ${line} 行 changes.para：段号必须在 1 到 ${paragraphCount} 之间。`);
    return null;
  }
  return parsed;
}

function entityKey(ref: EntityRef): string {
  return 'existing' in ref ? ref.existing : `created:${ref.created}`;
}

function splitRefs(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseChanges(raw: string, ctx: ChangesContext): ParseResult<ValidatedChanges> {
  if (!raw.trim()) return { ok: true, value: EMPTY_CHANGES };
  const parsed = parseJsonLines(raw, 'changes');
  if (!parsed.ok) return parsed;
  if (parsed.value.length > STORY_LIMITS.changesLinesMax) {
    return { ok: false, errors: [`changes：最多 ${STORY_LIMITS.changesLinesMax} 行。`] };
  }
  const errors: string[] = [];
  const allowed: readonly string[] = ctx.mode === 'opening' ? OPENING_CHANGE_TYPES : TURN_CHANGE_TYPES;
  const lines: ChangeLine[] = [];
  for (const item of parsed.value) {
    const type = (item.value as Record<string, unknown>).type;
    if (typeof type !== 'string' || !allowed.includes(type)) {
      errors.push(
        `第 ${item.line} 行 changes：不支持的类型 ${typeof type === 'string' ? type : '（缺失）'}。可用的类型：${allowed.join('、')}。`,
      );
      continue;
    }
    lines.push({ line: item.line, value: item.value as Record<string, unknown> });
  }

  const newEntities = new Map<number, NewEntity>();
  const newNameLines = new Map<string, number>();
  for (const item of lines) {
    if (item.value.type !== 'new_entity') continue;
    const kindRaw = item.value.kind;
    const kind =
      typeof kindRaw === 'string' && ['character', 'place', 'item', 'group', 'other'].includes(kindRaw)
        ? (kindRaw as EntityKind)
        : null;
    if (!kind) {
      errors.push(`第 ${item.line} 行 changes.kind：必须是 character、place、item、group、other 之一。`);
      continue;
    }
    const name = stringField(item.value, 'name', item.line, errors, { required: true, max: STORY_LIMITS.nameMax });
    const knownAsRaw = item.value.known_as;
    const knownAs =
      knownAsRaw === undefined || knownAsRaw === null || knownAsRaw === ''
        ? null
        : stringField(item.value, 'known_as', item.line, errors, { max: STORY_LIMITS.nameMax });
    const profile = stringField(item.value, 'profile', item.line, errors, { max: STORY_LIMITS.profileMax }) ?? '';
    const para = paraField(item.value, item.line, ctx.paragraphCount, errors);
    const protagonist = booleanField(item.value, 'protagonist');
    let slot: string | null = null;
    const slotRaw = item.value.slot;
    if (slotRaw !== undefined && slotRaw !== null && slotRaw !== '') {
      if (ctx.mode === 'turn') {
        errors.push(`第 ${item.line} 行 changes：续写时不能写人物位置。`);
      } else {
        slot = stringField(item.value, 'slot', item.line, errors, { max: STORY_LIMITS.keyMax });
      }
    }
    if (ctx.mode === 'turn' && 'protagonist' in item.value) {
      errors.push(`第 ${item.line} 行 changes：续写时不能新增主角。`);
    }
    if (ctx.mode === 'opening' && ctx.projection && protagonist) {
      errors.push(`第 ${item.line} 行 changes：主角已经在作品设定里，不要再新增。`);
    }
    if (protagonist && kind !== 'character') {
      errors.push(`第 ${item.line} 行 changes：主角必须是 character。`);
    }
    if (!name || para === null) continue;
    newEntities.set(item.line, {
      line: item.line,
      kind,
      name,
      knownAs: knownAs || null,
      profile,
      para,
      protagonist,
      slot,
      distinct: booleanField(item.value, 'distinct'),
    });
    if (!newNameLines.has(name)) newNameLines.set(name, item.line);
    if (knownAs && !newNameLines.has(knownAs)) newNameLines.set(knownAs, item.line);
  }

  if (ctx.mode === 'opening' && !ctx.projection) {
    const protagonists = [...newEntities.values()].filter((entity) => entity.protagonist);
    if (protagonists.length !== 1) {
      errors.push('changes：开场必须有一行 "protagonist":"true" 的人物。');
    }
  }

  const entityByCreated = new Map<number, NewEntity>();
  for (const entity of newEntities.values()) {
    const duplicate = [...newEntities.values()].find(
      (candidate) => candidate !== entity && candidate.kind === entity.kind && candidate.name === entity.name,
    );
    if (duplicate) {
      errors.push(`第 ${entity.line} 行 changes：和第 ${duplicate.line} 行重复新增了同一个名字。`);
    }
    entityByCreated.set(entity.line, entity);
    const projectionEntity =
      ctx.projection && ctx.codebook
        ? [...ctx.projection.entities.values()].find((candidate) => {
            if (candidate.kind !== entity.kind) return false;
            if (candidate.name === entity.name) return true;
            return ctx.projection!.names.some((name) => name.entityId === candidate.id && name.name === entity.name);
          })
        : undefined;
    if (projectionEntity && ctx.codebook) {
      if (!entity.distinct || !entity.profile) {
        errors.push(
          `第 ${entity.line} 行 changes：与 ${ctx.codebook.entityCode(projectionEntity.id)}（${projectionEntity.name}）同名。如果就是此人，删掉这一行，改用 ${ctx.codebook.entityCode(projectionEntity.id)} 引用；如果是另一个人，加上 "distinct":"true"，并在 profile 里写明区别。`,
        );
      }
    }
  }

  const newStatesByLine = new Map<number, NewStateChange>();
  const newStateLineByKey = new Map<string, number>();
  const newStateLines = lines.filter((item) => item.value.type === 'new_state');
  if (newStateLines.length > NEW_STATES_MAX) {
    errors.push(`changes：每回合最多新增 ${NEW_STATES_MAX} 个栏目。`);
  }
  for (const item of newStateLines.slice(0, NEW_STATES_MAX)) {
    const key = stringField(item.value, 'key', item.line, errors, { required: true, max: STORY_LIMITS.keyMax });
    if (key) {
      if (!STATE_KEY_PATTERN.test(key)) {
        errors.push(`第 ${item.line} 行 changes.key：栏目 key 只能用 1 到 40 个文字、数字或下划线。`);
      } else if (newStateLineByKey.has(key) || (ctx.projection && stateDefByKey(ctx.projection, key))) {
        errors.push(`第 ${item.line} 行 changes.key：栏目 ${key} 已经存在。`);
      } else {
        newStateLineByKey.set(key, item.line);
      }
    }
    const label = stringField(item.value, 'label', item.line, errors, {
      required: true,
      max: STATE_LABEL_MAX,
    });
    const displayRaw = item.value.display;
    const display =
      typeof displayRaw === 'string' && STATE_DISPLAYS.includes(displayRaw as StateDisplay)
        ? (displayRaw as StateDisplay)
        : null;
    if (!display) {
      errors.push(`第 ${item.line} 行 changes.display：显示方式只能是 number、stage、list、text。`);
    }
    const min = configNumberField(item.value, 'min', item.line, errors);
    const max = configNumberField(item.value, 'max', item.line, errors);
    const unitRaw = stringField(item.value, 'unit', item.line, errors);
    const unit = unitRaw ? unitRaw : null;
    const stagesRaw = item.value.stages;
    const stages =
      typeof stagesRaw === 'string'
        ? stagesRaw
            .split('|')
            .map((stage) => stage.trim())
            .filter(Boolean)
        : [];
    const hidden = optionalBooleanField(item.value, 'hidden', item.line, errors) ?? false;
    if (!display) continue;
    const config = { min, max, unit, stages };
    const checked = checkStateConfig(display, config);
    if (!checked.ok) {
      errors.push(`第 ${item.line} 行 changes：${checked.error}`);
      continue;
    }
    if (!key || !label) continue;
    if (!newStateLineByKey.has(key)) continue;
    newStatesByLine.set(item.line, { line: item.line, key, label, display, config: checked.value, hidden });
  }

  const availableStateKeys = (): string[] => {
    const keys = new Set<string>();
    if (ctx.projection) for (const def of ctx.projection.stateDefs.values()) keys.add(def.key);
    for (const key of newStateLineByKey.keys()) keys.add(key);
    return [...keys];
  };

  const resolveStateDef = (
    line: number,
    raw: unknown,
  ): { ref: StateDefRef; key: string; display: StateDisplay; config: StateConfig; hidden: boolean } | null => {
    if (typeof raw !== 'string' || !raw.trim()) {
      errors.push(`第 ${line} 行 changes.key：不能为空`);
      return null;
    }
    const token = raw.trim();
    const createdLine = newStateLineByKey.get(token);
    if (createdLine !== undefined) {
      const def = newStatesByLine.get(createdLine);
      if (def) {
        return {
          ref: { created: createdLine },
          key: def.key,
          display: def.display,
          config: def.config,
          hidden: def.hidden,
        };
      }
    }
    const def = ctx.projection ? stateDefByKey(ctx.projection, token) : null;
    if (!def) {
      const keys = availableStateKeys();
      errors.push(
        `第 ${line} 行 changes.key：找不到栏目 ${token}。可用的栏目：${keys.length ? keys.join('、') : '无'}。`,
      );
      return null;
    }
    return { ref: { existing: def.id }, key: def.key, display: def.display, config: def.config, hidden: def.hidden };
  };

  const stateDefRefKey = (ref: StateDefRef): string => ('existing' in ref ? ref.existing : `created:${ref.created}`);

  const factLines = lines.filter((item) => FACT_LINE_TYPES.includes(String(item.value.type)));
  const factLineIds = new Map<string, number>();
  const misplacedIds = new Map<string, { line: number; type: string }>();
  for (const item of lines) {
    const rawId = item.value.id;
    if (!FACT_LINE_TYPES.includes(String(item.value.type))) {
      if (typeof rawId === 'string' || typeof rawId === 'number') {
        const id = String(rawId).trim();
        if (id) misplacedIds.set(id, { line: item.line, type: String(item.value.type) });
      }
      continue;
    }
    const id =
      typeof rawId === 'number'
        ? String(rawId)
        : stringField(item.value, 'id', item.line, errors, { max: STORY_LIMITS.keyMax });
    if (!id) continue;
    if (id.startsWith('#') || id.startsWith('@')) {
      errors.push(`第 ${item.line} 行 changes.id：「${id}」不能以 # 或 @ 开头，那是 core 发的编号。`);
      continue;
    }
    const same = factLineIds.get(id);
    if (same !== undefined) {
      errors.push(`第 ${item.line} 行 changes.id：和第 ${same} 行用了同一个 id，每行事实的 id 不能重复。`);
      continue;
    }
    factLineIds.set(id, item.line);
  }

  const factIdHint = (token: string): string => {
    const misplaced = misplacedIds.get(token);
    if (misplaced) {
      return `「${token}」写在第 ${misplaced.line} 行的 ${misplaced.type} 上；id 只能起在 ${FACT_LINE_TYPES.join('、')} 行。`;
    }
    if (factLineIds.size > 0) return `本次可用的事实 id：${[...factLineIds.keys()].join('、')}。`;
    if (factLines.length > 0) return '本次的事实行都还没起 id：给要引用的那行加上 "id":"f1"，再用 "fact":"f1" 引用。';
    return '本次没有事实行可引用：先写 event、trait、relation 或 promise，再用 "id" 让 knowledge 指向它。';
  };

  const resolveFact = (line: number, raw: unknown): FactRef | null => {
    if (typeof raw !== 'string' || !raw.trim()) {
      errors.push(`第 ${line} 行 changes.fact：不能为空。`);
      return null;
    }
    const token = raw.trim();
    const created = factLineIds.get(token);
    if (created !== undefined) return { line: created };
    if (ctx.codebook) {
      const resolved = ctx.codebook.resolveFact(token);
      if (resolved.ok) return { existing: resolved.id };
      errors.push(`第 ${line} 行 changes.fact：${resolved.error}${factIdHint(token)}`);
      return null;
    }
    errors.push(`第 ${line} 行 changes.fact：找不到「${token}」。${factIdHint(token)}`);
    return null;
  };

  const resolveEntity = (field: unknown, line: number, label: string): EntityRef | null => {
    if (typeof field !== 'string' || !field.trim()) {
      errors.push(`第 ${line} 行 changes.${label}：不能为空`);
      return null;
    }
    const token = field.trim();
    const created = newNameLines.get(token);
    if (created !== undefined) return { created };
    if (!ctx.codebook) {
      const names = [
        ...new Set(
          [...newEntities.values()].flatMap((entity) =>
            entity.knownAs ? [entity.name, entity.knownAs] : [entity.name],
          ),
        ),
      ];
      const hint = names.length
        ? `本次新增的人物和事物：${names.join('、')}。改用其中已有的名字，或为它新增一行。`
        : '';
      errors.push(`第 ${line} 行 changes.${label}：找不到「${token}」。${hint}`);
      return null;
    }
    const resolved: Resolved = ctx.codebook.resolveEntity(token);
    if (!resolved.ok) {
      errors.push(`第 ${line} 行 changes.${label}：${resolved.error}`);
      return null;
    }
    return { existing: resolved.id };
  };

  const entityKind = (ref: EntityRef): EntityKind | null => {
    if ('created' in ref) return entityByCreated.get(ref.created)?.kind ?? null;
    return ctx.projection?.entities.get(ref.existing)?.kind ?? null;
  };

  let scene: SceneChange | null = null;
  let sceneLine: ChangeLine | null = null;
  for (const item of lines) {
    if (item.value.type !== 'scene') continue;
    if (sceneLine) {
      errors.push('changes：最多只能有一条 scene。');
      continue;
    }
    sceneLine = item;
  }
  if (sceneLine) {
    const place = stringField(sceneLine.value, 'place', sceneLine.line, errors, {
      required: true,
      max: STORY_LIMITS.placeMax,
    });
    const time = stringField(sceneLine.value, 'time', sceneLine.line, errors, {
      required: true,
      max: STORY_LIMITS.timeMax,
    });
    const present: EntityRef[] = [];
    const tokens = splitRefs(sceneLine.value.present);
    if (tokens.length > STORY_LIMITS.presentMax) {
      errors.push(`第 ${sceneLine.line} 行 changes.present：最多 ${STORY_LIMITS.presentMax} 个。`);
    } else {
      for (const token of tokens) {
        const ref = resolveEntity(token, sceneLine.line, 'present');
        if (!ref) continue;
        if (entityKind(ref) !== 'character') {
          errors.push(`第 ${sceneLine.line} 行 changes.present：${token} 不是人物。`);
          continue;
        }
        present.push(ref);
      }
    }
    if (place && time) scene = { place, time, present };
  }

  const protagonistRef: EntityRef | null =
    ctx.mode === 'opening'
      ? ctx.projection
        ? { existing: ctx.projection.protagonistId }
        : (() => {
            const protagonist = [...newEntities.values()].find((entity) => entity.protagonist);
            return protagonist ? { created: protagonist.line } : null;
          })()
      : ctx.projection
        ? { existing: ctx.projection.protagonistId }
        : null;
  const presentSet = new Set<string>();
  for (const id of ctx.parentPresentIds) presentSet.add(id);
  for (const ref of scene?.present ?? []) presentSet.add(entityKey(ref));
  for (const entity of newEntities.values()) if (entity.kind === 'character') presentSet.add(`created:${entity.line}`);
  if (protagonistRef) presentSet.add(entityKey(protagonistRef));

  const facts: FactChange[] = [];
  const names: NameChange[] = [];
  const knowledge: ValidatedChanges['knowledge'] = [];
  const states: StateChange[] = [];
  const stateItems: StateItemChange[] = [];
  const secrets: SecretChange[] = [];
  const sceneHits: SceneHitChange[] = [];
  const stateLineByDef = new Map<string, number>();
  const sceneLineById = new Map<string, number>();

  for (const item of lines) {
    const type = item.value.type;
    if (type === 'new_entity' || type === 'scene' || type === 'new_state') continue;
    const line = item.line;
    if (type === 'name') {
      const entity = resolveEntity(item.value.entity, line, 'entity');
      const holder = resolveEntity(item.value.holder, line, 'holder');
      const name = stringField(item.value, 'name', line, errors, { required: true, max: STORY_LIMITS.nameMax });
      const para = paraField(item.value, line, ctx.paragraphCount, errors);
      if (!entity || !holder || !name || para === null) continue;
      if (!presentSet.has(entityKey(holder))) {
        errors.push(
          `第 ${line} 行 changes.holder：${typeof item.value.holder === 'string' ? item.value.holder : '对象'} 本回合不在场。`,
        );
        continue;
      }
      names.push({ line, entity, name, holder, para });
      continue;
    }
    if (type === 'event' || type === 'trait' || type === 'relation' || type === 'promise') {
      const subject = resolveEntity(item.value.subject, line, 'subject');
      const objectRequired = type === 'relation' || type === 'promise';
      const object =
        item.value.object === undefined && !objectRequired ? null : resolveEntity(item.value.object, line, 'object');
      const key =
        type === 'event'
          ? null
          : stringField(item.value, 'key', line, errors, { required: true, max: STORY_LIMITS.keyMax });
      const statement = stringField(item.value, 'statement', line, errors, {
        required: true,
        max: STORY_LIMITS.statementMax,
      });
      const para = paraField(item.value, line, ctx.paragraphCount, errors);
      let witnesses: EntityRef[] = [];
      if (type === 'event') {
        if (item.value.witnesses === undefined || item.value.witnesses === '') {
          if (ctx.mode === 'opening' || scene) {
            errors.push(`第 ${line} 行 changes.witnesses：开场或场景有变化时，必须写明目击者。`);
          } else if (ctx.projection) {
            witnesses = [
              { existing: ctx.projection.protagonistId },
              ...ctx.parentPresentIds.map((id) => ({ existing: id })),
            ];
          }
        } else {
          const tokens = splitRefs(item.value.witnesses);
          if (tokens.length > STORY_LIMITS.witnessesMax) {
            errors.push(`第 ${line} 行 changes.witnesses：最多 ${STORY_LIMITS.witnessesMax} 个。`);
          } else {
            for (const token of tokens) {
              const ref = resolveEntity(token, line, 'witnesses');
              if (!ref) continue;
              if (entityKind(ref) !== 'character') {
                errors.push(`第 ${line} 行 changes.witnesses：${token} 不是人物。`);
                continue;
              }
              witnesses.push(ref);
            }
          }
        }
      }
      if (!subject || (type !== 'event' && type !== 'trait' && !object) || !statement || para === null) continue;
      if (type === 'event') {
        facts.push({
          line,
          kind: 'event',
          subject,
          object,
          key: null,
          statement,
          data: null,
          para,
          witnesses,
        });
        continue;
      }
      if (!key) continue;
      if (type === 'trait') {
        facts.push({ line, kind: 'trait', subject, object: null, key, statement, data: null, para, witnesses: [] });
        continue;
      }
      if (type === 'promise') {
        const status = stringField(item.value, 'status', line, errors, { required: true });
        if (!status || !PROMISE_STATUSES.includes(status as (typeof PROMISE_STATUSES)[number])) {
          errors.push(`第 ${line} 行 changes.status：约定状态只能是 agreed、kept、broken。`);
          continue;
        }
        facts.push({
          line,
          kind: 'promise',
          subject,
          object: object!,
          key,
          statement,
          data: { status },
          para,
          witnesses: [],
        });
        continue;
      }
      const relationType = stringField(item.value, 'relation_type', line, errors, {
        max: STORY_LIMITS.relationTypeMax,
      });
      const strengthRaw = item.value.strength;
      const strength =
        strengthRaw === undefined || strengthRaw === ''
          ? null
          : Number(typeof strengthRaw === 'string' ? strengthRaw : strengthRaw);
      if (
        strength !== null &&
        (!Number.isInteger(strength) ||
          strength < STORY_LIMITS.relationStrengthMin ||
          strength > STORY_LIMITS.relationStrengthMax)
      ) {
        errors.push(
          `第 ${line} 行 changes.strength：强度必须是 ${STORY_LIMITS.relationStrengthMin} 到 ${STORY_LIMITS.relationStrengthMax} 的整数。`,
        );
      }
      const stage = item.value.stage === undefined ? null : stringField(item.value, 'stage', line, errors);
      if (key === 'acquaintance' && (!stage || !RELATION_STAGES.includes(stage as (typeof RELATION_STAGES)[number]))) {
        errors.push(`第 ${line} 行 changes.stage：认识阶段只能是 heard_of、met、familiar。`);
      }
      const via = item.value.via === undefined ? null : resolveEntity(item.value.via, line, 'via');
      const data: FactData = {};
      if (relationType) data.type = relationType;
      if (strength !== null && !Number.isNaN(strength)) data.strength = strength;
      if (stage) data.stage = stage;
      if (via) data.via = 'created' in via ? `created:${via.created}` : via.existing;
      facts.push({
        line,
        kind: 'relation',
        subject,
        object: object!,
        key,
        statement,
        data: Object.keys(data).length ? data : null,
        para,
        witnesses: [],
      });
      continue;
    }
    if (type === 'knowledge') {
      const fact = resolveFact(line, item.value.fact);
      const holder = resolveEntity(item.value.holder, line, 'holder');
      const level = stringField(item.value, 'level', line, errors, { required: true });
      if (level && !['heard', 'suspects', 'confirmed', 'misled'].includes(level)) {
        errors.push(`第 ${line} 行 changes.level：知情程度只能是 heard、suspects、confirmed、misled。`);
      }
      const perceived = stringField(item.value, 'perceived_statement', line, errors, {
        max: STORY_LIMITS.perceivedMax,
      });
      if (level && level !== 'confirmed' && !perceived) {
        errors.push(`第 ${line} 行 changes.perceived_statement：未确认的知情必须写主角听到的说法。`);
      }
      const via = item.value.via === undefined ? null : resolveEntity(item.value.via, line, 'via');
      const para = paraField(item.value, line, ctx.paragraphCount, errors);
      if (!fact || !holder || !level || para === null) continue;
      if (!presentSet.has(entityKey(holder)) && !via) {
        errors.push(
          `第 ${line} 行 changes：${typeof item.value.holder === 'string' ? item.value.holder : '知情者'} 本回合不在场，必须写明 via（从谁那里得知）。`,
        );
        continue;
      }
      knowledge.push({
        line,
        fact,
        holder,
        level: level as ValidatedChanges['knowledge'][number]['level'],
        perceived: perceived || null,
        via,
        para,
      });
      continue;
    }
    if (type === 'state') {
      const def = resolveStateDef(line, item.value.key);
      const valueRaw = item.value.value;
      let value: string | null = null;
      if (typeof valueRaw === 'string' || typeof valueRaw === 'number') {
        const text = String(valueRaw);
        value = text === '' ? null : text;
      } else if (valueRaw !== undefined && valueRaw !== null && valueRaw !== '') {
        errors.push(`第 ${line} 行 changes.value：必须是字符串`);
      }
      const visible = optionalBooleanField(item.value, 'visible', line, errors);
      const closed = optionalBooleanField(item.value, 'closed', line, errors);
      if (!def) continue;
      const refKey = stateDefRefKey(def.ref);
      const previous = stateLineByDef.get(refKey);
      if (previous !== undefined) {
        errors.push(`第 ${line} 行 changes.key：栏目 ${def.key} 这回合已经写过，每回合最多一行。`);
      } else {
        stateLineByDef.set(refKey, line);
      }
      if (value !== null) {
        const checked = checkStateValue(def, value);
        if (!checked.ok) {
          errors.push(`第 ${line} 行 changes.value：${checked.error}`);
          value = null;
        } else {
          value = checked.value;
        }
      }
      if (visible === true && def.hidden) {
        errors.push(`第 ${line} 行 changes.visible：幕后栏目 ${def.key} 不能设为显示。`);
      }
      states.push({ line, stateDef: def.ref, value, visible, closed });
      continue;
    }
    if (type === 'state_item') {
      const def = resolveStateDef(line, item.value.key);
      const status = stringField(item.value, 'status', line, errors, { required: true });
      if (status && !LIST_ITEM_STATUSES.includes(status as (typeof LIST_ITEM_STATUSES)[number])) {
        errors.push(`第 ${line} 行 changes.status：条目状态只能是 open、done、failed、gone。`);
      }
      const itemName = stringField(item.value, 'item', line, errors, { required: true, max: STATE_ITEM_MAX });
      if (!def || !status || !itemName) continue;
      if (def.display !== 'list') {
        errors.push(`第 ${line} 行 changes.key：${def.key} 不是清单栏目，不能用 state_item。`);
        continue;
      }
      if (!LIST_ITEM_STATUSES.includes(status as (typeof LIST_ITEM_STATUSES)[number])) continue;
      stateItems.push({
        line,
        stateDef: def.ref,
        item: itemName,
        status: status as StateItemChange['status'],
      });
      continue;
    }
    if (type === 'secret') {
      const subject =
        item.value.subject === undefined || item.value.subject === null || item.value.subject === ''
          ? null
          : resolveEntity(item.value.subject, line, 'subject');
      const title = stringField(item.value, 'title', line, errors, { required: true, max: SECRET_TITLE_MAX });
      const statement = stringField(item.value, 'statement', line, errors, {
        required: true,
        max: STORY_LIMITS.statementMax,
      });
      const reveal = stringField(item.value, 'reveal', line, errors, { max: SECRET_REVEAL_MAX }) ?? '';
      const knowers: EntityRef[] = [];
      for (const token of splitRefs(item.value.knowers)) {
        const ref = resolveEntity(token, line, 'knowers');
        if (!ref) continue;
        if (entityKind(ref) !== 'character') {
          errors.push(`第 ${line} 行 changes.knowers：${token} 不是人物。`);
          continue;
        }
        knowers.push(ref);
      }
      const para = paraField(item.value, line, ctx.paragraphCount, errors);
      if (!title || !statement || para === null) continue;
      secrets.push({ line, subject, title, statement, reveal, knowers, para });
      continue;
    }
    if (type === 'scene_hit') {
      const sceneCode = stringField(item.value, 'scene', line, errors, { required: true, max: STORY_LIMITS.keyMax });
      const para = paraField(item.value, line, ctx.paragraphCount, errors);
      if (!sceneCode) continue;
      const scenes = ctx.keyScenes ?? [];
      const scene = scenes.find((candidate) => candidate.code === sceneCode);
      if (!scene) {
        const hit = ctx.projection ? sceneHitIds(ctx.projection) : new Set<string>();
        const unused = scenes.filter((candidate) => !hit.has(candidate.id)).map((candidate) => candidate.code);
        errors.push(
          `第 ${line} 行 changes.scene：找不到关键场面 ${sceneCode}。未触发的场面：${unused.length ? unused.join('、') : '无'}。`,
        );
        continue;
      }
      if (scene.once && ctx.projection && sceneHitIds(ctx.projection).has(scene.id)) {
        errors.push(`第 ${line} 行 changes.scene：关键场面 ${sceneCode} 只发生一次，已经发生过。`);
        continue;
      }
      if (sceneLineById.has(scene.id)) {
        errors.push(`第 ${line} 行 changes.scene：关键场面 ${sceneCode} 这回合已经触发过。`);
        continue;
      }
      sceneLineById.set(scene.id, line);
      if (para === null) continue;
      sceneHits.push({ line, sceneId: scene.id, para });
    }
  }

  const keyed = new Map<string, FactChange>();
  for (const fact of facts) {
    if (!fact.key) continue;
    const key = `${fact.kind}|${fact.subject ? entityKey(fact.subject) : ''}|${fact.object ? entityKey(fact.object) : ''}|${fact.key}`;
    const existing = keyed.get(key);
    if (existing) {
      errors.push(`第 ${fact.line} 行 changes：和第 ${existing.line} 行写的是同一项，请合并成一行。`);
    } else {
      keyed.set(key, fact);
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      entities: [...newEntities.values()].map(({ distinct: _distinct, ...entity }) => entity),
      names,
      facts,
      knowledge,
      scene,
      states,
      stateItems,
      newStates: [...newStatesByLine.values()],
      secrets,
      sceneHits,
    },
  };
}
