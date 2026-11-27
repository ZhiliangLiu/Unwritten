import { describe, expect, it } from 'vitest';
import type { VersionMeta } from './meta.ts';
import { isPlanConfirmed, readPlan, readPublicSetting, readSettings } from './plan.ts';

describe('plan store', () => {
  it('旧的公开设定项读作 summary', () => {
    const meta = {
      background: '',
      plan: { items: [{ id: 'public_setting', text: '雾港', source: 'ai' }] },
    } as unknown as VersionMeta;
    const plan = readPlan(meta);
    expect(plan?.items).toEqual([
      { kind: 'summary', key: 'public_setting', id: 'public_setting', text: '雾港', source: 'ai' },
    ]);
    expect(readPublicSetting(meta)).toBe('雾港');
  });

  it('没有设定时补默认值', () => {
    const settings = readSettings({ background: '' });
    expect(settings.cast.mode).toBe('fixed');
    expect(settings.world.rev).toBe(0);
  });

  it('改过草稿后方案不再算确认', () => {
    const meta: VersionMeta = {
      background: '',
      plan: { items: [], conflicts: [], confirmedRev: 4 },
    };
    expect(isPlanConfirmed(meta, 4)).toBe(true);
    expect(isPlanConfirmed(meta, 5)).toBe(false);
  });

  it('坏掉的方案项被丢弃，其余保留', () => {
    const meta = {
      background: '',
      plan: {
        items: [
          { kind: 'summary', key: 'identity', id: 'ok', text: '守钟人', source: 'author' },
          { kind: 'summary', key: 'identity', id: 'bad' },
        ],
      },
    } as unknown as VersionMeta;
    const plan = readPlan(meta);
    expect(plan?.items.map((item) => item.id)).toEqual(['ok']);
  });
});
