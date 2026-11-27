import type { DesktopEventEntry, DesktopLogEntry, DesktopSampleEntry } from '@unwritten/contracts/desktop';

export const DESKTOP_LOG_BUFFER_MAX = 64;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface DesktopDiagnostics {
  record(entry: DistributiveOmit<DesktopEventEntry, 'kind'>): void;
  sample(entry: DistributiveOmit<DesktopSampleEntry, 'kind'>): void;
  attach(send: (entry: DesktopLogEntry) => void): void;
  detach(): void;
}

export function createDesktopDiagnostics(): DesktopDiagnostics {
  let send: ((entry: DesktopLogEntry) => void) | null = null;
  let buffer: DesktopLogEntry[] = [];
  let dropped = 0;

  const push = (entry: DesktopLogEntry): void => {
    if (send) {
      send(entry);
      return;
    }
    if (buffer.length >= DESKTOP_LOG_BUFFER_MAX) {
      dropped += 1;
      return;
    }
    buffer.push(entry);
  };

  return {
    record(entry) {
      push({ ...entry, kind: 'event' });
    },
    sample(entry) {
      push({ ...entry, kind: 'sample' });
    },
    attach(next) {
      send = next;
      if (dropped > 0) {
        next({ kind: 'event', event: 'desktop.dropped', level: 'warn', data: { count: dropped } });
        dropped = 0;
      }
      const pending = buffer;
      buffer = [];
      for (const entry of pending) next(entry);
    },
    detach() {
      send = null;
    },
  };
}
