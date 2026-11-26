import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startFakeOpenAiServer } from '../../packages/core/src/test-support/fake-openai-server.ts';
import { proposePreviewStep, proposeTurnStep } from '../../packages/core/src/test-support/llm-steps.ts';

const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

async function boot(dataDir: string): Promise<{ process: ChildProcess; url: string }> {
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

async function stop(child: ChildProcess): Promise<void> {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

test('外观偏好重新打开带令牌地址和跨标签页保持', async ({ page, browser }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-m2-appearance-'));
  const core = await boot(dataDir);
  try {
    await page.goto(core.url);
    await page.getByRole('link', { name: '设置' }).click();
    await page.getByText('深色', { exact: true }).click();
    await page.getByText('大', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-uw-appearance', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-uw-prose-size', '4');

    const response = await page.goto(core.url);
    expect(await response?.text()).toContain('data-uw-appearance="dark"');
    expect(await response?.text()).toContain('data-uw-prose-size="4"');
    await expect(page.locator('html')).toHaveAttribute('data-uw-appearance', 'dark');

    const second = await browser.newPage();
    await second.goto(core.url);
    await expect(second.locator('html')).toHaveAttribute('data-uw-appearance', 'dark');
    await second.getByRole('link', { name: '设置' }).click();
    await second.getByText('浅色', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-uw-appearance', 'light');
    await second.close();
  } finally {
    await stop(core.process);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('开场人物进入手记', async ({ page }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-m2-journal-'));
  const server = await startFakeOpenAiServer();
  writeFileSync(
    join(dataDir, 'providers.json'),
    JSON.stringify({
      version: 1,
      endpoints: [
        {
          id: 'custom-test',
          name: '测试端点',
          api: 'openai-completions',
          baseUrl: server.baseUrl,
          models: [{ id: 'test-model' }],
        },
      ],
      purposes: { default: { provider: 'custom-test', model: 'test-model' } },
    }),
  );
  const core = await boot(dataDir);
  try {
    await page.goto(core.url);
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
        present: ['撑伞的女人'],
        changes:
          '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}\n{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"1"}',
      }),
    );
    await page.getByRole('button', { name: '生成开场预览' }).click();
    await expect(page.getByText('撑伞的女人')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await page.getByRole('link', { name: '开始故事' }).click();
    await page.getByRole('button', { name: '手记' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('撑伞的女人')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } finally {
    await stop(core.process);
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('删除作品前确认，确认后卡片消失', async ({ page }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-m2-delete-'));
  const core = await boot(dataDir);
  try {
    await page.goto(core.url);
    await page.getByRole('button', { name: '新建故事' }).click();
    await page.getByRole('link', { name: '作品库' }).click();
    await page.getByRole('button', { name: /更多操作/ }).click();
    await page.getByRole('menuitem', { name: '删除作品' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '删除作品' }).click();
    await expect(page.getByRole('heading', { name: '还没有作品' })).toBeVisible();
  } finally {
    await stop(core.process);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('键盘选择推荐行动，组字时不提交', async ({ page }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-m2-keyboard-'));
  const server = await startFakeOpenAiServer();
  writeFileSync(
    join(dataDir, 'providers.json'),
    JSON.stringify({
      version: 1,
      endpoints: [
        {
          id: 'custom-test',
          name: '测试端点',
          api: 'openai-completions',
          baseUrl: server.baseUrl,
          models: [{ id: 'test-model' }],
        },
      ],
      purposes: { default: { provider: 'custom-test', model: 'test-model' } },
    }),
  );
  const core = await boot(dataDir);
  try {
    await page.goto(core.url);
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
    await page.getByRole('button', { name: '采用开场并存入作品库' }).click({ timeout: 20_000 });
    await page.getByRole('link', { name: '开始故事' }).click();
    await expect(page.getByRole('group', { name: '推荐行动' })).toBeVisible();
    server.enqueue(
      proposeTurnStep({
        prose: '钟摆停了一拍，门外的雨还在下。',
        options: ['关上门', '走进雨里'],
        changes: '',
      }),
    );
    const modifier = (await page.evaluate(() => {
      const browser = globalThis as unknown as {
        navigator: { platform: string; userAgentData?: { platform?: string } };
      };
      return /Mac/.test(browser.navigator.userAgentData?.platform ?? browser.navigator.platform);
    }))
      ? 'metaKey'
      : 'ctrlKey';
    const dispatchKey = async (key: string, isComposing: boolean) => {
      await page.evaluate(
        (input) => {
          const browser = globalThis as unknown as {
            window: { dispatchEvent(event: unknown): void };
            KeyboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
          };
          browser.window.dispatchEvent(
            new browser.KeyboardEvent('keydown', {
              key: input.key,
              [input.modifier]: true,
              isComposing: input.isComposing,
              bubbles: true,
            }),
          );
        },
        { key, modifier, isComposing },
      );
    };
    await dispatchKey('2', false);
    await expect(page.getByText('钟摆停了一拍，门外的雨还在下。')).toBeVisible({ timeout: 20_000 });

    const input = page.getByRole('textbox', { name: '你的行动' });
    await input.fill('组字中');
    await input.dispatchEvent('compositionstart');
    const before = server.requests.length;
    await dispatchKey('1', true);
    await page.waitForTimeout(300);
    expect(server.requests.length).toBe(before);
    await input.dispatchEvent('compositionend');
  } finally {
    await stop(core.process);
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
