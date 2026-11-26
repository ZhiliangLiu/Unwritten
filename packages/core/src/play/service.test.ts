import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { Logger, LogEvent, PerformanceSample } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { createRecordingSummary } from '../test-support/fake-summary.ts';
import { changeLines } from '../test-support/llm-steps.ts';
import { openDatabase } from '../store/db.ts';
import { createPlayService } from './service.ts';

const workId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const playthroughId = '00000000-0000-4000-8000-000000000003';
const rootTurnId = '00000000-0000-4000-8000-000000000004';
const routeId = '00000000-0000-4000-8000-000000000005';
const requestId = '00000000-0000-4000-8000-000000000006';
const protagonistId = '00000000-0000-4000-8000-000000000007';
const shenId = '00000000-0000-4000-8000-000000000008';

const meta = {
  background: '雨夜修钟铺',
  plan: { items: [{ id: 'public_setting', text: '老城的钟铺', source: 'ai' }] },
  opening: {
    prose: '开场正文',
    options: [{ text: '推门' }],
    scene: { place: '钟铺', time: '深夜', present: [] },
  },
  narration: { language: 'zh-CN' },
};

const turnArgs = {
  prose: '你推开门。雨声更大了。',
  options: '{"text":"走进雨里"}\n{"text":"关上门"}',
  changes: '',
  ending: 'false',
};

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const now = Date.now();
  opened.db.run(
    sql`insert into works (id, title, draft_id, published_id, created_at, updated_at)
        values (${workId}, '雨夜', ${versionId}, ${versionId}, ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
        values (${versionId}, ${workId}, 'published', 1, 1, ${JSON.stringify(meta)}, ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into entities (version_id, id, kind, name, profile, is_protagonist)
        values (${versionId}, ${protagonistId}, 'character', '林远', '{"text":"邮差"}', 1)`,
  );
  opened.db.run(
    sql`insert into entities (version_id, id, kind, name, profile, is_protagonist)
        values (${versionId}, ${shenId}, 'character', '沈岚', '{"text":"带着黑伞"}', 0)`,
  );
  opened.db.run(
    sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
        values (${versionId}, ${protagonistId}, '林远', ${protagonistId}, null, null)`,
  );
  opened.db.run(
    sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
        values (${versionId}, ${shenId}, '撑伞的女人', ${protagonistId}, null, null)`,
  );
  opened.db.run(
    sql`insert into playthroughs (id, version_id, kind, root_turn_id, created_at)
        values (${playthroughId}, ${versionId}, 'play', ${rootTurnId}, ${now})`,
  );
  opened.db.run(
    sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
        values (${rootTurnId}, ${playthroughId}, 0, '开场正文', '[{"text":"推门"}]',
                '{"place":"钟铺","time":"深夜","present":[]}', 'committed', ${now})`,
  );
  opened.db.run(
    sql`insert into routes (id, playthrough_id, head_turn_id, created_at, updated_at)
        values (${routeId}, ${playthroughId}, ${rootTurnId}, ${now}, ${now})`,
  );
  const llm = createScriptedLlm();
  const events: LogEvent[] = [];
  const samples: PerformanceSample[] = [];
  const logger: Logger = {
    record(event) {
      events.push(event);
    },
    sample(sample) {
      samples.push(sample);
    },
    async flush() {},
    async close() {},
  };
  const summary = createRecordingSummary();
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger,
    shutdown: new AbortController().signal,
  };
  const play = createPlayService({ ...deps, llm, summary });
  return { temp, opened, llm, summary, events, samples, play };
}

describe('createPlayService', () => {
  it('自由行动成功推进路线', async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ args: turnArgs });
      const first = play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: null },
      });
      expect(first.status).toBe('running');
      await play.whenIdle();
      const route = play.getRoute({ routeId });
      expect(route.turns).toHaveLength(2);
      expect(route.turns[1]?.action).toEqual({ text: '推门', optionIndex: null });
      expect(route.turns[1]?.originRequest).toEqual({ id: requestId, attempt: 1 });
      expect(route.pending).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('续写结果和失败状态都无法写入时，分别记录失败并保留提交样本', async () => {
    const { temp, opened, llm, play, events, samples } = setup();
    try {
      opened.db.run(sql`create trigger reject_turn_status before update of status on turn_requests
        begin select raise(abort, 'write rejected'); end`);
      llm.enqueue({ args: turnArgs });
      expect(
        play.submitAction({
          requestId,
          routeId,
          expectedHeadTurnId: rootTurnId,
          action: { text: '推门', optionIndex: null },
        }).status,
      ).toBe('running');
      await play.whenIdle();

      expect(events.filter((event) => event.event === 'turn.request.failed').map((event) => event.data?.stage)).toEqual(
        ['commit', 'failure_state'],
      );
      expect(samples.filter((sample) => sample.metric === 'turn.commit')).toEqual([
        expect.objectContaining({ requestId, attempt: 1, outcome: 'error' }),
      ]);
      expect(samples.filter((sample) => sample.metric === 'turn.total')).toEqual([
        expect.objectContaining({ requestId, attempt: 1, outcome: 'error' }),
      ]);
      expect(play.getRoute({ routeId }).headTurnId).toBe(rootTurnId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('推荐项序号和原文对上才接受', async () => {
    const { temp, opened, llm, play } = setup();
    try {
      expect(() =>
        play.submitAction({
          requestId,
          routeId,
          expectedHeadTurnId: rootTurnId,
          action: { text: '推门', optionIndex: 2 },
        }),
      ).toThrow();
      llm.enqueue({ args: turnArgs });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: 1 },
      });
      await play.whenIdle();
      expect(play.getRoute({ routeId }).turns[1]?.action?.optionIndex).toBe(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一 requestId 只产生一个回合', async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ args: turnArgs });
      const input = {
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: null },
      };
      play.submitAction(input);
      await play.whenIdle();
      const again = play.submitAction(input);
      expect(again.status).toBe('done');
      expect(play.getRoute({ routeId }).turns).toHaveLength(2);
      expect(llm.runs).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('过期 head 不移动路线', () => {
    const { temp, opened, play } = setup();
    try {
      expect(() =>
        play.submitAction({
          requestId,
          routeId,
          expectedHeadTurnId: '00000000-0000-4000-8000-000000000099',
          action: { text: '推门', optionIndex: null },
        }),
      ).toThrow();
      expect(play.getRoute({ routeId }).turns).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('失败保留路线，重试沿用原请求', async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ fail: 'network' });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await play.whenIdle();
      expect(play.getRoute({ routeId }).turns).toHaveLength(1);
      expect(play.getRoute({ routeId }).pending?.status).toBe('failed');

      llm.enqueue({ args: turnArgs });
      play.retry({ requestId });
      await play.whenIdle();
      const route = play.getRoute({ routeId });
      expect(route.turns).toHaveLength(2);
      expect(route.turns[1]?.originRequest).toEqual({ id: requestId, attempt: 2 });
      expect(route.pending).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('恢复时把运行中的请求标为中断，并清理旧足迹', () => {
    const { temp, opened, play } = setup();
    try {
      const now = Date.now();
      opened.db.run(
        sql`insert into turn_requests
            (id, playthrough_id, route_id, kind, expected_head_turn_id, parent_turn_id, action, status, attempts, created_at, updated_at)
            values (${requestId}, ${playthroughId}, ${routeId}, 'continue', ${rootTurnId}, ${rootTurnId},
                    '{"text":"推门","optionIndex":null}', 'running', 1, ${now}, ${now})`,
      );
      expect(play.recoverInterrupted()).toBe(1);
      expect(play.getRoute({ routeId }).pending?.status).toBe('failed');
      opened.db.run(sql`update turn_requests set created_at = ${now - 91 * 86_400_000}`);
      expect(play.pruneOldRequestLogs()).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('交上来的事实与回合一起提交', async () => {
    const { temp, opened, llm, summary, play } = setup();
    try {
      const changes = changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '老周',
          known_as: '灯塔看守',
          profile: '带着黑伞',
          para: '1',
        },
        {
          type: 'event',
          subject: '老周',
          statement: '老周点亮了灯',
          witnesses: '@1',
          para: '1',
        },
      );
      llm.enqueue({ args: { ...turnArgs, prose: '灯塔看守点亮了灯。', changes } });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await play.whenIdle();
      const route = play.getRoute({ routeId });
      expect(route.turns).toHaveLength(2);
      expect(opened.db.all<{ name: string }>(sql`select name from entities where name = '老周'`)).toHaveLength(1);
      expect(
        opened.db.all<{ statement: string }>(sql`select statement from facts where statement = '老周点亮了灯'`),
      ).toHaveLength(1);
      expect(opened.db.all(sql`select * from prose_fts where prose_fts match '点亮了'`).length).toBeGreaterThan(0);
      expect(summary.enqueued[0]?.turnId).toBe(route.headTurnId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('事实不合格时回合不提交，修正后提交', async () => {
    const { temp, opened, llm, events, play } = setup();
    try {
      const bad = changeLines({ type: 'event', subject: '@99', statement: '有人来了', witnesses: '@1', para: '1' });
      const good = changeLines({ type: 'event', subject: '@2', statement: '沈岚来了', witnesses: '@1', para: '1' });
      llm.enqueue({ args: { ...turnArgs, changes: bad } }, { args: { ...turnArgs, changes: good } });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await play.whenIdle();
      expect(play.getRoute({ routeId }).turns).toHaveLength(2);
      expect(events.filter((event) => event.event === 'turn.changes.rejected')).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('修正两次仍不合格时失败，不写任何事实', async () => {
    const { temp, opened, llm, play } = setup();
    try {
      const bad = changeLines({ type: 'event', subject: '@99', statement: '有人来了', witnesses: '@1', para: '1' });
      const before = {
        entities: opened.db.all(sql`select * from entities`).length,
        facts: opened.db.all(sql`select * from facts`).length,
        knowledge: opened.db.all(sql`select * from knowledge`).length,
      };
      llm.enqueue(
        { args: { ...turnArgs, changes: bad } },
        { args: { ...turnArgs, changes: bad } },
        { args: { ...turnArgs, changes: bad } },
      );
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await play.whenIdle();
      expect(play.getRoute({ routeId }).turns).toHaveLength(1);
      expect(play.getRoute({ routeId }).pending?.status).toBe('failed');
      expect(play.getRoute({ routeId }).pending?.error).toBe('invalid_output');
      expect(opened.db.all(sql`select * from entities`).length).toBe(before.entities);
      expect(opened.db.all(sql`select * from facts`).length).toBe(before.facts);
      expect(opened.db.all(sql`select * from knowledge`).length).toBe(before.knowledge);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('模型能用工具查旧事并据此续写', async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ tool: 'get_character', args: { target: '@2' } }, { args: turnArgs });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: '问她是谁', optionIndex: null },
      });
      await play.whenIdle();
      expect(llm.runs[0]?.prompt).toContain('@2');
      expect(play.getRoute({ routeId }).turns).toHaveLength(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('手记只给主角知道的', () => {
    const { temp, opened, play } = setup();
    try {
      const journal = play.getJournal({ routeId });
      expect(journal.subjects.map((subject) => subject.name)).toEqual(['撑伞的女人']);
      expect(journal.headTurnId).toBe(rootTurnId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
