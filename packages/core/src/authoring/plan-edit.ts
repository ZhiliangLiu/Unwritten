import { eq } from 'drizzle-orm';
import type {
  ConfirmPlanInput,
  PlanItem,
  RemovePlanItemInput,
  SaveDraftOutput,
  UpdatePlanItemInput,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps } from '../services.ts';
import type { Database } from '../store/db.ts';
import type { CastSlot, StoredPlan, VersionMeta } from '../store/meta.ts';
import { entities, entityNames, facts, knowledge, stateDefs, workVersions, works } from '../store/schema.ts';
import { readPlan, readSettings } from '../store/plan.ts';
import { clearAuthorSetting } from '../story/copy.ts';
import { checkStateConfig, checkStateValue } from '../story/state.ts';
import { EntityProfileSchema } from '../story/types.ts';

type EditTx = Pick<Database, 'select'>;

function invalidInput(message: string): never {
  throw appError('invalid_input', message);
}

function loadEditableDraft(tx: EditTx, workId: string, baseContentRev: number) {
  const work = tx.select().from(works).where(eq(works.id, workId)).get();
  if (!work) throw appError('not_found', 'work not found');
  if (work.publishedId) throw appError('already_published', 'work is already published');
  const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
  if (!draft) throw appError('not_found', 'draft not found');
  if (draft.contentRev !== baseContentRev) throw appError('stale_revision', 'draft revision is stale');
  const meta = draft.meta as VersionMeta;
  const plan = readPlan(meta);
  if (!plan) throw appError('plan_not_confirmed', 'plan is not ready');
  return { work, draft, meta, plan };
}

function validateItem(item: PlanItem, plan: StoredPlan, meta: VersionMeta): void {
  const entityById = new Map(
    plan.items.flatMap((candidate) => (candidate.kind === 'entity' ? [[candidate.id, candidate] as const] : [])),
  );
  if (item.kind === 'state') {
    const checked = checkStateConfig(item.display, item.config);
    if (!checked.ok) invalidInput(checked.error);
    if (item.initial !== null && item.initial.trim()) {
      const value = checkStateValue({ display: item.display, config: checked.value }, item.initial);
      if (!value.ok) invalidInput(value.error);
    }
  }
  if (item.kind === 'secret') {
    if (item.subjectId !== null && !entityById.has(item.subjectId)) {
      invalidInput('secret subject is not a plan entity');
    }
    for (const knowerId of item.knowerIds) {
      const knower = entityById.get(knowerId);
      if (!knower || knower.entityKind !== 'character') {
        invalidInput('secret knower is not a character');
      }
    }
  }
  if (item.kind === 'entity') {
    if (item.entityKind !== 'character' && item.appearance !== null) {
      invalidInput('appearance is only for characters');
    }
    if (item.role === 'protagonist') {
      const current = plan.items.find((candidate) => candidate.id === item.id);
      if (!current || current.kind !== 'entity' || current.role !== 'protagonist') {
        invalidInput('protagonist cannot be handed over');
      }
    }
    if (readSettings(meta).cast.mode === 'per_run' && item.role === 'cast' && !item.slot) {
      invalidInput('per-run cast needs a slot');
    }
  }
}

export function updatePlanItem(deps: CoreDeps, input: UpdatePlanItemInput): SaveDraftOutput {
  const result = deps.db.transaction(
    (tx) => {
      const { draft, meta, plan } = loadEditableDraft(tx, input.workId, input.baseContentRev);
      const current = plan.items.find((item) => item.id === input.item.id);
      if (!current || current.kind !== input.item.kind) invalidInput('plan item does not match');
      validateItem(input.item, plan, meta);
      const items = plan.items.map((item) =>
        item.id === input.item.id ? { ...input.item, source: 'author' as const } : item,
      );
      const now = Date.now();
      const contentRev = draft.contentRev + 1;
      tx.update(workVersions)
        .set({ meta: { ...meta, plan: { ...plan, items } }, contentRev, updatedAt: now })
        .where(eq(workVersions.id, draft.id))
        .run();
      tx.update(works).set({ updatedAt: now }).where(eq(works.id, input.workId)).run();
      return { contentRev, kind: input.item.kind };
    },
    { behavior: 'immediate' },
  );
  deps.bus.publish({ type: 'works.changed', workId: input.workId });
  deps.logger.record({
    level: 'info',
    module: 'authoring',
    event: 'plan.item.updated',
    workId: input.workId,
    data: { kind: result.kind },
  });
  return { contentRev: result.contentRev };
}

