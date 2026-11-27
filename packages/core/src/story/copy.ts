import { sql } from 'drizzle-orm';
import type { Database } from '../store/db.ts';

export function copyAuthorSetting(
  tx: Pick<Database, 'run'>,
  input: { fromVersionId: string; toVersionId: string },
): void {
  tx.run(
    sql`insert into entities (version_id, id, kind, name, profile, is_protagonist, cast_slot, origin_turn_id, rev) select ${input.toVersionId}, id, kind, name, profile, is_protagonist, cast_slot, origin_turn_id, rev from entities where version_id = ${input.fromVersionId} and origin_turn_id is null`,
  );
  tx.run(
    sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para) select ${input.toVersionId}, entity_id, name, holder_id, origin_turn_id, source_para from entity_names where version_id = ${input.fromVersionId} and origin_turn_id is null`,
  );
  tx.run(
    sql`insert into facts (version_id, id, origin_turn_id, source_para, kind, subject_id, object_id, key, statement, data, rev) select ${input.toVersionId}, id, origin_turn_id, source_para, kind, subject_id, object_id, key, statement, data, rev from facts where version_id = ${input.fromVersionId} and origin_turn_id is null`,
  );
  tx.run(
    sql`insert into knowledge (version_id, fact_id, holder_id, level, perceived_statement, via_id, origin_turn_id, source_para) select ${input.toVersionId}, fact_id, holder_id, level, perceived_statement, via_id, origin_turn_id, source_para from knowledge where version_id = ${input.fromVersionId} and origin_turn_id is null`,
  );
  tx.run(
    sql`insert into state_defs (version_id, id, key, label, display, config, hidden, reveal, origin_turn_id, rev) select ${input.toVersionId}, id, key, label, display, config, hidden, reveal, origin_turn_id, rev from state_defs where version_id = ${input.fromVersionId} and origin_turn_id is null`,
  );
}

export function clearAuthorSetting(tx: Pick<Database, 'run'>, versionId: string): void {
  tx.run(sql`delete from knowledge where version_id = ${versionId} and origin_turn_id is null`);
  tx.run(sql`delete from entity_names where version_id = ${versionId} and origin_turn_id is null`);
  tx.run(sql`delete from facts where version_id = ${versionId} and origin_turn_id is null`);
  tx.run(sql`delete from state_defs where version_id = ${versionId} and origin_turn_id is null`);
  tx.run(sql`delete from entities where version_id = ${versionId} and origin_turn_id is null`);
}
