import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const corePath = fileURLToPath(new URL('../../packages/core/dist/main.js', import.meta.url));

let dataDir: string;
let core: ChildProcess;
let url: string;
let origin: string;
let token: string;

function call(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL('/api/works/list', origin);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '2', ...headers },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'unwritten-accept-'));
  writeFileSync(join(dataDir, 'providers.json'), '{"version": 1,\n  oops\n}');
  core = spawn(process.execPath, [corePath, '--data-dir', dataDir, '--log-level', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`core did not start: ${output}`)), 20_000);
    core.stdout?.on('data', (chunk: Buffer) => {
      output += String(chunk);
      const match = /UNWRITTEN_CORE_URL=(\S+)/.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    core.once('exit', (code) => reject(new Error(`core exited early: ${code}`)));
  });
  const parsed = new URL(url);
  origin = parsed.origin;
  token = new URLSearchParams(parsed.hash.slice(1)).get('token') ?? '';
});

test.afterAll(async () => {
  core?.kill('SIGTERM');
  await new Promise((resolve) => core?.once('exit', resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test('拒绝缺少令牌、伪造 Host 和来源不符的请求', async () => {
  expect(await call({})).toBe(401);
  expect(await call({ authorization: `Bearer ${token}`, host: 'evil.example:1234' })).toBe(403);
  expect(await call({ authorization: `Bearer ${token}`, origin: 'http://evil.example' })).toBe(403);
  expect(await call({ authorization: `Bearer ${token}` })).toBe(200);
});

test('无效模型配置在设置页显示出错位置，且作品库仍可打开', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '作品库' })).toBeVisible();
  await page.getByRole('link', { name: '设置' }).click();
  await expect(page.getByText(/配置文件第 \d+ 行/)).toBeVisible();
});
