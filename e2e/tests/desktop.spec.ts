import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const electronPath = desktopRequire('electron') as string;
const mainPath = fileURLToPath(new URL('../../apps/desktop/dist/main.js', import.meta.url));
const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

async function launchDesktop(dataDir: string): Promise<ElectronApplication> {
  return await electron.launch({
    executablePath: electronPath,
    args: [mainPath],
    env: { ...process.env, UNWRITTEN_USER_DATA_DIR: dataDir },
  });
}

async function holdDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const state = globalThis as unknown as {
      dialogs: Array<{ message: string; detail: string }>;
      releases: Array<() => void>;
    };
    state.dialogs = [];
    state.releases = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const spec = args.at(-1) as { message: string; detail: string };
      state.dialogs.push({ message: spec.message, detail: spec.detail });
      await new Promise<void>((resolve) => state.releases.push(resolve));
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function dialogs(app: ElectronApplication): Promise<Array<{ message: string; detail: string }>> {
  return await app.evaluate(() => {
    const state = globalThis as unknown as { dialogs: Array<{ message: string; detail: string }> };
    return state.dialogs;
  });
}

async function releaseDialog(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const state = globalThis as unknown as { releases: Array<() => void> };
    state.releases.shift()?.();
  });
}

async function corePid(app: ElectronApplication): Promise<number | undefined> {
  return await app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'core')?.pid,
  );
}

test('桌面窗口打开作品库，令牌不留在地址里', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-desktop-'));
  const app = await launchDesktop(dataDir);
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(page.url()).not.toContain('token');
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('外观偏好同步到原生主题', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-desktop-'));
  const app = await launchDesktop(dataDir);
  try {
    const page = await app.firstWindow();
    await page.getByRole('link', { name: '设置' }).click();
    await page.getByText('深色', { exact: true }).click();
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await page.getByText('跟随系统', { exact: true }).click();
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system');
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('第二次启动只聚焦已有窗口', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-desktop-'));
  const app = await launchDesktop(dataDir);
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
    const second = await launchDesktop(dataDir).catch(() => null);
    if (second) {
      try {
        await expect.poll(() => second.process().exitCode, { timeout: 10_000 }).not.toBeNull();
      } finally {
        await second.close();
      }
    }
    expect(app.windows().length).toBe(1);
    await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('core 意外退出后重启，进度不丢', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-desktop-'));
  const background = '雨夜修钟铺的学徒守着一盏不肯灭的灯。';
  const app = await launchDesktop(dataDir);
  let closed = false;
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
    await page.getByRole('button', { name: '新建故事' }).click();
    await page.getByRole('textbox', { name: '故事背景' }).fill(background);
    await expect(page.getByText('已保存')).toBeVisible();

    await holdDialogs(app);

    const pid = await corePid(app);
    expect(typeof pid).toBe('number');
    process.kill(pid as number, 'SIGKILL');
    await expect.poll(async () => (await dialogs(app)).length).toBe(1);

    const blocker = spawn(process.execPath, [corePath, '--data-dir', dataDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`core did not start: ${output}`)), 20_000);
        blocker.stdout?.on('data', (chunk: Buffer) => {
          output += String(chunk);
          if (output.includes('UNWRITTEN_CORE_URL=')) {
            clearTimeout(timer);
            resolve();
          }
        });
        blocker.once('exit', (code) => reject(new Error(`core exited early: ${code}`)));
      });

      await releaseDialog(app);
      await expect.poll(async () => (await dialogs(app)).length).toBe(2);
      const failure = (await dialogs(app))[1];
      expect(failure?.message).toContain('数据目录');
      expect(failure?.detail).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    } finally {
      blocker.kill('SIGTERM');
      if (blocker.exitCode === null) await new Promise((resolve) => blocker.once('exit', resolve));
    }

    const reloaded = page.waitForEvent('framenavigated');
    await releaseDialog(app);
    await reloaded;
    await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
    await expect(page.getByRole('heading', { name: background })).toBeVisible();
    await page.getByRole('link', { name: '继续创作' }).click();
    await expect(page.getByRole('textbox', { name: '故事背景' })).toHaveValue(background);

    const restartedPid = await corePid(app);
    expect(typeof restartedPid).toBe('number');
    expect(restartedPid).not.toBe(pid);

    await app.close();
    closed = true;

    const database = new DatabaseSync(join(dataDir, 'diagnostics.db'));
    try {
      const rows = database
        .prepare("select event, data from diagnostic_events where module = 'desktop'")
        .all() as Array<{ event: string; data: string }>;
      const events = rows.map((row) => ({ event: row.event, data: JSON.parse(row.data) as Record<string, unknown> }));
      expect(events.some((row) => row.event === 'desktop.started')).toBe(true);
      const exits = events.filter((row) => row.event === 'desktop.core_exited');
      expect(exits).toHaveLength(1);
      expect(exits[0]?.data.phase).toBe('running');
      const restarts = events.filter((row) => row.event === 'desktop.core_restarted').map((row) => row.data.reason);
      expect(restarts).toEqual(['restart', 'retry']);
    } finally {
      database.close();
    }
  } finally {
    if (!closed) await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
