import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startFakeOpenAiServer } from '../../packages/core/src/test-support/fake-openai-server.ts';
import { proposePreviewStep, proposeTurnStep } from '../../packages/core/src/test-support/llm-steps.ts';

const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

let dataDir: string;
let core: ChildProcess;
let url: string;
let server: Awaited<ReturnType<typeof startFakeOpenAiServer>>;

async function boot(): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [corePath, '--data-dir', dataDir, '--log-level', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`core did not start: ${output}`)), 20_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += String(chunk);
      const match = /UNWRITTEN_CORE_URL=(\S+)/.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => reject(new Error(`core exited early: ${code}`)));
  });
  return { process: child, url };
}

async function stop(process: ChildProcess): Promise<void> {
  process.kill('SIGTERM');
  await new Promise((resolve) => process.once('exit', resolve));
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'unwritten-full-'));
  server = await startFakeOpenAiServer();
  const started = await boot();
  core = started.process;
  url = started.url;
});

test.afterAll(async () => {
  if (core) await stop(core);
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('从界面配置模型、创作、连续游玩并重启续玩', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('link', { name: '设置' }).click();
  await page.getByLabel('端点名称').fill('测试端点');
  await page.getByLabel('接口地址').fill(server.baseUrl);
  await page.getByLabel('模型 ID').fill('test-model');
  await page.getByRole('button', { name: '保存端点' }).click();
  await expect(page.getByRole('heading', { name: '测试端点' })).toBeVisible();

  await page.getByRole('link', { name: '作品库' }).click();
  await page.getByRole('button', { name: '新建故事' }).click();
  await page.getByRole('textbox', { name: /故事背景/ }).fill('雨夜修钟铺');
  server.enqueue(
    proposePreviewStep({
      title: '雨夜修钟铺',
      blurb: '一个雨夜，你在钟铺里等一个人。',
      publicSetting: '老城的钟铺，雨下了一整夜。',
      prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
      options: ['去开门', '继续修钟'],
      place: '钟铺',
      time: '深夜',
      language: 'zh-CN',
    }),
  );
  await page.getByRole('button', { name: '生成开场预览' }).click();
  await expect(page.getByRole('heading', { name: '预览开场' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('雨声盖住钟声。')).toBeVisible();
  await page.getByRole('button', { name: '采用开场并存入作品库' }).click();

  await expect(page.getByText('雨声盖住钟声。')).toBeVisible();
  server.enqueue(
    proposeTurnStep({
      prose: '你推开门。雨里没有人。',
      options: ['关上门', '走进雨里'],
      scene: { place: '门外', time: '深夜', present: [] },
    }),
  );
  await page.getByRole('textbox', { name: '你的行动' }).fill('推门');
  await page.getByRole('textbox', { name: '你的行动' }).press('Enter');
  await expect(page.getByText('你推开门。雨里没有人。')).toBeVisible({ timeout: 20_000 });

  await stop(core);
  const restarted = await boot();
  core = restarted.process;
  await page.goto(restarted.url);
  await page.getByRole('link', { name: '继续游玩' }).click();
  await expect(page.getByText('你推开门。雨里没有人。')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('推门')).toBeVisible();

  server.enqueue({ kind: 'http_error', status: 500, message: 'boom' });
  await page.getByRole('textbox', { name: '你的行动' }).fill('关灯');
  await page.getByRole('textbox', { name: '你的行动' }).press('Enter');
  await expect(page.getByText('本段未完成').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('关灯').first()).toBeVisible();
  server.enqueue(
    proposeTurnStep({
      prose: '灯灭了，钟铺里只剩雨声。',
      options: ['离开钟铺', '留下'],
      scene: { place: '钟铺', time: '深夜', present: [] },
    }),
  );
  await page.getByRole('button', { name: '重试这次行动' }).click();
  await expect(page.getByText('灯灭了，钟铺里只剩雨声。')).toBeVisible({ timeout: 20_000 });
});
