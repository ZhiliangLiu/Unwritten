import { ORPCError } from '@orpc/client';
import type { ApiClient } from '../api/client.ts';

export interface FakeApiCall {
  path: string;
  input: unknown;
}

export interface FakeApi {
  api: ApiClient;
  calls: FakeApiCall[];
}

function neverEnding(): AsyncIterableIterator<never> {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => new Promise<IteratorResult<never>>(() => {}),
  };
}

export function createFakeApi(handlers: Record<string, (input: unknown) => unknown>): FakeApi {
  const calls: FakeApiCall[] = [];

  function node(path: string): unknown {
    return new Proxy(function fakeProcedure() {}, {
      get(_target, key) {
        if (typeof key !== 'string' || key === 'then' || key === 'catch' || key === 'finally') return undefined;
        return node(path ? `${path}.${key}` : key);
      },
      apply(_target, _this, args: unknown[]) {
        const input = args[0];
        calls.push({ path, input });
        const handler = handlers[path];
        if (handler) return Promise.resolve(handler(input));
        if (path === 'events.subscribe') return Promise.resolve(neverEnding());
        return Promise.reject(new ORPCError('internal'));
      },
    });
  }

  return { api: node('') as ApiClient, calls };
}
