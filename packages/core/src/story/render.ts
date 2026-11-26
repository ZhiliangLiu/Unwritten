import type { EntityKind, KnowledgeLevel } from '@unwritten/contracts';
import type { SearchHit } from './search.ts';
import type { CodeBook } from './codebook.ts';
import {
  appearedEntityIds,
  acquaintanceStage,
  currentNameHeldBy,
  knowledgeOf,
  protagonistNameOf,
} from './projection.ts';
import { STORY_LIMITS, type ChainTurn, type ProjFact, type StoryProjection } from './types.ts';

export const CATALOG_CATEGORIES = [
  'characters',
  'places',
  'items',
  'groups',
  'others',
  'promises',
  'events',
  'scenes',
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const KIND_LABEL: Record<EntityKind, string> = {
  character: '人物',
  place: '地点',
  item: '物品',
  group: '组织',
  other: '其他',
};

export const LEVEL_LABEL: Record<KnowledgeLevel, string> = {
  heard: '听说',
  suspects: '猜测',
  confirmed: '确认',
  misled: '误信',
};

const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  characters: '人物',
  places: '地点',
  items: '物品',
  groups: '组织',
  others: '其他',
  promises: '约定',
  events: '事件',
  scenes: '关键场面',
};

const CATEGORY_KIND: Partial<Record<CatalogCategory, EntityKind>> = {
  characters: 'character',
  places: 'place',
  items: 'item',
  groups: 'group',
  others: 'other',
};

function clip(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return `${chars.slice(0, max).join('')}…`;
}

function profileText(profile: string, max: number): string {
  return profile ? clip(profile, max) : '未写档案';
}

export function sourceLabel(depth: number, para: number | null): string {
  if (depth === -1) return '作品设定';
  if (para === null) return `T${depth}`;
  return `T${depth} 第${para}段`;
}

function displayName(p: StoryProjection, entityId: string): string {
  const entity = p.entities.get(entityId);
  if (!entity) return '未知';
  if (entity.isProtagonist) return entity.name;
  const known = protagonistNameOf(p, entityId);
  if (!known) return `${entity.name}（主角不知道这个名字）`;
  if (known === entity.name) return entity.name;
  return `${known}（真名：${entity.name}）`;
}

function entityCodeOf(cb: CodeBook, entityId: string | null): string {
  return entityId ? cb.entityCode(entityId) : '—';
}

function factSource(fact: ProjFact): string {
  return sourceLabel(fact.depth, fact.para);
}

export function renderEntityLine(p: StoryProjection, cb: CodeBook, entityId: string): string {
  return renderEntityLineWithCode(p, cb.entityCode(entityId), entityId);
}

export function renderEntityLineWithCode(p: StoryProjection, code: string, entityId: string): string {
  const entity = p.entities.get(entityId);
  if (!entity) return '- 未知';
  const appeared = appearedEntityIds(p).has(entityId);
  return `- ${code} ${KIND_LABEL[entity.kind]} · ${displayName(p, entityId)} · ${profileText(entity.profile, STORY_LIMITS.indexProfileChars)} · ${appeared ? '已出场' : '未出场'}`;
}

export function renderSceneBlock(p: StoryProjection, cb: CodeBook): string {
  const head = p.chain.at(-1);
  const present = (head?.scene.presentIds ?? []).filter((id) => p.entities.has(id));
  const lines = ['【当前场景】', `地点：${head?.scene.place || '未说明'}`, `时间：${head?.scene.time || '未说明'}`];
  if (present.length === 0) {
    lines.push('在场：只有主角');
  } else {
    lines.push('在场：');
    for (const entityId of present) {
      const entity = p.entities.get(entityId);
      if (!entity) continue;
      lines.push(
        `- ${cb.entityCode(entityId)} ${displayName(p, entityId)} · 认识阶段：${acquaintanceStage(p, entityId) ?? '未记录'} · ${profileText(entity.profile, STORY_LIMITS.sceneProfileChars)}`,
      );
    }
  }
  return lines.join('\n');
}

export function renderPromiseLine(p: StoryProjection, cb: CodeBook, fact: ProjFact): string {
  return renderPromiseLineWithCodes(cb.factCode(fact.id), cb, fact);
}

