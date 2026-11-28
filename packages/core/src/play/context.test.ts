import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedNorthCape, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from './chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { createCodeBook } from '../story/codebook.ts';
import { loadProjection } from '../story/projection.ts';
import { estimateTokens } from '../llm/budget.ts';
import { buildNarratorContext } from './context.ts';
import { DEFAULT_WORK_SETTINGS, type WorkAnchors, type WorkSettings } from '@unwritten/contracts';
import type { KeyScene } from '../store/meta.ts';

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

function contextFor(
  db: Database,
  versionId: string,
  headTurnId: string,
  contextWindow: number,
  overrides: {
    anchors?: WorkAnchors;
    settings?: WorkSettings;
    ending?: string;
    keyScenes?: KeyScene[];
    protagonistAppearance?: string | null;
  } = {},
) {
  const projection = projectionFor(db, versionId, headTurnId);
  return buildNarratorContext({
    meta: {
      background: '雨下了三天，你在北岬等一班开往南岸的渡轮。',
      plan: {
        items: [
          {
            kind: 'summary',
            key: 'public_setting',
            id: 'public_setting',
            text: '你是来北岬送信的邮差，渡轮因风雨停航。',
            source: 'ai',
          },
        ],
        conflicts: [],
        confirmedRev: null,
      },
      narration: { language: 'zh-CN' },
      ending: overrides.ending,
      keyScenes: overrides.keyScenes,
      anchors: overrides.anchors,
    },
    settings: overrides.settings ?? DEFAULT_WORK_SETTINGS,
    projection,
    codebook: createCodeBook(projection),
    action: { text: '问撑伞的女人叫什么名字', optionIndex: null },
    model: { endpointId: 'e', modelId: 'm', contextWindow, maxOutputTokens: 512 },
    protagonistAppearance: overrides.protagonistAppearance ?? null,
    estimateTokens: (text) => text.length,
    toolSchemaText: 'schema',
  });
}

