#!/usr/bin/env node
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = new Set([
  '.turbo',
  'apps/desktop/.stage',
  'apps/desktop/dist',
  'apps/desktop/release',
  'apps/client/dist',
  'apps/client/src/theme/media.css',
  'apps/client/src/theme/themes',
  'apps/client/src/theme/tokens.css',
  'packages/core/dist',
]);

for (const root of ['apps', 'packages', 'e2e']) {
  for (const entry of readdirSync(join(repo, root), { withFileTypes: true })) {
    if (entry.isDirectory()) paths.add(`${root}/${entry.name}/.turbo`);
  }
}

for (const path of paths) {
  rmSync(join(repo, path), { recursive: true, force: true });
}
