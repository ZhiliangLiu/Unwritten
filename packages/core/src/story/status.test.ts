import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, type SeededStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { loadProjection } from './projection.ts';
import { buildStatusView } from './status.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function projectionAt(db: Database, versionId: string, headTurnId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId, chain });
}

function viewAt(db: Database, seeded: SeededStory, headTurnId: string) {
  return buildStatusView(projectionAt(db, seeded.versionId, headTurnId), seeded.routeId);
}

function appendTurn(db: Database, seeded: SeededStory): string {
  const id = randomUUID();
  db.run(
    sql`insert into turns (id, playthrough_id, parent_id, depth, prose, options, scene, status, created_at)
        values (${id}, ${seeded.playthroughId}, ${seeded.headTurnId}, 3, '又过了一天。', '[]',
                '{"place":"码头","time":"夜里","present":[],"presentIds":[]}', 'committed', ${Date.now()})`,
  );
  return id;
}

describe('buildStatusView', () => {
  it('幕后栏目和隐藏中的栏目不出现', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const view = viewAt(opened.db, seeded, seeded.turnIds[0] ?? '');
      const ids = view.columns.map((column) => column.id);
      expect(ids).toContain(seeded.ids['state:潮位']);
      expect(ids).toContain(seeded.ids['state:旧信']);
      expect(ids).not.toContain(seeded.ids['state:信任']);
      expect(ids).not.toContain(seeded.ids['state:真名']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('阶段栏目只给已到达的阶段名', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const view = viewAt(opened.db, seeded, seeded.turnIds[1] ?? '');
      const column = view.columns.find((candidate) => candidate.id === seeded.ids['state:信任']);
      expect(column?.value.display).toBe('stage');
      if (column?.value.display === 'stage') {
        expect(column.value.stage).toBe('相识');
        expect(column.value.step).toBe(2);
        expect(column.value.total).toBe(4);
      }
      expect(JSON.stringify(column?.value)).not.toContain('信任');
      expect(JSON.stringify(column?.value)).not.toContain('决裂');
      expect(JSON.stringify(view)).not.toContain('决裂');
      expect(JSON.stringify(view).split('信任')).toHaveLength(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('数字栏目标出增减', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      opened.db.run(
        sql`insert into state_values (version_id, turn_id, state_def_id, value, visible, closed)
            values (${seeded.versionId}, ${seeded.turnIds[1]}, ${seeded.ids['state:潮位']}, '5', 1, 0)`,
      );
      opened.db.run(
        sql`insert into state_values (version_id, turn_id, state_def_id, value, visible, closed)
            values (${seeded.versionId}, ${seeded.turnIds[2]}, ${seeded.ids['state:潮位']}, '3', 1, 0)`,
      );
      const view = viewAt(opened.db, seeded, seeded.headTurnId);
      const column = view.columns.find((candidate) => candidate.id === seeded.ids['state:潮位']);
      expect(column?.changed).toBe(true);
      expect(column?.value.display).toBe('number');
      if (column?.value.display === 'number') {
        expect(column.value.value).toBe(3);
        expect(column.value.previous).toBe(5);
        expect(column.value.unit).toBe('米');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('第一次显示的栏目标为新', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const view = viewAt(opened.db, seeded, seeded.turnIds[1] ?? '');
      const column = view.columns.find((candidate) => candidate.id === seeded.ids['state:信任']);
      expect(column?.isNew).toBe(true);
      expect(column?.changed).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('来历不含隐藏期间的值', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      opened.db.run(
        sql`update state_values set visible = 0
            where turn_id = ${seeded.turnIds[1]} and state_def_id = ${seeded.ids['state:信任']}`,
      );
      opened.db.run(
        sql`insert into state_values (version_id, turn_id, state_def_id, value, visible, closed)
            values (${seeded.versionId}, ${seeded.turnIds[2]}, ${seeded.ids['state:信任']}, '相识', 0, 0)`,
      );
      const turnId = appendTurn(opened.db, seeded);
      opened.db.run(
        sql`insert into state_values (version_id, turn_id, state_def_id, value, visible, closed)
            values (${seeded.versionId}, ${turnId}, ${seeded.ids['state:信任']}, '信任', 1, 0)`,
      );
      const view = viewAt(opened.db, seeded, turnId);
      const column = view.columns.find((candidate) => candidate.id === seeded.ids['state:信任']);
      expect(column?.history).toHaveLength(1);
      expect(column?.history[0]?.depth).toBe(3);
      expect(column?.history[0]?.text).toBe('信任');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('了结的栏目单独给出', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      opened.db.run(
        sql`insert into state_values (version_id, turn_id, state_def_id, value, visible, closed)
            values (${seeded.versionId}, ${seeded.turnIds[2]}, ${seeded.ids['state:潮位']}, '3', 1, 1)`,
      );
      const view = viewAt(opened.db, seeded, seeded.headTurnId);
      expect(view.closed.map((column) => column.id)).toContain(seeded.ids['state:潮位']);
      expect(view.columns.map((column) => column.id)).not.toContain(seeded.ids['state:潮位']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
