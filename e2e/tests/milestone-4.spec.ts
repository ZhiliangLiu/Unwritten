import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURE_CAPTION,
  FIXTURE_OPENING,
  FIXTURE_TURN_PARAGRAPHS,
  createDraftFixture,
  imageJobRequests,
  publishDraftWork,
  publishFixtureWork,
  openAiMultipartFiles,
  seedAuthorPortrait,
  shotText,
  readProvidersBackupBytes,
  diagnosticsContain,
  readEvents,
  readProvidersFile,
  readSamples,
  startApp,
  waitUntil,
} from './support/milestone-4.ts';
import { changeLines, proposeTurnStep } from '../../packages/core/src/test-support/llm-steps.ts';

type AnchorElement = {
  id: string;
  textContent: string | null;
  scrollIntoView(options: { block: string }): void;
  focus(): void;
  getBoundingClientRect(): { top: number };
};
import { pngBytes } from '../../packages/core/src/test-support/image-bytes.ts';

async function waitForArrival(page: Page): Promise<void> {
  const article = page.locator('article[data-uw-arriving]').last();
  await expect
    .poll(() =>
      article.evaluate(
        (element) =>
          (globalThis as unknown as { getComputedStyle(element: unknown): { transform: string } }).getComputedStyle(
            element,
          ).transform,
      ),
    )
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/u);
}

async function expectImageDecoded(page: Page, name: string | RegExp): Promise<void> {
  const image = page.getByRole('img', { name });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth))
    .toBeGreaterThan(0);
}

async function submitAction(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: '你的行动' }).fill(text);
  await page.getByRole('textbox', { name: '你的行动' }).press('Enter');
}

async function openLibrary(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
}

async function probeImage(app: Awaited<ReturnType<typeof startApp>>): Promise<void> {
  const config = await app.api.image.services.list();
  if (config.selectedServiceId !== null) {
    await app.api.image.services.test({ serviceId: config.selectedServiceId, target: 'service', paid: false });
  }
}

async function startFromLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: '《候船厅的纸灯》的更多操作' }).click();
  await page.getByRole('menuitem', { name: '重新开局' }).click();
}

test('E01 纯文字、版本升级与确认开启', async ({ page }) => {
  const app = await startApp({
    providersVersion: 1,
    image: 'unwritten',
    tokenProxy: true,
    imageOptions: { jobDelayMs: 600 },
  });
  try {
    const work = await publishFixtureWork(app);
    const original = await readProvidersFile(app.dataDir);
    expect((original as { version: number }).version).toBe(1);
    await page.goto(app.url);
    await startFromLibrary(page);
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '9',
      }),
    );
    await submitAction(page, '在长椅旁坐下');
    await expect(page.getByText(FIXTURE_TURN_PARAGRAPHS[0]!)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-uw-illustration-frame]')).toHaveCount(0);
    expect(app.services.image?.requests ?? []).toHaveLength(0);

    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('link', { name: '出图服务' }).click();
    await page.getByRole('button', { name: '添加出图服务' }).click();
    await page.getByRole('textbox', { name: '服务名称' }).fill('本地出图');
    await page.getByRole('textbox', { name: '服务地址' }).fill(app.services.proxyUrl ?? '');
    await page.getByRole('button', { name: '生成令牌' }).click();
    await expect(page.getByRole('textbox', { name: '令牌' })).toBeVisible();
    const generatedToken = await page.getByRole('textbox', { name: '令牌' }).inputValue();
    expect(generatedToken.length).toBeGreaterThanOrEqual(43);
    await page.getByRole('button', { name: '保存出图服务' }).click();
    await expect(page.getByRole('heading', { name: '本地出图' })).toBeVisible();

    const upgraded = (await readProvidersFile(app.dataDir)) as { version: number };
    expect(upgraded.version).toBe(2);
    const backup = await readProvidersBackupBytes(app.dataDir);
    expect(backup.equals(app.providersBytes)).toBe(true);

    await openLibrary(page, app.url);
    await page.getByRole('link', { name: '设置' }).click();
    await page.getByRole('link', { name: '出图服务' }).click();
    await expect(page.getByText('已配置')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '令牌' })).toHaveCount(0);
    await page.getByRole('radiogroup', { name: '用于出图' }).getByText('本地出图').click();
    await expect.poll(async () => (await app.api.image.services.list()).selectedServiceId).not.toBeNull();

    await openLibrary(page, app.url);
    await startFromLibrary(page);
    await expect(page.getByRole('button', { name: '开始故事' })).toBeVisible();
    await expect(page.getByText('本局纯文字').first()).toBeVisible();
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-uw-illustration-frame]')).toHaveCount(0);
    expect(imageJobRequests(app.services.image!)).toHaveLength(0);

    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('link', { name: '出图服务' }).click();
    await page.getByRole('checkbox', { name: '游玩时生成插图' }).click();
    const dialog = page.getByRole('alertdialog', { name: '开启自动出图？' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/shot-model/)).toBeVisible();
    await expect(dialog.getByText(/本地出图/)).toBeVisible();
    await dialog.getByRole('button', { name: '确认开启' }).click();
    await expect(page.getByRole('checkbox', { name: '游玩时生成插图' })).toBeChecked();

    await openLibrary(page, app.url);
    await startFromLibrary(page);
    await expect(page.getByText(/本局插图 · 厚涂 · 自动比例 · 高 · 1K/)).toBeVisible();
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-uw-illustration-frame]')).toBeVisible();
    await expectImageDecoded(page, FIXTURE_CAPTION);
    await expect(page.getByRole('button', { name: '放大查看插图' })).toBeVisible();
    await expect.poll(() => imageJobRequests(app.services.image!).length, { timeout: 30_000 }).toBe(1);
    const firstJob = imageJobRequests(app.services.image!)[0]!;
    expect((firstJob.size as { width: number; height: number }).width).toBe(1536);
    expect((firstJob.size as { width: number; height: number }).height).toBe(1024);

    const jobsAfterIllustration = imageJobRequests(app.services.image!).length;
    await openLibrary(page, app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: /^插图/ }).click();
    await page.getByRole('radio', { name: '本局纯文字' }).click();
    await expect(page.getByText('本局纯文字').first()).toBeVisible();
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
      }),
    );
    await submitAction(page, '把皮箱放到脚边');
    await expect(page.getByText(FIXTURE_TURN_PARAGRAPHS[1]!)).toBeVisible({ timeout: 30_000 });
    await waitUntil(
      () => imageJobRequests(app.services.image!).length,
      (count) => count === jobsAfterIllustration,
      {
        label: 'text-only playthrough sends no image job',
        timeoutMs: 5_000,
      },
    );
    await expect(page.locator('[data-uw-illustration-frame]')).toHaveCount(0);
    expect(work.workId).toBeTruthy();
  } finally {
    await app.stop();
  }
});

