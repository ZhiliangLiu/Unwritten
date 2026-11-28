import { and, eq, isNull } from 'drizzle-orm';
import { PORTRAIT_SLOTS, type PortraitSlot } from '@unwritten/contracts';
import { ImageError, type ImageDispatchGuard } from '../services.ts';
import type { Database } from '../store/db.ts';
import type { PlaythroughIllustration } from '../store/illustration-types.ts';
import { portraitSets } from '../store/schema.ts';
import type { ScenePerson } from '../story/scene-projection.ts';
import { ensurePlaythroughFront, type PortraitDeps } from './portraits.ts';

type Reader = Pick<Database, 'select'>;
type PortraitSetRow = typeof portraitSets.$inferSelect;

interface SetLookup {
  settings: PlaythroughIllustration;
  playthroughId: string;
}

function setById(db: Reader, id: string | null, person: ScenePerson, playthroughId: string): PortraitSetRow | null {
  if (id === null) return null;
  const row = db.select().from(portraitSets).where(eq(portraitSets.id, id)).get();
  if (!row || row.entityId !== person.entityId) return null;
  if (row.playthroughId !== null && row.playthroughId !== playthroughId) return null;
  return row;
}

function playthroughSet(db: Reader, person: ScenePerson, playthroughId: string): PortraitSetRow | null {
  const row = db
    .select()
    .from(portraitSets)
    .where(
      and(
        eq(portraitSets.scope, 'playthrough'),
        eq(portraitSets.playthroughId, playthroughId),
        eq(portraitSets.entityId, person.entityId),
        person.identityFactId === null
          ? isNull(portraitSets.appearanceFactId)
          : eq(portraitSets.appearanceFactId, person.identityFactId),
      ),
    )
    .get();
  return row ?? null;
}

function findSet(db: Reader, input: SetLookup, person: ScenePerson): PortraitSetRow | null {
  const snapshot = person.isProtagonist
    ? setById(db, input.settings.protagonistPortraitSetId, person, input.playthroughId)
    : null;
  if (snapshot !== null) return snapshot;
  const frozen = person.identityFactId === null ? (input.settings.authorPortraitSetIds[person.entityId] ?? null) : null;
  return setById(db, frozen, person, input.playthroughId) ?? playthroughSet(db, person, input.playthroughId);
}

function fileSlots(row: PortraitSetRow | null): PortraitSlot[] {
  if (row === null) return [];
  return PORTRAIT_SLOTS.filter((slot) => row.slots[slot].file !== null);
}

function hasVisibleAppearance(person: ScenePerson): boolean {
  return (person.appearance ?? '').trim().length > 0;
}

function textWithoutBannedName(text: string | null, bannedNames: string[]): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  return bannedNames.some((name) => lower.includes(name.toLowerCase())) ? null : trimmed;
}

export function referenceViewsFor(
  db: Reader,
  input: {
    people: ScenePerson[];
    settings: PlaythroughIllustration;
    playthroughId: string;
    maxReferences: number;
  },
): Record<string, PortraitSlot[]> {
  const views: Record<string, PortraitSlot[]> = {};
  if (input.maxReferences <= 0) return views;
  for (const person of input.people) {
    const slots = fileSlots(findSet(db, input, person));
    if (slots.length > 0) {
      views[person.code] = slots;
      continue;
    }
    if (hasVisibleAppearance(person)) views[person.code] = ['front'];
  }
  return views;
}

export interface PickedReference {
  code: string;
  setId: string;
  slot: PortraitSlot;
  file: NonNullable<PortraitSetRow['slots'][PortraitSlot]['file']>;
  generated?: boolean;
}

export async function pickReferenceFiles(
  deps: PortraitDeps,
  input: {
    refs: Array<{ code: string; view: PortraitSlot }>;
    people: ScenePerson[];
    settings: PlaythroughIllustration;
    playthroughId: string;
    workId: string;
    serviceId: string;
    guard: ImageDispatchGuard;
    maxReferenceBytes: number | null;
    bannedNames: string[];
    signal: AbortSignal;
  },
): Promise<Array<PickedReference | { code: string; drop: string }>> {
  const lookup = { settings: input.settings, playthroughId: input.playthroughId };
  const results: Array<PickedReference | { code: string; drop: string }> = [];

  for (const ref of input.refs) {
    const person = input.people.find((candidate) => candidate.code === ref.code);
    if (!person) {
      results.push({ code: ref.code, drop: '一个人' });
      continue;
    }
    const row = findSet(deps.db, lookup, person);
    const ordered = [...new Set<PortraitSlot>([ref.view, ...PORTRAIT_SLOTS])];
    let picked: PickedReference | null = null;
    let tooLarge = false;
    for (const slot of ordered) {
      const file = row?.slots[slot].file ?? null;
      if (file === null) continue;
      if (input.maxReferenceBytes === null || file.bytes <= input.maxReferenceBytes) {
        picked = { code: ref.code, setId: row!.id, slot, file };
        break;
      }
      tooLarge = true;
    }
    if (picked !== null) {
      results.push(picked);
      continue;
    }
    if (tooLarge) throw new ImageError('image_reference_too_large', 'final');
    if (!hasVisibleAppearance(person)) {
      results.push({ code: ref.code, drop: textWithoutBannedName(person.knownAs, input.bannedNames) ?? '一个人' });
      continue;
    }
    const front = await ensurePlaythroughFront(deps, {
      playthroughId: input.playthroughId,
      workId: input.workId,
      entityId: person.entityId,
      serviceId: input.serviceId,
      guard: input.guard,
      identityFactId: person.identityFactId,
      appearance: person.appearance!,
      style: input.settings.style,
      signal: input.signal,
    });
    results.push({ code: ref.code, setId: front.setId, slot: 'front', file: front.front, generated: true });
  }

  return results;
}
