import { expect } from 'vitest';

export function expectHeadingOutline(container: Element): void {
  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const h1Count = headings.filter((heading) => heading.tagName === 'H1').length;
  expect(h1Count).toBe(1);
  let previous = 0;
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    expect(level - previous).toBeLessThanOrEqual(1);
    previous = level;
  }
}
