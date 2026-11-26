import { describe, expect, it } from 'vitest';
import { createFakeApi } from './fake-api.ts';
import { renderRoute } from './render.tsx';

describe('renderRoute', () => {
  it('按路径渲染真实路由树', async () => {
    const fake = createFakeApi({ 'works.list': () => [] });
    const { container } = await renderRoute('/', { api: fake.api });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain('作品库');
    expect(fake.calls.some((call) => call.path === 'works.list')).toBe(true);
  });
});
