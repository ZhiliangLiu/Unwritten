import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempDataDir(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'unwritten-'));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