test('E02 无图片服务时导入、取消与采用', async ({ page }) => {
  const app = await startApp({ image: 'none' });
  try {
    const draft = await createDraftFixture(app);
    const uploads: string[] = [];
    await page.route('**/api/portrait/**', async (route) => {
      if (route.request().url().includes('/api/portrait/upload')) {
        uploads.push(route.request().postDataBuffer()?.toString('latin1') ?? '');
      }
      await route.continue();
    });
    await page.goto(`${new URL(app.url).origin}/works/${draft.workId}/edit#token=${app.token}`);
    await expect(page.getByRole('heading', { name: '故事方案' })).toBeVisible();
    const card = page.locator('li').filter({ hasText: '榆既白 · 主要人物' });
    await card.getByRole('button', { name: '人物参考' }).click();
    const front = page.getByRole('region', { name: '正面' });
    await expect(front).toBeVisible();
    const file = pngBytes(300, 400);
    const input = front.locator('input[type=file]');
    await input.setInputFiles({ name: 'fixture-original-name.jpg', mimeType: 'image/png', buffer: Buffer.from(file) });
    await expect(front.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    await front.getByRole('button', { name: '取消' }).click();
    await expect(front.getByRole('img', { name: '人物参考 · 正面' })).toHaveCount(0);
    expect(uploads).toHaveLength(0);

    await input.setInputFiles({ name: 'fixture-original-name.jpg', mimeType: 'image/png', buffer: Buffer.from(file) });
    await front.getByRole('button', { name: '使用这张' }).click();
    await expect(front.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    await expect.poll(() => uploads.length).toBe(1);
    expect(uploads[0]).toContain('portrait.');
    expect(uploads[0]).not.toContain('fixture-original-name');

    await page.getByRole('button', { name: '采用' }).click();
    await expect.poll(() => page.getByRole('button', { name: '撤下' }).isVisible()).toBe(true);
    await page.getByRole('link', { name: '作品库' }).click();
    await page.getByRole('link', { name: '继续创作' }).click();
    await expect(page.getByRole('heading', { name: '故事方案' })).toBeVisible();
    const reopened = page.locator('li').filter({ hasText: '榆既白 · 主要人物' });
    await reopened.getByRole('button', { name: '人物参考' }).click();
    await expect(page.getByText('平视的头肩像')).toBeVisible();
    await expectImageDecoded(page, '人物参考 · 正面');
    expect(app.services.image).toBeNull();
  } finally {
    await app.stop();
  }
});

test('E02 新旧参考组与重画使用各自的参考字节', async ({ page }) => {
  const app = await startApp({ autoIllustration: true, imageOptions: { jobDelayMs: 50 } });
  try {
    const draft = await createDraftFixture(app);
    const oldBytes = pngBytes(300, 400);
    const newBytes = pngBytes(320, 420);
    await seedAuthorPortrait(app, {
      workId: draft.workId,
      entityId: draft.entityId('榆既白'),
      appearance: '短卷发，左眉有一道浅缺口，穿深色短外套',
      bytes: oldBytes,
    });
    await publishDraftWork(app, draft.workId);

    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '2',
      }),
    );
    app.services.background.shot(shotText({ caption: '旧参考组画出的钥匙', refs: 'C1:front' }));
    await submitAction(page, '抬头看向闸杆');
    await expectImageDecoded(page, '旧参考组画出的钥匙');
    const oldRoute = new URL(page.url()).pathname;
    const oldJob = imageJobRequests(app.services.image!).at(-1)!;
    const oldReference = Buffer.from((oldJob.references as Array<{ data: string }>)[0]!.data, 'base64');
    expect(oldReference.equals(Buffer.from(oldBytes))).toBe(true);

    await seedAuthorPortrait(app, {
      workId: draft.workId,
      entityId: draft.entityId('榆既白'),
      appearance: '短卷发，左眉有一道浅缺口，穿深色短外套',
      bytes: newBytes,
    });

    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '2',
      }),
    );
    app.services.background.shot(shotText({ caption: '新参考组画出的钥匙', refs: 'C1:front' }));
    await submitAction(page, '走到闸杆旁');
    await expectImageDecoded(page, '新参考组画出的钥匙');
    const newJob = imageJobRequests(app.services.image!).at(-1)!;
    const newReference = Buffer.from((newJob.references as Array<{ data: string }>)[0]!.data, 'base64');
    expect(newReference.equals(Buffer.from(newBytes))).toBe(true);
    expect(newReference.equals(oldReference)).toBe(false);

    const jobsBeforeReroll = imageJobRequests(app.services.image!).length;
    const shotRequestsBeforeReroll = app.services.background.requests.filter((request) => request.shot).length;
    const oldRouteId = oldRoute.split('/').at(-1)!;
    await page.goto(`${new URL(app.url).origin}${oldRoute}#token=${app.token}`);
    await expectImageDecoded(page, '旧参考组画出的钥匙');
    const beforeReroll = await app.api.play.getRoute({ routeId: oldRouteId });
    const oldIllustration = beforeReroll.turns
      .flatMap((turn: { illustration: { id: string; rerolling: boolean } | null }) =>
        turn.illustration ? [turn.illustration] : [],
      )
      .at(-1)!;
    await page
      .getByRole('button', { name: '放大查看插图' })
      .filter({ has: page.getByRole('img', { name: '旧参考组画出的钥匙' }) })
      .click();
    const dialog = page.getByRole('dialog', { name: '插图' });
    await dialog.getByRole('button', { name: '重画' }).click();
    await expect
      .poll(() => imageJobRequests(app.services.image!).length, { timeout: 30_000 })
      .toBe(jobsBeforeReroll + 1);
    await waitUntil(
      async () => {
        const route = await app.api.play.getRoute({ routeId: oldRouteId });
        return route.turns.flatMap((turn: { illustration: { id: string; rerolling: boolean } | null }) =>
          turn.illustration ? [turn.illustration] : [],
        );
      },
      (illustrations) =>
        illustrations.some(
          (illustration: { id: string; rerolling: boolean }) =>
            illustration.id === oldIllustration.id && illustration.rerolling === false,
        ),
      { label: 'reroll finished', timeoutMs: 60_000 },
    );
    expect(app.services.background.requests.filter((request) => request.shot)).toHaveLength(shotRequestsBeforeReroll);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expectImageDecoded(page, '旧参考组画出的钥匙');
    const rerollJob = imageJobRequests(app.services.image!).at(-1)!;
    const rerollReference = Buffer.from((rerollJob.references as Array<{ data: string }>)[0]!.data, 'base64');
    expect(rerollReference.equals(Buffer.from(oldBytes))).toBe(true);
  } finally {
    await app.stop();
  }
});

