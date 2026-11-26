import { sql } from 'drizzle-orm';
import type { Database } from '../store/db.ts';
import { STORY_LIMITS, type StoryProjection } from './types.ts';

export interface SearchHit {
  turnId: string;
  depth: number;
  para: number;
  snippet: string;
}

function snippet(body: string, query: string): string {
  const at = body.indexOf(query);
  if (at < 0) return body;
  const start = Math.max(0, at - STORY_LIMITS.searchContextChars);
  const end = Math.min(body.length, at + query.length + STORY_LIMITS.searchContextChars);
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

export function searchStory(db: Database, p: StoryProjection, query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const depthOf = new Map(p.chain.map((turn) => [turn.id, turn.depth]));
  const hits: SearchHit[] = [];
  if (Array.from(q).length >= 3) {
    const phrase = `"${q.replaceAll('"', '""')}"`;
    const rows = db.all<{ turn_id: string; para: number; body: string }>(
      sql`select turn_id, para, body from prose_fts where prose_fts match ${phrase}`,
    );
    for (const row of rows) {
      const depth = depthOf.get(row.turn_id);
      if (depth === undefined) continue;
      hits.push({ turnId: row.turn_id, depth, para: row.para, snippet: snippet(row.body, q) });
    }
  } else {
    for (const turn of p.chain) {
      turn.paragraphs.forEach((body, index) => {
        if (body.includes(q)) {
          hits.push({ turnId: turn.id, depth: turn.depth, para: index + 1, snippet: snippet(body, q) });
        }
      });
    }
  }
  return hits
    .sort((left, right) => right.depth - left.depth || left.para - right.para)
    .slice(0, STORY_LIMITS.searchMaxHits);
}
