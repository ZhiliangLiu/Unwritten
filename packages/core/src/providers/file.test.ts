import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createProvidersStore } from './file.ts';
import { emptyProvidersFile, type ProvidersFile } from './schema.ts';

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const versionOneFile = {
  version: 1,
  providers: {},
  endpoints: [
    {
      id: 'custom-ollama-3f2a1c',
      name: 'Ollama',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [{ id: 'qwen' }],
    },
  ],
  purposes: { default: { provider: 'custom-ollama-3f2a1c', model: 'qwen' } },
};

describe('createProvidersStore', () => {
  it('文件不存在时返回 missing', () => {
    const temp = makeTempDataDir();
    try {
      const store = createProvidersStore(join(temp.dir, 'providers.json'));
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
      const store = createProvidersStore(file);
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
      const store = createProvidersStore(file);
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
    writeFileSync(file, '{"version":3}');
    try {
      const state = createProvidersStore(file).load();
      expect(state.status).toBe('too_new');
      if (state.status === 'too_new' && state.problem.kind === 'too_new') expect(state.problem.version).toBe(3);
    } finally {
      temp.cleanup();
    }
  });

  it('版本 1 只在内存里升级，磁盘字节不变', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(file, `${JSON.stringify(versionOneFile, null, 2)}\n`);
    const before = sha256(file);
    try {
      const state = createProvidersStore(file).load();
      expect(state.status).toBe('ok');
      if (state.status !== 'ok') return;
      expect(state.migratedFrom).toBe(1);
      expect(state.file.version).toBe(2);
      expect(state.file.imageServices).toEqual([]);
      expect(state.file.image.service).toBeNull();
      expect(state.file.endpoints).toEqual(versionOneFile.endpoints);
      expect(state.file.purposes).toEqual(versionOneFile.purposes);
      expect(sha256(file)).toBe(before);
    } finally {
      temp.cleanup();
    }
  });

  it('第一次写入时把版本 1 原文备份为 0600 的 .bak', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    const original = `${JSON.stringify(versionOneFile, null, 2)}\n`;
    writeFileSync(file, original);
    const migrated: boolean[] = [];
    try {
      const store = createProvidersStore(file, { onMigrated: (backup) => migrated.push(backup) });
      expect(store.load().status).toBe('ok');
      expect(store.write(emptyProvidersFile()).status).toBe('ok');
      const backup = join(temp.dir, 'providers.json.bak');
      expect(readFileSync(backup)).toEqual(Buffer.from(original));
      if (process.platform !== 'win32') expect(statSync(backup).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2);
      expect(migrated).toEqual([true]);
    } finally {
      temp.cleanup();
    }
  });

  it('只备份一次', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    const original = `${JSON.stringify(versionOneFile, null, 2)}\n`;
    writeFileSync(file, original);
    const migrated: boolean[] = [];
    try {
      const store = createProvidersStore(file, { onMigrated: (backup) => migrated.push(backup) });
      store.load();
      store.write(emptyProvidersFile());
      store.write(emptyProvidersFile());
      expect(readFileSync(join(temp.dir, 'providers.json.bak'))).toEqual(Buffer.from(original));
      expect(migrated).toEqual([true]);
    } finally {
      temp.cleanup();
    }
  });

  it('备份失败时不写新文件', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    const original = `${JSON.stringify(versionOneFile, null, 2)}\n`;
    writeFileSync(file, original);
    mkdirSync(`${file}.bak`);
    const migrated: boolean[] = [];
    try {
      const store = createProvidersStore(file, { onMigrated: (backup) => migrated.push(backup) });
      store.load();
      expect(() => store.write(emptyProvidersFile())).toThrow();
      expect(readFileSync(file)).toEqual(Buffer.from(original));
      expect(migrated).toEqual([false]);
    } finally {
      temp.cleanup();
    }
  });

  it('原子写入、0600 权限，并保留未知字段', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    try {
      const store = createProvidersStore(file);
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

  it('保留 imageServices 里的未知字段', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        providers: {},
        endpoints: [],
        purposes: {},
        imageServices: [
          {
            id: 'image-openai-9b1c2d',
            name: 'OpenAI',
            protocol: 'openai-images',
            baseUrl: 'https://api.openai.test/v1',
            'x-note': 'keep',
          },
        ],
        image: { service: null },
      }),
    );
    try {
      const store = createProvidersStore(file);
      const state = store.load();
      expect(state.status).toBe('ok');
      if (state.status !== 'ok') return;
      store.write(state.file);
      expect(JSON.parse(readFileSync(file, 'utf8')).imageServices[0]['x-note']).toBe('keep');
    } finally {
      temp.cleanup();
    }
  });

  it('同一个 store 的订阅者都收到通知，抛异常不影响后一个', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(file, JSON.stringify({ version: 2 }));
    try {
      const store = createProvidersStore(file);
      const first: string[] = [];
      const second: string[] = [];
      store.subscribe((state) => {
        first.push(state.revision);
        throw new Error('listener failed');
      });
      store.subscribe((state) => {
        second.push(state.revision);
      });
      store.load();
      writeFileSync(file, JSON.stringify({ version: 2, providers: {} }));
      store.load();
      expect(first).toHaveLength(2);
      expect(second).toEqual(first);
    } finally {
      temp.cleanup();
    }
  });
});
