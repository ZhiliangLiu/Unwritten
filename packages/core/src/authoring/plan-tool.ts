import {
  EntityKindSchema,
  LanguageTagSchema,
  PLAN_SUMMARY_KEYS,
  StateDisplaySchema,
  type CastMode,
  type PlanConflict,
  type PlanEntityRole,
  type PlanItem,
  type PlanSource,
  type StateConfig,
} from '@unwritten/contracts';
import { checkStateConfig, checkStateValue } from '../story/state.ts';
import { parseJsonLines } from '../text/turn-text.ts';

export const PROPOSE_PLAN_TOOL_NAME = 'propose_plan';

export const PLAN_LIMITS = {
  entitiesMax: 30,
  secretsMax: 20,
  statesMax: 12,
  scenesMax: 12,
  conflictsMax: 5,
} as const;

export const PROPOSE_PLAN_PARAMETERS = {
  type: 'object',
  properties: {
    language: { type: 'string', description: '作品语言的语言标签，例如 zh-CN' },
    summary: {
      type: 'string',
      description:
        '每行一个 JSON：{"key":"identity|tone|situation|world","text":"…","from":"author|ai"}。identity 是玩家身份，situation 是开场处境，这两项必须有',
    },
    entities: {
      type: 'string',
      description:
        '每行一个 JSON：{"ref":"e1","kind":"character|place|item|group|other","role":"protagonist|cast|other","name":"名字","known_as":"主角一开始怎么称呼它，不知道时留空","profile":"一句话档案","from":"author|ai"}。恰好一个 protagonist。主要人物每次新开局生成时，cast 行再写 "slot_role":"它在故事里的作用","encounter":"一次相遇的样例"，name 写这个位置的称呼',
    },
    secrets: {
      type: 'string',
      description:
        '每行一个 JSON：{"title":"无剧透的标题","statement":"真相","subject":"e1 或名字","knowers":"e2,名字","reveal":"玩家凭什么能发现","from":"author|ai"}',
    },
    state: {
      type: 'string',
      description:
        '每行一个 JSON：{"key":"英文或中文的短名","label":"显示名","display":"number|stage|list|text","min":"0","max":"10","unit":"米","stages":"阶段一|阶段二","hidden":"true|false","reveal":"什么时候让玩家看见","initial":"开局值，清单留空","from":"author|ai"}。min、max、unit 只用于数字，stages 只用于阶段',
    },
    scenes: {
      type: 'string',
      description:
        '每行一个 JSON：{"condition":"满足什么条件","outcome":"发生什么","once":"true|false","from":"author|ai"}',
    },
    ending: { type: 'string', description: '结束条件原文；开放式作品填空字符串' },
    conflicts: {
      type: 'string',
      description:
        '两条作者设定互相矛盾时，每行一个 JSON：{"first":"第一段原话","second":"第二段原话","impact":"会影响什么体验"}。原话必须逐字摘自作者的输入；没有矛盾时填空字符串',
    },
  },
  required: ['language', 'summary', 'entities', 'secrets', 'state', 'scenes', 'ending', 'conflicts'],
  additionalProperties: false,
} as const;

export type PlanField = 'language' | 'summary' | 'entities' | 'secrets' | 'state' | 'scenes' | 'ending' | 'conflicts';

export interface PlanParseContext {
  castMode: CastMode;
  protectedItems: PlanItem[];
  authorTexts: string[];
  newId: () => string;
}

export type PlanParse =
  | {
      ok: true;
      value: { items: PlanItem[]; conflicts: PlanConflict[]; language: string; droppedConflicts: number };
    }
  | { ok: false; errors: string[]; fields: PlanField[] };

