import { describe, expect, it } from 'vitest';
import { CoreEventSchema } from '../events.ts';
import { STYLE_PRESETS } from './illustration.ts';
import { AspectSchema, IdleMinutesSchema, IMAGE_TIERS, ImageTierPreferenceSchema } from './image.ts';
import { StartPlaythroughInputSchema, TurnViewSchema } from './play.ts';

const turnId = '00000000-0000-4000-8000-000000000001';
const workId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';

describe('image schemas', () => {
  it('比例只接受一到三位的正整数比', () => {
    for (const value of ['3:2', '16:9', '1:1']) {
      expect(AspectSchema.safeParse(value).success, value).toBe(true);
    }
    for (const value of ['0:1', '3:2:1', 'a:b', '1000:1', ' 3:2']) {
      expect(AspectSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('档位偏好接受服务默认', () => {
    expect(ImageTierPreferenceSchema.safeParse('default').success).toBe(true);
    expect(ImageTierPreferenceSchema.safeParse('4k').success).toBe(false);
  });

  it('空闲分钟数的边界', () => {
    for (const value of [4, 721, 30.5]) {
      expect(IdleMinutesSchema.safeParse(value).success, String(value)).toBe(false);
    }
    for (const value of [5, 720]) {
      expect(IdleMinutesSchema.safeParse(value).success, String(value)).toBe(true);
    }
  });

  it('回合视图兼容没有插图的旧对象', () => {
    const parsed = TurnViewSchema.parse({
      id: turnId,
      originRequest: null,
      depth: 1,
      action: { text: '把船票放在柜台上', optionIndex: 1 },
      paragraphs: ['雾还没散。'],
      options: [{ text: '看看窗外', hint: null }],
      createdAt: 1,
    });
    expect(parsed.illustration).toBeNull();
  });

  it('起点输入兼容没有插图设置的旧输入', () => {
    expect(
      StartPlaythroughInputSchema.safeParse({
        workId,
        playthroughId: requestId,
        protagonist: {},
      }).success,
    ).toBe(true);
  });

  it('事件里的服务 id 不能为空', () => {
    expect(CoreEventSchema.safeParse({ type: 'image.service_state', serviceId: '' }).success).toBe(false);
    expect(CoreEventSchema.safeParse({ type: 'image.service_state', serviceId: 'image-a-012345' }).success).toBe(true);
  });

  it('枚举字面量与设计一致', () => {
    expect(IMAGE_TIERS).toEqual(['720', '1k', '2k']);
    expect(STYLE_PRESETS).toEqual(['watercolor', 'ink', 'anime', 'painterly', 'cinematic']);
  });
});
