import type { SummaryService } from '../services.ts';

export interface RecordingSummary extends SummaryService {
  enqueued: Array<{ turnId: string; routeId: string }>;
}

export function createRecordingSummary(): RecordingSummary {
  const enqueued: Array<{ turnId: string; routeId: string }> = [];
  return {
    enqueued,
    enqueue(turnId, routeId) {
      enqueued.push({ turnId, routeId });
    },
    backfill() {
      return 0;
    },
    async whenIdle() {},
  };
}
