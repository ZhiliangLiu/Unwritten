import { ORPCError } from '@orpc/client';
import type { PlaythroughView, StartInfo, StartPlaythroughInput } from '@unwritten/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { renderRoute } from '../../shared/test/render.tsx';

const workId = '6a5b4c3d-2e1f-4a9b-8c7d-6e5f4a3b2c1d';
const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';

function startInfo(fields: StartInfo['fields']): StartInfo {
  return { workId, title: '灯塔镇', fields, castMode: 'fixed' };
}

function playthrough(id: string, route: string | null): PlaythroughView {
  return {
    id,
    workId,
    workTitle: '灯塔镇',
    routeId: route,
    opening: route ? null : { id: crypto.randomUUID(), status: 'running', error: null, attempts: 1, updatedAt: 1 },
  };
}

function startInputs(calls: FakeApiCall[]): StartPlaythroughInput[] {
  return calls.filter((call) => call.path === 'play.start').map((call) => call.input as StartPlaythroughInput);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('StartPage', () => {
  it('有填写项时先填再开始', async () => {
    const fake = createFakeApi({
      'play.getStartInfo': () => startInfo([{ name: '名字', defaultValue: '阿岚', isName: true }]),
      'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, null),
      'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    const field = screen.getByRole('textbox', { name: '名字' });
    await expect.element(field).toBeVisible();
    await field.fill('阿岚');
    await screen.getByRole('button', { name: '开始故事' }).click();

    await vi.waitFor(() => {
      expect(startInputs(fake.calls)[0]).toMatchObject({ workId, protagonist: { 名字: '阿岚' } });
    });
    await screen.unmount();
  });

  it('留空的项不传空格以外的内容', async () => {
    const fake = createFakeApi({
      'play.getStartInfo': () =>
        startInfo([
          { name: '名字', defaultValue: '阿岚', isName: true },
          { name: '职业', defaultValue: '邮差', isName: false },
        ]),
      'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, null),
      'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    await expect.element(screen.getByRole('textbox', { name: '职业' })).toBeVisible();
    await screen.getByRole('button', { name: '开始故事' }).click();

    await vi.waitFor(() => {
      expect(startInputs(fake.calls)[0]?.protagonist).toEqual({ 名字: '', 职业: '' });
    });
    await screen.unmount();
  });

  it('没有填写项时自动开始一次', async () => {
    const fake = createFakeApi({
      'play.getStartInfo': () => startInfo([]),
      'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, null),
      'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    await vi.waitFor(() => expect(startInputs(fake.calls).length).toBe(1));
    await sleep(50);
    expect(startInputs(fake.calls).length).toBe(1);
    expect(startInputs(fake.calls)[0]?.protagonist).toEqual({});
    await screen.unmount();
  });

  it('提交失败后重试沿用同一个开局 id', async () => {
    let attempts = 0;
    const fake = createFakeApi({
      'play.getStartInfo': () => startInfo([{ name: '名字', defaultValue: '阿岚', isName: true }]),
      'play.start': (input) => {
        attempts += 1;
        if (attempts === 1) throw new ORPCError('core_unreachable');
        return playthrough((input as StartPlaythroughInput).playthroughId, null);
      },
      'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    await expect.element(screen.getByRole('textbox', { name: '名字' })).toBeVisible();
    await screen.getByRole('button', { name: '开始故事' }).click();
    await expect.element(screen.getByRole('alert')).toBeVisible();
    await screen.getByRole('button', { name: '开始故事' }).click();

    await vi.waitFor(() => expect(startInputs(fake.calls).length).toBe(2));
    const [first, second] = startInputs(fake.calls);
    expect(first?.playthroughId).toBe(second?.playthroughId);
    await screen.unmount();
  });

  it('固定人物成功后进入游玩页', async () => {
    const fake = createFakeApi({
      'play.getStartInfo': () => startInfo([{ name: '名字', defaultValue: '阿岚', isName: true }]),
      'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, routeId),
      'play.getRoute': () => undefined,
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    await expect.element(screen.getByRole('textbox', { name: '名字' })).toBeVisible();
    await screen.getByRole('button', { name: '开始故事' }).click();

    await vi.waitFor(() => expect(screen.router.state.location.pathname).toBe(`/play/${routeId}`));
    await screen.unmount();
  });

  it('每局生成时进入等待页', async () => {
    const fake = createFakeApi({
      'play.getStartInfo': () => startInfo([]),
      'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, null),
      'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    await vi.waitFor(() => expect(startInputs(fake.calls).length).toBe(1));
    const playthroughId = startInputs(fake.calls)[0]!.playthroughId;
    await vi.waitFor(() => expect(screen.router.state.location.pathname).toBe(`/playthroughs/${playthroughId}`));
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const fake = createFakeApi({
      'play.getStartInfo': () =>
        startInfo([
          { name: '名字', defaultValue: '阿岚', isName: true },
          { name: '职业', defaultValue: '邮差', isName: false },
        ]),
      'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, null),
      'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    });
    const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });

    await expect.element(screen.getByRole('textbox', { name: '名字' })).toBeVisible();
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });
});
