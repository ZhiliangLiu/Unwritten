import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { ConfigProblem } from '@unwritten/contracts';
import { upgradeProvidersObject } from './migrate.ts';
import { emptyProvidersFile, PROVIDERS_FILE_VERSION, ProvidersFileSchema, type ProvidersFile } from './schema.ts';

export type ProvidersState =
  | { status: 'missing'; revision: 'absent'; file: ProvidersFile }
  | { status: 'ok'; revision: string; file: ProvidersFile; migratedFrom: 1 | null }
  | { status: 'invalid'; revision: string; problem: ConfigProblem }
  | { status: 'too_new'; revision: string; problem: ConfigProblem };

export interface ProvidersStore {
  load(): ProvidersState;
  write(file: ProvidersFile): ProvidersState;
  enqueue<T>(task: () => T | Promise<T>): Promise<T>;
  subscribe(listener: (state: ProvidersState) => void): () => void;
}

function syntaxProblem(error: unknown, text: string): ConfigProblem {
  const message = error instanceof Error ? error.message : String(error);
  const named = /line (\d+) column (\d+)/i.exec(message);
  if (named) return { kind: 'syntax', line: Number(named[1]), column: Number(named[2]), message };
  const positioned = /position (\d+)/i.exec(message);
  if (positioned) {
    const position = Math.min(Number(positioned[1]), text.length);
    const before = text.slice(0, position);
    const line = before.split('\n').length;
    const column = position - before.lastIndexOf('\n');
    return { kind: 'syntax', line, column, message };
  }
  return { kind: 'syntax', line: 1, column: 1, message };
}

export function createProvidersStore(
  filePath: string,
  options?: { onMigrated?: (backup: boolean) => void },
): ProvidersStore {
  let cache: { mtimeMs: number; size: number; state: ProvidersState } | null = null;
  let lastRevision: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(state: ProvidersState) => void>();

  const notify = (state: ProvidersState) => {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        continue;
      }
    }
  };

  const load = (): ProvidersState => {
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(filePath);
    } catch {
      const state: ProvidersState = { status: 'missing', revision: 'absent', file: emptyProvidersFile() };
      if (lastRevision !== state.revision) {
        lastRevision = state.revision;
        notify(state);
      }
      return state;
    }

    if (cache && cache.mtimeMs === stats.mtimeMs && cache.size === stats.size) return cache.state;

    const bytes = readFileSync(filePath);
    const revision = createHash('sha256').update(bytes).digest('hex');
    const text = bytes.toString('utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const state: ProvidersState = { status: 'invalid', revision, problem: syntaxProblem(error, text) };
      cache = { mtimeMs: stats.mtimeMs, size: stats.size, state };
      if (lastRevision !== revision) {
        lastRevision = revision;
        notify(state);
      }
      return state;
    }

    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const version = (parsed as { version: unknown }).version;
      if (typeof version === 'number' && version > PROVIDERS_FILE_VERSION) {
        const state: ProvidersState = { status: 'too_new', revision, problem: { kind: 'too_new', version } };
        cache = { mtimeMs: stats.mtimeMs, size: stats.size, state };
        if (lastRevision !== revision) {
          lastRevision = revision;
          notify(state);
        }
        return state;
      }
    }

    const upgraded = upgradeProvidersObject(parsed);
    const result = ProvidersFileSchema.safeParse(upgraded.value);
    if (!result.success) {
      const issue = result.error.issues[0];
      const state: ProvidersState = {
        status: 'invalid',
        revision,
        problem: {
          kind: 'schema',
          path: issue?.path.join('.') ?? '',
          message: issue?.message ?? '配置不符合 schema',
        },
      };
      cache = { mtimeMs: stats.mtimeMs, size: stats.size, state };
      if (lastRevision !== revision) {
        lastRevision = revision;
        notify(state);
      }
      return state;
    }

    const state: ProvidersState = {
      status: 'ok',
      revision,
      file: result.data,
      migratedFrom: upgraded.fromVersion === 1 ? 1 : null,
    };
    cache = { mtimeMs: stats.mtimeMs, size: stats.size, state };
    if (lastRevision !== revision) {
      lastRevision = revision;
      notify(state);
    }
    return state;
  };

  const write = (file: ProvidersFile): ProvidersState => {
    const validated = ProvidersFileSchema.parse(file);
    const current = load();
    if (current.status === 'ok' && current.migratedFrom === 1) {
      const backup = `${filePath}.bak`;
      try {
        copyFileSync(filePath, backup);
        chmodSync(backup, 0o600);
      } catch (error) {
        options?.onMigrated?.(false);
        throw error;
      }
      options?.onMigrated?.(true);
    }
    const content = `${JSON.stringify(validated, null, 2)}\n`;
    const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, content, { mode: 0o600 });
      renameSync(temporary, filePath);
      if (process.platform !== 'win32') chmodSync(filePath, 0o600);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    cache = null;
    return load();
  };

  return {
    load,
    write,
    enqueue<T>(task: () => T | Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
