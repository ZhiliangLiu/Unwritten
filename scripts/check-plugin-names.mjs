#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_NAMES = ['comfy', 'colab', 'tailscale', 'strata'];

const SCANNED_DIRECTORIES = ['apps', 'packages'];
const SKIPPED_FILENAMES = new Set(['pnpm-lock.yaml']);
const SKIPPED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.icns', '.ico', '.woff2']);
const PLUGIN_NAME_PATTERN = new RegExp(PLUGIN_NAMES.join('|'), 'i');

function listScannedFiles(root) {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', ...SCANNED_DIRECTORIES], { encoding: 'utf8' });
  return tracked
    .split('\n')
    .filter(Boolean)
    .filter((file) => !SKIPPED_FILENAMES.has(file.slice(file.lastIndexOf('/') + 1)))
    .filter((file) => !SKIPPED_EXTENSIONS.has(extname(file).toLowerCase()));
}

export function findPluginNames(root) {
  const hits = [];
  let scanned = 0;
  for (const file of listScannedFiles(root)) {
    const absolutePath = join(root, file);
    if (!existsSync(absolutePath)) continue;
    scanned += 1;
    const lines = readFileSync(absolutePath, 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (PLUGIN_NAME_PATTERN.test(line)) hits.push(`${file}:${index + 1}: ${line}`);
    }
  }
  return { hits, scanned };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const { hits, scanned } = findPluginNames(root);
  for (const hit of hits) console.log(hit);
  console.log(hits.length === 0 ? `插件名扫描通过（${scanned} 个文件）` : `发现 ${hits.length} 处插件专属名字`);
  process.exit(hits.length === 0 ? 0 : 1);
}
