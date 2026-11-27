import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedNorthCape } from '../test-support/story-fixtures.ts';
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
  renderSceneLines,
  renderSecretLines,
  renderStateBlock,
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

describe('render 状态栏、秘密、场面', () => {
  function lighthouseSetup() {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedLighthouseTown(opened.db);
    const chain = ancestorChain(opened.db, seeded.headTurnId).map((turn) => ({
      id: turn.id,
      depth: turn.depth,
      action: turn.action,
      prose: turn.prose,
      scene: turn.scene,
    }));
    const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain });
    const codebook = createCodeBook(projection);
    return { temp, opened, seeded, projection, codebook };
  }

  it('状态栏给叙述者看全部栏目和幕后标记', () => {
    const { temp, opened, projection, codebook } = lighthouseSetup();
    try {
      const block = renderStateBlock(projection, codebook);
      expect(block).toContain('- 潮位（key 潮位，数字 0 到 10 米）= 3');
      expect(block).toContain('- 信任（key 信任，阶段 陌生|相识|信任|决裂）= 相识');
      expect(block).toContain('- 旧信（key 旧信，清单）= 第一封：已完成');
      expect(block).toContain('- 真名（key 真名，文字，幕后栏目）= 还没有值；目前不显示给玩家');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('秘密只列在场者有关的', () => {
    const { temp, opened, seeded, projection, codebook } = lighthouseSetup();
    try {
      const lines = renderSecretLines(projection, codebook, [seeded.ids.linchao ?? '']);
      expect(lines).toContain('秘密「上一任邮差的去向」');
      expect(lines).toContain('上一任邮差在灯塔里住过一年，后来乘夜船离开');
      expect(lines).toContain('揭晓：主角拿到第三封旧信时');
      expect(renderSecretLines(projection, codebook, [seeded.ids.postOffice ?? ''])).toBe('');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('关键场面按编号列出触发条件', () => {
    expect(
      renderSceneLines([{ id: 's', condition: '主角第一次独自登上灯塔顶', outcome: '林潮讲起上一任邮差', once: true }]),
    ).toBe('- S1：条件：主角第一次独自登上灯塔顶；发生：林潮讲起上一任邮差；只发生一次');
  });
});