export function renderPromiseLineWithCodes(factCode: string, cb: CodeBook, fact: ProjFact): string {
  return `- ${factCode} ${entityCodeOf(cb, fact.subjectId)} → ${entityCodeOf(cb, fact.objectId)}：${fact.statement}`;
}

function section(title: string, lines: string[]): string {
  return `${title}：\n${lines.length ? lines.join('\n') : '- 无'}`;
}

function knowledgeLine(cb: CodeBook, fact: ProjFact, record: ReturnType<typeof knowledgeOf>[number]): string {
  const via = record.viaId ? `，来自 ${cb.entityCode(record.viaId)}` : '';
  const perceived = record.perceived ? `；以为：${record.perceived}` : '';
  return `- ${cb.factCode(fact.id)} ${fact.statement}（${LEVEL_LABEL[record.level]}${via}，${sourceLabel(record.depth, record.para)}）${perceived}`;
}

export function renderEntityDetail(p: StoryProjection, cb: CodeBook, entityId: string): string {
  const entity = p.entities.get(entityId);
  if (!entity) return '- 无';
  const lines = [`${cb.entityCode(entityId)} ${KIND_LABEL[entity.kind]} · 真名：${entity.name}`];
  lines.push(`主角的称呼：${protagonistNameOf(p, entityId) ?? '无'}`);

  const otherNames: string[] = [];
  const holders = new Set(
    p.names
      .filter((name) => name.entityId === entityId && name.holderId !== null && name.holderId !== p.protagonistId)
      .map((name) => name.holderId!),
  );
  for (const holderId of holders) {
    const name = currentNameHeldBy(p, entityId, holderId);
    if (!name) continue;
    const holderName =
      p.names.find((candidate) => candidate.entityId === entityId && candidate.holderId === holderId) ?? null;
    otherNames.push(
      `${cb.entityCode(holderId)} 称为「${name}」（${holderName ? sourceLabel(holderName.depth, holderName.para) : '作品设定'}）`,
    );
  }
  lines.push(`其他称呼：${otherNames.length ? otherNames.join('、') : '无'}`);
  lines.push(`档案：${profileText(entity.profile, Number.MAX_SAFE_INTEGER)}`);

  const traits = p.facts.filter((fact) => fact.kind === 'trait' && fact.subjectId === entityId);
  lines.push(
    section(
      '特征',
      traits.map((fact) => `- ${cb.factCode(fact.id)} ${fact.statement}（${factSource(fact)}）`),
    ),
  );

  const relations = p.facts.filter(
    (fact) => fact.kind === 'relation' && (fact.subjectId === entityId || fact.objectId === entityId),
  );
  lines.push(
    section(
      '关系',
      relations.map((fact) => {
        const stage = fact.data?.stage ? ` · 阶段 ${String(fact.data.stage)}` : '';
        const strength = fact.data?.strength !== undefined ? ` · 强度 ${String(fact.data.strength)}` : '';
        return `- ${cb.factCode(fact.id)} ${entityCodeOf(cb, fact.subjectId)} → ${entityCodeOf(cb, fact.objectId)} ${fact.key ?? ''}${stage}${strength}：${fact.statement}（${factSource(fact)}）`;
      }),
    ),
  );

  if (entity.kind === 'character') {
    const known: string[] = [];
    for (const record of p.knowledge.filter((candidate) => candidate.holderId === entityId)) {
      const fact = p.facts.find((candidate) => candidate.id === record.factId);
      if (fact) known.push(knowledgeLine(cb, fact, record));
    }
    lines.push(section('知道的事', known));
  }

  const events = p.facts
    .filter((fact) => fact.kind === 'event' && (fact.subjectId === entityId || fact.objectId === entityId))
    .sort((left, right) => right.depth - left.depth)
    .slice(0, STORY_LIMITS.recentEventsPerEntity);
  lines.push(
    section(
      entity.kind === 'character' ? '最近的相关事件' : '相关的事',
      events.map((fact) => `- ${cb.factCode(fact.id)} ${fact.statement}（${factSource(fact)}）`),
    ),
  );

  return lines.join('\n');
}

