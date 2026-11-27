#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(repo, 'apps', 'desktop', 'release');

function findApp() {
  const preferred = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
  for (const directory of [preferred, 'mac', 'mac-arm64']) {
    const app = join(releaseDir, directory, 'Unwritten.app');
    if (existsSync(join(app, 'Contents', 'Resources', 'core', 'dist', 'main.js'))) return app;
  }
  return null;
}

function sourceChangedSince(marker) {
  const output = execFileSync(
    'find',
    [
      'apps',
      'packages',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      '-path',
      '*/node_modules',
      '-prune',
      '-o',
      '-path',
      '*/dist',
      '-prune',
      '-o',
      '-path',
      '*/release',
      '-prune',
      '-o',
      '-path',
      '*/.stage',
      '-prune',
      '-o',
      '-path',
      '*/.turbo',
      '-prune',
      '-o',
      '-type',
      'f',
      '-newer',
      marker,
      '-not',
      '-name',
      '*.test.ts',
      '-not',
      '-name',
      '*.test.tsx',
      '-not',
      '-name',
      '*.md',
      '-print',
      '-quit',
    ],
    { cwd: repo, encoding: 'utf8' },
  );
  return output.trim().length > 0;
}

let app = findApp();
const changed = app === null ? true : sourceChangedSince(join(app, 'Contents', 'Resources', 'core', 'dist', 'main.js'));

if (changed) {
  if (app !== null) {
    try {
      execFileSync('osascript', ['-e', 'tell application "Unwritten" to quit'], { stdio: 'ignore' });
    } catch {}
  }
  execFileSync('pnpm', ['--filter', '@unwritten/desktop', 'package'], { cwd: repo, stdio: 'inherit' });
  app = findApp();
}

if (app === null) {
  process.stderr.write('Unwritten.app was not produced\n');
  process.exit(1);
}

execFileSync('open', [app], { stdio: 'inherit' });
