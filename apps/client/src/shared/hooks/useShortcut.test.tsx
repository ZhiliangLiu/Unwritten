import { act } from 'react';
import { renderHook } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMacPlatform } from './usePlatform.ts';
import { useShortcut } from './useShortcut.ts';

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

const modKey = isMacPlatform() ? 'metaKey' : 'ctrlKey';

describe('useShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('组字时不触发', async () => {
    const handler = vi.fn();
    await renderHook(() => useShortcut({ key: ',', mod: true }, handler));
    press({ key: ',', [modKey]: true, isComposing: true });
    expect(handler).not.toHaveBeenCalled();
    press({ key: ',', [modKey]: true, isComposing: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('没有修饰键时不触发', async () => {
    const handler = vi.fn();
    await renderHook(() => useShortcut({ key: ',', mod: true }, handler));
    press({ key: ',' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('匹配后阻止默认行为', async () => {
    const handler = vi.fn();
    await renderHook(() => useShortcut({ key: ',', mod: true }, handler));
    const event = press({ key: ',', [modKey]: true });
    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('enabled 为 false 时不挂监听', async () => {
    const handler = vi.fn();
    await renderHook(() => useShortcut({ key: ',', mod: true }, handler, { enabled: false }));
    act(() => {
      press({ key: ',', [modKey]: true });
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
