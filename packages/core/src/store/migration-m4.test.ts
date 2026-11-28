import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { DEFAULT_APPEARANCE, DEFAULT_ILLUSTRATION_STYLE } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ILLUSTRATION_SETTINGS,
  EMPTY_PORTRAIT_SLOTS,
  IllustrationSettingsSchema,
  PlaythroughIllustrationSchema,
  TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
} from './illustration-types.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';

const migrationsDir = fileURLToPath(new URL('./migrations/', import.meta.url));
const previousMigration = '20261127150929_open_exodus';
const appearance = JSON.stringify(DEFAULT_APPEARANCE);
const style = JSON.stringify(DEFAULT_ILLUSTRATION_STYLE);
const slots = JSON.stringify(EMPTY_PORTRAIT_SLOTS);

interface Opened {
  client: DatabaseSync;
  db: NodeSQLiteDatabase;
}

function open(file: string): Opened {
  const client = new DatabaseSync(file);
  client.exec('PRAGMA foreign_keys = ON');
  return { client, db: drizzle({ client }) };
}

function copyPreviousMigrations(target: string): void {
  mkdirSync(target);
  for (const name of readdirSync(migrationsDir)) {
    if (name > previousMigration) continue;
    cpSync(join(migrationsDir, name), join(target, name), { recursive: true });
  }
}

function seedOldDatabase(db: NodeSQLiteDatabase): void {
  db.run(sql`insert into works (id, draft_id, created_at, updated_at) values ('work-1', 'version-1', 1, 1)`);
  db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
        values ('version-1', 'work-1', 'draft', 0, '{"background":""}', 1, 1)`,
  );
  db.run(sql`insert into playthroughs (id, version_id, kind, created_at) values ('play-1', 'version-1', 'play', 1)`);
  db.run(
    sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
        values ('turn-1', 'play-1', 0, '开场', '[]', '{"place":"","time":"","present":[]}', 'committed', 1)`,
  );
  db.run(
    sql`insert into entities (version_id, id, kind, name, profile, origin_turn_id)
        values ('version-1', 'entity-1', 'character', '守夜人', '{"text":""}', 'turn-1')`,
  );
  db.run(sql`insert into app_settings (id, appearance, updated_at) values (1, ${appearance}, 1)`);
}

function insertPortraitSet(
  db: NodeSQLiteDatabase,
  row: {
    id: string;
    scope: string;
    state: string;
    playthroughId: string | null;
    appearanceFactId: string | null;
  },
): void {
  db.run(
    sql`insert into portrait_sets
        (id, work_id, scope, playthrough_id, entity_id, appearance_fact_id, appearance_hash, appearance,
         style, state, draft_rev, slots, created_at, updated_at)
        values (${row.id}, 'work-1', ${row.scope}, ${row.playthroughId}, 'entity-1', ${row.appearanceFactId},
                'hash-1', '形象原文', ${style}, ${row.state}, 0, ${slots}, 1, 1)`,
  );
}

function driverMessage(run: () => void): string {
  try {
    run();
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    return cause instanceof Error ? cause.message : String(error);
  }
  throw new Error('expected the insert to fail');
}

describe('milestone 4 migration', () => {
  it('旧库升级后补齐插图设置、标记列和三张新表', () => {
    const temp = makeTempDataDir();
    const previousFolder = join(temp.dir, 'previous-migrations');
    try {
      copyPreviousMigrations(previousFolder);
      const opened = open(join(temp.dir, 'library.db'));
      try {
        migrate(opened.db, { migrationsFolder: previousFolder });
        seedOldDatabase(opened.db);
        migrate(opened.db, { migrationsFolder: migrationsDir });

        const playthrough = opened.db.get<{ illustration: string }>(
          sql`select illustration from playthroughs where id = 'play-1'`,
        );
        expect(PlaythroughIllustrationSchema.parse(JSON.parse(playthrough?.illustration ?? ''))).toEqual(
          TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
        );

        const turn = opened.db.get<{ illustrate_para: number | null }>(
          sql`select illustrate_para from turns where id = 'turn-1'`,
        );
        expect(turn?.illustrate_para).toBeNull();

        const entity = opened.db.get<{ source_para: number | null; origin_turn_id: string | null }>(
          sql`select source_para, origin_turn_id from entities where id = 'entity-1'`,
        );
        expect(entity).toEqual({ source_para: null, origin_turn_id: 'turn-1' });

        const settings = opened.db.get<{ illustration: string }>(
          sql`select illustration from app_settings where id = 1`,
        );
        expect(IllustrationSettingsSchema.parse(JSON.parse(settings?.illustration ?? ''))).toEqual(
          DEFAULT_ILLUSTRATION_SETTINGS,
        );

        const names = opened.db
          .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
          .map((row) => row.name);
        expect(names).toEqual(expect.arrayContaining(['illustrations', 'portrait_sets', 'image_calls']));
      } finally {
        opened.client.close();
      }
    } finally {
      temp.cleanup();
    }
  });

  it('参考组的部分唯一索引和范围 CHECK 生效', () => {
    const temp = makeTempDataDir();
    try {
      const opened = open(join(temp.dir, 'library.db'));
      try {
        migrate(opened.db, { migrationsFolder: migrationsDir });
        seedOldDatabase(opened.db);

        insertPortraitSet(opened.db, {
          id: 'set-1',
          scope: 'work',
          state: 'active',
          playthroughId: null,
          appearanceFactId: null,
        });
        expect(
          driverMessage(() =>
            insertPortraitSet(opened.db, {
              id: 'set-2',
              scope: 'work',
              state: 'active',
              playthroughId: null,
              appearanceFactId: null,
            }),
          ),
        ).toMatch(/UNIQUE constraint failed/u);
        expect(() =>
          insertPortraitSet(opened.db, {
            id: 'set-3',
            scope: 'work',
            state: 'retired',
            playthroughId: null,
            appearanceFactId: null,
          }),
        ).not.toThrow();

        expect(
          driverMessage(() =>
            insertPortraitSet(opened.db, {
              id: 'set-4',
              scope: 'playthrough',
              state: 'draft',
              playthroughId: null,
              appearanceFactId: null,
            }),
          ),
        ).toMatch(/CHECK constraint failed/u);
      } finally {
        opened.client.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});