export function removePlanItem(deps: CoreDeps, input: RemovePlanItemInput): SaveDraftOutput {
  const result = deps.db.transaction(
    (tx) => {
      const { draft, meta, plan } = loadEditableDraft(tx, input.workId, input.baseContentRev);
      const current = plan.items.find((item) => item.id === input.itemId);
      if (!current) invalidInput('plan item not found');
      if (current.kind === 'entity' && current.role === 'protagonist') {
        invalidInput('protagonist cannot be removed');
      }
      const items = plan.items
        .filter((item) => item.id !== input.itemId)
        .map((item) => {
          if (item.kind !== 'secret') return item;
          return {
            ...item,
            subjectId: item.subjectId === input.itemId ? null : item.subjectId,
            knowerIds: item.knowerIds.filter((id) => id !== input.itemId),
          };
        });
      const now = Date.now();
      const contentRev = draft.contentRev + 1;
      tx.update(workVersions)
        .set({ meta: { ...meta, plan: { ...plan, items } }, contentRev, updatedAt: now })
        .where(eq(workVersions.id, draft.id))
        .run();
      tx.update(works).set({ updatedAt: now }).where(eq(works.id, input.workId)).run();
      return { contentRev, kind: current.kind };
    },
    { behavior: 'immediate' },
  );
  deps.bus.publish({ type: 'works.changed', workId: input.workId });
  deps.logger.record({
    level: 'info',
    module: 'authoring',
    event: 'plan.item.removed',
    workId: input.workId,
    data: { kind: result.kind },
  });
  return { contentRev: result.contentRev };
}

