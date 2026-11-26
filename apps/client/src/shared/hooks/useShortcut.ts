import { useEffect } from 'react';
import { isMacPlatform } from './usePlatform.ts';

export function useShortcut(
  shortcut: { key: string; mod: boolean },
  handler: (event: KeyboardEvent) => void,
  options?: { enabled?: boolean },
): void {
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const mac = isMacPlatform();
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== shortcut.key) return;
      const primary = mac ? event.metaKey : event.ctrlKey;
      const secondary = mac ? event.ctrlKey : event.metaKey;
      if (shortcut.mod) {
        if (!primary || secondary || event.altKey || event.shiftKey) return;
      } else if (primary || secondary || event.altKey) {
        return;
      }
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled, handler, shortcut.key, shortcut.mod]);
}
