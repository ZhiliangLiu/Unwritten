import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { oc, type ContractRouterClient } from '@orpc/contract';
import { implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const contract = {
  up: oc.input(z.object({ name: z.string(), file: z.file() })).output(z.object({ size: z.number() })),
  down: oc.input(z.object({})).output(z.file()),
};

function createClient() {
  const base = implement(contract);
  const router = base.router({
    up: base.up.handler(({ input }) => ({ size: input.file.size })),
    down: base.down.handler(() => new File([new Uint8Array([1, 2, 3])], 'x.webp', { type: 'image/webp' })),
  });
  const handler = new RPCHandler(router);
  const link = new RPCLink({
    url: 'http://127.0.0.1/api',
    fetch: async (request) => {
      const { matched, response } = await handler.handle(request, { prefix: '/api' });
      if (!matched) throw new Error('unmatched request');
      return response;
    },
  });
  return createORPCClient(link) as ContractRouterClient<typeof contract>;
}

describe('oRPC 的 File 往返', () => {
  it('上传的 File 和下载的 File 都保持字节和媒体类型', async () => {
    const client = createClient();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const uploaded = new File([bytes], 'a.webp', { type: 'image/webp' });
    const up = await client.up({ name: 'a.webp', file: uploaded });
    expect(up.size).toBe(5);

    const down = await client.down({});
    expect(down).toBeInstanceOf(Blob);
    expect(down.type).toBe('image/webp');
    expect([...new Uint8Array(await down.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
