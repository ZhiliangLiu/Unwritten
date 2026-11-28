import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../shared/api/context.tsx';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { NovelChapterPicker } from './NovelChapterPicker.tsx';

initTestI18n();

async function setup(titles: string[], novel = { chapterCount: titles.length, chapter: 1 }) {
  const chosen: Array<[number, number | undefined]> = [];
  const fake = createFakeApi({ 'works.novelChapters': () => titles });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <NovelChapterPicker
          workId='work-1'
          novel={novel}
          busy={false}
          onChoose={(chapter, reference) => chosen.push([chapter, reference])}
        />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { screen, fake, chosen };
}

describe('NovelChapterPicker', () => {
  it('没有章名的段按位置命名：文首、所属章的续、第 N 段', async () => {
    const { screen, fake } = await setup(['', '第一章 归港', '', '第二章 失灯']);
    const chapter = screen.getByRole('combobox', { name: '原作起点' });
    await expect.element(chapter).toHaveValue('第一章 归港');
    await chapter.click();
    await expect.element(screen.getByRole('option', { name: '文首' })).toBeVisible();
    await expect.element(screen.getByRole('option', { name: '第一章 归港（续）' })).toBeVisible();
    expect(fake.calls.filter((call) => call.path === 'works.novelChapters')).toEqual([
      { path: 'works.novelChapters', input: { workId: 'work-1' } },
    ]);
    await screen.unmount();
  });

  it('全书都没有章名时从第 2 段起按序号命名', async () => {
    const { screen } = await setup(['', '', ''], { chapterCount: 3, chapter: 0 });
    const chapter = screen.getByRole('combobox', { name: '原作起点' });
    await expect.element(chapter).toHaveValue('文首');
    await chapter.click();
    await expect.element(screen.getByRole('option', { name: '第 3 段' })).toBeVisible();
    await screen.unmount();
  });

  it('搜索章名换章后交出所选章和参考章', async () => {
    const { screen, chosen } = await setup(['', '第一章 归港', '第二章 失灯', '第三章 夜潮']);
    const chapter = screen.getByRole('combobox', { name: '原作起点' });
    await chapter.click();
    await chapter.fill('夜潮');
    await screen.getByRole('option', { name: '第三章 夜潮' }).click();
    const reference = screen.getByRole('combobox', { name: '补充参考章' });
    await reference.click();
    await reference.fill('失灯');
    await screen.getByRole('option', { name: '第二章 失灯' }).click();
    await screen.getByRole('button', { name: '从所选章节生成' }).click();
    expect(chosen).toEqual([[3, 2]]);
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen } = await setup(['', '第一章 归港', '第二章 失灯']);
    await expect.element(screen.getByRole('combobox', { name: '原作起点' })).toBeVisible();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
