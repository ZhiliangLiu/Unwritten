import type { ImageConfigView, JournalView, RouteView, TurnView } from '@unwritten/contracts';
import { cleanup } from 'vitest-browser-react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetImageBlobCacheForTests } from '../../shared/hooks/useImageBlob.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { renderRoute } from '../../shared/test/render.tsx';

initTestI18n();

const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';
const workId = '6a5b4c3d-2e1f-4a9b-8c7d-6e5f4a3b2c1d';
const setId = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function turn(): TurnView {
  return {
    id: crypto.randomUUID(),
    originRequest: null,
    depth: 0,
    action: null,
    paragraphs: ['雾还没散。'],
    options: [],
    illustration: null,
    createdAt: 1,
  };
}

function route(view: TurnView): RouteView {
  return {
    id: routeId,
    workId,
    workTitle: '雾港的末班船',
    language: 'zh-CN',
    headTurnId: view.id,
    playthroughId: null,
    turns: [view],
    pending: null,
    ended: false,
  };
}

function journal(portrait: boolean, view: TurnView): JournalView {
  return {
    routeId,
    headTurnId: view.id,
    subjects: [
      {
        entityId: crypto.randomUUID(),
        kind: 'character',
        name: '提鸟笼的人',
        portrait: portrait ? { setId, updatedAt: 1 } : null,
        lines: [
          {
            id: 'line-known',
            text: '他在等一艘不会来的船。',
            level: 'confirmed',
            source: { turnId: view.id, depth: 0, para: 1 },
          },
        ],
      },
    ],
    events: [],
  };
}

function imageConfig(): ImageConfigView {
  return { status: 'ok', revision: 'revision-1', problem: null, services: [], selectedServiceId: null };
}

async function pngBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4, 5);
  canvas.getContext('2d')?.fillRect(0, 0, 4, 5);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function renderJournal(portrait: boolean) {
  const view = turn();
  const fake = createFakeApi({
    'play.getRoute': () => route(view),
    'play.getJournal': () => journal(portrait, view),
    'image.services.list': () => imageConfig(),
    'image.file': () => pngBlob(),
    'log.client': () => undefined,
  });
  const screen = await renderRoute(`/play/${routeId}`, { api: fake.api });
  await screen.getByRole('button', { name: '手记' }).click();
  await expect.element(screen.getByText('他在等一艘不会来的船。')).toBeVisible();
  return { screen, fake, view };
}

describe('手记参考图缩略图', () => {
  afterEach(async () => {
    await cleanup();
    resetImageBlobCacheForTests();
  });

  it('有参考图时显示 alt 等于称呼的图片', async () => {
    const { screen, fake } = await renderJournal(true);

    await expect.element(screen.getByRole('img', { name: '提鸟笼的人' })).toBeVisible();
    expect(fake.calls.some((call) => call.path === 'image.file')).toBe(true);
  });

  it('没有参考图时不显示图片', async () => {
    const { screen } = await renderJournal(false);

    await expect.element(screen.getByText('提鸟笼的人')).toBeVisible();
    expect(screen.getByRole('img', { name: '提鸟笼的人' }).elements()).toHaveLength(0);
  });
});
