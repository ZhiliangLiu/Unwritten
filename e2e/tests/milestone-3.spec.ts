import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startFakeOpenAiServer } from '../../packages/core/src/test-support/fake-openai-server.ts';
import {
  changeLines,
  proposePlanStep,
  proposePreviewStep,
  proposeTurnStep,
  rawToolStep,
  thinkingToolStep,
} from '../../packages/core/src/test-support/llm-steps.ts';

const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

const BACKGROUND = '灯塔镇只在夜里通电。新来的邮差要把一袋没有收件人的旧信送出去。';

interface App {
  dataDir: string;
  server: Awaited<ReturnType<typeof startFakeOpenAiServer>>;
  core: ChildProcess;
  url: string;
}

async function startApp(): Promise<App> {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-m3-'));
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
  const core = spawn(process.execPath, [corePath, '--data-dir', dataDir, '--log-level', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`core did not start: ${output}`)), 20_000);
    core.stdout?.on('data', (chunk: Buffer) => {
      output += String(chunk);
      const match = /UNWRITTEN_CORE_URL=(\S+)/.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    core.once('exit', (code) => reject(new Error(`core exited early: ${code}`)));
  });
  return { dataDir, server, core, url };
}

async function stopApp(app: App): Promise<void> {
  app.core.kill('SIGTERM');
  await new Promise((resolve) => app.core.once('exit', resolve));
  await app.server.close();
  rmSync(app.dataDir, { recursive: true, force: true });
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function newStory(page: Page, url: string, background = BACKGROUND): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: '新建故事' }).click();
  await page.getByRole('textbox', { name: /故事背景/ }).fill(background);
}

async function openSettings(page: Page): Promise<void> {
  await page.getByText('补充设定', { exact: true }).click();
}

async function addNameField(page: Page, name: string, defaultValue: string): Promise<void> {
  await page.getByRole('button', { name: '添加填写项' }).click();
  await page.getByRole('textbox', { name: '项目名' }).fill(name);
  await page.getByRole('textbox', { name: '默认值' }).fill(defaultValue);
  await page.getByRole('radio', { name }).check();
}

async function expectNewPlayRoute(page: Page, previous: string): Promise<void> {
  await expect
    .poll(() => {
      const path = new URL(page.url()).pathname;
      return path.startsWith('/play/') ? path : null;
    })
    .not.toBe(previous);
}

function previewStep(options: { prose: string; options: string[]; present?: string[]; changes?: string }) {
  return proposePreviewStep({
    title: '灯塔镇',
    blurb: '最后一班船开走以后，邮差还有一袋信没送出去。',
    publicSetting: '灯塔镇只在夜里通电。',
    prose: options.prose,
    options: options.options,
    place: '码头',
    time: '夜里',
    language: 'zh-CN',
    present: options.present,
    changes: options.changes,
  });
}

async function generatePlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: '生成故事方案' }).click();
  await expect(page.getByRole('heading', { name: '故事方案' })).toBeVisible();
}

async function confirmPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: '确认方案，生成开场' }).click();
  await expect(page.getByRole('heading', { name: '开场', exact: true })).toBeVisible({ timeout: 20_000 });
}

function authorTextPreviewStep(options: { options: string[] }) {
  return rawToolStep('propose_preview', {
    title: '灯塔镇',
    blurb: '最后一班船开走以后，邮差还有一袋信没送出去。',
    public_setting: '灯塔镇只在夜里通电。',
    options: options.options.map((text) => JSON.stringify({ text })).join('\n'),
    place: '码头',
    time: '夜里',
    language: 'zh-CN',
    present: '',
    changes: '',
    state: '',
  });
}

const DEFAULT_PREVIEW = {
  prose: '船靠岸的时候，整座镇子黑着。\n\n邮差拎着邮袋走下跳板。',
  options: ['朝灯塔走', '留在码头'],
};

const LIGHTHOUSE_PLAN = {
  entities: [
    {
      ref: 'e1',
      kind: 'character',
      role: 'protagonist',
      name: '新来的邮差',
      known_as: '',
      profile: '二十多岁，记性好',
      from: 'ai',
    },
    {
      ref: 'e2',
      kind: 'character',
      role: 'cast',
      name: '林潮',
      known_as: '守灯人',
      profile: '五十岁上下，话少',
      from: 'ai',
    },
  ],
  secrets: [
    {
      title: '上一任邮差的去向',
      statement: '上一任邮差在灯塔里住过一年，后来乘夜船离开',
      subject: '林潮',
      knowers: '林潮',
      reveal: '主角拿到第三封旧信时',
      from: 'ai',
    },
  ],
  state: [
    {
      key: 'tide',
      label: '潮位',
      display: 'number',
      min: '0',
      max: '10',
      unit: '米',
      hidden: 'false',
      reveal: '',
      initial: '3',
      from: 'ai',
    },
  ],
};