test('E02 开局页选择主角参考，其他视角生成中也能开始', async ({ page, context }) => {
  const app = await startApp({ autoIllustration: true });
  try {
    await publishFixtureWork(app);
    const config = await app.api.image.services.list();
    await app.api.image.services.test({ serviceId: config.selectedServiceId, target: 'service', paid: false });
    const blobDir = join(app.dataDir, 'images', 'blobs');
    const beforeUpload = new Set(existsSync(blobDir) ? readdirSync(blobDir) : []);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: /^插图/ }).click();
    await page.getByText('画进插图').click();
    await page.getByRole('textbox', { name: '主角形象' }).fill('黑色短发，灰蓝色长外套，手里提着一只旧皮箱');
    const front = page.getByRole('region', { name: '正面' });
    await front.locator('input[type=file]').setInputFiles({
      name: 'fixture-original-name.jpg',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBytes(300, 400)),
    });
    await front.getByRole('button', { name: '使用这张' }).click();
    const frontFile = await waitUntil(
      () => (existsSync(blobDir) ? readdirSync(blobDir).find((name) => !beforeUpload.has(name)) : undefined),
      (name) => name !== undefined,
      { label: 'uploaded portrait blob', timeoutMs: 10_000 },
    );
    const frontBytes = readFileSync(join(blobDir, frontFile!));
    const frontMime = frontFile!.endsWith('.png') ? 'image/png' : 'image/webp';
    await page.getByRole('button', { name: '用作本局参考' }).click();

    const releasePortrait = app.services.image!.holdNextJob();
    await page.getByRole('button', { name: '补齐视角' }).click();
    await expect(page.getByText('正在生成').first()).toBeVisible();

    const other = await createDraftFixture(app);
    const otherOnlyBytes = pngBytes(280, 360);
    await seedAuthorPortrait(app, {
      workId: other.workId,
      entityId: other.entityId('榆既白'),
      appearance: '短卷发，左眉有一道浅缺口，穿深色短外套',
      bytes: frontBytes,
      mime: frontMime,
      threeQuarterBytes: otherOnlyBytes,
    });
    const otherSummary = (await app.api.works.list()).find(
      (candidate: { id: string }) => candidate.id === other.workId,
    )!;
    const gcBefore = readEvents(app.dataDir, 'image.gc').length;
    const page2 = await context.newPage();
    await page2.goto(app.url);
    await page2.getByRole('button', { name: `《${otherSummary.label}》的更多操作` }).click();
    await page2.getByRole('menuitem', { name: '删除作品' }).click();
    await page2.getByRole('button', { name: '删除作品' }).click();
    await expect(page2.getByText('作品已删除')).toBeVisible();
    await expect
      .poll(async () => (await app.api.works.list()).some((candidate: { id: string }) => candidate.id === other.workId))
      .toBe(false);
    await page2.close();

    const hash = createHash('sha256').update(frontBytes).digest('hex');
    const extension = frontFile!.split('.').at(-1)!;
    const sharedFile = join(app.dataDir, 'images', 'blobs', `${hash}.${extension}`);
    await waitUntil(
      () => readEvents(app.dataDir, 'image.gc').length,
      (count) => count > gcBefore,
      {
        label: 'image cleanup after deleting the other work',
        timeoutMs: 20_000,
      },
    );
    expect(existsSync(sharedFile)).toBe(true);

    app.services.background.shot(
      shotText({
        caption: '主角站在候船厅门口',
        refs: 'C1:front',
        prompt: 'The traveller in a long grey coat stands in the doorway {{ref:1}}.',
      }),
    );
    const jobsBefore = imageJobRequests(app.services.image!).length;
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible();
    expect(imageJobRequests(app.services.image!).length).toBe(jobsBefore);
    releasePortrait();
    await expect.poll(() => imageJobRequests(app.services.image!).length, { timeout: 30_000 }).toBe(jobsBefore + 1);
    await expectImageDecoded(page, '主角站在候船厅门口');
    const openingJob = imageJobRequests(app.services.image!).at(-1)!;
    const reference = Buffer.from((openingJob.references as Array<{ data: string }>)[0]!.data, 'base64');
    expect(reference.equals(frontBytes)).toBe(true);
  } finally {
    await app.stop();
  }
});

