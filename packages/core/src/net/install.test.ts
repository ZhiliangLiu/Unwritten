import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { RedirectBlockedError } from './fetch.ts';

it('安装全局守卫后 fetch 拒绝跟随重定向', async () => {
  const nativeFetch = globalThis.fetch;
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(302, { location: 'http://127.0.0.1:1/x' });
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('net install test server did not get a port');
  try {
    await import('./install.ts');
    expect(globalThis.fetch).not.toBe(nativeFetch);
    const request = globalThis.fetch(`http://127.0.0.1:${address.port}/x`);
    await expect(request).rejects.toBeInstanceOf(RedirectBlockedError);
    const error = await request.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 302 });
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
