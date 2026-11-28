#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_PROJECTS = ['selfhost/colab', 'plugins/comfyui', 'selfhost/strata', 'plugins/colab-launcher'];
const CONFORMANCE_GROUPS = [
  {
    project: 'plugins/comfyui',
    script: 'tests/serve_with_fakes.py',
    prefix: 'UNWRITTEN_IMAGE_CONFORMANCE',
    tests: 'src/image/conformance',
  },
  {
    project: 'plugins/colab-launcher',
    script: 'tests/serve_with_fakes.py',
    prefix: 'UNWRITTEN_LAUNCHER_CONFORMANCE',
    tests: 'src/image/launcher/conformance',
  },
];
const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 5_000;

function uvIsInstalled() {
  const result = spawnSync('uv', ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function runPytest(project) {
  const result = spawnSync('uv', ['run', '--frozen', '--directory', project, 'pytest', '-q'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`运行 uv 失败：${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`失败 ${project} 的测试（退出码 ${result.status}）`);
    return false;
  }
  console.log(`通过 ${project} 的测试`);
  return true;
}

function waitUntilReady(server) {
  return new Promise((resolve, reject) => {
    const values = {};
    let buffer = '';
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      server.off('exit', onExit);
      server.stdout.off('data', onData);
      server.stdout.resume();
      if (error) reject(error);
      else resolve(values);
    };
    const onData = (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const separator = line.indexOf('=');
        if (separator === -1) continue;
        const key = line.slice(0, separator);
        if (key === 'UNWRITTEN_CONFORMANCE_URL' || key === 'UNWRITTEN_CONFORMANCE_TOKEN') {
          values[key] = line.slice(separator + 1);
        }
      }
      if (values.UNWRITTEN_CONFORMANCE_URL && values.UNWRITTEN_CONFORMANCE_TOKEN) finish();
    };
    const onExit = (code) => finish(new Error(`一致性服务提前退出（退出码 ${code}）`));
    timer = setTimeout(() => finish(new Error('等待一致性服务启动超时')), READY_TIMEOUT_MS);
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', onData);
    server.once('exit', onExit);
  });
}

function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.kill('SIGKILL');
      resolve();
    }, STOP_TIMEOUT_MS);
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill('SIGTERM');
  });
}

function runVitest(group, environment) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@unwritten/core', 'exec', 'vitest', 'run', group.tests], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: environment,
    });
    child.once('error', (error) => {
      console.error(`运行 vitest 失败：${error.message}`);
      resolve(false);
    });
    child.once('exit', (code) => resolve(code === 0));
  });
}

async function runConformance(group) {
  const scriptPath = join(repoRoot, group.project, group.script);
  if (!existsSync(scriptPath)) {
    console.log(`跳过 ${group.project} 的一致性测试：还没有启动脚本`);
    return true;
  }
  const server = spawn('uv', ['run', '--frozen', '--directory', group.project, 'python', group.script], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let passed = false;
  try {
    const env = await waitUntilReady(server);
    passed = await runVitest(group, {
      ...process.env,
      [`${group.prefix}_URL`]: env.UNWRITTEN_CONFORMANCE_URL,
      [`${group.prefix}_TOKEN`]: env.UNWRITTEN_CONFORMANCE_TOKEN,
    });
  } catch (error) {
    console.error(`${group.project}：${error.message}`);
  }
  await stopServer(server);
  console.log(passed ? `通过 ${group.project} 的一致性测试` : `失败 ${group.project} 的一致性测试`);
  return passed;
}

async function main() {
  if (!uvIsInstalled()) {
    console.error('需要先安装 uv：https://docs.astral.sh/uv/');
    return 1;
  }
  const failures = [];
  for (const project of PYTHON_PROJECTS) {
    if (!existsSync(join(repoRoot, project, 'tests'))) {
      console.log(`跳过 ${project}：还没有测试`);
      continue;
    }
    if (!runPytest(project)) failures.push(project);
  }
  for (const group of CONFORMANCE_GROUPS) {
    if (!(await runConformance(group))) failures.push(group.project);
  }
  if (failures.length === 0) {
    console.log('Python 测试全部通过');
    return 0;
  }
  console.error(`${failures.length} 项失败：${failures.join('、')}`);
  return 1;
}

process.exit(await main());