const WIDE_CAPABILITIES = {
  aspects: ['1:1', '3:2', '3:4', '2:3', '4:3', '9:16'],
  resolutions: {
    '3:2': {
      '720': { width: 1088, height: 720 },
      '1k': { width: 1536, height: 1024 },
      '2k': { width: 3072, height: 2048 },
    },
    '2:3': {
      '720': { width: 720, height: 1088 },
      '1k': { width: 1024, height: 1536 },
      '2k': { width: 2048, height: 3072 },
    },
    '9:16': {
      '720': { width: 720, height: 1280 },
      '1k': { width: 1024, height: 1824 },
    },
  },
};

async function expectImageSize(page: Page, name: string, width: number, height: number): Promise<void> {
  const image = page.getByRole('img', { name });
  await expect(image).toBeVisible();
  const size = await image.evaluate((element) => {
    const img = element as unknown as { naturalWidth: number; naturalHeight: number };
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(size).toEqual({ width, height });
}

test('E03 自动比例选 1K 时横图与竖图各用实际尺寸', async ({ page }) => {
  const app = await startApp({
    autoIllustration: true,
    imageOptions: { jobDelayMs: 80, capabilities: WIDE_CAPABILITIES },
  });
  try {
    await publishFixtureWork(app);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expectImageDecoded(page, FIXTURE_CAPTION);

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '1',
      }),
    );
    app.services.background.shot(shotText({ caption: '两人并肩站在候船厅里', aspect: '3:2' }));
    await submitAction(page, '抬头看向闸杆');
    await expectImageSize(page, '两人并肩站在候船厅里', 1536, 1024);
    expect(imageJobRequests(app.services.image!).at(-1)!.size).toEqual({ width: 1536, height: 1024 });

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '1',
      }),
    );
    app.services.background.shot(shotText({ caption: '主角沿着梯子向上爬', aspect: '2:3' }));
    await submitAction(page, '走到梯子旁');
    await expectImageSize(page, '主角沿着梯子向上爬', 1024, 1536);
    expect(imageJobRequests(app.services.image!).at(-1)!.size).toEqual({ width: 1024, height: 1536 });
  } finally {
    await app.stop();
  }
});

test('E03 固定比例时 720 与 2K 只改变像素', async ({ page }) => {
  const app = await startApp({
    autoIllustration: true,
    imageOptions: { jobDelayMs: 80, capabilities: WIDE_CAPABILITIES },
  });
  try {
    await publishFixtureWork(app);
    await probeImage(app);
    for (const [tierLabel, width, height] of [
      ['标准 · 720', 1088, 720],
      ['非常高 · 2K', 3072, 2048],
    ] as const) {
      await page.goto(app.url);
      await startFromLibrary(page);
      await page.getByRole('button', { name: /^插图/ }).click();
      const aspect = page.getByRole('radiogroup', { name: '画面比例' }).getByText('3:2', { exact: true });
      const tier = page.getByRole('radiogroup', { name: '分辨率' }).getByText(new RegExp(`^${tierLabel}`));
      await expect(aspect).toBeVisible();
      await aspect.click();
      await expect(tier).toBeVisible();
      await tier.click();
      app.services.background.shot(shotText({ caption: `固定比例 ${tierLabel}`, aspect: '3:2' }));
      await page.getByRole('button', { name: '开始故事' }).click();
      await expectImageSize(page, `固定比例 ${tierLabel}`, width, height);
      expect(imageJobRequests(app.services.image!).at(-1)!.size).toEqual({ width, height });
    }
  } finally {
    await app.stop();
  }
});

