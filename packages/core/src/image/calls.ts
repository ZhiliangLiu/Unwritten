import { randomUUID } from 'node:crypto';
import { eq, gte, max, sql } from 'drizzle-orm';
import type { ImageUsageSummary } from '@unwritten/contracts';
import type { Database } from '../store/db.ts';
import { imageCalls } from '../store/schema.ts';

const DAY_MS = 86_400_000;
export const IMAGE_CALL_RETENTION_DAYS = 90;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

export interface ImageCallRecord {
  serviceId: string;
  protocol: 'unwritten-image' | 'openai-images';
  model: string | null;
  workId: string | null;
  refKind: 'illustration' | 'portrait' | 'test';
  refId: string | null;
  quality: 'fast' | 'best';
  referenceCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  status: 'ok' | 'error' | 'aborted';
  error: string | null;
  createdAt: number;
}

export interface ImageUsageEntry {
  id: string;
  name: string;
}

interface UsageWindow {
  images: number;
  inputTokens: number;
  outputTokens: number;
}

function emptyWindow(): UsageWindow {
  return { images: 0, inputTokens: 0, outputTokens: 0 };
}

function addToWindow(
  window: UsageWindow,
  row: { status: string; inputTokens: number | null; outputTokens: number | null },
): void {
  if (row.status === 'ok') window.images += 1;
  window.inputTokens += row.inputTokens ?? 0;
  window.outputTokens += row.outputTokens ?? 0;
}

export function recordCall(db: Database, row: ImageCallRecord): string {
  const id = randomUUID();
  db.insert(imageCalls)
    .values({ id, ...row })
    .run();
  return id;
}

export function usageSummary(db: Database, entries: readonly ImageUsageEntry[], now: number): ImageUsageSummary {
  const rows = db
    .select({
      serviceId: imageCalls.serviceId,
      status: imageCalls.status,
      inputTokens: imageCalls.inputTokens,
      outputTokens: imageCalls.outputTokens,
      createdAt: imageCalls.createdAt,
    })
    .from(imageCalls)
    .where(gte(imageCalls.createdAt, now - MONTH_DAYS * DAY_MS))
    .all();

  const groups = new Map<string, { last7Days: UsageWindow; last30Days: UsageWindow }>();
  for (const row of rows) {
    let group = groups.get(row.serviceId);
    if (group === undefined) {
      group = { last7Days: emptyWindow(), last30Days: emptyWindow() };
      groups.set(row.serviceId, group);
    }
    addToWindow(group.last30Days, row);
    if (row.createdAt >= now - WEEK_DAYS * DAY_MS) addToWindow(group.last7Days, row);
  }

  const names = new Map(entries.map((entry) => [entry.id, entry.name]));
  return {
    services: [...groups.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([serviceId, group]) => ({
        serviceId,
        name: names.get(serviceId) ?? null,
        last7Days: group.last7Days,
        last30Days: group.last30Days,
      })),
  };
}

export function pruneCalls(db: Database, now: number): number {
  const cutoff = now - IMAGE_CALL_RETENTION_DAYS * DAY_MS;
  const result = db.run(sql`delete from image_calls where created_at < ${cutoff}`);
  return Number(result.changes ?? 0);
}

export function lastSuccessAt(db: Database): Map<string, number> {
  const rows = db
    .select({ serviceId: imageCalls.serviceId, at: max(imageCalls.createdAt) })
    .from(imageCalls)
    .where(eq(imageCalls.status, 'ok'))
    .groupBy(imageCalls.serviceId)
    .all();
  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.at !== null) result.set(row.serviceId, row.at);
  }
  return result;
}
