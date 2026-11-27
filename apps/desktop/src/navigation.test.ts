import { describe, expect, it } from 'vitest';
import { decideNavigation, decideWindowOpen } from './navigation.ts';

const allowed = 'http://127.0.0.1:4317';

describe('decideNavigation', () => {
  it('同源放行', () => {
    expect(decideNavigation(`${allowed}/play#token=x`, allowed)).toEqual({ action: 'allow' });
  });

  it('https 交给系统浏览器', () => {
    expect(decideNavigation('https://example.com/a', allowed)).toEqual({
      action: 'external',
      url: 'https://example.com/a',
    });
  });

  it('本地文件和脚本地址丢弃', () => {
    expect(decideNavigation('file:///etc/passwd', allowed)).toEqual({ action: 'drop' });
    expect(decideNavigation('javascript:alert(1)', allowed)).toEqual({ action: 'drop' });
    expect(decideNavigation('unwritten://x', allowed)).toEqual({ action: 'drop' });
  });
});

describe('decideWindowOpen', () => {
  it('新窗口即使同源也丢弃', () => {
    expect(decideWindowOpen(`${allowed}/play`, allowed)).toEqual({ action: 'drop' });
  });

  it('外部地址交给系统浏览器', () => {
    expect(decideWindowOpen('https://example.com/a', allowed)).toEqual({
      action: 'external',
      url: 'https://example.com/a',
    });
  });
});
