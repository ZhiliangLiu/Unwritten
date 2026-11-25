import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createProvidersStore } from './providers-file.ts';
import { emptyProvidersFile, type ProvidersFile } from './providers-schema.ts';

describe('createProvidersStore', () => {
  it('文件不存在时返回 missing', () => {
    const temp = makeTempDataDir();
    try {
      const store = createProvidersStore(join(temp.dir, 'providers.json'), () => {});
      expect(store.load().status).toBe('missing');
    } finally {
      temp.cleanup();
    }
  });

  it('坏 JSON 返回行列号', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(file, '{"version": 1,\n  oops\n}');
    try {
      const store = createProvidersStore(file, () => {});
      const state = store.load();
      expect(state.status).toBe('invalid');
      if (state.status === 'invalid') {
        expect(state.problem.kind).toBe('syntax');
        if (state.problem.kind === 'syntax') expect(state.problem.line).toBe(2);
      }
    } finally {
      temp.cleanup();
    }
  });

  it('schema 不对时返回第一个问题路径', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(file, '{"version":1,"endpoints":[{"id":1}]}');
    try {
      const store = createProvidersStore(file, () => {});
      const state = store.load();
      expect(state.status).toBe('invalid');
      if (state.status === 'invalid' && state.problem.kind === 'schema') {
        expect(state.problem.path.startsWith('endpoints.0')).toBe(true);
      }
    } finally {
      temp.cleanup();
    }
  });

  it('更高版本返回 too_new', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(file, '{"version":2}');
    try {
      expect(createProvidersStore(file, () => {}).load().status).toBe('too_new');
    } finally {
      temp.cleanup();
    }
  });

  it('原子写入、0600 权限，并保留未知字段', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    try {
      const store = createProvidersStore(file, () => {});
      const input = { ...emptyProvidersFile(), custom: 'keep' } as ProvidersFile;
      const state = store.write(input);
      expect(state.status).toBe('ok');
      expect(JSON.parse(readFileSync(file, 'utf8')).custom).toBe('keep');
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(temp.dir)).toEqual(['providers.json']);
    } finally {
      temp.cleanup();
    }
  });
});
