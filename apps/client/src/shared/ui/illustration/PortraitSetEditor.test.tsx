import { ORPCError } from '@orpc/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ImageConfigView,
  ImageServiceView,
  OutputOptionsView,
  PortraitDraftView,
  PortraitSetView,
  PortraitSlot,
  PortraitSlotView,
} from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/context.tsx';
import { expectNoAxeViolations } from '../../test/axe.ts';
import { createFakeApi } from '../../test/fake-api.ts';
import { initTestI18n } from '../../test/i18n.ts';
import { PortraitSetEditor } from './PortraitSetEditor.tsx';

initTestI18n();

const workId = 'work-1';
const setId = 'set-draft';
const serviceId = 'image-local-0a1b2c';
const target = { kind: 'entity', entityId: 'entity-1' } as const;

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

const config: ImageConfigView = {
  status: 'ok',
  revision: 'revision-1',
  problem: null,
  services: [service()],
  selectedServiceId: serviceId,
};

const defaultOutput: OutputOptionsView = {
  preferences: { aspectPreference: 'auto', resolutionTier: '1k' },
  aspects: ['1:1', '3:4'],
  tiers: [
    { tier: '1k', sizes: { '3:4': { width: 768, height: 1024 } } },
    { tier: '2k', sizes: { '3:4': { width: 1536, height: 2048 } } },
  ],
  preferenceAvailable: true,
};

function slot(name: PortraitSlot, image: { width: number; height: number } | null): PortraitSlotView {
  return { slot: name, image, source: image ? 'generate' : null, needsReview: false, task: null };
}

