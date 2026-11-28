import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type {
  ImageCapabilities,
  ImageSize,
  IllustrationFormat,
  IllustrationStage,
  OutputPreferences,
} from '@unwritten/contracts';
import { LlmRunError } from '../llm/types.ts';
import type { SampleOutcome } from '../log/logger.ts';
import { ImageError } from '../services.ts';
import type { ImageService, LlmService } from '../services.ts';
import type { Database } from '../store/db.ts';
import {
  AttemptDataSchema,
  PlaythroughIllustrationSchema,
  ShotCapabilitySchema,
  type AttemptData,
  type ShotRecord,
} from '../store/illustration-types.ts';
import type { VersionMeta } from '../store/meta.ts';
import { readAnchors } from '../store/meta.ts';
import { illustrations, playthroughs, routes, workVersions } from '../store/schema.ts';
import { sceneMaterials } from '../story/scene-projection.ts';
import { ILLUSTRATION_MAX_REFERENCES } from './constants.ts';
import type { PortraitDeps } from './portraits.ts';
import { pickReferenceFiles, referenceViewsFor, type PickedReference } from './references.ts';
import { composeFinalPrompt, dropReference } from './shot-compose.ts';
import { describeShot, type ShotResult } from './shot.ts';
import { suggestAppearance } from './suggest.ts';
import type { IllustrationRow } from './views.ts';

export interface PipelineDeps extends Omit<PortraitDeps, 'image'> {
  image: PortraitDeps['image'] & Pick<ImageService, 'activeTarget'>;
  llm: Pick<LlmService, 'complete'>;
}

