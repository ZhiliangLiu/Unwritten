import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedNorthCape } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase } from '../store/db.ts';
import { createCodeBook } from './codebook.ts';
import { loadProjection } from './projection.ts';
import {
  clipToolResult,
  renderCatalogPage,
  renderEntityDetail,
  renderEntityLine,
  renderSceneBlock,
  renderSearchHits,
  renderTurnText,
  renderWhoKnows,
  sourceLabel,
} from './render.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedNorthCape(opened.db);
  const chain = ancestorChain(opened.db, seeded.headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain });
  const codebook = createCodeBook(projection);
  codebook.entityCode(seeded.ids.shen ?? '');
  return { temp, opened, seeded, projection, codebook };
}

describe('render', () => {
  it('当前场景', () => {
    const { temp, opened, projection, codebook } = setup();
    try {
      expect(renderSceneBlock(projection, codebook)).toBe(
        [
          '【当前场景】',
          '地点：北岬灯塔值班室',
          '时间：第三天夜里',
          '在场：',
          '- @2 沈岚 · 认识阶段：met · 说话很慢，总带着一把黑伞',
          '- @3 老周 · 认识阶段：未记录 · 灯塔看守，话不多',
        ].join('\n'),
      );
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('索引行', () => {
    const { temp, opened, seeded, projection, codebook } = setup();
    try {
      expect(renderEntityLine(projection, codebook, seeded.ids.shen ?? '')).toBe(
        '- @2 人物 · 沈岚 · 说话很慢，总带着一把黑伞 · 已出场',
      );
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('实体详情', () => {
    const { temp, opened, seeded, projection, codebook } = setup();
    try {
      expect(renderEntityDetail(projection, codebook, seeded.ids.shen ?? '')).toBe(
        [
          '@2 人物 · 真名：沈岚',
          '主角的称呼：沈岚',
          '其他称呼：无',
          '档案：说话很慢，总带着一把黑伞',
          '特征：',
          '- #1 她在等下一班船（T2 第1段）',
          '关系：',
          '- #2 @1 → @2 acquaintance · 阶段 met：主角在栈桥上遇见撑伞的女人（T0 第2段）',
          '知道的事：',
          '- #3 沈岚告诉主角末班渡轮已经停航（确认，T0 第2段）',
          '最近的相关事件：',
          '- #3 沈岚告诉主角末班渡轮已经停航（T0 第2段）',
        ].join('\n'),
      );
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('目录、知情、回合与检索', () => {
    const { temp, opened, seeded, projection, codebook } = setup();
    try {
      expect(renderCatalogPage(projection, codebook, 'characters', 0)).toBe(
        [
          '人物（第 1–3 条，共 3 条）',
          '- @1 人物 · 林远 · 刚到北岬的邮差 · 已出场',
          '- @2 人物 · 沈岚 · 说话很慢，总带着一把黑伞 · 已出场',
          '- @3 人物 · 老周 · 灯塔看守，话不多 · 已出场',
          '没有更多了。',
        ].join('\n'),
      );
      expect(renderWhoKnows(projection, codebook, seeded.ids.ferry ?? '')).toBe(
        [
          '#1 沈岚告诉主角末班渡轮已经停航',
          '知情者：',
          '- @1 林远：确认（T0 第2段）',
          '- @2 沈岚：确认（T0 第2段）',
        ].join('\n'),
      );
      expect(renderCatalogPage(projection, codebook, 'scenes', 0)).toBe('本作品没有设定关键场面。');
      expect(renderTurnText(projection.chain[2]!)).toBe(
        [
          'T2',
          '玩家行动：问撑伞的女人叫什么名字',
          '[1] 她说她叫沈岚，在等下一班船。',
          '',
          '[2] 老周把一把铜钥匙放在桌上，说灯塔顶层的门只有这一把钥匙。',
        ].join('\n'),
      );
      expect(renderSearchHits([{ turnId: 't', depth: 0, para: 1, snippet: '灯塔守夜人在渡口等船' }], '守夜人')).toBe(
        ['搜索「守夜人」，命中 1 处：', '- T0 第1段：灯塔守夜人在渡口等船'].join('\n'),
      );
      expect(renderSearchHits([], '守夜人')).toBe('搜索「守夜人」，没有命中。');
      expect(sourceLabel(-1, null)).toBe('作品设定');
      expect(sourceLabel(2, 1)).toBe('T2 第1段');
      const clipped = clipToolResult('甲'.repeat(4001));
      expect(clipped.endsWith('\n（已截断）')).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