function draft(front: { width: number; height: number } | null): PortraitSetView {
  return {
    id: setId,
    workId,
    scope: 'work',
    entityId: 'entity-1',
    state: 'draft',
    draftRev: 0,
    appearance: '',
    slots: [slot('front', front), slot('three_quarter', null), slot('full_body', null)],
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

async function pngFile(): Promise<File> {
  return new File([await imageBlob()], 'from-canvas.png', { type: 'image/png' });
}

async function setup(options: {
  front?: { width: number; height: number } | null;
  mode?: 'author' | 'player';
  onSnapshot?: (setId: string) => void;
  output?: OutputOptionsView;
  handlers?: Record<string, (input: unknown) => unknown>;
}) {
  const draftCalls: unknown[] = [];
  const uploads: unknown[] = [];
  const adopts: unknown[] = [];
  const generates: unknown[] = [];
  const preview = draft(options.front ?? null);
  const fake = createFakeApi({
    'image.services.list': () => config,
    'image.outputPreferences.get': () => options.output ?? defaultOutput,
    'portrait.draft': (input) => {
      draftCalls.push(input);
      return { draft: preview, activeSetId: null } satisfies PortraitDraftView;
    },
    'portrait.upload': (input) => {
      uploads.push(input);
      return preview;
    },
    'portrait.generate': (input) => {
      generates.push(input);
      return preview;
    },
    'portrait.adopt': (input) => {
      adopts.push(input);
      return { draft: { ...preview, state: 'active' }, activeSetId: 'set-active' } satisfies PortraitDraftView;
    },
    'image.file': () => imageBlob(),
    ...options.handlers,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <PortraitSetEditor
          workId={workId}
          scope='work'
          target={target}
          appearance='短卷发，左眉有一道浅缺口'
          mode={options.mode ?? 'author'}
          onSnapshot={options.onSnapshot}
        />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { screen, fake, draftCalls, uploads, adopts, generates, queryClient };
}

describe('PortraitSetEditor', () => {
  it('三个位置都能按可读名称找到', async () => {
    const { screen } = await setup({});
    for (const name of ['正面', '斜侧脸', '全身']) {
      await expect.element(screen.getByRole('region', { name })).toBeVisible();
    }
    await screen.unmount();
  });

  it('导入先预览，确认后才上传', async () => {
    const { screen, uploads } = await setup({ front: null });
    await screen.getByLabelText('为正面选择图片').upload(await pngFile());
    await expect.element(screen.getByRole('button', { name: '使用这张' })).toBeVisible();
    expect(uploads).toHaveLength(0);
    await screen.getByRole('button', { name: '使用这张' }).click();
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    const upload = uploads[0] as { slot: string; file: File };
    expect(upload.slot).toBe('front');
    expect(upload.file.name).toMatch(/^portrait\.(webp|png)$/);
    await screen.unmount();
  });

  it('导入不合格时说明原因，并保留原来的图', async () => {
    const { screen, uploads } = await setup({ front: { width: 4, height: 4 } });
    await expect.element(screen.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'image.png', { type: 'image/png' });
    await screen.getByLabelText('为正面选择图片').upload(svg);
    await expect.element(screen.getByText('请选择 PNG、JPEG 或 WebP 图片。')).toBeVisible();
    await expect.element(screen.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    expect(uploads).toHaveLength(0);
    await screen.unmount();
  });

  it('正面没图时不能采用', async () => {
    const { screen } = await setup({ front: null });
    await expect.element(screen.getByRole('button', { name: '采用' })).toBeDisabled();
    await expect.element(screen.getByText('请先准备一张正面图。')).toBeVisible();
    await screen.unmount();
  });

  it('补齐视角要有正面图', async () => {
    const missing = await setup({ front: null });
    await expect.element(missing.screen.getByRole('button', { name: '补齐视角' })).toBeDisabled();
    await missing.screen.unmount();

    const ready = await setup({ front: { width: 4, height: 4 } });
    await expect.element(ready.screen.getByRole('button', { name: '补齐视角' })).toBeEnabled();
    await ready.screen.unmount();
  });

  it('档位只列所选比例支持的，并在比例没有档位时回落到全部', async () => {
    const outputView: OutputOptionsView = {
      preferences: { aspectPreference: 'auto', resolutionTier: '1k' },
      aspects: ['3:4', '1:1', '16:9'],
      tiers: [
        { tier: '1k', sizes: { '3:4': { width: 768, height: 1024 } } },
        { tier: '2k', sizes: { '1:1': { width: 2048, height: 2048 } } },
      ],
      preferenceAvailable: true,
    };
    const { screen, generates } = await setup({ front: { width: 4, height: 4 }, output: outputView });
    await screen.getByText('生成设置').click();
    await expect.element(screen.getByRole('combobox', { name: '分辨率' })).toHaveTextContent('高 · 1K');

    await screen.getByRole('combobox', { name: '画面比例' }).click();
    await screen.getByRole('option', { name: '1:1' }).click();
    await expect.element(screen.getByRole('combobox', { name: '分辨率' })).toHaveTextContent('非常高 · 2K');

    await screen.getByRole('button', { name: '生成正面参考图' }).click();
    await vi.waitFor(() => expect(generates).toHaveLength(1));
    expect(generates[0]).toMatchObject({
      slot: 'front',
      format: { aspectPreference: '1:1', resolutionTier: '2k' },
    });

    await screen.getByRole('combobox', { name: '分辨率' }).click();
    expect(screen.getByRole('option', { name: '高 · 1K' }).query()).toBeNull();
    await expect.element(screen.getByRole('option', { name: '非常高 · 2K' })).toBeVisible();
    await screen.getByRole('option', { name: '非常高 · 2K' }).click();

    await screen.getByRole('combobox', { name: '画面比例' }).click();
    await screen.getByRole('option', { name: '16:9' }).click();
    await screen.getByRole('combobox', { name: '分辨率' }).click();
    await expect.element(screen.getByRole('option', { name: '高 · 1K' })).toBeVisible();
    await expect.element(screen.getByRole('option', { name: '非常高 · 2K' })).toBeVisible();
    await screen.getByRole('option', { name: '高 · 1K' }).click();
    await screen.unmount();
  });

  it('玩家模式下按钮是「用作本局参考」，成功后交出参考组 id', async () => {
    const onSnapshot = vi.fn();
    const { screen, adopts } = await setup({ front: { width: 4, height: 4 }, mode: 'player', onSnapshot });
    await screen.getByRole('button', { name: '用作本局参考' }).click();
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledWith('set-active'));
    expect(adopts[0]).toMatchObject({ mode: 'adopt', expectedActiveSetId: null });
    await screen.unmount();
  });

  it('采用返回 stale_revision 时显示错误并重取草稿', async () => {
    const { screen, draftCalls } = await setup({
      front: { width: 4, height: 4 },
      handlers: {
        'portrait.adopt': () => {
          throw new ORPCError('stale_revision');
        },
      },
    });
    await screen.getByRole('button', { name: '采用' }).click();
    await expect.element(screen.getByText('草稿已更新。请核对后再保存。')).toBeVisible();
    await vi.waitFor(() => expect(draftCalls.length).toBeGreaterThanOrEqual(2));
    await screen.unmount();
  });

  it('初次打开生成设置用竖图比例和 1K', async () => {
    const { screen } = await setup({ front: { width: 4, height: 4 } });
    await screen.getByText('生成设置').click();
    await expect.element(screen.getByText('3:4')).toBeVisible();
    await expect.element(screen.getByText('高 · 1K')).toBeVisible();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen } = await setup({ front: { width: 4, height: 4 } });
    await expect.element(screen.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    await screen.getByText('生成设置').click();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
