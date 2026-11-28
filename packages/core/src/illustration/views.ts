import type { IllustrationView } from '@unwritten/contracts';
import { AttemptDataSchema } from '../store/illustration-types.ts';
import type { illustrations } from '../store/schema.ts';

export type IllustrationRow = typeof illustrations.$inferSelect;

function errorCodeOf(row: IllustrationRow): IllustrationView['error'] {
  return row.error === null ? null : (row.error as NonNullable<IllustrationView['error']>);
}

export function illustrationView(row: IllustrationRow): IllustrationView {
  const parsed = row.attemptData === null ? null : AttemptDataSchema.safeParse(row.attemptData);
  const attempt = parsed?.success === true ? parsed.data : null;
  const format = row.file !== null ? row.format : (attempt?.format ?? row.format);
  const queuedFormat =
    format === null && row.formatPreference.aspectPreference !== 'auto'
      ? {
          aspectPreference: row.formatPreference.aspectPreference,
          resolutionTier: row.formatPreference.resolutionTier,
          size: null,
        }
      : null;

  return {
    id: row.id,
    updatedAt: row.updatedAt,
    status: row.status,
    rerolling: row.status === 'done' && row.activeAttemptId !== null,
    para: row.para,
    format: format ?? queuedFormat,
    image: row.file === null ? null : { width: row.file.width, height: row.file.height },
    caption: row.caption,
    error: errorCodeOf(row),
    stage: row.stage,
    serviceId: row.file !== null ? row.serviceId : (attempt?.serviceId ?? row.serviceId),
  };
}
