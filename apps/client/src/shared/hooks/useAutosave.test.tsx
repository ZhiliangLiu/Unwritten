import { act } from 'react';
import { useState } from 'react';
import { renderHook } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave.ts';

interface Props {
  value: string;
  savedValue: string;
  save(value: string): Promise<void>;
}

describe('useAutosave', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('防抖后保存一次', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const { rerender } = await renderHook(
      (props?: Props) =>
        useAutosave({ ...(props ?? { value: '', savedValue: '', save }), delayMs: 300, enabled: true }),
      { initialProps: { value: 'a', savedValue: '', save } },
    );
    await rerender({ value: 'ab', savedValue: '', save });
    await rerender({ value: 'abc', savedValue: '', save });
    await rerender({ value: 'abcd', savedValue: '', save });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abcd');
  });

  it('flush 立即保存', async () => {
    vi.useFakeTimers();
    const save = vi.fn<(value: string) => Promise<void>>(async () => {});
    const { result } = await renderHook(() => {
      const [savedValue, setSavedValue] = useState('');
      return useAutosave({
        value: 'abc',
        savedValue,
        save: async (value) => {
          await save(value);
          setSavedValue(value);
        },
        delayMs: 5_000,
        enabled: true,
      });
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(result.current.status).toBe('saved');
  });

  it('保存失败进入 error', async () => {
    vi.useFakeTimers();
    const failure = new Error('save failed');
    const save = vi.fn(async () => {
      throw failure;
    });
    const { result } = await renderHook(() =>
      useAutosave({ value: 'abc', savedValue: '', save, delayMs: 300, enabled: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(failure);
  });
});
