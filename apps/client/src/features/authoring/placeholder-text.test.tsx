import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { PROTAGONIST_FIELD_NAME_PATTERN } from '@unwritten/contracts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { PlaceholderText, PROTAGONIST_PLACEHOLDER_PATTERN } from './placeholder-text.tsx';

initTestI18n();

describe('PlaceholderText', () => {
  it('占位符显示为标签', async () => {
    const screen = await render(<PlaceholderText text='你好，{{protagonist.名字}}。' />);
    await expect.element(screen.getByText('你好，「名字」。')).toBeVisible();
    expect(screen.container.textContent).not.toContain('{{');
    await screen.unmount();
  });

  it('合法名字都能被占位符匹配', () => {
    for (const name of ['名字', '职业', 'resident', '主角1', '_未知']) {
      expect(PROTAGONIST_FIELD_NAME_PATTERN.test(name), name).toBe(true);
      const match = [...`{{protagonist.${name}}}`.matchAll(PROTAGONIST_PLACEHOLDER_PATTERN)][0];
      expect(match?.[1], name).toBe(name);
    }
  });
});
