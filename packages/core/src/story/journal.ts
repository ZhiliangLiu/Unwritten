import type { JournalLine, JournalSubject, JournalView } from '@unwritten/contracts';
import { maskUnknownNames, protagonistKnowledge, protagonistNameOf } from './projection.ts';
import type { ProjFact, StoryProjection } from './types.ts';

const KIND_ORDER: Record<string, number> = { character: 0, place: 1, item: 2, group: 3, other: 4 };

function lineOf(p: StoryProjection, fact: ProjFact): JournalLine | null {
  const knowledge = protagonistKnowledge(p, fact.id);
  if (!knowledge) return null;
  const text = knowledge.level === 'confirmed' ? fact.statement : knowledge.perceived;
  if (!text) return null;
  const source =
    knowledge.turnId && knowledge.para !== null
      ? { turnId: knowledge.turnId, depth: knowledge.depth, para: knowledge.para }
      : null;
  return {
    id: fact.id,
    text: maskUnknownNames(p, text),
    level: knowledge.level,
    source,
  };
}

function sourceDepth(line: JournalLine): number {
  return line.source?.depth ?? -1;
}

function sourcePara(line: JournalLine): number {
  return line.source?.para ?? 0;
}

function sortLines(lines: JournalLine[]): JournalLine[] {
  return lines.sort((left, right) => sourceDepth(left) - sourceDepth(right) || sourcePara(left) - sourcePara(right));
}

export function buildJournal(p: StoryProjection, routeId: string): JournalView {
  const subjects: JournalSubject[] = [];
  for (const entity of p.entities.values()) {
    if (entity.id === p.protagonistId) continue;
    const name = protagonistNameOf(p, entity.id);
    if (!name) continue;
    const lines: JournalLine[] = [];
    for (const fact of p.facts) {
      if (!['trait', 'relation', 'promise', 'event'].includes(fact.kind)) continue;
      if (fact.subjectId !== entity.id && fact.objectId !== entity.id) continue;
      const line = lineOf(p, fact);
      if (line) lines.push(line);
    }
    sortLines(lines);
    subjects.push({ entityId: entity.id, kind: entity.kind, name, lines });
  }
  subjects.sort((left, right) => {
    const kindDiff = (KIND_ORDER[left.kind] ?? 0) - (KIND_ORDER[right.kind] ?? 0);
    if (kindDiff !== 0) return kindDiff;
    const leftFirst = left.lines[0];
    const rightFirst = right.lines[0];
    if (!leftFirst || !rightFirst) return (leftFirst ? 0 : 1) - (rightFirst ? 0 : 1);
    return sourceDepth(leftFirst) - sourceDepth(rightFirst) || sourcePara(leftFirst) - sourcePara(rightFirst);
  });

  const events: JournalLine[] = [];
  for (const fact of p.facts) {
    if (fact.kind !== 'event') continue;
    const line = lineOf(p, fact);
    if (line) events.push(line);
  }
  sortLines(events);

  return { routeId, headTurnId: p.headTurnId, subjects, events };
}
