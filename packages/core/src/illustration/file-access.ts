import { eq } from 'drizzle-orm';
import type { ImageFileInput } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { IMAGE_EXTENSION } from '../image/limits.ts';
import { ancestorChain } from '../play/chain.ts';
import type { Database } from '../store/db.ts';
import {
  PlaythroughIllustrationSchema,
  type ImageFileRef,
  type PlaythroughIllustration,
} from '../store/illustration-types.ts';
import { illustrations, playthroughs, portraitSets, routes } from '../store/schema.ts';
import { loadProjection } from '../story/projection.ts';
import type { StoryProjection } from '../story/types.ts';
import { journalPortraits } from './journal-portraits.ts';
import type { ImageStore } from './storage.ts';

type RouteRow = typeof routes.$inferSelect;

function notFound(): never {
  throw appError('not_found', 'image not found');
}

function workRef(
  db: Database,
  view: { kind: 'work'; workId: string },
  image: Extract<ImageFileInput['image'], { kind: 'portrait' }>,
): ImageFileRef {
  const row = db.select().from(portraitSets).where(eq(portraitSets.id, image.setId)).get();
  if (!row || row.workId !== view.workId) notFound();
  if (row.scope !== 'work' && row.scope !== 'pending') notFound();
  const file = row.slots[image.slot].file;
  if (file === null) notFound();
  return file;
}

function projectionOf(
  db: Database,
  route: RouteRow,
): { projection: StoryProjection; settings: PlaythroughIllustration } | null {
  const playthrough = db.select().from(playthroughs).where(eq(playthroughs.id, route.playthroughId)).get();
  if (!playthrough) return null;
  const parsed = PlaythroughIllustrationSchema.safeParse(playthrough.illustration);
  if (!parsed.success) return null;
  const chain = ancestorChain(db, route.headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return {
    projection: loadProjection(db, { versionId: playthrough.versionId, chain }),
    settings: parsed.data,
  };
}

function routeRef(
  db: Database,
  view: { kind: 'route'; routeId: string },
  image: ImageFileInput['image'],
): ImageFileRef {
  const route = db.select().from(routes).where(eq(routes.id, view.routeId)).get();
  if (!route) notFound();

  if (image.kind === 'illustration') {
    const row = db.select().from(illustrations).where(eq(illustrations.id, image.illustrationId)).get();
    if (!row || row.status !== 'done' || row.file === null) notFound();
    const onRoute = ancestorChain(db, route.headTurnId).some((turn) => turn.id === row.turnId);
    if (!onRoute) notFound();
    return row.file;
  }

  if (image.slot !== 'front') notFound();
  const loaded = projectionOf(db, route);
  if (loaded === null) notFound();
  const portraits = journalPortraits(db, {
    routeId: route.id,
    projection: loaded.projection,
    settings: loaded.settings,
    playthroughId: route.playthroughId,
  });
  const authorized = [...portraits.values()].some((entry) => entry.setId === image.setId);
  if (!authorized) notFound();
  const row = db.select().from(portraitSets).where(eq(portraitSets.id, image.setId)).get();
  if (!row) notFound();
  const file = row.slots.front.file;
  if (file === null) notFound();
  return file;
}

function imageRef(db: Database, input: ImageFileInput): ImageFileRef {
  if (input.view.kind === 'work') {
    if (input.image.kind !== 'portrait') notFound();
    return workRef(db, input.view, input.image);
  }
  return routeRef(db, input.view, input.image);
}

export async function resolveImageFile(db: Database, store: ImageStore, input: ImageFileInput): Promise<File> {
  const ref = imageRef(db, input);
  const bytes = await store.read(ref);
  if (bytes === null) throw appError('image_file_missing', 'image file missing');
  const id = input.image.kind === 'illustration' ? input.image.illustrationId : input.image.setId;
  return new File([bytes], `${id}.${IMAGE_EXTENSION[ref.mime]}`, { type: ref.mime });
}