function indexContext(db: Database, versionId: string, headTurnId: string, contextWindow: number) {
  const projection = projectionFor(db, versionId, headTurnId);
  const codebook = createCodeBook(projection);
  const result = buildNarratorContext({
    meta: { background: '', narration: { language: 'zh-CN' } },
    settings: DEFAULT_WORK_SETTINGS,
    projection,
    codebook,
    action: { text: '一', optionIndex: null },
    model: { endpointId: 'e', modelId: 'm', contextWindow, maxOutputTokens: 100 },
    protagonistAppearance: null,
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
        anchorTokens: 0,
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者锚点分成三块写进要求', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768, {
        anchors: {
          narrationDirective: '用第二人称，句子短。',
          contentPolicy: '不写血腥场面。',
          improvisationScope: '路人的名字可以现造。',
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('【叙事要求】\n作品语言：zh-CN。');
        expect(result.prompt).toContain('作品语言：zh-CN。正文和选项都用这种语言写。\n用第二人称，句子短。');
        expect(result.prompt).toContain('【内容边界】\n不写血腥场面。');
        expect(result.prompt).toContain('【即兴范围】\n路人的名字可以现造。');
        expect(result.anchorTokens).toBe(27);
        expect(result.prompt).toContain('问撑伞的女人叫什么名字');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者锚点自己就放不下时返回 work_setting_too_long', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 2130, {
        anchors: {
          narrationDirective: '长'.repeat(1500),
          contentPolicy: '',
          improvisationScope: '',
        },
      });
      expect(result).toEqual({ ok: false, code: 'work_setting_too_long', anchorTokens: 1500 });
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
      const { result } = indexContext(opened.db, seeded.versionId, seeded.headTurnId, 1590);
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
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 1970);
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

  it('摘要行放不下就停，不跳过去放更早的回合', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场正文' },
          { prose: '第一回合正文', action: '一' },
          { prose: '第二回合正文', action: '二' },
          { prose: '第三回合正文', action: '潮'.repeat(2000) },
          { prose: '第四回合正文', action: '四' },
        ],
        entities: [{ key: 'lin', kind: 'character', name: '主角', protagonist: true }],
      });
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 1970);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.summaryLines).toBe(0);
        expect(result.omittedTurns).toBe(4);
        expect(result.prompt).not.toContain('T2 玩家行动：二');
        expect(result.prompt).toContain('另有 4 个更早的回合未列出');
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
      const { result, codebook } = indexContext(opened.db, seeded.versionId, seeded.headTurnId, 1530);
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

  it('状态栏、秘密、场面、结束条件进入上下文', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场', presentKeys: ['keeper'] }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'keeper', kind: 'character', name: '守灯人' },
        ],
        facts: [
          {
            key: 'secret',
            kind: 'secret',
            subject: 'keeper',
            statement: '灯塔下面停着一条旧船',
            data: { title: '旧船', reveal: '主角问起时' },
            para: 1,
          },
        ],
        stateDefs: [{ key: '潮位', label: '潮位', display: 'number', config: { min: 0, max: 10, unit: '米' } }],
        stateValues: [{ state: '潮位', turn: 0, value: '3', visible: true }],
      });
      const settings: WorkSettings = {
        ...DEFAULT_WORK_SETTINGS,
        actions: { text: '', hints: 'known_consequences' },
      };
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768, {
        settings,
        ending: '三封旧信都送到收件人手里',
        keyScenes: [{ id: 'scene-1', condition: '主角第一次独自登上灯塔顶', outcome: '守灯人讲起旧事', once: true }],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('【行动提示】\n提醒已知后果：');
        expect(result.prompt).toContain('【结束条件】\n三封旧信都送到收件人手里');
        expect(result.prompt).toContain('【状态栏】');
        expect(result.prompt).toContain('潮位（key 潮位，数字 0 到 10 米）= 3');
        expect(result.prompt).toContain('【和在场者有关的秘密】');
        expect(result.prompt).toContain('秘密「旧船」');
        expect(result.prompt).toContain('【未触发的关键场面】');
        expect(result.prompt).toContain('S1：条件：主角第一次独自登上灯塔顶');
        expect(result.stateLines).toBe(1);
        expect(result.secretLines).toBe(1);
        expect(result.sceneLines).toBe(1);
        expect(result.sceneCodes).toEqual([{ code: 'S1', id: 'scene-1', once: true }]);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('已触发的一次性场面不再列出', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedLighthouseTown(opened.db);
      const sceneId = seeded.ids['scene:towerTop'] ?? '';
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768, {
        ending: '三封旧信都送到收件人手里',
        keyScenes: [{ id: sceneId, condition: '主角第一次独自登上灯塔顶', outcome: '林潮讲起上一任邮差', once: true }],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('【状态栏】');
        expect(result.prompt).not.toContain('【未触发的关键场面】');
        expect(result.sceneLines).toBe(0);
        expect(result.sceneCodes).toEqual([]);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('和在场者无关的秘密不直接给', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场', presentKeys: ['keeper'] }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'keeper', kind: 'character', name: '守灯人' },
          { key: 'stranger', kind: 'character', name: '外来人' },
        ],
        facts: [
          {
            key: 'related',
            kind: 'secret',
            subject: 'keeper',
            statement: '灯油快用完了',
            data: { title: '灯油', reveal: '灯灭时' },
            para: 1,
          },
          {
            key: 'unrelated',
            kind: 'secret',
            subject: 'stranger',
            statement: '钥匙埋在井里',
            data: { title: '钥匙', reveal: '有人找钥匙时' },
            para: 1,
          },
        ],
      });
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('灯油快用完了');
        expect(result.prompt).not.toContain('钥匙埋在井里');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('幕后栏目标明不显示给玩家', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [{ key: 'lin', kind: 'character', name: '主角', protagonist: true }],
        stateDefs: [{ key: '真名', label: '真名', display: 'text', hidden: true }],
        stateValues: [{ state: '真名', turn: 0, value: '阿岚', visible: false }],
      });
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const line = result.prompt.split('\n').find((candidate) => candidate.includes('key 真名'));
        expect(line).toContain('幕后');
        expect(line).toContain('目前不显示给玩家');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('在场人物有形象时用短编号列出，不用实体 id 或名字', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      opened.db.run(
        sql`update entities set profile = ${JSON.stringify({ text: '带着黑伞', appearance: '浅色雨衣的兜帽遮住脸，窄肩' })}
            where version_id = ${seeded.versionId} and id = ${seeded.ids.shen}`,
      );
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768, {
        protagonistAppearance: '短发，深灰色旧风衣',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).toContain('【人物当前形象】');
        const block = result.prompt.split('【人物当前形象】')[1]?.split('\n\n')[0] ?? '';
        expect(block).toContain('主角：短发，深灰色旧风衣');
        expect(block).toContain('@2：浅色雨衣的兜帽遮住脸，窄肩');
        expect(block).not.toContain(seeded.ids.shen);
        expect(block).not.toContain('沈岚');
        expect(result.appearanceLines).toBe(3);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角不入画时没有主角那一行', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const seeded = seedNorthCape(opened.db);
      const result = contextFor(opened.db, seeded.versionId, seeded.headTurnId, 32_768, {
        protagonistAppearance: null,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prompt).not.toContain('【人物当前形象】');
        expect(result.appearanceLines).toBe(0);
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
      opened.db.run(
        sql`update entities set profile = ${JSON.stringify({ text: '带着黑伞', appearance: '浅色雨衣的兜帽遮住脸，窄肩' })}
            where version_id = ${seeded.versionId} and id = ${seeded.ids.shen}`,
      );
      const projection = projectionFor(opened.db, seeded.versionId, seeded.headTurnId);
      const result = buildNarratorContext({
        meta: {
          background: '雨下了三天，你在北岬等一班开往南岸的渡轮。',
          plan: {
            items: [
              {
                kind: 'summary',
                key: 'public_setting',
                id: 'public_setting',
                text: '你是来北岬送信的邮差，渡轮因风雨停航。',
                source: 'ai',
              },
            ],
            conflicts: [],
            confirmedRev: null,
          },
          narration: { language: 'zh-CN' },
        },
        settings: DEFAULT_WORK_SETTINGS,
        projection,
        codebook: createCodeBook(projection),
        action: { text: '问撑伞的女人叫什么名字', optionIndex: null },
        model: { endpointId: 'e', modelId: 'm', contextWindow: 32_768, maxOutputTokens: 512 },
        protagonistAppearance: '短发，深灰色旧风衣',
        estimateTokens,
        toolSchemaText: 'schema',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(estimateTokens(result.prompt)).toBeLessThanOrEqual(1200);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
