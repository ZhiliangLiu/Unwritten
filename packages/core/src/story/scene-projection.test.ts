import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedStory, type SeededStory } from '../test-support/story-fixtures.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { SCENE_EARLIER_TEXT_MAX_CHARS, sceneMaterials, type SceneMaterials } from './scene-projection.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function materials(
  db: Database,
  seeded: SeededStory,
  turnIndex: number,
  para: number,
  options: { protagonistAppearance?: string | null; protagonistInFrame?: boolean } = {},
): SceneMaterials {
  return sceneMaterials(db, {
    versionId: seeded.versionId,
    turnId: seeded.turnIds[turnIndex] ?? '',
    para,
    protagonistAppearance: options.protagonistAppearance ?? null,
    protagonistInFrame: options.protagonistInFrame ?? false,
  });
}

function personOf(result: SceneMaterials, entityId: string | undefined) {
  return result.people.find((person) => person.entityId === entityId);
}

function setProfileAppearance(db: Database, seeded: SeededStory, key: string, appearance: string) {
  db.run(
    sql`update entities set profile = ${JSON.stringify({ text: '', appearance })}
        where version_id = ${seeded.versionId} and id = ${seeded.ids[key]}`,
  );
}

function setSourcePara(db: Database, seeded: SeededStory, key: string, para: number) {
  db.run(
    sql`update entities set source_para = ${para}
        where version_id = ${seeded.versionId} and id = ${seeded.ids[key]}`,
  );
}

