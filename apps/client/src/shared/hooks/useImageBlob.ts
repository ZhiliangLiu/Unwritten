import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ErrorCode, ImageFileInput } from '@unwritten/contracts';
import type { ApiClient } from '../api/client.ts';
import { useApi } from '../api/context.tsx';
import { errorCode } from '../api/errors.ts';

export type ImageBlobState =
  | { status: 'idle'; url: null }
  | { status: 'loading'; url: null }
  | { status: 'ready'; url: string; mime: string }
  | { status: 'error'; url: null; code: ErrorCode };

export const IMAGE_BLOB_CACHE_SIZE = 64;

interface CacheEntry {
  url: string;
  mime: string;
  refs: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<CacheEntry | null>>();
const refs = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function touch(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  cache.set(key, entry);
}

function evict(): void {
  while (cache.size > IMAGE_BLOB_CACHE_SIZE) {
    let removed = false;
    for (const [key, entry] of cache) {
      if (entry.refs > 0) continue;
      cache.delete(key);
      URL.revokeObjectURL(entry.url);
      removed = true;
      break;
    }
    if (!removed) return;
  }
}

function retain(key: string): void {
  const count = (refs.get(key) ?? 0) + 1;
  refs.set(key, count);
  const entry = cache.get(key);
  if (entry) {
    entry.refs = count;
    touch(key);
  }
}

function load(key: string, input: ImageFileInput, api: ApiClient): Promise<CacheEntry | null> {
  let request = pending.get(key);
  if (!request) {
    const created = Promise.resolve()
      .then(() => api.image.file(input))
      .then((blob) => {
        const waiting = refs.get(key) ?? 0;
        if (waiting === 0) return null;
        const entry = { url: URL.createObjectURL(blob), mime: blob.type, refs: waiting };
        cache.set(key, entry);
        evict();
        notify();
        return entry;
      });
    request = created;
    pending.set(key, created);
    const cleanup = () => {
      if (pending.get(key) === created) pending.delete(key);
    };
    void created.then(cleanup, cleanup);
  }
  return request;
}

function release(key: string): void {
  const count = (refs.get(key) ?? 1) - 1;
  if (count > 0) refs.set(key, count);
  else refs.delete(key);
  const entry = cache.get(key);
  if (entry) entry.refs = Math.max(count, 0);
}

interface BlobError {
  key: string;
  code: ErrorCode;
}

export function useImageBlob(input: ImageFileInput | null, version: string | number): ImageBlobState {
  const api = useApi();
  const inputRef = useRef(input);
  const key = input === null ? null : JSON.stringify([input.view, input.image, version]);
  const entry = useSyncExternalStore(subscribe, () => (key === null ? null : (cache.get(key) ?? null)));
  const [error, setError] = useState<BlobError | null>(null);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    const current = inputRef.current;
    if (key === null || current === null) return;
    retain(key);
    if (cache.has(key)) return () => release(key);

    let cancelled = false;
    void load(key, current, api).catch((failure: unknown) => {
      if (!cancelled) setError({ key, code: errorCode(failure) as ErrorCode });
    });

    return () => {
      cancelled = true;
      release(key);
    };
  }, [api, key]);

  if (key === null) return { status: 'idle', url: null };
  if (entry) return { status: 'ready', url: entry.url, mime: entry.mime };
  if (error?.key === key) return { status: 'error', url: null, code: error.code };
  return { status: 'loading', url: null };
}

export function resetImageBlobCacheForTests(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
  pending.clear();
  refs.clear();
  notify();
}