test('E03 窄视口 9:16 与减少动态', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const app = await startApp({
    autoIllustration: true,
    imageOptions: { jobDelayMs: 2_500, capabilities: WIDE_CAPABILITIES },
  });
  try {
    await publishFixtureWork(app);
    await probeImage(app);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: /^插图/ }).click();
    await page.getByRole('radiogroup', { name: '画面比例' }).getByText('9:16', { exact: true }).click();
    app.services.background.shot(shotText({ caption: '窄屏里的竖图', aspect: '9:16' }));
    await page.getByRole('button', { name: '开始故事' }).click();
    const frame = page.locator('[data-uw-illustration-frame]');
    await expect(frame).toBeVisible();
    const measurements = await frame.evaluate((element) => {
      type Box = { getBoundingClientRect(): { height: number } };
      const doc = (globalThis as unknown as { document: { querySelector(selector: string): Box | null } }).document;
      const main = doc.querySelector('main');
      return {
        frame: (element as unknown as Box).getBoundingClientRect().height,
        reading: main?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(measurements.frame).toBeLessThanOrEqual(measurements.reading / 2 + 2);
    await expectImageSize(page, '窄屏里的竖图', 1024, 1824);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(app.url);
    await startFromLibrary(page);
    app.services.background.shot(shotText({ caption: '减少动态的占位', aspect: '3:2' }));
    await page.getByRole('button', { name: '开始故事' }).click();
    const busy = page.locator('[data-uw-illustration-frame]');
    await expect(busy).toBeVisible();
    const motion = await busy.evaluate((element) => {
      type Styled = {
        querySelector(selector: string): Styled | null;
        getBoundingClientRect(): { height: number };
      };
      type Style = { animationDuration: string; transform: string };
      const win = globalThis as unknown as { getComputedStyle(element: Styled): Style };
      const status = (element as unknown as Styled).querySelector('p');
      const statusStyle = status ? win.getComputedStyle(status) : null;
      const frameStyle = win.getComputedStyle(element as unknown as Styled);
      return {
        animationDuration: statusStyle?.animationDuration ?? '0s',
        frameTransform: frameStyle.transform,
      };
    });
    expect(Number.parseFloat(motion.animationDuration)).toBe(0);
    expect(motion.frameTransform === 'none' || motion.frameTransform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
    await expectImageSize(page, '减少动态的占位', 1536, 1024);
    const imageTransform = await page
      .getByRole('img', { name: '减少动态的占位' })
      .evaluate(
        (element) =>
          (globalThis as unknown as { getComputedStyle(element: unknown): { transform: string } }).getComputedStyle(
            element,
          ).transform,
      );
    expect(imageTransform === 'none' || imageTransform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
  } finally {
    await app.stop();
  }
});

test('E03 旧协议只报告比例，固定尺寸接口只提供一档', async ({ page }) => {
  const legacy = await startApp({
    autoIllustration: true,
    imageOptions: {
      jobDelayMs: 50,
      capabilities: {
        aspects: ['1:1', '3:2', '3:4', '2:3', '4:3'],
        resolutions: {
          '1:1': {},
          '3:4': {},
          '2:3': {},
          '4:3': {},
          '3:2': { '1k': { width: 1536, height: 1024 } },
        },
      },
    },
  });
  try {
    await publishFixtureWork(legacy);
    await probeImage(legacy);
    await page.goto(legacy.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: /^插图/ }).click();
    await page
      .getByRole('radiogroup', { name: '分辨率' })
      .getByText(/^服务默认/)
      .click();
    legacy.services.background.shot(shotText({ caption: '旧协议按比例出图', aspect: '3:2' }));
    await page.getByRole('button', { name: '开始故事' }).click();
    await expectImageSize(page, '旧协议按比例出图', 1536, 1024);
    expect(imageJobRequests(legacy.services.image!).at(-1)).not.toHaveProperty('size');
  } finally {
    await legacy.stop();
  }

  const openai = await startApp({
    image: 'openai',
    autoIllustration: true,
    openaiModel: 'gpt-image-1.5',
    openaiOptions: { maxReferences: 16, sizes: 'fixed' },
  });
  try {
    await publishFixtureWork(openai);
    await probeImage(openai);
    await page.goto(openai.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: /^插图/ }).click();
    const tiers = page.getByRole('radiogroup', { name: '分辨率' });
    await expect(tiers.getByText(/720/)).toHaveCount(0);
    await expect(tiers.getByText(/2K/)).toHaveCount(0);
    await expect(tiers.getByText(/1K/)).toBeVisible();
  } finally {
    await openai.stop();
  }
});