describe('sceneMaterials 段内可见性', () => {
  it('第 2 段只用第 2 段为止的称呼和上一回合的地点', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          {
            prose: '开场第一段。\n\n开场第二段，栈桥尽头站着一个人。',
            place: '旧码头',
            time: '傍晚',
            presentKeys: [],
          },
          {
            prose: [
              '第一段。',
              '第二段，撑伞的女人站在门口。',
              '第三段。',
              '第四段。',
              '第五段，她说她叫沈岚，这里是新灯塔。',
              '第六段。',
            ].join('\n\n'),
            place: '新灯塔',
            time: '夜里',
            presentKeys: [],
          },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚', profile: '说话很慢' },
        ],
        names: [
          { entity: 'lin', name: '林远', holder: 'lin', originTurn: 0, para: 1 },
          { entity: 'shen', name: '撑伞的女人', holder: 'lin', originTurn: 1, para: 2 },
          { entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 1, para: 5 },
        ],
        facts: [
          {
            key: 'meet',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角在门口遇见撑伞的女人',
            data: { stage: 'met' },
            originTurn: 1,
            para: 2,
          },
        ],
      });
      const atTwo = materials(opened.db, seeded, 1, 2, {
        protagonistInFrame: true,
        protagonistAppearance: '灰色雨衣',
      });
      expect(atTwo.paragraphs).toEqual(['第一段。', '第二段，撑伞的女人站在门口。']);
      expect(atTwo.place).toBe('旧码头');
      expect(atTwo.earlierText).toContain('开场第一段。');
      expect(atTwo.people.map((person) => person.code)).toEqual(['C1', 'C2']);
      expect(atTwo.people[0]?.isProtagonist).toBe(true);
      expect(atTwo.people[0]?.appearance).toBe('灰色雨衣');
      expect(personOf(atTwo, seeded.ids.shen)?.knownAs).toBe('撑伞的女人');
      expect(atTwo.bannedNames).toContain('沈岚');
      expect(atTwo.bannedNames).toContain('林远');
      expect(atTwo.unknownNames).toContain('沈岚');
      expect(atTwo.unknownNames).not.toContain('撑伞的女人');

      const atFive = materials(opened.db, seeded, 1, 5);
      expect(personOf(atFive, seeded.ids.shen)?.knownAs).toBe('沈岚');
      expect(atFive.place).toBe('旧码头');
      expect(atFive.place).not.toBe('新灯塔');

      const outOfFrame = materials(opened.db, seeded, 1, 2);
      expect(personOf(outOfFrame, seeded.ids.lin)).toBeUndefined();
      expect(outOfFrame.bannedNames).toContain('林远');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一回合里后来才知道的称呼在之前是未知的', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', presentKeys: [] },
          {
            prose: ['第一段。', '第二段。', '第三段。', '第四段，她自称阿岚。'].join('\n\n'),
            presentKeys: [],
          },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        names: [
          { entity: 'shen', name: '女子', holder: 'lin', originTurn: 0, para: 1 },
          { entity: 'shen', name: '阿岚', holder: 'lin', originTurn: 1, para: 4 },
        ],
      });
      const atTwo = materials(opened.db, seeded, 1, 2);
      expect(atTwo.unknownNames).toContain('阿岚');
      expect(atTwo.unknownNames).not.toContain('女子');

      const atFour = materials(opened.db, seeded, 1, 4);
      expect(atFour.unknownNames).not.toContain('阿岚');
      expect(atFour.unknownNames).not.toContain('女子');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('版本里还没进入本路线的名字也算未知', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', presentKeys: [] },
          { prose: '第一段。', presentKeys: [] },
          { prose: '以后才出现的段落。', parent: 1, presentKeys: ['future'] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'future', kind: 'character', name: '顾行', originTurn: 2 },
        ],
        names: [{ entity: 'future', name: '顾先生', holder: 'lin', originTurn: 2, para: 1 }],
      });
      const result = materials(opened.db, seeded, 1, 1);
      expect(result.unknownNames).toContain('顾行');
      expect(result.unknownNames).toContain('顾先生');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一回合里的登记与相遇都按段号先后生效', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', presentKeys: [] },
          {
            prose: ['第一段，你在走廊里遇见一个陌生人。老周站在门口。', '第二段。', '第三段，老周走过来。'].join(
              '\n\n',
            ),
            presentKeys: [],
          },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚', originTurn: 1 },
          { key: 'copy', kind: 'character', name: '周岚', originTurn: 1 },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        names: [{ entity: 'zhou', name: '老周', holder: 'lin', originTurn: 1, para: 1 }],
        facts: [
          {
            key: 'meetShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角在走廊里遇见陌生人',
            data: { stage: 'met' },
            originTurn: 1,
            para: 1,
          },
          {
            key: 'meetShenOld',
            kind: 'relation',
            subject: 'lin',
            object: 'copy',
            factKey: 'acquaintance',
            statement: '主角在走廊里遇见周岚',
            data: { stage: 'met' },
            originTurn: 1,
            para: 1,
          },
          {
            key: 'meetZhou',
            kind: 'relation',
            subject: 'lin',
            object: 'zhou',
            factKey: 'acquaintance',
            statement: '主角在第三段才走近老周',
            data: { stage: 'met' },
            originTurn: 1,
            para: 3,
          },
        ],
      });
      setSourcePara(opened.db, seeded, 'shen', 3);
      opened.db.run(
        sql`update entities set source_para = null
            where version_id = ${seeded.versionId} and id = ${seeded.ids.copy}`,
      );

      const atTwo = materials(opened.db, seeded, 1, 2);
      expect(personOf(atTwo, seeded.ids.shen)).toBeUndefined();
      expect(personOf(atTwo, seeded.ids.copy)).toBeUndefined();
      expect(personOf(atTwo, seeded.ids.zhou)).toBeUndefined();

      const atThree = materials(opened.db, seeded, 1, 3);
      expect(personOf(atThree, seeded.ids.shen)?.entityId).toBe(seeded.ids.shen);
      expect(personOf(atThree, seeded.ids.zhou)?.entityId).toBe(seeded.ids.zhou);
      expect(personOf(atThree, seeded.ids.copy)).toBeUndefined();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一回合里出处缺失的称呼不被采用', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', presentKeys: ['shen'] },
          { prose: ['第一段。', '第二段。', '第三段。'].join('\n\n'), presentKeys: ['shen'] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        names: [
          { entity: 'shen', name: '撑伞的女人', holder: 'lin', originTurn: 0, para: 1 },
          { entity: 'shen', name: '阿岚', holder: 'lin', originTurn: 1 },
        ],
      });
      const result = materials(opened.db, seeded, 1, 3);
      expect(personOf(result, seeded.ids.shen)?.knownAs).toBe('撑伞的女人');
      expect(result.unknownNames).toContain('阿岚');
      expect(result.unknownNames).not.toContain('撑伞的女人');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只听说过的人不进入镜头材料', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', presentKeys: [] },
          { prose: ['第一段，你听说有个叫沈岚的人。老周站在门口。', '第二段。'].join('\n\n'), presentKeys: [] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        names: [
          { entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 1, para: 1 },
          { entity: 'zhou', name: '老周', holder: 'lin', originTurn: 1, para: 1 },
        ],
        facts: [
          {
            key: 'heard',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角只听说沈岚这个人',
            data: { stage: 'heard_of' },
            originTurn: 1,
            para: 1,
          },
          {
            key: 'met',
            kind: 'relation',
            subject: 'lin',
            object: 'zhou',
            factKey: 'acquaintance',
            statement: '主角当面见到老周',
            data: { stage: 'met' },
            originTurn: 1,
            para: 1,
          },
        ],
      });
      const result = materials(opened.db, seeded, 1, 2);
      expect(personOf(result, seeded.ids.shen)).toBeUndefined();
      expect(personOf(result, seeded.ids.zhou)?.entityId).toBe(seeded.ids.zhou);
      expect(result.bannedNames).toContain('老周');
      expect(result.bannedNames).not.toContain('沈岚');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('真名清单去掉首尾空白，跳过不足两个字符的名字', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', presentKeys: ['shen', 'short'] },
          { prose: '第一段。\n\n第二段。', presentKeys: ['shen', 'short'] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '  沈岚  ' },
          { key: 'short', kind: 'character', name: ' 阿 ' },
        ],
      });
      const result = materials(opened.db, seeded, 1, 2);
      expect(result.bannedNames).toContain('沈岚');
      expect(result.bannedNames).not.toContain('  沈岚  ');
      expect(result.bannedNames).not.toContain('阿');
      expect(result.bannedNames).toContain('林远');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('不按回合结束时的人在场记录推断', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', place: '大厅', presentKeys: ['shen'] },
          {
            prose: ['第一段。', '第二段，只有林远一个人。'].join('\n\n'),
            place: '大厅',
            presentKeys: ['shen', 'zhou'],
          },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        facts: [
          {
            key: 'metShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角在大厅见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'metZhou',
            kind: 'relation',
            subject: 'lin',
            object: 'zhou',
            factKey: 'acquaintance',
            statement: '主角在大厅见到老周',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
        ],
      });
      const result = materials(opened.db, seeded, 1, 2);
      expect(personOf(result, seeded.ids.shen)?.entityId).toBe(seeded.ids.shen);
      expect(personOf(result, seeded.ids.zhou)).toBeUndefined();
      expect(result.people).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('上一回合正文超出上限时保留最近的段', () => {
    const { temp, opened } = setup();
    try {
      const first = '甲'.repeat(1_200);
      const second = '乙'.repeat(1_200);
      const longSingle = '丙'.repeat(2_500);
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: `${first}\n\n${second}`, presentKeys: [] },
          { prose: '第一段。', presentKeys: [] },
          { prose: '第一段。', presentKeys: [] },
        ],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      expect(SCENE_EARLIER_TEXT_MAX_CHARS).toBe(2_000);
      expect(materials(opened.db, seeded, 1, 1).earlierText).toBe(second);

      opened.db.run(
        sql`update turns set prose = ${longSingle}
            where id = ${seeded.turnIds[1] ?? ''}`,
      );
      const truncated = materials(opened.db, seeded, 2, 1).earlierText ?? '';
      expect(Array.from(truncated)).toHaveLength(SCENE_EARLIER_TEXT_MAX_CHARS);
      expect(truncated).toBe('丙'.repeat(2_000));
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('sceneMaterials 形象与可见身份', () => {
  it('换装带 same_visible_identity 时沿用更早那条特征的 id', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', place: '大厅', presentKeys: ['shen', 'zhou'] },
          { prose: '第一段。\n\n第二段，两人都换了衣服。', place: '大厅', presentKeys: ['shen', 'zhou'] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        facts: [
          {
            key: 'metShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角在大厅见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'metZhou',
            kind: 'relation',
            subject: 'lin',
            object: 'zhou',
            factKey: 'acquaintance',
            statement: '主角在大厅见到老周',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'shenOld',
            kind: 'trait',
            subject: 'shen',
            factKey: 'appearance',
            statement: '深灰旧风衣',
            originTurn: 0,
            para: 1,
          },
          {
            key: 'shenNew',
            kind: 'trait',
            subject: 'shen',
            factKey: 'appearance',
            statement: '白围裙',
            data: { same_visible_identity: 1 },
            originTurn: 1,
            para: 2,
          },
          {
            key: 'zhouOld',
            kind: 'trait',
            subject: 'zhou',
            factKey: 'appearance',
            statement: '旧制服',
            originTurn: 0,
            para: 1,
          },
          {
            key: 'zhouNew',
            kind: 'trait',
            subject: 'zhou',
            factKey: 'appearance',
            statement: '新制服',
            originTurn: 1,
            para: 2,
          },
        ],
      });
      const result = materials(opened.db, seeded, 1, 2);
      expect(personOf(result, seeded.ids.shen)?.appearance).toBe('白围裙');
      expect(personOf(result, seeded.ids.shen)?.identityFactId).toBe(seeded.ids.shenOld);
      expect(personOf(result, seeded.ids.zhou)?.appearance).toBe('新制服');
      expect(personOf(result, seeded.ids.zhou)?.identityFactId).toBe(seeded.ids.zhouNew);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只有别人知情的形象不被采用，回落到档案形象', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', place: '大厅', presentKeys: ['shen', 'zhou'] },
          { prose: '第一段。\n\n第二段。', place: '大厅', presentKeys: ['shen', 'zhou'] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        facts: [
          {
            key: 'metShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角在大厅见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'metZhou',
            kind: 'relation',
            subject: 'lin',
            object: 'zhou',
            factKey: 'acquaintance',
            statement: '主角在大厅见到老周',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'shenLook',
            kind: 'trait',
            subject: 'shen',
            factKey: 'appearance',
            statement: '白围裙',
            originTurn: 0,
            para: 1,
          },
          {
            key: 'zhouLook',
            kind: 'trait',
            subject: 'zhou',
            factKey: 'appearance',
            statement: '新制服',
            originTurn: 0,
            para: 1,
          },
        ],
        knowledge: [{ fact: 'shenLook', holder: 'zhou', level: 'confirmed', originTurn: 0, para: 1 }],
      });
      setProfileAppearance(opened.db, seeded, 'shen', '深灰旧风衣');
      setProfileAppearance(opened.db, seeded, 'zhou', '旧制服');
      const result = materials(opened.db, seeded, 1, 2);
      expect(personOf(result, seeded.ids.shen)?.appearance).toBe('深灰旧风衣');
      expect(personOf(result, seeded.ids.shen)?.identityFactId).toBeNull();
      expect(personOf(result, seeded.ids.zhou)?.appearance).toBe('新制服');
      expect(personOf(result, seeded.ids.zhou)?.identityFactId).toBe(seeded.ids.zhouLook);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一回合里后来才确认的形象，在之前回落到档案形象', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', place: '大厅', presentKeys: ['shen'] },
          { prose: '第一段。\n\n第二段。\n\n第三段。', place: '大厅', presentKeys: ['shen'] },
        ],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        facts: [
          {
            key: 'metShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '主角在大厅见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'shenLook',
            kind: 'trait',
            subject: 'shen',
            factKey: 'appearance',
            statement: '白围裙',
            originTurn: 0,
            para: 1,
          },
        ],
        knowledge: [{ fact: 'shenLook', holder: 'lin', level: 'confirmed', originTurn: 1, para: 3 }],
      });
      setProfileAppearance(opened.db, seeded, 'shen', '深灰旧风衣');
      expect(personOf(materials(opened.db, seeded, 1, 2), seeded.ids.shen)?.appearance).toBe('深灰旧风衣');
      expect(personOf(materials(opened.db, seeded, 1, 3), seeded.ids.shen)?.appearance).toBe('白围裙');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('sceneMaterials 开场', () => {
  it('没有公开开场处境时跳过开场图', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          {
            prose: '第一段，码头上没有人。\n\n第二段，灯塔亮着。',
            place: '码头',
            presentKeys: [],
          },
        ],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const result = materials(opened.db, seeded, 0, 0, {
        protagonistInFrame: true,
        protagonistAppearance: '灰色雨衣',
      });
      expect(result.skip).toBe(true);
      expect(result.paragraphs).toEqual([]);
      expect(result.earlierText).toBeNull();
      expect(result.place).toBeNull();

      const laterParagraph = materials(opened.db, seeded, 0, 1);
      expect(laterParagraph.skip).toBe(false);
      expect(laterParagraph.paragraphs).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('有公开开场处境时只取处境文字，不用开场段和结束场景的地点', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const inFrame = materials(opened.db, seeded, 0, 0, {
        protagonistInFrame: true,
        protagonistAppearance: '灰色雨衣',
      });
      expect(inFrame.skip).toBe(false);
      expect(inFrame.paragraphs).toEqual([]);
      expect(inFrame.earlierText).toBe('最后一班船靠岸时，镇上停了电');
      expect(inFrame.earlierText).not.toContain('码头');
      expect(inFrame.place).toBeNull();
      expect(inFrame.people).toHaveLength(1);
      expect(inFrame.people[0]?.isProtagonist).toBe(true);
      expect(inFrame.people[0]?.code).toBe('C1');
      expect(inFrame.people[0]?.appearance).toBe('灰色雨衣');
      expect(inFrame.bannedNames).toContain('新来的邮差');
      expect(inFrame.unknownNames).toContain('林潮');

      const outOfFrame = materials(opened.db, seeded, 0, 0, {
        protagonistInFrame: false,
        protagonistAppearance: '灰色雨衣',
      });
      expect(outOfFrame.people).toEqual([]);
      expect(outOfFrame.bannedNames).toContain('新来的邮差');

      const noPublicAppearance = materials(opened.db, seeded, 0, 0, {
        protagonistInFrame: true,
        protagonistAppearance: null,
      });
      expect(noPublicAppearance.people).toEqual([]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场回合内的段落没有上一回合可用', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '第一段。\n\n第二段。', place: '码头', presentKeys: [] }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const result = materials(opened.db, seeded, 0, 2);
      expect(result.skip).toBe(false);
      expect(result.paragraphs).toEqual(['第一段。', '第二段。']);
      expect(result.earlierText).toBeNull();
      expect(result.place).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
