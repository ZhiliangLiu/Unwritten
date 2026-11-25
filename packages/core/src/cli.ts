import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface CliOptions {
  dataDir: string;
  port: number;
  clientDir: string;
  clientOrigin: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_CLIENT_DIR = fileURLToPath(new URL('../../../apps/client/dist/', import.meta.url));

function fail(message: string): never {
  throw new Error(message);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 0;
  if (!/^\d+$/.test(raw)) fail(`--port 必须是 0 到 65535 的整数，收到 ${raw}`);
  const port = Number(raw);
  if (port > 65535) fail(`--port 必须是 0 到 65535 的整数，收到 ${raw}`);
  return port;
}

function parseOrigin(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`--client-origin 必须是 http:// 或 https:// 开头的源，收到 ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`--client-origin 必须是 http:// 或 https:// 开头的源，收到 ${raw}`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    fail(`--client-origin 不能带路径、查询参数或 hash，收到 ${raw}`);
  }
  return url.origin;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      'data-dir': { type: 'string' },
      port: { type: 'string' },
      'client-dir': { type: 'string' },
      'client-origin': { type: 'string' },
      'log-level': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const dataDir = values['data-dir'];
  if (!dataDir) fail('缺少 --data-dir');

  const logLevel = values['log-level'] ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    fail(`--log-level 必须是 debug、info、warn 或 error，收到 ${logLevel}`);
  }

  return {
    dataDir: path.resolve(dataDir),
    port: parsePort(values.port),
    clientDir: path.resolve(values['client-dir'] ?? DEFAULT_CLIENT_DIR),
    clientOrigin: parseOrigin(values['client-origin']),
    logLevel: logLevel as CliOptions['logLevel'],
  };
}