test('E04 可见段落、阅读位置与诊断样本', async ({ page }) => {
  const marker = 'fixture-caption-private-4';
  const app = await startApp({ autoIllustration: true, imageOptions: { jobDelayMs: 120 } });
  let illustrationIds: string[] = [];
  try {
    await publishFixtureWork(app);
    await probeImage(app);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expectImageDecoded(page, FIXTURE_CAPTION);

    const releaseFirst = app.services.image!.holdNextJob();
    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '2',
        changes: changeLines(
          { type: 'name', entity: '@3', name: '岑雾行', holder: '@1', para: '5' },
          {
            type: 'trait',
            subject: '@3',
            key: 'appearance',
            statement: '兜帽摘下，左侧颧骨上有一块月牙形胎记',
            para: '5',
          },
        ),
      }),
    );
    app.services.background.shot(
      shotText({
        caption: `钥匙还在修表匠的掌心。${marker}`,
        refs: 'C1:front',
        prompt:
          'Close shot of a brass key resting on an open palm in a dim waiting hall. One figure draws an empty gloved hand back.',
      }),
    );
    await submitAction(page, '盯着那把钥匙');
    await expect(page.getByText(FIXTURE_TURN_PARAGRAPHS[1]!)).toBeVisible({ timeout: 30_000 });
    await waitForArrival(page);

    const route = await app.api.play.getRoute({
      routeId: new URL(page.url()).pathname.split('/').at(-1)!,
    });
    const firstTurn = route.turns.at(-1)!;
    const anchorId = `turn-${firstTurn.id}-para-2`;
    await page.evaluate((id) => {
      const element = (
        globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
      ).document.getElementById(id);
      element?.scrollIntoView({ block: 'center' });
      element?.focus();
    }, anchorId);
    const readAnchor = () =>
      page.evaluate((id) => {
        const element = (
          globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
        ).document.getElementById(id);
        return element ? element.getBoundingClientRect().top : null;
      }, anchorId);
    await expect(page.locator('[data-uw-illustration-frame]').last()).toBeVisible({ timeout: 30_000 });
    const beforeFill = await readAnchor();

    await waitUntil(
      () =>
        app.services.background.requests
          .filter((request) => request.shot)
          .some((request) => JSON.stringify(request.body).includes('钥匙还躺在修表匠的掌心里')),
      (found) => found,
      { label: 'turn shot materials', timeoutMs: 20_000 },
    );
    const shotPrompt = JSON.stringify(
      app.services.background.requests
        .filter((request) => request.shot)
        .find((request) => JSON.stringify(request.body).includes('钥匙还躺在修表匠的掌心里'))?.body,
    );
    expect(shotPrompt).toContain('钥匙还躺在修表匠的掌心里');
    expect(shotPrompt).not.toContain('摘下兜帽');
    expect(shotPrompt).not.toContain('岑雾行');
    expect(shotPrompt).not.toContain('月牙形胎记');

    releaseFirst();
    await expectImageDecoded(page, `钥匙还在修表匠的掌心。${marker}`);
    await page.waitForTimeout(250);
    const afterFill = await readAnchor();
    expect(Math.abs((afterFill ?? 0) - (beforeFill ?? 0))).toBeLessThanOrEqual(2);
    const focusAfterFill = await page.evaluate(() => {
      const active = (globalThis as unknown as { document: { activeElement: { id: string } | null } }).document
        .activeElement;
      return active?.id ?? null;
    });
    expect(focusAfterFill).toBe(anchorId);
    const selected = await page.evaluate((id) => {
      type Doc = {
        getElementById(id: string): { textContent: string | null } | null;
        createRange(): { selectNodeContents(node: unknown): void };
        getSelection(): { removeAllRanges(): void; addRange(range: unknown): void; toString(): string } | null;
      };
      const doc = (globalThis as unknown as { document: Doc }).document;
      const element = doc.getElementById(id);
      const range = doc.createRange();
      if (element) range.selectNodeContents(element);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      if (element) selection?.addRange(range);
      return selection?.toString() ?? '';
    }, anchorId);
    expect(selected).toBe(FIXTURE_TURN_PARAGRAPHS[1]);

    const jobPrompt = JSON.stringify(imageJobRequests(app.services.image!).at(-1));
    expect(jobPrompt).not.toContain('岑雾行');
    expect(jobPrompt).not.toContain('月牙形胎记');
    app.services.background.delayNextShot(800);
    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '2',
      }),
    );
    app.services.background.shot(shotText({ caption: '这张会失败', aspect: '3:2' }));
    app.services.image!.failNextJob('internal');
    await submitAction(page, '把怀表放回口袋');
    await expect(page.getByText('重试第 2 回合的插图')).toBeVisible({ timeout: 30_000 });
    await waitForArrival(page);
    const secondRoute = await app.api.play.getRoute({
      routeId: new URL(page.url()).pathname.split('/').at(-1)!,
    });
    const secondTurn = secondRoute.turns.at(-1)!;
    const secondAnchor = `turn-${secondTurn.id}-para-2`;
    await page.evaluate((id) => {
      const element = (
        globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
      ).document.getElementById(id);
      element?.scrollIntoView({ block: 'center' });
      element?.focus();
    }, secondAnchor);
    const failureTop = await page.evaluate((id) => {
      const element = (
        globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
      ).document.getElementById(id);
      return element ? element.getBoundingClientRect().top : null;
    }, secondAnchor);

    const releaseSecond = app.services.image!.holdNextJob();
    await page.getByRole('button', { name: '重试第 2 回合的插图' }).click();
    await expect(page.locator('[data-uw-illustration-frame]').last()).toBeVisible();
    await page.waitForTimeout(250);
    const retryTop = await page.evaluate((id) => {
      const element = (
        globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
      ).document.getElementById(id);
      return element ? element.getBoundingClientRect().top : null;
    }, secondAnchor);
    expect(Math.abs((retryTop ?? 0) - (failureTop ?? 0))).toBeLessThanOrEqual(2);
    await page.evaluate((id) => {
      const element = (
        globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
      ).document.getElementById(id);
      element?.focus();
    }, secondAnchor);
    releaseSecond();
    await expectImageDecoded(page, '这张会失败');
    await page.waitForTimeout(250);
    const filledTop = await page.evaluate((id) => {
      const element = (
        globalThis as unknown as { document: { getElementById(id: string): AnchorElement | null } }
      ).document.getElementById(id);
      return element ? element.getBoundingClientRect().top : null;
    }, secondAnchor);
    expect(Math.abs((filledTop ?? 0) - (failureTop ?? 0))).toBeLessThanOrEqual(2);
    const focusAfterRetry = await page.evaluate(() => {
      const active = (globalThis as unknown as { document: { activeElement: { id: string } | null } }).document
        .activeElement;
      return active?.id ?? null;
    });
    expect(focusAfterRetry).toBe(secondAnchor);

    const finalRoute = await app.api.play.getRoute({
      routeId: new URL(page.url()).pathname.split('/').at(-1)!,
    });
    illustrationIds = finalRoute.turns.flatMap((turn: { illustration: { id: string } | null }) =>
      turn.illustration ? [turn.illustration.id] : [],
    );
  } finally {
    await app.stop({ keepDataDir: true });
    try {
      const samples = readSamples(app.dataDir, 'client.illustration_visible');
      expect(samples.length).toBeGreaterThan(0);
      for (const sample of samples) {
        expect(sample.outcome).toBe('ok');
        expect(illustrationIds).toContain(sample.request_id);
      }
      expect(new Set(samples.map((sample) => sample.request_id)).size).toBe(samples.length);
      expect(diagnosticsContain(app.dataDir, marker)).toBe(false);
    } finally {
      rmSync(app.dataDir, { recursive: true, force: true });
    }
  }
});

