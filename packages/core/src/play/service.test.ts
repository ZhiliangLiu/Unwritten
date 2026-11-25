import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../events/bus.ts";
import type { Logger } from "../log/logger.ts";
import { makeTempDataDir } from "../test-support/temp-dir.ts";
import { createScriptedLlm } from "../test-support/scripted-llm.ts";
import { openDatabase } from "../store/db.ts";
import { createPlayService } from "./service.ts";

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const playthroughId = "00000000-0000-4000-8000-000000000003";
const rootTurnId = "00000000-0000-4000-8000-000000000004";
const routeId = "00000000-0000-4000-8000-000000000005";
const requestId = "00000000-0000-4000-8000-000000000006";

const meta = {
  background: "雨夜修钟铺",
  plan: { items: [{ id: "public_setting", text: "老城的钟铺", source: "ai" }] },
  opening: {
    prose: "开场正文",
    options: [{ text: "推门" }],
    scene: { place: "钟铺", time: "深夜", present: [] },
  },
  narration: { language: "zh-CN" },
};

const turnArgs = {
  prose: "你推开门。雨声更大了。",
  options: '{"text":"走进雨里"}\n{"text":"关上门"}',
  changes: JSON.stringify({ type: "scene", place: "门外", time: "深夜", present: "学徒" }),
  ending: "false",
};

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, "library.db"));
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
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger,
    shutdown: new AbortController().signal,
  };
  const play = createPlayService({ ...deps, llm });
  return { temp, opened, llm, play };
}

describe("createPlayService", () => {
  it("自由行动成功推进路线", async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ args: turnArgs });
      const first = play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: "推门", optionIndex: null },
      });
      expect(first.status).toBe("running");
      await play.whenIdle();
      const route = play.getRoute({ routeId });
      expect(route.turns).toHaveLength(2);
      expect(route.turns[1]?.action).toEqual({ text: "推门", optionIndex: null });
      expect(route.turns[1]?.originRequest).toEqual({ id: requestId, attempt: 1 });
      expect(route.pending).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it("推荐项序号和原文对上才接受", async () => {
    const { temp, opened, llm, play } = setup();
    try {
      expect(() =>
        play.submitAction({
          requestId,
          routeId,
          expectedHeadTurnId: rootTurnId,
          action: { text: "推门", optionIndex: 2 },
        }),
      ).toThrow();
      llm.enqueue({ args: turnArgs });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: "推门", optionIndex: 1 },
      });
      await play.whenIdle();
      expect(play.getRoute({ routeId }).turns[1]?.action?.optionIndex).toBe(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it("同一 requestId 只产生一个回合", async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ args: turnArgs });
      const input = {
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: "推门", optionIndex: null },
      };
      play.submitAction(input);
      await play.whenIdle();
      const again = play.submitAction(input);
      expect(again.status).toBe("done");
      expect(play.getRoute({ routeId }).turns).toHaveLength(2);
      expect(llm.runs).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it("过期 head 不移动路线", () => {
    const { temp, opened, play } = setup();
    try {
      expect(() =>
        play.submitAction({
          requestId,
          routeId,
          expectedHeadTurnId: "00000000-0000-4000-8000-000000000099",
          action: { text: "推门", optionIndex: null },
        }),
      ).toThrow();
      expect(play.getRoute({ routeId }).turns).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it("失败保留路线，重试沿用原请求", async () => {
    const { temp, opened, llm, play } = setup();
    try {
      llm.enqueue({ fail: "network" });
      play.submitAction({
        requestId,
        routeId,
        expectedHeadTurnId: rootTurnId,
        action: { text: "推门", optionIndex: null },
      });
      await play.whenIdle();
      expect(play.getRoute({ routeId }).turns).toHaveLength(1);
      expect(play.getRoute({ routeId }).pending?.status).toBe("failed");

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

  it("恢复时把运行中的请求标为中断，并清理旧足迹", () => {
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
      expect(play.getRoute({ routeId }).pending?.status).toBe("failed");
      opened.db.run(sql`update turn_requests set created_at = ${now - 91 * 86_400_000}`);
      expect(play.pruneOldRequestLogs()).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