test('只写一句背景一路点完', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: '新建故事' }).click();
    await page.getByRole('textbox', { name: /故事背景/ }).fill('灯塔镇只在夜里通电。');
    await expectNoAxeViolations(page);

    app.server.enqueue(proposePlanStep(), previewStep(DEFAULT_PREVIEW));
    await generatePlan(page);
    await expect(page.getByText('AI 补全').first()).toBeVisible();
    await expectNoAxeViolations(page);

    await confirmPlan(page);
    await expect(page.getByText('船靠岸的时候，整座镇子黑着。')).toBeVisible({ timeout: 20_000 });
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await expect(page.getByRole('heading', { name: '已存入作品库' })).toBeVisible();
    await page.getByRole('link', { name: '开始故事' }).click();
    await expect(page.getByText('船靠岸的时候，整座镇子黑着。')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('group', { name: '推荐行动' })).toBeVisible();
    await expectNoAxeViolations(page);
  } finally {
    await stopApp(app);
  }
});

test('秘密默认折叠，状态栏显示数字和进度条', async ({ page }) => {
  const app = await startApp();
  try {
    await newStory(page, app.url);
    app.server.enqueue(proposePlanStep(LIGHTHOUSE_PLAN), previewStep(DEFAULT_PREVIEW));
    await generatePlan(page);

    await expect(page.getByText('幕后已折叠 · 1 条')).toBeVisible();
    await expect(page.getByText('上一任邮差的去向')).toBeVisible();
    await expect(page.getByText('上一任邮差在灯塔里住过一年，后来乘夜船离开')).toHaveCount(0);
    await page.getByRole('button', { name: '查看幕后设定' }).click();
    await expect(page.getByText('上一任邮差在灯塔里住过一年，后来乘夜船离开')).toBeVisible();
    await expectNoAxeViolations(page);

    await confirmPlan(page);

    await page.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await page.getByRole('link', { name: '开始故事' }).click();
    await expect(page.getByRole('heading', { name: '当前状态' })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('潮位')).toBeVisible();
    await expect(page.getByText('3米')).toBeVisible();
    const meter = page.getByRole('meter', { name: '潮位' });
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute('aria-valuenow', '3');
    await expect(meter).toHaveAttribute('aria-valuemax', '10');
    await expect(meter).toHaveAttribute('aria-valuetext', '3米');
    await expectNoAxeViolations(page);
  } finally {
    await stopApp(app);
  }
});

