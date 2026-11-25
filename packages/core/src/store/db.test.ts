import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { makeTempDataDir } from "../test-support/temp-dir.ts";
import { DataDirLockedError, openDatabase, type OpenedDatabase } from "./db.ts";

const workId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const playthroughId = "00000000-0000-4000-8000-000000000003";
const turnId = "00000000-0000-4000-8000-000000000004";
const routeId = "00000000-0000-4000-8000-000000000005";

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
        values (${turnId}, ${playthroughId}, 0, '开场', '[]', '{"place":"钟铺","time":"深夜","present":[]}', 'committed', ${now})`,
  );
  opened.db.run(
    sql`insert into routes (id, playthrough_id, head_turn_id, created_at, updated_at)
        values (${routeId}, ${playthroughId}, ${turnId}, ${now}, ${now})`,
  );
}

function insertRequest(opened: OpenedDatabase, id: string, status: string): void {
  const now = Date.now();
  opened.db.run(
    sql`insert into turn_requests
        (id, playthrough_id, route_id, kind, expected_head_turn_id, parent_turn_id, status, attempts, created_at, updated_at)
        values (${id}, ${playthroughId}, ${routeId}, 'continue', ${turnId}, ${turnId}, ${status}, 1, ${now}, ${now})`,
  );
}

describe("openDatabase", () => {
  it("迁移出全部业务表，并打开外键", () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, "library.db"));
    try {
      const tables = opened.db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`);
      const names = tables.map((row) => row.name);
      for (const name of [
        "works",
        "work_versions",
        "playthroughs",
        "turns",
        "routes",
        "turn_requests",
        "jobs",
        "llm_calls",
      ]) {
        expect(names).toContain(name);
      }
      expect(opened.db.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)?.foreign_keys).toBe(1);
      seed(opened);
      opened.db.run(sql`delete from works where id = ${workId}`);
      expect(opened.db.all(sql`select id from work_versions`)).toHaveLength(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it("同一路线只能在部分唯一索引下有一个进行中的请求", () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, "library.db"));
    try {
      seed(opened);
      insertRequest(opened, "00000000-0000-4000-8000-000000000011", "running");
      expect(() => insertRequest(opened, "00000000-0000-4000-8000-000000000012", "running")).toThrow();
      opened.db.run(
        sql`update turn_requests set status = 'failed' where id = ${"00000000-0000-4000-8000-000000000011"}`,
      );
      expect(() => insertRequest(opened, "00000000-0000-4000-8000-000000000013", "running")).not.toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it("另一个进程打开同一个库时抛 DataDirLockedError", async () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, "library.db");
    const opened = openDatabase(file);
    try {
      const childPath = fileURLToPath(new URL("./test-fixtures/open-db-child.ts", import.meta.url));
      const result = await new Promise<{ locked: boolean; name: string }>((resolve, reject) => {
        const child = fork(childPath, [file], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
        child.once("message", (message) => resolve(message as { locked: boolean; name: string }));
        child.once("exit", (code) => {
          if (code !== 0) reject(new Error(`child exited with ${code}`));
        });
      });
      expect(result.locked).toBe(true);
      expect(result.name).toBe(DataDirLockedError.name);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
