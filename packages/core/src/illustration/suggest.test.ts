import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_MAX_LENGTH } from '@unwritten/contracts';
import { openDatabase } from '../store/db.ts';
import type { VersionMeta } from '../store/meta.ts';
import { workVersions } from '../store/schema.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { suggestAppearance } from './suggest.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const llm = createScriptedLlm();
  return { temp, opened, seeded, llm };
}

describe('suggestAppearance', () => {
  it('一次就合格时返回去首尾空白的第一行', async () => {
    const { temp, opened, seeded, llm } = setup();
    try {
      llm.enqueue({ text: '  短卷发，深色短外套，左眉有一道浅缺口。  ' });
      const result = await suggestAppearance({ db: opened.db, llm }, { workId: seeded.workId });
      expect(result).toEqual({ appearance: '短卷发，深色短外套，左眉有一道浅缺口。' });
      expect(llm.completes).toHaveLength(1);
      const input = llm.completes[0]!;
      expect(input.purpose).toBe('background');
      expect(input.system).toContain('写一行主角的可见形象');
      expect(input.system).toContain('最多 300 字');
      expect(input.system).toContain('只交形象文字');
      expect(input.maxOutputTokens).toBe(200);
      expect(input.ref).toEqual({ kind: 'illustration', id: seeded.workId, attempt: 1, workId: seeded.workId });
      expect(input.prompt).toContain('作品语言：zh-CN');
      expect(input.prompt).toContain('公开的主角档案：二十多岁，记性好');
      expect(input.prompt).toContain('公开的主角设定：灯塔镇只在夜里通电');
      expect(input.prompt).toContain('新来的邮差，二十多岁，记性好。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it(`第一次 ${APPEARANCE_MAX_LENGTH + 1} 字、第二次合格时带修正说明重写一次`, async () => {
    const { temp, opened, seeded, llm } = setup();
    try {
      llm.enqueue({ text: '衣'.repeat(APPEARANCE_MAX_LENGTH + 1) }, { text: '短发，旧风衣，左手缠着绷带。' });
      const result = await suggestAppearance({ db: opened.db, llm }, { workId: seeded.workId });
      expect(result).toEqual({ appearance: '短发，旧风衣，左手缠着绷带。' });
      expect(llm.completes).toHaveLength(2);
      expect(llm.completes[0]?.prompt).not.toContain('上一次的形象不符合要求');
      expect(llm.completes[1]?.prompt).toContain(
        '上一次的形象不符合要求。请重写为一行不超过 300 字的外貌文字，只交形象本身。',
      );
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('自动补写的每次重写都收到同一个守卫和信号', async () => {
    const { temp, opened, seeded, llm } = setup();
    try {
      llm.enqueue({ text: '衣'.repeat(APPEARANCE_MAX_LENGTH + 1) }, { text: '短发，旧风衣。' });
      const guard = { endpointId: 'endpoint-a', modelId: 'model-a', assertCurrent() {} };
      const signal = new AbortController().signal;
      await suggestAppearance({ db: opened.db, llm }, { workId: seeded.workId }, { guard, signal });
      expect(llm.completes).toHaveLength(2);
      expect(llm.completes.every((input) => input.guard === guard)).toBe(true);
      expect(llm.completes.every((input) => input.signal === signal)).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('三次都不合格时抛 invalid_output', async () => {
    const { temp, opened, seeded, llm } = setup();
    try {
      llm.enqueue(
        { text: '衣'.repeat(APPEARANCE_MAX_LENGTH + 1) },
        { text: '服'.repeat(APPEARANCE_MAX_LENGTH + 1) },
        { text: '帽'.repeat(APPEARANCE_MAX_LENGTH + 1) },
      );
      let error: unknown;
      try {
        await suggestAppearance({ db: opened.db, llm }, { workId: seeded.workId });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'invalid_output' });
      expect(llm.completes).toHaveLength(3);
      expect(llm.completes[2]?.prompt).toContain('上一次的形象不符合要求');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('提示词里有公开设定，没有幕后设定的原文', async () => {
    const { temp, opened, seeded, llm } = setup();
    try {
      const version = opened.db.select().from(workVersions).where(eq(workVersions.id, seeded.versionId)).get()!;
      const meta = version.meta as VersionMeta;
      const secret = '地窖里藏着一台坏掉的发报机';
      opened.db.run(
        sql`update work_versions set meta = ${JSON.stringify({
          ...meta,
          settings: { ...meta.settings, secrets: { ...meta.settings!.secrets, text: secret } },
        })} where id = ${seeded.versionId}`,
      );
      llm.enqueue({ text: '短发，旧风衣。' });
      await suggestAppearance({ db: opened.db, llm }, { workId: seeded.workId });
      const prompt = llm.completes[0]!.prompt;
      expect(prompt).not.toContain(secret);
      expect(prompt).toContain('灯塔镇只在夜里通电');
      expect(prompt).toContain('新来的邮差，二十多岁，记性好。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作品不存在时抛 not_found，没发布时抛 not_published', async () => {
    const { temp, opened, llm } = setup();
    try {
      await expect(suggestAppearance({ db: opened.db, llm }, { workId: randomUUID() })).rejects.toMatchObject({
        code: 'not_found',
      });
      const workId = randomUUID();
      opened.db.run(
        sql`insert into works (id, draft_id, created_at, updated_at)
            values (${workId}, ${randomUUID()}, ${Date.now()}, ${Date.now()})`,
      );
      await expect(suggestAppearance({ db: opened.db, llm }, { workId })).rejects.toMatchObject({
        code: 'not_published',
      });
      expect(llm.completes).toHaveLength(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
