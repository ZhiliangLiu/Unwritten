#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';

const KILL_GRACE_MS = 500;
const TRACK_INTERVAL_MS = 1000;
const STOP_SIGNALS = process.platform === 'win32' ? [] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
const trackedGroupIds = new Set();

function readProcessTable() {
  return execFileSync('ps', ['-eo', 'pid=,ppid=,pgid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
}

function descendantsOf(rootPid, table) {
  const childrenByParent = new Map();
  for (const [pid, parentPid] of table) {
    const siblings = childrenByParent.get(parentPid) ?? [];
    siblings.push(pid);
    childrenByParent.set(parentPid, siblings);
  }
  const found = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    for (const child of childrenByParent.get(pending.pop()) ?? []) {
      found.push(child);
      pending.push(child);
    }
  }
  return found;
}

export function trackDescendantGroups(rootPid = process.pid) {
  const table = readProcessTable();
  const ownGroupId = table.find(([pid]) => pid === rootPid)?.[2];
  const descendants = new Set(descendantsOf(rootPid, table));
  for (const [pid, , pgid] of table) {
    if (pgid !== ownGroupId && descendants.has(pid)) trackedGroupIds.add(pgid);
  }
}

export function signalTrackedGroups(signal) {
  for (const groupId of trackedGroupIds) {
    try {
      process.kill(-groupId, signal);
    } catch {
      trackedGroupIds.delete(groupId);
    }
  }
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}

if (import.meta.main) {
  const turbo = spawn('turbo', ['run', 'dev'], { stdio: 'inherit', detached: true });
  let stopping = false;

  const track = () => {
    try {
      trackDescendantGroups();
    } catch {
      clearInterval(tracker);
    }
  };
  const tracker = setInterval(track, TRACK_INTERVAL_MS);
  track();

  const stop = () => {
    if (stopping) {
      signalTrackedGroups('SIGKILL');
      process.exit(0);
    }
    stopping = true;
    clearInterval(tracker);
    signalTrackedGroups('SIGTERM');
    setTimeout(() => {
      signalTrackedGroups('SIGKILL');
      process.exit(0);
    }, KILL_GRACE_MS);
  };

  for (const signal of STOP_SIGNALS) process.on(signal, stop);

  turbo.on('exit', (code, signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(tracker);
    signalTrackedGroups('SIGTERM');
    process.exit(code ?? signalExitCode(signal));
  });
}
