import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type AutosavePhase = 'idle' | 'saving' | 'saved' | 'error';

export function useAutosave<T>(input: {
  value: T;
  savedValue: T;
  save: (value: T) => Promise<void>;
  delayMs: number;
  enabled: boolean;
  isEqual?: (value: T, saved: T) => boolean;
}): { status: AutosaveStatus; error: unknown; flush(): Promise<void> } {
  const isEqual = input.isEqual ?? Object.is;
  const latestRef = useRef(input);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const lastSavedRef = useRef(input.savedValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<AutosavePhase>('idle');
  const [lastSaved, setLastSaved] = useState<{ value: T } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    latestRef.current = input;
  });

  useEffect(() => {
    lastSavedRef.current = input.savedValue;
  }, [input.savedValue]);

  const runSave = useCallback((): Promise<void> => {
    const run = chainRef.current.then(async () => {
      const current = latestRef.current;
      const value = current.value;
      const same = current.isEqual ?? Object.is;
      if (same(value, lastSavedRef.current)) return;
      setPhase('saving');
      setError(null);
      try {
        await current.save(value);
        lastSavedRef.current = value;
        setLastSaved({ value });
        setPhase('saved');
      } catch (cause) {
        setError(cause);
        setPhase('error');
      }
    });
    chainRef.current = run.catch(() => {});
    return run;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    await runSave();
  }, [clearTimer, runSave]);

  useEffect(() => {
    if (!input.enabled || isEqual(input.value, input.savedValue)) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, input.delayMs);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [input.delayMs, input.enabled, input.savedValue, input.value, isEqual, runSave]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const current = latestRef.current;
      if (!current.enabled || (current.isEqual ?? Object.is)(current.value, current.savedValue)) return;
      chainRef.current = chainRef.current.then(() => current.save(current.value)).catch(() => {});
    };
  }, []);

  const unsaved =
    !isEqual(input.value, input.savedValue) && (lastSaved === null || !isEqual(input.value, lastSaved.value));
  const status: AutosaveStatus =
    unsaved && input.enabled && phase !== 'saving' && phase !== 'error' ? 'pending' : phase;

  return { status, error, flush };
}
