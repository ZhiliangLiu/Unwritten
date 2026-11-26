import { createRef } from 'react';
import type { RefObject } from 'react';
import { act } from 'react';
import { render } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFollowLatest } from './useFollowLatest.ts';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  observed: Element[] = [];
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {}
}

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  observed: Element[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    TestIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function Harness({
  contentRef,
  sentinelRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
}) {
  const { atLatest } = useFollowLatest({ contentRef, sentinelRef });
  return (
    <div>
      <div ref={contentRef} data-testid='content' />
      <div ref={sentinelRef} data-testid='sentinel' />
      <output>{atLatest ? 'latest' : 'past'}</output>
    </div>
  );
}

describe('useFollowLatest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestResizeObserver.instances = [];
    TestIntersectionObserver.instances = [];
  });

  function install() {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  }

  it('观察的是内容盒', async () => {
    install();
    const contentRef = createRef<HTMLDivElement>();
    const sentinelRef = createRef<HTMLDivElement>();
    await render(<Harness contentRef={contentRef} sentinelRef={sentinelRef} />);
    expect(TestResizeObserver.instances).toHaveLength(1);
    expect(TestResizeObserver.instances[0]!.observed[0]).toBe(contentRef.current);
  });

  it('停在最新时内容变高会滚动', async () => {
    install();
    const contentRef = createRef<HTMLDivElement>();
    const sentinelRef = createRef<HTMLDivElement>();
    const { container } = await render(<Harness contentRef={contentRef} sentinelRef={sentinelRef} />);
    const scrollIntoView = vi.fn();
    sentinelRef.current!.scrollIntoView = scrollIntoView;
    act(() => {
      TestResizeObserver.instances[0]!.callback(
        [{ contentRect: { height: 100 } } as ResizeObserverEntry],
        TestResizeObserver.instances[0]! as unknown as ResizeObserver,
      );
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
    expect(container.querySelector('output')?.textContent).toBe('latest');
  });

  it('往上翻过时内容变高不滚动', async () => {
    install();
    const contentRef = createRef<HTMLDivElement>();
    const sentinelRef = createRef<HTMLDivElement>();
    const { container } = await render(<Harness contentRef={contentRef} sentinelRef={sentinelRef} />);
    const scrollIntoView = vi.fn();
    sentinelRef.current!.scrollIntoView = scrollIntoView;
    act(() => {
      TestIntersectionObserver.instances[0]!.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        TestIntersectionObserver.instances[0]! as unknown as IntersectionObserver,
      );
    });
    expect(container.querySelector('output')?.textContent).toBe('past');
    act(() => {
      TestResizeObserver.instances[0]!.callback(
        [{ contentRect: { height: 100 } } as ResizeObserverEntry],
        TestResizeObserver.instances[0]! as unknown as ResizeObserver,
      );
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
