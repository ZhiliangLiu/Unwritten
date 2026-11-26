import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from './db.ts';
import { PROTAGONIST_FALLBACK_NAME } from '../story/types.ts';
import { indexTurnProse } from './prose-index.ts';

export interface BackfillResult {
  protagonists: number;
  ftsTurns: number;
}

export function backfillStory(db: Database): BackfillResult {
  return db.transaction(
    (tx) => {
      const versionRows = tx.all<{ version_id: string; work_id: string }>(
        sql`select v.id as version_id, v.work_id
            from work_versions v
            where exists (select 1 from playthroughs t where t.version_id = v.id)
              and not exists (
                select 1 from entities e
                where e.version_id = v.id and e.is_protagonist = 1
              )`,
      );
      const protagonistByWork = new Map<string, string>();
      for (const row of versionRows) {
        const protagonistId = protagonistByWork.get(row.work_id) ?? randomUUID();
        protagonistByWork.set(row.work_id, protagonistId);
        const profile = JSON.stringify({ text: '' });
        tx.run(
          sql`insert into entities
              (version_id, id, kind, name, profile, is_protagonist, origin_turn_id)
              values (${row.version_id}, ${protagonistId}, 'character', ${PROTAGONIST_FALLBACK_NAME}, ${profile}, 1, null)`,
        );
        tx.run(
          sql`insert into entity_names
              (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
              values (${row.version_id}, ${protagonistId}, ${PROTAGONIST_FALLBACK_NAME}, ${protagonistId}, null, null)`,
        );
      }

      const missingTurns = tx.all<{ id: string; prose: string }>(
        sql`select id, prose from turns where id not in (select distinct turn_id from prose_fts)`,
      );
      for (const turn of missingTurns) indexTurnProse(tx, turn.id, turn.prose);

      return { protagonists: versionRows.length, ftsTurns: missingTurns.length };
    },
    { behavior: 'immediate' },
  );
}
