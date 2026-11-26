import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useFollowLatest(input: {
  contentRef: RefObject<HTMLElement | null>;
  sentinelRef: RefObject<HTMLElement | null>;
}): { atLatest: boolean; scrollToLatest(): void } {
  const [atLatest, setAtLatest] = useState(true);
  const atLatestRef = useRef(true);

  useEffect(() => {
    atLatestRef.current = atLatest;
  }, [atLatest]);

  const scrollToLatest = useCallback(() => {
    input.sentinelRef.current?.scrollIntoView({ block: 'end' });
  }, [input.sentinelRef]);

  useEffect(() => {
    const sentinel = input.sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setAtLatest(entry.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [input.sentinelRef]);

  useEffect(() => {
    const content = input.contentRef.current;
    if (!content) return;
    let previousHeight = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      const height = entry?.contentRect.height ?? content.getBoundingClientRect().height;
      const grew = height > previousHeight;
      previousHeight = height;
      if (grew && atLatestRef.current) scrollToLatest();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [input.contentRef, scrollToLatest]);

  return { atLatest, scrollToLatest };
}
