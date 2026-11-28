import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { indexNovelFile } from './novel-import.ts';

it('异常密集的章节标题按连续正文导入', async () => {
  const temp = makeTempDataDir();
  try {
    const path = join(temp.dir, 'source.txt');
    const text = '第一章 归港\n'.repeat(10_001) + '信使走下船。';
    const size = Buffer.byteLength(text);
    await writeFile(path, text);
    const index = await indexNovelFile(path, '潮汐邮局', size);
    expect(index.chapters).toEqual([{ title: '', start: 0 }]);
    expect(index.size).toBe(size);
  } finally {
    temp.cleanup();
  }
});
