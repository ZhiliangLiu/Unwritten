import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { StateConfig } from '@unwritten/contracts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase, type OpenedDatabase } from '../store/db.ts';
import { checkStateConfig, checkStateValue, mergeListItems, parseListValue } from './state.ts';

const emptyConfig: StateConfig = { min: null, max: null, unit: null, stages: [] };

describe('checkStateConfig', () => {
  it('数字栏目要求阶段为空且上下限有序', () => {
    expect(checkStateConfig('number', { min: 0, max: 10, unit: '点', stages: [] }).ok).toBe(true);
    const result = checkStateConfig('number', { min: 10, max: 0, unit: null, stages: [] });
    expect(result).toEqual({ ok: false, error: '数字栏目的 min 必须小于 max。' });
  });

  it('阶段栏目至少要有两个不同的阶段名', () => {
    expect(checkStateConfig('stage', { min: null, max: null, unit: null, stages: ['初见', '同行'] }).ok).toBe(true);
    const result = checkStateConfig('stage', { min: null, max: null, unit: null, stages: ['初见', '初见'] });
    expect(result).toEqual({ ok: false, error: '阶段栏目至少要有两个不同的阶段名。' });
  });

  it('清单栏目不设上下限、单位和阶段', () => {
    expect(checkStateConfig('list', emptyConfig).ok).toBe(true);
    expect(checkStateConfig('list', { ...emptyConfig, min: 0 }).ok).toBe(false);
  });

  it('文字栏目不设上下限、单位和阶段', () => {
    expect(checkStateConfig('text', emptyConfig).ok).toBe(true);
    expect(checkStateConfig('text', { ...emptyConfig, stages: ['起'] }).ok).toBe(false);
  });
});

describe('checkStateValue', () => {
  it('数字值去掉首尾空白并规范化', () => {
    const def = { display: 'number' as const, config: { min: 0, max: 10, unit: null, stages: [] } };
    expect(checkStateValue(def, ' 3.50 ')).toEqual({ ok: true, value: '3.5' });
    expect(checkStateValue(def, '三')).toEqual({ ok: false, error: '数字栏目的值必须是十进制数字。' });
  });

  it('数字值按范围拒绝', () => {
    const def = { display: 'number' as const, config: { min: 0, max: 10, unit: null, stages: [] } };
    expect(checkStateValue(def, '12')).toEqual({ ok: false, error: '值超出了 min 到 max 的范围。' });
    expect(checkStateValue(def, '10')).toEqual({ ok: true, value: '10' });
  });

  it('阶段值必须是列出的阶段之一', () => {
    const def = { display: 'stage' as const, config: { min: null, max: null, unit: null, stages: ['初见', '同行'] } };
    expect(checkStateValue(def, '初见')).toEqual({ ok: true, value: '初见' });
    expect(checkStateValue(def, '未至')).toEqual({
      ok: false,
      error: '阶段栏目的值必须是这些阶段之一：初见、同行。',
    });
  });

  it('清单栏目不接受直接写值', () => {
    expect(checkStateValue({ display: 'list', config: emptyConfig }, '[]')).toEqual({
      ok: false,
      error: '清单栏目用 state_item 改条目，不写 value。',
    });
  });

  it('文字值非空且不超过 200 个字', () => {
    const def = { display: 'text' as const, config: emptyConfig };
    expect(checkStateValue(def, '灯亮着')).toEqual({ ok: true, value: '灯亮着' });
    expect(checkStateValue(def, '   ')).toEqual({
      ok: false,
      error: '文字栏目的值不能为空，也不能超过 200 个字。',
    });
    expect(checkStateValue(def, '😀'.repeat(200)).ok).toBe(true);
    expect(checkStateValue(def, '😀'.repeat(201))).toEqual({
      ok: false,
      error: '文字栏目的值不能为空，也不能超过 200 个字。',
    });
  });
});

describe('mergeListItems', () => {
  it('previous 为 null 时从空清单开始', () => {
    const merged = mergeListItems(null, [{ item: '借灯', status: 'open' }]);
    expect(JSON.parse(merged)).toEqual([{ item: '借灯', status: 'open' }]);
  });

  it('改已有条目的状态', () => {
    const previous = JSON.stringify([
      { item: '借灯', status: 'open' },
      { item: '还伞', status: 'open' },
    ]);
    const merged = mergeListItems(previous, [{ item: '借灯', status: 'done' }]);
    expect(parseListValue(merged)).toEqual([
      { item: '借灯', status: 'done' },
      { item: '还伞', status: 'open' },
    ]);
  });

  it('新条目追加到末尾', () => {
    const previous = JSON.stringify([{ item: '借灯', status: 'open' }]);
    const merged = mergeListItems(previous, [{ item: '还伞', status: 'open' }]);
    expect(parseListValue(merged)).toEqual([
      { item: '借灯', status: 'open' },
      { item: '还伞', status: 'open' },
    ]);
  });

  it('坏掉的清单读作空清单', () => {
    expect(parseListValue('不是 JSON')).toEqual([]);
    expect(parseListValue('{"item":"借灯"}')).toEqual([]);
  });
});

const workId = '00000000-0000-4000-8000-000000000201';
const versionId = '00000000-0000-4000-8000-000000000202';
const playthroughId = '00000000-0000-4000-8000-000000000203';
const turnId = '00000000-0000-4000-8000-000000000204';
const stateDefId = '00000000-0000-4000-8000-000000000205';

function seed(opened: OpenedDatabase): void {
  const now = Date.now();
  opened.db.run(
    sql`insert into works (id, draft_id, created_at, updated_at) values (${workId}, ${versionId}, ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
        values (${versionId}, ${workId}, 'draft', 0, '{"background":""}', ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into playthroughs (id, version_id, kind, created_at)
        values (${playthroughId}, ${versionId}, 'play', ${now})`,
  );
  opened.db.run(
    sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
        values (${turnId}, ${playthroughId}, 0, '灯在渡口亮着', '[]',
                '{"place":"渡口","time":"夜里","present":[]}', 'committed', ${now})`,
  );
}

function insertStateDef(opened: OpenedDatabase, id: string, key: string, originTurnId: string | null): void {
  opened.db.run(
    sql`insert into state_defs (version_id, id, key, label, display, config, hidden, origin_turn_id)
        values (${versionId}, ${id}, ${key}, '夜色', 'number',
                '{"min":0,"max":10,"unit":null,"stages":[]}', 0, ${originTurnId})`,
  );
}

describe('状态栏迁移', () => {
  it('state_values 随回合删除', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      seed(opened);
      insertStateDef(opened, stateDefId, 'night', null);
      opened.db.run(
        sql`insert into state_values (version_id, turn_id, state_def_id, value, visible)
            values (${versionId}, ${turnId}, ${stateDefId}, '3', 1)`,
      );
      expect(opened.db.all(sql`select * from state_values`)).toHaveLength(1);
      opened.db.run(sql`delete from turns where id = ${turnId}`);
      expect(opened.db.all(sql`select * from state_values`)).toHaveLength(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('state_defs 同一来源下 key 唯一', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      seed(opened);
      insertStateDef(opened, stateDefId, 'night', null);
      expect(() => insertStateDef(opened, '00000000-0000-4000-8000-000000000206', 'night', null)).toThrow();
      expect(() => insertStateDef(opened, '00000000-0000-4000-8000-000000000207', 'night', turnId)).not.toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
