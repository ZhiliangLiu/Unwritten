import { describe, expect, it } from 'vitest';
import { changeLines } from '../test-support/llm-steps.ts';
import { parseCastArgs } from './cast-tool.ts';

const slots = [
  { index: '1', slotId: 'slot-one' },
  { index: '2', slotId: 'slot-two' },
];

describe('parseCastArgs', () => {
  it('两个位置各一行时通过', () => {
    const parsed = parseCastArgs(
      {
        cast: changeLines(
          { slot: '1', name: '陶枝', known_as: '提灯的人', profile: '守灯人' },
          { slot: '2', name: '祁望', known_as: '', profile: '掌柜' },
        ),
      },
      { slots, takenNames: [] },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.map((member) => member.slotId)).toEqual(['slot-one', 'slot-two']);
      expect(parsed.value[1]?.knownAs).toBeNull();
    }
  });

  it('每个位置正好一行', () => {
    const missing = parseCastArgs(
      { cast: changeLines({ slot: '1', name: '陶枝', known_as: '', profile: '' }) },
      { slots, takenNames: [] },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.join('\n')).toContain('人物位置 2');

    const duplicated = parseCastArgs(
      {
        cast: changeLines(
          { slot: '1', name: '陶枝', known_as: '', profile: '' },
          { slot: '1', name: '祁望', known_as: '', profile: '' },
        ),
      },
      { slots, takenNames: [] },
    );
    expect(duplicated.ok).toBe(false);
  });

  it('不能和作者设定的人物同名', () => {
    const parsed = parseCastArgs(
      {
        cast: changeLines(
          { slot: '1', name: '林潮', known_as: '', profile: '' },
          { slot: '2', name: '祁望', known_as: '', profile: '' },
        ),
      },
      { slots, takenNames: ['林潮'] },
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('林潮');
  });

  it('人物行可以带形象，不合格时丢弃且不报错', () => {
    const parsed = parseCastArgs(
      {
        cast: changeLines(
          { slot: '1', name: '陶枝', known_as: '', profile: '', appearance: ' 短卷发，深色短外套 ' },
          { slot: '2', name: '祁望', known_as: '', profile: '', appearance: '浅色\n雨衣' },
        ),
      },
      { slots, takenNames: [] },
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value[0]?.appearance).toBe('短卷发，深色短外套');
      expect(parsed.value[1]?.appearance).toBeNull();
    }
  });
});
