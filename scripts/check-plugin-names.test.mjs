import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCANNER = join(dirname(fileURLToPath(import.meta.url)), 'check-plugin-names.mjs');

function withRepository(files) {
  const root = mkdtempSync(join(tmpdir(), 'uw-plugin-names-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  return root;
}

function runScanner(root) {
  try {
    const output = execFileSync(process.execPath, [SCANNER, root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    return { status: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

void test('apps 和 packages 都干净时通过，并报出扫描的文件数', (t) => {
  const root = withRepository({ 'apps/a.ts': 'export const a = 1;\n', 'packages/b.ts': 'export const b = 2;\n' });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = runScanner(root);

  assert.equal(status, 0);
  assert.match(output, /插件名扫描通过（2 个文件）/);
});

void test('packages 里的插件名被指到文件和行号', (t) => {
  const root = withRepository({
    'apps/a.ts': 'export const a = 1;\n',
    'packages/b.ts': "const x = 'ComfyUI';\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = runScanner(root);

  assert.equal(status, 1);
  assert.match(output, /packages\/b\.ts:1:/);
});

void test('plugins 目录不在扫描范围内', (t) => {
  const root = withRepository({ 'apps/a.ts': 'export const a = 1;\n', 'plugins/c.py': "name = 'comfy'\n" });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { status, output } = runScanner(root);

  assert.equal(status, 0);
  assert.match(output, /插件名扫描通过（1 个文件）/);
});

void test('未被 git 跟踪的文件不在扫描范围内', (t) => {
  const root = withRepository({ 'apps/a.ts': 'export const a = 1;\n', 'packages/b.ts': 'export const b = 2;\n' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'apps/untracked.ts'), "export const c = 'colab';\n");

  const { status, output } = runScanner(root);

  assert.equal(status, 0);
  assert.match(output, /插件名扫描通过（2 个文件）/);
});
