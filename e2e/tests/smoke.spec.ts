import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

let core: ChildProcess;
let dataDir: string;
let url: string;

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'unwritten-e2e-'));
  core = spawn(process.execPath, [corePath, '--data-dir', dataDir, '--log-level', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`core did not start: ${output}`)), 20_000);
    core.stdout?.on('data', (chunk) => {
      output += String(chunk);
      const match = /UNWRITTEN_CORE_URL=(\S+)/.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    core.once('exit', (code) => reject(new Error(`core exited early: ${code}`)));
  });
});

test.afterAll(async () => {
  core?.kill('SIGTERM');
  await new Promise((resolve) => core?.once('exit', resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test('打开作品库并新建草稿', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建故事' })).toBeVisible();
  await page.getByRole('button', { name: '新建故事' }).click();
  await expect(page.getByRole('heading', { name: '写背景' })).toBeVisible();
});