test('主角姓名留给玩家填写', async ({ page }) => {
  const app = await startApp();
  try {
    await newStory(page, app.url);
    await openSettings(page);
    await addNameField(page, '名字', '阿岚');
    await page.getByText('用我的原文', { exact: true }).click();
    await page
      .getByRole('textbox', { name: '开场原文' })
      .fill(
        '船靠岸的时候，整座镇子黑着。\n\n{{protagonist.名字}}拎着邮袋走下跳板，只看见山顶的灯塔还亮着。\n\n一个提着马灯的人站在码头尽头，像是在等谁。',
      );
    await expectNoAxeViolations(page);

    app.server.enqueue(
      proposePlanStep(),
      authorTextPreviewStep({ options: ['报上{{protagonist.名字}}的名字', '等在原地'] }),
    );
    await generatePlan(page);
    await confirmPlan(page);
    await expect(page.getByText('「名字」').first()).toBeVisible();
    await page.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await page.getByRole('link', { name: '开始故事' }).click();

    await expect(page.getByRole('heading', { name: '开始故事' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('textbox', { name: '名字' }).fill('阿岚');
    await page.getByRole('button', { name: '开始故事' }).click();

    await expect(page.getByText('阿岚拎着邮袋走下跳板，只看见山顶的灯塔还亮着。')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('group', { name: '推荐行动' })).toBeVisible();
    await expect(page.getByText('报上阿岚的名字')).toBeVisible();
    await expectNoAxeViolations(page);
  } finally {
    await stopApp(app);
  }
});

test('作者原文写死主角名时不能采用', async ({ page }) => {
  const app = await startApp();
  try {
    await newStory(page, app.url);
    await openSettings(page);
    await addNameField(page, '名字', '阿岚');
    await page.getByText('用我的原文', { exact: true }).click();
    await page
      .getByRole('textbox', { name: '开场原文' })
      .fill('船靠岸的时候，整座镇子黑着。\n\n阿岚拎着邮袋走下跳板，只看见山顶的灯塔还亮着。');

    app.server.enqueue(proposePlanStep(), authorTextPreviewStep({ options: ['朝灯塔走'] }));
    await generatePlan(page);
    await confirmPlan(page);

    await expect(page.getByText('这些句子需要先改')).toBeVisible();
    await expect(page.getByText('第 2 段')).toBeVisible();
    await expect(page.getByText('写死了主角的名字，改成填写项')).toBeVisible();
    await expect(page.getByText('先改好上面的句子，才能采用')).toBeVisible();
    await expect(page.getByRole('button', { name: '采用开场并存入作品库' })).toBeDisabled();
    await expectNoAxeViolations(page);
  } finally {
    await stopApp(app);
  }
});

test('每局生成人物开两局', async ({ page }) => {
  const app = await startApp();
  const castChanges = (name: string, knownAs: string) =>
    changeLines({
      type: 'new_entity',
      kind: 'character',
      name,
      known_as: knownAs,
      profile: '守灯人，话少',
      slot: '1',
      para: '1',
    });
  const castStep = (name: string, knownAs: string) =>
    rawToolStep('propose_cast', {
      cast: JSON.stringify({ slot: '1', name, known_as: knownAs, profile: '守灯人，话少' }),
    });
  const slowCastStep = (name: string, knownAs: string) =>
    thinkingToolStep(
      'propose_cast',
      { cast: JSON.stringify({ slot: '1', name, known_as: knownAs, profile: '守灯人，话少' }) },
      '正在核对人物位置和作品里已有的名字，再决定这一局的人叫什么。'.repeat(20),
      100,
    );
  const openingStep = (name: string, knownAs: string, prose: string) =>
    rawToolStep('propose_opening', {
      prose,
      options: '{"text":"走过去"}\n{"text":"先看看四周"}',
      place: '码头',
      time: '夜里',
      present: knownAs,
      changes: castChanges(name, knownAs),
      state: '',
    });
  try {
    await newStory(page, app.url);
    await openSettings(page);
    await page.getByText('每次新开局生成', { exact: true }).click();
    app.server.enqueue(
      proposePlanStep({
        entities: [
          {
            ref: 'e1',
            kind: 'character',
            role: 'protagonist',
            name: '新来的邮差',
            known_as: '',
            profile: '二十多岁，记性好',
            slot_role: '',
            encounter: '',
            from: 'ai',
          },
          {
            ref: 'e2',
            kind: 'character',
            role: 'cast',
            name: '提灯的人',
            profile: '在码头等人的守灯人',
            slot_role: '守灯人',
            encounter: '在码头提灯等着',
            from: 'ai',
          },
        ],
      }),
      previewStep({
        prose: '船靠岸的时候，整座镇子黑着。\n\n提灯的人站在码头尽头。',
        options: ['走过去', '先看看四周'],
        present: ['提灯的人'],
        changes: castChanges('陶枝', '提灯的人'),
      }),
    );
    await generatePlan(page);
    await confirmPlan(page);
    await page.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await expect(page.getByRole('heading', { name: '已存入作品库' })).toBeVisible();

    app.server.enqueue(
      slowCastStep('陶枝', '提灯的人'),
      openingStep('陶枝', '提灯的人', '船靠岸的时候，整座镇子黑着。\n\n提灯的人提着马灯站在码头尽头。'),
    );
    await page.getByRole('link', { name: '开始故事' }).click();
    await expect(page.getByRole('heading', { name: '正在为这一局准备人物和开场' })).toBeVisible();
    await expectNoAxeViolations(page);
    await expect(page.getByText('提灯的人提着马灯站在码头尽头。')).toBeVisible({ timeout: 30_000 });
    const firstRoute = new URL(page.url()).pathname;

    app.server.enqueue(
      castStep('白棠', '理鱼篓的人'),
      openingStep('白棠', '理鱼篓的人', '船靠岸的时候，整座镇子黑着。\n\n理鱼篓的人蹲在岸边，把鱼篓放进水里。'),
    );
    await page.getByRole('link', { name: '作品库' }).click();
    await page.getByRole('button', { name: '《灯塔镇》的更多操作' }).click();
    await page.getByRole('menuitem', { name: '重新开局' }).click();
    await expect(page.getByText('理鱼篓的人蹲在岸边，把鱼篓放进水里。')).toBeVisible({ timeout: 30_000 });
    await expectNewPlayRoute(page, firstRoute);
    await expect(page.getByText('提灯的人')).toHaveCount(0);
  } finally {
    await stopApp(app);
  }
});

test('完结后提供重新开局', async ({ page }) => {
  const app = await startApp();
  try {
    await newStory(page, app.url);
    app.server.enqueue(proposePlanStep({ ending: '三封旧信都送到收件人手里' }), previewStep(DEFAULT_PREVIEW));
    await generatePlan(page);
    await confirmPlan(page);
    await page.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await page.getByRole('link', { name: '开始故事' }).click();
    await expect(page.getByText('船靠岸的时候，整座镇子黑着。')).toBeVisible({ timeout: 20_000 });
    const firstRoute = new URL(page.url()).pathname;

    app.server.enqueue(
      proposeTurnStep({
        prose: '最后一封信送到了收件人手里。',
        options: ['回头看看镇子'],
        changes: '',
        ending: true,
      }),
    );
    await page.getByRole('textbox', { name: '你的行动' }).fill('把最后一封信送出去');
    await page.getByRole('textbox', { name: '你的行动' }).press('Enter');
    await expect(page.getByText('最后一封信送到了收件人手里。')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: '故事到这里结束了' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '你的行动' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: '推荐行动' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: '重新开局' }).click();
    await expectNewPlayRoute(page, firstRoute);
    await expect(page.getByText('船靠岸的时候，整座镇子黑着。')).toBeVisible({ timeout: 20_000 });
  } finally {
    await stopApp(app);
  }
});
