import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedNorthCape, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from './chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { createCodeBook } from '../story/codebook.ts';
import { loadProjection } from '../story/projection.ts';
import { estimateTokens } from '../llm/budget.ts';
import { buildNarratorContext } from './context.ts';

function projectionFor(db: Database, versionId: string, headTurnId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId, chain });
}

function contextFor(db: Database, versionId: string, headTurnId: string, contextWindow: number) {
  const projection = projectionFor(db, versionId, headTurnId);
  return buildNarratorContext({
    meta: {
      background: '雨下了三天，你在北岬等一班开往南岸的渡轮。',
      plan: { items: [{ id: 'public_setting', text: '你是来北岬送信的邮差，渡轮因风雨停航。', source: 'ai' }] },
      narration: { language: 'zh-CN' },
    },
    projection,
    codebook: createCodeBook(projection),
    action: { text: '问撑伞的女人叫什么名字', optionIndex: null },
    model: { endpointId: 'e', modelId: 'm', contextWindow, maxOutputTokens: 512 },
    estimateTokens: (text) => text.length,
    toolSchemaText: 'schema',
  });
}

function indexContext(db: Database, versionId: string, headTurnId: string, contextWindow: number) {
  const projection = projectionFor(db, versionId, headTurnId);
  const codebook = createCodeBook(projection);
  const result = buildNarratorContext({
    meta: { background: '', narration: { language: 'zh-CN' } },
    projection,
    codebook,
    action: { text: '一', optionIndex: null },
    model: { endpointId: 'e', modelId: 'm', contextWindow, maxOutputTokens: 100 },
    estimateTokens: (text) => text.length,
    toolSchemaText: 's',
  });
  return { result, codebook, projection };
}

describe('buildNarratorContext', () => {
  it('预算充足时带上场景、索引和最新回合', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('【当前场景】');
        expect(result.prompt).toContain('地点：北岬灯塔值班室');
        expect(result.prompt).toContain('【人物与事物索引】');
        expect(result.prompt).toContain('T2（最新）');
        expect(result.prompt).toContain('问撑伞的女人叫什么名字');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('预算连必需材料都不够时返回 context_too_small', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      expect(contextFor(opened.db, seeded.versionId, seeded.headTurnId, 200)).toEqual({
        ok: false,
        code: 'context_too_small',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('索引先列已出场的实体', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '一' }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'a', kind: 'character', name: '甲' },
          { key: 'b', kind: 'character', name: '乙' },
          { key: 'c', kind: 'character', name: '丙' },
          { key: 'd', kind: 'character', name: '丁' },
          { key: 'e', kind: 'place', name: '戊' },
          { key: 'f', kind: 'item', name: '己' },
        ],
        names: [
          { entity: 'a', name: '甲', holder: 'lin', originTurn: 0, para: 1 },
          { entity: 'b', name: '乙', holder: 'lin', originTurn: 0, para: 1 },
          { entity: 'c', name: '丙', holder: 'lin', originTurn: 0, para: 1 },
        ],
      });
      const { result } = indexContext(opened.db, seeded.versionId, seeded.headTurnId, 820);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.indexEntities).toBe(4);
        expect(result.prompt).toContain('甲');
        expect(result.prompt).toContain('乙');
        expect(result.prompt).toContain('丙');
        expect(result.prompt).toContain('丁');
        expect(result.prompt).not.toContain('戊');
        expect(result.prompt).not.toContain('己 ·');
        expect(result.prompt).toContain('另有 2 个未出场的人物和地点');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('原文放不下的回合改用摘要行，摘要缺失时用玩家行动', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场正文' },
          { prose: '第一回合正文', action: '一' },
          { prose: '第二回合正文', action: '二' },
          { prose: '第三回合正文', action: '三' },
        ],
        entities: [{ key: 'lin', kind: 'character', name: '主角', protagonist: true }],
      });
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 1200);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('【更早的回合】');
        expect(result.prompt).toContain('玩家行动：');
        expect(result.prompt).toContain('另有');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('编号只给出现在上下文里的实体', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'included', kind: 'character', name: '被列出的人' },
          { key: 'excluded', kind: 'character', name: '被挤掉的人' },
        ],
        names: [{ entity: 'included', name: '被列出的人', holder: 'lin', originTurn: 0, para: 1 }],
      });
      const { result, codebook } = indexContext(opened.db, seeded.versionId, seeded.headTurnId, 760);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(codebook.resolveEntity('被列出的人').ok).toBe(true);
        expect(codebook.resolveEntity('被挤掉的人').ok).toBe(false);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('上下文的 token 棘轮', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      const projection = projectionFor(opened.db, seeded.versionId, seeded.headTurnId);
      const result = buildNarratorContext({
        meta: {
          background: '雨下了三天，你在北岬等一班开往南岸的渡轮。',
          plan: {
            items: [{ id: 'public_setting', text: '你是来北岬送信的邮差，渡轮因风雨停航。', source: 'ai' }],
          },
          narration: { language: 'zh-CN' },
        },
        projection,
        codebook: createCodeBook(projection),
        action: { text: '问撑伞的女人叫什么名字', optionIndex: null },
        model: { endpointId: 'e', modelId: 'm', contextWindow: 32_768, maxOutputTokens: 512 },
        estimateTokens,
        toolSchemaText: 'schema',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(estimateTokens(result.prompt)).toBe(1056);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
