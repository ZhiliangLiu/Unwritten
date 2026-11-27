import { ENTITY_KINDS, KNOWLEDGE_LEVELS } from '@unwritten/contracts';
import type {
  JournalView,
  RetryInput,
  RouteView,
  StatusView,
  SubmitActionInput,
  TurnRequestView,
  TurnView,
} from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { App } from '../../app/App.tsx';
import { router } from '../../app/router.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { isMacPlatform } from '../../shared/hooks/usePlatform.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { expectHeadingOutline } from '../../shared/test/heading-outline.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import play from '../../i18n/zh-CN/play.json';
import { ENTITY_KIND_LABEL_KEYS, KNOWLEDGE_LEVEL_LABEL_KEYS } from './JournalSubject.tsx';
import { paragraphAnchorId } from './anchors.ts';

const clientMock = vi.hoisted(() => ({ api: null as unknown }));

vi.mock('../../shared/api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/api/client.ts')>();
  return { ...actual, createApiClient: () => clientMock.api };
});

initTestI18n();

const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';
const workId = '6a5b4c3d-2e1f-4a9b-8c7d-6e5f4a3b2c1d';

function makeTurn(overrides: Partial<TurnView> = {}): TurnView {
  return {
    id: crypto.randomUUID(),
    originRequest: null,
    depth: 1,
    action: { text: '把船票放在柜台上', optionIndex: 1 },
    paragraphs: ['雾还没散。', '守夜人提起那只空鸟笼。'],
    options: [
      { text: '问下一班船什么时候来', hint: null },
      { text: '看看窗外的雾', hint: null },
      { text: '把鸟笼接过来', hint: null },
    ],
    createdAt: 1,
    ...overrides,
  };
}

function opening(overrides: Partial<TurnView> = {}): TurnView {
  return makeTurn({ depth: 0, action: null, ...overrides });
}

function makeRoute(turns: TurnView[], pending: TurnRequestView | null = null): RouteView {
  return {
    id: routeId,
    workId,
    workTitle: '雾港的末班船',
    language: 'zh-CN',
    headTurnId: turns[turns.length - 1]!.id,
    turns,
    pending,
    ended: false,
  };
}

function makeRequest(overrides: Partial<TurnRequestView> = {}): TurnRequestView {
  return {
    id: crypto.randomUUID(),
    status: 'running',
    action: { text: '把票根收进抽屉', optionIndex: null },
    error: null,
    attempts: 1,
    expectedHeadTurnId: '',
    resultTurnId: null,
    updatedAt: 1,
    ...overrides,
  };
}

interface PlayState {
  route: RouteView;
  journal: JournalView;
  status?: StatusView;
}

async function renderPlay(initial: PlayState) {
  const fake = createFakeApi({
    'play.getRoute': () => initial.route,
    'play.getJournal': () => initial.journal,
    'play.getStatus': () =>
      initial.status ?? { routeId, headTurnId: initial.route.headTurnId, columns: [], closed: [] },
    'play.submitAction': (input) => makeRequest({ id: (input as SubmitActionInput).requestId }),
    'play.retry': (input) => makeRequest({ id: (input as RetryInput).requestId, attempts: 2 }),
    'log.client': () => undefined,
  });
  const result = await renderRoute(`/play/${routeId}`, { api: fake.api });
  await waitFor(() => result.container.querySelector('article') !== null);
  return { ...result, fake };
}

async function waitFor(check: () => boolean, timeout = 3_000): Promise<void> {
  const startedAt = performance.now();
  while (!check() && performance.now() - startedAt < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TestEvent {
  type: 'turn.committed';
  routeId: string;
}

function createEventStream() {
  const pending: TestEvent[] = [];
  const waiting: Array<(result: IteratorResult<TestEvent>) => void> = [];
  const iterator: AsyncIterableIterator<TestEvent> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      const event = pending.shift();
      if (event) return Promise.resolve({ done: false as const, value: event });
      return new Promise<IteratorResult<TestEvent>>((resolve) => waiting.push(resolve));
    },
  };
  return {
    iterator,
    push(event: TestEvent) {
      const resolve = waiting.shift();
      if (resolve) resolve({ done: false as const, value: event });
      else pending.push(event);
    },
  };
}

function statusCalls(calls: FakeApiCall[]): FakeApiCall[] {
  return calls.filter((call) => call.path === 'play.getStatus');
}