export function confirmPlan(deps: CoreDeps, input: ConfirmPlanInput): SaveDraftOutput {
  const startedAt = performance.now();
  const result = deps.db.transaction(
    (tx) => {
      const { draft, meta, plan } = loadEditableDraft(tx, input.workId, input.baseContentRev);
      const castMode = readSettings(meta).cast.mode;
      const entityItems = plan.items.filter((item): item is PlanItem & { kind: 'entity' } => item.kind === 'entity');
      const protagonists = entityItems.filter((item) => item.role === 'protagonist');
      if (protagonists.length !== 1) invalidInput('plan needs exactly one protagonist');
      const protagonist = protagonists[0]!;
      if (castMode === 'per_run' && entityItems.some((item) => item.role === 'cast' && !item.slot)) {
        invalidInput('per-run cast needs a slot');
      }
      const writtenEntities = entityItems.filter(
        (item) => item.role === 'protagonist' || item.role === 'other' || castMode === 'fixed',
      );
      const writtenIds = new Set(writtenEntities.map((item) => item.id));
      const secretItems = plan.items.filter((item): item is PlanItem & { kind: 'secret' } => item.kind === 'secret');
      const stateItems = plan.items.filter((item): item is PlanItem & { kind: 'state' } => item.kind === 'state');
      const sceneItems = plan.items.filter((item): item is PlanItem & { kind: 'scene' } => item.kind === 'scene');
      const endingItem = plan.items.find((item): item is PlanItem & { kind: 'ending' } => item.kind === 'ending');

      const nextRev = draft.contentRev + 1;
      clearAuthorSetting(tx, draft.id);

      tx.insert(entities)
        .values(
          writtenEntities.map((item) => ({
            versionId: draft.id,
            id: item.id,
            kind: item.entityKind,
            name: item.name,
            profile: EntityProfileSchema.parse({
              text: item.profile,
              ...(item.appearance ? { appearance: item.appearance } : {}),
            }),
            isProtagonist: item.role === 'protagonist' ? 1 : 0,
            originTurnId: null,
          })),
        )
        .run();

      const nameRows = new Map<string, typeof entityNames.$inferInsert>();
      const addName = (entityId: string, name: string, holderId: string) => {
        const key = `${entityId}|${name}|${holderId}`;
        if (!nameRows.has(key)) {
          nameRows.set(key, {
            versionId: draft.id,
            entityId,
            name,
            holderId,
            originTurnId: null,
            sourcePara: null,
          });
        }
      };
      addName(protagonist.id, protagonist.name, protagonist.id);
      for (const item of writtenEntities) {
        if (item.knownAs) addName(item.id, item.knownAs, protagonist.id);
      }
      if (nameRows.size)
        tx.insert(entityNames)
          .values([...nameRows.values()])
          .run();

      if (secretItems.length) {
        tx.insert(facts)
          .values(
            secretItems.map((item) => ({
              versionId: draft.id,
              id: item.id,
              originTurnId: null,
              sourcePara: null,
              kind: 'secret' as const,
              subjectId: item.subjectId !== null && writtenIds.has(item.subjectId) ? item.subjectId : null,
              objectId: null,
              key: null,
              statement: item.statement,
              data: { title: item.title, reveal: item.reveal },
            })),
          )
          .run();
      }

      const knowledgeRows = new Map<string, typeof knowledge.$inferInsert>();
      for (const item of secretItems) {
        for (const holderId of item.knowerIds) {
          if (!writtenIds.has(holderId)) continue;
          const key = `${item.id}|${holderId}`;
          if (!knowledgeRows.has(key)) {
            knowledgeRows.set(key, {
              versionId: draft.id,
              factId: item.id,
              holderId,
              level: 'confirmed',
              perceivedStatement: null,
              viaId: null,
              originTurnId: null,
              sourcePara: null,
            });
          }
        }
      }
      if (knowledgeRows.size)
        tx.insert(knowledge)
          .values([...knowledgeRows.values()])
          .run();

      if (stateItems.length) {
        tx.insert(stateDefs)
          .values(
            stateItems.map((item) => ({
              versionId: draft.id,
              id: item.id,
              key: item.key,
              label: item.label,
              display: item.display,
              config: item.config,
              hidden: item.hidden ? 1 : 0,
              reveal: item.reveal || null,
              originTurnId: null,
            })),
          )
          .run();
      }

      const castSlots: CastSlot[] =
        castMode === 'per_run'
          ? entityItems.flatMap((item) =>
              item.role === 'cast' && item.slot
                ? [{ id: item.id, role: item.slot.role, encounter: item.slot.encounter }]
                : [],
            )
          : [];
      const nextMeta: VersionMeta = {
        ...meta,
        plan: { ...plan, confirmedRev: nextRev },
        keyScenes: sceneItems.map((item) => ({
          id: item.id,
          condition: item.condition,
          outcome: item.outcome,
          once: item.once,
        })),
        wizardStep: 'opening',
      };
      if (endingItem) nextMeta.ending = endingItem.text;
      else delete nextMeta.ending;
      if (castSlots.length) nextMeta.castSlots = castSlots;
      else delete nextMeta.castSlots;

      tx.update(workVersions)
        .set({ meta: nextMeta, contentRev: nextRev, updatedAt: Date.now() })
        .where(eq(workVersions.id, draft.id))
        .run();

      return {
        contentRev: nextRev,
        counts: {
          entities: writtenEntities.length,
          secrets: secretItems.length,
          states: stateItems.length,
          scenes: sceneItems.length,
        },
        castMode,
      };
    },
    { behavior: 'immediate' },
  );

  deps.bus.publish({ type: 'works.changed', workId: input.workId });
  deps.logger.record({
    level: 'info',
    module: 'authoring',
    event: 'plan.confirmed',
    workId: input.workId,
    data: { ...result.counts, castMode: result.castMode },
  });
  deps.logger.sample({
    metric: 'plan.confirm',
    durationMs: performance.now() - startedAt,
    outcome: 'ok',
    workId: input.workId,
    data: result.counts,
  });
  return { contentRev: result.contentRev };
}
