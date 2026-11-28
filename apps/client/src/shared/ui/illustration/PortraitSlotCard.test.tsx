import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PortraitSlotView } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/context.tsx';
import { expectNoAxeViolations } from '../../test/axe.ts';
import { createFakeApi } from '../../test/fake-api.ts';
import { initTestI18n } from '../../test/i18n.ts';
import { PortraitSlotCard } from './PortraitSlotCard.tsx';

initTestI18n();

const workId = 'work-1';
const setId = 'set-draft';

async function imageBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4, 4);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillRect(0, 0, 4, 4);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function setup(view: PortraitSlotView) {
  const fake = createFakeApi({ 'image.file': () => imageBlob() });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <PortraitSlotCard
          workId={workId}
          setId={setId}
          slot='front'
          view={view}
          expectedRev={0}
          updatedAt={1}
          format={{ aspectPreference: '3:4', resolutionTier: '1k' }}
          canGenerate
          onChanged={() => {}}
          onError={() => {}}
        />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { screen, fake };
}

describe('PortraitSlotCard', () => {
  it('有图时显示缩略图，alt 带位置名', async () => {
    const { screen } = await setup({
      slot: 'front',
      image: { width: 4, height: 4 },
      source: 'import',
      needsReview: false,
      task: null,
    });
    await expect.element(screen.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    await expect.element(screen.getByText('为正面选择图片')).toBeVisible();
    await screen.unmount();
  });

  it('生成失败时写原因，并提供重试', async () => {
    const { screen } = await setup({
      slot: 'front',
      image: null,
      source: null,
      needsReview: false,
      task: { status: 'failed', error: 'image_invalid_upload' },
    });
    await expect.element(screen.getByText('这张参考图不符合要求。请重新选择图片。')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '重试正面参考图' })).toBeVisible();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen } = await setup({
      slot: 'front',
      image: { width: 4, height: 4 },
      source: 'generate',
      needsReview: true,
      task: null,
    });
    await expect.element(screen.getByRole('img', { name: '人物参考 · 正面' })).toBeVisible();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