function pressMod(key: string, composing = false): void {
  const modifier = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, isComposing: composing, ...modifier }));
}

function findButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

function textarea(): HTMLTextAreaElement {
  const element = document.querySelector('textarea');
  if (!element) throw new Error('找不到输入框');
  return element;
}

function liveRegion(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[aria-live]');
  if (!element) throw new Error('找不到宣告区');
  return element;
}

function journalView(turns: TurnView[], overrides: Partial<JournalView> = {}): JournalView {
  const first = turns[0]!;
  return {
    routeId,
    headTurnId: turns[turns.length - 1]!.id,
    subjects: [
      {
        entityId: crypto.randomUUID(),
        kind: 'character',
        name: '提鸟笼的人',
        lines: [
          {
            id: 'line-known',
            text: '他在等一艘不会来的船。',
            level: 'heard',
            source: { turnId: first.id, depth: first.depth, para: 1 },
          },
        ],
      },
    ],
    events: [
      {
        id: 'event-crossing',
        text: '末班船停航了。',
        level: 'confirmed',
        source: { turnId: first.id, depth: first.depth, para: 2 },
      },
    ],
    ...overrides,
  };
}

describe('游玩页', () => {
  it('无可访问性违规（手记关闭）', async () => {
    await renderPlay({ route: makeRoute([opening()]), journal: journalView([opening()]) });
    await expectNoAxeViolations(document.body);
  });

  it('无可访问性违规（手记打开）', async () => {
    const turns = [opening()];
    await renderPlay({ route: makeRoute(turns), journal: journalView(turns) });
    findButton('手记').click();
    await waitFor(() => document.querySelector('[role="dialog"]') !== null);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await expectNoAxeViolations(document.body);
  });

  it('标题大纲正确（手记关闭）', async () => {
    const { container } = await renderPlay({ route: makeRoute([opening()]), journal: journalView([opening()]) });
    expectHeadingOutline(document.body);
    expect(container.querySelector('article h2')).not.toBeNull();
  });

  it('标题大纲正确（手记打开）', async () => {
    const turns = [opening()];
    await renderPlay({ route: makeRoute(turns), journal: journalView(turns) });
    findButton('手记').click();
    await waitFor(() => document.querySelector('[role="dialog"]') !== null);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expectHeadingOutline(document.body);
  });

  it('段落用 core 给的切分，并带锚点', async () => {
    const turn = opening({ paragraphs: ['甲\n乙', '丙'] });
    await renderPlay({ route: makeRoute([turn]), journal: journalView([turn]) });
    const first = document.getElementById(paragraphAnchorId(turn.id, 1));
    const second = document.getElementById(paragraphAnchorId(turn.id, 2));
    expect(first?.textContent).toBe('甲\n乙');
    expect(second?.textContent).toBe('丙');
    expect(document.getElementById(paragraphAnchorId(turn.id, 3))).toBeNull();
  });

  it('只在最新决定点显示行动区', async () => {
    const turn = opening();
    await renderPlay({ route: makeRoute([turn]), journal: journalView([turn]) });
    expect(document.querySelector('fieldset[aria-label="推荐行动"]')).not.toBeNull();
    expect(document.querySelector('textarea')).not.toBeNull();
  });

  it('生成中不显示行动区，并标记 aria-busy', async () => {
    const turn = opening();
    const pending = makeRequest({ status: 'running' });
    await renderPlay({ route: makeRoute([turn], pending), journal: journalView([turn]) });
    expect(document.querySelector('fieldset[aria-label="推荐行动"]')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    const busy = document.querySelector('article[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.textContent).toContain('正在写下一段');
  });

  it('⌘ 加数字选择推荐行动', async () => {
    const turn = opening();
    const { fake } = await renderPlay({ route: makeRoute([turn]), journal: journalView([turn]) });
    pressMod('2');
    await waitFor(() => fake.calls.some((call) => call.path === 'play.submitAction'));
    const call = fake.calls.find((item) => item.path === 'play.submitAction');
    const input = call?.input as SubmitActionInput;
    expect(input.action.optionIndex).toBe(2);
    expect(input.action.text).toBe('看看窗外的雾');
  });

  it('组字时 ⌘ 加数字不提交', async () => {
    const turn = opening();
    const { fake } = await renderPlay({ route: makeRoute([turn]), journal: journalView([turn]) });
    pressMod('1', true);
    await sleep(50);
    expect(fake.calls.some((call) => call.path === 'play.submitAction')).toBe(false);
    pressMod('1');
    await waitFor(() => fake.calls.some((call) => call.path === 'play.submitAction'));
    expect(fake.calls.filter((call) => call.path === 'play.submitAction')).toHaveLength(1);
  });

  it('输入框有字时点推荐行动先确认', async () => {
    const turn = opening();
    const { fake } = await renderPlay({ route: makeRoute([turn]), journal: journalView([turn]) });
    await userEvent.fill(textarea(), '我想先自己看看');
    findButton('看看窗外的雾').click();
    await waitFor(() => document.body.textContent?.includes('输入框里还有你写的内容') ?? false);
    findButton('继续编辑').click();
    await sleep(50);
    expect(fake.calls.some((call) => call.path === 'play.submitAction')).toBe(false);
    expect(textarea().value).toBe('我想先自己看看');

    findButton('看看窗外的雾').click();
    await waitFor(() => document.body.textContent?.includes('改用推荐行动') ?? false);
    findButton('改用推荐行动').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'play.submitAction'));
    const input = fake.calls.find((call) => call.path === 'play.submitAction')?.input as SubmitActionInput;
    expect(input.action.optionIndex).toBe(2);
    expect(input.action.text).toBe('看看窗外的雾');
    expect(textarea().value).toBe('');
  });

  it('失败后改写行动', async () => {
    const turn = opening();
    const failed = makeRequest({ status: 'failed', error: 'timeout', attempts: 1 });
    const { fake } = await renderPlay({ route: makeRoute([turn], failed), journal: journalView([turn]) });
    expect(document.body.textContent).toContain('模型回复超时。请重试。');
    expect(document.querySelector('textarea')).toBeNull();
    findButton('改写行动').click();
    await waitFor(() => document.querySelector('textarea')?.value === failed.action.text);
    await waitFor(() => document.activeElement === document.querySelector('textarea'));
    expect(document.activeElement).toBe(textarea());
    expect(document.body.textContent).not.toContain('模型回复超时。请重试。');

    await userEvent.fill(textarea(), '先看看票根上的名字');
    findButton('发送行动').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'play.submitAction'));
    const input = fake.calls.find((call) => call.path === 'play.submitAction')?.input as SubmitActionInput;
    expect(input.requestId).not.toBe(failed.id);
    expect(input.action.text).toBe('先看看票根上的名字');
  });

  it('失败后重试沿用同一个请求 id', async () => {
    const turn = opening();
    const failed = makeRequest({ status: 'failed', error: 'timeout', attempts: 1 });
    const { fake } = await renderPlay({ route: makeRoute([turn], failed), journal: journalView([turn]) });
    findButton('重试这次行动').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'play.retry'));
    const input = fake.calls.find((call) => call.path === 'play.retry')?.input as RetryInput;
    expect(input.requestId).toBe(failed.id);
  });

  it('新回合到达时只播报一次', async () => {
    const state: PlayState = { route: makeRoute([opening()]), journal: journalView([opening()]) };
    const { queryClient } = await renderPlay(state);
    const announcements: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node as Element;
          const region = element.matches('[aria-live]') ? element : element.querySelector('[aria-live]');
          if (region) announcements.push(region.textContent ?? '');
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const arrived = makeTurn({ originRequest: { id: crypto.randomUUID(), attempt: 1 } });
    state.route = makeRoute([state.route.turns[0]!, arrived]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    await waitFor(() => liveRegion().textContent === '新的剧情已到达');
    expect(liveRegion().textContent).toBe('新的剧情已到达');

    for (let render = 0; render < 3; render += 1) {
      await queryClient.setQueryData(queryKeys.route(routeId), {
        ...state.route,
        workTitle: `雾港的末班船 · ${render}`,
      });
      await sleep(20);
    }
    observer.disconnect();
    expect(announcements).toEqual(['新的剧情已到达']);
  });

  it('首次进入时已有的回合不播放进入动效，新到达的回合带进入标记', async () => {
    const first = opening();
    const state: PlayState = { route: makeRoute([first]), journal: journalView([first]) };
    const { container, queryClient } = await renderPlay(state);
    const firstArticle = document.getElementById(`turn-${first.id}-heading`)?.closest('article');
    expect(firstArticle?.hasAttribute('data-uw-arriving')).toBe(false);

    const arrived = makeTurn({ originRequest: { id: crypto.randomUUID(), attempt: 1 } });
    state.route = makeRoute([first, arrived]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    await waitFor(() => container.querySelectorAll('article').length === 2);
    const arrivedArticle = document.getElementById(`turn-${arrived.id}-heading`)?.closest('article');
    expect(arrivedArticle?.hasAttribute('data-uw-arriving')).toBe(true);
    expect(firstArticle?.hasAttribute('data-uw-arriving')).toBe(false);
  });

  it('打开手记才查询手记', async () => {
    const turn = opening();
    const journal: JournalView = { routeId, headTurnId: turn.id, subjects: [], events: [] };
    const { fake } = await renderPlay({ route: makeRoute([turn]), journal });
    expect(fake.calls.some((call) => call.path === 'play.getJournal')).toBe(false);
    findButton('手记').click();
    await waitFor(() => fake.calls.filter((call) => call.path === 'play.getJournal').length === 1);
    await waitFor(() => document.body.textContent?.includes('手记还是空的') ?? false);
    expect(document.body.textContent).toContain('手记还是空的');
    expect(fake.calls.filter((call) => call.path === 'play.getJournal')).toHaveLength(1);
  });

  it('从手记跳回原文', async () => {
    document.documentElement.style.setProperty('--uw-motion-duration-highlight', '50ms');
    const first = opening();
    const second = makeTurn({ paragraphs: ['海雾还没散。', '票根上的名字被水浸过。'] });
    const journal = journalView([first, second], {
      subjects: [
        {
          entityId: crypto.randomUUID(),
          kind: 'item',
          name: '折过的船票',
          lines: [
            {
              id: 'line-ticket',
              text: '票根上有一个被水浸过的名字。',
              level: 'confirmed',
              source: { turnId: second.id, depth: second.depth, para: 2 },
            },
          ],
        },
      ],
      events: [],
    });
    await renderPlay({ route: makeRoute([first, second]), journal });
    findButton('手记').click();
    await waitFor(() => document.body.textContent?.includes('折过的船票') ?? false);
    findButton('跳回原文').click();
    const target = document.getElementById(paragraphAnchorId(second.id, 2));
    await waitFor(() => document.activeElement === target);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(target?.hasAttribute('data-uw-changed')).toBe(true);
    await sleep(120);
    expect(target?.hasAttribute('data-uw-changed')).toBe(false);
  });

  it('没有来源的手记行没有跳转按钮', async () => {
    const first = opening();
    const journal = journalView([first], {
      subjects: [
        {
          entityId: crypto.randomUUID(),
          kind: 'character',
          name: '提鸟笼的人',
          lines: [
            {
              id: 'line-sourced',
              text: '他说自己在等下一班船。',
              level: 'confirmed',
              source: { turnId: first.id, depth: first.depth, para: 1 },
            },
            { id: 'line-unsourced', text: '这件事他还没告诉别人。', level: 'suspects', source: null },
          ],
        },
      ],
      events: [],
    });
    await renderPlay({ route: makeRoute([first]), journal });
    findButton('手记').click();
    await waitFor(() => document.body.textContent?.includes('他说自己在等下一班船') ?? false);
    const jumps = Array.from(document.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('跳回原文'),
    );
    expect(jumps).toHaveLength(1);
    expect(jumps[0]?.textContent).toContain('开场第 1 段');
  });

  it('每个实体种类和知情程度都有文案', () => {
    expect(ENTITY_KINDS.length).toBeGreaterThan(0);
    expect(KNOWLEDGE_LEVELS.length).toBeGreaterThan(0);
    for (const kind of ENTITY_KINDS) {
      const key = ENTITY_KIND_LABEL_KEYS[kind].replace(/^play:/, '');
      const parts = key.split('.');
      expect(parts).toHaveLength(3);
      expect(play.journal.group[kind]).not.toBe('');
    }
    for (const level of KNOWLEDGE_LEVELS) {
      expect(KNOWLEDGE_LEVEL_LABEL_KEYS[level]).toBe(`play:journal.level.${level}`);
      expect(play.journal.level[level]).not.toBe('');
    }
  });

  it('新回合到达后上报 client.turn_visible', async () => {
    const first = opening();
    const state: PlayState = { route: makeRoute([first]), journal: journalView([first]) };
    const { fake, queryClient } = await renderPlay(state);
    pressMod('1');
    await waitFor(() => fake.calls.some((call) => call.path === 'play.submitAction'));
    const submit = fake.calls.find((call) => call.path === 'play.submitAction');
    expect(submit).toBeDefined();
    const requestId = (submit!.input as SubmitActionInput).requestId;

    state.route = makeRoute([first, makeTurn({ originRequest: { id: requestId, attempt: 1 } })]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    await waitFor(() =>
      fake.calls.some(
        (call) => call.path === 'log.client' && (call.input as { metric?: string }).metric === 'client.turn_visible',
      ),
    );
    const samples = fake.calls.filter(
      (call) => call.path === 'log.client' && (call.input as { metric?: string }).metric === 'client.turn_visible',
    );
    expect(samples).toHaveLength(1);
    const sample = samples[0]!.input as { outcome: string; requestId: string; durationMs: number };
    expect(sample.outcome).toBe('ok');
    expect(sample.requestId).toBe(requestId);
    expect(typeof sample.durationMs).toBe('number');
  });

  it('失败后上报 client.turn_visible 错误结果', async () => {
    const first = opening();
    const state: PlayState = { route: makeRoute([first]), journal: journalView([first]) };
    const { fake, queryClient } = await renderPlay(state);
    pressMod('1');
    await waitFor(() => fake.calls.some((call) => call.path === 'play.submitAction'));
    const submit = fake.calls.find((call) => call.path === 'play.submitAction');
    expect(submit).toBeDefined();
    const requestId = (submit!.input as SubmitActionInput).requestId;

    state.route = makeRoute([first], makeRequest({ id: requestId, status: 'failed', error: 'timeout', attempts: 1 }));
    await queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    await waitFor(() =>
      fake.calls.some(
        (call) => call.path === 'log.client' && (call.input as { metric?: string }).metric === 'client.turn_visible',
      ),
    );
    const sample = fake.calls.find(
      (call) => call.path === 'log.client' && (call.input as { metric?: string }).metric === 'client.turn_visible',
    )?.input as { outcome: string; requestId: string };
    expect(sample.outcome).toBe('error');
    expect(sample.requestId).toBe(requestId);
  });

  it('路线刚完结时宣告一次', async () => {
    const turn = opening();
    const state: PlayState = { route: makeRoute([turn]), journal: journalView([turn]) };
    const { queryClient } = await renderPlay(state);
    expect(liveRegion().textContent).toBe('');

    state.route = { ...makeRoute([turn]), ended: true };
    await queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    await waitFor(() => liveRegion().textContent === '故事到这里结束了');
    expect(liveRegion().textContent).toBe('故事到这里结束了');

    await queryClient.setQueryData(queryKeys.route(routeId), { ...state.route, workTitle: '雾港的末班船 · 2' });
    await sleep(20);
    expect(liveRegion().textContent).toBe('故事到这里结束了');
  });

  it('完结后不显示行动输入，提供重新开局', async () => {
    const turn = opening();
    const playScreen = await renderPlay({
      route: { ...makeRoute([turn]), ended: true },
      journal: journalView([turn]),
    });
    await waitFor(() => playScreen.container.textContent?.includes('故事到这里结束了') ?? false);
    expect(playScreen.container.querySelector('textarea')).toBeNull();
    expect(playScreen.getByRole('link', { name: '重新开局' }).element()).toBeTruthy();
  });

  it('回合提交后重新读取状态栏', async () => {
    initTestI18n();
    const route = makeRoute([opening()]);
    const stream = createEventStream();
    const fake = createFakeApi({
      'play.getRoute': () => route,
      'play.getStatus': () => ({ routeId, headTurnId: route.headTurnId, columns: [], closed: [] }),
      'events.subscribe': () => stream.iterator,
      'log.client': () => undefined,
    });
    clientMock.api = fake.api;
    await router.navigate({ to: '/play/$routeId', params: { routeId } });
    window.location.hash = 'token=test';
    const screen = await render(<App />);

    await vi.waitFor(() => expect(statusCalls(fake.calls).length).toBeGreaterThan(0));
    await sleep(200);
    const before = statusCalls(fake.calls).length;
    stream.push({ type: 'turn.committed', routeId });
    await vi.waitFor(() => expect(statusCalls(fake.calls).length).toBe(before + 1));
    expect(statusCalls(fake.calls)).toHaveLength(before + 1);
    await screen.unmount();
    clientMock.api = null;
  });
});