const SUMMARY_KEYS = ['identity', 'tone', 'situation', 'world'] as const;
const PLAN_TEXT_MAX_LENGTH = 1_000;
const PLAN_NAME_MAX_LENGTH = 40;
const PLAN_PROFILE_MAX_LENGTH = 300;
const PLAN_STATEMENT_MAX_LENGTH = 200;
const STATE_LABEL_MAX_LENGTH = 20;
const STATE_KEY_PATTERN = /^[\p{L}\p{N}_]{1,40}$/u;

type JsonLine = { line: number; value: Record<string, unknown> };

function normalizeForQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function characterLength(text: string): number {
  return text.length;
}

export function sortPlanItems(items: PlanItem[]): PlanItem[] {
  const kindOrder: Record<PlanItem['kind'], number> = {
    summary: 0,
    entity: 1,
    secret: 2,
    state: 3,
    scene: 4,
    ending: 5,
  };
  return [...items].sort((left, right) => {
    const kindDiff = kindOrder[left.kind] - kindOrder[right.kind];
    if (kindDiff !== 0) return kindDiff;
    if (left.kind === 'summary' && right.kind === 'summary') {
      return PLAN_SUMMARY_KEYS.indexOf(left.key) - PLAN_SUMMARY_KEYS.indexOf(right.key);
    }
    if (left.kind === 'entity' && right.kind === 'entity') {
      return Number(right.role === 'protagonist') - Number(left.role === 'protagonist');
    }
    return 0;
  });
}

