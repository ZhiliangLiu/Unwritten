import { describe, expect, it } from 'vitest';
import { PreviewSchema } from './works.ts';

describe('works schemas', () => {
  it('旧预览没有 cast 时补成空数组', () => {
    const preview = PreviewSchema.parse({
      title: '灯',
      blurb: '简介',
      publicSetting: '设定',
      prose: '正文',
      options: [{ text: '行动' }],
      scene: { place: '渡口', time: '夜里' },
      language: 'zh-CN',
    });
    expect(preview.cast).toEqual([]);
  });
});
