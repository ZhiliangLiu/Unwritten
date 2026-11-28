import { PORTRAIT_SLOTS, type PortraitSetView } from '@unwritten/contracts';
import {
  EMPTY_PORTRAIT_SLOTS,
  EMPTY_PORTRAIT_TASKS,
  PortraitSlotsStoredSchema,
  PortraitTasksSchema,
} from '../store/illustration-types.ts';
import type { portraitSets } from '../store/schema.ts';

export function toView(row: typeof portraitSets.$inferSelect): PortraitSetView {
  const parsedSlots = PortraitSlotsStoredSchema.safeParse(row.slots);
  const parsedTasks = row.task === null ? null : PortraitTasksSchema.safeParse(row.task);
  const slots = parsedSlots.success ? parsedSlots.data : EMPTY_PORTRAIT_SLOTS;
  const tasks = parsedTasks?.success === true ? parsedTasks.data : EMPTY_PORTRAIT_TASKS;

  return {
    id: row.id,
    workId: row.workId,
    scope: row.scope,
    entityId: row.entityId,
    state: row.state,
    draftRev: row.draftRev,
    appearance: row.appearance,
    slots: PORTRAIT_SLOTS.map((slot) => {
      const stored = slots[slot];
      const task = tasks[slot];
      return {
        slot,
        image: stored.file === null ? null : { width: stored.file.width, height: stored.file.height },
        source: stored.source,
        needsReview: stored.needsReview,
        task: task === null ? null : { status: task.status, error: task.error },
      };
    }),
    updatedAt: row.updatedAt,
  };
}