export function parsePlanArgs(args: Record<string, unknown>, ctx: PlanParseContext): PlanParse {
  const errors: string[] = [];
  const fields = new Set<PlanField>();
  const fail = (field: PlanField, message: string) => {
    fields.add(field);
    errors.push(message);
  };
  const failed = (): PlanParse => ({ ok: false, errors, fields: [...fields] });

  const argument = (field: PlanField): string | null => {
    const value = args[field];
    if (typeof value !== 'string') {
      fail(field, `参数 ${field} 必须是字符串`);
      return null;
    }
    return value;
  };

  const parseLines = (field: PlanField, text: string): JsonLine[] | null => {
    const parsed = parseJsonLines(text, field);
    if (!parsed.ok) {
      for (const message of parsed.errors) fail(field, message);
      return null;
    }
    return parsed.value.map((entry) => ({ line: entry.line, value: entry.value as Record<string, unknown> }));
  };

  const sourceOf = (field: PlanField, line: number, value: Record<string, unknown>): PlanSource | null => {
    if (value.from === 'author' || value.from === 'ai') return value.from;
    fail(field, `第 ${line} 行 ${field}.from：只能是 author 或 ai。`);
    return null;
  };

  const requiredText = (
    field: PlanField,
    line: number,
    value: Record<string, unknown>,
    key: string,
    max: number,
  ): string | null => {
    const raw = value[key];
    if (typeof raw !== 'string') {
      fail(field, `第 ${line} 行 ${field}.${key}：必须是字符串。`);
      return null;
    }
    const text = raw.trim();
    if (!text) {
      fail(field, `第 ${line} 行 ${field}.${key}：不能为空。`);
      return null;
    }
    if (characterLength(text) > max) {
      fail(field, `第 ${line} 行 ${field}.${key}：不能超过 ${max} 个字符。`);
      return null;
    }
    return text;
  };

  const optionalText = (
    field: PlanField,
    line: number,
    value: Record<string, unknown>,
    key: string,
    max: number,
  ): string | null => {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string') {
      fail(field, `第 ${line} 行 ${field}.${key}：必须是字符串。`);
      return null;
    }
    const text = raw.trim();
    if (!text) return null;
    if (characterLength(text) > max) {
      fail(field, `第 ${line} 行 ${field}.${key}：不能超过 ${max} 个字符。`);
      return null;
    }
    return text;
  };

  const booleanOf = (
    field: PlanField,
    line: number,
    value: Record<string, unknown>,
    key: string,
    fallback: boolean,
  ): boolean | null => {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    fail(field, `第 ${line} 行 ${field}.${key}：只能是 true 或 false。`);
    return null;
  };

  const languageRaw = argument('language');
  const summaryRaw = argument('summary');
  const entitiesRaw = argument('entities');
  const secretsRaw = argument('secrets');
  const stateRaw = argument('state');
  const scenesRaw = argument('scenes');
  const endingRaw = argument('ending');
  const conflictsRaw = argument('conflicts');
  if (errors.length) return failed();

  if (languageRaw !== null && !LanguageTagSchema.safeParse(languageRaw).success) {
    fail('language', '参数 language 必须是合法的语言标签');
  }

  const protectedItems = ctx.protectedItems;
  const protectedSummaries = protectedItems.filter(
    (item): item is PlanItem & { kind: 'summary' } => item.kind === 'summary',
  );
  const protectedEntities = protectedItems.filter(
    (item): item is PlanItem & { kind: 'entity' } => item.kind === 'entity',
  );
  const protectedEntityByIdentity = new Map(protectedEntities.map((item) => [`${item.entityKind}|${item.name}`, item]));
  const protectedSummaryKeys = new Set<string>(protectedSummaries.map((item) => item.key));
  const protectedEnding = protectedItems.find((item) => item.kind === 'ending');

  const summaryItems: PlanItem[] = [];
  const summaryKeys = new Set<string>();
  const summaryRows = parseLines('summary', summaryRaw ?? '');
  if (summaryRows) {
    for (const { line, value } of summaryRows) {
      const key = value.key;
      if (typeof key !== 'string' || !(SUMMARY_KEYS as readonly string[]).includes(key)) {
        fail('summary', `第 ${line} 行 summary.key：只能是 identity、tone、situation、world。`);
        continue;
      }
      if (protectedSummaryKeys.has(key)) continue;
      if (summaryKeys.has(key)) {
        fail('summary', `第 ${line} 行 summary：key ${key} 已经写过。`);
        continue;
      }
      summaryKeys.add(key);
      const text = requiredText('summary', line, value, 'text', PLAN_TEXT_MAX_LENGTH);
      const source = sourceOf('summary', line, value);
      if (!text || !source) continue;
      summaryItems.push({
        kind: 'summary',
        key: key as (typeof SUMMARY_KEYS)[number],
        id: ctx.newId(),
        text,
        source,
      });
    }
  }
  const allSummaryKeys = new Set<string>([...protectedSummaryKeys, ...summaryKeys]);
  if (!allSummaryKeys.has('identity') || !allSummaryKeys.has('situation')) {
    fail('summary', 'summary：必须有 identity 和 situation 两项。');
  }

  const entityItems: Array<PlanItem & { kind: 'entity' }> = [];
  const refIds = new Map<string, string>();
  const newEntityNames = new Map<string, PlanItem & { kind: 'entity' }>();
  const seenEntityNames = new Map<string, number>();
  const entityRows = parseLines('entities', entitiesRaw ?? '');
  if (entityRows) {
    for (const { line, value } of entityRows) {
      const kind = EntityKindSchema.safeParse(value.kind);
      if (!kind.success) {
        fail('entities', `第 ${line} 行 entities.kind：只能是 character、place、item、group 或 other。`);
        continue;
      }
      const role = value.role;
      if (role !== 'protagonist' && role !== 'cast' && role !== 'other') {
        fail('entities', `第 ${line} 行 entities.role：只能是 protagonist、cast 或 other。`);
        continue;
      }
      const name = requiredText('entities', line, value, 'name', PLAN_NAME_MAX_LENGTH);
      if (!name) continue;
      if (protectedEntityByIdentity.has(`${kind.data}|${name}`)) continue;

      const source = sourceOf('entities', line, value);
      if (!source) continue;
      if (role === 'protagonist' && kind.data !== 'character') {
        fail('entities', `第 ${line} 行 entities：主角必须是 character。`);
        continue;
      }
      const ref = optionalText('entities', line, value, 'ref', 64);
      if (ref) {
        if (ref.startsWith('@') || ref.startsWith('#')) {
          fail('entities', `第 ${line} 行 entities.ref：不能以 @ 或 # 开头。`);
          continue;
        }
        if (refIds.has(ref)) {
          fail('entities', `第 ${line} 行 entities.ref：ref ${ref} 已经写过。`);
          continue;
        }
      }
      const knownAs = optionalText('entities', line, value, 'known_as', PLAN_NAME_MAX_LENGTH);
      const profile = optionalText('entities', line, value, 'profile', PLAN_PROFILE_MAX_LENGTH) ?? '';
      const slotRole = optionalText('entities', line, value, 'slot_role', 100);
      const encounter = optionalText('entities', line, value, 'encounter', PLAN_TEXT_MAX_LENGTH);
      let slot: { role: string; encounter: string } | null = null;
      if (ctx.castMode === 'fixed') {
        if (slotRole !== null || encounter !== null) {
          fail('entities', `第 ${line} 行 entities：固定主要角色的作品不写 slot_role 和 encounter。`);
          continue;
        }
      } else if (role === 'cast') {
        if (slotRole === null || encounter === null) {
          fail('entities', `第 ${line} 行 entities：主要人物每次新开局生成，cast 行必须写 slot_role 和 encounter。`);
          continue;
        }
        slot = { role: slotRole, encounter };
      }

      const nameKey = `${kind.data}|${name}`;
      const earlier = seenEntityNames.get(nameKey);
      if (earlier !== undefined) {
        fail('entities', `第 ${line} 行 entities：和第 ${earlier} 行重复了同一个名字。`);
        continue;
      }
      seenEntityNames.set(nameKey, line);

      const item: PlanItem & { kind: 'entity' } = {
        kind: 'entity',
        id: ctx.newId(),
        entityKind: kind.data,
        role: role as PlanEntityRole,
        name,
        knownAs,
        profile,
        slot,
        source,
      };
      entityItems.push(item);
      newEntityNames.set(name, item);
      if (ref) refIds.set(ref, item.id);
    }
  }
  const allEntityItems = [...protectedEntities, ...entityItems];
  const protagonistCount = allEntityItems.filter((item) => item.role === 'protagonist').length;
  if (protagonistCount !== 1) {
    fail('entities', 'entities：必须恰好有一行 "role":"protagonist"。');
  }
  if (protectedEntities.length + entityItems.length > PLAN_LIMITS.entitiesMax) {
    fail('entities', `entities：最多 ${PLAN_LIMITS.entitiesMax} 行。`);
  }

  const entityById = new Map(allEntityItems.map((item) => [item.id, item]));
  const protectedEntityByName = new Map(protectedEntities.map((item) => [item.name, item]));
  const characterNames = allEntityItems.filter((item) => item.entityKind === 'character').map((item) => item.name);

  const resolveEntity = (token: string): (PlanItem & { kind: 'entity' }) | null => {
    const byRef = refIds.get(token);
    if (byRef) return entityById.get(byRef) ?? null;
    const byName = newEntityNames.get(token) ?? protectedEntityByName.get(token);
    return byName ?? null;
  };

  const secretItems: PlanItem[] = [];
  const secretRows = parseLines('secrets', secretsRaw ?? '');
  if (secretRows) {
    for (const { line, value } of secretRows) {
      const title = requiredText('secrets', line, value, 'title', PLAN_NAME_MAX_LENGTH);
      const statement = requiredText('secrets', line, value, 'statement', PLAN_STATEMENT_MAX_LENGTH);
      const reveal = optionalText('secrets', line, value, 'reveal', PLAN_TEXT_MAX_LENGTH) ?? '';
      const source = sourceOf('secrets', line, value);
      const subjectRaw = optionalText('secrets', line, value, 'subject', PLAN_NAME_MAX_LENGTH);
      const knowersRaw = optionalText('secrets', line, value, 'knowers', PLAN_TEXT_MAX_LENGTH);
      if (!title || !statement || !source) continue;

      let subjectId: string | null = null;
      if (subjectRaw !== null) {
        const subject = resolveEntity(subjectRaw);
        if (!subject) {
          fail(
            'secrets',
            `第 ${line} 行 secrets.subject：找不到「${subjectRaw}」。可用的人物：${characterNames.join('、')}。`,
          );
        } else {
          subjectId = subject.id;
        }
      }

      const knowerIds: string[] = [];
      for (const token of (knowersRaw ?? '')
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)) {
        const knower = resolveEntity(token);
        if (!knower) {
          fail(
            'secrets',
            `第 ${line} 行 secrets.knowers：找不到「${token}」。可用的人物：${characterNames.join('、')}。`,
          );
          continue;
        }
        if (knower.entityKind !== 'character') {
          fail('secrets', `第 ${line} 行 secrets.knowers：${token} 不是人物。`);
          continue;
        }
        if (!knowerIds.includes(knower.id)) knowerIds.push(knower.id);
      }

      secretItems.push({
        kind: 'secret',
        id: ctx.newId(),
        title,
        statement,
        subjectId,
        knowerIds,
        reveal,
        source,
      });
    }
  }
  if (secretRows && secretRows.length > PLAN_LIMITS.secretsMax) {
    fail('secrets', `secrets：最多 ${PLAN_LIMITS.secretsMax} 行。`);
  }

  const stateItems: PlanItem[] = [];
  const stateKeys = new Set(protectedItems.flatMap((item) => (item.kind === 'state' ? [item.key] : [])));
  const stateRows = parseLines('state', stateRaw ?? '');
  if (stateRows) {
    for (const { line, value } of stateRows) {
      const key = requiredText('state', line, value, 'key', 40);
      if (!key || !STATE_KEY_PATTERN.test(key)) {
        if (key) fail('state', `第 ${line} 行 state.key：只能是 1 到 40 个字母、数字或下划线。`);
        continue;
      }
      if (stateKeys.has(key)) {
        fail('state', `第 ${line} 行 state：key ${key} 已经写过。`);
        continue;
      }
      stateKeys.add(key);
      const label = requiredText('state', line, value, 'label', STATE_LABEL_MAX_LENGTH);
      const display = StateDisplaySchema.safeParse(value.display);
      if (!display.success) {
        fail('state', `第 ${line} 行 state.display：只能是 number、stage、list 或 text。`);
        continue;
      }
      const parseNumber = (field: string): number | null | undefined => {
        const raw = value[field];
        if (raw === undefined || raw === null || raw === '') return null;
        if (typeof raw !== 'string') {
          fail('state', `第 ${line} 行 state.${field}：必须是数字。`);
          return undefined;
        }
        const number = Number(raw);
        if (!Number.isFinite(number)) {
          fail('state', `第 ${line} 行 state.${field}：必须是数字。`);
          return undefined;
        }
        return number;
      };
      const min = parseNumber('min');
      const max = parseNumber('max');
      const unit = optionalText('state', line, value, 'unit', 10);
      const stagesRaw = value.stages;
      if (stagesRaw !== undefined && typeof stagesRaw !== 'string') {
        fail('state', `第 ${line} 行 state.stages：必须是字符串。`);
        continue;
      }
      const stages = (stagesRaw ?? '')
        .split('|')
        .map((stage) => stage.trim())
        .filter(Boolean);
      const hidden = booleanOf('state', line, value, 'hidden', false);
      const reveal = optionalText('state', line, value, 'reveal', PLAN_TEXT_MAX_LENGTH) ?? '';
      const initialRaw = optionalText('state', line, value, 'initial', 200);
      const source = sourceOf('state', line, value);
      if (!label || min === undefined || max === undefined || hidden === null || !source) continue;
      const config: StateConfig = { min, max, unit, stages };
      const checked = checkStateConfig(display.data, config);
      if (!checked.ok) {
        fail('state', `第 ${line} 行 state：${checked.error}`);
        continue;
      }
      let initial: string | null = null;
      if (initialRaw !== null) {
        if (display.data === 'list') {
          fail('state', `第 ${line} 行 state：清单栏目的 initial 留空。`);
          continue;
        }
        const checkedValue = checkStateValue({ display: display.data, config: checked.value }, initialRaw);
        if (!checkedValue.ok) {
          fail('state', `第 ${line} 行 state：${checkedValue.error}`);
          continue;
        }
        initial = checkedValue.value;
      }
      stateItems.push({
        kind: 'state',
        id: ctx.newId(),
        key,
        label,
        display: display.data,
        config: checked.value,
        hidden,
        reveal,
        initial,
        source,
      });
    }
  }
  if (stateRows && stateRows.length > PLAN_LIMITS.statesMax) {
    fail('state', `state：最多 ${PLAN_LIMITS.statesMax} 行。`);
  }

  const sceneItems: PlanItem[] = [];
  const sceneRows = parseLines('scenes', scenesRaw ?? '');
  if (sceneRows) {
    for (const { line, value } of sceneRows) {
      const condition = requiredText('scenes', line, value, 'condition', PLAN_TEXT_MAX_LENGTH);
      const outcome = requiredText('scenes', line, value, 'outcome', PLAN_TEXT_MAX_LENGTH);
      const once = booleanOf('scenes', line, value, 'once', true);
      const source = sourceOf('scenes', line, value);
      if (!condition || !outcome || once === null || !source) continue;
      sceneItems.push({ kind: 'scene', id: ctx.newId(), condition, outcome, once, source });
    }
  }
  if (sceneRows && sceneRows.length > PLAN_LIMITS.scenesMax) {
    fail('scenes', `scenes：最多 ${PLAN_LIMITS.scenesMax} 行。`);
  }

  const endingItems: PlanItem[] = [];
  if (!protectedEnding && endingRaw !== null) {
    const ending = endingRaw.trim();
    if (characterLength(ending) > PLAN_TEXT_MAX_LENGTH) {
      fail('ending', `参数 ending 不能超过 ${PLAN_TEXT_MAX_LENGTH} 个字符。`);
    } else if (ending) {
      endingItems.push({ kind: 'ending', id: ctx.newId(), text: ending, source: 'ai' });
    }
  }

  const conflicts: PlanConflict[] = [];
  let droppedConflicts = 0;
  const authorTexts = ctx.authorTexts.map(normalizeForQuote).filter((text) => text.length > 0);
  const conflictRows = parseLines('conflicts', conflictsRaw ?? '');
  if (conflictRows) {
    for (const { line, value } of conflictRows) {
      const first = requiredText('conflicts', line, value, 'first', 500);
      const second = requiredText('conflicts', line, value, 'second', 500);
      const impact = requiredText('conflicts', line, value, 'impact', 500);
      if (!first || !second || !impact) continue;
      const normalizedFirst = normalizeForQuote(first);
      const normalizedSecond = normalizeForQuote(second);
      const known = (quote: string) => authorTexts.some((text) => text.includes(quote));
      if (!known(normalizedFirst) || !known(normalizedSecond)) {
        droppedConflicts += 1;
        continue;
      }
      if (conflicts.length >= PLAN_LIMITS.conflictsMax) continue;
      conflicts.push({ first, second, impact });
    }
  }

  if (errors.length) return failed();
  return {
    ok: true,
    value: {
      items: sortPlanItems([
        ...protectedItems,
        ...summaryItems,
        ...entityItems,
        ...secretItems,
        ...stateItems,
        ...sceneItems,
        ...endingItems,
      ]),
      conflicts,
      language: languageRaw ?? '',
      droppedConflicts,
    },
  };
}
