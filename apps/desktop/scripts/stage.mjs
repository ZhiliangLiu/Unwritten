#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stage = join(repo, 'apps', 'desktop', '.stage');
const coreStage = join(stage, 'core');
const clientStage = join(stage, 'client');

rmSync(stage, { recursive: true, force: true });

execFileSync('pnpm', ['--filter', '@unwritten/core', 'build'], { cwd: repo, stdio: 'inherit' });
execFileSync('pnpm', ['--filter', '@unwritten/client', 'build'], { cwd: repo, stdio: 'inherit' });
execFileSync('pnpm', ['--filter', '@unwritten/core', 'deploy', '--prod', '--config.node-linker=hoisted', coreStage], {
  cwd: repo,
  stdio: 'inherit',
});

const keptCoreEntries = new Set(['dist', 'node_modules', 'package.json']);
for (const entry of readdirSync(coreStage)) {
  if (!keptCoreEntries.has(entry)) rmSync(join(coreStage, entry), { recursive: true, force: true });
}
rmSync(join(coreStage, 'node_modules', '.bin'), { recursive: true, force: true });

cpSync(join(repo, 'apps', 'client', 'dist'), clientStage, { recursive: true });

const requiredEntries = [
  join(coreStage, 'dist', 'main.js'),
  join(coreStage, 'dist', 'migrations'),
  join(coreStage, 'dist', 'diagnostic-migrations'),
  join(clientStage, 'index.html'),
];
const missingEntries = requiredEntries.filter((entry) => !existsSync(entry));
for (const entry of missingEntries) {
  process.stderr.write(`missing ${relative(stage, entry)}\n`);
}
if (missingEntries.length > 0) process.exit(1);
