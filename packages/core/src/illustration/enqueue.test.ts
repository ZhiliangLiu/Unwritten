import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlaythroughIllustrationSchema, TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION } from '../store/illustration-types.ts';
import { openDatabase } from '../store/db.ts';
import { illustrations } from '../store/schema.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { enqueueIllustration, illustrationEnabled } from './enqueue.ts';

const settings = PlaythroughIllustrationSchema.parse({
  ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
  enabled: true,
  aspectPreference: '3:2',
  resolutionTier: '720',
});

describe('illustrationEnabled', () => {
  it('本局开启且有已确认接收方时才为真', () => {
    expect(illustrationEnabled(settings, { serviceId: 'image-a' })).toBe(true);
    expect(illustrationEnabled(settings, null)).toBe(false);
    expect(illustrationEnabled({ ...settings, enabled: false }, { serviceId: 'image-a' })).toBe(false);
  });
});

describe('enqueueIllustration', () => {
  it('写入排队记录，保留本局的比例和档位偏好', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedLighthouseTown(opened.db);
      const now = 1_700_000_000_000;
      const id = opened.db.transaction(
        (tx) =>
          enqueueIllustration(tx, {
            turnId: seeded.headTurnId,
            playthroughId: seeded.playthroughId,
            para: 2,
            settings,
            now,
          }),
        { behavior: 'immediate' },
      );
      const stored = opened.db.select().from(illustrations).get()!;
      expect(stored.id).toBe(id);
      expect(stored.turnId).toBe(seeded.headTurnId);
      expect(stored.playthroughId).toBe(seeded.playthroughId);
      expect(stored.para).toBe(2);
      expect(stored.formatPreference).toEqual({ aspectPreference: '3:2', resolutionTier: '720' });
      expect(stored.status).toBe('queued');
      expect(stored.attempts).toBe(0);
      expect(stored.activeAttemptId).toBeNull();
      expect(stored.createdAt).toBe(now);
      expect(stored.updatedAt).toBe(now);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