test('E05 离线恢复只重试一张，关闭自动出图后旧结果不出现', async ({ page, context }) => {
  const app = await startApp({ autoIllustration: true, imageOptions: { jobDelayMs: 120 } });
  try {
    await publishFixtureWork(app);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expectImageDecoded(page, FIXTURE_CAPTION);

    app.services.image!.setReady(false, 'starting');
    for (const [index, action] of ['先看看灯', '再听听雨'].entries()) {
      app.services.text.enqueue(
        proposeTurnStep({
          prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
          options: ['继续等船', '走向闸杆'],
          illustrate: '1',
        }),
      );
      await submitAction(page, action);
      await expect(page.getByText(FIXTURE_TURN_PARAGRAPHS[0]!).last()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('出图服务还在准备。请稍后重试。').nth(index)).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByRole('button', { name: '重试第 1 回合的插图' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试第 2 回合的插图' })).toBeVisible();

    app.services.image!.setReady(true);
    app.services.background.shot(shotText({ caption: '恢复后重试的图' }));
    const jobsBeforeRetry = imageJobRequests(app.services.image!).length;
    await page.getByRole('button', { name: '重试第 1 回合的插图' }).click();
    await expectImageDecoded(page, '恢复后重试的图');
    await expect
      .poll(() => imageJobRequests(app.services.image!).length, { timeout: 30_000 })
      .toBe(jobsBeforeRetry + 1);
    await expect(page.getByRole('button', { name: '重试第 2 回合的插图' })).toBeVisible();

    const releaseRunning = app.services.image!.holdNextJob();
    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '1',
      }),
    );
    app.services.background.shot(shotText({ caption: '关闭时还在画的图' }));
    await submitAction(page, '把手套摘下来');
    await expect(
      page.getByText('插图在排队').or(page.getByText('正在画插图')).or(page.getByText('正在构思画面')),
    ).toBeVisible({
      timeout: 30_000,
    });

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '1',
      }),
    );
    app.services.background.shot(shotText({ caption: '排队中应当取消的图' }));
    await submitAction(page, '把钥匙收进衣袋');
    const jobsBeforeCancel = imageJobRequests(app.services.image!).length;
    const beforeCancelRoute = await app.api.play.getRoute({
      routeId: new URL(page.url()).pathname.split('/').at(-1)!,
    });
    const pendingIds: string[] = beforeCancelRoute.turns.flatMap(
      (turn: { illustration: { id: string; status: string } | null }) =>
        turn.illustration && (turn.illustration.status === 'queued' || turn.illustration.status === 'running')
          ? [turn.illustration.id]
          : [],
    );
    expect(pendingIds.length).toBeGreaterThan(0);

    const settings = await context.newPage();
    await settings.goto(app.url);
    await settings.getByRole('link', { name: '设置' }).click();
    await settings.getByRole('link', { name: '出图服务' }).click();
    await settings.getByRole('checkbox', { name: '游玩时生成插图' }).click();
    await expect.poll(async () => (await app.api.image.autoIllustration.get()).enabled).toBe(false);
    await settings.close();

    await waitUntil(
      async () => {
        const route = await app.api.play.getRoute({
          routeId: new URL(page.url()).pathname.split('/').at(-1)!,
        });
        return route.turns.flatMap((turn: { illustration: { id: string; status: string } | null }) =>
          turn.illustration ? [turn.illustration] : [],
        );
      },
      (illustrations) =>
        pendingIds.every((id) => {
          const found = illustrations.find((illustration: { id: string }) => illustration.id === id);
          return found === undefined || found.status === 'cancelled';
        }),
      { label: 'cancelled illustrations', timeoutMs: 20_000 },
    );
    releaseRunning();
    expect(imageJobRequests(app.services.image!).length).toBe(jobsBeforeCancel);

    const routePath = new URL(page.url()).pathname;
    await page.goto(`${new URL(app.url).origin}${routePath}#token=${app.token}`);
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('img', { name: '关闭时还在画的图' })).toHaveCount(0);
    await expect(page.getByRole('img', { name: '排队中应当取消的图' })).toHaveCount(0);
    await expectImageDecoded(page, '恢复后重试的图');
    await expectImageDecoded(page, FIXTURE_CAPTION);
    await page
      .getByRole('button', { name: '放大查看插图' })
      .filter({ has: page.getByRole('img', { name: FIXTURE_CAPTION }) })
      .click();
    const dialog = page.getByRole('dialog', { name: '插图' });
    await expect(dialog.getByRole('link', { name: '保存图片' })).toBeVisible();
  } finally {
    await app.stop();
  }
});

async function expectNoSeriousAxe(page: Page): Promise<void> {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

test('E06 大图、下载、手记与 Axe', async ({ page }) => {
  const app = await startApp({ autoIllustration: true, imageOptions: { jobDelayMs: 80 } });
  try {
    const draft = await createDraftFixture(app);
    await seedAuthorPortrait(app, {
      workId: draft.workId,
      entityId: draft.entityId('榆既白'),
      appearance: '短卷发，左眉有一道浅缺口，穿深色短外套',
      bytes: pngBytes(300, 400),
    });
    await publishDraftWork(app, draft.workId);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expectImageDecoded(page, FIXTURE_CAPTION);
    const route = await app.api.play.getRoute({
      routeId: new URL(page.url()).pathname.split('/').at(-1)!,
    });
    const openingTurn = route.turns[0]!;

    const openButton = page.getByRole('button', { name: '放大查看插图' }).first();
    await openButton.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '插图' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: FIXTURE_CAPTION })).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = (
            globalThis as unknown as {
              document: { activeElement: { getAttribute(name: string): string | null } | null };
            }
          ).document.activeElement;
          return active?.getAttribute('aria-label') ?? null;
        }),
      )
      .toBe('放大查看插图');

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('link', { name: '保存图片' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    expect(readFileSync(path!).equals(Buffer.from(pngBytes(1536, 1024)))).toBe(true);
    await expectNoSeriousAxe(page);

    await dialog.getByRole('button', { name: '不要这张图' }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = (globalThis as unknown as { document: { activeElement: { id: string } | null } }).document
            .activeElement;
          return active?.id ?? null;
        }),
      )
      .toBe(`turn-${openingTurn.id}-para-1`);
    await expect(page.getByRole('button', { name: '放大查看插图' })).toHaveCount(0);
    await expectNoSeriousAxe(page);

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        changes: changeLines({
          type: 'relation',
          subject: '@1',
          object: '@2',
          key: 'acquaintance',
          stage: 'met',
          statement: '在候船厅见过修表匠',
          para: '1',
        }),
      }),
    );
    await submitAction(page, '向修表匠点头');
    await expect(page.getByText(FIXTURE_TURN_PARAGRAPHS[0]!)).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: '手记' }).click();
    const journal = page.getByRole('dialog', { name: '手记' });
    await expect(journal).toBeVisible();
    const seen = journal.locator('li').filter({ hasText: '短发的修表匠' });
    await expect(seen.getByRole('img', { name: '短发的修表匠' })).toBeVisible();
    await expect
      .poll(() =>
        seen
          .getByRole('img', { name: '短发的修表匠' })
          .evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBeGreaterThan(0);
    const heard = journal.locator('li').filter({ hasText: '传信人' });
    await expect(heard).toBeVisible();
    await expect(heard.getByRole('img')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(journal).toHaveCount(0);

    await page.getByRole('button', { name: '设置' }).click();
    await expectNoSeriousAxe(page);

    const authoringDraft = await createDraftFixture(app);
    await page.goto(`${new URL(app.url).origin}/works/${authoringDraft.workId}/edit#token=${app.token}`);
    await expect(page.getByRole('heading', { name: '故事方案' })).toBeVisible();
    await expectNoSeriousAxe(page);
  } finally {
    await app.stop();
  }
});

