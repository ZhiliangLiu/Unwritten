import { protagonistKnownStrings } from './projection.ts';
import type { EntityRef, StoryProjection, ValidatedChanges } from './types.ts';
import { STORY_LIMITS } from './types.ts';

function refKey(ref: EntityRef): string {
  return 'existing' in ref ? ref.existing : `created:${ref.created}`;
}

function knownNames(projection: StoryProjection | null): Set<string> {
  return projection ? new Set(protagonistKnownStrings(projection)) : new Set<string>();
}

function replaceKnown(text: string, known: Set<string>): string {
  let result = text;
  const names = [...known].sort((left, right) => Array.from(right).length - Array.from(left).length);
  for (const name of names) result = result.replaceAll(name, '\u0000');
  return result;
}

function firstUnknown(text: string, known: Set<string>, candidates: Set<string>): string[] {
  const masked = replaceKnown(text, known);
  const found: string[] = [];
  for (const candidate of candidates) {
    if (Array.from(candidate).length < STORY_LIMITS.nameMinLengthForLeakCheck) continue;
    if (!known.has(candidate) && masked.includes(candidate)) found.push(candidate);
  }
  return found;
}

export function findLeaks(input: {
  projection: StoryProjection | null;
  changes: ValidatedChanges;
  paragraphs: string[];
  options: string[];
  extras?: string[];
}): string[] {
  const known = knownNames(input.projection);
  const timing: Array<{ para: number; name: string }> = [];
  for (const entity of input.changes.entities) {
    if (entity.knownAs) timing.push({ para: entity.para, name: entity.knownAs });
  }
  const protagonistKey = input.projection
    ? input.projection.protagonistId
    : (() => {
        const protagonist = input.changes.entities.find((entity) => entity.protagonist);
        return protagonist ? `created:${protagonist.line}` : null;
      })();
  for (const change of input.changes.names) {
    if (protagonistKey && refKey(change.holder) === protagonistKey) {
      timing.push({ para: change.para, name: change.name });
    }
  }
  const openingProtagonist = input.changes.entities.find((entity) => entity.protagonist);
  if (openingProtagonist) timing.push({ para: 1, name: openingProtagonist.name });

  const candidates = new Set<string>();
  if (input.projection) {
    for (const entity of input.projection.entities.values()) candidates.add(entity.name);
    for (const name of input.projection.names) candidates.add(name.name);
  }
  for (const entity of input.changes.entities) {
    candidates.add(entity.name);
    if (entity.knownAs) candidates.add(entity.knownAs);
  }

  const knownAsOf = new Map<string, string>();
  for (const entity of input.changes.entities) {
    if (entity.knownAs && entity.knownAs !== entity.name) knownAsOf.set(entity.name, entity.knownAs);
  }
  const advice = (name: string): string => {
    const prefer = knownAsOf.get(name);
    if (prefer) return `正文写到它时用「${prefer}」，它已经登记为主角此刻的叫法。`;
    return '先在这一段或之前用 name 给主角加上这个称呼，或者换成主角知道的叫法。';
  };

  const errors: string[] = [];
  input.paragraphs.forEach((paragraph, index) => {
    const para = index + 1;
    const atParagraph = new Set(known);
    for (const entry of timing) if (entry.para <= para) atParagraph.add(entry.name);
    for (const leaked of firstUnknown(paragraph, atParagraph, candidates)) {
      errors.push(`第 ${para} 段出现了主角还不知道的名字「${leaked}」。${advice(leaked)}`);
    }
  });

  const atOptions = new Set(known);
  for (const entry of timing) atOptions.add(entry.name);
  input.options.forEach((option, index) => {
    for (const leaked of firstUnknown(option, atOptions, candidates)) {
      errors.push(`第 ${index + 1} 个推荐行动出现了主角还不知道的名字「${leaked}」。${advice(leaked)}`);
    }
  });
  (input.extras ?? []).forEach((extra, index) => {
    for (const leaked of firstUnknown(extra, atOptions, candidates)) {
      errors.push(`第 ${index + 1} 条提醒出现了主角还不知道的名字「${leaked}」。${advice(leaked)}`);
    }
  });
  return errors;
}
