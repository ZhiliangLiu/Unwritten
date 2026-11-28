import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { indexNovelFile } from './novel-import.ts';

const BIG5_TWO_CHAPTERS =
  'b2c4a440b3b920c26bb4e40aa54cbba1b36fac4fa7daadccaababf4fa1430ab2c4a447b3b920a5a2bf4f0abf4fb6f0bab6b7c0a446a1430a';
const GB18030_TWO_CHAPTERS =
  'b5dad2bbd5c220b9e9b8db0acbfbcbb5d5e2cac7ced2c3c7b5c4b5c6a1a30ab5dab6fed5c220caa7b5c60ab5c6cbfecfa8c3f0c1cba1a30a';

async function indexBytes(bytes: Buffer | string) {
  const temp = makeTempDataDir();
  try {
    const path = join(temp.dir, 'source.txt');
    await writeFile(path, bytes);
    const size = Buffer.byteLength(bytes);
    const index = await indexNovelFile(path, '潮汐邮局', size);
    const raw = readFileSync(path);
    const decoder = (start: number, stop?: number) => new TextDecoder(index.encoding).decode(raw.subarray(start, stop));
    return {
      ...index,
      sectionText: (chapter: number) => decoder(index.chapters[chapter]!.start, index.chapters[chapter + 1]?.start),
    };
  } finally {
    temp.cleanup();
  }
}

describe('indexNovelFile', () => {
  it('目录里没有正文的章名不算章，默认章取到正文', async () => {
    const index = await indexBytes(
      '潮汐邮局\n简介：一个信使的故事。\n\n目录\n第一章 归港\n第二章 失灯\n\n第一章 归港\n信使走下船。\n第二章 失灯\n灯塔熄灭了。\n',
    );
    expect(index.chapters.map((chapter) => chapter.title)).toEqual(['', '第一章 归港', '第二章 失灯']);
    expect(index.sectionText(0)).toContain('目录\n第一章 归港\n第二章 失灯\n');
    expect(index.sectionText(1)).toBe('第一章 归港\n信使走下船。\n');
  });

  it('卷名紧跟章名时只留章名，像正文句子的行不算章名', async () => {
    const index = await indexBytes(
      '第一卷 潮汐\n第一章 归港\n第二回合，他赢了。\n第三节课开始了。\n第二章 失灯\n灯灭了。\n',
    );
    expect(index.chapters.map((chapter) => chapter.title)).toEqual(['第一章 归港', '第二章 失灯']);
    expect(index.chapters[0]!.start).toBe(0);
    expect(index.sectionText(0)).toContain('第二回合，他赢了。\n第三节课开始了。\n');
  });

  it('没有章名的正文约每两万字在行首切成一段', async () => {
    const paragraph = '信使沿着堤岸慢慢地走。'.repeat(100) + '\n';
    const index = await indexBytes(paragraph.repeat(50));
    expect(index.chapters).toHaveLength(3);
    expect(index.chapters.every((chapter) => chapter.title === '')).toBe(true);
    expect(index.chapters[1]!.start).toBe(Buffer.byteLength(paragraph) * 19);
    expect(index.sectionText(1).startsWith('信使沿着堤岸')).toBe(true);
  });

  it('超长的单行不在行中间切段', async () => {
    const index = await indexBytes('第一章 归港\n' + '潮声。'.repeat(12_000) + '\n第二章 失灯\n灯灭了。\n');
    expect(index.chapters.map((chapter) => chapter.title)).toEqual(['第一章 归港', '第二章 失灯']);
  });

  it('章节数到 10,000 时截断，余下的正文并入最后一章', async () => {
    const index = await indexBytes('第1章 归港\n信使走下船。\n'.repeat(10_001));
    expect(index.chapters).toHaveLength(10_000);
    expect(index.sectionText(9_999)).toBe('第1章 归港\n信使走下船。\n'.repeat(2));
  });

  it.each([
    ['big5', Buffer.from(BIG5_TWO_CHAPTERS, 'hex'), '第二章 失燈\n燈塔熄滅了。\n'],
    ['gb18030', Buffer.from(GB18030_TWO_CHAPTERS, 'hex'), '第二章 失灯\n灯塔熄灭了。\n'],
  ])('按常用字比例认出 %s', async (encoding, bytes, secondChapter) => {
    const index = await indexBytes(bytes);
    expect(index.encoding).toBe(encoding);
    expect(index.chapters).toHaveLength(2);
    expect(index.sectionText(1)).toBe(secondChapter);
  });

  it.each(['utf-16le', 'utf-16be'] as const)('按 BOM 认出 %s，章节偏移落在字节上', async (encoding) => {
    const little = Buffer.from('﻿第一章 归港\r\n信使走下船。\r\n第二章 失灯\r\n灯灭了。\r\n', 'utf16le');
    const index = await indexBytes(encoding === 'utf-16le' ? little : Buffer.from(little).swap16());
    expect(index.encoding).toBe(encoding);
    expect(index.chapters.map((chapter) => chapter.title)).toEqual(['第一章 归港', '第二章 失灯']);
    expect(index.sectionText(1)).toBe('第二章 失灯\r\n灯灭了。\r\n');
  });

  it('开头大段是英文时仍按中文部分认出编码', async () => {
    const english = Buffer.from('Preface. The ferry runs at dawn and dusk.\n'.repeat(2_000));
    const index = await indexBytes(Buffer.concat([english, Buffer.from(GB18030_TWO_CHAPTERS, 'hex')]));
    expect(english.length).toBeLessThan(256 * 1024);
    expect(index.encoding).toBe('gb18030');
  });

  it('解出来是乱码的文件拒绝导入', async () => {
    await expect(indexBytes(Buffer.from('caf\xe9 au lait, cr\xe8me br\xfbl\xe9e\n', 'latin1'))).rejects.toMatchObject({
      code: 'novel_invalid_text',
    });
  });
});
