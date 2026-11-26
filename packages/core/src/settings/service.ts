import { eq } from 'drizzle-orm';
import type { Appearance } from '@unwritten/contracts';
import { AppearanceSchema, DEFAULT_APPEARANCE } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps, SettingsService } from '../services.ts';
import { appSettings } from '../store/schema.ts';

export function createSettingsService(deps: CoreDeps): SettingsService {
  const get = (): Appearance => {
    const row = deps.db.select().from(appSettings).where(eq(appSettings.id, 1)).get();
    if (!row) return { ...DEFAULT_APPEARANCE };
    const parsed = AppearanceSchema.safeParse(row.appearance);
    return parsed.success ? parsed.data : { ...DEFAULT_APPEARANCE };
  };

  return {
    get,
    update(input: Appearance): Appearance {
      const startedAt = performance.now();
      const next = AppearanceSchema.parse(input);
      const current = get();
      if (
        current.appearance === next.appearance &&
        current.proseSize === next.proseSize &&
        current.proseFont === next.proseFont &&
        current.proseLeading === next.proseLeading
      ) {
        deps.logger.sample({
          metric: 'settings.update',
          durationMs: performance.now() - startedAt,
          outcome: 'ok',
        });
        return current;
      }
      try {
        const now = Date.now();
        deps.db.transaction(
          (tx) => {
            tx.insert(appSettings)
              .values({ id: 1, appearance: next, updatedAt: now })
              .onConflictDoUpdate({ target: appSettings.id, set: { appearance: next, updatedAt: now } })
              .run();
          },
          { behavior: 'immediate' },
        );
      } catch (error) {
        deps.logger.sample({
          metric: 'settings.update',
          durationMs: performance.now() - startedAt,
          outcome: 'error',
        });
        throw appError('save', 'settings write failed', null, error);
      }
      deps.bus.publish({ type: 'settings.changed', appearance: next });
      deps.logger.record({
        level: 'info',
        module: 'settings',
        event: 'settings.changed',
        data: {
          appearance: next.appearance,
          proseSize: next.proseSize,
          proseFont: next.proseFont,
          proseLeading: next.proseLeading,
        },
      });
      deps.logger.sample({
        metric: 'settings.update',
        durationMs: performance.now() - startedAt,
        outcome: 'ok',
      });
      return next;
    },
  };
}
