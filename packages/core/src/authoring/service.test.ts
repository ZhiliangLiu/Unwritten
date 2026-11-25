import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { openDatabase } from '../store/db.ts';
import { createLibraryService } from '../library/service.ts';
import { createAuthoringService } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';

const previewArgs = {
  title: '雨夜修钟铺',
  blurb: '一个雨夜，你在钟铺里等一个人。',
  public_setting: '老城的钟铺，雨下了一整夜。',
  prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
  options: '{"text":"去开门"}\n{"text":"继续修钟"}',
  place: '钟铺',
  time: '深夜',
  language: 'zh-CN',
};

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger,
    shutdown: new AbortController().signal,
  };
  const llm = createScriptedLlm();
  const library = createLibraryService(deps);
  const authoring = createAuthoringService({ ...deps, llm });
  return { temp, opened, deps, llm, library, authoring };
}

describe('createAuthoringService', () => {
  it('生成预览并采用开场', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜修钟铺' });
      llm.enqueue({ args: previewArgs });
      const view = authoring.generatePreview({ workId, jobId, contentRev: 1 });
      expect(view.status).toBe('running');
      await authoring.whenIdle();
      const after = library.get({ workId });
      expect(after.latestPreviewJob?.status).toBe('done');
      expect(after.latestPreviewJob?.preview?.title).toBe('雨夜修钟铺');
      expect(llm.runs[0]?.sessionId).toBe(workId);

      const adopted = authoring.adoptPreview({ workId, jobId });
      expect(adopted.routeId).toBeTruthy();
      const playable = library.get({ workId });
      expect(playable.status).toBe('playable');
      expect(playable.routeId).toBe(adopted.routeId);
      expect(() => library.saveBackground({ workId, baseContentRev: 2, background: '改稿' })).toThrow();
      expect(authoring.adoptPreview({ workId, jobId }).routeId).toBe(adopted.routeId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一 jobId 重发返回同一任务，换修订号冲突', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();
      expect(authoring.generatePreview({ workId, jobId, contentRev: 1 }).status).toBe('done');
      expect(() => authoring.generatePreview({ workId, jobId, contentRev: 2 })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('改过背景后旧预览不能采用', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '旧背景' });
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();
      library.saveBackground({ workId, baseContentRev: 1, background: '新背景' });
      expect(() => authoring.adoptPreview({ workId, jobId })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('模型不可用时拒绝生成', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.setResolved(null);
      expect(() => authoring.generatePreview({ workId, jobId, contentRev: 1 })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('恢复时把运行中的任务标为中断', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      const now = Date.now();
      opened.db.run(
        `insert into jobs (id, work_id, kind, status, input, created_at, updated_at)
         values ('${jobId}', '${workId}', 'preview', 'running', '{"contentRev":1,"background":"雨夜"}', ${now}, ${now})`,
      );
      expect(authoring.recoverInterrupted()).toBe(1);
      expect(library.get({ workId }).latestPreviewJob?.status).toBe('failed');
      expect(authoring.recoverInterrupted()).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
