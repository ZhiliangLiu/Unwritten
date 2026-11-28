import { randomUUID } from 'node:crypto';
import type { AutoIllustrationTarget } from '@unwritten/contracts';
import type { PlaythroughIllustration } from '../store/illustration-types.ts';
import { illustrations } from '../store/schema.ts';
import type { StoryTx } from '../story/writer.ts';

export function illustrationEnabled(
  settings: PlaythroughIllustration,
  activeTarget: Pick<AutoIllustrationTarget, 'serviceId'> | null,
): boolean {
  return settings.enabled && activeTarget !== null;
}

export function enqueueIllustration(
  tx: StoryTx,
  input: {
    turnId: string;
    playthroughId: string;
    para: number;
    settings: PlaythroughIllustration;
    now: number;
  },
): string {
  const id = randomUUID();
  tx.insert(illustrations)
    .values({
      id,
      turnId: input.turnId,
      playthroughId: input.playthroughId,
      para: input.para,
      formatPreference: {
        aspectPreference: input.settings.aspectPreference,
        resolutionTier: input.settings.resolutionTier,
      },
      status: 'queued',
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
  return id;
}
