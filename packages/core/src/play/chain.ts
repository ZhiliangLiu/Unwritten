import { sql } from 'drizzle-orm';
import type { Database } from '../store/db.ts';
import { turns } from '../store/schema.ts';
import type { StoredAction, StoredOption, StoredScene } from '../store/meta.ts';

export type TurnRow = typeof turns.$inferSelect;

interface RawTurn {
  id: string;
  playthrough_id: string;
  parent_id: string | null;
  depth: number;
  action: string | null;
  prose: string;
  options: string;
  scene: string;
  ending: number;
  status: 'committed' | 'candidate';
  created_at: number;
  request_id: string | null;
  request_attempt: number | null;
}

export function ancestorChain(
  db: Database,
  headTurnId: string,
): Array<TurnRow & { originRequest: { id: string; attempt: number } | null }> {
  const rows = db.all<RawTurn>(sql`
    WITH RECURSIVE path(id, parent_id) AS (
      SELECT id, parent_id FROM turns WHERE id = ${headTurnId}
      UNION ALL
      SELECT t.id, t.parent_id FROM turns t JOIN path p ON t.id = p.parent_id
    )
    SELECT t.*, r.id AS request_id, r.attempts AS request_attempt
    FROM path p
    JOIN turns t ON t.id = p.id
    LEFT JOIN turn_requests r ON r.result_turn_id = t.id
    ORDER BY t.depth
  `);

  return rows.map((row, index) => {
    if (row.depth !== index) throw new Error('turn chain is not contiguous');
    return {
      id: row.id,
      playthroughId: row.playthrough_id,
      parentId: row.parent_id,
      depth: row.depth,
      action: row.action ? (JSON.parse(row.action) as StoredAction) : null,
      prose: row.prose,
      options: JSON.parse(row.options) as StoredOption[],
      scene: JSON.parse(row.scene) as StoredScene,
      ending: row.ending,
      status: row.status,
      createdAt: row.created_at,
      originRequest:
        row.request_id && row.request_attempt !== null ? { id: row.request_id, attempt: row.request_attempt } : null,
    };
  });
}
