import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  IllustrationStyle,
  ImageConfigView,
  ImageServiceView,
  PortraitSetView,
  PortraitSlot,
  PortraitSlotView,
} from '@unwritten/contracts';
import { DEFAULT_ILLUSTRATION_STYLE } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/context.tsx';
import { expectNoAxeViolations } from '../../test/axe.ts';
import { createFakeApi } from '../../test/fake-api.ts';
import { initTestI18n } from '../../test/i18n.ts';
import { StylePreview } from './StylePreview.tsx';

initTestI18n();

const workId = 'work-1';
const setId = 'set-1';
const serviceId = 'image-local-0a1b2c';

function service(): ImageServiceView {
  return {
    id: serviceId,
    name: '测试出图服务',
    protocol: 'unwritten-image',
    baseUrl: 'http://127.0.0.1:8000',
    key: { hasKey: false, source: 'none', envVar: null },
    model: null,
    openai: null,
    launcher: null,
    idleMinutes: 30,
    capabilities: null,
    probe: null,
    lastSuccessAt: null,
    state: 'ready',
    action: null,
    wakeFailure: null,
  };
}

function config(selectedServiceId: string | null): ImageConfigView {
  return { status: 'ok', revision: 'revision-1', problem: null, services: [service()], selectedServiceId };
}

function slot(name: PortraitSlot, image: { width: number; height: number } | null): PortraitSlotView {
  return { slot: name, image, source: image ? 'generate' : null, needsReview: false, task: null };
}

function previewSet(): PortraitSetView {
  return {
    id: setId,
    workId,
    scope: 'work',
    entityId: null,
    state: 'draft',
    draftRev: 0,
    appearance: '',
    slots: [slot('front', { width: 4, height: 4 }), slot('three_quarter', null), slot('full_body', null)],
    updatedAt: 1,
  };
}

async function imageBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4, 4);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillRect(0, 0, 4, 4);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function setup(selectedServiceId: string | null) {
  const previews: unknown[] = [];
  const fake = createFakeApi({
    'image.services.list': () => config(selectedServiceId),
    'portrait.preview': (input) => {
      previews.push(input);
      return previewSet();
    },
    'portrait.get': () => previewSet(),
    'image.file': () => imageBlob(),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <StylePreview {...{ workId, viewWorkId: workId, style: DEFAULT_ILLUSTRATION_STYLE }} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { screen, previews, fake };
}

function StyleHarness() {
  const [style, setStyle] = useState<IllustrationStyle>(DEFAULT_ILLUSTRATION_STYLE);
  return (
    <>
      <button type='button' onClick={() => setStyle({ kind: 'preset', preset: 'ink' })}>
        换画风
      </button>
      <StylePreview {...{ workId, viewWorkId: workId, style }} />
    </>
  );
}

describe('StylePreview', () => {
  it('请求画风预览并显示示例图', async () => {
    const { screen, previews, fake } = await setup(serviceId);
    await expect.element(screen.getByRole('button', { name: '预览画风' })).toBeEnabled();
    await screen.getByRole('button', { name: '预览画风' }).click();
    await vi.waitFor(() => expect(previews.length).toBe(1));
    expect(previews[0]).toMatchObject({ workId, style: DEFAULT_ILLUSTRATION_STYLE });
    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'portrait.get')).toBe(true));
    await expect.element(screen.getByRole('img', { name: '画风示例，窗边放着一盏纸灯和一枝白花。' })).toBeVisible();
    await screen.unmount();
  });

  it('换画风后不再显示上一份预览', async () => {
    const previews: unknown[] = [];
    const fake = createFakeApi({
      'image.services.list': () => config(serviceId),
      'portrait.preview': (input) => {
        previews.push(input);
        return previewSet();
      },
      'portrait.get': () => previewSet(),
      'image.file': () => imageBlob(),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <ApiProvider value={fake.api}>
        <QueryClientProvider client={queryClient}>
          <StyleHarness />
        </QueryClientProvider>
      </ApiProvider>,
    );
    const image = screen.getByRole('img', { name: '画风示例，窗边放着一盏纸灯和一枝白花。' });

    await expect.element(screen.getByRole('button', { name: '预览画风' })).toBeEnabled();
    await screen.getByRole('button', { name: '预览画风' }).click();
    await expect.element(image).toBeVisible();

    await screen.getByRole('button', { name: '换画风' }).click();
    await vi.waitFor(() => expect(image.query()).toBeNull());

    await screen.getByRole('button', { name: '预览画风' }).click();
    await vi.waitFor(() => expect(previews).toHaveLength(2));
    expect(previews[1]).toMatchObject({ style: { kind: 'preset', preset: 'ink' } });
    await expect.element(image).toBeVisible();
    await screen.unmount();
  });

  it('没有选出图服务时禁用并说明', async () => {
    const { screen } = await setup(null);
    const button = screen.getByRole('button', { name: '预览画风' }).element() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await expect.element(screen.getByText('请先在设置里选择出图服务。')).toBeVisible();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen } = await setup(serviceId);
    await expect.element(screen.getByRole('button', { name: '预览画风' })).toBeEnabled();
    await screen.getByRole('button', { name: '预览画风' }).click();
    await expect.element(screen.getByRole('img', { name: '画风示例，窗边放着一盏纸灯和一枝白花。' })).toBeVisible();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