function entityListForCategory(p: StoryProjection, category: CatalogCategory): string[] {
  const kind = CATEGORY_KIND[category];
  if (!kind) return [];
  const appeared = appearedEntityIds(p);
  return [...p.entities.values()]
    .filter((entity) => entity.kind === kind)
    .sort((left, right) => {
      const leftAppeared = appeared.has(left.id) ? 0 : 1;
      const rightAppeared = appeared.has(right.id) ? 0 : 1;
      if (leftAppeared !== rightAppeared) return leftAppeared - rightAppeared;
      if (left.originDepth !== right.originDepth) return right.originDepth - left.originDepth;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    })
    .map((entity) => entity.id);
}

export function renderCatalogPage(p: StoryProjection, cb: CodeBook, category: CatalogCategory, cursor: number): string {
  if (category === 'scenes') return '本作品没有设定关键场面。';
  if (category === 'promises') {
    const promises = p.facts.filter((fact) => fact.kind === 'promise').sort((left, right) => right.depth - left.depth);
    return page(
      'promises',
      promises,
      (fact) => `${renderPromiseLine(p, cb, fact)}（${String(fact.data?.status ?? '')}）`,
      cursor,
    );
  }
  if (category === 'events') {
    const events = p.facts.filter((fact) => fact.kind === 'event').sort((left, right) => right.depth - left.depth);
    return page('events', events, (fact) => `- ${cb.factCode(fact.id)} ${factSource(fact)}：${fact.statement}`, cursor);
  }
  const ids = entityListForCategory(p, category);
  return page(category, ids, (id) => renderEntityLine(p, cb, id), cursor);
}

function page<T>(category: CatalogCategory, items: T[], render: (item: T) => string, cursor: number): string {
  if (items.length === 0) return `${CATEGORY_LABEL[category]}：没有条目。`;
  const start = Math.max(0, cursor);
  const end = Math.min(items.length, start + STORY_LIMITS.catalogPageSize);
  const lines = [
    `${CATEGORY_LABEL[category]}（第 ${start + 1}–${end} 条，共 ${items.length} 条）`,
    ...items.slice(start, end).map(render),
  ];
  lines.push(end < items.length ? `下一页：cursor=${end}` : '没有更多了。');
  return lines.join('\n');
}

export function renderWhoKnows(p: StoryProjection, cb: CodeBook, factId: string): string {
  const fact = p.facts.find((candidate) => candidate.id === factId);
  if (!fact) return '知情者：无';
  const lines = [`${cb.factCode(fact.id)} ${fact.statement}`, '知情者：'];
  const records = knowledgeOf(p, factId).sort((left, right) =>
    cb.entityCode(left.holderId).localeCompare(cb.entityCode(right.holderId)),
  );
  if (records.length === 0) {
    lines.push('无');
    return lines.join('\n');
  }
  for (const record of records) {
    const via = record.viaId ? `，来自 ${cb.entityCode(record.viaId)}` : '';
    const perceived = record.perceived ? `；以为：${record.perceived}` : '';
    lines.push(
      `- ${cb.entityCode(record.holderId)} ${displayName(p, record.holderId)}：${LEVEL_LABEL[record.level]}${via}${perceived}（${sourceLabel(record.depth, record.para)}）`,
    );
  }
  return lines.join('\n');
}

function turnHeading(turn: ChainTurn): string {
  return turn.depth === 0 ? 'T0（开场）' : `T${turn.depth}`;
}

export function renderTurnText(turn: ChainTurn): string {
  const lines = [turnHeading(turn)];
  if (turn.action) lines.push(`玩家行动：${turn.action.text}`);
  turn.paragraphs.forEach((paragraph, index) => {
    if (index > 0) lines.push('');
    lines.push(`[${index + 1}] ${paragraph}`);
  });
  return lines.join('\n');
}

export function renderSearchHits(hits: SearchHit[], query: string): string {
  if (hits.length === 0) return `搜索「${query}」，没有命中。`;
  return [
    `搜索「${query}」，命中 ${hits.length} 处：`,
    ...hits.map((hit) => `- T${hit.depth} 第${hit.para}段：${hit.snippet}`),
  ].join('\n');
}

export function clipToolResult(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= STORY_LIMITS.toolResultMaxChars) return text;
  return `${chars.slice(0, STORY_LIMITS.toolResultMaxChars).join('')}\n（已截断）`;
}