test('E07 支持参考的接口走编辑路径，拒绝时正文可继续', async ({ page }) => {
  const app = await startApp({
    image: 'openai',
    autoIllustration: true,
    openaiModel: 'gpt-image-2',
    openaiOptions: { maxReferences: 16, sizes: 'custom' },
    imageOptions: { jobDelayMs: 50 },
  });
  try {
    const reporter = await createDraftFixture(app);
    const portraitBytes = pngBytes(300, 400);
    await seedAuthorPortrait(app, {
      workId: reporter.workId,
      entityId: reporter.entityId('榆既白'),
      appearance: '短卷发，左眉有一道浅缺口，穿深色短外套',
      bytes: portraitBytes,
    });
    await publishDraftWork(app, reporter.workId);
    await page.goto(app.url);
    await startFromLibrary(page);
    app.services.openai!.enqueue({ kind: 'image', width: 1536, height: 1024 });
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    await expectImageDecoded(page, FIXTURE_CAPTION);
    expect(app.services.openaiRaw.filter((record) => record.path.includes('/images/generations'))).toHaveLength(1);

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '1',
      }),
    );
    app.services.background.shot(shotText({ caption: '编辑接口带参考的图', refs: 'C1:front' }));
    app.services.openai!.enqueue({ kind: 'image', width: 1536, height: 1024 });
    await submitAction(page, '把钥匙举到灯下');
    await expectImageSize(page, '编辑接口带参考的图', 1536, 1024);
    const editRecord = app.services.openaiRaw.find((record) => record.path.includes('/images/edits'))!;
    expect(editRecord).toBeTruthy();
    const files = await openAiMultipartFiles(editRecord);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('image[]');
    expect(files[0]!.bytes.equals(Buffer.from(portraitBytes))).toBe(true);

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
        illustrate: '1',
      }),
    );
    app.services.background.shot(shotText({ caption: '被拒绝的图', refs: 'C1:front' }));
    app.services.openai!.enqueue({ kind: 'error', status: 400, code: 'moderation_blocked' });
    await submitAction(page, '把钥匙递出去');
    await expect(page.getByText('出图服务拒绝了这张图。')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('重试第 2 回合的插图')).toBeVisible();
    expect(app.services.openaiRaw.filter((record) => record.path.includes('/images/edits'))).toHaveLength(2);

    app.services.text.enqueue(
      proposeTurnStep({
        prose: FIXTURE_TURN_PARAGRAPHS.slice(0, 2).join('\n\n'),
        options: ['继续等船', '走向闸杆'],
      }),
    );
    await submitAction(page, '把钥匙收回掌心');
    await expect(page.getByText(FIXTURE_TURN_PARAGRAPHS[1]!).last()).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.stop();
  }
});

test('E08 按需唤醒：授权后开场图可解码', async ({ page, context }) => {
  await context.route('https://accounts.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
  );
  const app = await startApp({
    launcher: true,
    launcherIdleMinutes: 45,
    imageGate: true,
    autoIllustration: true,
    imageOptions: { jobDelayMs: 80 },
  });
  try {
    await publishFixtureWork(app);
    app.services.imageGate!.setOnline(false);
    await page.goto(app.url);
    await startFromLibrary(page);
    app.services.background.shot(shotText({ caption: '授权后画出的开场图' }));
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    const openAuth = page.getByRole('button', { name: '打开授权页' });
    await expect(openAuth).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expectNoSeriousAxe(page);

    const starts = app.services.launcher!.requests.filter(
      (request) => request.method === 'POST' && request.path === '/v1/start',
    );
    expect(starts).toHaveLength(1);
    expect((starts[0]!.body as { idleMinutes: number }).idleMinutes).toBe(45);

    await openAuth.focus();
    const popupPromise = context.waitForEvent('page');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe('https://accounts.example.test/consent');
    await popup.close();

    await page.getByRole('button', { name: '继续' }).focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(
        () =>
          app.services.launcher!.requests.filter(
            (request) => request.method === 'POST' && request.path === '/v1/continue',
          ).length,
      )
      .toBe(1);
    app.services.image!.setReady(true);
    app.services.imageGate!.setOnline(true);
    await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText('正在唤醒出图服务')).toHaveCount(0, { timeout: 30_000 });
    await expectImageDecoded(page, '授权后画出的开场图');
    expect(app.services.launcher!.startCalls()).toBe(1);
  } finally {
    await app.stop();
  }
});

test('E08 纯文字开局不启动出图服务', async ({ page }) => {
  const app = await startApp({
    launcher: true,
    launcherIdleMinutes: 45,
    imageGate: true,
    autoIllustration: true,
  });
  try {
    await publishFixtureWork(app);
    app.services.imageGate!.setOnline(false);
    await page.goto(app.url);
    await startFromLibrary(page);
    await page.getByRole('button', { name: /^插图/ }).click();
    await page.getByRole('radiogroup', { name: '插图' }).getByText('本局纯文字').click();
    await page.getByRole('button', { name: '开始故事' }).click();
    await expect(page.getByText(FIXTURE_OPENING)).toBeVisible({ timeout: 30_000 });
    expect(app.services.launcher!.startCalls()).toBe(0);
    await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0);
  } finally {
    await app.stop();
  }
});
