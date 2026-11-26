import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';
import { test } from 'node:test';
import { signalTrackedGroups, trackDescendantGroups } from './dev.mjs';

const TOKEN = `dev-supervisor-test-${process.pid}`;
const HOLD = `setInterval(() => {}, 1000);`;

function pidsWithToken() {
  return execFileSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(TOKEN))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('父进程死后被过继的孙子进程也要收掉', async (t) => {
  t.after(() => signalTrackedGroups('SIGKILL'));
  const parent = spawn(
    process.execPath,
    [
      '-e',
      `
        const { spawn } = require('node:child_process');
        spawn(process.execPath, ['-e', ${JSON.stringify(HOLD)}, ${JSON.stringify(TOKEN)}], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        ${HOLD}
      `,
      TOKEN,
    ],
    { detached: true, stdio: 'ignore' },
  );
  await wait(800);
  trackDescendantGroups(process.pid);

  parent.kill('SIGKILL');
  await wait(300);
  assert.ok(pidsWithToken().length >= 1, '孙子进程应该还在，且已被过继');

  signalTrackedGroups('SIGKILL');
  await wait(300);

  assert.deepEqual(pidsWithToken(), []);
});