function abortError(): DOMException {
  return new DOMException('illustration attempt is no longer current', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const STAGE_PROGRESS: IllustrationStage[] = ['appearance', 'shot', 'portrait', 'generate', 'save'];

export function firstUnfinishedStage(attempt: AttemptData | null): IllustrationStage {
  if (attempt === null) return 'generate';
  const completed = new Set(attempt.completed);
  return STAGE_PROGRESS.find((stage) => !completed.has(stage)) ?? 'generate';
}

function errorCodeOf(error: unknown): string {
  if (error instanceof ImageError) return error.code;
  if (error instanceof LlmRunError) return error.code;
  return 'internal';
}

function isWakeCode(code: string): boolean {
  return code.startsWith('image_wake') || code.startsWith('image_launcher');
}

interface Target {
  serviceId: string;
  model: string | null;
  background: { endpointId: string; modelId: string };
}

function sameTarget(left: Target, right: Target): boolean {
  return (
    left.serviceId === right.serviceId &&
    left.model === right.model &&
    left.background.endpointId === right.background.endpointId &&
    left.background.modelId === right.background.modelId
  );
}

function availableAspects(capabilities: ImageCapabilities, preference: OutputPreferences): string[] {
  if (preference.resolutionTier === 'default') return capabilities.aspects;
  return capabilities.aspects.filter(
    (aspect) => capabilities.resolutions[aspect]?.[preference.resolutionTier] !== undefined,
  );
}

function sizeFor(
  capabilities: ImageCapabilities,
  aspect: string,
  tier: OutputPreferences['resolutionTier'],
): ImageSize | null {
  if (tier === 'default') return null;
  return capabilities.resolutions[aspect]?.[tier] ?? null;
}

function resolvePreference(
  capabilities: ImageCapabilities,
  preference: OutputPreferences,
): { aspect: string; size: ImageSize | null } | null {
  const aspects = availableAspects(capabilities, preference);
  if (aspects.length === 0) throw new ImageError('image_output_format_unavailable', 'format');
  if (preference.aspectPreference !== 'auto') {
    if (!aspects.includes(preference.aspectPreference)) {
      throw new ImageError('image_output_format_unavailable', 'format');
    }
    return {
      aspect: preference.aspectPreference,
      size: sizeFor(capabilities, preference.aspectPreference, preference.resolutionTier),
    };
  }
  if (aspects.length === 1) {
    return { aspect: aspects[0]!, size: sizeFor(capabilities, aspects[0]!, preference.resolutionTier) };
  }
  return null;
}

function sameCapability(left: ShotRecord['capability'], right: ShotRecord['capability']): boolean {
  return (
    left.maxReferences === right.maxReferences &&
    left.negativePrompt === right.negativePrompt &&
    JSON.stringify([...left.aspects].sort()) === JSON.stringify([...right.aspects].sort())
  );
}

function routeIdOf(db: Database, playthroughId: string): string | null {
  return db.select({ id: routes.id }).from(routes).where(eq(routes.playthroughId, playthroughId)).get()?.id ?? null;
}

function completedWith(attempt: AttemptData, stage: IllustrationStage): IllustrationStage[] {
  if (attempt.completed.includes(stage)) return attempt.completed;
  return [...attempt.completed, stage];
}

export async function runAttempt(deps: PipelineDeps, row: IllustrationRow, signal: AbortSignal): Promise<void> {
  const startedAt = performance.now();
  const illustrationId = row.id;
  const attemptId = row.activeAttemptId;
  const routeId = routeIdOf(deps.db, row.playthroughId);
  let outcome: SampleOutcome = 'interrupted';
  let references = 0;
  let portraitsGenerated = 0;

  if (attemptId === null) return;
  const parsedAttempt = row.attemptData === null ? null : AttemptDataSchema.safeParse(row.attemptData);
  if (parsedAttempt === null || !parsedAttempt.success) return;
  let attempt = parsedAttempt.data;

  const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, row.playthroughId)).get();
  if (!playthrough) return;
  const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
  if (!version) return;
  const parsedSettings = PlaythroughIllustrationSchema.safeParse(playthrough.illustration);
  if (!parsedSettings.success) return;
  let settings = parsedSettings.data;
  const target = deps.image.activeTarget();
  const hasImage = row.file !== null;
  if (!settings.enabled || target === null) return;

  const publishUpdated = (): void => {
    if (routeId !== null) {
      deps.bus.publish({ type: 'illustration.updated', routeId, turnId: row.turnId, illustrationId });
    }
  };

  const assertCurrent = (): void => {
    if (signal.aborted) throw abortError();
    const live = deps.db
      .select({ activeAttemptId: illustrations.activeAttemptId })
      .from(illustrations)
      .where(eq(illustrations.id, illustrationId))
      .get();
    if (!live || live.activeAttemptId !== attemptId) throw abortError();
    const currentPlaythrough = deps.db
      .select({ illustration: playthroughs.illustration })
      .from(playthroughs)
      .where(eq(playthroughs.id, row.playthroughId))
      .get();
    const current = currentPlaythrough
      ? PlaythroughIllustrationSchema.safeParse(currentPlaythrough.illustration)
      : null;
    if (!current?.success || !current.data.enabled) throw abortError();
    const currentTarget = deps.image.activeTarget();
    if (currentTarget === null || !sameTarget(currentTarget, target)) throw abortError();
  };

  const llmGuard = {
    endpointId: target.background.endpointId,
    modelId: target.background.modelId,
    assertCurrent,
  };
  const imageGuard = { model: target.model, assertCurrent };

  const writeAttempt = (next: AttemptData, fields: Partial<typeof illustrations.$inferInsert> = {}): void => {
    assertCurrent();
    attempt = AttemptDataSchema.parse(next);
    const updated = deps.db
      .update(illustrations)
      .set({ attemptData: attempt, updatedAt: Date.now(), ...fields })
      .where(and(eq(illustrations.id, illustrationId), eq(illustrations.activeAttemptId, attemptId)))
      .run();
    if (updated.changes !== 1) throw abortError();
  };

  const markCompleted = (stage: IllustrationStage): void => {
    writeAttempt({ ...attempt, completed: completedWith(attempt, stage) });
  };

  const recordFormat = (format: IllustrationFormat): void => {
    writeAttempt({ ...attempt, format }, hasImage ? {} : { format });
    publishUpdated();
  };

  let stage: IllustrationStage = 'wake';
  const fail = (error: unknown, failedStage: IllustrationStage): void => {
    outcome = 'error';
    const code = errorCodeOf(error);
    const finalStage = isWakeCode(code) ? 'wake' : failedStage;
    const live = deps.db.select().from(illustrations).where(eq(illustrations.id, illustrationId)).get();
    if (!live || live.activeAttemptId !== attemptId) return;
    const now = Date.now();
    if (live.file === null) {
      deps.db
        .update(illustrations)
        .set({
          status: 'failed',
          stage: finalStage,
          error: code,
          activeAttemptId: null,
          updatedAt: now,
        })
        .where(and(eq(illustrations.id, illustrationId), eq(illustrations.activeAttemptId, attemptId)))
        .run();
    } else {
      deps.db
        .update(illustrations)
        .set({ error: code, activeAttemptId: null, attemptData: null, updatedAt: now })
        .where(and(eq(illustrations.id, illustrationId), eq(illustrations.activeAttemptId, attemptId)))
        .run();
    }
    deps.logger.record({
      level: 'warn',
      module: 'illustration',
      workId: version.workId,
      requestId: illustrationId,
      event: 'illustration.failed',
      data: { illustrationId, stage: finalStage, code },
    });
    publishUpdated();
  };

  const cancelNoMaterial = (): void => {
    outcome = 'interrupted';
    const updated = deps.db
      .update(illustrations)
      .set({
        status: 'cancelled',
        stage: null,
        error: null,
        activeAttemptId: null,
        attemptData: null,
        updatedAt: Date.now(),
      })
      .where(and(eq(illustrations.id, illustrationId), eq(illustrations.activeAttemptId, attemptId)))
      .run();
    if (updated.changes !== 1) return;
    deps.logger.record({
      level: 'info',
      module: 'illustration',
      workId: version.workId,
      requestId: illustrationId,
      event: 'illustration.cancelled',
      data: { count: 1, reason: 'no_material' },
    });
    publishUpdated();
  };

  try {
    const preference: OutputPreferences = attempt.formatOverride ?? {
      aspectPreference: row.format?.aspectPreference ?? row.formatPreference.aspectPreference,
      resolutionTier: row.format?.resolutionTier ?? row.formatPreference.resolutionTier,
    };
    const storedFormat = row.format ?? attempt.format;
    const overrideUnchanged =
      attempt.formatOverride !== null &&
      storedFormat !== null &&
      attempt.formatOverride.aspectPreference === storedFormat.aspectPreference &&
      attempt.formatOverride.resolutionTier === storedFormat.resolutionTier;
    const reusableFormat = attempt.formatOverride === null || overrideUnchanged ? storedFormat : null;

    stage = 'shot';
    const cached = deps.image.capabilities(target.serviceId);
    if (cached !== null) {
      if (reusableFormat !== null) {
        deps.image.assertFormat(cached, {
          aspect: reusableFormat.aspectPreference,
          size: reusableFormat.size,
          quality: 'best',
        });
      } else {
        resolvePreference(cached, preference);
      }
    }

    let capabilities: ImageCapabilities;
    try {
      capabilities = await deps.image.prepareGeneration(target.serviceId, {
        manual: attempt.kind !== 'first',
        signal,
        guard: imageGuard,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      fail(error, 'wake');
      return;
    }
    assertCurrent();
    if (!hasImage) {
      deps.db
        .update(illustrations)
        .set({ status: 'running', updatedAt: Date.now() })
        .where(and(eq(illustrations.id, illustrationId), eq(illustrations.activeAttemptId, attemptId)))
        .run();
      publishUpdated();
    }

    stage = 'appearance';
    if (settings.protagonistInFrame && settings.protagonistAppearance === null) {
      const suggestion = await suggestAppearance(
        { db: deps.db, llm: deps.llm },
        { workId: version.workId },
        {
          signal,
          guard: llmGuard,
        },
      );
      assertCurrent();
      deps.db.transaction(
        (tx) => {
          const live = tx.select().from(playthroughs).where(eq(playthroughs.id, row.playthroughId)).get();
          if (!live) throw abortError();
          const parsed = PlaythroughIllustrationSchema.safeParse(live.illustration);
          if (!parsed.success || parsed.data.protagonistAppearance !== null) return;
          tx.update(playthroughs)
            .set({ illustration: { ...parsed.data, protagonistAppearance: suggestion.appearance } })
            .where(eq(playthroughs.id, row.playthroughId))
            .run();
        },
        { behavior: 'immediate' },
      );
      const refreshed = deps.db.select().from(playthroughs).where(eq(playthroughs.id, row.playthroughId)).get();
      const parsed = refreshed ? PlaythroughIllustrationSchema.safeParse(refreshed.illustration) : null;
      if (parsed?.success) settings = parsed.data;
    }
    markCompleted('appearance');

    stage = 'shot';
    const materials = sceneMaterials(deps.db, {
      versionId: playthrough.versionId,
      turnId: row.turnId,
      para: row.para,
      protagonistAppearance: settings.protagonistAppearance,
      protagonistInFrame: settings.protagonistInFrame,
    });
    if (materials.skip) {
      cancelNoMaterial();
      return;
    }

    const capability = ShotCapabilitySchema.parse({
      aspects: capabilities.aspects,
      maxReferences: capabilities.maxReferences,
      negativePrompt: capabilities.negativePrompt,
    });
    const maxReferences = Math.min(ILLUSTRATION_MAX_REFERENCES, capabilities.maxReferences);
    const allowedAspects = availableAspects(capabilities, preference);
    let format: IllustrationFormat | null = null;
    let aspect: string | null = null;
    let size: ImageSize | null = null;
    if (reusableFormat !== null) {
      deps.image.assertFormat(capabilities, {
        aspect: reusableFormat.aspectPreference,
        size: reusableFormat.size,
        quality: 'best',
      });
      format = reusableFormat;
      aspect = reusableFormat.aspectPreference;
      size = reusableFormat.size;
    } else {
      const resolved = resolvePreference(capabilities, preference);
      if (resolved !== null) {
        format = {
          aspectPreference: resolved.aspect,
          resolutionTier: preference.resolutionTier,
          size: resolved.size,
        };
        aspect = resolved.aspect;
        size = resolved.size;
      }
    }
    if (format !== null) recordFormat(format);

    const referenceViews = referenceViewsFor(deps.db, {
      people: materials.people,
      settings,
      playthroughId: row.playthroughId,
      maxReferences,
    });

    let shot: ShotResult | null = null;
    let composedReuse = false;
    const storedRefs = row.refs ?? [];
    const storedPeopleByEntity = new Map(materials.people.map((person) => [person.entityId, person.code]));
    const storedShotRefs = storedRefs.flatMap((ref) => {
      const code = storedPeopleByEntity.get(ref.entityId);
      return code === undefined ? [] : [{ code, view: ref.view }];
    });
    const rowShotReusable =
      attempt.kind === 'reroll' &&
      (attempt.formatOverride === null || overrideUnchanged) &&
      attempt.shot === null &&
      row.shotCapability !== null &&
      row.prompt !== null &&
      row.caption !== null &&
      row.refs !== null &&
      storedShotRefs.length === row.refs.length &&
      sameCapability(row.shotCapability, capability) &&
      (aspect !== null || allowedAspects.length <= 1);
    if (rowShotReusable) {
      shot = {
        prompt: row.prompt!,
        negative: row.negativePrompt,
        caption: row.caption!,
        refs: storedShotRefs,
        aspect: aspect ?? row.format?.aspectPreference ?? '',
        corrections: 0,
      };
      composedReuse = true;
      writeAttempt({
        ...attempt,
        shot: {
          prompt: row.prompt!,
          negativePrompt: row.negativePrompt,
          caption: row.caption!,
          refs: storedRefs,
          capability,
        },
        completed: completedWith(attempt, 'shot'),
      });
    } else if (
      (attempt.formatOverride === null || overrideUnchanged) &&
      attempt.shot !== null &&
      sameCapability(attempt.shot.capability, capability) &&
      (aspect !== null || allowedAspects.length <= 1)
    ) {
      const peopleByEntity = new Map(materials.people.map((person) => [person.entityId, person.code]));
      shot = {
        prompt: attempt.shot.prompt,
        negative: attempt.shot.negativePrompt,
        caption: attempt.shot.caption,
        refs: attempt.shot.refs.flatMap((ref) => {
          const code = peopleByEntity.get(ref.entityId);
          return code === undefined ? [] : [{ code, view: ref.view }];
        }),
        aspect: aspect ?? attempt.shot.capability.aspects[0] ?? '',
        corrections: 0,
      };
      markCompleted('shot');
    } else {
      const described = await describeShot(
        { llm: deps.llm, logger: deps.logger },
        {
          materials,
          language: (version.meta as VersionMeta).narration?.language?.trim() || '跟随背景所用的语言',
          style: settings.style,
          protagonistInFrame: settings.protagonistInFrame,
          aspects: aspect !== null ? [aspect] : allowedAspects,
          fixedAspect: aspect,
          referenceViews,
          maxReferences,
          negativePrompt: capabilities.negativePrompt,
          contentPolicy: readAnchors(version.meta as VersionMeta).contentPolicy,
        },
        { kind: 'illustration', id: illustrationId, attempt: row.attempts + 1, workId: version.workId },
        { signal, guard: llmGuard },
      );
      shot = described;
      if (aspect === null) {
        const chosen = described.aspect;
        const chosenSize = sizeFor(capabilities, chosen, preference.resolutionTier);
        format = { aspectPreference: chosen, resolutionTier: preference.resolutionTier, size: chosenSize };
        deps.image.assertFormat(capabilities, { aspect: chosen, size: chosenSize, quality: 'best' });
        aspect = chosen;
        size = chosenSize;
        recordFormat(format);
      }
      const refs = described.refs.flatMap((ref) => {
        const person = materials.people.find((candidate) => candidate.code === ref.code);
        return person === undefined ? [] : [{ entityId: person.entityId, view: ref.view }];
      });
      writeAttempt({
        ...attempt,
        format,
        shot: {
          prompt: described.prompt,
          negativePrompt: described.negative,
          caption: described.caption,
          refs,
          capability,
        },
        completed: completedWith(attempt, 'shot'),
      });
    }

    if (format === null || aspect === null) throw new ImageError('image_output_format_unavailable', 'format');

    stage = 'portrait';
    const picks = await pickReferenceFiles(deps, {
      refs: shot.refs,
      people: materials.people,
      settings,
      playthroughId: row.playthroughId,
      workId: version.workId,
      serviceId: target.serviceId,
      guard: imageGuard,
      maxReferenceBytes: capabilities.maxReferenceBytes,
      bannedNames: materials.bannedNames,
      signal,
    });
    portraitsGenerated = picks.filter((pick) => 'setId' in pick && pick.generated === true).length;

    let prompt = shot.prompt;
    let shotRefs = shot.refs;
    for (let index = picks.length - 1; index >= 0; index -= 1) {
      const pick = picks[index]!;
      if (!('drop' in pick)) continue;
      const rewritten = dropReference(prompt, shotRefs, index, pick.drop);
      prompt = rewritten.prompt;
      shotRefs = rewritten.refs;
    }

    const selected: PickedReference[] = [];
    for (const pick of picks) if ('setId' in pick) selected.push(pick);
    references = selected.length;
    const referenceFiles = selected.map((pick) => ({ setId: pick.setId, slot: pick.slot, file: pick.file }));
    writeAttempt({ ...attempt, referenceFiles }, {});
    markCompleted('portrait');

    stage = 'generate';
    const referenceBytes = await Promise.all(selected.map((pick) => deps.store.read(pick.file)));
    if (referenceBytes.some((bytes) => bytes === null)) {
      throw new ImageError('image_file_missing', 'final');
    }
    const composed = composedReuse
      ? { prompt, negativePrompt: shot.negative }
      : composeFinalPrompt({
          shot: { ...shot, prompt },
          style: settings.style,
          protagonistInFrame: settings.protagonistInFrame,
          negativePrompt: capabilities.negativePrompt,
        });
    const seed = attempt.kind === 'reroll' ? (attempt.seed ?? randomInt(0, 2 ** 31)) : null;
    writeAttempt({ ...attempt, seed });
    const result = await deps.image.generate({
      serviceId: target.serviceId,
      guard: imageGuard,
      prompt: composed.prompt,
      negativePrompt: composed.negativePrompt,
      references: selected.map((pick, index) => ({
        mime: pick.file.mime,
        bytes: referenceBytes[index]!,
      })),
      aspect,
      size,
      quality: 'best',
      seed,
      signal,
      ref: { workId: version.workId, kind: 'illustration', id: illustrationId },
      manual: attempt.kind !== 'first',
    });

    stage = 'save';
    const staged = await deps.store.stage(result.bytes);
    const refs = shotRefs.flatMap((ref) => {
      const person = materials.people.find((candidate) => candidate.code === ref.code);
      return person === undefined ? [] : [{ entityId: person.entityId, view: ref.view }];
    });
    const now = Date.now();
    await deps.store.commit(
      [staged],
      () => {
        const updated = deps.db
          .update(illustrations)
          .set({
            status: 'done',
            stage: null,
            error: null,
            file: staged.ref,
            caption: shot.caption,
            prompt: composed.prompt,
            negativePrompt: composed.negativePrompt,
            refs,
            referenceFiles,
            shotCapability: capability,
            seed: result.seed,
            serviceId: result.serviceId,
            model: result.model,
            format,
            attempts: row.attempts + 1,
            activeAttemptId: null,
            attemptData: null,
            updatedAt: now,
          })
          .where(and(eq(illustrations.id, illustrationId), eq(illustrations.activeAttemptId, attemptId)))
          .run();
        if (updated.changes !== 1) throw abortError();
      },
      assertCurrent,
    );

    outcome = 'ok';
    publishUpdated();
    deps.logger.record({
      level: 'info',
      module: 'illustration',
      workId: version.workId,
      requestId: illustrationId,
      event: 'illustration.done',
      data: { illustrationId, references, portraitsGenerated, reroll: attempt.kind === 'reroll' },
    });
  } catch (error) {
    if (isAbort(error)) {
      outcome = 'interrupted';
      return;
    }
    fail(error, stage);
  } finally {
    deps.logger.sample({
      metric: 'illustration.total',
      durationMs: performance.now() - startedAt,
      outcome,
      workId: version.workId,
      requestId: illustrationId,
      data: { references, portraitsGenerated },
    });
  }
}
